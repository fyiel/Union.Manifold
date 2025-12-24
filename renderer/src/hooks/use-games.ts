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
        cache.games = games
        cache.stats = stats
        if (!cancelled) {
          setState({ games, stats, loading: false, error: null })
        }
      } catch (error) {
        if (!cancelled) {
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
