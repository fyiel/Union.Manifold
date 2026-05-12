import { useCallback, useEffect, useState } from "react"
import { apiFetch } from "@/lib/api"

export type FollowedCollection = {
  id: string
  name: string
  shareToken: string | null
  isPublic: boolean
  updatedAt: string
  lastSeenAt: string | null
  followedAt: string
  hasUpdates: boolean
  gameCount: number
  previewAppids: string[]
  previewCovers: Array<{ appid: string; image: string | null; name: string | null }>
  owner: {
    discordId: string
    username: string | null
    displayName: string | null
    avatarUrl: string | null
  }
}

/**
 * Cloud-backed list of collections the user follows from other people.
 * Returns `null` when not authed so the UI can degrade gracefully.
 */
export function useFollowedCollections() {
  const [items, setItems] = useState<FollowedCollection[] | null>(null)
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch("/api/account/followed-collections")
      if (res.status === 401) {
        setAuthed(false)
        setItems(null)
        return
      }
      if (!res.ok) {
        setAuthed(false)
        setItems(null)
        return
      }
      const data = await res.json()
      setAuthed(true)
      setItems(Array.isArray(data?.collections) ? data.collections : [])
    } catch {
      setAuthed(false)
      setItems(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    // Re-fetch on window focus so updates from other tabs/devices show up.
    const onFocus = () => void refresh()
    if (typeof window !== "undefined") window.addEventListener("focus", onFocus)
    return () => {
      if (typeof window !== "undefined") window.removeEventListener("focus", onFocus)
    }
  }, [refresh])

  const markSeen = useCallback(async (collection: FollowedCollection) => {
    if (!collection.shareToken) return
    try {
      await apiFetch(`/api/collections/share/${encodeURIComponent(collection.shareToken)}/seen`, {
        method: "POST",
      })
    } catch {
      /* swallow */
    }
    // Optimistic: drop the badge for the row
    setItems((prev) =>
      prev
        ? prev.map((c) =>
            c.id === collection.id
              ? { ...c, hasUpdates: false, lastSeenAt: new Date().toISOString() }
              : c
          )
        : prev
    )
  }, [])

  const unfollow = useCallback(async (collection: FollowedCollection) => {
    if (!collection.shareToken) return
    try {
      const res = await apiFetch(`/api/collections/share/${encodeURIComponent(collection.shareToken)}/follow`, {
        method: "DELETE",
      })
      if (res.ok) {
        setItems((prev) => prev?.filter((c) => c.id !== collection.id) ?? prev)
      }
    } catch {
      /* swallow */
    }
  }, [])

  return { items, authed, loading, refresh, markSeen, unfollow }
}
