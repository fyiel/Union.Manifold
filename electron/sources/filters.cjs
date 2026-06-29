'use strict'

/**
 * Authoritative filter / sort / facet logic for unified (merged) games.
 *
 * Adapters hand the registry candidate pools (each as filtered/sorted as their
 * source can manage natively); the registry merges them and then applies these
 * helpers so the final result is consistent regardless of which source a game
 * came from. Sorts degrade gracefully — a game from a source that doesn't expose
 * the sort field (e.g. SteamRIP has no popularity) sorts last rather than
 * breaking the order.
 */

function normTag(s) {
  return String(s || '').toLowerCase().trim()
}

/** Does a game's genres satisfy the wanted tags under 'and' / 'or'? */
function tagsMatch(genres, wanted, mode) {
  if (!wanted.length) return true
  const have = new Set((genres || []).map(normTag))
  return mode === 'and' ? wanted.every((t) => have.has(t)) : wanted.some((t) => have.has(t))
}

/**
 * Filter merged games by tags (and/or), release-year range and install-size
 * range. A range bound only excludes games that HAVE the field — a game with an
 * unknown size isn't dropped by a size filter unless you want it to be (the
 * registry decides whether to surface "unknown" separately).
 */
function applyFilters(games, opts = {}) {
  const { tags = [], tagMode = 'or', minYear = null, maxYear = null, minSizeBytes = null, maxSizeBytes = null } = opts
  const wanted = tags.map(normTag).filter(Boolean)
  return games.filter((g) => {
    if (!tagsMatch(g.genres, wanted, tagMode)) return false
    if (minYear != null && (g.releaseYear == null || g.releaseYear < minYear)) return false
    if (maxYear != null && (g.releaseYear == null || g.releaseYear > maxYear)) return false
    if (minSizeBytes != null && (g.sizeBytes == null || g.sizeBytes < minSizeBytes)) return false
    if (maxSizeBytes != null && (g.sizeBytes == null || g.sizeBytes > maxSizeBytes)) return false
    return true
  })
}

const VALUE_KEY = { latest: 'addedAt', updated: 'updatedAt' }

/**
 * Sort merged games in place.
 *   relevance → leave the caller's order (search rank / merge order)
 *   popular   → popularity desc, then number of sources, then title
 *   latest    → addedAt desc      updated → updatedAt desc
 *   title     → A→Z
 * `order` ('asc'|'desc') flips value sorts; nulls always sink to the bottom.
 */
function sortGames(games, sort = 'relevance', order = 'desc') {
  if (!sort || sort === 'relevance') return games

  if (sort === 'title') {
    const mul = order === 'desc' ? -1 : 1
    games.sort((a, b) => mul * String(a.title || '').localeCompare(String(b.title || '')))
    return games
  }

  if (sort === 'popular') {
    const mul = order === 'asc' ? 1 : -1
    games.sort((a, b) => {
      const ap = a.popularity, bp = b.popularity
      if (ap == null && bp == null) {
        // No source-provided count → cross-source presence is the proxy.
        const d = (b.sources?.length || 0) - (a.sources?.length || 0)
        return d || String(a.title || '').localeCompare(String(b.title || ''))
      }
      if (ap == null) return 1
      if (bp == null) return -1
      if (ap !== bp) return mul * (ap - bp)
      return (b.sources?.length || 0) - (a.sources?.length || 0)
    })
    return games
  }

  const key = VALUE_KEY[sort]
  if (!key) return games
  const mul = order === 'asc' ? 1 : -1
  games.sort((a, b) => {
    const av = a[key], bv = b[key]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    return mul * (av - bv)
  })
  return games
}

/** Tag counts + year/size ranges over a set of merged games (for UI facets). */
function buildFacets(games) {
  const tagCounts = new Map()
  let minYear = null, maxYear = null, minSize = null, maxSize = null
  for (const g of games) {
    for (const raw of g.genres || []) {
      const name = String(raw).trim()
      if (name) tagCounts.set(name, (tagCounts.get(name) || 0) + 1)
    }
    if (g.releaseYear != null) {
      minYear = minYear == null ? g.releaseYear : Math.min(minYear, g.releaseYear)
      maxYear = maxYear == null ? g.releaseYear : Math.max(maxYear, g.releaseYear)
    }
    if (g.sizeBytes != null) {
      minSize = minSize == null ? g.sizeBytes : Math.min(minSize, g.sizeBytes)
      maxSize = maxSize == null ? g.sizeBytes : Math.max(maxSize, g.sizeBytes)
    }
  }
  return {
    tags: Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
    years: { min: minYear, max: maxYear },
    size: { min: minSize, max: maxSize },
  }
}

module.exports = { normTag, tagsMatch, applyFilters, sortGames, buildFacets }
