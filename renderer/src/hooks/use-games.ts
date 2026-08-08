import { useEffect, useState } from "react"
import { useConnectivityStatus } from "@/hooks/use-online-status"
import type { GameStats } from "@/lib/types"
import { gameLogger } from "@/lib/logger"
import {
  fetchCatalogGames,
  getCatalogCache,
  hasUsableCatalogCache,
  hydrateCatalogCache,
  isCatalogGamesStale,
  mergeInstalledGames,
  persistCatalogCache,
  type CatalogGame,
} from "@/lib/catalog"

type GamesDataState = {
  games: CatalogGame[]
  loading: boolean
  error: string | null
}

export function useGamesData() {
  const connectivity = useConnectivityStatus()
  const initialCache = getCatalogCache()
  const [state, setState] = useState<GamesDataState>(() => ({
    games: initialCache.games,
    loading: !hasUsableCatalogCache(),
    error: null,
  }))

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const hydrated = await hydrateCatalogCache()
      if (cancelled) return

      const shouldRefreshGames = connectivity.isOnline
        ? (!hydrated.games.length || isCatalogGamesStale())
        : false

      if (!shouldRefreshGames) {
        if (!hydrated.games.length) {
          try {
            const installed = await mergeInstalledGames([])
            if (!cancelled) {
              setState({ games: installed, loading: false, error: null })
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
        const games = shouldRefreshGames ? await fetchCatalogGames() : getCatalogCache().games
        const mergedGames = await mergeInstalledGames(games)
        if (cancelled) return

        setState({ games: mergedGames, loading: false, error: null })
        void persistCatalogCache({
          games: mergedGames,
          gamesUpdatedAt: shouldRefreshGames ? now : getCatalogCache().gamesUpdatedAt,
        })
      } catch (error) {
        if (cancelled) return

        gameLogger.warn("useGamesData refresh failed", { data: { error: String(error) } })

        if (hydrated.games.length) {
          setState({ games: hydrated.games, loading: false, error: null })
          return
        }

        try {
          const installed = await mergeInstalledGames([])
          if (!cancelled) {
            setState({ games: installed, loading: false, error: null })
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

    let idleHandle: number | null = null
    let timerHandle: number | null = null
    if (typeof requestIdleCallback === "function") {
      idleHandle = requestIdleCallback(() => void load(), { timeout: 500 })
    } else {
      timerHandle = window.setTimeout(() => void load(), 50)
    }

    return () => {
      cancelled = true
      if (idleHandle !== null && typeof cancelIdleCallback === "function") cancelIdleCallback(idleHandle)
      if (timerHandle !== null) window.clearTimeout(timerHandle)
    }
  }, [connectivity.isOnline])

  return state
}
