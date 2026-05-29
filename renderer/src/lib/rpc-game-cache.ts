/**
 * Bounded LRU localStorage cache for Discord-RPC game metadata.
 *
 * Replaces the previous per-appid keys (`uc_game_name:<appid>`,
 * `uc_game_genres:<appid>`) which grew without bound — every game the user
 * viewed left behind a key forever, and over months of browsing localStorage
 * would balloon and slow down `Storage.getItem`/quota checks.
 *
 * Each family (name / genres) is stored as a single JSON object plus a recency
 * list. Reads + writes update the recency list, and beyond `MAX_ENTRIES` the
 * least-recently-used appid is evicted. A migration pass on first read folds
 * the legacy per-appid keys into the new shape and removes them.
 */

const MAX_ENTRIES = 500

type CacheShape<T> = { order: string[]; data: Record<string, T> }

function readCache<T>(storageKey: string): CacheShape<T> {
  if (typeof window === "undefined") return { order: [], data: {} }
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return { order: [], data: {} }
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.order) && parsed.data && typeof parsed.data === "object") {
      return parsed as CacheShape<T>
    }
  } catch { /* fall through */ }
  return { order: [], data: {} }
}

function writeCache<T>(storageKey: string, cache: CacheShape<T>) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(cache))
  } catch { /* quota / private mode — silently drop */ }
}

function touch<T>(cache: CacheShape<T>, appid: string) {
  const idx = cache.order.indexOf(appid)
  if (idx !== -1) cache.order.splice(idx, 1)
  cache.order.push(appid)
  while (cache.order.length > MAX_ENTRIES) {
    const evicted = cache.order.shift()
    if (evicted) delete cache.data[evicted]
  }
}

const NAME_KEY = "uc_rpc_game_names_v2"
const GENRES_KEY = "uc_rpc_game_genres_v2"
const NAME_PREFIX_LEGACY = "uc_game_name:"
const GENRES_PREFIX_LEGACY = "uc_game_genres:"

let migrated = false

function migrateLegacyKeys() {
  if (migrated) return
  migrated = true
  if (typeof window === "undefined") return
  try {
    const nameCache = readCache<string>(NAME_KEY)
    const genresCache = readCache<string[]>(GENRES_KEY)
    const toRemove: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (!key) continue
      if (key.startsWith(NAME_PREFIX_LEGACY)) {
        const appid = key.slice(NAME_PREFIX_LEGACY.length)
        const value = window.localStorage.getItem(key)
        if (appid && value) {
          nameCache.data[appid] = value
          if (!nameCache.order.includes(appid)) nameCache.order.push(appid)
        }
        toRemove.push(key)
      } else if (key.startsWith(GENRES_PREFIX_LEGACY)) {
        const appid = key.slice(GENRES_PREFIX_LEGACY.length)
        const value = window.localStorage.getItem(key)
        if (appid && value) {
          try {
            const parsed = JSON.parse(value)
            if (Array.isArray(parsed)) {
              genresCache.data[appid] = parsed
              if (!genresCache.order.includes(appid)) genresCache.order.push(appid)
            }
          } catch { /* ignore corrupted entry */ }
        }
        toRemove.push(key)
      }
    }
    if (toRemove.length === 0) return
    // Trim caches to MAX_ENTRIES on first migration so old data doesn't
    // permanently exceed the cap.
    while (nameCache.order.length > MAX_ENTRIES) {
      const e = nameCache.order.shift()
      if (e) delete nameCache.data[e]
    }
    while (genresCache.order.length > MAX_ENTRIES) {
      const e = genresCache.order.shift()
      if (e) delete genresCache.data[e]
    }
    writeCache(NAME_KEY, nameCache)
    writeCache(GENRES_KEY, genresCache)
    for (const key of toRemove) {
      try { window.localStorage.removeItem(key) } catch { /* ignore */ }
    }
  } catch { /* migration is best-effort */ }
}

export function rememberGameName(appid: string, name: string) {
  if (!appid || !name) return
  migrateLegacyKeys()
  const cache = readCache<string>(NAME_KEY)
  cache.data[appid] = name
  touch(cache, appid)
  writeCache(NAME_KEY, cache)
}

export function recallGameName(appid: string): string | null {
  if (!appid) return null
  migrateLegacyKeys()
  const cache = readCache<string>(NAME_KEY)
  return cache.data[appid] ?? null
}

export function rememberGameGenres(appid: string, genres: string[]) {
  if (!appid || !Array.isArray(genres)) return
  migrateLegacyKeys()
  const cache = readCache<string[]>(GENRES_KEY)
  cache.data[appid] = genres
  touch(cache, appid)
  writeCache(GENRES_KEY, cache)
}

export function recallGameGenres(appid: string): string[] | null {
  if (!appid) return null
  migrateLegacyKeys()
  const cache = readCache<string[]>(GENRES_KEY)
  const value = cache.data[appid]
  return Array.isArray(value) ? value : null
}
