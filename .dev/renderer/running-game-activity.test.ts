import { waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { setRunningOptimistic } from "@/hooks/use-running-games"

describe("library game activity", () => {
  afterEach(() => vi.restoreAllMocks())

  it("records the launch time and adds elapsed play time on exit", async () => {
    let metadata: unknown = { "activity-test": { collections: ["Favorites"], playTimeMs: 30_000 } }
    const set = vi.fn(async (_key: string, value: unknown) => {
      metadata = value
      return { ok: true }
    })
    Object.defineProperty(window, "ucSettings", {
      configurable: true,
      value: {
        get: vi.fn(async () => metadata),
        set,
      },
    })

    let now = 1_000
    vi.spyOn(Date, "now").mockImplementation(() => now)
    setRunningOptimistic("activity-test", true)
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1))
    expect(metadata).toMatchObject({
      "activity-test": { collections: ["Favorites"], lastPlayedAt: 1_000, playTimeMs: 30_000 },
    })

    now = 61_000
    setRunningOptimistic("activity-test", false)
    await waitFor(() => expect(set).toHaveBeenCalledTimes(2))
    expect(metadata).toMatchObject({
      "activity-test": { collections: ["Favorites"], lastPlayedAt: 1_000, playTimeMs: 90_000 },
    })
  })
})
