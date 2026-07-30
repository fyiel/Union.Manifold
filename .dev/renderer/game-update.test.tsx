import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SourceGamePage } from "@/app/pages/SourceGamePage"
import { forgetRememberedGame, rememberGames } from "@/lib/sources"

vi.mock("@/context/downloads-context", () => ({
  useDownloadsSelector: <T,>(selector: (downloads: []) => T) => selector([]),
}))

vi.mock("@/context/game-launch-context", () => ({
  useGameLaunch: () => ({ requestLaunch: vi.fn() }),
}))

describe("installed game updates", () => {
  afterEach(() => {
    forgetRememberedGame("update-game")
    vi.restoreAllMocks()
  })

  it("queues the current catalog build over an older installation", async () => {
    const start = vi.fn(async () => ({ ok: true }))
    Object.defineProperty(window, "ucDownloads", {
      configurable: true,
      value: {
        listInstalledGlobal: vi.fn(async () => [{ appid: "update-game", metadata: { version: "1.0" } }]),
        saveInstalledMetadata: vi.fn(async () => ({ ok: true })),
        start,
      },
    })
    Object.defineProperty(window, "ucSources", {
      configurable: true,
      value: {
        resolve: vi.fn(async () => ({
          ok: true,
          result: { resolvable: true, url: "https://cdn.example/game-2.zip", fileName: "game-2.zip" },
        })),
      },
    })
    Object.defineProperty(window, "ucSettings", {
      configurable: true,
      value: { get: vi.fn(async () => null), set: vi.fn(async () => ({ ok: true })) },
    })
    rememberGames([{
      dedupKey: "update-game",
      title: "Update Game",
      version: "2.0",
      genres: [],
      fullyResolved: true,
      sources: [{
        sourceId: "steamrip",
        sourceSlug: "update-game",
        sourceUrl: "https://example.com/update-game",
        dedupKey: "update-game",
        title: "Update Game",
        genres: [],
        downloadOptions: [{ label: "ZIP", hostType: "pixeldrain", url: "https://example.com/file", resolvable: true }],
      }],
    } as UnifiedSourceGame])

    render(
      <MemoryRouter initialEntries={["/g/update-game"]}>
        <Routes><Route path="/g/:key" element={<SourceGamePage />} /></Routes>
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole("button", { name: /Update/ }))
    await waitFor(() => expect(start).toHaveBeenCalledWith(expect.objectContaining({
      appid: "update-game",
      url: "https://cdn.example/game-2.zip",
    })))
  })
})
