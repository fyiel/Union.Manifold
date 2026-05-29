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
  cache.set(url, Date.now())
  if (cache.size > MAX_ENTRIES) {
    // Drop the oldest quarter in one pass when we exceed the cap.
    const entries = Array.from(cache.entries()).sort((a, b) => a[1] - b[1])
    const dropCount = Math.floor(MAX_ENTRIES / 4)
    for (let i = 0; i < dropCount; i++) cache.delete(entries[i][0])
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
