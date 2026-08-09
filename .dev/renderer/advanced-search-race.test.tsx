import { act, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

const querySources = vi.hoisted(() => vi.fn())

vi.mock("@/lib/advanced-cache", () => ({ getAdvancedCache: () => null, setAdvancedCache: vi.fn() }))
vi.mock("@/app/manifold/GameCard", () => ({ GameCard: ({ game }: any) => <div>{game.title}</div> }))
vi.mock("@/lib/sources", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/sources")>(),
  sourcesAvailable: () => true,
  listSources: async () => [{ id: "steamrip", name: "SteamRIP", available: true }],
  sourceCapabilities: async () => ({ perSource: [] }),
  querySources,
  rememberGames: vi.fn(),
}))

import { AdvancedSearchPage } from "@/app/pages/AdvancedSearchPage"

const result = (title: string) => ({
  ok: true,
  games: [{ dedupKey: title, title, sources: [{ sourceId: "steamrip", id: title }] }],
  total: 1,
  facets: { tags: [] },
  applied: {},
  capabilities: { perSource: [] },
})

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe("Advanced Search request scheduling", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    Object.defineProperty(window, "ucSources", { configurable: true, writable: true, value: undefined })
  })

  it("invalidates stale work before debounce and runs source changes immediately", async () => {
    vi.useFakeTimers()
    const stale = deferred<ReturnType<typeof result>>()
    querySources.mockReset()
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(result("fresh result"))
      .mockResolvedValueOnce(result("source result"))

    render(<MemoryRouter><AdvancedSearchPage /></MemoryRouter>)
    await act(async () => { await Promise.resolve() })
    await act(async () => { vi.advanceTimersByTime(0) })
    expect(querySources).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByPlaceholderText("title or keyword…"), { target: { value: "fresh" } })
    await act(async () => { vi.advanceTimersByTime(279) })
    expect(querySources).toHaveBeenCalledTimes(1)

    await act(async () => { stale.resolve(result("stale result")); await stale.promise })
    expect(screen.queryByText("stale result")).toBeNull()

    await act(async () => { vi.advanceTimersByTime(1); await Promise.resolve() })
    expect(screen.getByText("fresh result")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: /SteamRIP/i }))
    expect(screen.queryByText("fresh result")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /SteamRIP/i }))
    await act(async () => { vi.advanceTimersByTime(0); await Promise.resolve() })
    expect(querySources).toHaveBeenCalledTimes(3)
    expect(screen.getByText("source result")).toBeTruthy()
  })

  it("renders owned partials before the final native response", async () => {
    vi.useFakeTimers()
    const final = deferred<ReturnType<typeof result>>()
    let onPartial: ((payload: any) => void) | undefined
    Object.defineProperty(window, "ucSources", {
      configurable: true,
      writable: true,
      value: { onBrowsePartial: (callback: (payload: any) => void) => { onPartial = callback; return () => {} } },
    })
    querySources.mockReset().mockReturnValueOnce(final.promise)

    render(<MemoryRouter><AdvancedSearchPage /></MemoryRouter>)
    await act(async () => { await Promise.resolve() })
    await act(async () => { vi.advanceTimersByTime(0); await Promise.resolve() })
    const requestId = querySources.mock.calls[0][1]

    act(() => onPartial?.({
      reqId: requestId,
      games: result("progressive result").games,
      total: 2,
      doneSources: ["steamrip"],
      failedSources: [],
    }))
    expect(screen.getByText("progressive result")).toBeTruthy()

    await act(async () => { final.resolve(result("final result")); await final.promise })
    expect(screen.getByText("final result")).toBeTruthy()
  })

  it("keeps prior results when the replacement query fails", async () => {
    vi.useFakeTimers()
    querySources.mockReset()
      .mockResolvedValueOnce(result("stable result"))
      .mockResolvedValueOnce({ ...result("ignored"), ok: false, games: [], total: 0, error: "offline" })

    render(<MemoryRouter><AdvancedSearchPage /></MemoryRouter>)
    await act(async () => { await Promise.resolve() })
    await act(async () => { vi.advanceTimersByTime(0); await Promise.resolve() })
    expect(screen.getByText("stable result")).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText("title or keyword…"), { target: { value: "replacement" } })
    await act(async () => { vi.advanceTimersByTime(280); await Promise.resolve() })
    expect(screen.getByText("stable result")).toBeTruthy()
    expect(screen.getByText("Sources unavailable — showing previous results")).toBeTruthy()
  })

  it("keeps the loaded total honest when load more returns an empty page", async () => {
    vi.useFakeTimers()
    querySources.mockReset()
      .mockResolvedValueOnce({ ...result("only result"), total: 2 })
      .mockResolvedValueOnce({ ...result("unused"), games: [], total: 2 })

    const { container } = render(<MemoryRouter><AdvancedSearchPage /></MemoryRouter>)
    await act(async () => { await Promise.resolve() })
    await act(async () => { vi.advanceTimersByTime(0); await Promise.resolve() })
    expect(screen.getByText("only result")).toBeTruthy()
    expect(screen.getByText(/scroll for more/)).toBeTruthy()

    const scrollers = container.querySelectorAll(".mf-scroll")
    fireEvent.scroll(scrollers[scrollers.length - 1])
    await act(async () => { await Promise.resolve() })

    expect(screen.getByText("only result")).toBeTruthy()
    expect(screen.queryByText(/scroll for more/)).toBeNull()
    expect(screen.getByText("1 title")).toBeTruthy()
  })
})
