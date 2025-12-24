import { useEffect, useState } from "react"
import { apiUrl } from "@/lib/api"
import type { Game, GameStats } from "@/lib/types"

type GamesDataState = {
  games: Game[]
  stats: GameStats
  loading: boolean
  error: string | null
}

const cache: { games: Game[] | null; stats: GameStats | null } = {
  games: null,
  stats: null,
}

async function readInstalledGames(): Promise<Game[]> {
  if (typeof window === "undefined") return []
  try {
    if (window.ucDownloads?.listInstalled) {
      const list = (await window.ucDownloads.listInstalled()) as any[]
      return list
        .map((entry) => {
          const meta = entry && (entry.metadata || entry.game) ? (entry.metadata || entry.game) : entry
          if (meta && typeof meta === "object" && meta.appid) return meta as Game
          if (entry && entry.appid) {
            return {
              appid: entry.appid,
              name: entry.name || entry.appid,
              description: entry.description || "",
              genres: entry.genres || [],
              image: entry.image || "/banner.png",
              release_date: entry.release_date || "",
              size: entry.size || "",
              source: entry.source || "local",
            } as Game
          }
          return null
        })
        .filter(Boolean) as Game[]
    }
  } catch (err) {
    console.error('[UC] readInstalledGames failed', err)
  }
  return []
}

async function fetchGames(): Promise<Game[]> {
  const response = await fetch(apiUrl("/api/games"))
  if (!response.ok) {
    throw new Error(`Failed to load games (${response.status})`)
  }
  return response.json()
}

async function fetchStats(): Promise<GameStats> {
  const response = await fetch(apiUrl("/api/downloads/all"))
  if (!response.ok) {
    throw new Error(`Failed to load stats (${response.status})`)
  }
  return response.json()
}

export function useGamesData() {
  const [state, setState] = useState<GamesDataState>(() => ({
    games: cache.games || [],
    stats: cache.stats || {},
    loading: !cache.games,
    error: null,
  }))

  useEffect(() => {
    if (cache.games) return

    let cancelled = false
    const load = async () => {
      try {
        const games = await fetchGames()
        let stats: GameStats = {}
        try {
          stats = await fetchStats()
        } catch (statError) {
          console.error("[UC] Stats fetch failed:", statError)
        }
        // merge locally saved installed games so installed titles remain visible offline
        try {
          const installed = await readInstalledGames()
          // if installed manifests include a localImage, prefer that for the game's `image` property when offline
          const installedNormalized = installed.map((g) => {
            try {
              const meta: any = (g as any)
              // Only prefer localImage when offline — when online keep remote images
              const isOffline = typeof navigator !== 'undefined' && !navigator.onLine
              if (isOffline) {
                if (meta && meta.localImage) return { ...g, image: meta.localImage }
                if (meta && meta.metadata && meta.metadata.localImage) return { ...g, image: meta.metadata.localImage }
              }
            } catch {}
            return g
          })
          const map = new Map<string, Game>()
          for (const g of games) map.set(g.appid, g)
          for (const ig of installedNormalized) if (ig && ig.appid && !map.has(ig.appid)) map.set(ig.appid, ig)
          const merged = Array.from(map.values())
          cache.games = merged
          cache.stats = stats
          if (!cancelled) {
            setState({ games: merged, stats, loading: false, error: null })
          }
          return
        } catch (e) {
          // fallback to original behavior
        }
        cache.games = games
        cache.stats = stats
        if (!cancelled) {
          setState({ games, stats, loading: false, error: null })
        }
      } catch (error) {
        if (!cancelled) {
          // attempt to fall back to installed manifests when network/API fails
          try {
            const installed = await readInstalledGames()
            cache.games = installed
            cache.stats = {}
            setState({ games: installed, stats: {}, loading: false, error: null })
            return
          } catch {}

          setState((prev) => ({
            ...prev,
            loading: false,
            error: error instanceof Error ? error.message : "Failed to load games",
          }))
        }
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [])

  return state
}
