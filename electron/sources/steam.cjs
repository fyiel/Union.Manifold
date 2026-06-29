'use strict'

// Steam title to AppID resolver. Some sources (SteamRIP) expose no AppID in
// their markup, which hurts cross-source dedup (appid is the strongest merge
// key), so we ask Steam's public store search and cache the answer per session.
// Best-effort: a miss returns null and the caller falls back to title-only
// dedup (still works via the normalized-title bridge in schema.mergeGames).

const { requestJson } = require('./http.cjs')
const { normalizeTitle } = require('./schema.cjs')

// normalizedTitle -> appid | null (null is cached too, so we don't re-ask for
// titles Steam doesn't know, e.g. non-Steam games).
const _cache = new Map()

// appid -> { description, genres, releaseYear, headerImage, screenshots } | null
const _details = new Map()

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

// Fetch Steam store details for an AppID, used to fill gaps (description,
// genres, release year) for sources that ship thin metadata like SteamRIP's WP
// posts which are sometimes empty. Best-effort. We cache real responses (a hit
// or a genuine "not on Steam" miss) but NOT transient failures, so a timeout
// during one launch doesn't poison the appid for the rest of the session.
async function getStoreDetails(appid) {
  const id = Number(appid)
  if (!Number.isFinite(id) || id <= 0) return null
  if (_details.has(id)) return _details.get(id)

  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=${id}&l=en&cc=US`
    const { res, json } = await requestJson(url, { timeout: 9000, retries: 1 })
    const data = res.ok && json?.[id]?.success ? json[id].data : null

    let out = null
    if (data) {
      const dateStr = data.release_date?.date || ''
      const ym = dateStr.match(/\b(19|20)\d{2}\b/)
      out = {
        description: stripHtml(data.short_description || data.about_the_game || ''),
        genres: Array.isArray(data.genres) ? data.genres.map((g) => g.description).filter(Boolean) : [],
        releaseYear: ym ? Number(ym[0]) : null,
        // Authoritative, content-hashed art URLs from the store API. Needed for
        // titles whose flat `store_item_assets/.../library_600x900.jpg` path
        // 404s (newer games keep art only under the hashed path) like
        // "Rugrats Retro Rewind Collection" (3817710).
        headerImage: data.header_image || '',
        background: data.background_raw || data.background || '',
        screenshots: Array.isArray(data.screenshots) ? data.screenshots.map((s) => s.path_full || s.path_thumbnail).filter(Boolean) : [],
      }
    }

    // Got a real response, cache it (a null here is a genuine non-steam miss).
    _details.set(id, out)
    return out
  } catch {
    // Transient failure (timeout/network), leave uncached so a later call retries.
    return null
  }
}

// Resolve a game title to a Steam AppID, or null.
async function searchAppId(title) {
  const norm = normalizeTitle(title)
  if (!norm) return null
  if (_cache.has(norm)) return _cache.get(norm)

  let appid = null
  try {
    const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(norm)}&cc=US&l=en`
    const { res, json } = await requestJson(url, { timeout: 8000, retries: 1 })
    const items = res.ok && Array.isArray(json?.items) ? json.items : []
    if (items.length) {
      // Prefer an item whose name normalizes to the same key; else take the top
      // hit (Steam already ranks by relevance).
      const exact = items.find((it) => normalizeTitle(it.name) === norm)
      const pick = exact || items[0]
      const id = Number(pick?.id)
      if (Number.isFinite(id) && id > 0) appid = id
    }
  } catch {
    appid = null
  }

  _cache.set(norm, appid)
  return appid
}

module.exports = { searchAppId, getStoreDetails }
