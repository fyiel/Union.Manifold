import { act, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

const querySources = vi.hoisted(() => vi.fn())

vi.mock("@/lib/browse-cache", () => ({
  getBrowseCache: () => null,
  setBrowseCache: vi.fn(),
  setBrowseScroll: vi.fn(),
  consumeDiskRestore: () => false,
}))
vi.mock("@/app/manifold/GameCard", () => ({ GameCard: ({ game }: any) => <div data-testid="card">{game.title}</div> }))
vi.mock("@/lib/sources", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/sources")>(),
  sourcesAvailable: () => true,
  listSources: async () => [{ id: "steamrip", name: "SteamRIP", enabled: true, available: true }],
  onSourcesChanged: () => () => {},
  querySources,
  rememberGames: vi.fn(),
}))

import { BrowsePage } from "@/app/pages/BrowsePage"

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

describe("Browse source query failures", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    Object.defineProperty(window, "ucSources", { configurable: true, writable: true, value: undefined })
  })

  it("preserves stable rows on native failure and recovers on retry", async () => {
    vi.useFakeTimers()
    querySources.mockReset()
      .mockResolvedValueOnce(result("stable result"))
      .mockResolvedValueOnce({ ...result("ignored"), ok: false, games: [], total: 0, error: "offline" })
      .mockResolvedValueOnce(result("recovered result"))

    render(<MemoryRouter><BrowsePage /></MemoryRouter>)
    await act(async () => { await Promise.resolve() })
    await act(async () => { vi.advanceTimersByTime(0); await Promise.resolve() })
    expect(screen.getByText("stable result")).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText("search every source…"), { target: { value: "broken" } })
    await act(async () => { vi.advanceTimersByTime(300); await Promise.resolve() })
    expect(screen.getByText("stable result")).toBeTruthy()
    expect(screen.getByText("offline")).toBeTruthy()

    fireEvent.click(screen.getAllByText("retry")[0])
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText("recovered result")).toBeTruthy()
    expect(screen.queryByText("offline")).toBeNull()
  })

  it("owns partial events and warns as soon as a current source fails", async () => {
    vi.useFakeTimers()
    const final = deferred<ReturnType<typeof result>>()
    let onPartial: ((payload: any) => void) | undefined
    Object.defineProperty(window, "ucSources", {
      configurable: true,
      writable: true,
      value: { onBrowsePartial: (callback: (payload: any) => void) => { onPartial = callback; return () => {} } },
    })
    querySources.mockReset().mockReturnValueOnce(final.promise)

    render(<MemoryRouter><BrowsePage /></MemoryRouter>)
    await act(async () => { await Promise.resolve() })
    await act(async () => { vi.advanceTimersByTime(0); await Promise.resolve() })
    const requestId = querySources.mock.calls[0][1]

    act(() => onPartial?.({
      reqId: requestId - 1,
      games: result("stale partial").games,
      total: 1,
      doneSources: [],
      failedSources: ["steamrip"],
    }))
    expect(screen.queryByText("stale partial")).toBeNull()

    act(() => onPartial?.({
      reqId: requestId,
      games: result("current partial").games,
      total: 1,
      doneSources: [],
      failedSources: ["steamrip"],
    }))
    expect(screen.getByText("current partial")).toBeTruthy()
    expect(screen.getByText("Some sources unavailable")).toBeTruthy()

    await act(async () => { final.resolve(result("final result")); await final.promise })
    expect(screen.getByText("final result")).toBeTruthy()
  })

  it("keeps card order stable while streaming partials re-sort server-side", async () => {
    vi.useFakeTimers()
    const final = deferred<ReturnType<typeof result>>()
    let onPartial: ((payload: any) => void) | undefined
    Object.defineProperty(window, "ucSources", {
      configurable: true,
      writable: true,
      value: { onBrowsePartial: (callback: (payload: any) => void) => { onPartial = callback; return () => {} } },
    })
    querySources.mockReset().mockReturnValueOnce(final.promise)

    render(<MemoryRouter><BrowsePage /></MemoryRouter>)
    await act(async () => { await Promise.resolve() })
    await act(async () => { vi.advanceTimersByTime(0); await Promise.resolve() })
    const requestId = querySources.mock.calls[0][1]

    const g = (title: string, mirrors = 1) => ({
      dedupKey: title,
      title,
      sources: Array.from({ length: mirrors }, (_, i) => ({ sourceId: `s${i}` })),
    })
    const order = () => screen.getAllByTestId("card").map((n) => n.textContent)

    act(() => onPartial?.({
      reqId: requestId,
      games: [g("B"), g("A")],
      total: 4,
      doneSources: ["steamrip"],
      failedSources: [],
    }))
    expect(order()).toEqual(["B", "A"])

    act(() => onPartial?.({
      reqId: requestId,
      games: [g("A", 3), g("B"), g("C")],
      total: 4,
      doneSources: ["steamrip"],
      failedSources: [],
    }))
    expect(order()).toEqual(["B", "A", "C"])

    await act(async () => {
      final.resolve({ ...result("x"), games: [g("A", 3), g("B"), g("C"), g("D")], total: 4 })
      await final.promise
    })
    expect(order()).toEqual(["B", "A", "C", "D"])
  })

  it("cancels and invalidates the active native query as soon as input changes", async () => {
    vi.useFakeTimers()
    const stale = deferred<ReturnType<typeof result>>()
    const cancelQuery = vi.fn(async () => ({ ok: true }))
    Object.defineProperty(window, "ucSources", {
      configurable: true,
      writable: true,
      value: { cancelQuery, onBrowsePartial: () => () => {} },
    })
    querySources.mockReset()
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(result("fresh result"))

    render(<MemoryRouter><BrowsePage /></MemoryRouter>)
    await act(async () => { await Promise.resolve() })
    await act(async () => { vi.advanceTimersByTime(0); await Promise.resolve() })
    expect(querySources).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByPlaceholderText("search every source…"), { target: { value: "fresh" } })
    expect(cancelQuery).toHaveBeenCalledTimes(1)

    await act(async () => { stale.resolve(result("stale result")); await stale.promise })
    expect(screen.queryByText("stale result")).toBeNull()
    await act(async () => { vi.advanceTimersByTime(300); await Promise.resolve() })
    expect(screen.getByText("fresh result")).toBeTruthy()
  })
})
