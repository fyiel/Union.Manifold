import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  collectDownloadEntries,
  forgetRememberedGame,
  getSourceDetail,
  getRememberedGame,
  hostFriendliness,
  orderSourcesByPreference,
  pickPrimaryDownload,
  rememberGames,
  resolveInstalledGame,
  applySavedSourceSettings,
  loadDisabledSources,
  loadSourcePriority,
  nextSourceRequestId,
  sourceAbbr,
  sourceDirect,
  sourceIsDirect,
  sourceName,
  sourceRank,
  startBestDownload,
  unifiedToGame,
  type DownloadEntry,
} from "@/lib/sources"

describe("source request ids", () => {
  it("allocates globally unique increasing ids across mounted pages", () => {
    const first = nextSourceRequestId()
    expect(nextSourceRequestId()).toBe(first + 1)
  })
})

function opt(hostType: string, resolvable: boolean, url = `https://${hostType}.example/f`): SourceDownloadOption {
  return { label: hostType, hostType, url, resolvable }
}

function src(sourceId: string, options: SourceDownloadOption[]): SourceGame {
  return {
    sourceId,
    sourceSlug: "slug",
    sourceUrl: "https://example.com",
    dedupKey: "k",
    title: "Game",
    genres: [],
    downloadOptions: options,
  } as SourceGame
}

function unified(over: Partial<UnifiedSourceGame> = {}): UnifiedSourceGame {
  return {
    dedupKey: "steam:620",
    title: "Portal 2",
    genres: ["Puzzle"],
    sources: [],
    ...over,
  } as UnifiedSourceGame
}

describe("host friendliness ordering", () => {
  it("ranks ucfiles friendliest, pixeldrain second, gofile third", () => {
    expect(hostFriendliness("ucfiles")).toBe(0)
    expect(hostFriendliness("pixeldrain")).toBeGreaterThan(hostFriendliness("ucfiles"))
    expect(hostFriendliness("gofile")).toBeGreaterThan(hostFriendliness("pixeldrain"))
    expect(hostFriendliness("gofile")).toBeLessThan(hostFriendliness("megadb"))
  })

  it("unknown hosts sit between natives and gated hosts", () => {
    const unknown = hostFriendliness("randomhost")
    expect(unknown).toBeGreaterThan(hostFriendliness("gofile"))
    expect(unknown).toBeLessThan(hostFriendliness("megadb"))
  })
})

describe("pickPrimaryDownload", () => {
  it("prefers the friendliest resolvable host over source order", () => {
    const entries: DownloadEntry[] = [
      { source: src("a", []), option: opt("gofile", true) },
      { source: src("b", []), option: opt("pixeldrain", true) },
      { source: src("c", []), option: opt("megadb", true) },
    ]
    expect(pickPrimaryDownload(entries)?.option.hostType).toBe("pixeldrain")
  })

  it("falls back to the first entry when nothing resolves in-app", () => {
    const entries: DownloadEntry[] = [
      { source: src("a", []), option: opt("mega", false) },
      { source: src("b", []), option: opt("other", false) },
    ]
    expect(pickPrimaryDownload(entries)?.option.hostType).toBe("mega")
    expect(pickPrimaryDownload([])).toBeNull()
  })
})

describe("collectDownloadEntries", () => {
  it("keeps source order but floats resolvable options first within a source", () => {
    const a = src("steamrip", [opt("mega", false), opt("pixeldrain", true)])
    const b = src("gamebounty", [opt("gofile", true)])
    const entries = collectDownloadEntries([a, b])
    expect(entries.map((e) => e.option.hostType)).toEqual(["pixeldrain", "mega", "gofile"])
  })
})

describe("source ordering helpers", () => {
  it("orders by priority list and keeps insertion order for ties", () => {
    const list = [
      { sourceId: "kaoskrew" },
      { sourceId: "unioncrax" },
      { sourceId: "notreal-1" },
      { sourceId: "notreal-2" },
      { sourceId: "steamrip" },
    ]
    const ordered = orderSourcesByPreference(list).map((s) => s.sourceId)
    expect(ordered).toEqual(["unioncrax", "steamrip", "kaoskrew", "notreal-1", "notreal-2"])
  })

  it("unknown sources rank after every known source", () => {
    expect(sourceRank("nonsense")).toBeGreaterThan(sourceRank("kaoskrew"))
  })

  it("name and abbr helpers fall back gracefully", () => {
    expect(sourceName("steamrip")).toBe("SteamRIP")
    expect(sourceName("mystery")).toBe("mystery")
    expect(sourceAbbr("steamrip")).toBe("SR")
    expect(sourceAbbr("mystery")).toBe("MY")
    expect(sourceDirect("steamrip")).toBe(true)
    expect(sourceDirect("unheard-of")).toBe(true)
  })

  it("keeps direct-download badges on compact browse summaries", () => {
    expect(sourceIsDirect({ ...src("steamrip", []), direct: true })).toBe(true)
  })
})

describe("source settings migration", () => {
  it("replaces retired RexaGames ids without losing saved order or disabled state", async () => {
    const get = vi.fn(async (key: string) => (
      key === "gv_source_priority"
        ? ["steamrip", "rexagames", "unioncrax"]
        : ["rexagames"]
    ))
    window.ucSettings = {
      get,
      set: vi.fn(async () => ({ ok: true })),
      clearAll: vi.fn(async () => ({ ok: true })),
      onChanged: vi.fn(() => () => {}),
    }

    expect((await loadSourcePriority()).slice(0, 3)).toEqual(["steamrip", "zeigames", "unioncrax"])
    expect(await loadDisabledSources()).toEqual(["zeigames"])
  })

  it("shares concurrent setting reads and skips already-applied source writes", async () => {
    let release: (value: string[]) => void = () => {}
    const get = vi.fn(() => new Promise<string[]>((resolve) => { release = resolve }))
    const setEnabled = vi.fn(async () => ({ ok: true }))
    window.ucSettings = { get } as any
    window.ucSources = {
      list: vi.fn(async () => ({
        ok: true,
        sources: [
          { id: "steamrip", enabled: true },
          { id: "zeigames", enabled: false },
        ],
      })),
      setEnabled,
    } as any

    const first = loadDisabledSources()
    const second = loadDisabledSources()
    expect(first).toBe(second)
    expect(get).toHaveBeenCalledTimes(1)
    release(["zeigames"])
    await Promise.all([first, second, applySavedSourceSettings()])

    expect(setEnabled).not.toHaveBeenCalled()
  })
})

describe("unifiedToGame", () => {
  it("maps the unified record into the legacy Game shape", () => {
    const g = unifiedToGame(
      unified({
        steamAppId: 620,
        description: "d",
        sizeText: "20 GB",
        sizeBytes: 21474836480,
        developer: "Valve",
        sources: [src("steamrip", []), src("gamebounty", [])],
      })
    )
    expect(g.appid).toBe("steam:620")
    expect(g.name).toBe("Portal 2")
    expect(g.size).toBe("20 GB")
    expect(g.developer).toBe("Valve")
    expect(g.source).toBe("steamrip+gamebounty")
    expect(g.image).toBe("./fallbacks/game-card-3x4.svg")
  })
})

describe("remembered games cache", () => {
  it("remembers, retrieves and forgets by dedup key", () => {
    const g = unified({ dedupKey: "title:some game" })
    rememberGames([g])
    expect(getRememberedGame("title:some game")?.title).toBe("Portal 2")
    forgetRememberedGame("title:some game")
    expect(getRememberedGame("title:some game")).toBeUndefined()
  })
})

describe("detail request sharing", () => {
  it("reuses one in-flight native detail request and releases it afterward", async () => {
    let release: (value: { ok: true; game: null }) => void = () => {}
    const detail = vi.fn()
      .mockImplementationOnce(() => new Promise<{ ok: true; game: null }>((resolve) => { release = resolve }))
      .mockResolvedValue({ ok: true, game: null })
    ;(window as any).ucSources = { detail }
    const stubs = [{ sourceId: "steamrip", sourceSlug: "instant-game" }]

    const first = getSourceDetail(stubs)
    const second = getSourceDetail(stubs)
    expect(first).toBe(second)
    expect(detail).toHaveBeenCalledTimes(1)

    release({ ok: true, game: null })
    await Promise.all([first, second])
    await getSourceDetail(stubs)
    expect(detail).toHaveBeenCalledTimes(2)
    ;(window as any).ucSources = undefined
  })

  it("releases a rejected request so the next attempt can retry", async () => {
    const detail = vi.fn()
      .mockRejectedValueOnce(new Error("temporary scrape failure"))
      .mockResolvedValue({ ok: true, game: null })
    ;(window as any).ucSources = { detail }
    const stubs = [{ sourceId: "steamrip", sourceSlug: "retry-game" }]

    await expect(getSourceDetail(stubs)).rejects.toThrow("temporary scrape failure")
    await getSourceDetail(stubs)

    expect(detail).toHaveBeenCalledTimes(2)
    ;(window as any).ucSources = undefined
  })
})

describe("installed-game resolution sharing", () => {
  it("coalesces the complete search and detail chain", async () => {
    let releaseSearch: (value: { ok: true; games: UnifiedSourceGame[] }) => void = () => {}
    const search = vi.fn()
      .mockImplementationOnce(() => new Promise<{ ok: true; games: UnifiedSourceGame[] }>((resolve) => { releaseSearch = resolve }))
      .mockResolvedValue({ ok: true, games: [] })
    ;(window as any).ucSources = { search }

    const first = resolveInstalledGame("local-shared", "Shared Game")
    const second = resolveInstalledGame("local-shared", "Shared Game")

    expect(first).toBe(second)
    expect(search).toHaveBeenCalledTimes(1)
    releaseSearch({ ok: true, games: [] })
    await Promise.all([first, second])

    await resolveInstalledGame("local-shared", "Shared Game")
    expect(search).toHaveBeenCalledTimes(2)
    ;(window as any).ucSources = undefined
  })
})

describe("startBestDownload fallback chain", () => {
  beforeEach(() => {
    ;(window as any).ucSources = undefined
    ;(window as any).ucDownloads = undefined
    ;(window as any).ucSettings = undefined
  })

  it("tries friendlier hosts first and queues the first that resolves", async () => {
    const resolve = vi.fn(async (_sourceId: string, option: SourceDownloadOption) => {
      if (option.hostType === "pixeldrain") return { ok: true, result: { resolvable: false, openUrl: option.url, reason: "down" } }
      return { ok: true, result: { resolvable: true, url: "https://direct.example/file.zip", fileName: "file.zip" } }
    })
    const start = vi.fn(async () => ({ ok: true }))
    ;(window as any).ucSources = { resolve }
    ;(window as any).ucDownloads = { start, saveInstalledMetadata: vi.fn(async () => ({ ok: true })) }
    ;(window as any).ucSettings = { set: vi.fn(async () => ({ ok: true })) }

    const entries: DownloadEntry[] = [
      { source: src("a", []), option: opt("gofile", true) },
      { source: src("b", []), option: opt("pixeldrain", true) },
    ]
    const res = await startBestDownload(unified(), entries)
    expect(res.ok).toBe(true)
    expect(resolve.mock.calls[0][1].hostType).toBe("pixeldrain")
    expect(resolve.mock.calls[1][1].hostType).toBe("gofile")
    expect(start).toHaveBeenCalledTimes(1)
    expect(start.mock.calls[0][0].url).toBe("https://direct.example/file.zip")
  })

  it("reports a browser fallback url when every source fails", async () => {
    const resolve = vi.fn(async (_s: string, option: SourceDownloadOption) => ({
      ok: true,
      result: { resolvable: false, openUrl: option.url, reason: "nope" },
    }))
    ;(window as any).ucSources = { resolve }

    const entries: DownloadEntry[] = [
      { source: src("a", []), option: opt("pixeldrain", true) },
      { source: src("b", []), option: opt("mega", false, "https://mega.nz/f") },
    ]
    const res = await startBestDownload(unified(), entries)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.openUrl).toBe("https://pixeldrain.example/f")
      expect(res.reason).toContain("1 in-app source")
    }
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it("does not open a browser fallback after verification is cancelled", async () => {
    const resolve = vi.fn(async () => ({
      ok: true,
      result: { resolvable: false, cancelled: true, reason: "download verification cancelled" },
    }))
    ;(window as any).ucSources = { resolve }

    const entries: DownloadEntry[] = [
      { source: src("a", []), option: opt("fileq", true) },
      { source: src("b", []), option: opt("datavaults", true) },
    ]
    const res = await startBestDownload(unified(), entries)
    expect(res).toEqual({
      ok: false,
      cancelled: true,
      reason: "download verification cancelled",
    })
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it("downloads every part of a multi-file resolution", async () => {
    const resolve = vi.fn(async () => ({
      ok: true,
      result: {
        resolvable: true,
        files: [
          { url: "https://d.example/part1.rar" },
          { url: "https://d.example/part2.rar" },
        ],
      },
    }))
    const start = vi.fn(async () => ({ ok: true }))
    ;(window as any).ucSources = { resolve }
    ;(window as any).ucDownloads = { start, saveInstalledMetadata: vi.fn(async () => ({ ok: true })) }
    ;(window as any).ucSettings = { set: vi.fn(async () => ({ ok: true })) }

    const entries: DownloadEntry[] = [{ source: src("a", []), option: opt("gofile", true) }]
    const res = await startBestDownload(unified(), entries)
    expect(res.ok).toBe(true)
    expect(start).toHaveBeenCalledTimes(2)
    expect(start.mock.calls[0][0].partIndex).toBe(1)
    expect(start.mock.calls[0][0].partTotal).toBe(2)
    expect(start.mock.calls[1][0].partIndex).toBe(2)
  })
})
