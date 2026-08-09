import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { Link, MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { GameCard } from "@/app/manifold/GameCard"
import { SourceGamePage, SourceGameRoute } from "@/app/pages/SourceGamePage"
import { forgetRememberedGame } from "@/lib/sources"

vi.mock("@/context/downloads-context", () => ({
  useDownloadsSelector: <T,>(selector: (downloads: []) => T) => selector([]),
}))

vi.mock("@/context/game-launch-context", () => ({
  useGameLaunch: () => ({ requestLaunch: vi.fn() }),
}))

describe("Browse detail navigation", () => {
  afterEach(() => {
    forgetRememberedGame("instant-game")
    forgetRememberedGame("second-game")
    for (const key of ["ucSources", "ucDownloads", "ucSettings", "ucWand"]) {
      Object.defineProperty(window, key, { configurable: true, writable: true, value: undefined })
    }
    vi.restoreAllMocks()
  })

  it("paints the selected game before detail hydration and does not scrape on hover", async () => {
    let resolveDetail: (value: { ok: true; game: UnifiedSourceGame }) => void = () => {}
    const detail = vi.fn(() => {
      expect(screen.queryByRole("heading", { name: "Instant Game" })).toBeTruthy()
      return new Promise<{ ok: true; game: UnifiedSourceGame }>((resolve) => { resolveDetail = resolve })
    })
    const protondb = vi.fn(async () => ({ ok: true, data: null }))
    const steamMeta = vi.fn(async () => ({
      ok: true,
      meta: { screenshots: [], movies: [], requirements: { minimum: "", recommended: "" } },
    }))
    Object.defineProperty(window, "ucSources", {
      configurable: true,
      writable: true,
      value: { detail, protondb, steamMeta },
    })
    Object.defineProperty(window, "ucDownloads", {
      configurable: true,
      writable: true,
      value: { listInstalled: vi.fn(async () => []) },
    })
    Object.defineProperty(window, "ucSettings", {
      configurable: true,
      writable: true,
      value: { get: vi.fn(async () => null) },
    })

    const game = {
      dedupKey: "instant-game",
      title: "Instant Game",
      steamAppId: 620,
      genres: ["Adventure"],
      sources: [{
        sourceId: "steamrip",
        sourceSlug: "instant-game",
        dedupKey: "instant-game",
        title: "Instant Game",
        genres: ["Adventure"],
        downloadOptions: [],
      }],
    } as UnifiedSourceGame

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<GameCard game={game} />} />
          <Route path="/g/:key" element={<SourceGamePage />} />
        </Routes>
      </MemoryRouter>,
    )

    const link = screen.getByRole("link", { name: "Open Instant Game" })
    fireEvent.mouseEnter(link)
    fireEvent.focus(link)
    expect(detail).not.toHaveBeenCalled()

    fireEvent.click(link)
    expect(screen.getByRole("heading", { name: "Instant Game" })).toBeTruthy()
    await waitFor(() => expect(detail).toHaveBeenCalledTimes(1))
    expect(protondb).not.toHaveBeenCalled()
    expect(steamMeta).not.toHaveBeenCalled()

    resolveDetail({
      ok: true,
      game: {
        ...game,
        fullyResolved: true,
        description: "Hydrated after the shell commit.",
      },
    })
    expect(await screen.findByText("Hydrated after the shell commit.")).toBeTruthy()
    await waitFor(() => expect(protondb).toHaveBeenCalledWith(620))
    expect(steamMeta).toHaveBeenCalledWith(620)
  })

  it("defers trainer lookup until the game is installed", async () => {
    let installed: any[] = []
    const lookup = vi.fn(async () => null)
    const game = {
      dedupKey: "instant-game",
      title: "Instant Game",
      steamAppId: 620,
      fullyResolved: true,
      genres: ["Adventure"],
      sources: [{
        sourceId: "steamrip",
        sourceSlug: "instant-game",
        dedupKey: "instant-game",
        title: "Instant Game",
        genres: ["Adventure"],
        downloadOptions: [],
      }],
    } as UnifiedSourceGame
    Object.defineProperty(window, "ucDownloads", {
      configurable: true,
      writable: true,
      value: { listInstalled: vi.fn(async () => installed) },
    })
    Object.defineProperty(window, "ucSettings", {
      configurable: true,
      writable: true,
      value: { get: vi.fn(async () => null) },
    })
    Object.defineProperty(window, "ucWand", {
      configurable: true,
      writable: true,
      value: { lookup },
    })

    render(
      <MemoryRouter initialEntries={[{ pathname: "/g/instant-game", state: { game } }]}>
        <Routes>
          <Route path="/g/:key" element={<SourceGamePage />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(window.ucDownloads?.listInstalled).toHaveBeenCalledTimes(1))
    expect(lookup).not.toHaveBeenCalled()

    installed = [{ appid: "instant-game" }]
    window.dispatchEvent(new Event("uc_game_installed"))
    await waitFor(() => expect(lookup).toHaveBeenCalledWith("Instant Game", 620))
  })

  it("remounts cleanly when navigating directly between game detail keys", async () => {
    const first = {
      dedupKey: "instant-game",
      title: "Instant Game",
      fullyResolved: true,
      genres: [],
      sources: [],
    } as UnifiedSourceGame
    const second = {
      dedupKey: "second-game",
      title: "Second Game",
      genres: [],
      sources: [{
        sourceId: "steamrip",
        sourceSlug: "second-game",
        dedupKey: "second-game",
        title: "Second Game",
        genres: [],
        downloadOptions: [],
      }],
    } as UnifiedSourceGame
    const detail = vi.fn(async () => ({ ok: true, game: { ...second, fullyResolved: true } }))
    Object.defineProperty(window, "ucSources", {
      configurable: true,
      writable: true,
      value: { detail },
    })
    Object.defineProperty(window, "ucDownloads", {
      configurable: true,
      writable: true,
      value: { listInstalled: vi.fn(async () => []) },
    })
    Object.defineProperty(window, "ucSettings", {
      configurable: true,
      writable: true,
      value: { get: vi.fn(async () => null) },
    })

    render(
      <MemoryRouter initialEntries={[{ pathname: "/g/instant-game", state: { game: first } }]}>
        <Routes>
          <Route path="/g/:key" element={(
            <>
              <Link to="/g/second-game" state={{ game: second }}>Open second</Link>
              <SourceGameRoute />
            </>
          )} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole("heading", { name: "Instant Game" })).toBeTruthy()
    fireEvent.click(screen.getByRole("link", { name: "Open second" }))
    expect(screen.getByRole("heading", { name: "Second Game" })).toBeTruthy()
    await waitFor(() => expect(detail).toHaveBeenCalledWith([
      { sourceId: "steamrip", sourceSlug: "second-game" },
    ]))
  })
})
