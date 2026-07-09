import type { Game } from "@/lib/types"
import { sourceLogger } from "@/lib/logger"

export type { }

const api = () => (typeof window !== "undefined" ? window.ucSources : undefined)

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

export async function searchSources(query: string, limit = 24): Promise<UnifiedSourceGame[]> {
  const q = query.trim()
  if (!q) return []
  const res = await api()?.search?.(q, limit)
  if (!res?.ok) {
    if (res?.error) sourceLogger.warn("sources search failed", { data: res.error })
    return []
  }
  return res.games || []
}

export async function browseSources(offset = 0, limit = 36): Promise<UnifiedSourceGame[]> {
  const res = await api()?.catalog?.(offset, limit)
  if (!res?.ok) {
    if (res?.error) sourceLogger.warn("sources catalog failed", { data: res.error })
    return []
  }
  return res.games || []
}

export async function getSourceDetail(
  sources: Array<{ sourceId: string; sourceSlug: string }>
): Promise<UnifiedSourceGame | null> {
  const res = await api()?.detail?.(sources)
  return res?.ok ? res.game : null
}

function normTitle(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "")
}

export async function resolveInstalledGame(appid: string, title: string, knownSteamAppId?: number | null): Promise<UnifiedSourceGame | null> {
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
  facets: { tags: [], years: { min: null, max: null }, size: { min: null, max: null } },
  applied: {},
  capabilities: { perSource: [], scope: [], coverage: {}, supports: {} },
}

export async function querySources(params: SourceQueryParams, reqId?: number): Promise<SourceQueryResult> {
  const res = await api()?.query?.(params, reqId)
  if (!res?.ok) {
    if (res?.error) sourceLogger.warn("sources query failed", { data: res.error })
    return { ...EMPTY_QUERY_RESULT, applied: params }
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

export async function sourceTags(): Promise<{ tags: string[]; bySource: Record<string, string[]> }> {
  const res = await api()?.tags?.()
  return res?.ok ? { tags: res.tags, bySource: res.bySource } : { tags: [], bySource: {} }
}

export const SOURCE_PRIORITY = ["unioncrax", "gamebounty", "steamrip", "rexagames", "onlinefix", "gog", "empress", "kaoskrew"]

export const SOURCE_NAMES: Record<string, string> = {
  unioncrax: "UnionCrax",
  gamebounty: "GameBounty",
  steamrip: "SteamRIP",
  rexagames: "RexaGames",
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
  rexagames: "RX",
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
  rexagames: true,
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

export async function loadSourcePriority(): Promise<string[]> {
  try {
    const saved = await window.ucSettings?.get?.(SOURCE_PRIORITY_KEY)
    if (Array.isArray(saved) && saved.length) {
      const extras = SOURCE_PRIORITY.filter((id) => !saved.includes(id))
      return [...saved.filter((id: unknown): id is string => typeof id === "string"), ...extras]
    }
  } catch {  }
  return [...SOURCE_PRIORITY]
}

export async function saveSourcePriority(ids: string[]): Promise<void> {
  try { await window.ucSettings?.set?.(SOURCE_PRIORITY_KEY, ids) } catch {  }
}

export async function loadDisabledSources(): Promise<string[]> {
  try {
    const saved = await window.ucSettings?.get?.(SOURCE_DISABLED_KEY)
    if (Array.isArray(saved)) return saved.filter((id: unknown): id is string => typeof id === "string")
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
      if (d?.key === SOURCE_DISABLED_KEY || d?.key === "slipgateUrl" || d?.key === "slipgateKey") {
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
  pixeldrain: 0,
  gofile: 0,
  datanodes: 0,
  fileditch: 0,
  mediafire: 1,
  rootz: 1,
  fuckingfast: 2,
  buzzheavier: 2,
  filekeeper: 3,
  datavaults: 3,
  megadb: 5,
  filecrypt: 5,
  vikingfile: 5,
  "1fichier": 5,
  akirabox: 5,
  qiwi: 5,
  fileq: 5,
  mocha: 5,
  zerofs: 5,
}

export function hostFriendliness(hostType: string): number {
  const r = HOST_FRIENDLINESS[hostType]
  return r === undefined ? 4 : r
}

export function collectDownloadEntries(orderedSources: SourceGame[]): DownloadEntry[] {
  const entries: DownloadEntry[] = []
  for (const source of orderedSources) {
    const opts = [...(source.downloadOptions || [])].sort(
      (a, b) => Number(Boolean(b.resolvable)) - Number(Boolean(a.resolvable))
    )
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

export function recordDownloadArt(appid: string, image?: string, title?: string): void {
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

export function unifiedId(game: UnifiedSourceGame): string {
  return game.dedupKey
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
  | { ok: false; openUrl?: string; reason?: string }

function safeId(seed: string): string {
  return String(seed || "game").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 48)
}

export async function startSourceDownload(
  game: UnifiedSourceGame,
  sourceId: string,
  option: SourceDownloadOption
): Promise<StartResult> {
  const resolveRes = await api()?.resolve?.(sourceId, option)
  const resolved = resolveRes?.result
  if (!resolveRes?.ok || !resolved) {
    return { ok: false, reason: resolveRes?.error || "resolve failed" }
  }
  if (!resolved.resolvable) {
    return { ok: false, openUrl: resolved.openUrl || option.pageUrl || option.url, reason: resolved.reason }
  }

  const appid = safeId(game.dedupKey)
  const gameName = game.title
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

  try {
    await window.ucDownloads?.saveInstalledMetadata?.(appid, {
      name: game.title,
      image: game.image || (game.steamAppId ? steamCoverUrl(game.steamAppId) : undefined),
      heroImage: game.heroImage || undefined,
      steamAppId: game.steamAppId ?? undefined,
      sizeBytes: game.sizeBytes,
      size: game.sizeText || undefined,
      version: game.version || undefined,
      description: game.description || undefined,
      genres: game.genres?.length ? game.genres : undefined,
      developer: game.developer || undefined,
    })
  } catch {  }

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
  entries: DownloadEntry[]
): Promise<StartResult> {
  const candidates = entries
    .filter((e) => e.option.resolvable)
    .sort((a, b) => hostFriendliness(a.option.hostType) - hostFriendliness(b.option.hostType))
  let fallbackUrl: string | undefined
  let tried = 0
  for (const { source, option } of candidates) {
    tried++
    const res = await startSourceDownload(game, source.sourceId, option)
    if (res.ok) return res
    if (!fallbackUrl) fallbackUrl = res.openUrl
  }
  const first = entries[0]?.option
  const openUrl = fallbackUrl || first?.pageUrl || first?.url
  const reason = tried
    ? `${tried} in-app source${tried === 1 ? "" : "s"} failed, opening in browser`
    : "no in-app source, opening in browser"
  return { ok: false, openUrl, reason }
}
