/**
 * Module-scoped, time-bounded cache of image URLs that have already failed to
 * load in this session. Lets every <img>-style component (MediaImage,
 * GameCard's candidate chain, etc.) skip retrying URLs we know are broken,
 * so a grid with N cards all referencing the same dead CDN URL doesn't
 * trigger N spinner-then-fallback flashes on every mount.
 *
 * The TTL is short (60s) so we still re-test eventually — flaky CDN endpoints
 * recover and shouldn't be poisoned permanently.
 */

const TTL_MS = 60_000
const MAX_ENTRIES = 1024
const cache = new Map<string, number>()

export function markImageFailed(url: string): void {
  if (!url) return
  // Re-insert at the end so that, under the LRU-ish insertion order Map keeps,
  // a freshly-failed URL isn't the first to be evicted.
  cache.delete(url)
  cache.set(url, Date.now())
  if (cache.size > MAX_ENTRIES) {
    // Drop the oldest quarter. Map preserves insertion order, so the first keys
    // are the oldest — delete them via the iterator instead of materializing and
    // sorting the whole map (the previous Array.from().sort() was O(n log n) on a
    // hot path hit from every <img> onError during a CDN outage).
    const dropCount = Math.floor(MAX_ENTRIES / 4)
    let dropped = 0
    for (const key of cache.keys()) {
      if (dropped >= dropCount) break
      cache.delete(key)
      dropped++
    }
  }
}

export function isImageKnownBad(url: string): boolean {
  if (!url) return false
  const at = cache.get(url)
  if (!at) return false
  if (Date.now() - at > TTL_MS) {
    cache.delete(url)
    return false
  }
  return true
}

export function forgetImageFailure(url: string): void {
  if (!url) return
  cache.delete(url)
}

export function clearImageFailureCache(): void {
  cache.clear()
}
