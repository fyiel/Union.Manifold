import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/api"

export type PlayHistoryGame = {
  appid: string
  installedAt: string | null
  lastPlayedAt: string | null
  playCount: number
  game: {
    appid: string
    name: string
    image: string
    genres: string[] | string | null
    size?: string
    source?: string
  } | null
}

/**
 * Reads the user's cloud-synced play history (recently played + recently
 * installed) on union-crax.xyz. Returns `null` collections when the user is
 * not signed in so callers can decide whether to fall back to local sources.
 */
export function usePlayHistory(limit = 20) {
  const [items, setItems] = useState<PlayHistoryGame[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const res = await apiFetch(`/api/account/play-history?limit=${limit}`)
        if (!mounted) return
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
        const next = Array.isArray(data?.items) ? (data.items as PlayHistoryGame[]) : []
        setAuthed(true)
        setItems(next)
      } catch {
        if (mounted) {
          setAuthed(false)
          setItems(null)
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void load()

    // Refresh when a game install/launch event fires locally so the strip
    // updates without waiting for the next page mount.
    const onChange = () => {
      void load()
    }
    if (typeof window !== "undefined") {
      window.addEventListener("uc_game_installed", onChange)
      window.addEventListener("focus", onChange)
    }
    return () => {
      mounted = false
      if (typeof window !== "undefined") {
        window.removeEventListener("uc_game_installed", onChange)
        window.removeEventListener("focus", onChange)
      }
    }
  }, [limit])

  return { items, loading, authed }
}
