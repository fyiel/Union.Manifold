import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Play, Square, Settings, ArrowUpDown, LayoutGrid, List, Inbox, Plus } from "lucide-react"
import { useGamesData } from "@/hooks/use-games"
import { useGameLaunch } from "@/context/game-launch-context"
import { useRunningGame } from "@/hooks/use-running-games"
import { useDownloadsSelector } from "@/context/downloads-context"
import { useTabVisible } from "@/context/tab-visibility"
import { hasInstalledVersionUpdate, proxyImageUrl } from "@/lib/utils"
import { rememberGames, rememberGameAs, getRememberedGame, resolveInstalledGame, getDownloadArt, hydrateDownloadArt, steamCoverUrl } from "@/lib/sources"
import { MONO, COVER_LINES, gbLabel, SearchIcon, CenterState } from "@/app/manifold/ui"
import { GameMenu, LaunchOptionsDialog, EditDetailsDialog, LinuxConfigDialog, AddGamesDialog, type MenuGame } from "@/app/manifold/library-overlays"

const IS_LINUX = typeof navigator !== "undefined" && /linux/i.test(navigator.userAgent)

// Library, installed games (local manifests via window.ucDownloads), with an
// "installing" strip fed by the live download queue. Search, filter pills (All /
// Favorites / Recently played / Updates), a sort cycle, grid/list views, and a
// Play button per game. The old page's collections / batch-select / uninstall /
// shortcuts / Linux config are intentionally not here (see the "missing screens"
// handoff list). Playtime isn't tracked yet, so the playtime column reads as
// size / last played instead.

type LibGame = {
  appid: string
  name: string
  image?: string
  sizeBytes?: number
  sizeText?: string
  version?: string
  installedAt?: number
  collections: string[]
  lastPlayedAt?: number
  steamAppId?: number
  installType?: string
}

type LibraryGameMeta = { collections?: string[]; lastPlayedAt?: number }
// Full resolved game info for a library entry, keyed by install appid and
// stamped with cachedAt. Persisted so the card cover AND the detail page open
// instantly across restarts without re-resolving. Entries older than the TTL
// are treated as a miss and re-resolved.
type CachedGame = { cachedAt: number; game: UnifiedSourceGame }
const GAME_CACHE_KEY = "libraryGameCache"
const GAME_CACHE_TTL_MS = 3 * 60 * 60 * 1000 // 3 hours

type FilterKey = "All" | "Favorites" | "Recently played" | "Updates"
const FILTERS: FilterKey[] = ["All", "Favorites", "Recently played", "Updates"]
type SortMode = "recent" | "a-z" | "installed"
const SORT_CYCLE: SortMode[] = ["recent", "a-z", "installed"]
const SORT_LABEL: Record<SortMode, string> = { recent: "Recent", "a-z": "A–Z", installed: "Installed" }
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

function lastPlayedLabel(ms?: number): string {
  if (!ms) return "—"
  const days = Math.floor((Date.now() - ms) / 86_400_000)
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

function entryToLib(entry: any, meta: Record<string, LibraryGameMeta>): LibGame | null {
  const m = entry?.metadata || {}
  const appid = String(entry?.appid || m.appid || "")
  if (!appid) return null
  const gm = meta[appid] || {}
  // Our own installs derive their id from the dedup key, so steam-<digits> IS
  // the Steam appid even when the manifest predates metadata stamping. It buys
  // a CDN cover for the card and full art/meta on the detail page.
  const steamAppId =
    typeof entry?.steamAppId === "number" ? entry.steamAppId
    : typeof m.steamAppId === "number" ? m.steamAppId
    : (() => { const p = /^steam-(\d+)$/.exec(appid); return p ? Number(p[1]) : undefined })()
  const image = m.image && m.image !== "./fallbacks/game-card-3x4.svg" ? m.image : undefined
  return {
    appid,
    name: m.name || entry?.name || appid,
    image: image || (steamAppId ? steamCoverUrl(steamAppId) : undefined),
    sizeBytes: typeof m.sizeBytes === "number" ? m.sizeBytes : undefined,
    sizeText: m.size || undefined,
    version: m.version || undefined,
    installedAt: typeof entry?.installedAt === "number" ? entry.installedAt : typeof m.installedAt === "number" ? m.installedAt : undefined,
    collections: Array.isArray(gm.collections) ? gm.collections : [],
    lastPlayedAt: typeof gm.lastPlayedAt === "number" ? gm.lastPlayedAt : undefined,
    steamAppId,
    installType: typeof entry?.installType === "string" ? entry.installType : undefined,
  }
}

function InstallingStrip({ installingMeta, installedIds, filter, query }: { installingMeta: Array<{ appid: string; name: string; image?: string; status?: string }>; installedIds: Set<string>; filter: string; query: string }) {
  // Live download state (real-time) drives the strip so a game shows the moment
  // it starts downloading, not only once extraction begins. Merged with the
  // backend installing snapshot for states the live queue may not hold (e.g. a
  // "downloaded, awaiting extract" item restored after a restart).
  // Frozen while the tab is hidden: equality claims "unchanged" so the ~5/s
  // progress flushes never re-render the hidden Library tab. Flipping back to
  // visible re-renders via the context change, and that render re-reads the
  // store snapshot, so catch-up is free. The ref keeps even a stale equality
  // closure reading the CURRENT visibility.
  const visible = useTabVisible()
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  // Progress is quantized in the selector itself (integer percent, speed to
  // 0.1 MB/s) so byte-level ticks that wouldn't move the rendered strip
  // compare equal and re-render nothing.
  const live = useDownloadsSelector(
    (downloads) => downloads.map((d) => ({
      appid: d.appid,
      name: d.gameName,
      status: d.status,
      pct: d.totalBytes > 0 ? Math.min(100, Math.round((d.receivedBytes / d.totalBytes) * 100)) : 0,
      total: d.totalBytes,
      speed: d.speedBps ? Math.round((d.speedBps / 1e6) * 10) / 10 : 0,
      extract: typeof d.extractProgress === "number" ? Math.min(100, Math.max(0, Math.round(d.extractProgress))) : null,
    })),
    (a, b) => !visibleRef.current || (a.length === b.length && a.every((x, i) => x.appid === b[i].appid && x.name === b[i].name && x.status === b[i].status && x.pct === b[i].pct && x.total === b[i].total && x.speed === b[i].speed && x.extract === b[i].extract)),
  )

  const installing = useMemo(() => {
    const byId = new Map<string, { name?: string; pct: number; total: number; status: string; speed: number; extract: number | null }>()
    for (const p of live) {
      if (!p.appid) continue
      const cur = byId.get(p.appid)
      // pct·total ≈ received bytes, so the most-advanced duplicate entry still
      // wins without carrying raw byte counts through the selector.
      if (!cur || p.pct * p.total > cur.pct * cur.total) byId.set(p.appid, { name: p.name, pct: p.pct, total: p.total, status: String(p.status), speed: p.speed, extract: p.extract })
    }
    const metaById = new Map(installingMeta.map((g) => [g.appid, g]))
    const ids = new Set<string>([...byId.keys(), ...metaById.keys()])
    const out: Array<{ appid: string; name: string; image?: string; pct: number; status: string }> = []
    for (const appid of ids) {
      if (!appid) continue
      const p = byId.get(appid)
      const m = metaById.get(appid)
      const st = p?.status || m?.status || "queued"
      const extracting = st === "extracting" || st === "installing"
      const done = ["completed", "extracted", "installed", "cancelled", "failed", "extract_failed"].includes(st)
      if (done || installedIds.has(appid)) continue
      const pct = extracting
        ? (typeof p?.extract === "number" ? p.extract : 100)
        : p ? p.pct : 0
      const speed = p?.speed ? `${p.speed.toFixed(1)} MB/s` : ""
      const status = extracting ? "extracting" : st === "downloading" ? `downloading${speed ? ` · ${speed}` : ""}` : st
      const art = getDownloadArt(appid)
      out.push({ appid, name: m?.name || p?.name || art?.title || appid, image: m?.image || art?.image, pct, status })
    }
    return out
  }, [live, installingMeta, installedIds])

  const showInstalling = installing.length > 0 && filter === "All" && !query.trim()
  if (!showInstalling) return null

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--mf-t5)", marginBottom: 10 }}>Installing</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {installing.map((g) => (
          <div key={g.appid} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", border: "1px solid var(--mf-line)", borderRadius: 11, background: "var(--mf-panel-2)" }}>
            <div style={{ width: 38, height: 50, borderRadius: 6, flexShrink: 0, background: g.image ? "#0f0f0f" : COVER_LINES, overflow: "hidden" }}>
              {g.image && <img src={proxyImageUrl(g.image)} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--mf-t0)" }}>{g.name}</span>
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--mf-t4)" }}>{g.status}</span>
                <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10.5, color: "var(--mf-t3)" }}>{g.pct}%</span>
              </div>
              <div style={{ marginTop: 9, height: 4, borderRadius: 99, background: "color-mix(in srgb, var(--mf-t0) 8%, transparent)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${g.pct}%`, background: "var(--mf-accent)", borderRadius: 99 }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function LibraryPage() {
  const { games: catalog } = useGamesData()
  const { requestLaunch, requestSetExecutable, stopGame } = useGameLaunch()
  const navigate = useNavigate()

  const [installed, setInstalled] = useState<LibGame[]>([])
  const [installingMeta, setInstallingMeta] = useState<Array<{ appid: string; name: string; image?: string; status?: string }>>([])
  const [meta, setMeta] = useState<Record<string, LibraryGameMeta>>({})
  const [loading, setLoading] = useState(true)
  const gameCacheRef = useRef<Record<string, CachedGame>>({})

  // Card action menu + dialog targets. menu carries the anchor rect so it can
  // open beside the cog and flip when it would overflow.
  const [menu, setMenu] = useState<{ game: MenuGame; anchor: DOMRect } | null>(null)
  const [launchFor, setLaunchFor] = useState<{ appid: string; name: string } | null>(null)
  const [editFor, setEditFor] = useState<MenuGame | null>(null)
  const [linuxFor, setLinuxFor] = useState<{ appid: string; name: string } | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<FilterKey>("All")
  // View + sort survive restarts, remembering the last choice.
  const [sort, setSortState] = useState<SortMode>(() => {
    try { const v = localStorage.getItem("uc_library_sort"); if (v === "recent" || v === "a-z" || v === "installed") return v } catch { /* ignore */ }
    return "recent"
  })
  const [view, setViewState] = useState<"grid" | "list">(() => {
    try { const v = localStorage.getItem("uc_library_view"); if (v === "grid" || v === "list") return v } catch { /* ignore */ }
    return "grid"
  })
  const setSort = (v: SortMode | ((prev: SortMode) => SortMode)) => {
    setSortState((prev) => {
      const next = typeof v === "function" ? v(prev) : v
      try { localStorage.setItem("uc_library_sort", next) } catch { /* ignore */ }
      return next
    })
  }
  const setView = (v: "grid" | "list") => {
    setViewState(v)
    try { localStorage.setItem("uc_library_view", v) } catch { /* ignore */ }
  }

  // Load installed + installing manifests + library meta.
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        await hydrateDownloadArt()
        const [value, gcValue] = await Promise.all([
          window.ucSettings?.get?.("libraryGameMeta"),
          window.ucSettings?.get?.(GAME_CACHE_KEY),
        ])
        const m = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, LibraryGameMeta>) : {}
        const gc = gcValue && typeof gcValue === "object" && !Array.isArray(gcValue) ? (gcValue as Record<string, CachedGame>) : {}
        gameCacheRef.current = gc
        if (!alive) return
        setMeta(m)
        const [installedList, installingList] = await Promise.all([
          window.ucDownloads?.listInstalledGlobal?.() || window.ucDownloads?.listInstalled?.() || [],
          window.ucDownloads?.listInstallingGlobal?.() || window.ucDownloads?.listInstalling?.() || [],
        ])
        if (!alive) return
        const now = Date.now()
        const seen = new Set<string>()
        const games: LibGame[] = []
        for (const e of installedList as any[]) {
          const g = entryToLib(e, m)
          if (!g || seen.has(g.appid)) continue
          seen.add(g.appid)
          // A fresh cache entry seeds the in-memory remembered game (so detail
          // opens instantly) and fills any card fields the manifest lacked. No
          // blank flash, no re-running the search until the entry expires.
          const c = gc[g.appid]
          const fresh = c && c.game && now - (c.cachedAt || 0) < GAME_CACHE_TTL_MS ? c.game : null
          if (fresh) {
            rememberGames([fresh])
            rememberGameAs(g.appid, fresh)
            if (!g.image && fresh.image) g.image = fresh.image
            if ((!g.name || g.name === g.appid) && fresh.title) g.name = fresh.title
            if (!g.sizeText && fresh.sizeText) g.sizeText = fresh.sizeText
            if (g.sizeBytes == null && fresh.sizeBytes != null) g.sizeBytes = fresh.sizeBytes
          }
          games.push(g)
        }
        setInstalled(games)
        setInstallingMeta((installingList as any[]).map((e) => {
          const g = entryToLib(e, m)
          return g ? { appid: g.appid, name: g.name, image: g.image || getDownloadArt(g.appid)?.image, status: e?.installStatus } : null
        }).filter(Boolean) as Array<{ appid: string; name: string; image?: string; status?: string }>)
      } finally {
        if (alive) setLoading(false)
      }
    }
    void load()
    // Multi-part installs fire uc_game_installed once per part; a full load()
    // costs 2 settings IPCs + both manifest lists + art hydration, so coalesce
    // bursts to one trailing-edge reload.
    let reloadTimer: number | undefined
    const refresh = () => {
      window.clearTimeout(reloadTimer)
      reloadTimer = window.setTimeout(() => { void load() }, 300)
    }
    window.addEventListener("uc_game_installed", refresh)
    return () => {
      alive = false
      window.clearTimeout(reloadTimer)
      window.removeEventListener("uc_game_installed", refresh)
    }
  }, [])

  // Resolve and cache the FULL game info for every library entry whose cache is
  // missing or older than the TTL. A fresh cache hit is skipped, we never
  // re-resolve a game we still have. UnionCrax internal-id installs (and the
  // ORIGINAL UC.Direct's numeric appids) resolve precisely by appid, while
  // steam-<id> installs fall back to a cross-source title search inside
  // resolveInstalledGame, title search stays a last resort. Bounded concurrency,
  // result cached for both the card cover and an instant detail open.
  const enrichTried = useRef<Set<string>>(new Set())
  useEffect(() => {
    const now = Date.now()
    const targets = installed.filter((g) => {
      // Imported executables aren't store games; a title search on an exe stem
      // would attach a random catalog game's art/metadata. Never enrich them.
      if (g.appid.startsWith("local-")) return false
      if (enrichTried.current.has(g.appid)) return false
      const c = gameCacheRef.current[g.appid]
      return !(c && c.game && now - (c.cachedAt || 0) < GAME_CACHE_TTL_MS)
    })
    if (!targets.length) return
    // Mark up front so StrictMode's double-invoke (and any length change) can't
    // double-fetch. We deliberately do NOT gate the result on an alive flag: the
    // component instance survives StrictMode's setup/cleanup/setup so setInstalled
    // lands, and after a real unmount it is a harmless no-op in React 19. A failed
    // resolve un-marks the appid so a later load can retry it.
    targets.forEach((g) => enrichTried.current.add(g.appid))
    void (async () => {
      const CONC = 4
      for (let i = 0; i < targets.length; i += CONC) {
        // Accumulate the batch's results and apply them in ONE setInstalled so
        // N games cost ceil(N/4) list updates, not N full-list re-renders.
        const resolved = new Map<string, UnifiedSourceGame>()
        await Promise.all(targets.slice(i, i + CONC).map(async (g) => {
          try {
            const full = await resolveInstalledGame(g.appid, g.name)
            if (!full) { enrichTried.current.delete(g.appid); return }
            rememberGames([full])
            rememberGameAs(g.appid, full)
            gameCacheRef.current[g.appid] = { cachedAt: Date.now(), game: full }
            resolved.set(g.appid, full)
          } catch { enrichTried.current.delete(g.appid) }
        }))
        if (resolved.size) {
          setInstalled((prev) => prev.map((x) => {
            const full = resolved.get(x.appid)
            if (!full) return x
            return {
              ...x,
              name: (!x.name || x.name === x.appid) ? (full.title || x.name) : x.name,
              image: x.image || full.image || undefined,
              sizeText: x.sizeText || full.sizeText || undefined,
              sizeBytes: x.sizeBytes ?? full.sizeBytes,
            }
          }))
          // Persist after each batch so a resolved game survives restarts
          // (within the TTL) for both the card and an instant detail open.
          void window.ucSettings?.set?.(GAME_CACHE_KEY, { ...gameCacheRef.current })
        }
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installed.length])

  // appid → catalog version, for the update badge/filter.
  const updates = useMemo(() => {
    const byId = new Map(catalog.map((g) => [g.appid, g.version || ""]))
    const set = new Set<string>()
    for (const g of installed) {
      const cv = byId.get(g.appid)
      if (cv && g.version && hasInstalledVersionUpdate(cv, [g.version])) set.add(g.appid)
    }
    return set
  }, [catalog, installed])

  const counts = useMemo<Record<FilterKey, number>>(() => ({
    All: installed.length,
    Favorites: installed.filter((g) => g.collections.some((c) => c.toLowerCase() === "favorites")).length,
    "Recently played": installed.filter((g) => g.lastPlayedAt && Date.now() - g.lastPlayedAt <= RECENT_WINDOW_MS).length,
    Updates: updates.size,
  }), [installed, updates])

  const totalBytes = useMemo(() => installed.reduce((n, g) => n + (g.sizeBytes || 0), 0), [installed])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    let arr = installed.filter((g) => {
      if (filter === "Favorites" && !g.collections.some((c) => c.toLowerCase() === "favorites")) return false
      if (filter === "Recently played" && !(g.lastPlayedAt && Date.now() - g.lastPlayedAt <= RECENT_WINDOW_MS)) return false
      if (filter === "Updates" && !updates.has(g.appid)) return false
      if (q && !g.name.toLowerCase().includes(q)) return false
      return true
    })
    arr = [...arr]
    if (sort === "a-z") arr.sort((a, b) => a.name.localeCompare(b.name))
    else if (sort === "installed") arr.sort((a, b) => (b.installedAt || 0) - (a.installedAt || 0) || a.name.localeCompare(b.name))
    else arr.sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0) || a.name.localeCompare(b.name))
    return arr
  }, [installed, query, filter, sort, updates])

  const installedIds = useMemo(() => new Set(installed.map((g) => g.appid)), [installed])

  // Row callbacks are useCallback-stable so the memoized LibCard/LibRow rows
  // bail out of the re-renders the parent takes for keystrokes and enrichment
  // ticks (a fresh closure per row per render would defeat React.memo).
  const play = useCallback((g: LibGame) => void requestLaunch({ appid: g.appid, name: g.name }), [requestLaunch])
  const onStop = useCallback((appid: string) => void stopGame(appid), [stopGame])
  const openDetail = useCallback((g: LibGame) => {
    // Prefer the cached fully-resolved game (seeded from libraryGameCache on load
    // or a just-finished enrichment) so detail opens with no refetch. Otherwise
    // hand the route a minimal record it can hydrate from.
    const cached = getRememberedGame(g.appid)
    const game = cached?.fullyResolved
      ? cached
      : ({ dedupKey: g.appid, steamAppId: g.steamAppId ?? null, title: g.name, image: g.image, sizeBytes: g.sizeBytes, sizeText: g.sizeText, genres: [], sources: [] } as unknown as UnifiedSourceGame)
    if (!cached?.fullyResolved) rememberGames([game])
    // installed:true seeds the detail page so the primary button is "Play" from
    // the first frame (no Download flash) since the library only holds installs.
    navigate(`/g/${encodeURIComponent(g.appid)}`, { state: { game, installed: true } })
  }, [navigate])

  const openMenu = useCallback((g: LibGame, anchorEl: HTMLElement) => setMenu({ game: toMenuGame(g), anchor: anchorEl.getBoundingClientRect() }), [])
  // Right-click path: anchors the menu at the pointer instead of an element.
  const openRowMenuAt = useCallback((g: LibGame, x: number, y: number) => setMenu({ game: toMenuGame(g), anchor: rectFromPoint(x, y) }), [])

  const isFavorite = (appid: string) => (meta[appid]?.collections || []).some((c) => c.toLowerCase() === "favorites")

  const toggleFavorite = (appid: string) => {
    const fav = isFavorite(appid)
    const cur = meta[appid] || {}
    const cols = (cur.collections || []).filter((c) => c.toLowerCase() !== "favorites")
    if (!fav) cols.push("Favorites")
    const next = { ...meta, [appid]: { ...cur, collections: cols } }
    setMeta(next)
    void window.ucSettings?.set?.("libraryGameMeta", next)
    setInstalled((prev) => prev.map((g) => g.appid !== appid ? g : { ...g, collections: fav ? g.collections.filter((c) => c.toLowerCase() !== "favorites") : [...g.collections, "Favorites"] }))
  }

  const getSavedExe = async (appid: string): Promise<string | null> => {
    try { return (await window.ucSettings?.get?.(`gameExe:${appid}`)) || null } catch { return null }
  }

  const openFiles = async (appid: string) => {
    try {
      const result = await window.ucDownloads?.listGameExecutables?.(appid)
      let folder: string | null = result?.folder || null
      const exePath: string | undefined = result?.exes?.[0]?.path
      if (exePath) {
        const dir = exePath.split(/[/\\]+/).slice(0, -1).join("/")
        if (dir && (!folder || dir.toLowerCase().startsWith(folder.toLowerCase()))) folder = dir
      }
      if (folder && window.ucDownloads?.findGameSubfolder) folder = (await window.ucDownloads.findGameSubfolder(folder)) || folder
      if (folder) await window.ucDownloads?.openPath?.(folder)
    } catch { /* ignore */ }
  }

  const setExecutable = async (g: LibGame) => {
    const currentPath = await getSavedExe(g.appid)
    await requestSetExecutable({ appid: g.appid, name: g.name }, { currentPath })
  }

  // Re-resolve one game's metadata on demand, bypassing the cache TTL.
  const refreshMetadata = async (g: LibGame) => {
    if (g.appid.startsWith("local-")) return // imported exe: nothing to resolve
    enrichTried.current.add(g.appid)
    try {
      const full = await resolveInstalledGame(g.appid, g.name)
      if (!full) return
      rememberGames([full])
      rememberGameAs(g.appid, full)
      gameCacheRef.current[g.appid] = { cachedAt: Date.now(), game: full }
      void window.ucSettings?.set?.(GAME_CACHE_KEY, { ...gameCacheRef.current })
      setInstalled((prev) => prev.map((x) => x.appid !== g.appid ? x : { ...x, name: full.title || x.name, image: full.image || x.image, sizeText: full.sizeText || x.sizeText, sizeBytes: full.sizeBytes ?? x.sizeBytes }))
    } catch { /* ignore */ }
  }

  const deleteGame = async (g: LibGame) => {
    setInstalled((prev) => prev.filter((x) => x.appid !== g.appid))
    try {
      await window.ucDownloads?.deleteInstalled?.(g.appid)
      await window.ucDownloads?.deleteDesktopShortcut?.(g.name)
    } catch { /* ignore */ }
  }

  const subtitle = [
    `${installed.length} installed`,
    totalBytes > 0 ? `${gbLabel(totalBytes)} on disk` : null,
    updates.size > 0 ? `${updates.size} with updates` : "no updates",
  ].filter(Boolean).join(" · ")

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* header */}
      <header style={{ flexShrink: 0, padding: "26px 36px 0" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "var(--mf-t0)", letterSpacing: "-0.015em" }}>Library</h1>
            <p style={{ margin: "6px 0 0", fontFamily: MONO, fontSize: 11.5, color: "var(--mf-t4)" }}>{loading ? "loading…" : subtitle}</p>
          </div>
          <div style={{ position: "relative", width: 320 }}>
            <SearchIcon style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)" }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setQuery("") }}
              placeholder="search your library…"
              style={{ width: "100%", height: 40, padding: "0 14px 0 37px", borderRadius: 9, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", color: "var(--mf-t1)", fontFamily: MONO, fontSize: 12.5, outline: "none" }}
            />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 18, borderBottom: "1px solid var(--mf-line)" }}>
          {FILTERS.map((f) => {
            const active = filter === f
            return (
              <button key={f} type="button" onClick={() => setFilter(f)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 14px", borderRadius: 999, fontSize: 12, fontWeight: 500, border: `1px solid ${active ? "var(--mf-line-2)" : "color-mix(in srgb, var(--mf-t0) 9%, transparent)"}`, background: active ? "color-mix(in srgb, var(--mf-t0) 10%, transparent)" : "transparent", color: active ? "var(--mf-t0)" : "var(--mf-t4)", cursor: "pointer", whiteSpace: "nowrap" }}>
                {f}
                <span style={{ fontFamily: MONO, fontSize: 10, color: active ? "var(--mf-t3)" : "var(--mf-t5)" }}>{counts[f]}</span>
              </button>
            )
          })}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
            <button type="button" onClick={() => setAddOpen(true)} className="mf-textbtn" style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 13px", borderRadius: 8, border: "1px solid color-mix(in srgb, var(--mf-t0) 9%, transparent)", background: "transparent", color: "var(--mf-t3)", fontFamily: MONO, fontSize: 11, cursor: "pointer" }}>
              <Plus size={13} strokeWidth={1.6} />
              Add games
            </button>
            <button type="button" onClick={() => setSort((s) => SORT_CYCLE[(SORT_CYCLE.indexOf(s) + 1) % SORT_CYCLE.length])} className="mf-textbtn" style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 13px", borderRadius: 8, border: "1px solid color-mix(in srgb, var(--mf-t0) 9%, transparent)", background: "transparent", color: "var(--mf-t3)", fontFamily: MONO, fontSize: 11, cursor: "pointer" }}>
              <ArrowUpDown size={13} strokeWidth={1.6} />
              {SORT_LABEL[sort]}
            </button>
            <div style={{ display: "flex", gap: 2, padding: 3, borderRadius: 9, border: "1px solid color-mix(in srgb, var(--mf-t0) 9%, transparent)", background: "var(--mf-panel-2)" }}>
              <ViewBtn active={view === "grid"} onClick={() => setView("grid")} title="grid">
                <LayoutGrid size={14} strokeWidth={1.6} />
              </ViewBtn>
              <ViewBtn active={view === "list"} onClick={() => setView("list")} title="list">
                <List size={14} strokeWidth={1.6} />
              </ViewBtn>
            </div>
          </div>
        </div>
      </header>

      {/* scroller */}
      <div className="mf-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "22px 36px 40px" }}>
        <InstallingStrip installingMeta={installingMeta} installedIds={installedIds} filter={filter} query={query} />

        {loading ? null : shown.length === 0 ? (
          <CenterState>
            <Inbox size={30} strokeWidth={1.4} color="var(--mf-t6)" />
            <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--mf-t5)" }}>
              {query.trim() ? `nothing here — “${query.trim()}” matched no installed games` : filter === "All" ? "no games installed yet" : `no games under “${filter}”`}
            </span>
          </CenterState>
        ) : view === "grid" ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))", gap: 18, alignContent: "start" }}>
            {shown.map((g) => (
              <LibCard key={g.appid} game={g} hasUpdate={updates.has(g.appid)} onOpen={openDetail} onContextMenu={openRowMenuAt} onPlay={play} onStop={onStop} onMenu={openMenu} />
            ))}
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "44px minmax(0,1fr) 150px 120px 140px", gap: 14, alignItems: "center", padding: "0 14px 9px", borderBottom: "1px solid var(--mf-line)" }}>
              <span />
              <span style={listHead}>Title</span>
              <span style={listHead}>Size</span>
              <span style={listHead}>Last played</span>
              <span />
            </div>
            <div style={{ display: "flex", flexDirection: "column", paddingTop: 4 }}>
              {shown.map((g) => (
                <LibRow key={g.appid} game={g} hasUpdate={updates.has(g.appid)} onOpen={openDetail} onContextMenu={openRowMenuAt} onPlay={play} onStop={onStop} onMenu={openMenu} />
              ))}
            </div>
          </>
        )}
      </div>

      {menu && (
        <GameMenu
          game={menu.game}
          anchor={menu.anchor}
          handlers={{
            isLinux: IS_LINUX,
            isFavorite: isFavorite(menu.game.appid),
            onOpenFiles: () => void openFiles(menu.game.appid),
            onSetExecutable: () => { const g = installed.find((x) => x.appid === menu.game.appid); if (g) void setExecutable(g) },
            onLinuxConfig: () => setLinuxFor({ appid: menu.game.appid, name: menu.game.name }),
            onLaunchOptions: () => setLaunchFor({ appid: menu.game.appid, name: menu.game.name }),
            onEditDetails: () => setEditFor(menu.game),
            onRefreshMetadata: () => { const g = installed.find((x) => x.appid === menu.game.appid); if (g) void refreshMetadata(g) },
            onToggleFavorite: () => toggleFavorite(menu.game.appid),
            onDelete: () => { const g = installed.find((x) => x.appid === menu.game.appid); if (g) void deleteGame(g) },
          }}
          onClose={() => setMenu(null)}
        />
      )}
      {launchFor && <LaunchOptionsDialog appid={launchFor.appid} gameName={launchFor.name} onClose={() => setLaunchFor(null)} />}
      {addOpen && <AddGamesDialog onClose={() => setAddOpen(false)} />}
      {editFor && (
        <EditDetailsDialog
          game={editFor}
          onClose={() => setEditFor(null)}
          onSaved={(u) => setInstalled((prev) => prev.map((x) => x.appid !== editFor.appid ? x : { ...x, name: typeof u.name === "string" && u.name ? u.name : x.name, image: typeof u.image === "string" && u.image ? u.image : x.image, sizeText: typeof u.size === "string" && u.size ? u.size : x.sizeText, version: typeof u.version === "string" ? u.version : x.version }))}
        />
      )}
      {linuxFor && <LinuxConfigDialog appid={linuxFor.appid} gameName={linuxFor.name} onClose={() => setLinuxFor(null)} />}
    </div>
  )
}

// Build the menu/dialog payload, merging the LibGame with whatever the cached
// fully-resolved game adds (developer, description, genres, hero) so Edit
// details opens pre-filled. Module scope: reads only the remembered-game
// cache, so the parent's menu callbacks can be useCallback([])-stable.
function toMenuGame(g: LibGame): MenuGame {
  const full = getRememberedGame(g.appid)
  return {
    appid: g.appid,
    name: g.name,
    image: g.image || full?.image,
    sizeText: g.sizeText || full?.sizeText,
    version: g.version || full?.version,
    developer: full?.developer,
    description: full?.description,
    genres: full?.genres,
    heroImage: full?.heroImage,
    // Imported entries only hold a manifest stub, deleting never touches the
    // game's real files, so the menu says "Remove from library" instead.
    imported: g.installType === "imported-exe" || g.installType === "steam",
  }
}

// Shared props for the memoized library rows. `hasUpdate` is a plain boolean
// (not the updates Set) and every callback is useCallback-stable in the
// parent, so React.memo bails out unless the game object itself changed.
type LibRowProps = {
  game: LibGame
  hasUpdate: boolean
  onOpen: (g: LibGame) => void
  onContextMenu: (g: LibGame, x: number, y: number) => void
  onPlay: (g: LibGame) => void
  onStop: (appid: string) => void
  onMenu: (g: LibGame, anchorEl: HTMLElement) => void
}

// One grid card, memoized (same pattern as GameCard) so keystrokes in the
// filter and enrichment ticks only re-render rows whose game changed.
const LibCard = memo(function LibCard({ game: g, hasUpdate, onOpen, onContextMenu, onPlay, onStop, onMenu }: LibRowProps) {
  return (
    <div onClick={() => onOpen(g)} onContextMenu={(e) => { e.preventDefault(); onContextMenu(g, e.clientX, e.clientY) }} className="mf-card" style={{ display: "flex", flexDirection: "column", border: "1px solid color-mix(in srgb, var(--mf-t0) 7%, transparent)", borderRadius: 10, overflow: "hidden", background: "var(--mf-panel)", cursor: "pointer", contentVisibility: "auto", containIntrinsicSize: "auto 300px" }}>
      <div style={{ position: "relative", aspectRatio: "3 / 4", background: g.image ? "#0f0f0f" : COVER_LINES, display: "flex", alignItems: "flex-end", padding: 12 }}>
        {g.image && <img src={proxyImageUrl(g.image)} alt={g.name} loading="lazy" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
        {hasUpdate && (
          <span title="update available" style={{ position: "absolute", top: 10, right: 10, padding: "3px 8px", borderRadius: 99, background: "rgba(0,0,0,0.6)", border: "1px solid var(--mf-line-2)", fontFamily: MONO, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--mf-t1)" }}>update</span>
        )}
        {!g.image && <span style={{ fontFamily: MONO, fontSize: 11, lineHeight: 1.35, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--mf-t2)" }}>{g.name}</span>}
      </div>
      <div style={{ padding: "11px 12px 12px", display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--mf-t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</span>
          <span style={{ fontFamily: MONO, fontSize: 10, color: "var(--mf-t5)", whiteSpace: "nowrap", flexShrink: 0 }}>{lastPlayedLabel(g.lastPlayedAt)}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <PlayButton appid={g.appid} full onPlay={() => onPlay(g)} onStop={() => onStop(g.appid)} />
          <button type="button" title="More" onClick={(e) => { e.stopPropagation(); onMenu(g, e.currentTarget) }} className="mf-ghost" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, flexShrink: 0, borderRadius: 7, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t3)", cursor: "pointer" }}>
            <Settings size={15} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </div>
  )
})

// One list row, memoized for the same reason as LibCard.
const LibRow = memo(function LibRow({ game: g, hasUpdate, onOpen, onContextMenu, onPlay, onStop, onMenu }: LibRowProps) {
  return (
    <div onClick={() => onOpen(g)} onContextMenu={(e) => { e.preventDefault(); onContextMenu(g, e.clientX, e.clientY) }} className="mf-listrow" style={{ display: "grid", gridTemplateColumns: "44px minmax(0,1fr) 150px 120px 140px", gap: 14, alignItems: "center", padding: "8px 14px", borderRadius: 8, cursor: "pointer", contentVisibility: "auto", containIntrinsicSize: "auto 64px" }}>
      <div style={{ width: 40, height: 50, borderRadius: 5, overflow: "hidden", background: g.image ? "#0f0f0f" : COVER_LINES }}>
        {g.image && <img src={proxyImageUrl(g.image)} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
      </div>
      <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--mf-t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</span>
        {hasUpdate && <span style={{ padding: "2px 7px", borderRadius: 99, border: "1px solid var(--mf-line-2)", fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--mf-t3)", flexShrink: 0 }}>update</span>}
      </div>
      <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--mf-t3)" }}>{g.sizeText || gbLabel(g.sizeBytes) || "—"}</span>
      <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--mf-t3)" }}>{lastPlayedLabel(g.lastPlayedAt)}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8, justifySelf: "end" }}>
        <PlayButton appid={g.appid} onPlay={() => onPlay(g)} onStop={() => onStop(g.appid)} />
        <button type="button" title="More" onClick={(e) => { e.stopPropagation(); onMenu(g, e.currentTarget) }} className="mf-ghost" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, flexShrink: 0, borderRadius: 7, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t3)", cursor: "pointer" }}>
          <Settings size={15} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  )
})

// A zero-size rect at the cursor, so right-click opens the menu at the pointer.
function rectFromPoint(x: number, y: number): DOMRect {
  return { x, y, left: x, top: y, right: x, bottom: y, width: 0, height: 0, toJSON() { return {} } } as DOMRect
}

const listHead = { fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: "var(--mf-t5)" }

// Play/Stop button that reflects live running state. When the game is already
// running it flips to "Stop" so a second click stops it instead of trying (and
// failing) to relaunch it.
function PlayButton({ appid, onPlay, onStop, full }: { appid: string; onPlay: () => void; onStop: () => void; full?: boolean }) {
  const running = useRunningGame(appid)
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); running ? onStop() : onPlay() }}
      className="mf-ghost"
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6, height: 32, borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
        ...(full ? { flex: 1 } : { padding: "0 14px" }),
        background: running ? "color-mix(in srgb, var(--mf-t0) 12%, transparent)" : "var(--mf-accent)",
        color: running ? "var(--mf-accent)" : "var(--mf-accent-ink)",
      }}
    >
      {running
        ? <><Square size={11} fill="currentColor" strokeWidth={0} />Stop</>
        : <><Play size={12} fill="currentColor" strokeWidth={0} />Play</>}
    </button>
  )
}

function ViewBtn({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={title} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 28, borderRadius: 6, border: "none", cursor: "pointer", background: active ? "color-mix(in srgb, var(--mf-t0) 10%, transparent)" : "transparent", color: active ? "var(--mf-t0)" : "var(--mf-t4)" }}>
      {children}
    </button>
  )
}
