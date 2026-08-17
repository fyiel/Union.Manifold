import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/hooks/use-games", () => ({ useGamesData: () => ({ games: [] }) }))
vi.mock("@/context/game-launch-context", () => ({
  useGameLaunch: () => ({ requestLaunch: vi.fn(), requestSetExecutable: vi.fn(), stopGame: vi.fn() }),
}))
vi.mock("@/context/toast-context", () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock("@/hooks/use-running-games", () => ({ useRunningGame: () => false }))
vi.mock("@/context/downloads-context", () => ({
  useDownloadsSelector: <T,>(selector: (downloads: []) => T) => selector([]),
}))
vi.mock("@/context/tab-visibility", () => ({ useTabVisible: () => true }))

import { LibraryPage } from "@/app/pages/LibraryPage"

const found = {
  dedupKey: "steamrip:tiny-terraces",
  title: "Tiny Terraces",
  image: "https://cdn.test/tiny-terraces.jpg",
  sizeText: "287 MB",
  sources: [{ sourceId: "steamrip", sourceSlug: "tiny-terraces" }],
}

function installBridge(opts: { installed: any[]; cache?: Record<string, unknown>; search?: ReturnType<typeof vi.fn> }) {
  const search = opts.search ?? vi.fn(async () => ({ ok: true, games: [] }))
  Object.defineProperty(window, "ucSettings", {
    configurable: true,
    writable: true,
    value: {
      get: vi.fn(async (key: string) => (key === "libraryGameCache" ? opts.cache ?? {} : {})),
      set: vi.fn(async () => ({ ok: true })),
    },
  })
  Object.defineProperty(window, "ucSources", {
    configurable: true,
    writable: true,
    value: {
      search,
      detail: vi.fn(async () => ({ ok: true, game: found })),
      onlinefixStatus: vi.fn(async () => ({ available: false, enabled: false })),
      onSourcesUpdated: vi.fn(() => () => {}),
    },
  })
  Object.defineProperty(window, "ucDownloads", {
    configurable: true,
    writable: true,
    value: { listLibrary: vi.fn(async () => ({ installed: opts.installed, installing: [] })) },
  })
  return { search }
}

describe("Library archive enrichment", () => {
  afterEach(() => {
    for (const key of ["ucSettings", "ucSources", "ucDownloads"]) {
      Object.defineProperty(window, key, { configurable: true, writable: true, value: undefined })
    }
    vi.restoreAllMocks()
  })

  it("resolves a filename-derived title by trimming release tags and adopts the canonical title and cover", async () => {
    const search = vi.fn(async (q: string) => ({ ok: true, games: q === "Tiny Terraces" ? [found] : [] }))
    installBridge({
      installed: [{ appid: "local-archive-tiny-terraces", name: "Tiny_Terraces_TENOKE", installStatus: "installed" }],
      search,
    })

    const { container } = render(<MemoryRouter><LibraryPage /></MemoryRouter>)
    expect((await screen.findAllByText("Tiny_Terraces_TENOKE")).length).toBeGreaterThan(0)

    await waitFor(() => expect(search.mock.calls.map((c) => c[0])).toContain("Tiny Terraces"), { timeout: 3000 })
    await waitFor(() => expect(screen.getAllByText("Tiny Terraces").length).toBeGreaterThan(0), { timeout: 3000 })
    expect(container.querySelector('img[alt="Tiny Terraces"]')).toBeTruthy()
  })

  it("restores cover candidates and title from the persisted game cache", async () => {
    installBridge({
      installed: [{ appid: "local-archive-cached", name: "Cached_Game", installStatus: "installed" }],
      cache: {
        "local-archive-cached": {
          cachedAt: Date.now(),
          game: { dedupKey: "c1", title: "Cached Game", image: "https://cdn.test/cached.jpg", steamAppId: 321, sources: [] },
        },
      },
    })

    const { container } = render(<MemoryRouter><LibraryPage /></MemoryRouter>)
    await waitFor(() => expect(container.querySelector('img[alt="Cached Game"]')).toBeTruthy(), { timeout: 3000 })
    expect(screen.getAllByText("Cached Game").length).toBeGreaterThan(0)
  })
})
