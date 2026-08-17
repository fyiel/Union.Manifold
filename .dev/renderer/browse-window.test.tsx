import { fireEvent, render, screen } from "@testing-library/react"
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

import { BrowsePage, browseColsForWidth } from "@/app/pages/BrowsePage"

const games = Array.from({ length: 60 }, (_, i) => ({
  dedupKey: `game-${i}`,
  title: `game-${String(i).padStart(2, "0")}`,
  sources: [{ sourceId: "steamrip", sourceSlug: `game-${i}` }],
}))

function mockLayout() {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.style?.display === "grid" ? 1050 : this.classList?.contains("mf-scroll") ? 1122 : 0
    },
  })
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList?.contains("mf-scroll") ? 700 : 0
    },
  })
}

describe("Browse scroll window", () => {
  afterEach(() => {
    delete (HTMLElement.prototype as any).clientWidth
    delete (HTMLElement.prototype as any).clientHeight
    vi.restoreAllMocks()
    Object.defineProperty(window, "ucSources", { configurable: true, writable: true, value: undefined })
  })

  it("computes columns from the grid content width", () => {
    expect(browseColsForWidth(1050)).toBe(5)
    expect(browseColsForWidth(1122)).toBe(6)
    expect(browseColsForWidth(0)).toBe(1)
  })

  it("keeps the rendered window aligned to the real grid columns while scrolling", async () => {
    mockLayout()
    querySources.mockReset().mockResolvedValue({
      ok: true,
      games,
      total: games.length,
      facets: { tags: [] },
      applied: {},
      capabilities: { perSource: [] },
    })

    const { container } = render(<MemoryRouter><BrowsePage /></MemoryRouter>)
    await screen.findByText("game-00")

    const scroller = container.querySelector(".mf-scroll") as HTMLDivElement
    Object.defineProperties(scroller, {
      scrollTop: { configurable: true, value: 1050 },
      scrollHeight: { configurable: true, value: 4200 },
    })
    fireEvent.scroll(scroller)

    const first = screen.getAllByTestId("card")[0].textContent
    expect(first).toBe("game-05")
  })
})
