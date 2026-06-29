'use strict'

/**
 * Normalized data shapes for the multi-source catalog, plus dedup/merge logic.
 *
 * Every adapter emits `NormalizedGame` objects. The registry (index.cjs) folds
 * the per-source games into `UnifiedGame` records keyed by a `dedupKey` so the
 * same title coming from several sites collapses to one card carrying multiple
 * source mirrors — "no duped titles".
 *
 * @typedef {Object} DownloadOption
 * @property {string}  label        human label ("pixeldrain", "Mirror 1", ...)
 * @property {string}  hostType     resolver key (pixeldrain|dlproxy|gofile|...)
 * @property {string} [url]         a starting URL we can hand to a host resolver
 * @property {string} [pageUrl]     an intermediate/container page if relevant
 * @property {string} [fileName]
 * @property {number} [sizeBytes]
 * @property {string} [sizeText]
 * @property {boolean} resolvable   can we auto-resolve to a direct aria2 URL?
 *
 * @typedef {Object} NormalizedGame
 * @property {string}  sourceId
 * @property {string}  sourceSlug
 * @property {string}  sourceUrl
 * @property {number|null} steamAppId
 * @property {string}  dedupKey
 * @property {string}  title
 * @property {string} [description]
 * @property {string} [image]
 * @property {string} [heroImage]
 * @property {string[]} [genres]
 * @property {string} [developer]
 * @property {string} [releaseDate]
 * @property {string} [version]
 * @property {number} [sizeBytes]
 * @property {string} [sizeText]
 * @property {boolean}[nsfw]
 * @property {DownloadOption[]} [downloadOptions]
 */

/** Words that describe an edition/region, dropped when building a title key so
 *  "Elden Ring Deluxe Edition" and "Elden Ring" dedup together. */
const EDITION_NOISE = [
  'ultimate', 'deluxe', 'goty', 'game of the year', 'complete', 'definitive',
  'enhanced', 'remastered', 'gold', 'premium', 'standard', 'edition', 'bundle',
  'collection', 'anniversary', 'directors cut', 'repack', 'pre installed',
  'pre-installed', 'free download', 'pc',
]

function normalizeTitle(title) {
  let t = String(title || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/&/g, ' and ')
    .replace(/[™®©]/g, ' ') // ™ ® ©
    // drop trailing version/build parentheticals: "(v1.2 | Build 123)"
    .replace(/\((?:[^)]*\b(?:v\d|build|update|version)\b[^)]*)\)/gi, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  for (const word of EDITION_NOISE) {
    t = t.replace(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), ' ')
  }
  return t.replace(/\s+/g, ' ').trim()
}

/** Primary dedup key: Steam AppID when known, else a normalized-title key. */
function dedupKeyFor({ steamAppId, title }) {
  if (steamAppId != null && Number.isFinite(Number(steamAppId)) && Number(steamAppId) > 0) {
    return `steam:${Number(steamAppId)}`
  }
  const norm = normalizeTitle(title)
  return norm ? `title:${norm}` : `title:unknown`
}

/** Build a NormalizedGame, filling dedupKey + tidying fields. */
function makeGame(input) {
  const steamAppId =
    input.steamAppId != null && Number.isFinite(Number(input.steamAppId)) && Number(input.steamAppId) > 0
      ? Number(input.steamAppId)
      : null
  const title = String(input.title || '').trim()
  return {
    sourceId: input.sourceId,
    sourceSlug: String(input.sourceSlug || ''),
    sourceUrl: String(input.sourceUrl || ''),
    steamAppId,
    dedupKey: dedupKeyFor({ steamAppId, title }),
    title,
    description: input.description || '',
    image: input.image || '',
    heroImage: input.heroImage || '',
    genres: Array.isArray(input.genres) ? input.genres.filter(Boolean) : [],
    developer: input.developer || '',
    releaseDate: input.releaseDate || '',
    // Sort/filter signals (best-effort; null when a source doesn't expose them):
    //   releaseYear → release-year filter; addedAt → "latest"; updatedAt →
    //   "recently updated"; popularity → "popular" (a source-provided count/score).
    releaseYear: input.releaseYear != null ? Number(input.releaseYear) : yearFrom(input.releaseDate),
    addedAt: toEpochMs(input.addedAt),
    updatedAt: toEpochMs(input.updatedAt),
    popularity: Number.isFinite(Number(input.popularity)) ? Number(input.popularity) : null,
    version: input.version != null ? String(input.version) : '',
    sizeBytes: Number.isFinite(input.sizeBytes) ? input.sizeBytes : undefined,
    sizeText: input.sizeText || '',
    nsfw: Boolean(input.nsfw),
    downloadOptions: Array.isArray(input.downloadOptions) ? input.downloadOptions : [],
  }
}

/** Parse a date-ish value (ISO string, "5 Dec, 2024", epoch) → epoch ms | null. */
function toEpochMs(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const ms = Date.parse(String(value))
  return Number.isFinite(ms) ? ms : null
}

/** Pull a 4-digit release year (1970–2099) out of a date string → number | null. */
function yearFrom(value) {
  const m = String(value || '').match(/\b(19[789]\d|20[0-9]\d)\b/)
  return m ? Number(m[1]) : null
}

/** Parse "1.6 GB" / "118.5GB" / "900 MB" → bytes (best-effort). */
function parseSizeToBytes(text) {
  if (typeof text === 'number') return text
  const m = String(text || '').match(/([\d.]+)\s*(TB|GB|MB|KB|B)\b/i)
  if (!m) return undefined
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return undefined
  const unit = m[2].toUpperCase()
  const mult = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 }[unit]
  return Math.round(n * mult)
}

/** Fold source `g` into the accumulating unified record `u` (best-of fields). */
function accumulate(u, g) {
  u.sources.push(g)
  if (u.steamAppId == null && g.steamAppId != null) u.steamAppId = g.steamAppId
  if ((g.description || '').length > (u.description || '').length) u.description = g.description
  if (!u.image && g.image) u.image = g.image
  if (!u.heroImage && g.heroImage) u.heroImage = g.heroImage
  if (!u.developer && g.developer) u.developer = g.developer
  if (!u.releaseDate && g.releaseDate) u.releaseDate = g.releaseDate
  if (!u.sizeBytes && g.sizeBytes) { u.sizeBytes = g.sizeBytes; u.sizeText = g.sizeText }
  if (!u.version && g.version) u.version = g.version
  u.nsfw = u.nsfw || g.nsfw
  u.genres = Array.from(new Set([...(u.genres || []), ...(g.genres || [])]))
  // Sort signals: take the strongest across sources — most recent add/update,
  // highest popularity, any known release year.
  if (u.releaseYear == null && g.releaseYear != null) u.releaseYear = g.releaseYear
  if (g.addedAt != null && (u.addedAt == null || g.addedAt > u.addedAt)) u.addedAt = g.addedAt
  if (g.updatedAt != null && (u.updatedAt == null || g.updatedAt > u.updatedAt)) u.updatedAt = g.updatedAt
  if (g.popularity != null && (u.popularity == null || g.popularity > u.popularity)) u.popularity = g.popularity
}

/**
 * Merge per-source games into deduped UnifiedGame records.
 *
 * Two source records are the same game when they share EITHER a Steam AppID OR
 * a normalized title — unioned transitively (union-find). The title bridge
 * matters because the same title can carry different appids across sources
 * (e.g. non-Steam titles like Forza get placeholder ids), so appid-only keying
 * would wrongly split them. Best-of scalar fields win; every contributing
 * source is preserved under `sources` for the detail page's mirror list.
 *
 * @param {NormalizedGame[]} games
 * @returns {Array<UnifiedGame>}
 */
function mergeGames(games) {
  const valid = games.filter((g) => g && g.title)
  const n = valid.length

  // Union-find over the source records.
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (x) => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] }
    return x
  }
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b }

  const firstByAppid = new Map() // `a:${appid}` -> index
  const firstByTitle = new Map() // normalizedTitle -> index
  valid.forEach((g, i) => {
    if (g.steamAppId != null) {
      const k = `a:${g.steamAppId}`
      if (firstByAppid.has(k)) union(i, firstByAppid.get(k)); else firstByAppid.set(k, i)
    }
    const nt = normalizeTitle(g.title)
    if (nt) {
      if (firstByTitle.has(nt)) union(i, firstByTitle.get(nt)); else firstByTitle.set(nt, i)
    }
  })

  // Group by component root, accumulating in input order.
  const byRoot = new Map()
  valid.forEach((g, i) => {
    const root = find(i)
    let u = byRoot.get(root)
    if (!u) {
      u = {
        dedupKey: g.dedupKey,
        steamAppId: g.steamAppId,
        title: g.title,
        description: g.description,
        image: g.image,
        heroImage: g.heroImage,
        genres: [...(g.genres || [])],
        developer: g.developer,
        releaseDate: g.releaseDate,
        releaseYear: g.releaseYear ?? null,
        addedAt: g.addedAt ?? null,
        updatedAt: g.updatedAt ?? null,
        popularity: g.popularity ?? null,
        version: g.version,
        sizeBytes: g.sizeBytes,
        sizeText: g.sizeText,
        nsfw: g.nsfw,
        sources: [g],
      }
      byRoot.set(root, u)
    } else {
      accumulate(u, g)
    }
  })

  // Re-derive the canonical dedupKey now that the appid may have been backfilled.
  for (const u of byRoot.values()) {
    u.dedupKey = dedupKeyFor({ steamAppId: u.steamAppId, title: u.title })
  }
  return Array.from(byRoot.values())
}

module.exports = {
  EDITION_NOISE,
  normalizeTitle,
  dedupKeyFor,
  makeGame,
  parseSizeToBytes,
  toEpochMs,
  yearFrom,
  mergeGames,
}
