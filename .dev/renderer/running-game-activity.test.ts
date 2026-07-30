import { waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { setRunningOptimistic } from "@/hooks/use-running-games"

describe("library game activity", () => {
  afterEach(() => vi.restoreAllMocks())

  it("records the launch time and adds elapsed play time on exit", async () => {
    let metadata: Record<string, Record<string, unknown>> = {
      "activity-test": { collections: ["Favorites"], playTimeMs: 30_000 },
    }
    const merge = vi.fn(async (
      appid: string,
      patch: Record<string, unknown>,
      playTimeDeltaMs = 0,
    ) => {
      const current = metadata[appid] || {}
      const entry = { ...current, ...patch }
      if (playTimeDeltaMs > 0) {
        entry.playTimeMs = Number(current.playTimeMs || 0) + playTimeDeltaMs
      }
      metadata = { ...metadata, [appid]: entry }
      return { ok: true, entry }
    })
    let presenceChanged: ((detail: {
      reason?: string
      appid?: string | null
      startedAt?: number
      activityRecorded?: boolean
    }) => void) | undefined
    Object.defineProperty(window, "ucPresence", {
      configurable: true,
      value: {
        onChanged: (handler: typeof presenceChanged) => {
          presenceChanged = handler
          return () => undefined
        },
      },
    })
    Object.defineProperty(window, "ucSettings", {
      configurable: true,
      value: { mergeLibraryGameMeta: merge },
    })

    let now = 1_000
    vi.spyOn(Date, "now").mockImplementation(() => now)
    setRunningOptimistic("activity-test", true)
    await waitFor(() => expect(merge).toHaveBeenCalledTimes(1))
    expect(metadata).toMatchObject({
      "activity-test": { collections: ["Favorites"], lastPlayedAt: 1_000, playTimeMs: 30_000 },
    })

    now = 61_000
    presenceChanged?.({ reason: "game-exited", appid: "activity-test" })
    await waitFor(() => expect(merge).toHaveBeenCalledTimes(2))
    expect(metadata).toMatchObject({
      "activity-test": { collections: ["Favorites"], lastPlayedAt: 1_000, playTimeMs: 90_000 },
    })
  })
})
