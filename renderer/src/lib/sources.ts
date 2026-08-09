import type { Game } from "@/lib/types"
import { sourceLogger } from "@/lib/logger"
import { slugify } from "@/lib/utils"


const api = () => (typeof window !== "undefined" ? window.ucSources : undefined)

export type SourceSortMode = "relevance" | "a-z" | "size" | "sources"
const SORT_MODES: readonly SourceSortMode[] = ["relevance", "a-z", "size", "sources"]
const SORT_LABELS: Record<SourceSortMode, string> = { relevance: "Relevance", "a-z": "A–Z", size: "Size", sources: "Most sources" }
export const SORT_NOUNS: Record<SourceSortMode, string> = { relevance: "relevance", "a-z": "A–Z", size: "size", sources: "mirror count" }

export function nextSortMode(mode: SourceSortMode): SourceSortMode {
  return SORT_MODES[(SORT_MODES.indexOf(mode) + 1) % SORT_MODES.length]
}

export function sortModeLabel(mode: SourceSortMode, hasQuery: boolean): string {
  if (mode === "relevance") return hasQuery ? "Relevance" : "Latest"
  return SORT_LABELS[mode]
}

export function sortUnifiedGames(games: UnifiedSourceGame[], sort: SourceSortMode, opts: { query?: string; fallbackLatest?: boolean } = {}): UnifiedSourceGame[] {
  const arr = [...games]
  const q = (opts.query || "").trim().toLowerCase()
  if (sort === "a-z") arr.sort((a, b) => a.title.localeCompare(b.title))
  else if (sort === "size") arr.sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0))
  else if (sort === "sources") arr.sort((a, b) => b.sources.length - a.sources.length || (b.releaseYear || 0) - (a.releaseYear || 0))
  else if (q) {
    arr.sort((a, b) => {
      const ra = a.title.toLowerCase().startsWith(q) ? 0 : 1
      const rb = b.title.toLowerCase().startsWith(q) ? 0 : 1
      return ra - rb || b.sources.length - a.sources.length || a.title.localeCompare(b.title)
    })
  } else if (opts.fallbackLatest) {
    arr.sort((a, b) => (b.releaseYear || 0) - (a.releaseYear || 0))
  }
  return arr
}

export function sortDownloadOptions(options: SourceDownloadOption[]): SourceDownloadOption[] {
  return [...options].sort(
    (a, b) =>
      Number(Boolean(b.resolvable)) - Number(Boolean(a.resolvable)) ||
      hostFriendliness(a.hostType) - hostFriendliness(b.hostType)
  )
}

export function mergeUnique<T extends { dedupKey: string }>(prev: T[], next: T[]): T[] {
  const seen = new Set(prev.map((g) => g.dedupKey))
  return [...prev, ...next.filter((g) => !seen.has(g.dedupKey))]
}

export function countMirrors(games: UnifiedSourceGame[]): { perSource: Record<string, number>; total: number } {
  const perSource: Record<string, number> = {}
  let total = 0
  for (const g of games) {
    for (const s of g.sources) {
      perSource[s.sourceId] = (perSource[s.sourceId] || 0) + 1
      total += 1
    }
  }
  return { perSource, total }
}

export function sourcesAvailable(): boolean {
  return Boolean(api())
}

let _sourcesList: Promise<SourceInfo[]> | null = null

export function listSources(): Promise<SourceInfo[]> {
  if (_sourcesList) return _sourcesList
  const p = (async () => {
    const res = await api()?.list?.()
    return res?.ok ? res.sources : []
  })()
  _sourcesList = p
  p.then(
    (sources) => { if (!sources.length && _sourcesList === p) _sourcesList = null },
    () => { if (_sourcesList === p) _sourcesList = null }
  )
  return p
}

export async function setSourceEnabled(id: string, enabled: boolean): Promise<boolean> {
  const res = await api()?.setEnabled?.(id, enabled)
  _sourcesList = null
  return Boolean(res?.ok)
}

async function searchSources(query: string, limit = 24): Promise<UnifiedSourceGame[]> {
  const q = query.trim()
  if (!q) return []
  const res = await api()?.search?.(q, limit)
  if (!res?.ok) {
    if (res?.error) sourceLogger.warn("sources search failed", { data: res.error })
    return []
  }
  return res.games || []
}


const _detailRequests = new Map<string, Promise<UnifiedSourceGame | null>>()

export function getSourceDetail(
  sources: Array<{ sourceId: string; sourceSlug: string }>
): Promise<UnifiedSourceGame | null> {
  const key = JSON.stringify(sources)
  const pending = _detailRequests.get(key)
  if (pending) return pending
  const request = (async () => {
    const res = await api()?.detail?.(sources)
    return res?.ok ? res.game : null
  })()
  _detailRequests.set(key, request)
  void request.finally(() => {
    if (_detailRequests.get(key) === request) _detailRequests.delete(key)
  }).catch(() => {})
  return request
}

function normTitle(s: string): string {
  return slugify(s)
}

const _installedResolutionRequests = new Map<string, Promise<UnifiedSourceGame | null>>()

export function resolveInstalledGame(appid: string, title: string, knownSteamAppId?: number | null): Promise<UnifiedSourceGame | null> {
  const key = JSON.stringify([appid, title.trim(), knownSteamAppId ?? null])
  const pending = _installedResolutionRequests.get(key)
  if (pending) return pending
  const request = resolveInstalledGameOnce(appid, title, knownSteamAppId)
  _installedResolutionRequests.set(key, request)
  void request.finally(() => {
    if (_installedResolutionRequests.get(key) === request) _installedResolutionRequests.delete(key)
  }).catch(() => {})
  return request
}

async function resolveInstalledGameOnce(appid: string, title: string, knownSteamAppId?: number | null): Promise<UnifiedSourceGame | null> {
  if (!knownSteamAppId && /^\d+$/.test(appid)) {
    const full = await getSourceDetail([{ sourceId: "unioncrax", sourceSlug: appid }])
    if (full) return full
  }
  const steamAppId = knownSteamAppId ?? (() => {
    const m = /^steam-(\d+)$/.exec(appid)
    return m ? Number(m[1]) : null
  })()
  const q = (title || "").trim()
  const hits = q ? await searchSources(q, 12) : []
  const want = normTitle(q)
  const pick = steamAppId
    ? hits.find((h) => h.steamAppId === steamAppId)
    : (hits.find((h) => normTitle(h.title) === want) || hits[0])
  if (pick) {
    const stubs = (pick.sources || []).map((s) => ({ sourceId: s.sourceId, sourceSlug: s.sourceSlug }))
    const full = stubs.length ? await getSourceDetail(stubs) : null
    const resolved = full || pick
    if (steamAppId && resolved.steamAppId !== steamAppId) return { ...resolved, steamAppId }
    return resolved
  }
  if (steamAppId) {
    return {
      dedupKey: appid,
      steamAppId,
      title: q || appid,
      image: steamCoverUrl(steamAppId),
      genres: [],
      sources: [],
    }
  }
  return null
}

export function steamCoverUrl(steamAppId: number): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/library_600x900.jpg`
}

const EMPTY_QUERY_RESULT: SourceQueryResult = {
  ok: false,
  games: [],
  total: 0,
  facets: { tags: [] },
  applied: {},
  capabilities: { perSource: [] },
}

let _sourceRequestId = 0
export function nextSourceRequestId(): number {
  _sourceRequestId += 1
  return _sourceRequestId
}

export async function querySources(params: SourceQueryParams, reqId?: number): Promise<SourceQueryResult> {
  const res = await api()?.query?.(params, reqId)
  if (!res?.ok) {
    if (res?.error) sourceLogger.warn("sources query failed", { data: res.error })
    return { ...EMPTY_QUERY_RESULT, applied: params, error: res?.error || "Source query failed" }
  }
  return res
}

export async function sourceCapabilities(sourceIds?: string[]): Promise<SourceCapabilityReport | null> {
  const res = await api()?.capabilities?.(sourceIds)
  return res?.ok ? res.capabilities : null
}

const _steamArt = new Map<number, Promise<string[]>>()
export function fetchSteamArt(appid?: number | null, name?: string): Promise<string[]> {
  if (!appid) return Promise.resolve([])
  const hit = _steamArt.get(appid)
  if (hit) return hit
  const p = (async () => {
    try {
      const res = await api()?.steamArt?.(appid, name)
      const art = res?.art
      return art ? [art.cover, art.header, art.background].filter((u): u is string => Boolean(u)) : []
    } catch { return [] }
  })()
  _steamArt.set(appid, p)
  void p.then((urls) => { if (!urls.length) _steamArt.delete(appid) })
  return p
}
export const SOURCE_PRIORITY = ["unioncrax", "gamebounty", "steamrip", "zeigames", "onlinefix", "gog", "empress", "kaoskrew"]

export const SOURCE_NAMES: Record<string, string> = {
  unioncrax: "UnionCrax",
  gamebounty: "GameBounty",
  steamrip: "SteamRIP",
  zeigames: "ZeiGames",
  onlinefix: "Online-Fix",
  gog: "GOG",
  empress: "EMPRESS",
  kaoskrew: "KaOsKrew",
}
export function sourceName(id: string): string {
  return SOURCE_NAMES[id] || id
}

export const SOURCE_ABBR: Record<string, string> = {
  unioncrax: "UC",
  gamebounty: "GB",
  steamrip: "SR",
  zeigames: "ZG",
  onlinefix: "OF",
  gog: "GOG",
  empress: "EMP",
  kaoskrew: "KK",
}
export function sourceAbbr(id: string): string {
  return SOURCE_ABBR[id] || id.slice(0, 2).toUpperCase()
}

export function sourceIsDirect(source: SourceGame): boolean {
  return (source.downloadOptions || []).some((o) => o.resolvable)
}

export const SOURCE_DIRECT: Record<string, boolean> = {
  unioncrax: true,
  steamrip: true,
  gamebounty: true,
  zeigames: true,
  onlinefix: true,
  gog: true,
  empress: true,
  kaoskrew: true,
}
export function sourceDirect(id: string): boolean {
  return SOURCE_DIRECT[id] !== false
}

const SOURCE_PRIORITY_KEY = "gv_source_priority"
const SOURCE_DISABLED_KEY = "gv_source_disabled"

function migrateSourceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids = value
    .filter((id: unknown): id is string => typeof id === "string")
    .map((id) => id === "rexagames" ? "zeigames" : id)
    .filter((id) => SOURCE_PRIORITY.includes(id))
  return [...new Set(ids)]
}

export async function loadSourcePriority(): Promise<string[]> {
  try {
    const saved = await window.ucSettings?.get?.(SOURCE_PRIORITY_KEY)
    const migrated = migrateSourceIds(saved)
    if (migrated.length) {
      const extras = SOURCE_PRIORITY.filter((id) => !migrated.includes(id))
      return [...migrated, ...extras]
    }
  } catch {  }
  return [...SOURCE_PRIORITY]
}


export async function loadDisabledSources(): Promise<string[]> {
  try {
    return migrateSourceIds(await window.ucSettings?.get?.(SOURCE_DISABLED_KEY))
  } catch {  }
  return []
}

export async function saveDisabledSources(ids: string[]): Promise<void> {
  try { await window.ucSettings?.set?.(SOURCE_DISABLED_KEY, ids) } catch {  }
}

export function onSourcesChanged(cb: () => void): () => void {
  const offs: Array<() => void> = []
  if (window.ucSettings?.onChanged) {
    offs.push(window.ucSettings.onChanged((d) => {
      if (d?.key === SOURCE_DISABLED_KEY || d?.key === "slipgateUrl" || d?.key === "slipgateKey" || d?.key === "hideTorrentSources") {
        _sourcesList = null
        cb()
      }
    }))
  }
  const offUpdated = window.ucSources?.onSourcesUpdated?.(() => {
    _sourcesList = null
    cb()
  })
  if (offUpdated) offs.push(offUpdated)
  return () => { for (const o of offs) o() }
}

export async function applySavedSourceSettings(): Promise<void> {
  try {
    const [disabled, all] = await Promise.all([loadDisabledSources(), listSources()])
    await Promise.all(all.map((s) => setSourceEnabled(s.id, !disabled.includes(s.id))))
  } catch {  }
}

export function sourceRank(sourceId: string, priority: string[] = SOURCE_PRIORITY): number {
  const i = priority.indexOf(sourceId)
  return i === -1 ? priority.length : i
}

export function orderSourcesByPreference<T extends { sourceId: string }>(
  sources: T[],
  priority: string[] = SOURCE_PRIORITY
): T[] {
  return sources
    .map((s, i) => ({ s, i }))
    .sort((a, b) => sourceRank(a.s.sourceId, priority) - sourceRank(b.s.sourceId, priority) || a.i - b.i)
    .map((x) => x.s)
}

export type DownloadEntry = { source: SourceGame; option: SourceDownloadOption }

const HOST_FRIENDLINESS: Record<string, number> = {
  ucfiles: 0, // UnionCrax.Direct — #1 (in-app, no gates)
  pixeldrain: 1, // #2 (dedicated resolver, no gates)
  gofile: 2, // #3 (API resolver; occasional temp-unavailable)
  datanodes: 3, // direct; may hit Cloudflare (Slipgate fallback)
  fileditch: 4, // direct
  buzzheavier: 4, // direct
  mediafire: 4, // direct
  rootz: 4, // direct
  fuckingfast: 4, // direct
  filekeeper: 4, // direct
  datavaults: 5, // gated page (Slipgate)
  megadb: 6, // Slipgate-only
  filecrypt: 6,
  vikingfile: 6,
  "1fichier": 6,
  akirabox: 6,
  qiwi: 6,
  fileq: 6,
  mocha: 6,
  zerofs: 6,
}

export function hostFriendliness(hostType: string): number {
  const r = HOST_FRIENDLINESS[hostType]
  return r === undefined ? 4 : r
}

export function collectDownloadEntries(orderedSources: SourceGame[]): DownloadEntry[] {
  const entries: DownloadEntry[] = []
  for (const source of orderedSources) {
    const opts = sortDownloadOptions(source.downloadOptions || [])
    for (const option of opts) entries.push({ source, option })
  }
  return entries
}

export function pickPrimaryDownload(entries: DownloadEntry[]): DownloadEntry | null {
  const resolvable = entries.filter((e) => e.option.resolvable)
  if (resolvable.length) {
    return resolvable.reduce((best, e) =>
      hostFriendliness(e.option.hostType) < hostFriendliness(best.option.hostType) ? e : best
    )
  }
  return entries[0] || null
}

const REMEMBERED_MAX = 500
const _remembered = new Map<string, UnifiedSourceGame>()

function rememberSet(key: string, game: UnifiedSourceGame): void {
  if (_remembered.has(key)) _remembered.delete(key)
  _remembered.set(key, game)
  if (_remembered.size > REMEMBERED_MAX) {
    const oldest = _remembered.keys().next().value
    if (oldest !== undefined) _remembered.delete(oldest)
  }
}

export function rememberGames(games: UnifiedSourceGame[]): void {
  for (const g of games) rememberSet(g.dedupKey, g)
}

export function getRememberedGame(dedupKey: string): UnifiedSourceGame | undefined {
  const g = _remembered.get(dedupKey)
  if (g !== undefined) { _remembered.delete(dedupKey); _remembered.set(dedupKey, g) }
  return g
}

export function rememberGameAs(key: string, game: UnifiedSourceGame): void {
  if (key) rememberSet(key, game)
}

export function forgetRememberedGame(key: string): void {
  const g = _remembered.get(key)
  _remembered.delete(key)
  if (g?.dedupKey && g.dedupKey !== key) _remembered.delete(g.dedupKey)
}

const DOWNLOAD_ART_KEY = "downloadArt"
const _downloadArt = new Map<string, { image?: string; title?: string }>()
let _downloadArtHydrated = false

function persistDownloadArt(): void {
  try { void window.ucSettings?.set?.(DOWNLOAD_ART_KEY, Object.fromEntries(_downloadArt)) } catch {  }
}

function recordDownloadArt(appid: string, image?: string, title?: string): void {
  _downloadArt.set(appid, { image, title })
  persistDownloadArt()
}

export function getDownloadArt(appid: string): { image?: string; title?: string } | undefined {
  return _downloadArt.get(appid)
}

export async function hydrateDownloadArt(): Promise<void> {
  if (_downloadArtHydrated) return
  _downloadArtHydrated = true
  try {
    const saved = await window.ucSettings?.get?.(DOWNLOAD_ART_KEY)
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      for (const [appid, v] of Object.entries(saved as Record<string, { image?: string; title?: string }>)) {
        if (!_downloadArt.has(appid) && v && typeof v === "object") _downloadArt.set(appid, v)
      }
    }
  } catch {  }
}
export function downloadAppidFor(seed: string): string {
  return safeId(seed)
}


export function unifiedToGame(game: UnifiedSourceGame): Game {
  return {
    appid: game.dedupKey,
    name: game.title,
    description: game.description || "",
    genres: game.genres || [],
    image: game.image || "./fallbacks/game-card-3x4.svg",
    screenshots: [],
    hero_image: game.heroImage || undefined,
    release_date: game.releaseDate || "",
    size: game.sizeText || "",
    sizeBytes: game.sizeBytes,
    version: game.version || "",
    developer: game.developer || "Unknown",
    source: game.sources.map((s) => s.sourceId).join("+") || "sources",
    store: "",
    dlc: [],
  } as Game
}

export type StartResult =
  | { ok: true; queued: true }
  | { ok: false; openUrl?: string; reason?: string; cancelled?: boolean }

function safeId(seed: string): string {
  return String(seed || "game").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 48)
}

export async function startSourceDownload(
  game: UnifiedSourceGame,
  sourceId: string,
  option: SourceDownloadOption,
  update = false
): Promise<StartResult> {
  const resolveRes = await api()?.resolve?.(sourceId, option)
  const resolved = resolveRes?.result
  if (!resolveRes?.ok || !resolved) {
    return { ok: false, reason: resolveRes?.error || "resolve failed" }
  }
  if (!resolved.resolvable) {
    if (resolved.cancelled) return { ok: false, cancelled: true, reason: resolved.reason }
    return { ok: false, openUrl: resolved.openUrl || option.pageUrl || option.url, reason: resolved.reason }
  }

  const appid = safeId(game.dedupKey)
  const gameName = game.title
  if (!update) {
    try {
      update = Boolean(await window.ucDownloads?.getInstalled?.(appid))
    } catch {  }
  }
  recordDownloadArt(appid, game.image, game.title)
  const headers = resolved.headers
  const files = resolved.files?.length
    ? resolved.files
    : resolved.url
      ? [{ url: resolved.url, fileName: resolved.fileName, sizeBytes: resolved.sizeBytes }]
      : []

  if (!files.length) {
    return { ok: false, openUrl: resolved.openUrl || option.pageUrl, reason: "no file url" }
  }

  const source = game.sources.find((entry) => entry.sourceId === sourceId)
  const sourceVersion = source?.version?.trim() || undefined
  const metadata = {
    name: game.title,
    image: game.image || (game.steamAppId ? steamCoverUrl(game.steamAppId) : undefined),
    heroImage: game.heroImage || undefined,
    steamAppId: game.steamAppId ?? undefined,
    sizeBytes: game.sizeBytes,
    size: game.sizeText || undefined,
    version: update ? sourceVersion : game.version || undefined,
    downloadedVersion: update ? sourceVersion : undefined,
    description: game.description || undefined,
    genres: game.genres?.length ? game.genres : undefined,
    developer: game.developer || undefined,
  }

  if (!update) {
    try {
      await window.ucDownloads?.saveInstalledMetadata?.(appid, metadata)
    } catch {  }
  }

  const partTotal = files.length
  let anyQueued = false
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const downloadId = `${appid}-${Date.now().toString(36)}-${i}`
    try {
      const res = await window.ucDownloads?.start?.({
        downloadId,
        url: f.url,
        filename: f.fileName,
        appid,
        gameName,
        totalBytes: f.sizeBytes,
        headers,
        partIndex: partTotal > 1 ? i + 1 : undefined,
        partTotal: partTotal > 1 ? partTotal : undefined,
        update,
        installMetadata: update ? metadata : undefined,
      })
      anyQueued = anyQueued || Boolean(res?.ok)
    } catch (err) {
      sourceLogger.warn("startSourceDownload enqueue failed", { data: String(err) })
    }
  }
  return anyQueued ? { ok: true, queued: true } : { ok: false, reason: "enqueue failed" }
}

export async function startBestDownload(
  game: UnifiedSourceGame,
  entries: DownloadEntry[],
  update = false
): Promise<StartResult> {
  const candidates = entries
    .filter((e) => e.option.resolvable)
    .sort((a, b) => hostFriendliness(a.option.hostType) - hostFriendliness(b.option.hostType))
  let fallbackUrl: string | undefined
  let tried = 0
  for (const { source, option } of candidates) {
    tried++
    const res = await startSourceDownload(game, source.sourceId, option, update)
    if (res.ok) return res
    if (res.cancelled) return res
    if (!fallbackUrl) fallbackUrl = res.openUrl
  }
  const first = entries[0]?.option
  const openUrl = fallbackUrl || first?.pageUrl || first?.url
  const reason = tried
    ? `${tried} in-app source${tried === 1 ? "" : "s"} failed, opening in browser`
    : "no in-app source, opening in browser"
  return { ok: false, openUrl, reason }
}
