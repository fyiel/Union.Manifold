'use strict'

// AnkerGames (ankergames.net) adapter. Laravel/Inertia site behind Cloudflare.
// Catalog comes from the Livewire /games-list listing (with a sitemap fallback).
// Downloads use the confirmed three-step flow: GET /csrf-token returns a token +
// session cookie, POST /generate-download-url/{id} (X-CSRF-TOKEN + body
// {"g-recaptcha-response":"development-mode"}, captcha is disabled) returns a
// download_url, GET that returns an HTML page whose downloadPage('<encoded url>')
// Alpine init holds the real file link (decodeURIComponent). Direct titles
// resolve to *.dlproxy.uk, some use an external host the resolvers handle. The
// dlproxy link is short-lived/IP-locked so resolveDownload() runs the flow
// just-in-time, right before enqueue.

const { request, requestText, requestJson, CookieJar, decodeEntities, mapLimit } = require('../http.cjs')
const { findSteamAppId, firstMatch } = require('../parse.cjs')
const { resolveUrl } = require('../hosts/index.cjs')
const { makeGame, parseSizeToBytes } = require('../schema.cjs')

const ID = 'ankergames'
const ORIGIN = 'https://ankergames.net'
const LIST_PAGE_SIZE = 56 // ankergames /games-list renders 56 cards per page

let _slugCache = { at: 0, slugs: [] }
let _slugInflight = null
const SLUG_TTL_MS = 1000 * 60 * 60 * 6
// ankergames.net rate-limits aggressively (429 on any burst), so the whole
// adapter is built to minimize request volume: single-flight the shared fetches
// so concurrent browses share one round trip, cache browse results, search off
// the cached slug list with no per-game hits, and keep fallback hydration gentle.
const AK_CONCURRENCY = 2
const AK_RETRIES = 4 // extra attempts, paired with the http layer's 429 backoff

function titleFromSlug(slug) {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim()
}

function extractGameSlugs(markup) {
  // Matches both page hrefs (href="/game/slug", href="https://.../game/slug")
  // and sitemap <loc>https://ankergames.net/game/slug</loc> entries.
  const slugs = new Set()
  const re = /\/game\/([a-z0-9][a-z0-9-]*)/g
  let m
  while ((m = re.exec(markup))) slugs.add(m[1])
  return Array.from(slugs)
}

// Build the full slug list from the sitemap index. /sitemap.xml is a
// <sitemapindex> pointing at sitemap_post_N.xml shards that list every
// /game/{slug} (~1.6k titles). The on-page listing only shows the homepage/nav
// subset and ?search= doesn't actually filter, so the sitemap is the reliable
// enumeration source. Cached.
async function allSlugs() {
  const now = Date.now()
  if (_slugCache.slugs.length && now - _slugCache.at < SLUG_TTL_MS) return _slugCache.slugs
  // single-flight: concurrent callers share one sitemap crawl instead of each
  // firing their own (which is what gets us rate limited)
  if (_slugInflight) return _slugInflight
  _slugInflight = (async () => {
    let indexXml = ''
    try {
      ;({ text: indexXml } = await requestText(`${ORIGIN}/sitemap.xml`, { retries: AK_RETRIES }))
    } catch {
      indexXml = ''
    }
    const shards = []
    const locRe = /<loc>\s*([^<]+sitemap_post_\d+\.xml)\s*<\/loc>/g
    let m
    while ((m = locRe.exec(indexXml))) shards.push(m[1].trim())
    if (!shards.length) shards.push(`${ORIGIN}/sitemap_post_1.xml`) // best-effort fallback

    const seen = new Set()
    for (const shard of shards) {
      let xml
      try {
        ;({ text: xml } = await requestText(shard, { retries: AK_RETRIES }))
      } catch {
        continue
      }
      for (const slug of extractGameSlugs(xml)) seen.add(slug)
    }
    // keep the previous list if a crawl came back empty (rate limited), don't blank it
    if (seen.size) _slugCache = { at: Date.now(), slugs: Array.from(seen) }
    return _slugCache.slugs
  })().finally(() => { _slugInflight = null })
  return _slugInflight
}

function cleanTitle(raw) {
  return decodeEntities(raw || '')
    .replace(/\s*Free Download\b/i, '')
    .replace(/\s*[-–—]\s*AnkerGames\s*$/i, '')
    .trim()
}

function parseGamePage(html, slug) {
  const ogTitle = firstMatch(html, /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) ||
    firstMatch(html, /<title>([^<]+)<\/title>/i)
  const ogImage = firstMatch(html, /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)
  const ogDesc = firstMatch(html, /<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i) ||
    firstMatch(html, /<meta[^>]+name="description"[^>]+content="([^"]+)"/i)

  // Download ids are rendered server-side into generateDownloadUrl(NNNN) calls.
  const ids = new Set()
  const re = /generateDownloadUrl\((\d+)\)/g
  let m
  while ((m = re.exec(html))) ids.add(m[1])

  const pageUrl = `${ORIGIN}/game/${slug}`
  const downloadOptions = Array.from(ids).map((id, i) => ({
    label: ids.size > 1 ? `AnkerGames mirror ${i + 1}` : 'AnkerGames',
    hostType: 'ankergames',
    url: id, // the downloadId; resolveDownload runs the csrf flow
    pageUrl,
    resolvable: true, // optimistic, usually a direct dlproxy link
  }))

  const sizeText = firstMatch(decodeEntities(html), /(\d[\d.]*\s*(?:TB|GB|MB))\b/i)

  return makeGame({
    sourceId: ID,
    sourceSlug: slug,
    sourceUrl: pageUrl,
    steamAppId: findSteamAppId(html),
    title: cleanTitle(ogTitle) || titleFromSlug(slug),
    description: decodeEntities(ogDesc || ''),
    image: ogImage || '',
    sizeText,
    sizeBytes: parseSizeToBytes(sizeText),
    downloadOptions,
  })
}

// ── Livewire /games-list browse ──
//
// The /games-list page is a Livewire 3 component (1.6k posts, 56/page) with
// server-side filters (genre, size, release year, publisher) and a
// popular-all-time sort. We drive it directly: GET the page (http.cjs clears
// Cloudflare where a bare fetch 403s), pull the CSRF token + the component's
// `wire:snapshot`, then POST snapshot+updates+$commit to its obfuscated update
// URL. Each rendered card carries a `listing="{…}"` JSON blob with full metadata
// (title, slug, runtime=size, release_date, developer, created/updated, poster),
// so a single browse call yields complete records with no per-game page fetch.
// download ids still live on the per-game page, so `downloadOptions` stay empty
// here and hydrate lazily in getDetail()/resolveDownload().

const LW_TTL_MS = 1000 * 60 * 10
let _lw = { at: 0, csrf: '', updateUrl: '', snapshot: '', jar: null }
let _lwInflight = null

function unescapeHtmlAttr(s) {
  return String(s || '')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

// GET /games-list and capture the Livewire session bits (cached briefly). The
// cookie jar carries the session that validates the CSRF token on POST.
async function livewireSession() {
  const now = Date.now()
  if (_lw.snapshot && now - _lw.at < LW_TTL_MS) return _lw
  // single-flight: a fresh session is one GET; concurrent browses must not each
  // open their own or we instantly trip the rate limit
  if (_lwInflight) return _lwInflight
  _lwInflight = (async () => {
    const jar = new CookieJar()
    const { res, text: html } = await requestText(`${ORIGIN}/games-list`, { jar, retries: AK_RETRIES })
    if (!res.ok) throw new Error(`ankergames games-list ${res.status}`)
    const csrf = firstMatch(html, /<meta name="csrf-token" content="([^"]+)"/)
    let uri = firstMatch(html, /"uri"\s*:\s*"([^"]+\/update)"/) || ''
    uri = uri.replace(/\\\//g, '/')
    const updateUrl = uri ? (uri.startsWith('http') ? uri : ORIGIN + uri) : ''
    // The page mounts several Livewire components, pick the games-list one.
    let snapshot = ''
    for (const m of html.matchAll(/wire:snapshot="([^"]+)"/g)) {
      const s = unescapeHtmlAttr(m[1])
      try { if (JSON.parse(s)?.memo?.name === 'games-list') { snapshot = s; break } } catch { /* skip */ }
    }
    if (!csrf || !updateUrl || !snapshot) throw new Error('ankergames livewire session incomplete')
    _lw = { at: Date.now(), csrf, updateUrl, snapshot, jar }
    return _lw
  })().finally(() => { _lwInflight = null })
  return _lwInflight
}

// One Livewire commit (optionally with extra calls like gotoPage). Returns the
// rendered card HTML and the fresh snapshot to thread into the next call.
async function livewireCommit(session, updates, snapshot, extraCalls = []) {
  const body = JSON.stringify({
    _token: session.csrf,
    components: [{
      snapshot,
      updates: updates || {},
      calls: [...extraCalls, { method: '$commit', params: [], metadata: { type: 'model.live' } }],
    }],
  })
  const { res, text } = await requestText(session.updateUrl, {
    jar: session.jar,
    method: 'POST',
    retries: AK_RETRIES,
    headers: {
      'Content-Type': 'application/json', 'X-Livewire': '1', 'Accept': '*/*',
      Referer: `${ORIGIN}/games-list`, Origin: ORIGIN,
    },
    body,
  })
  if (!res.ok) throw new Error(`ankergames livewire commit ${res.status}`)
  let json
  try { json = JSON.parse(text) } catch { throw new Error('ankergames livewire bad json') }
  const comp = json?.components?.[0]
  return { html: comp?.effects?.html || '', snapshot: comp?.snapshot || snapshot }
}

// Each card: <div … listing="{…json…}">. Parse that JSON into a NormalizedGame.
function parseListingCards(html) {
  const games = []
  for (const m of html.matchAll(/listing="([^"]+)"/g)) {
    let o
    try { o = JSON.parse(unescapeHtmlAttr(m[1])) } catch { continue }
    if (!o?.slug) continue
    const sizeText = o.runtime || ''
    const version = String(o.vote_average || '').replace(/^\s*v\s*/i, '').trim()
    // The card JSON carries the game's full genre list (id/title/slug), real
    // per-game tags, so no stamping or server-side genre filter is needed. The
    // registry filters/facets over these like any other source.
    const genres = Array.isArray(o.genres)
      ? o.genres.map((g) => decodeEntities(String(g?.title || '').trim())).filter(Boolean)
      : []
    games.push(makeGame({
      sourceId: ID,
      sourceSlug: o.slug,
      sourceUrl: `${ORIGIN}/game/${o.slug}`,
      steamAppId: null,
      title: cleanTitle(o.title) || titleFromSlug(o.slug),
      image: o.imageurl || '',
      heroImage: o.coverurl || '',
      genres,
      developer: o.developer_name || '',
      releaseDate: o.release_date || '',
      addedAt: o.created_at || null,
      updatedAt: o.updated_at || null,
      version,
      sizeText,
      sizeBytes: parseSizeToBytes(sizeText),
      nsfw: String(o.nsfw || '').toLowerCase() === 'enable',
      downloadOptions: [], // hydrated by getDetail() on demand
    }))
  }
  return games
}

// Browse the listing from page 1: apply filter `updates` (+ any `firstCalls`,
// e.g. applyAllFilters) on the first commit, then page forward with gotoPage
// until `limit` records are gathered (or pages run dry). The registry fetches
// each adapter from the start and paginates the merged result itself, so this
// is intentionally offset-agnostic.
async function _doBrowse({ updates = {}, firstCalls = [], limit = 24 } = {}) {
  const session = await livewireSession()
  const out = []
  let snap = session.snapshot
  for (let page = 1; out.length < limit; page++) {
    const calls = page === 1
      ? [...firstCalls]
      : [{ method: 'gotoPage', params: [page, 'page'], metadata: { type: 'model.live' } }]
    let result
    try {
      result = await livewireCommit(session, page === 1 ? updates : {}, snap, calls)
    } catch {
      break
    }
    snap = result.snapshot
    const cards = parseListingCards(result.html)
    if (!cards.length) break
    out.push(...cards)
    if (cards.length < LIST_PAGE_SIZE) break // last page
    if (page > 14) break // safety cap (~780 records)
  }
  return out
}

const BROWSE_TTL_MS = 1000 * 60 * 5
const _browse = new Map() // key -> { at, games }
const _browseLastGood = new Map() // key -> games, no expiry, served when rate limited
const _browseInflight = new Map() // key -> Promise<games>

function browseKey({ updates = {}, firstCalls = [], limit = 24 }) {
  return JSON.stringify({ u: updates, c: firstCalls.map((x) => x.method), limit })
}

// Cached browse with a stale fallback and single-flight. Concurrent callers (a
// Ctrl+R reload restarts the renderer but NOT this main-process crawl) join the
// in-flight crawl instead of racing a second one into the rate limiter, and an
// empty crawl (almost always a 429) falls back to the last good games so
// AnkerGames still shows in the grid instead of vanishing.
async function livewireBrowse(opts = {}) {
  const key = browseKey(opts)
  const hit = _browse.get(key)
  if (hit && Date.now() - hit.at < BROWSE_TTL_MS) return hit.games
  if (_browseInflight.has(key)) return _browseInflight.get(key)
  const p = (async () => {
    let games = []
    try { games = await _doBrowse(opts) } catch { games = [] }
    if (games.length) {
      _browse.set(key, { at: Date.now(), games })
      _browseLastGood.set(key, games)
      return games
    }
    return _browseLastGood.get(key) || []
  })().finally(() => { _browseInflight.delete(key) })
  _browseInflight.set(key, p)
  return p
}

const APPLY_FILTERS_CALL = { method: 'applyAllFilters', params: [], metadata: {} }

// ── Genre taxonomy (the /games-list filter) ──
// The filter panel lists 127 genres as <input id="genreNN" value="NN" …>
// <label><span class="truncate">Name</span>. We open it once (filterOpen:true)
// and cache the id↔name map so listTags() can expose AnkerGames' full genre set
// and query() can translate a tag name → genre id for the selectedGenres filter.
const GENRE_TTL_MS = 1000 * 60 * 60 * 6
let _genres = { at: 0, idToName: new Map(), nameToId: new Map() }
let _genresInflight = null

async function livewireGenres() {
  const now = Date.now()
  if (_genres.idToName.size && now - _genres.at < GENRE_TTL_MS) return _genres
  if (_genresInflight) return _genresInflight
  _genresInflight = (async () => {
    const session = await livewireSession()
    const { html } = await livewireCommit(session, { filterOpen: true }, session.snapshot)
    const idToName = new Map(), nameToId = new Map()
    const re = /id="genre(\d+)"[\s\S]{0,300}?value="(\d+)"[\s\S]{0,900}?<span class="truncate">([^<]+)<\/span>/g
    let m
    while ((m = re.exec(html))) {
      const id = m[2]
      const name = decodeEntities(m[3].trim())
      if (id && name && !idToName.has(id)) { idToName.set(id, name); nameToId.set(name.toLowerCase(), id) }
    }
    if (idToName.size) _genres = { at: Date.now(), idToName, nameToId }
    return _genres
  })().finally(() => { _genresInflight = null })
  return _genresInflight
}

// Every genre AnkerGames' filter offers (127), for the cross-source tag list.
async function listTags() {
  try { return [...(await livewireGenres()).idToName.values()] } catch { return [] }
}

// Map a unified sort to the site's filter + whether we should rank-encode order.
function listingUpdatesForSort(sort) {
  if (sort === 'popular') return { selectedDownloadFilter: 'popular_all_time' }
  // latest / updated / title / relevance use the default (newest-first) order,
  // the registry re-sorts by the addedAt/updatedAt/title signals we populate.
  return {}
}

// ── Adapter interface ──

async function getDetail(slug) {
  const { res, text } = await requestText(`${ORIGIN}/game/${slug}`, { retries: AK_RETRIES })
  if (!res.ok) throw new Error(`ankergames detail ${res.status} for ${slug}`)
  return parseGamePage(text, slug)
}

// titleFromSlug, minus the "-free-download[-version]" suffix anker appends
function cleanSlugTitle(slug) {
  return titleFromSlug(slug.replace(/-free-download.*$/i, ''))
}

async function search(query, { limit = 24 } = {}) {
  const q = String(query || '').toLowerCase().trim()
  if (!q) return []
  const slugs = await allSlugs()
  const terms = q.split(/\s+/)
  const matches = slugs.filter((s) => {
    const hay = s.replace(/-/g, ' ')
    return terms.every((t) => hay.includes(t))
  }).slice(0, limit)
  // Build stubs straight from the slug, NO per-game page fetch. Hitting N detail
  // pages per search is what made anker "barely work" (instant 429). Full
  // metadata + download ids hydrate via getDetail() when a card opens, and
  // cross-source dedup borrows a cover from another source meanwhile.
  return matches.map((slug) => makeGame({
    sourceId: ID,
    sourceSlug: slug,
    sourceUrl: `${ORIGIN}/game/${slug}`,
    steamAppId: null,
    title: cleanSlugTitle(slug),
    downloadOptions: [],
  }))
}

async function listCatalog({ offset = 0, limit = 24 } = {}) {
  // Prefer the fast Livewire listing (full metadata, 56/page). Fall back to the
  // slug sitemap + per-game hydration only if the Livewire path fails.
  try {
    const games = await livewireBrowse({ limit: offset + limit })
    if (games.length) return games.slice(offset, offset + limit)
  } catch { /* fall through */ }
  const slugs = await allSlugs()
  const window = slugs.slice(offset, offset + limit)
  return (await mapLimit(window, AK_CONCURRENCY, (slug) => getDetail(slug))).filter(Boolean)
}

// Native unified query. Text searches still go through the slug list (the
// Livewire `search` field is unreliable), text-less browse drives the Livewire 
// listing with its real sort/year filters. The registry applies the
// authoritative filter+sort over the merged pool, so we only need to (a) hand it
// candidates and (b) populate the sort signals, which parseListingCards does.
async function query(params = {}) {
  const { text = '', sort = '', tags = [], tagMode = 'or', minYear = null, maxYear = null, minSizeBytes = null, maxSizeBytes = null, limit = 24 } = params
  if (text && text.trim()) return search(text, { limit })

  // Genre + single-year filters are applied SERVER-SIDE: set the state and call
  // `applyAllFilters` on the first commit, then page through the narrowed set
  // (full recall, not just the first browsed pages). The per-card genres[] we
  // parse let the registry further refine (size/year ranges, tagMode) and build
  // facets. Size buckets + year ranges have no clean server mapping, so those
  // fall to the registry's filter over the populated signals.
  const updates = listingUpdatesForSort(sort)
  const firstCalls = []

  if (Array.isArray(tags) && tags.length) {
    const g = await livewireGenres()
    const ids = []
    for (const t of tags) {
      const id = g.nameToId.get(String(t).toLowerCase())
      if (id) ids.push(id)
    }
    if (!ids.length) return [] // none of the requested tags exist on AnkerGames
    updates.selectedGenres = ids
    if (tagMode === 'and') updates.exclusiveFilter = true // require all selected genres
    firstCalls.push(APPLY_FILTERS_CALL)
  }
  // Exact single year → narrow server-side too (ranges left to the registry).
  if (minYear != null && maxYear != null && Number(minYear) === Number(maxYear)) {
    updates.selectedReleaseYear = String(minYear)
    if (!firstCalls.length) firstCalls.push(APPLY_FILTERS_CALL)
  }

  const filtering = firstCalls.length > 0 || minYear != null || maxYear != null || minSizeBytes != null || maxSizeBytes != null
  // Each page is a ~1.4MB POST; cap depth so a broad genre doesn't fan out to a
  // dozen requests. ~4 pages (224) is plenty to fill the merged, sliced result.
  const fetchLimit = filtering ? Math.min(limit * 3, 224) : limit

  const games = await livewireBrowse({ updates, firstCalls, limit: fetchLimit })
  if (sort === 'popular') {
    // popular_all_time gives an authoritative order but no numeric score;
    // rank-encode descending so the registry's popular sort preserves it.
    const base = games.length
    games.forEach((g, i) => { g.popularity = base - i })
  }
  return games
}

// Run the just-in-time CSRF to generate-download-url to page-parse flow and
// hand the resulting direct URL to the host resolvers. option.url is the
// downloadId.
async function resolveDownload(option) {
  const downloadId = String(option?.url || '').trim()
  if (!/^\d+$/.test(downloadId)) {
    return { resolvable: false, openUrl: option?.pageUrl || ORIGIN, reason: 'missing download id' }
  }
  const jar = new CookieJar()
  const referer = option.pageUrl || ORIGIN

  // 1) fresh CSRF token + session cookie
  const { res: tokRes, json: tokJson } = await requestJson(`${ORIGIN}/csrf-token`, {
    jar,
    headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: referer },
  })
  const token = tokJson?.token
  if (!tokRes.ok || !token) {
    return { resolvable: false, openUrl: referer, reason: 'csrf token unavailable' }
  }

  // 2) generate the tokenized download URL
  const { res: genRes, json: genJson } = await requestJson(
    `${ORIGIN}/generate-download-url/${downloadId}`,
    {
      jar,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-TOKEN': token,
        'X-Requested-With': 'XMLHttpRequest',
        Referer: referer,
        Origin: ORIGIN,
      },
      body: JSON.stringify({ 'g-recaptcha-response': 'development-mode' }),
    }
  )
  if (!genRes.ok || !genJson?.success || !genJson?.download_url) {
    return { resolvable: false, openUrl: referer, reason: genJson?.error || `generate failed (${genRes.status})` }
  }

  // 3) the download page embeds the real file URL in downloadPage('<encoded>')
  const { res: pageRes, text: pageText } = await requestText(genJson.download_url, { jar, headers: { Referer: referer } })
  if (!pageRes.ok) {
    return { resolvable: false, openUrl: genJson.download_url, reason: `download page ${pageRes.status}` }
  }
  const encoded = firstMatch(pageText, /downloadPage\(\s*'([^']+)'/)
  let direct
  try {
    direct = encoded ? decodeURIComponent(encoded) : ''
  } catch {
    direct = encoded
  }
  if (!direct) {
    return { resolvable: false, openUrl: genJson.download_url, reason: 'no direct link in download page' }
  }

  // dlproxy → passthrough; an external host → its own resolver (or open-in-browser)
  const resolved = await resolveUrl(direct)
  if (resolved.resolvable) return resolved
  return { ...resolved, openUrl: resolved.openUrl || direct }
}

module.exports = {
  id: ID,
  name: 'AnkerGames',
  homepage: ORIGIN,
  // The Livewire /games-list listing gives full per-card metadata (size,
  // release date, created/updated, popular-all-time order) 56 at a time, so
  // AnkerGames is now bulk-browsable with real sort/size/release-date signals.
  // tags:true means the filter's 127-genre taxonomy drives listTags() and query()
  // translates a tag to a genre id for server-side filtering. Downloads are still
  // browser/JIT-resolved via the per-game page.
  capabilities: {
    search: true,
    catalog: true,
    appid: false,
    bulkBrowse: true,
    tags: true,
    releaseDate: true,
    size: true,
    sort: ['popular', 'latest', 'updated', 'title'],
  },
  getDetail,
  search,
  listCatalog,
  query,
  listTags,
  resolveDownload,
  _internal: { allSlugs, parseGamePage, extractGameSlugs, livewireBrowse, parseListingCards, livewireGenres },
}
