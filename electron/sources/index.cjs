'use strict'

// Multi-source registry. Owns the set of enabled source adapters and exposes the
// unified ops the rest of the app (via IPC) consumes: searchAll(q) and
// catalog({offset}) hand back deduped UnifiedGame[], detail(sources) hydrates one
// game with every source's download options, resolveDownload() turns an option
// into an aria2-ready URL. Dedup/merge (schema.mergeGames) collapses the same
// title across sites by Steam AppID (falling back to a normalized-title key) so
// there are no duped titles, each contributing source kept for the mirror picker.

const unioncrax = require('./adapters/unioncrax.cjs')
const gamebounty = require('./adapters/gamebounty.cjs')
const ankergames = require('./adapters/ankergames.cjs')
const steamrip = require('./adapters/steamrip.cjs')
const { mergeGames, normalizeTitle } = require('./schema.cjs')
const { applyFilters, sortGames, buildFacets } = require('./filters.cjs')
const hosts = require('./hosts/index.cjs')
const steam = require('./steam.cjs')

// Sort key → the capability flag (in capabilities.sort) a source must declare
// to support it. Used to compute per-feature coverage for the UI.
const SORT_KEYS = ['popular', 'latest', 'updated', 'title']

// Registration order is also default display order. Phase 2 adds astralgames
// here once its Next.js/PostgREST endpoint + pearcrypt download flow is mapped.
const ADAPTERS = [unioncrax, gamebounty, ankergames, steamrip]
const byId = new Map(ADAPTERS.map((a) => [a.id, a]))

// Runtime enable/disable (wired to Settings later). Default: all on.
const enabled = new Set(ADAPTERS.map((a) => a.id))

function enabledAdapters() {
  return ADAPTERS.filter((a) => enabled.has(a.id))
}

function listSources() {
  return ADAPTERS.map((a) => ({
    id: a.id,
    name: a.name,
    homepage: a.homepage,
    capabilities: a.capabilities || {},
    enabled: enabled.has(a.id),
  }))
}

function setEnabled(id, on) {
  if (!byId.has(id)) return false
  if (on) enabled.add(id)
  else enabled.delete(id)
  return true
}

// Run an async adapter method across a set of adapters, tolerating failures.
async function fanOut(adapters, method, ...args) {
  const results = await Promise.allSettled(
    adapters
      .filter((a) => typeof a[method] === 'function')
      .map((a) => a[method](...args))
  )
  const games = []
  for (const r of results) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) games.push(...r.value)
  }
  return games
}

async function searchAll(query, opts = {}) {
  // Search hits every enabled source, a query returns only a handful of titles,
  // so even rate-limited sources (ankergames) stay within budget.
  const games = await fanOut(enabledAdapters(), 'search', query, opts)
  return mergeGames(games)
}

async function catalog(opts = {}) {
  // Bulk browse only fans out to sources that tolerate hydrating a whole page.
  // Sources that rate-limit per-game fetches (e.g. ankergames, HTTP 429) set
  // capabilities.bulkBrowse:false and are reached via search/detail instead, so
  // one slow source can't drag the landing grid.
  const adapters = enabledAdapters().filter((a) => a.capabilities?.bulkBrowse !== false)
  const games = await fanOut(adapters, 'listCatalog', opts)
  return mergeGames(games)
}

// Hydrate a unified detail view from a list of {sourceId, sourceSlug} stubs
// (taken from a UnifiedGame.sources). Fetches each source's full detail (which
// includes its download options) and merges into one record.
async function detail(sourceStubs) {
  const stubs = Array.isArray(sourceStubs) ? sourceStubs : [sourceStubs]
  const results = await Promise.allSettled(
    stubs
      .map((s) => ({ adapter: byId.get(s.sourceId), slug: s.sourceSlug }))
      .filter((x) => x.adapter && x.slug)
      .map((x) => x.adapter.getDetail(x.slug))
  )
  const games = results.filter((r) => r.status === 'fulfilled' && r.value).map((r) => r.value)
  let game = mergeGames(games)[0] || null
  if (game) {
    // Surface the SAME title from other sources that weren't on the card we were
    // opened from. A card built from a browse page only carries the sources that
    // happened to be in that window. Search-only sources (e.g. AnkerGames, which
    // dedups by title since it exposes no AppID) get missed so detail wrongly
    // says "only source X". Search the missing sources by title and merge matches.
    const extra = await findOtherSources(game)
    if (extra.length) game = mergeGames([...games, ...extra])[0] || game
    await enrichFromSteam(game)
    game.fullyResolved = true // cross-source surfaced + Steam-enriched, so the UI caches it and won't re-hydrate
  }
  return game
}

// Search every enabled source NOT already on `game` for the same title, return
// the records that genuinely match (same AppID or same normalized title) so
// detail shows every mirror, not just the one the card came from.
async function findOtherSources(game) {
  const have = new Set((game.sources || []).map((s) => s.sourceId))
  const others = enabledAdapters().filter((a) => !have.has(a.id) && typeof a.search === 'function')
  if (!others.length || !game.title) return []
  const norm = normalizeTitle(game.title)
  const results = await Promise.allSettled(others.map((a) => a.search(game.title, { limit: 5 })))
  const found = results.flatMap((r) => (r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []))
  return found.filter((g) => normalizeTitle(g.title) === norm || (g.steamAppId && g.steamAppId === game.steamAppId))
}

// Fill thin metadata (description, genres, release year) from Steam's store for
// any game with a known AppID. SteamRIP sometimes ships an empty description and
// obscure/old titles carry no genres. Best-effort, a Steam miss leaves the
// source's own (possibly empty) fields untouched.
async function enrichFromSteam(game) {
  if (!game?.steamAppId) return
  const thinDesc = !game.description || game.description.length < 24
  const noGenres = !Array.isArray(game.genres) || game.genres.length === 0
  if (!thinDesc && !noGenres && game.releaseYear) return
  try {
    const d = await steam.getStoreDetails(game.steamAppId)
    if (!d) return
    if (thinDesc && d.description) game.description = d.description
    if (noGenres && d.genres.length) game.genres = d.genres
    if (!game.releaseYear && d.releaseYear) game.releaseYear = d.releaseYear
  } catch { /* leave source fields as-is */ }
}

// Pull a candidate pool from one adapter for a unified query.
async function adapterCandidates(adapter, params, candidateLimit) {
  if (typeof adapter.query === 'function') {
    return adapter.query({ ...params, limit: candidateLimit })
  }
  if (params.text && params.text.trim()) {
    return typeof adapter.search === 'function' ? adapter.search(params.text.trim(), { limit: candidateLimit }) : []
  }
  return typeof adapter.listCatalog === 'function' ? adapter.listCatalog({ offset: 0, limit: candidateLimit }) : []
}

// Unified query across sources: title text, tag filter (single/many, and/or),
// release-year range, install-size range, and sort (popular, latest, updated,
// title, relevance), paginated. Each source contributes the best candidate pool
// it can natively (UnionCrax filters its whole in-memory catalog, SteamRIP
// filters/sorts server-side), then the registry merges, dedups and applies the
// authoritative filter + sort so the result is consistent. Returns the page plus
// facets (tag counts, year/size ranges) and a capability report so the UI can
// announce what a source can't do (e.g. SteamRIP has no popularity so it ranks
// by recency instead).
async function query(params = {}) {
  const {
    text = '',
    tags = [],
    tagMode = 'or',
    minYear = null,
    maxYear = null,
    minSizeBytes = null,
    maxSizeBytes = null,
    sort = text && text.trim() ? 'relevance' : 'popular',
    order = null,
    offset = 0,
    limit = 36,
    sources = null,
    balanced = false,
  } = params

  // Title reads naturally A→Z; the value sorts (popular/latest/updated) read
  // high→low. Honour an explicit order, otherwise pick the sensible default.
  const effOrder = order || (sort === 'title' ? 'asc' : 'desc')

  let adapters = enabledAdapters()
  if (Array.isArray(sources) && sources.length) adapters = adapters.filter((a) => sources.includes(a.id))
  const hasText = Boolean(text && text.trim())
  // Browse (no text) only fans out to bulk-browse-safe sources; search hits all.
  const scope = hasText ? adapters : adapters.filter((a) => a.capabilities?.bulkBrowse !== false)

  // Pull a bit more than one page so post-merge filtering can still fill it.
  const candidateLimit = Math.max(offset + limit, 36) + 24
  const queryParams = { text, tags, tagMode, sort, order: effOrder, minYear, maxYear, minSizeBytes, maxSizeBytes }

  const settled = await Promise.allSettled(scope.map((a) => adapterCandidates(a, queryParams, candidateLimit)))
  const pool = []
  for (const r of settled) if (r.status === 'fulfilled' && Array.isArray(r.value)) pool.push(...r.value)

  let unified = mergeGames(pool)
  unified = applyFilters(unified, { tags, tagMode, minYear, maxYear, minSizeBytes, maxSizeBytes })
  sortGames(unified, sort, effOrder)

  // Balanced browse: a pure global sort lets one prolific source dominate the
  // first page (e.g. a recent GameBounty burst buries every UnionCrax title past
  // the cut). When `balanced` is set (the default Browse with no text), round-
  // robin across each contributing source's own ordering so every source is
  // represented near the top. Each unified game is attributed to its first
  // (preferred) source.
  if (balanced && unified.length) {
    const groups = new Map()
    for (const g of unified) {
      const key = (g.sources && g.sources[0] && g.sources[0].sourceId) || 'unknown'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(g)
    }
    const order = scope.map((a) => a.id).filter((id) => groups.has(id))
    for (const id of groups.keys()) if (!order.includes(id)) order.push(id)
    const out = []
    for (let i = 0; out.length < unified.length; i++) {
      let added = false
      for (const id of order) {
        const arr = groups.get(id)
        if (arr && arr[i]) { out.push(arr[i]); added = true }
      }
      if (!added) break
    }
    unified = out
  }

  const total = unified.length
  const page = unified.slice(offset, offset + limit)
  return {
    games: page,
    total,
    facets: buildFacets(unified),
    applied: { text, tags, tagMode, minYear, maxYear, minSizeBytes, maxSizeBytes, sort, order: effOrder, offset, limit },
    capabilities: capabilities(scope.map((a) => a.id)),
  }
}

// Capability matrix for the UI. Per-source flags plus, for the in-scope set,
// each feature's coverage ('full' every source can, 'partial' some, 'none' no
// source can) so the UI can surface when a filter/sort isn't supported.
function capabilities(sourceIds = null) {
  const inScope = (a) =>
    enabled.has(a.id) && (!Array.isArray(sourceIds) || !sourceIds.length || sourceIds.includes(a.id))

  const perSource = ADAPTERS.map((a) => {
    const c = a.capabilities || {}
    return {
      id: a.id,
      name: a.name,
      enabled: enabled.has(a.id),
      search: Boolean(c.search),
      tags: Boolean(c.tags),
      releaseDate: Boolean(c.releaseDate),
      size: Boolean(c.size),
      sort: Array.isArray(c.sort) ? c.sort : [],
      bulkBrowse: c.bulkBrowse !== false,
      appid: Boolean(c.appid),
    }
  })

  const scoped = perSource.filter((s) => inScope({ id: s.id }))
  const coverageOf = (pred) => {
    if (!scoped.length) return 'none'
    const yes = scoped.filter(pred).length
    return yes === scoped.length ? 'full' : yes === 0 ? 'none' : 'partial'
  }
  const supportersOf = (pred) => scoped.filter(pred).map((s) => s.id)

  const featurePreds = {
    tags: (s) => s.tags,
    releaseDate: (s) => s.releaseDate,
    size: (s) => s.size,
  }
  for (const k of SORT_KEYS) featurePreds[`sort:${k}`] = (s) => s.sort.includes(k)

  const coverage = {}
  const supports = {}
  for (const [feature, pred] of Object.entries(featurePreds)) {
    coverage[feature] = coverageOf(pred)
    supports[feature] = supportersOf(pred)
  }
  return { perSource, scope: scoped.map((s) => s.id), coverage, supports }
}

// Union of every enabled source's tag list, plus the per-source breakdown.
async function availableTags() {
  const adapters = enabledAdapters().filter((a) => typeof a.listTags === 'function')
  const settled = await Promise.allSettled(adapters.map((a) => a.listTags()))
  const all = new Set()
  const bySource = {}
  adapters.forEach((a, i) => {
    const r = settled[i]
    const tags = r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []
    bySource[a.id] = tags
    for (const t of tags) if (t) all.add(String(t).trim())
  })
  return { tags: Array.from(all).sort((a, b) => a.localeCompare(b)), bySource }
}

// Resolve a DownloadOption to an aria2-ready URL. Source-specific options
// (ankergames CSRF flow, astral pearcrypt) route to the owning adapter, plain
// URL options go straight to the host resolvers.
async function resolveDownload(sourceId, option) {
  const adapter = byId.get(sourceId)
  if (adapter && typeof adapter.resolveDownload === 'function') {
    return adapter.resolveDownload(option)
  }
  if (option?.url) return hosts.resolveUrl(option.url)
  return { resolvable: false, openUrl: option?.pageUrl, reason: 'no resolver for option' }
}

// Authoritative Steam art for an AppID (header + background) from the store API.
// Used as a LAST-RESORT cover/hero fallback when the predictable
// `store_item_assets/.../library_*.jpg` URLs 404, which happens for newer titles
// whose art lives only under a content-hashed path. Cached.
async function steamArt(appid) {
  const d = await steam.getStoreDetails(appid)
  if (!d) return { header: '', background: '' }
  return { header: d.headerImage || '', background: d.background || '' }
}

module.exports = {
  ADAPTERS,
  listSources,
  setEnabled,
  searchAll,
  catalog,
  query,
  capabilities,
  availableTags,
  detail,
  resolveDownload,
  steamArt,
}
