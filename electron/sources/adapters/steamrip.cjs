'use strict'

// SteamRIP (steamrip.com) adapter. Standard WordPress site, the WP REST API
// hands back fully-rendered post objects in bulk so a whole catalog page is one
// request (no per-game fetch), cheap enough for bulkBrowse. Catalog/search hits
// GET /wp-json/wp/v2/posts (paged or ?search=). SteamRIP prints no Steam AppID,
// but most posts embed Steam CDN screenshots whose URL carries it (findSteamAppId),
// and when a post has none we fall back to Steam store search on the detail view
// (kept out of bulk browse to avoid hammering Steam). Posts list mirror buttons
// (gofile, buzzheavier, megadb, ...): the host resolvers turn buzzheavier/pixeldrain
// into direct links, the rest fall back to "open in browser".

const { requestJson, requestText, mapLimit, decodeEntities, stripTags } = require('../http.cjs')
const { detectHostType, isResolvable } = require('../hosts/index.cjs')
const { findSteamAppId } = require('../parse.cjs')
const { makeGame, parseSizeToBytes } = require('../schema.cjs')
const steam = require('../steam.cjs')

const ID = 'steamrip'
const ORIGIN = 'https://steamrip.com'
const API = `${ORIGIN}/wp-json/wp/v2`
const FIELDS = 'id,slug,link,title,content,date,modified,categories'
const TITLE_SUFFIX = /\s*free\s+download\s*$/i

// WP category taxonomy (Action, Indie, ...) doubles as the genre/tag list.
// id -> name and name(lower) -> id, fetched once and cached.
let _cats = { at: 0, byId: new Map(), byName: new Map() }
const CATS_TTL_MS = 1000 * 60 * 60 * 6

// Game post slugs from the WP sitemap. SteamRIP's WP `?search=` is unreliable
// (multi-word queries return recent posts, not title matches, so "alan wake 2"
// misses the actual post), so search matches against slugs instead, like the
// AnkerGames/GameBounty adapters. Cached 6h.
let _slugCache = { at: 0, slugs: [] }
const SLUG_TTL_MS = 1000 * 60 * 60 * 6
const SR_SEARCH_CONCURRENCY = 6

// Pull every game post slug from steamrip's wp-sitemap (posts-post-* shards).
async function allSlugs() {
  const now = Date.now()
  if (_slugCache.slugs.length && now - _slugCache.at < SLUG_TTL_MS) return _slugCache.slugs

  let indexXml = ''
  try { ;({ text: indexXml } = await requestText(`${ORIGIN}/wp-sitemap.xml`)) } catch { indexXml = '' }
  const shards = []
  const locRe = /<loc>\s*([^<]*wp-sitemap-posts-post-\d+\.xml)\s*<\/loc>/g
  let m
  while ((m = locRe.exec(indexXml))) shards.push(m[1].trim())
  if (!shards.length) shards.push(`${ORIGIN}/wp-sitemap-posts-post-1.xml`)

  const seen = new Set()
  for (const shard of shards) {
    let xml
    try { ;({ text: xml } = await requestText(shard)) } catch { continue }
    const re = /<loc>\s*https?:\/\/[^/]+\/([^<\/]+)\/?\s*<\/loc>/g
    let mm
    while ((mm = re.exec(xml))) {
      const slug = mm[1].replace(/\/+$/, '')
      // Skip static pages; game posts are the "<name>-free-download[-...]" slugs.
      if (slug && !/^(about|contact|privacy|terms|dmca|faq|how-to|request)/i.test(slug)) seen.add(slug)
    }
  }
  _slugCache = { at: now, slugs: Array.from(seen) }
  return _slugCache.slugs
}

async function loadCategoryMap() {
  const now = Date.now()
  if (_cats.byId.size && now - _cats.at < CATS_TTL_MS) return _cats
  const { res, json } = await requestJson(`${API}/categories?per_page=100&_fields=id,name,count`)
  const byId = new Map()
  const byName = new Map()
  if (res.ok && Array.isArray(json)) {
    for (const c of json) {
      if (!c?.id || !c?.name) continue
      byId.set(c.id, { name: c.name, count: Number(c.count) || 0 })
      byName.set(String(c.name).toLowerCase(), c.id)
    }
  }
  _cats = { at: now, byId, byName }
  return _cats
}

function genresFor(categoryIds) {
  if (!Array.isArray(categoryIds)) return []
  return categoryIds.map((id) => _cats.byId.get(id)?.name).filter(Boolean)
}

// File hosts SteamRIP links out to. An anchor is treated as a download mirror
// when it carries the site's button class OR points at one of these.
const FILE_HOSTS =
  /(gofile\.io|bzzhr\.to|buzzheavier\.com|megadb\.net|datanodes\.to|1fichier\.com|akirabox\.com|pixeldrain\.com|mega\.nz|mediafire\.com|fileditch|filecrypt\.cc|qiwi\.gg)/i

function steamImage(appid, kind) {
  return `https://shared.steamstatic.com/store_item_assets/steam/apps/${appid}/${kind}`
}

// Split a SteamRIP post title into a clean title + version.
function cleanTitle(rendered) {
  let t = decodeEntities(String(rendered || '')).trim()
  let version = ''
  // Trailing "(v1.02)" / "(Build 123)" / "(Update 4)".
  const vm = t.match(/\(\s*(?:v\.?\s*)?([\w.\-]+(?:\s*build\s*\d+)?)\s*\)\s*$/i)
  if (vm && /[\d]/.test(vm[1])) {
    version = vm[1].replace(/^v\.?\s*/i, '')
    t = t.slice(0, vm.index).trim()
  }
  t = t.replace(TITLE_SUFFIX, '').trim()
  return { title: t, version }
}

// First couple of body paragraphs as a plain-text blurb.
function blurb(content) {
  const paras = []
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi
  let m
  while ((m = re.exec(content)) && paras.length < 3) {
    const text = stripTags(m[1])
    // Skip boilerplate lines (the "About / How to install" headers leak in).
    if (text && text.length > 30 && !/^how to|^click the|^note:/i.test(text)) paras.push(text)
  }
  return paras.join('\n\n').slice(0, 800)
}

function findSize(content) {
  const m =
    content.match(/(?:game\s*size|size)\s*[:\-]?\s*([\d.]+\s*(?:TB|GB|MB))/i) ||
    content.match(/([\d.]+\s*(?:TB|GB))\b/i)
  return m ? parseSizeToBytes(m[1]) : undefined
}

function extractDownloadOptions(content) {
  const options = []
  const seen = new Set()
  const re = /<a\b([^>]*)href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/gi
  let m
  while ((m = re.exec(content))) {
    const attrs = `${m[1]} ${m[3]}`
    const url = decodeEntities(m[2]).trim()
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue
    let host
    try {
      host = new URL(url).hostname.toLowerCase()
    } catch {
      continue
    }
    const isButton = /shortc-button|btn|download/i.test(attrs) || /download/i.test(stripTags(m[4]))
    if (!FILE_HOSTS.test(host) && !(isButton && !/steamrip\.com$/i.test(host))) continue
    if (/steamrip\.com$|steampowered|steamstatic|youtu|discord|reddit|t\.me|patreon/i.test(host)) continue
    seen.add(url)
    const hostType = detectHostType(url)
    options.push({ label: hostType, hostType, url, resolvable: isResolvable(url) })
  }
  // Auto-resolvable mirrors first.
  options.sort((a, b) => Number(b.resolvable) - Number(a.resolvable))
  return options
}

// Build a NormalizedGame from a WP post object.
function postToGame(post, appid) {
  const content = post?.content?.rendered || ''
  const { title, version } = cleanTitle(post?.title?.rendered)
  const finalAppid = appid || findSteamAppId(content) || null
  const slug = post?.slug || ''
  return makeGame({
    sourceId: ID,
    sourceSlug: slug,
    sourceUrl: post?.link || `${ORIGIN}/${slug}/`,
    steamAppId: finalAppid,
    title,
    description: blurb(content),
    image: finalAppid ? steamImage(finalAppid, 'library_600x900.jpg') : '',
    heroImage: finalAppid ? steamImage(finalAppid, 'library_hero.jpg') : '',
    genres: genresFor(post?.categories),
    // SteamRIP doesn't print the game's release date, but WP gives us when the
    // post was published (added) and last modified (updated).
    addedAt: post?.date || null,
    updatedAt: post?.modified || null,
    version,
    sizeBytes: findSize(content),
    downloadOptions: extractDownloadOptions(content),
  })
}

// Map a unified sort key to a WP REST orderby (popularity isn't available).
const WP_ORDERBY = { latest: 'date', updated: 'modified', title: 'title', relevance: 'relevance' }

// ── Adapter interface ──

async function listCatalog({ offset = 0, limit = 24 } = {}) {
  await loadCategoryMap()
  const page = Math.floor(offset / limit) + 1
  const url = `${API}/posts?per_page=${limit}&page=${page}&_fields=${FIELDS}`
  const { res, json } = await requestJson(url)
  if (!res.ok || !Array.isArray(json)) return []
  return json.map((post) => postToGame(post, null)).filter((g) => g.title)
}

async function search(query, { limit = 24 } = {}) {
  const q = String(query || '').toLowerCase().trim()
  if (!q) return []
  const terms = q.split(/\s+/)
  // Slug match (reliable), every query term must appear in the slug's words.
  // Slugs look like "alan-wake-2-free-download-v12" where the "-free-download"
  // suffix is harmless noise that never blocks a term match.
  let matches = []
  try {
    const slugs = await allSlugs()
    matches = slugs.filter((s) => {
      const hay = ' ' + s.replace(/-/g, ' ') + ' '
      return terms.every((t) => hay.includes(t))
    }).slice(0, limit)
  } catch { /* fall through to WP search */ }

  if (matches.length) {
    return (await mapLimit(matches, SR_SEARCH_CONCURRENCY, (slug) => getDetail(slug).catch(() => null))).filter(Boolean)
  }

  // Fallback: WP ?search= (works for some single-word queries; unreliable for
  // multi-word, hence the slug path above is tried first).
  await loadCategoryMap()
  const url = `${API}/posts?search=${encodeURIComponent(q)}&per_page=${limit}&_fields=${FIELDS}`
  const { res, json } = await requestJson(url)
  if (!res.ok || !Array.isArray(json)) return []
  const games = json.map((post) => postToGame(post, null)).filter((g) => g.title)
  const titled = games.filter((g) => terms.every((t) => g.title.toLowerCase().includes(t)))
  return titled.length ? titled : games
}

// Native candidate pool. WP REST does the heavy lifting server-side (text
// search, category/tag filter, recency ordering by date/modified/title) so the
// right games land in the pool. Popularity isn't available, the registry applies
// the authoritative cross-source filter + sort on top.
async function query({ text = '', tags = [], sort = '', limit = 36 } = {}) {
  await loadCategoryMap()
  const p = new URLSearchParams({ per_page: String(Math.min(limit, 100)), _fields: FIELDS })
  if (text && text.trim()) p.set('search', text.trim())
  const catIds = (Array.isArray(tags) ? tags : [])
    .map((t) => _cats.byName.get(String(t).toLowerCase()))
    .filter(Boolean)
  if (catIds.length) p.set('categories', catIds.join(','))
  const orderby = WP_ORDERBY[sort] || (text ? 'relevance' : 'date')
  p.set('orderby', orderby)
  p.set('order', 'desc')
  const { res, json } = await requestJson(`${API}/posts?${p.toString()}`)
  if (!res.ok || !Array.isArray(json)) return []
  return json.map((post) => postToGame(post, null)).filter((g) => g.title)
}

// Category taxonomy as the tag list (name + post count), most-used first.
async function listTags() {
  const { byId } = await loadCategoryMap()
  return Array.from(byId.values())
    .sort((a, b) => b.count - a.count)
    .map((c) => c.name)
}

async function getDetail(slug) {
  const clean = String(slug || '').replace(/^\/+|\/+$/g, '')
  await loadCategoryMap()
  const url = `${API}/posts?slug=${encodeURIComponent(clean)}&_fields=${FIELDS}`
  const { res, json } = await requestJson(url)
  const post = res.ok && Array.isArray(json) ? json[0] : null
  if (!post) throw new Error(`steamrip detail miss for ${clean}`)
  // No appid in the markup? Ask Steam once (cached) so cross-source dedup gets
  // the strong key. Only here, never in bulk browse.
  let appid = findSteamAppId(post?.content?.rendered || '')
  if (!appid) appid = await steam.searchAppId(cleanTitle(post?.title?.rendered).title)
  return postToGame(post, appid)
}

// SteamRIP options carry real URLs, resolution is host-based.
async function resolveDownload(option) {
  const { resolveUrl } = require('../hosts/index.cjs')
  return resolveUrl(option.url)
}

module.exports = {
  id: ID,
  name: 'SteamRIP',
  homepage: ORIGIN,
  // WP REST exposes genres (categories) and recency (date/modified), filterable
  // and sortable server-side. It does NOT expose the game's release date or any
  // popularity signal, so release-year filter + "popular" sort don't apply here.
  capabilities: {
    search: true,
    catalog: true,
    appid: false,
    bulkBrowse: true,
    tags: true,
    releaseDate: false,
    size: false,
    sort: ['latest', 'updated', 'title'],
  },
  listCatalog,
  search,
  query,
  listTags,
  getDetail,
  resolveDownload,
  _internal: { postToGame, cleanTitle, extractDownloadOptions, loadCategoryMap },
}
