import { apiFetch } from "@/lib/api"

/**
 * Hover-intent prefetch for the game detail endpoint.
 *
 * Each GameCard hooks `onMouseEnter` to schedule a prefetch after a short
 * delay (~150ms — long enough that brushing past cards while scrolling
 * doesn't trigger N requests, short enough to feel "instant" on intentional
 * hover). `onMouseLeave` cancels the pending request.
 *
 * Once the fetch lands we keep the parsed body in `cache` for ~60 seconds
 * (DETAIL_TTL_MS). GameDetailPage reads from the cache synchronously on
 * mount via `getPrefetchedGameDetail()` and renders without a skeleton when
 * available. Subsequent navigations within the TTL window also reuse the
 * cached body, which masks any short backend hiccup.
 */

type CacheEntry = { game: any; fetchedAt: number }

const DETAIL_TTL_MS = 60_000
const HOVER_INTENT_MS = 150

const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<any>>()
const hoverTimers = new Map<string, ReturnType<typeof setTimeout>>()

function isFresh(entry?: CacheEntry): entry is CacheEntry {
  return Boolean(entry && Date.now() - entry.fetchedAt < DETAIL_TTL_MS)
}

async function fetchOnce(appid: string): Promise<any | null> {
  if (!appid || appid.startsWith("external-")) return null
  const existing = inflight.get(appid)
  if (existing) return existing
  const promise = (async () => {
    try {
      const res = await apiFetch(`/api/games/${encodeURIComponent(appid)}`)
      if (!res.ok) return null
      const data = await res.json()
      if (data && typeof data === "object") {
        cache.set(appid, { game: data, fetchedAt: Date.now() })
      }
      return data
    } catch {
      return null
    } finally {
      inflight.delete(appid)
    }
  })()
  inflight.set(appid, promise)
  return promise
}

/**
 * Schedule a prefetch after the hover-intent delay. Returns a `cancel` that
 * the consumer should invoke on mouse-leave so a fast scroll-by doesn't
 * land an API call we won't use.
 */
export function schedulePrefetchGameDetail(appid: string): () => void {
  if (!appid || appid.startsWith("external-")) return () => {}
  if (isFresh(cache.get(appid))) return () => {}
  // Already queued — return the existing cancel handle.
  const existing = hoverTimers.get(appid)
  if (existing) {
    return () => {
      const current = hoverTimers.get(appid)
      if (current === existing) {
        clearTimeout(existing)
        hoverTimers.delete(appid)
      }
    }
  }
  const handle = setTimeout(() => {
    hoverTimers.delete(appid)
    void fetchOnce(appid)
  }, HOVER_INTENT_MS)
  hoverTimers.set(appid, handle)
  return () => {
    const current = hoverTimers.get(appid)
    if (current === handle) {
      clearTimeout(handle)
      hoverTimers.delete(appid)
    }
  }
}

/**
 * Synchronous read of any prefetched body still within the TTL. Returns
 * `null` when the cache is cold or stale so the caller falls through to
 * its normal fetch.
 */
export function getPrefetchedGameDetail(appid: string): any | null {
  const entry = cache.get(appid)
  if (!isFresh(entry)) return null
  return entry.game
}

/** Drop a single cached entry — e.g. after the user uninstalls / refreshes. */
export function invalidatePrefetchedGameDetail(appid: string): void {
  if (!appid) return
  cache.delete(appid)
  const handle = hoverTimers.get(appid)
  if (handle) {
    clearTimeout(handle)
    hoverTimers.delete(appid)
  }
}
