export type BrowseCache = {
  query: string
  committed: string
  games: UnifiedSourceGame[]
  counts: Record<string, number>
  sortMode: string
  offset: number
  total: number
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

let persistTimer: number | null = null

function flushBrowseCacheToDisk(): void {
  persistTimer = null
  if (!cache) return
  try {
    const snap: BrowseCache = { ...cache, games: cache.games.slice(0, 48), offset: Math.min(cache.offset, 48) }
    localStorage.setItem(LS_KEY, JSON.stringify(snap))
  } catch {  }
}

export function setBrowseCache(next: Omit<BrowseCache, "scrollTop"> & { scrollTop?: number }): void {
  cache = { ...next, scrollTop: next.scrollTop ?? cache?.scrollTop ?? 0 }
  diskRestore = false
  if (persistTimer !== null) window.clearTimeout(persistTimer)
  persistTimer = window.setTimeout(flushBrowseCacheToDisk, 500)
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (persistTimer !== null) {
      window.clearTimeout(persistTimer)
      flushBrowseCacheToDisk()
    }
  })
}

export function setBrowseScroll(scrollTop: number): void {
  if (cache) cache.scrollTop = scrollTop
}
