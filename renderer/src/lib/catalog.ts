import { apiFetch } from "@/lib/api"
import { gameLogger } from "@/lib/logger"
import type { Game } from "@/lib/types"

export type CatalogGame = Game & {
  searchText?: string
}

type CatalogSnapshot = {
  games: CatalogGame[]
  updatedAt: number
  gamesUpdatedAt: number
}

type CatalogMemoryCache = CatalogSnapshot & {
  hydrated: boolean
  hydratePromise: Promise<CatalogSnapshot> | null
}

const CATALOG_TTL_MS = 1000 * 60 * 60 * 6

const emptySnapshot = (): CatalogSnapshot => ({
  games: [],
  updatedAt: 0,
  gamesUpdatedAt: 0,
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

function normalizeCatalogGame(game: any): CatalogGame {
  const normalizedDescription = typeof game?.description === "string" ? game.description : ""
  const normalizedName = typeof game?.name === "string" && game.name ? game.name : String(game?.appid || "Unknown")
  const developer = game?.developer && game.developer !== "Unknown"
    ? game.developer
    : extractDeveloper(normalizedDescription)
  const hasCoOp = typeof game?.hasCoOp === "boolean"
    ? game.hasCoOp
    : typeof game?.has_coop === "boolean"
      ? game.has_coop
      : typeof game?.online_fix === "boolean"
        ? game.online_fix
        : undefined
  const hasHv = typeof game?.hasHv === "boolean"
    ? game.hasHv
    : typeof game?.has_hv === "boolean"
      ? game.has_hv
      : undefined

  const minRequirements = game?.minRequirements ?? game?.min_requirements ?? null
  const recommendedRequirements = game?.recommendedRequirements ?? game?.recommended_requirements ?? null
  const linuxMinRequirements = game?.linuxMinRequirements ?? game?.linux_min_requirements ?? null
  const linuxRecommendedRequirements = game?.linuxRecommendedRequirements ?? game?.linux_recommended_requirements ?? null
  const sizeBytes = typeof game?.sizeBytes === "number"
    ? game.sizeBytes
    : typeof game?.size_bytes === "number"
      ? game.size_bytes
      : typeof game?.size_bytes === "string" && /^\d+$/.test(game.size_bytes)
        ? Number(game.size_bytes)
        : undefined
  const installedSizeBytes = typeof game?.installedSizeBytes === "number"
    ? game.installedSizeBytes
    : typeof game?.installed_size_bytes === "number"
      ? game.installed_size_bytes
      : undefined

  return {
    ...game,
    appid: String(game?.appid || ""),
    name: normalizedName,
    description: normalizedDescription,
    genres: Array.isArray(game?.genres) ? game.genres : [],
    image: typeof game?.image === "string" && game.image ? game.image : "./fallbacks/game-card-3x4.svg",
    screenshots: Array.isArray(game?.screenshots) ? game.screenshots : [],
    release_date: typeof game?.release_date === "string" ? game.release_date : "",
    size: typeof game?.size === "string" ? game.size : "",
    sizeBytes,
    installedSizeBytes,
    source: typeof game?.source === "string" && game.source ? game.source : "local",
    store: typeof game?.store === "string" ? game.store : "",
    developer,
    hasCoOp,
    hasHv,
    dlc: Array.isArray(game?.dlc) ? game.dlc : [],
    minRequirements,
    recommendedRequirements,
    linuxMinRequirements,
    linuxRecommendedRequirements,
    searchText: normalizeSearchText(`${normalizedName} ${normalizedDescription} ${(Array.isArray(game?.genres) ? game.genres.join(" ") : "")} ${developer}`),
  }
}

const NORMALIZE_SLICE = 300

async function normalizeCatalogGamesChunked(games: unknown[]): Promise<CatalogGame[]> {
  const out = new Array<CatalogGame>(games.length)
  for (let i = 0; i < games.length; i += NORMALIZE_SLICE) {
    const end = Math.min(i + NORMALIZE_SLICE, games.length)
    for (let j = i; j < end; j++) out[j] = normalizeCatalogGame(games[j])
    if (end < games.length) await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  return out
}

export function getCatalogCache(): CatalogSnapshot {
  return {
    games: memoryCache.games,
    updatedAt: memoryCache.updatedAt,
    gamesUpdatedAt: memoryCache.gamesUpdatedAt,
  }
}

function setCatalogCache(snapshot: Partial<CatalogSnapshot>) {
  if (Array.isArray(snapshot.games)) {
    memoryCache.games = snapshot.games
  }
  if (snapshot.updatedAt !== undefined) memoryCache.updatedAt = Number(snapshot.updatedAt || 0)
  if (snapshot.gamesUpdatedAt !== undefined) memoryCache.gamesUpdatedAt = Number(snapshot.gamesUpdatedAt || 0)
}

export function hasUsableCatalogCache(): boolean {
  return memoryCache.games.length > 0
}

export function isCatalogGamesStale(now = Date.now()): boolean {
  return !memoryCache.gamesUpdatedAt || now - memoryCache.gamesUpdatedAt > CATALOG_TTL_MS
}

export async function hydrateCatalogCache(): Promise<CatalogSnapshot> {
  if (memoryCache.hydrated) return getCatalogCache()
  if (memoryCache.hydratePromise) return memoryCache.hydratePromise

  memoryCache.hydratePromise = (async () => {
    try {
      const result = await window.ucDownloads?.loadCatalogState?.()
      if (result?.ok) {
        const games = Array.isArray(result.games) ? result.games : []
        const cleaned = games.map((game) => {
          if (!game || typeof game !== "object") return game
          const meta = game as any
          if (
            !meta.localImage
            && !meta.localSplash
            && !meta.localHeroImage
            && !meta.localBackgroundImage
            && !meta.localHeroLogo
            && !meta.localHeroAnimated
            && !meta.localScreenshots
          ) {
            return game
          }
          const next: any = { ...game }
          delete next.localImage
          delete next.localSplash
          delete next.localHeroImage
          delete next.localBackgroundImage
          delete next.localHeroLogo
          delete next.localHeroAnimated
          delete next.localScreenshots
          return next
        })
        setCatalogCache({
          games: await normalizeCatalogGamesChunked(cleaned),
          updatedAt: result.updatedAt,
          gamesUpdatedAt: result.gamesUpdatedAt,
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

function stripLocalMediaForPersistence(game: CatalogGame): CatalogGame {
  const meta = game as any
  if (
    !meta?.localImage
    && !meta?.localSplash
    && !meta?.localHeroImage
    && !meta?.localBackgroundImage
    && !meta?.localHeroLogo
    && !meta?.localHeroAnimated
    && !meta?.localScreenshots
  ) {
    return game
  }
  const next: any = { ...game }
  delete next.localImage
  delete next.localSplash
  delete next.localHeroImage
  delete next.localBackgroundImage
  delete next.localHeroLogo
  delete next.localHeroAnimated
  delete next.localScreenshots
  return next as CatalogGame
}

let catalogFlushScheduled = false

async function flushCatalogToDisk(): Promise<void> {
  try {
    const result = await window.ucDownloads?.saveCatalogState?.({
      games: memoryCache.games.map((game) => stripLocalMediaForPersistence(game)),
      gamesUpdatedAt: memoryCache.gamesUpdatedAt,
    })
    if (!result?.ok) {
      throw new Error(result?.error || "persist_catalog_failed")
    }
  } catch (error) {
    gameLogger.warn("Failed to persist catalog cache", { data: { error: String(error) } })
  }
}

function scheduleCatalogDiskFlush(): void {
  if (catalogFlushScheduled) return
  catalogFlushScheduled = true
  const run = () => {
    catalogFlushScheduled = false
    void flushCatalogToDisk()
  }
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 1000 })
  else setTimeout(run, 250)
}

export async function persistCatalogCache(snapshot: Partial<CatalogSnapshot>): Promise<void> {
  const nextGamesUpdatedAt = Number(snapshot.gamesUpdatedAt ?? memoryCache.gamesUpdatedAt ?? Date.now())
  const updatedAt = Math.max(nextGamesUpdatedAt, Number(snapshot.updatedAt || 0))

  setCatalogCache({
    games: Array.isArray(snapshot.games) ? await normalizeCatalogGamesChunked(snapshot.games) : undefined,
    updatedAt,
    gamesUpdatedAt: nextGamesUpdatedAt,
  })

  scheduleCatalogDiskFlush()
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
              image: entry.image || "./fallbacks/game-card-3x4.svg",
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

function withPreferredInstalledMedia(game: CatalogGame): CatalogGame {
  const meta: any = game as any
  const localImage = typeof meta?.localImage === "string" && meta.localImage
    ? meta.localImage
    : typeof meta?.metadata?.localImage === "string" && meta.metadata.localImage
      ? meta.metadata.localImage
      : ""
  const localSplash = typeof meta?.localSplash === "string" && meta.localSplash
    ? meta.localSplash
    : typeof meta?.metadata?.localSplash === "string" && meta.metadata.localSplash
      ? meta.metadata.localSplash
      : ""
  const localScreenshots = Array.isArray(meta?.localScreenshots)
    ? meta.localScreenshots.filter((entry: unknown): entry is string => typeof entry === "string" && entry.length > 0)
    : Array.isArray(meta?.metadata?.localScreenshots)
      ? meta.metadata.localScreenshots.filter((entry: unknown): entry is string => typeof entry === "string" && entry.length > 0)
      : []

  return normalizeCatalogGame({
    ...game,
    screenshots: localScreenshots.length > 0 ? localScreenshots : game.screenshots,
    localImage: localImage || meta?.localImage || meta?.metadata?.localImage,
    localSplash: localSplash || meta?.localSplash || meta?.metadata?.localSplash,
    localScreenshots: localScreenshots.length > 0 ? localScreenshots : meta?.localScreenshots || meta?.metadata?.localScreenshots,
  })
}

export async function mergeInstalledGames(games: CatalogGame[]): Promise<CatalogGame[]> {
  const installed = await readInstalledGames()
  const installedNormalized = installed.map((game) => withPreferredInstalledMedia(game))

  const mergedByAppid = new Map<string, CatalogGame>()
  for (const game of games) mergedByAppid.set(game.appid, normalizeCatalogGame(game))
  for (const game of installedNormalized) {
    if (!game?.appid) continue

    const existing = mergedByAppid.get(game.appid)
    if (!existing) {
      mergedByAppid.set(game.appid, normalizeCatalogGame(game))
      continue
    }

    const installedMeta: any = game as any
    const existingMeta: any = existing as any
    const gameMedia: any = game as any
    const localScreenshots = Array.isArray(installedMeta?.localScreenshots) && installedMeta.localScreenshots.length > 0
      ? installedMeta.localScreenshots
      : Array.isArray(existingMeta?.localScreenshots)
        ? existingMeta.localScreenshots
        : existing.screenshots

    mergedByAppid.set(
      game.appid,
      normalizeCatalogGame({
        ...existing,
        hero_image: gameMedia?.hero_image || existingMeta?.hero_image,
        background_image: gameMedia?.background_image || existingMeta?.background_image,
        hero_logo: gameMedia?.hero_logo || existingMeta?.hero_logo,
        hero_animated: gameMedia?.hero_animated || existingMeta?.hero_animated,
        image: game.image || existing.image,
        splash: game.splash || existing.splash,
        screenshots: localScreenshots,
        localImage: installedMeta?.localImage || existingMeta?.localImage,
        localSplash: installedMeta?.localSplash || existingMeta?.localSplash,
        localHeroImage: installedMeta?.localHeroImage || existingMeta?.localHeroImage,
        localBackgroundImage: installedMeta?.localBackgroundImage || existingMeta?.localBackgroundImage,
        localHeroLogo: installedMeta?.localHeroLogo || existingMeta?.localHeroLogo,
        localHeroAnimated: installedMeta?.localHeroAnimated || existingMeta?.localHeroAnimated,
        localScreenshots,
      })
    )
  }
  return Array.from(mergedByAppid.values())
}

export async function fetchCatalogGames(): Promise<CatalogGame[]> {
  const response = await apiFetch("/api/games")
  if (!response.ok) {
    throw new Error(`Failed to load games (${response.status})`)
  }
  const data = await response.json()
  return Array.isArray(data) ? normalizeCatalogGamesChunked(data) : []
}

