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
