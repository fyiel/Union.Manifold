import { apiFetch } from "@/lib/api"
import { gameLogger } from "@/lib/logger"
import type { Game, GameStats } from "@/lib/types"

export type CatalogGame = Game & {
  searchText?: string
}

export type CatalogSnapshot = {
  games: CatalogGame[]
  stats: GameStats
  updatedAt: number
  gamesUpdatedAt: number
  statsUpdatedAt: number
}

type CatalogMemoryCache = CatalogSnapshot & {
  hydrated: boolean
  hydratePromise: Promise<CatalogSnapshot> | null
}

export const CATALOG_TTL_MS = 1000 * 60 * 60 * 6
export const CATALOG_STATS_TTL_MS = 1000 * 60 * 15

const emptySnapshot = (): CatalogSnapshot => ({
  games: [],
  stats: {},
  updatedAt: 0,
  gamesUpdatedAt: 0,
  statsUpdatedAt: 0,
})

const memoryCache: CatalogMemoryCache = {
  ...emptySnapshot(),
  hydrated: false,
  hydratePromise: null,
}

function extractDeveloper(description: string): string {
  const developerMatch = String(description || "").match(/(?:by|from|developer|dev|studio)\s+([^.,\n]+)/i)
  return developerMatch ? developerMatch[1].trim() : "Unknown"
}

function normalizeSearchText(text: string): string {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function normalizeCatalogGame(game: any): CatalogGame {
  const normalizedDescription = typeof game?.description === "string" ? game.description : ""
  const normalizedName = typeof game?.name === "string" && game.name ? game.name : String(game?.appid || "Unknown")
  const developer = game?.developer && game.developer !== "Unknown"
    ? game.developer
    : extractDeveloper(normalizedDescription)

  return {
    ...game,
    appid: String(game?.appid || ""),
    name: normalizedName,
    description: normalizedDescription,
    genres: Array.isArray(game?.genres) ? game.genres : [],
    image: typeof game?.image === "string" && game.image ? game.image : "./banner.png",
    screenshots: Array.isArray(game?.screenshots) ? game.screenshots : [],
    release_date: typeof game?.release_date === "string" ? game.release_date : "",
    size: typeof game?.size === "string" ? game.size : "",
    source: typeof game?.source === "string" && game.source ? game.source : "local",
    store: typeof game?.store === "string" ? game.store : "",
    developer,
    dlc: Array.isArray(game?.dlc) ? game.dlc : [],
    searchText: normalizeSearchText(`${normalizedName} ${normalizedDescription} ${(Array.isArray(game?.genres) ? game.genres.join(" ") : "")} ${developer}`),
  }
}

export function getCatalogCache(): CatalogSnapshot {
  return {
    games: memoryCache.games,
    stats: memoryCache.stats,
    updatedAt: memoryCache.updatedAt,
    gamesUpdatedAt: memoryCache.gamesUpdatedAt,
    statsUpdatedAt: memoryCache.statsUpdatedAt,
  }
}

function setCatalogCache(snapshot: Partial<CatalogSnapshot>) {
  if (Array.isArray(snapshot.games)) {
    memoryCache.games = snapshot.games.map((game) => normalizeCatalogGame(game))
  }
  if (snapshot.stats && typeof snapshot.stats === "object") {
    memoryCache.stats = snapshot.stats
  }
  if (snapshot.updatedAt !== undefined) memoryCache.updatedAt = Number(snapshot.updatedAt || 0)
  if (snapshot.gamesUpdatedAt !== undefined) memoryCache.gamesUpdatedAt = Number(snapshot.gamesUpdatedAt || 0)
  if (snapshot.statsUpdatedAt !== undefined) memoryCache.statsUpdatedAt = Number(snapshot.statsUpdatedAt || 0)
}

export function hasUsableCatalogCache(): boolean {
  return memoryCache.games.length > 0 || Object.keys(memoryCache.stats).length > 0
}

export function isCatalogGamesStale(now = Date.now()): boolean {
  return !memoryCache.gamesUpdatedAt || now - memoryCache.gamesUpdatedAt > CATALOG_TTL_MS
}

export function isCatalogStatsStale(now = Date.now()): boolean {
  return !memoryCache.statsUpdatedAt || now - memoryCache.statsUpdatedAt > CATALOG_STATS_TTL_MS
}

export async function hydrateCatalogCache(): Promise<CatalogSnapshot> {
  if (memoryCache.hydrated) return getCatalogCache()
  if (memoryCache.hydratePromise) return memoryCache.hydratePromise

  memoryCache.hydratePromise = (async () => {
    try {
      const result = await window.ucDownloads?.loadCatalogState?.()
      if (result?.ok) {
        setCatalogCache({
          games: Array.isArray(result.games) ? result.games : [],
          stats: result.stats && typeof result.stats === "object" ? result.stats : {},
          updatedAt: result.updatedAt,
          gamesUpdatedAt: result.gamesUpdatedAt,
          statsUpdatedAt: result.statsUpdatedAt,
        })
      }
    } catch (error) {
      gameLogger.warn("Failed to hydrate catalog cache", { data: { error: String(error) } })
    } finally {
      memoryCache.hydrated = true
      memoryCache.hydratePromise = null
    }

    return getCatalogCache()
  })()

  return memoryCache.hydratePromise
}

export async function persistCatalogCache(snapshot: Partial<CatalogSnapshot>): Promise<void> {
  const nextGames = Array.isArray(snapshot.games) ? snapshot.games.map((game) => normalizeCatalogGame(game)) : memoryCache.games
  const nextStats = snapshot.stats && typeof snapshot.stats === "object" ? snapshot.stats : memoryCache.stats
  const nextGamesUpdatedAt = Number(snapshot.gamesUpdatedAt ?? memoryCache.gamesUpdatedAt ?? Date.now())
  const nextStatsUpdatedAt = Number(snapshot.statsUpdatedAt ?? memoryCache.statsUpdatedAt ?? Date.now())
  const updatedAt = Math.max(nextGamesUpdatedAt, nextStatsUpdatedAt, Number(snapshot.updatedAt || 0))

  setCatalogCache({
    games: nextGames,
    stats: nextStats,
    updatedAt,
    gamesUpdatedAt: nextGamesUpdatedAt,
    statsUpdatedAt: nextStatsUpdatedAt,
  })

  try {
    const result = await window.ucDownloads?.saveCatalogState?.({
      games: nextGames,
      stats: nextStats,
      gamesUpdatedAt: nextGamesUpdatedAt,
      statsUpdatedAt: nextStatsUpdatedAt,
    })
    if (!result?.ok) {
      throw new Error(result?.error || "persist_catalog_failed")
    }
  } catch (error) {
    gameLogger.warn("Failed to persist catalog cache", { data: { error: String(error) } })
  }
}

export async function readInstalledGames(): Promise<CatalogGame[]> {
  if (typeof window === "undefined") return []
  try {
    if (window.ucDownloads?.listInstalled) {
      const list = (await window.ucDownloads.listInstalled()) as any[]
      return list
        .map((entry) => {
          const meta = entry && (entry.metadata || entry.game) ? (entry.metadata || entry.game) : entry
          if (meta && typeof meta === "object" && meta.appid) return normalizeCatalogGame(meta)
          if (entry && entry.appid) {
            return normalizeCatalogGame({
              appid: entry.appid,
              name: entry.name || entry.appid,
              description: entry.description || "",
              genres: entry.genres || [],
              image: entry.image || "./banner.png",
              release_date: entry.release_date || "",
              size: entry.size || "",
              source: entry.source || "local",
            })
          }
          return null
        })
        .filter(Boolean) as CatalogGame[]
    }
  } catch (err) {
    gameLogger.error("readInstalledGames failed", { data: err })
  }
  return []
}

export async function mergeInstalledGames(games: CatalogGame[]): Promise<CatalogGame[]> {
  const installed = await readInstalledGames()
  const installedNormalized = installed.map((game) => {
    const meta: any = game as any
    const isOffline = typeof navigator !== "undefined" && !navigator.onLine
    if (isOffline) {
      if (meta?.localImage) return normalizeCatalogGame({ ...game, image: meta.localImage })
      if (meta?.metadata?.localImage) return normalizeCatalogGame({ ...game, image: meta.metadata.localImage })
    }
    return game
  })

  const mergedByAppid = new Map<string, CatalogGame>()
  for (const game of games) mergedByAppid.set(game.appid, normalizeCatalogGame(game))
  for (const game of installedNormalized) {
    if (game?.appid && !mergedByAppid.has(game.appid)) mergedByAppid.set(game.appid, normalizeCatalogGame(game))
  }
  return Array.from(mergedByAppid.values())
}

export async function fetchCatalogGames(): Promise<CatalogGame[]> {
  const response = await apiFetch("/api/games")
  if (!response.ok) {
    throw new Error(`Failed to load games (${response.status})`)
  }
  const data = await response.json()
  return Array.isArray(data) ? data.map((game) => normalizeCatalogGame(game)) : []
}

export async function fetchCatalogStats(): Promise<GameStats> {
  const response = await apiFetch("/api/downloads/all")
  if (!response.ok) {
    throw new Error(`Failed to load stats (${response.status})`)
  }
  const data = await response.json()
  return data && typeof data === "object" ? data as GameStats : {}
}