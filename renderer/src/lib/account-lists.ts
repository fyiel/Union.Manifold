import { apiFetch } from "@/lib/api"

async function postJson(path: string, body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await apiFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    return res.ok
  } catch {
    return false
  }
}

async function deleteJson(path: string, body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await apiFetch(path, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    return res.ok
  } catch {
    return false
  }
}

export const addToFavorites = (appid: string, name?: string) =>
  postJson("/api/account/favorites", { appid, name: name ?? null })

export const removeFromFavorites = (appid: string) =>
  deleteJson("/api/account/favorites", { appid })

export const addToWishlist = (appid: string, name?: string) =>
  postJson("/api/account/wishlist", { appid, name: name ?? null })

export const removeFromWishlist = (appid: string) =>
  deleteJson("/api/account/wishlist", { appid })

/**
 * Returns the set of appids currently in the user's list. 401 => empty (caller
 * decides whether to surface the sign-in prompt).
 */
async function listAppids(path: string): Promise<Set<string> | null> {
  try {
    const res = await apiFetch(path)
    if (res.status === 401) return null
    if (!res.ok) return new Set()
    const data = await res.json()
    if (!Array.isArray(data)) return new Set()
    const out = new Set<string>()
    for (const item of data) {
      const id = item?.appid
      if (id) out.add(String(id))
    }
    return out
  } catch {
    return new Set()
  }
}

export const listFavoriteAppids = () => listAppids("/api/account/favorites")
export const listWishlistAppids = () => listAppids("/api/account/wishlist")

// ── Unified library (MAL-style statuses) ─────────────────────────────────────

export type LibraryStatus =
  | "playing"
  | "plan"
  | "completed"
  | "onhold"
  | "dropped"
  | "favorite"

export const LIBRARY_STATUS_ORDER: LibraryStatus[] = [
  "playing",
  "plan",
  "completed",
  "onhold",
  "dropped",
  "favorite",
]

export const LIBRARY_STATUS_LABELS: Record<LibraryStatus, string> = {
  playing: "Playing",
  plan: "Plan to Play",
  completed: "Completed",
  onhold: "On Hold",
  dropped: "Dropped",
  favorite: "Favorite",
}

export type LibraryItem = {
  appid: string
  name: string | null
  image: string | null
  genres: string[]
  status: LibraryStatus
}

export type LibraryCounts = Record<LibraryStatus, number> & { total: number }

export type LibrarySnapshot = {
  items: LibraryItem[]
  counts: LibraryCounts | null
}

/**
 * Fetch the full unified library. Returns null when unauthenticated so the
 * caller can surface a sign-in prompt (matches listAppids' 401 convention).
 */
export async function getLibrary(): Promise<LibrarySnapshot | null> {
  try {
    const res = await apiFetch("/api/account/library")
    if (res.status === 401) return null
    if (!res.ok) return { items: [], counts: null }
    const data = await res.json()
    const items: LibraryItem[] = Array.isArray(data?.items)
      ? data.items.map((it: any) => ({
          appid: String(it.appid),
          name: it.name ?? null,
          image: it.image ?? null,
          genres: Array.isArray(it.genres) ? it.genres : [],
          status: it.status as LibraryStatus,
        }))
      : []
    return { items, counts: data?.counts ?? null }
  } catch {
    return { items: [], counts: null }
  }
}

export const setLibraryStatus = (appid: string, status: LibraryStatus, name?: string) =>
  postJson("/api/account/library", { appid, status, name: name ?? null })

export const removeFromLibrary = (appid: string) =>
  deleteJson("/api/account/library", { appid })
