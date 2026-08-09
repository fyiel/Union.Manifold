import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LibraryPage } from "@/app/pages/LibraryPage"

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

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe("Library first paint", () => {
  afterEach(() => {
    for (const key of ["ucSettings", "ucSources", "ucDownloads"]) {
      Object.defineProperty(window, key, { configurable: true, writable: true, value: undefined })
    }
    vi.restoreAllMocks()
  })

  it("renders installed rows without waiting for secondary cache, status, installing, or artwork work", async () => {
    const metadata = deferred<Record<string, unknown>>()
    const cache = deferred<Record<string, unknown>>()
    const status = deferred<{ available: boolean; enabled: boolean }>()
    const installing = deferred<any[]>()
    const artwork = deferred<Record<string, unknown>>()
    const search = vi.fn(async () => ({ ok: true, games: [] }))

    Object.defineProperty(window, "ucSettings", {
      configurable: true,
      writable: true,
      value: {
        get: vi.fn((key: string) => {
          if (key === "libraryGameMeta") return metadata.promise
          if (key === "libraryGameCache") return cache.promise
          if (key === "downloadArt") return artwork.promise
          return Promise.resolve(undefined)
        }),
        set: vi.fn(async () => ({ ok: true })),
      },
    })
    Object.defineProperty(window, "ucSources", {
      configurable: true,
      writable: true,
      value: {
        search,
        onlinefixStatus: vi.fn(() => status.promise),
        onSourcesUpdated: vi.fn(() => () => {}),
      },
    })
    Object.defineProperty(window, "ucDownloads", {
      configurable: true,
      writable: true,
      value: {
        listInstalled: vi.fn(async () => [{ appid: "instant-installed", metadata: { name: "Already Here" } }]),
        listInstalling: vi.fn(() => installing.promise),
      },
    })

    render(<MemoryRouter><LibraryPage /></MemoryRouter>)

    expect((await screen.findAllByText("Already Here")).length).toBeGreaterThan(0)
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(search).not.toHaveBeenCalled()

    metadata.resolve({})
    cache.resolve({})
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1))
    status.resolve({ available: false, enabled: false })
    installing.resolve([])
    artwork.resolve({})
  })
})
