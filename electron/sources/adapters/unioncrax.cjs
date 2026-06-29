'use strict'

// UnionCrax (union-crax.xyz) adapter, the original backend re-added as the
// top-priority source. Real REST API (no scraping, no rate limit), Steam-AppID
// keyed, downloads resolve to a direct CDN .7z via the UC.Files flow: POST
// /api/downloads/{appid} returns a downloadToken, GET the same with
// fetchLinks=true returns hosts.ucfiles[{url,part}], POST /api/ucfiles/resolve
// returns the final {url, filename, size}. All work unauthenticated. The link
// fetch is deferred to resolveDownload() (click time) so catalog/search stay
// metadata-only and fast.

const { requestJson, mapLimit } = require('../http.cjs')
const { makeGame, parseSizeToBytes } = require('../schema.cjs')

const ID = 'unioncrax'
const ORIGIN = 'https://union-crax.xyz'
const HEADERS = { 'X-UC-Client': 'unioncrax-direct' }

let _catalog = { at: 0, games: [] }
const CATALOG_TTL_MS = 1000 * 60 * 30

// UnionCrax keys games by its OWN internal id (the catalog `appid` is NOT the
// Steam AppID, e.g. Hogwarts Legacy is UC id 136625 / Steam 990080). The real
// Steam AppID is embedded right in each catalog record's `store` field
// (`https://store.steampowered.com/app/{steamAppId}`), parsed for free with no
// extra request. It drives correct cross-source dedup, the Steam/SteamDB/
// ProtonDB links, AND lets us use Steam library art for thumbnails (UC's own
// images live on cdn.union-crax.xyz, which is SNI/DPI-blocked for many users so
// an <img> to it fails even though the download engine can still reach it).
// For the handful of games with no Steam store link, `/api/protondb/{id}` is a
// lazy fallback (used on the detail page only).
const _steamAppId = new Map() // internalId(string) -> number | null (protondb fallback cache)

// Pull the Steam AppID straight out of a UC `store` URL, if it's a Steam link.
function steamAppIdFromStore(store) {
  const m = String(store || '').match(/store\.steampowered\.com\/app\/(\d+)/)
  return m ? Number(m[1]) : null
}

// Fallback, resolve a UC internal id to a Steam AppID via /api/protondb (cached,
// incl. misses). Only needed for games whose `store` isn't a Steam link.
async function resolveSteamAppId(internalId) {
  const key = String(internalId || '')
  if (!key) return null
  if (_steamAppId.has(key)) return _steamAppId.get(key)
  let appid = null
  try {
    const { res, json } = await requestJson(`${ORIGIN}/api/protondb/${encodeURIComponent(key)}`, { headers: HEADERS })
    if (res.ok && json && json.steamAppId != null) {
      const n = Number(json.steamAppId)
      if (Number.isFinite(n) && n > 0) appid = n
    }
  } catch { /* leave null */ }
  _steamAppId.set(key, appid)
  return appid
}

function coerceGenres(value) {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try { const p = JSON.parse(value); return Array.isArray(p) ? p : [] } catch { return value ? [value] : [] }
  }
  return []
}

// Map a UC API game object into a NormalizedGame (metadata + a lazy UC.Files
// option). `steamAppId` uses the resolved Steam AppID when known (from the
// protondb cache), falling back to null (title-based dedup) until it warms.
function normalize(uc) {
  const internalId = String(uc?.appid || '')
  // The catalog `appid` is UC's internal id, NOT Steam's. The real Steam AppID
  // is in the `store` URL (drives dedup + Steam/SteamDB/ProtonDB links). Images
  // render straight from UnionCrax's own cdn/files links as the API serves them.
  const steamAppId = steamAppIdFromStore(uc?.store) ?? _steamAppId.get(internalId) ?? null
  const image = uc?.image || ''
  const heroImage = uc?.hero_image || uc?.hero_image_override || ''
  return makeGame({
    sourceId: ID,
    sourceSlug: internalId,
    sourceUrl: `${ORIGIN}/game/${internalId}`,
    steamAppId,
    title: uc?.name || internalId,
    description: typeof uc?.description === 'string' ? uc.description : '',
    image,
    heroImage,
    genres: coerceGenres(uc?.genres),
    developer: uc?.developer || '',
    releaseDate: uc?.release_date || '',
    // posted_time = added to UC; update_time/edited_time = last revised. No
    // view/download count, so no popularity signal.
    addedAt: uc?.posted_time || null,
    updatedAt: uc?.update_time || uc?.edited_time || null,
    version: uc?.version || '',
    sizeText: typeof uc?.size === 'string' ? uc.size : '',
    sizeBytes: parseSizeToBytes(uc?.size),
    nsfw: Boolean(uc?.nsfw || uc?.hasHv),
    // Lazy option: resolveDownload() runs the token->links->resolve flow using
    // the UC internal id. Avoids a per-tile network round trip during browse.
    downloadOptions: [{ label: 'UC.Files', hostType: 'ucfiles', url: internalId, resolvable: true }],
  })
}

async function fetchCatalog() {
  const now = Date.now()
  if (_catalog.games.length && now - _catalog.at < CATALOG_TTL_MS) return _catalog.games
  const { res, json } = await requestJson(`${ORIGIN}/api/games`, { headers: HEADERS })
  const games = res.ok && Array.isArray(json) ? json : []
  _catalog = { at: now, games }
  return games
}

// ── Adapter interface ──

async function listCatalog({ offset = 0, limit = 36 } = {}) {
  const games = await fetchCatalog()
  return games.slice(offset, offset + limit).map(normalize)
}

async function search(query, { limit = 24 } = {}) {
  const q = String(query || '').trim()
  if (!q) return []
  // Prefer the suggestions endpoint; fall back to filtering the full catalog.
  try {
    const { res, json } = await requestJson(
      `${ORIGIN}/api/games/suggestions?q=${encodeURIComponent(q)}&limit=${limit}&nsfw=true`,
      { headers: HEADERS }
    )
    const items = res.ok ? (Array.isArray(json?.items) ? json.items : Array.isArray(json) ? json : json?.results) : null
    if (Array.isArray(items) && items.length) return items.slice(0, limit).map(normalize)
  } catch { /* fall through */ }

  const terms = q.toLowerCase().split(/\s+/)
  const games = await fetchCatalog()
  return games
    .filter((g) => { const hay = String(g?.name || '').toLowerCase(); return terms.every((t) => hay.includes(t)) })
    .slice(0, limit)
    .map(normalize)
}

async function getDetail(slug) {
  const internalId = String(slug || '')
  const { res, json } = await requestJson(`${ORIGIN}/api/games/${encodeURIComponent(internalId)}`, { headers: HEADERS })
  let uc = res.ok && json && (json.appid || json.name) ? json : null
  if (!uc) {
    // Fall back to the catalog entry if the per-id endpoint misses.
    const games = await fetchCatalog()
    uc = games.find((g) => String(g?.appid) === internalId) || null
  }
  if (!uc) throw new Error(`unioncrax detail miss for ${internalId}`)
  // The `store` field usually carries the Steam AppID, only hit protondb when
  // it doesn't so links + Steam art stay correct for those few titles.
  if (steamAppIdFromStore(uc.store) == null) await resolveSteamAppId(internalId)
  return normalize(uc)
}

// Candidate pool for a unified query. UC keeps its whole catalog in memory, so
// it hands the registry every game (optionally narrowed by a title query) and
// lets the registry apply the authoritative tag/year/size filter + sort.
async function query({ text = '' } = {}) {
  const games = (await fetchCatalog()).map(normalize)
  const q = String(text || '').toLowerCase().trim()
  if (!q) return games
  const terms = q.split(/\s+/)
  return games.filter((g) => terms.every((t) => g.title.toLowerCase().includes(t)))
}

// Distinct genres across the catalog (for the UI tag filter).
async function listTags() {
  const set = new Set()
  for (const uc of await fetchCatalog()) for (const g of coerceGenres(uc?.genres)) if (g) set.add(String(g).trim())
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}

// Run the UC.Files token -> links -> resolve flow at click time.
async function resolveDownload(option) {
  const appid = String(option?.url || '').trim()
  if (!appid) return { resolvable: false, reason: 'missing appid' }
  const pageUrl = `${ORIGIN}/game/${appid}`

  // 1) download token
  const { res: tokRes, json: tokJson } = await requestJson(`${ORIGIN}/api/downloads/${encodeURIComponent(appid)}`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  const token = tokJson?.downloadToken
  if (!tokRes.ok || !token) return { resolvable: false, openUrl: pageUrl, reason: tokJson?.error || 'no download token' }

  // 2) fetch links
  const { res: linkRes, json: linkJson } = await requestJson(
    `${ORIGIN}/api/downloads/${encodeURIComponent(appid)}?fetchLinks=true&downloadToken=${encodeURIComponent(token)}`,
    { headers: HEADERS }
  )
  const ucfiles = Array.isArray(linkJson?.hosts?.ucfiles) ? linkJson.hosts.ucfiles : []
  if (!linkRes.ok || !ucfiles.length) return { resolvable: false, openUrl: pageUrl, reason: 'no UC.Files links' }

  // 3) resolve each UC.Files share URL to a direct CDN URL (parts kept in order)
  const ordered = [...ucfiles].sort((a, b) => (a.part ?? 0) - (b.part ?? 0))
  const resolved = await mapLimit(ordered, 4, async (entry) => {
    const url = typeof entry === 'string' ? entry : entry?.url
    if (!url) return null
    const { res, json } = await requestJson(`${ORIGIN}/api/ucfiles/resolve`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ downloadUrl: url }),
    })
    const data = json?.data
    if (!res.ok || !json?.success || !data?.url) return null
    return { url: data.url, fileName: data.filename, sizeBytes: Number(data.size) || undefined }
  })
  const files = resolved.filter(Boolean)
  if (!files.length) return { resolvable: false, openUrl: pageUrl, reason: 'UC.Files resolve failed' }
  if (files.length === 1) return { resolvable: true, ...files[0] }
  return { resolvable: true, files }
}

module.exports = {
  id: ID,
  name: 'UnionCrax',
  homepage: ORIGIN,
  // Real API → safe to bulk-browse; Steam-AppID keyed. Exposes genres, release
  // date and size; can sort by recency but has no popularity signal.
  capabilities: {
    search: true,
    catalog: true,
    appid: true,
    bulkBrowse: true,
    tags: true,
    releaseDate: true,
    size: true,
    sort: ['latest', 'updated', 'title'],
  },
  getDetail,
  search,
  listCatalog,
  query,
  listTags,
  resolveDownload,
  _internal: { fetchCatalog, normalize },
}
