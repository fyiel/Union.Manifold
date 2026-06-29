'use strict'

/**
 * GameBounty (gamebounty.world) adapter.
 *
 * Next.js App Router site, no captcha, all data embedded in the page HTML under
 * a `post` object inside the RSC flight. Steam AppID is exposed everywhere
 * (ideal dedup key) and download mirrors are listed inline — pixeldrain mirrors
 * are directly aria2-ready.
 *
 * - Enumerate: GET /sitemap.xml → all `<loc>` ending in `-free-pc-download`.
 * - Detail:    GET the page → parse `post` (appid, title, genres, version,
 *              size, container.mirrors).
 * - Download:  mirrors carry real URLs (pixeldrain/fileq/fileditch); the host
 *              resolvers turn pixeldrain into a direct link.
 */

const { request, requestText, mapLimit } = require('../http.cjs')
const { collectNextFlight, findObjectByKey, findSteamAppId } = require('../parse.cjs')
const { detectHostType, isResolvable } = require('../hosts/index.cjs')
const { makeGame, parseSizeToBytes } = require('../schema.cjs')

const ID = 'gamebounty'
const ORIGIN = 'https://gamebounty.world'
const SLUG_SUFFIX = '-free-pc-download'

let _slugCache = { at: 0, slugs: [] }
const SLUG_TTL_MS = 1000 * 60 * 60 * 6

function titleFromSlug(slug) {
  return slug
    .replace(new RegExp(`${SLUG_SUFFIX}$`), '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

/** All game slugs from the sitemap (cached). */
async function allSlugs() {
  const now = Date.now()
  if (_slugCache.slugs.length && now - _slugCache.at < SLUG_TTL_MS) return _slugCache.slugs
  const { text } = await requestText(`${ORIGIN}/sitemap.xml`)
  const slugs = []
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/g
  let m
  while ((m = re.exec(text))) {
    try {
      const u = new URL(m[1])
      if (u.hostname.endsWith('gamebounty.world')) {
        const path = u.pathname.replace(/^\/+|\/+$/g, '')
        if (path.endsWith(SLUG_SUFFIX)) slugs.push(path)
      }
    } catch {
      /* ignore */
    }
  }
  _slugCache = { at: now, slugs }
  return slugs
}

function steamImage(appid, kind) {
  return `https://shared.steamstatic.com/store_item_assets/steam/apps/${appid}/${kind}`
}

function mirrorsToOptions(container) {
  const data = container?.data || container
  const mirrors = Array.isArray(data?.mirrors) ? data.mirrors : []
  const options = []
  for (const mirror of mirrors) {
    const links = Array.isArray(mirror?.links) ? mirror.links : []
    for (const link of links) {
      const url = link?.url
      if (!url) continue
      const hostType = detectHostType(url)
      options.push({
        label: mirror.name || hostType,
        hostType,
        url,
        fileName: link.file_name || data?.name,
        sizeBytes: parseSizeToBytes(link.file_size || data?.size_human) || (Number(data?.size_bytes) || undefined),
        sizeText: link.file_size || data?.size_human || '',
        resolvable: isResolvable(url),
      })
    }
  }
  // Prefer auto-resolvable mirrors (pixeldrain) first.
  options.sort((a, b) => Number(b.resolvable) - Number(a.resolvable))
  return options
}

/** Parse a GameBounty game page into a NormalizedGame. */
function parseGamePage(html, slug) {
  const flight = collectNextFlight(html)
  const post = findObjectByKey(flight, 'post') || {}
  const appid = post.appid ? Number(post.appid) : findSteamAppId(html)

  const container = post.container
  const downloadOptions = mirrorsToOptions(container)

  const image =
    post.library_capsule ||
    post.banner ||
    (appid ? steamImage(appid, 'library_600x900.jpg') : '')

  return makeGame({
    sourceId: ID,
    sourceSlug: slug,
    sourceUrl: `${ORIGIN}/${slug}`,
    steamAppId: appid || null,
    title: post.title || titleFromSlug(slug),
    description: post.mini_description || stripHtml(post.description) || '',
    image,
    heroImage: post.library_hero || (appid ? steamImage(appid, 'library_hero.jpg') : ''),
    genres: Array.isArray(post.genres) ? post.genres : [],
    developer: post.developer || '',
    releaseDate: post.release_date || '',
    // GameBounty exposes real engagement counts → genuine popularity signal,
    // plus created/updated timestamps for the recency sorts.
    addedAt: post.created_at || null,
    updatedAt: post.updated_at || post.edited_at || null,
    popularity: Number(post.view_count) || Number(post.down_count) || null,
    version: post.version || post.build_id || '',
    sizeBytes: parseSizeToBytes(post.container?.data?.size_human) || Number(post.container?.data?.size_bytes) || undefined,
    sizeText: post.container?.data?.size_human || '',
    nsfw: Boolean(post.is_nsfw),
    downloadOptions,
  })
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

// ── Adapter interface ──

async function getDetail(slug) {
  const path = slug.endsWith(SLUG_SUFFIX) ? slug : `${slug}${SLUG_SUFFIX}`
  const { res, text } = await requestText(`${ORIGIN}/${path}`)
  if (!res.ok) throw new Error(`gamebounty detail ${res.status} for ${path}`)
  return parseGamePage(text, path)
}

/**
 * Lightweight search: filter sitemap slugs by the query, then hydrate the top
 * matches with a detail fetch (so the card has art + appid + mirrors).
 */
async function search(query, { limit = 24 } = {}) {
  const q = String(query || '').toLowerCase().trim()
  if (!q) return []
  const slugs = await allSlugs()
  const terms = q.split(/\s+/)
  const scored = []
  for (const slug of slugs) {
    const hay = slug.replace(SLUG_SUFFIX, '').replace(/-/g, ' ')
    if (terms.every((t) => hay.includes(t))) scored.push(slug)
  }
  const top = scored.slice(0, limit)
  return (await mapLimit(top, 8, (slug) => getDetail(slug))).filter(Boolean)
}

/** Catalog page: slug list → hydrate a window of detail pages (concurrently). */
async function listCatalog({ offset = 0, limit = 24 } = {}) {
  const slugs = await allSlugs()
  const window = slugs.slice(offset, offset + limit)
  return (await mapLimit(window, 8, (slug) => getDetail(slug))).filter(Boolean)
}

/** GameBounty download options carry real URLs — resolution is host-based. */
async function resolveDownload(option) {
  const { resolveUrl } = require('../hosts/index.cjs')
  return resolveUrl(option.url)
}

module.exports = {
  id: ID,
  name: 'GameBounty',
  homepage: ORIGIN,
  // bulkBrowse: safe to hydrate a whole catalog page (no aggressive rate limit).
  // Richest metadata of the sources — genres, release date, size, view/download
  // counts (real popularity) and created/updated timestamps. The catalog is a
  // bare slug list though, so global sort spans only the hydrated browse window.
  capabilities: {
    search: true,
    catalog: true,
    appid: true,
    bulkBrowse: true,
    tags: true,
    releaseDate: true,
    size: true,
    sort: ['popular', 'latest', 'updated', 'title'],
  },
  getDetail,
  search,
  listCatalog,
  resolveDownload,
  _internal: { allSlugs, parseGamePage },
}
