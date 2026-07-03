// Module-scoped cache for the Browse page's last result set. Kept in its OWN
// module (not inside BrowsePage.tsx) because a module-level variable in the
// component file gets wiped on every Fast-Refresh, which made the cache look
// broken in dev. Living here it survives BrowsePage remounts (navigate away and
// back) and hot updates to the page. Keyed implicitly by `committed` (the query
// that produced `games`), so the page restores without refetching when the
// current query matches.
export type BrowseCache = {
  query: string
  committed: string
  games: UnifiedSourceGame[]
  counts: Record<string, number>
  sortMode: string
  offset: number
  total: number
  // last scroll offset of the results scroller, restored on return so opening a
  // game and coming back lands where you left off instead of at the top
  scrollTop: number
}

const LS_KEY = "uc_browse_snapshot_v1"
let diskRestore = false

let cache: BrowseCache | null = null

try {
  const raw = localStorage.getItem(LS_KEY)
  if (raw) { cache = JSON.parse(raw) as BrowseCache; diskRestore = true }
} catch { cache = null }

export function getBrowseCache(): BrowseCache | null {
  return cache
}

export function consumeDiskRestore(): boolean {
  const was = diskRestore
  diskRestore = false
  return was
}

export function setBrowseCache(next: Omit<BrowseCache, "scrollTop"> & { scrollTop?: number }): void {
  // preserve the live scrollTop across the frequent state-driven cache writes
  cache = { ...next, scrollTop: next.scrollTop ?? cache?.scrollTop ?? 0 }
  diskRestore = false
  try {
    const snap: BrowseCache = { ...cache, games: cache.games.slice(0, 48), offset: Math.min(cache.offset, 48) }
    localStorage.setItem(LS_KEY, JSON.stringify(snap))
  } catch { /* quota — ignore */ }
}

// Cheap scroll-only update, called on every scroll without rebuilding the entry.
export function setBrowseScroll(scrollTop: number): void {
  if (cache) cache.scrollTop = scrollTop
}
