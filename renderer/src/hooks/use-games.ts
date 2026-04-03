import { useEffect, useState } from "react"
import type { GameStats } from "@/lib/types"
import { gameLogger } from "@/lib/logger"
import {
  fetchCatalogGames,
  fetchCatalogStats,
  getCatalogCache,
  hasUsableCatalogCache,
  hydrateCatalogCache,
  isCatalogGamesStale,
  isCatalogStatsStale,
  mergeInstalledGames,
  persistCatalogCache,
  type CatalogGame,
} from "@/lib/catalog"

type GamesDataState = {
  games: CatalogGame[]
  stats: GameStats
  loading: boolean
  error: string | null
}

export function useGamesData() {
  const initialCache = getCatalogCache()
  const [state, setState] = useState<GamesDataState>(() => ({
    games: initialCache.games,
    stats: initialCache.stats,
    loading: !hasUsableCatalogCache(),
    error: null,
  }))

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const hydrated = await hydrateCatalogCache()
      if (cancelled) return

      if (hydrated.games.length || Object.keys(hydrated.stats).length) {
        setState({
          games: hydrated.games,
          stats: hydrated.stats,
          loading: false,
          error: null,
        })
      }

      const shouldRefreshGames = typeof navigator === "undefined" || navigator.onLine
        ? isCatalogGamesStale()
        : false
      const shouldRefreshStats = typeof navigator === "undefined" || navigator.onLine
        ? isCatalogStatsStale()
        : false

      if (!shouldRefreshGames && !shouldRefreshStats) {
        if (!hydrated.games.length && !Object.keys(hydrated.stats).length) {
          try {
            const installed = await mergeInstalledGames([])
            if (!cancelled) {
              setState({ games: installed, stats: {}, loading: false, error: null })
            }
          } catch {
            if (!cancelled) {
              setState((prev) => ({ ...prev, loading: false }))
            }
          }
        }
        return
      }

      try {
        const now = Date.now()
        const [games, stats] = await Promise.all([
          shouldRefreshGames ? fetchCatalogGames() : Promise.resolve(getCatalogCache().games),
          shouldRefreshStats ? fetchCatalogStats() : Promise.resolve(getCatalogCache().stats),
        ])
        const mergedGames = await mergeInstalledGames(games)
        if (cancelled) return

        setState({ games: mergedGames, stats, loading: false, error: null })
        void persistCatalogCache({
          games: mergedGames,
          stats,
          gamesUpdatedAt: shouldRefreshGames ? now : getCatalogCache().gamesUpdatedAt,
          statsUpdatedAt: shouldRefreshStats ? now : getCatalogCache().statsUpdatedAt,
        })
      } catch (error) {
        if (cancelled) return

        gameLogger.warn("useGamesData refresh failed", { data: { error: String(error) } })

        if (hydrated.games.length || Object.keys(hydrated.stats).length) {
          setState({
            games: hydrated.games,
            stats: hydrated.stats,
            loading: false,
            error: null,
          })
          return
        }

        try {
          const installed = await mergeInstalledGames([])
          if (!cancelled) {
            setState({ games: installed, stats: {}, loading: false, error: null })
          }
        } catch {
          if (!cancelled) {
            setState((prev) => ({
              ...prev,
              loading: false,
              error: error instanceof Error ? error.message : "Failed to load games",
            }))
          }
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  return state
}