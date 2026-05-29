/**
 * Session-scope cache of appids the user has manually revealed by clicking the
 * Tap-to-reveal button on an NSFW cover.
 *
 * Intentionally NOT stored in sessionStorage or localStorage — it resets on
 * every hard refresh/reload, so reveals are truly ephemeral (gone when the
 * page is reloaded). Persists only during client-side navigation within the
 * same SPA session, which is the expected UX.
 *
 * Bounded with an LRU policy so that long browsing sessions on grid pages
 * (where the user may flip through hundreds of unique NSFW covers) don't grow
 * the Set without bound. Beyond `MAX_ENTRIES` we evict the least-recently
 * revealed appid. A few thousand entries is plenty for any realistic session.
 */

const MAX_ENTRIES = 2000

const order: string[] = []
const set = new Set<string>()

function touch(appid: string) {
  const existing = order.indexOf(appid)
  if (existing !== -1) order.splice(existing, 1)
  order.push(appid)
  while (order.length > MAX_ENTRIES) {
    const evicted = order.shift()
    if (evicted) set.delete(evicted)
  }
}

/**
 * Compatibility surface that looks like a `Set<string>` so existing callers
 * (`nsfwRevealedAppids.add(appid)` / `.has(appid)`) keep working unchanged.
 * Only the methods we actually use are exposed.
 */
export const nsfwRevealedAppids = {
  add(appid: string) {
    if (!appid) return
    set.add(appid)
    touch(appid)
  },
  has(appid: string) {
    return set.has(appid)
  },
  delete(appid: string) {
    const idx = order.indexOf(appid)
    if (idx !== -1) order.splice(idx, 1)
    return set.delete(appid)
  },
  clear() {
    order.length = 0
    set.clear()
  },
  get size() {
    return set.size
  },
}

if (typeof window !== "undefined") {
  // When the user signs out or wipes settings, drop reveals too so a different
  // user on the same machine doesn't inherit them.
  window.addEventListener("uc_discord_logout", () => nsfwRevealedAppids.clear())
}
