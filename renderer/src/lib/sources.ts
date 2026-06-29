// Renderer-side client for the multi-source catalog. Thin typed wrappers over
// window.ucSources.* (the main-process source-adapter registry), plus helpers to
// map a UnifiedSourceGame into the app's existing Game shape so current cards
// render it, and to resolve a download option just-in-time and hand it to the
// aria2 engine via window.ucDownloads.

import type { Game } from "@/lib/types"
import { sourceLogger } from "@/lib/logger"

export type { } // ensure module scope

const api = () => (typeof window !== "undefined" ? window.ucSources : undefined)

export function sourcesAvailable(): boolean {
  return Boolean(api())
}

export async function listSources(): Promise<SourceInfo[]> {
  const res = await api()?.list?.()
  return res?.ok ? res.sources : []
}

export async function setSourceEnabled(id: string, enabled: boolean): Promise<boolean> {
  const res = await api()?.setEnabled?.(id, enabled)
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

// Resolve a fully-hydrated record for an installed game that shipped with only
// an appid + title. Library installs use mixed appid schemes (UnionCrax
// internal id, steam-<steamAppId>, steam-<sourceId>) so the appid alone isn't a
// reliable key. We try the precise path first and ONLY fall back to a
// cross-source title search when that resolves nothing. A title search is the
// last resort, never run for a game the precise path already solved.
export async function resolveInstalledGame(appid: string, title: string): Promise<UnifiedSourceGame | null> {
  // Bare numeric appid is a UnionCrax internal id, resolve it directly.
  if (/^\d+$/.test(appid)) {
    const full = await getSourceDetail([{ sourceId: "unioncrax", sourceSlug: appid }])
    if (full) return full
  }
  // Unsolved by appid (steam-<id> installs, or a union miss). Match by title.
  const q = (title || "").trim()
  if (!q) return null
  const hits = await searchSources(q, 12)
  if (!hits.length) return null
  const want = normTitle(q)
  const pick = hits.find((h) => normTitle(h.title) === want) || hits[0]
  const stubs = (pick.sources || []).map((s) => ({ sourceId: s.sourceId, sourceSlug: s.sourceSlug }))
  const full = stubs.length ? await getSourceDetail(stubs) : null
  return full || pick
}

const EMPTY_QUERY_RESULT: SourceQueryResult = {
  ok: false,
  games: [],
  total: 0,
  facets: { tags: [], years: { min: null, max: null }, size: { min: null, max: null } },
  applied: {},
  capabilities: { perSource: [], scope: [], coverage: {}, supports: {} },
}

// Unified query across sources. Title text, tag filter (single/many, and/or),
// release-year and install-size ranges, and sort (popular | latest | updated |
// title | relevance), paginated. Returns the page plus facets (tag counts,
// year/size ranges) and a capability report. Read `capabilities.coverage` /
// `capabilities.supports` to announce when a filter or sort isn't supported by
// every active source.
export async function querySources(params: SourceQueryParams): Promise<SourceQueryResult> {
  const res = await api()?.query?.(params)
  if (!res?.ok) {
    if (res?.error) sourceLogger.warn("sources query failed", { data: res.error })
    return { ...EMPTY_QUERY_RESULT, applied: params }
  }
  return res
}

// The capability matrix for the active (optionally restricted) source set.
export async function sourceCapabilities(sourceIds?: string[]): Promise<SourceCapabilityReport | null> {
  const res = await api()?.capabilities?.(sourceIds)
  return res?.ok ? res.capabilities : null
}

// Authoritative Steam art (header/background) by appid, a last-resort cover
// fallback for titles whose predictable library_*.jpg URLs 404. The in-flight
// promise is cached per appid so concurrent cards only ask main once, but an
// empty result (transient failure or genuinely no art) is dropped so a later
// attempt can retry instead of staying blank for the rest of the session.
const _steamArt = new Map<number, Promise<string[]>>()
export function fetchSteamArt(appid?: number | null): Promise<string[]> {
  if (!appid) return Promise.resolve([])
  const hit = _steamArt.get(appid)
  if (hit) return hit
  const p = (async () => {
    try {
      const res = await api()?.steamArt?.(appid)
      const art = res?.art
      return art ? [art.header, art.background].filter(Boolean) : []
    } catch { return [] }
  })()
  _steamArt.set(appid, p)
  void p.then((urls) => { if (!urls.length) _steamArt.delete(appid) })
  return p
}

// Every available tag/genre across sources, plus the per-source breakdown.
export async function sourceTags(): Promise<{ tags: string[]; bySource: Record<string, string[]> }> {
  const res = await api()?.tags?.()
  return res?.ok ? { tags: res.tags, bySource: res.bySource } : { tags: [], bySource: {} }
}

// ── Source preference ordering ──
// When a title is provided by several backends, the most-preferred source's
// link drives the single big Download button and the rest become "other links".
// The order is user-configurable (Settings, Download Sources), persisted in
// ucSettings. This is the default. Sources not listed sort after.
export const SOURCE_PRIORITY = ["unioncrax", "ankergames", "gamebounty", "astralgames", "steamrip"]

// Friendly display names for source ids.
export const SOURCE_NAMES: Record<string, string> = {
  unioncrax: "UnionCrax",
  ankergames: "AnkerGames",
  gamebounty: "GameBounty",
  astralgames: "AstralGames",
  steamrip: "SteamRIP",
}
export function sourceName(id: string): string {
  return SOURCE_NAMES[id] || id
}

// Two-letter source badges (UC/SR/GB/AG) used on cards + status chips.
export const SOURCE_ABBR: Record<string, string> = {
  unioncrax: "UC",
  ankergames: "AG",
  gamebounty: "GB",
  astralgames: "AS",
  steamrip: "SR",
}
export function sourceAbbr(id: string): string {
  return SOURCE_ABBR[id] || id.slice(0, 2).toUpperCase()
}

// Does a source's contribution to a unified game carry an in-app-resolvable
// download? Drives the "direct" vs "browser" styling on badges.
export function sourceIsDirect(source: SourceGame): boolean {
  return (source.downloadOptions || []).some((o) => o.resolvable)
}

// General-purpose "this source resolves in-app" hint for source rows/filters
// (vs per-game `sourceIsDirect`). AnkerGames is browser-resolve only.
export const SOURCE_DIRECT: Record<string, boolean> = {
  unioncrax: true,
  steamrip: true,
  gamebounty: true,
  astralgames: true,
  ankergames: false,
}
export function sourceDirect(id: string): boolean {
  return SOURCE_DIRECT[id] !== false
}

const SOURCE_PRIORITY_KEY = "gv_source_priority"
const SOURCE_DISABLED_KEY = "gv_source_disabled"

// The user's saved source priority (preferred first), falls back to default.
export async function loadSourcePriority(): Promise<string[]> {
  try {
    const saved = await window.ucSettings?.get?.(SOURCE_PRIORITY_KEY)
    if (Array.isArray(saved) && saved.length) {
      // Append any new/unsaved sources at the end so they're never lost.
      const extras = SOURCE_PRIORITY.filter((id) => !saved.includes(id))
      return [...saved.filter((id: unknown): id is string => typeof id === "string"), ...extras]
    }
  } catch { /* ignore */ }
  return [...SOURCE_PRIORITY]
}

export async function saveSourcePriority(ids: string[]): Promise<void> {
  try { await window.ucSettings?.set?.(SOURCE_PRIORITY_KEY, ids) } catch { /* ignore */ }
}

export async function loadDisabledSources(): Promise<string[]> {
  try {
    const saved = await window.ucSettings?.get?.(SOURCE_DISABLED_KEY)
    if (Array.isArray(saved)) return saved.filter((id: unknown): id is string => typeof id === "string")
  } catch { /* ignore */ }
  return []
}

export async function saveDisabledSources(ids: string[]): Promise<void> {
  try { await window.ucSettings?.set?.(SOURCE_DISABLED_KEY, ids) } catch { /* ignore */ }
}

// Push the persisted enable/disable state into the main registry. Call once at
// startup (the registry's enabled set is in-memory and resets each launch).
export async function applySavedSourceSettings(): Promise<void> {
  try {
    const [disabled, all] = await Promise.all([loadDisabledSources(), listSources()])
    await Promise.all(all.map((s) => setSourceEnabled(s.id, !disabled.includes(s.id))))
  } catch { /* ignore */ }
}

export function sourceRank(sourceId: string, priority: string[] = SOURCE_PRIORITY): number {
  const i = priority.indexOf(sourceId)
  return i === -1 ? priority.length : i
}

// Stable-sort a unified game's sources by the given priority (preferred first).
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

// Flatten a unified game's sources (already priority-ordered) into download
// entries, resolvable options first within each source.
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

// The primary download, first in-app-resolvable entry by priority, else the
// first entry overall (which will open in the browser).
export function pickPrimaryDownload(entries: DownloadEntry[]): DownloadEntry | null {
  return entries.find((e) => e.option.resolvable) || entries[0] || null
}

// ── In-session game cache ──
// Browse/search results are remembered by dedupKey so the detail route can
// rehydrate a game (and its source stubs) without re-querying every source,
// and without depending solely on router navigation state.
const _remembered = new Map<string, UnifiedSourceGame>()

export function rememberGames(games: UnifiedSourceGame[]): void {
  for (const g of games) _remembered.set(g.dedupKey, g)
}

export function getRememberedGame(dedupKey: string): UnifiedSourceGame | undefined {
  return _remembered.get(dedupKey)
}

// Remember a game under an extra key (e.g. an installed manifest's appid, which
// may differ from the game's real dedupKey) so a later detail open hits cache.
export function rememberGameAs(key: string, game: UnifiedSourceGame): void {
  if (key) _remembered.set(key, game)
}

// ── Download art cache ──
// Downloads carry no image of their own, so when we enqueue one we stash the
// game's cover (keyed by the same appid the download manager uses) for the
// Downloads page to show. Persisted to settings so a download restored after a
// relaunch still shows its thumbnail instead of going blank.
const DOWNLOAD_ART_KEY = "downloadArt"
const _downloadArt = new Map<string, { image?: string; title?: string }>()
let _downloadArtHydrated = false

function persistDownloadArt(): void {
  try { void window.ucSettings?.set?.(DOWNLOAD_ART_KEY, Object.fromEntries(_downloadArt)) } catch { /* ignore */ }
}

export function recordDownloadArt(appid: string, image?: string, title?: string): void {
  _downloadArt.set(appid, { image, title })
  persistDownloadArt()
}

export function getDownloadArt(appid: string): { image?: string; title?: string } | undefined {
  return _downloadArt.get(appid)
}

// Load the persisted art map into memory once (call on the Downloads page mount).
// Existing in-memory entries win so a freshly-recorded cover isn't clobbered.
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
  } catch { /* ignore */ }
}
// The appid the download manager keys a game's downloads under (matches the
// value `startSourceDownload` enqueues with). Lets the detail page watch a
// game's live download status.
export function downloadAppidFor(seed: string): string {
  return safeId(seed)
}

// ── Mapping to the app's Game shape ──

// A stable, route-safe id for a unified game (its dedup key).
export function unifiedId(game: UnifiedSourceGame): string {
  return game.dedupKey
}

// Map a unified source game into the renderer's Game so existing UI renders it.
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
    // comma-joined source ids, handy for badges ("gamebounty+ankergames")
    source: game.sources.map((s) => s.sourceId).join("+") || "sources",
    store: "",
    dlc: [],
  } as Game
}

// ── Download wiring ──

export type StartResult =
  | { ok: true; queued: true }
  | { ok: false; openUrl?: string; reason?: string }

function safeId(seed: string): string {
  return String(seed || "game").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 48)
}

// Resolve a download option for a unified game on a given source and enqueue it
// with the aria2 engine. Multi-part hosts (e.g. a pixeldrain list) enqueue each
// file as a part. Unresolvable hosts return { ok:false, openUrl } so the UI can
// offer "open in browser".
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
