import { beforeEach, describe, expect, it } from "vitest"
import { getPlayLater, isPlayLater, togglePlayLater } from "@/lib/play-later"

const game: UnifiedSourceGame = {
  dedupKey: "steam:123",
  steamAppId: 123,
  title: "Portal",
  description: "Stored detail that the list does not need",
  sources: [{
    sourceId: "gog",
    sourceSlug: "portal",
    sourceUrl: "https://example.test/portal",
    steamAppId: 123,
    dedupKey: "steam:123",
    title: "Portal",
    downloadOptions: [{ label: "Download", hostType: "direct", url: "https://example.test/file", resolvable: true }],
  }],
  fullyResolved: true,
}

describe("play later", () => {
  beforeEach(() => localStorage.clear())

  it("persists a lightweight game summary and toggles it off", () => {
    expect(togglePlayLater(game)).toBe(true)
    expect(isPlayLater(game.dedupKey)).toBe(true)
    expect(getPlayLater()).toMatchObject([{
      game: {
        dedupKey: game.dedupKey,
        title: game.title,
        sources: [{ sourceId: "gog", sourceSlug: "portal" }],
      },
    }])
    expect(getPlayLater()[0].game.description).toBeUndefined()
    expect(getPlayLater()[0].game.sources[0].downloadOptions).toBeUndefined()

    expect(togglePlayLater(game)).toBe(false)
    expect(getPlayLater()).toEqual([])
  })
})
