import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from "react"
import { useNavigate } from "react-router-dom"
import { GameCard } from "@/components/GameCard"
import { GameCardCompact } from "@/components/GameCardCompact"
import { GameCardSkeleton } from "@/components/GameCardSkeleton"
import { PageAura } from "@/components/page-aura"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorMessage } from "@/components/ErrorMessage"
import { AnimatedCounter } from "@/components/AnimatedCounter"
import { OfflineBanner } from "@/components/OfflineBanner"
import { CriticalLoadModal } from "@/components/CriticalLoadModal"
import { HeroSlider } from "@/components/HeroSlider"
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel"
import { PaginationBar } from "@/components/PaginationBar"
import { formatNumber, generateErrorCode, ErrorTypes, getInstalledVersionLabel, hasInstalledVersionUpdate, proxyImageUrl } from "@/lib/utils"
import { useConnectivityStatus } from "@/hooks/use-online-status"
import { fetchCatalogGames, fetchCatalogStats, getCatalogCache, hydrateCatalogCache, isCatalogGamesStale, isCatalogStatsStale, mergeInstalledGames, persistCatalogCache, type CatalogGame } from "@/lib/catalog"
import { apiFetch } from "@/lib/api"
import { ArrowRight, Cloud, X } from "lucide-react"
import { Download, Layers3 } from "@/components/icons"
import { usePlayHistory, type PlayHistoryGame } from "@/hooks/use-play-history"
import { useUserCollections } from "@/hooks/use-user-collections"
import { reportPlayEvent } from "@/lib/cloud-collections"

type Game = CatalogGame

const cardCarouselNavClass = "bg-secondary/80 hover:bg-primary hover:text-primary-foreground border-white/[.08] text-foreground/80 backdrop-blur-sm transition-all active:scale-95"

export function LauncherPage() {
  const navigate = useNavigate()
  const { isOnline, browserOnline, serviceReachable } = useConnectivityStatus()
  const initialCatalog = getCatalogCache()
  // Request more than we plan to show so that locally-installed entries that
  // are filtered out of the "From your cloud library" carousel don't drop the
  // visible count below the basis-1/5 layout and leave the strip half-empty.
  const playHistory = usePlayHistory(25)
  const userCollections = useUserCollections()

  class GamesFetchError extends Error {
    status?: number
    constructor(message: string, status?: number) {
      super(message)
      this.name = "GamesFetchError"
      this.status = status
    }
  }

  const isTransientGamesFetchError = (error: unknown): boolean => {
    // TypeError is the common fetch() exception for network errors.
    if (error instanceof TypeError) return true
    const status = error instanceof GamesFetchError ? error.status : undefined
    // Treat common upstream/startup statuses as transient (DB warming up, gateway unavailable, etc.).
    return status === 500 || status === 502 || status === 503 || status === 504
  }

  const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

  const [games, setGames] = useState<Game[]>(initialCatalog.games)
  const [loading, setLoading] = useState(initialCatalog.games.length === 0)
  const [refreshing, setRefreshing] = useState(false)
  const [gameStats, setGameStats] = useState<Record<string, { downloads: number; views: number }>>(initialCatalog.stats)
  const [refreshKey, setRefreshKey] = useState(0)
  const [gamesError, setGamesError] = useState<{ type: string; message: string; code: string } | null>(null)
  const [criticalLoadOpen, setCriticalLoadOpen] = useState(false)
  const [hasLoadedGames, setHasLoadedGames] = useState(initialCatalog.games.length > 0)
  const [emptyStateReady, setEmptyStateReady] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [recentlyInstalledGames, setRecentlyInstalledGames] = useState<Game[]>([])
  // Most-recently-played installed game — drives the "Continue where you
  // left off" hero tile. Resolved by cross-referencing the installed list
  // with the lastPlayedAt timestamps in libraryGameMeta (electron-store).
  const [lastPlayedGame, setLastPlayedGame] = useState<{ game: Game; lastPlayedAt: number } | null>(null)
  // Full set of locally-installed appids so the cloud carousel can subtract
  // them — kept separate from `recentlyInstalledGames` (which is sliced to 10
  // for the carousel itself).
  const [installedAppidSet, setInstalledAppidSet] = useState<Set<string>>(() => new Set())
  const [installedVersionMap, setInstalledVersionMap] = useState<Record<string, string[]>>({})
  const itemsPerPage = 30
  // Cloud-library removal undo state. When the user × an entry off the "Not
  // on this PC" carousel we keep a copy of the row plus a timer; the undo
  // toast restores it server-side (and visually) until the timer expires.
  const [cloudRemovalUndo, setCloudRemovalUndo] = useState<PlayHistoryGame | null>(null)
  const cloudRemovalUndoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [statsCacheTime, setStatsCacheTime] = useState<number>(initialCatalog.statsUpdatedAt || 0)
  const [siteStats, setSiteStats] = useState<{
    totalGames: number
    totalSizeGB: number
    totalDownloads: number
    totalRequests: number
    updatedGamesLast7Days: number
    usersOnline: number
    playersNow: number
    totalPlaytimeSeconds: number
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    let interval: number | null = null
    const fetchSiteStats = async () => {
      try {
        const [statsRes, requestsRes] = await Promise.all([
          apiFetch("/api/site-stats").catch(() => null),
          apiFetch("/api/requests/total").catch(() => null),
        ])
        if (cancelled) return
        const stats = statsRes && statsRes.ok ? await statsRes.json() : null
        const requests = requestsRes && requestsRes.ok ? await requestsRes.json() : null
        if (cancelled || !stats) return
        setSiteStats({
          totalGames: stats.totalGames ?? 0,
          totalSizeGB: stats.totalSizeGB ?? 0,
          totalDownloads: stats.totalDownloads ?? 0,
          totalRequests: typeof requests === "number" ? requests : (requests?.total ?? 0),
          updatedGamesLast7Days: stats.updatedGamesLast7Days ?? 0,
          usersOnline: stats.usersOnline ?? stats.activePlayers ?? 0,
          playersNow: stats.playersNow ?? 0,
          totalPlaytimeSeconds: stats.totalPlaytimeSeconds ?? 0,
        })
      } catch {
        // ignore — fall back to derived stats
      }
    }

    // Only run the 30s heartbeat while the window is actually visible. Without
    // this gate the polling kept hitting the API every 30s for users who left
    // the launcher minimised — pure waste on both client and server. When the
    // window returns to the foreground we kick off an immediate fetch so the
    // stats are fresh, then resume the interval.
    const stop = () => {
      if (interval !== null) {
        window.clearInterval(interval)
        interval = null
      }
    }
    const start = () => {
      if (interval !== null) return
      void fetchSiteStats()
      interval = window.setInterval(fetchSiteStats, 30_000)
    }
    const visible = typeof document === "undefined" || document.visibilityState === "visible"
    if (visible) start()

    const onVisibility = () => {
      if (document.visibilityState === "visible") start()
      else stop()
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      cancelled = true
      stop()
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [])

  const activeLoadIdRef = useRef(0)
  const hasCriticalServiceInterruption = browserOnline && !serviceReachable

  useEffect(() => {
    loadGames()
  }, [])

  useEffect(() => {
    if (loading) {
      setEmptyStateReady(false)
      return
    }
    const timer = window.setTimeout(() => {
      setEmptyStateReady(true)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [loading])

  // Auto-retry when coming back online
  useEffect(() => {
    if (isOnline && games.length === 0 && !loading) {
      setGamesError(null)
      setLoading(true)
      loadGames(true)
    }
  }, [isOnline])

  useEffect(() => {
    setCriticalLoadOpen(Boolean(gamesError) && hasCriticalServiceInterruption)
  }, [gamesError, hasCriticalServiceInterruption])

  useEffect(() => {
    if (typeof window === "undefined") return
    const handleHomeNav = () => {
      document.getElementById("featured")?.scrollIntoView({ behavior: "smooth" })
    }
    const handleHomeHero = () => {
      document.getElementById("hero")?.scrollIntoView({ behavior: "smooth" })
    }

    window.addEventListener("uc_home_nav", handleHomeNav)
    window.addEventListener("uc_home_hero", handleHomeHero)
    return () => {
      window.removeEventListener("uc_home_nav", handleHomeNav)
      window.removeEventListener("uc_home_hero", handleHomeHero)
    }
  }, [])

  useEffect(() => {
    let ignore = false
    const loadInstalled = async () => {
      const installedMap = new Map<string, Game>()
      const nextInstalledVersions: Record<string, string[]> = {}
      try {
        if (typeof window !== "undefined") {
          const installedList =
            ((await window.ucDownloads?.listInstalledGlobal?.()) as any[]) ||
            ((await window.ucDownloads?.listInstalled?.()) as any[]) ||
            []

          for (const entry of installedList) {
            const meta = (entry && (entry.metadata || entry.game)) || entry
            if (meta && meta.appid) {
              const versionLabel = getInstalledVersionLabel(entry)
              if (versionLabel) {
                nextInstalledVersions[meta.appid] = Array.from(new Set([...(nextInstalledVersions[meta.appid] || []), versionLabel]))
              }
              installedMap.set(meta.appid, {
                ...meta,
                name: meta.name || meta.appid,
                // Don't pre-collapse to localImage — pass both so the card's
                // candidate chain can fall through to the remote URL when the
                // local file is gone (drive offline, partial install cleared,
                // etc.). Previously this produced broken recently-installed
                // tiles whenever a manifest pointed at a now-stale cache path.
                image: meta.image || "./fallbacks/game-card-3x4.svg",
                localImage: meta.localImage,
                genres: Array.isArray(meta.genres) ? meta.genres : [],
              })
            }
          }
        }
      } catch {
        // ignore installed lookup failures
      }

      const installedGames = Array.from(installedMap.values())
      // Sort by actual install timestamp. Manifests expose `installedAt` (set
      // when the download finishes); fall back to `addedAt` for older records
      // and finally to alphabetical name so the order is never random.
      installedGames.sort((a: any, b: any) => {
        const aTs = Number(a.installedAt) || Number(a.addedAt) || 0
        const bTs = Number(b.installedAt) || Number(b.addedAt) || 0
        if (bTs !== aTs) return bTs - aTs
        return String(a.name || a.appid).localeCompare(String(b.name || b.appid))
      })
      const resolved = installedGames.slice(0, 10)

      if (!ignore) {
        setRecentlyInstalledGames(resolved)
        setInstalledAppidSet(new Set(installedGames.map((g) => String(g.appid))))
        setInstalledVersionMap(nextInstalledVersions)
      }

      // Resolve "last played" — read libraryGameMeta and find the installed
      // game with the most recent lastPlayedAt. Best-effort; if the setting
      // hasn't been written yet (user never launched anything) we just skip.
      try {
        const meta = await window.ucSettings?.get?.("libraryGameMeta")
        if (ignore || !meta || typeof meta !== "object" || Array.isArray(meta)) {
          if (!ignore) setLastPlayedGame(null)
          return
        }
        const metaMap = meta as Record<string, { lastPlayedAt?: number }>
        let bestAppid: string | null = null
        let bestTs = 0
        for (const [appid, entry] of Object.entries(metaMap)) {
          const ts = Number(entry?.lastPlayedAt) || 0
          if (ts > bestTs && installedMap.has(appid)) {
            bestTs = ts
            bestAppid = appid
          }
        }
        if (bestAppid && installedMap.has(bestAppid)) {
          if (!ignore) setLastPlayedGame({ game: installedMap.get(bestAppid)!, lastPlayedAt: bestTs })
        } else {
          if (!ignore) setLastPlayedGame(null)
        }
      } catch { /* ignore */ }
    }

    void loadInstalled()

    return () => {
      ignore = true
    }
  }, [refreshKey])

  useEffect(() => {
    if (typeof window === "undefined") return
    const handleFocus = () => setRefreshKey((prev) => prev + 1)
    const handleGameInstalled = () => setRefreshKey((prev) => prev + 1)
    window.addEventListener("focus", handleFocus)
    window.addEventListener("uc_game_installed", handleGameInstalled)
    return () => {
      window.removeEventListener("focus", handleFocus)
      window.removeEventListener("uc_game_installed", handleGameInstalled)
    }
  }, [])

  const loadGames = async (forceRefresh = false) => {
    const loadId = ++activeLoadIdRef.current
    const isInitialLoad = !hasLoadedGames && games.length === 0
    // Previously this was 12 attempts (~60s of skeleton on a cold backend).
    // 4 attempts at 500/1000/2000/4000ms = ~7.5s worst case before we surface
    // an error UI the user can act on. The 2-attempt budget for refreshes is
    // unchanged since they already have content on screen.
    const maxAttempts = isInitialLoad ? 4 : 2

    // While the DB/API is warming up, keep the skeleton visible rather than flashing empty/error states.
    let refreshStart: number | null = null
    if (isInitialLoad) setLoading(true)
    if (forceRefresh) {
      setRefreshing(true)
      refreshStart = Date.now()
    }
    setGamesError(null)

    const hydrated = await hydrateCatalogCache()
    if (loadId !== activeLoadIdRef.current) return

    if (hydrated.games.length > 0 || Object.keys(hydrated.stats).length > 0) {
      startTransition(() => {
        if (hydrated.games.length > 0) setGames(hydrated.games)
        setGameStats(hydrated.stats)
        setHasLoadedGames(hydrated.games.length > 0)
        setStatsCacheTime(hydrated.statsUpdatedAt || 0)
      })
      if (isInitialLoad) setLoading(false)
    }

    const shouldRefreshGames = forceRefresh || (isOnline && (!hydrated.games.length || isCatalogGamesStale()))
    const shouldRefreshStats = forceRefresh || (isOnline && (!Object.keys(hydrated.stats).length || isCatalogStatsStale()))

    if (!shouldRefreshGames && !shouldRefreshStats) {
      setLoading(false)
      setRefreshing(false)
      return
    }

    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      // Surface a transient "still loading…" banner once we've already retried
      // a couple of times so users on a slow backend get visible feedback
      // instead of a perpetually-static skeleton.
      if (isInitialLoad && attempt === 2) {
        setGamesError({
          type: "games_warming_up",
          message: "Server is taking longer than usual — still trying…",
          code: "TRANSIENT",
        })
      }
      try {
        const gamesData = await mergeInstalledGames(
          shouldRefreshGames ? await fetchCatalogGames() : getCatalogCache().games
        )
        const nextStats = shouldRefreshStats ? await fetchCatalogStats() : getCatalogCache().stats
        if (loadId !== activeLoadIdRef.current) return

        startTransition(() => {
          setGames(gamesData)
          setGameStats(nextStats)
          setHasLoadedGames(true)
          setStatsCacheTime(Date.now())
        })
        // Clear the transient "warming up" banner if it was shown.
        setGamesError(null)

        void persistCatalogCache({
          games: gamesData,
          stats: nextStats,
          gamesUpdatedAt: shouldRefreshGames ? Date.now() : getCatalogCache().gamesUpdatedAt,
          statsUpdatedAt: shouldRefreshStats ? Date.now() : getCatalogCache().statsUpdatedAt,
        })

        setLoading(false)
        if (refreshStart !== null) {
          const elapsed = Date.now() - refreshStart
          const minDuration = 500 // ms
          if (elapsed < minDuration) {
            setTimeout(() => setRefreshing(false), minDuration - elapsed)
          } else {
            setRefreshing(false)
          }
        } else {
          setRefreshing(false)
        }
        return
      } catch (error) {
        if (loadId !== activeLoadIdRef.current) return

        // If we went offline mid-load, stop retrying and let the offline UI handle it.
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          if (hydrated.games.length > 0 || Object.keys(hydrated.stats).length > 0) {
            setLoading(false)
            setRefreshing(false)
            return
          }
          setLoading(false)
          setRefreshing(false)
          return
        }

        const transient = isOnline && isTransientGamesFetchError(error)
        const hasMoreAttempts = attempt < maxAttempts

        if (transient && hasMoreAttempts) {
          const delayMs = Math.min(8000, 500 * Math.pow(2, attempt))
          await sleep(delayMs)
          continue
        }

        console.error("Error loading games:", error)

        if (hydrated.games.length > 0 || Object.keys(hydrated.stats).length > 0) {
          setLoading(false)
          setRefreshing(false)
          return
        }

        setGamesError({
            type: "games",
            message:
              error instanceof GamesFetchError && error.status
                ? `Unable to load games (Status: ${error.status}). Please try again or contact support if the issue persists.`
                : "Unable to load games. Please try again or contact support if the issue persists.",
            code: generateErrorCode(ErrorTypes.GAME_FETCH, "launcher"),
          })
        setLoading(false)
        setRefreshing(false)
        return
      }
    }
  }

  const newReleases = useMemo(() => {
    return games.slice(0, 8)
  }, [games])

  // Clean up the undo timer on unmount so we don't leak it.
  useEffect(() => {
    return () => {
      if (cloudRemovalUndoTimerRef.current) clearTimeout(cloudRemovalUndoTimerRef.current)
    }
  }, [])

  const handleCloudRemoval = useCallback((entry: PlayHistoryGame) => {
    if (cloudRemovalUndoTimerRef.current) clearTimeout(cloudRemovalUndoTimerRef.current)
    setCloudRemovalUndo(entry)
    cloudRemovalUndoTimerRef.current = setTimeout(() => setCloudRemovalUndo(null), 6000)
    void playHistory.removeEntry(entry.appid)
  }, [playHistory])

  const handleCloudRemovalUndo = useCallback(async () => {
    const entry = cloudRemovalUndo
    if (!entry) return
    setCloudRemovalUndo(null)
    if (cloudRemovalUndoTimerRef.current) {
      clearTimeout(cloudRemovalUndoTimerRef.current)
      cloudRemovalUndoTimerRef.current = null
    }
    // Re-record an install event so the row reappears in play-history. The
    // backend uses (discord_id, appid) as the conflict key so this restores
    // the same row rather than creating a duplicate.
    await reportPlayEvent(entry.appid, "install")
    playHistory.refresh()
  }, [cloudRemovalUndo, playHistory])

  // Games the user has installed or played on *another* device (from cloud
  // play history) that are NOT currently installed on this PC. Surface them
  // so the user can one-click install on this device. Prefers entries with
  // recent activity; falls back to install-only rows when those exist.
  const cloudUninstalled = useMemo(() => {
    if (!playHistory.items || playHistory.items.length === 0) return []
    return playHistory.items
      .filter((entry) => entry.game && !installedAppidSet.has(entry.appid))
      .slice(0, 12)
  }, [playHistory.items, installedAppidSet])

  const popularReleases = useMemo(() => {
    if (Object.keys(gameStats).length === 0) return []

    const getDaysDiff = (dateStr?: string) => {
      if (!dateStr) return 999
      const date = new Date(dateStr)
      if (isNaN(date.getTime())) return 999
      const now = new Date()
      const diffTime = Math.abs(now.getTime() - date.getTime())
      return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    }

    const isRecent = (dateStr?: string, days = 30) => getDaysDiff(dateStr) <= days

    const calculateScore = (game: Game) => {
      const stats = gameStats[game.appid] || { downloads: 0, views: 0 }
      let score = (stats.downloads * 2) + (stats.views * 0.5)

      if (isRecent(game.release_date, 30)) {
        score += 500
      }

      if (isRecent(game.update_time, 14)) {
        score += 300
      }

      return score
    }

    const candidates = games.filter((game) => {
      const isNSFW = Array.isArray(game.genres) && game.genres.some((genre) => genre?.toLowerCase() === "nsfw")
      return !isNSFW
    })

    const sorted = [...candidates].sort((a, b) => calculateScore(b) - calculateScore(a))

    return sorted.slice(0, 8)
  }, [games, gameStats])

  const popularAppIds = useMemo(() => new Set(popularReleases.map((game) => game.appid)), [popularReleases])

  const featuredGames = useMemo(() => {
    if (games.length === 0) return []
    return games
  }, [games])

  useEffect(() => {
    setCurrentPage(1)
  }, [featuredGames])

  const paginatedFeaturedGames = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    return featuredGames.slice(startIndex, endIndex)
  }, [featuredGames, currentPage, itemsPerPage])

  const totalPages = Math.ceil(featuredGames.length / itemsPerPage)
  const startItem = (currentPage - 1) * itemsPerPage + 1
  const endItem = Math.min(currentPage * itemsPerPage, featuredGames.length)

  const stats = useMemo(() => {
    const totalSizeGB = games.reduce((acc, game) => {
      const sizeMatch = (game.size || "").match(/(\d+(?:\.\d+)?)\s*(GB|MB)/i)
      if (sizeMatch) {
        const size = Number.parseFloat(sizeMatch[1])
        const unit = sizeMatch[2].toUpperCase()
        if (!isNaN(size) && size > 0) {
          return acc + (unit === "GB" ? size : size / 1024)
        }
      }
      return acc
    }, 0)

    const totalSizeTB = totalSizeGB > 0 ? Math.round((totalSizeGB / 1024) * 10) / 10 : 0
    const totalDownloads = Object.values(gameStats).reduce((acc, stat) => acc + (stat.downloads || 0), 0)

    return {
      totalGames: games.length,
      totalSizeGB: Math.round(totalSizeGB * 10) / 10,
      totalSizeTB: totalSizeTB,
      totalDownloads: totalDownloads,
    }
  }, [games, gameStats])

  const displayTotalSizeTB = (stats as any).totalSizeTB ?? 0
  const displayTotalSizeGB = (stats as any).totalSizeGB ?? Math.round(displayTotalSizeTB * 1024 * 10) / 10

  return (
    <div className="relative space-y-12 pb-4">
      <PageAura />
      <CriticalLoadModal
        open={Boolean(gamesError) && hasCriticalServiceInterruption && criticalLoadOpen}
        onOpenChange={setCriticalLoadOpen}
        title="Critical Data Load Failure"
        message={gamesError?.message || "Unable to load game data right now."}
        errorCode={gamesError?.code}
        onRetry={() => {
          setGamesError(null)
          setLoading(true)
          loadGames(true)
        }}
        onContinue={() => setCriticalLoadOpen(false)}
      />

      {/* Transient "still loading" banner — shows once the launcher has been
          waiting on the catalog for several retries. Distinct from the
          CriticalLoadModal which only fires when the service is unreachable. */}
      {loading && gamesError?.type === "games_warming_up" && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[.06] px-4 py-2.5 text-xs text-amber-200 backdrop-blur-sm">
          {gamesError.message}
        </div>
      )}

      {/* Full-width hero slider */}
      <HeroSlider games={games} gameStats={gameStats} loading={loading} />

      {/* Inline stats row — mirrors union-crax.xyz StatsSection */}
      <StatsRow
        totalGames={siteStats?.totalGames ?? stats.totalGames}
        totalSizeGB={siteStats?.totalSizeGB ?? displayTotalSizeGB}
        totalDownloads={siteStats?.totalDownloads ?? stats.totalDownloads}
        totalRequests={siteStats?.totalRequests ?? 0}
        updatedGamesLast7Days={siteStats?.updatedGamesLast7Days ?? 0}
        usersOnline={siteStats?.usersOnline ?? 0}
        playersNow={siteStats?.playersNow ?? 0}
        totalPlaytimeSeconds={siteStats?.totalPlaytimeSeconds ?? 0}
      />


      {/* Continue where you left off — single big tile pointing at the most
          recently played installed game. Click goes to the detail page so the
          existing launch flow (with preflight, exe picker, etc.) takes over,
          rather than half-implementing it inline here. */}
      {lastPlayedGame && (
        <section>
          <SectionHeading eyebrow="Pick up where you left off" title={lastPlayedGame.game.name} />
          <button
            type="button"
            onClick={() => navigate(`/game/${encodeURIComponent(lastPlayedGame.game.appid)}?launch=1`)}
            className="group relative w-full overflow-hidden rounded-3xl border border-white/[.07] bg-background/60 text-left transition hover:border-white/15 active:scale-[0.998]"
          >
            <div className="relative aspect-[21/9] sm:aspect-[24/9]">
              <img
                src={proxyImageUrl(
                  (lastPlayedGame.game as any).localHeroImage
                    || (lastPlayedGame.game as any).hero_image
                    || (lastPlayedGame.game as any).splash
                    || lastPlayedGame.game.image
                    || ""
                )}
                alt=""
                data-uc-handled="1"
                className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.015]"
                onError={(event) => { (event.target as HTMLImageElement).style.opacity = "0" }}
              />
              <div className="absolute inset-0 bg-gradient-to-r from-black via-black/55 to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
              <div className="relative z-10 flex h-full flex-col justify-end p-6 sm:p-8">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/80/80 mb-2">
                  Last played {formatLastPlayed(lastPlayedGame.lastPlayedAt)}
                </div>
                <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight mb-4 line-clamp-1">
                  {lastPlayedGame.game.name}
                </h2>
                <div>
                  <span className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg group-hover:brightness-110 transition">
                    <ArrowRight className="h-4 w-4" />
                    Continue playing
                  </span>
                </div>
              </div>
            </div>
          </button>
        </section>
      )}

      {/* Recently installed — always rendered when we have any local installs,
          independent of the cloud carousel below. Previously this section was
          hidden whenever the cloud history had any rows, which made it fight
          for screen space with the cloud strip. */}
      {recentlyInstalledGames.length > 0 && (
        <section>
          <div>
            <SectionHeading
              eyebrow="Your games"
              title="Recently installed"
              actionLabel="View all"
              onAction={() => navigate("/library")}
            />

            <Carousel
              opts={{
                align: "start",
                loop: false,
                skipSnaps: false,
                dragFree: true,
              }}
              className="w-full"
            >
              <CarouselContent className="-ml-2 md:-ml-4">
                {recentlyInstalledGames.map((game) => (
                  <CarouselItem
                    key={game.appid}
                    className="pl-2 md:pl-4 basis-1/2 sm:basis-1/3 md:basis-1/4 lg:basis-1/5"
                  >
                    <GameCardCompact
                      game={{
                        appid: game.appid,
                        name: game.name,
                        image: game.image,
                        genres: game.genres,
                      }}
                    />
                  </CarouselItem>
                ))}
                <CarouselItem className="pl-2 md:pl-4 basis-1/2 sm:basis-1/3 md:basis-1/4 lg:basis-1/5">
                  <button
                    type="button"
                    onClick={() => navigate("/library")}
                    className="group block h-full w-full text-left"
                    aria-label="Open your installed library"
                  >
                    <div className="h-full rounded-2xl border border-dashed border-border bg-card/60 p-4 flex flex-col items-center justify-center text-center transition hover:border-zinc-500 active:scale-[.98]">
                      <div className="text-sm font-semibold text-foreground/90">View all</div>
                      <div className="mt-2 text-muted-foreground group-hover:text-white"><ArrowRight className="h-4 w-4" /></div>
                    </div>
                  </button>
                </CarouselItem>
              </CarouselContent>
              <CarouselPrevious className={cardCarouselNavClass} />
              <CarouselNext className={cardCarouselNavClass} />
            </Carousel>
          </div>
        </section>
      )}

      {/* From your cloud library — games this account has installed or played
          on *another* device that aren't on this PC yet. Filtered so it's
          actionable (one-click install on this device) rather than a noisy
          mirror of the local "Recently installed" strip. */}
      {playHistory.authed && cloudUninstalled.length > 0 && (
        <section className="overflow-visible">
          <SectionHeading
            eyebrow="From your cloud library"
            title="Install on this PC"
            icon={<Cloud className="h-4 w-4" />}
            actionLabel="See all"
            onAction={() => navigate("/library")}
          />
          <p className="-mt-1 mb-3 text-xs text-muted-foreground/80">
            On your account but not installed here. Click any game to install it on this device.
          </p>
          <Carousel
            opts={{ align: "start", loop: false, skipSnaps: false, dragFree: true }}
            className="w-full"
          >
            <CarouselContent className="-ml-2 md:-ml-4">
              {cloudUninstalled.map((entry) => {
                const playedHere = (entry.playCount ?? 0) > 0
                const installedElsewhere = Boolean(entry.installedAt)
                const subtitle = playedHere
                  ? "Played on another device"
                  : installedElsewhere
                    ? "Installed on another device"
                    : "On your account"
                return (
                  <CarouselItem
                    key={entry.appid}
                    className="pl-2 md:pl-4 basis-1/2 sm:basis-1/3 md:basis-1/4 lg:basis-1/5"
                  >
                    <div className="group/cloud relative">
                      <GameCardCompact
                        game={{
                          appid: entry.appid,
                          name: entry.game!.name,
                          image: entry.game!.image,
                          genres: Array.isArray(entry.game!.genres) ? entry.game!.genres : [],
                        }}
                      />
                      {/* Inline overlay — uses the same chrome as the "Popular"
                          badge (zinc/white) so it reads cleanly on every cover
                          regardless of art tone. */}
                      <div
                        className="pointer-events-none absolute top-2 left-2 z-10 inline-flex items-center gap-1 rounded-full border border-white/10 bg-secondary/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur-sm"
                        title={subtitle}
                      >
                        <Download className="h-2.5 w-2.5" />
                        <span>Not on this PC</span>
                      </div>
                      {/* Remove from cloud library. Useful when the user no
                          longer wants to see a game they removed from this PC
                          (the cloud play-history record otherwise persists). */}
                      <button
                        type="button"
                        title="Remove from cloud library"
                        aria-label={`Remove ${entry.game!.name} from cloud library`}
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          handleCloudRemoval(entry)
                        }}
                        className="absolute top-2 right-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-black/70 text-foreground/90 opacity-0 transition-all hover:bg-red-500/20 hover:text-red-300 group-hover/cloud:opacity-100 focus-visible:opacity-100 active:scale-95"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </CarouselItem>
                )
              })}
            </CarouselContent>
            <CarouselPrevious className={cardCarouselNavClass} />
            <CarouselNext className={cardCarouselNavClass} />
          </Carousel>
        </section>
      )}

      {!isOnline && games.length === 0 && !loading && (
        <OfflineBanner
          onRetry={() => {
            setGamesError(null)
            setLoading(true)
            loadGames(true)
          }}
        />
      )}

      {!isOnline && games.length > 0 && (
        <section className="py-4 px-4">
          <div className="container mx-auto max-w-4xl">
            <OfflineBanner
              variant="compact"
              onRetry={() => {
                setGamesError(null)
                setLoading(true)
                loadGames(true)
              }}
            />
          </div>
        </section>
      )}

      {(loading || newReleases.length > 0) && (
        <section className="overflow-visible">
          <div>
            {loading ? (
              <>
                <div className="mb-5">
                  <Skeleton className="h-7 w-48 mb-2" />
                  <Skeleton className="h-4 w-80" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <GameCardSkeleton key={`skeleton-latest-${index}`} />
                  ))}
                </div>
              </>
            ) : (
              <>
                <SectionHeading
                  eyebrow="New"
                  title="Latest games"
                  actionLabel="Browse all"
                  onAction={() => navigate("/search?sort=added")}
                />
                <Carousel
                  opts={{
                    align: "start",
                    loop: false,
                    skipSnaps: false,
                    dragFree: true,
                  }}
                  className="w-full"
                >
                  <CarouselContent className="-ml-2 md:-ml-4">
                    {newReleases.map((game) => (
                      <CarouselItem
                        key={game.appid}
                        className="pl-2 md:pl-4 basis-full sm:basis-1/2 md:basis-1/3 lg:basis-1/3 xl:basis-1/4"
                      >
                        <GameCard
                          game={game}
                          stats={gameStats[game.appid]}
                          updateAvailable={hasInstalledVersionUpdate(game.version, installedVersionMap[game.appid] || [])}
                          updateLabel={game.version ? `Update available - ${game.version}` : "Update available"}
                        />
                      </CarouselItem>
                    ))}
                  </CarouselContent>
                  <CarouselPrevious className={cardCarouselNavClass} />
                  <CarouselNext className={cardCarouselNavClass} />
                </Carousel>
              </>
            )}
          </div>
        </section>
      )}

      {(loading || popularReleases.length > 0) && (
        <section className="overflow-visible">
          <div>
            {loading ? (
              <div className="mb-5">
                <Skeleton className="h-7 w-64 mb-2" />
                <Skeleton className="h-4 w-96" />
              </div>
            ) : (
              <SectionHeading
                eyebrow="Trending"
                title="Most popular"
                actionLabel="Browse all"
                onAction={() => navigate("/search?sort=downloads-desc")}
              />
            )}

            {loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <GameCardSkeleton key={`skeleton-popular-${index}`} />
                ))}
              </div>
            ) : (
              <Carousel

                opts={{
                  align: "start",
                  loop: false,
                  skipSnaps: false,
                  dragFree: true,
                }}
                className="w-full"
              >
                <CarouselContent className="-ml-2 md:-ml-4">
                  {popularReleases.map((game) => (
                    <CarouselItem
                      key={game.appid}
                      className="pl-2 md:pl-4 basis-full sm:basis-1/2 md:basis-1/3 lg:basis-1/3 xl:basis-1/4"
                    >
                      <GameCard
                        game={game}
                        stats={gameStats[game.appid]}
                        isPopular
                        updateAvailable={hasInstalledVersionUpdate(game.version, installedVersionMap[game.appid] || [])}
                        updateLabel={game.version ? `Update available - ${game.version}` : "Update available"}
                      />
                    </CarouselItem>
                  ))}
                </CarouselContent>
                <CarouselPrevious className={cardCarouselNavClass} />
                <CarouselNext className={cardCarouselNavClass} />
              </Carousel>
            )}
          </div>
        </section>
      )}

      {/* From your collections — surface the user's curated bundles inline. */}
      {userCollections.collections.length > 0 && (
        <section className="overflow-visible">
          <SectionHeading
            eyebrow="Curated by you"
            title="From your collections"
            icon={<Layers3 className="h-4 w-4" />}
            actionLabel="Manage"
            onAction={() => navigate("/collections")}
          />
          <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {userCollections.collections.slice(0, 4).map((collection) => {
              const previewIds = collection.appids.slice(0, 4)
              const previews = previewIds
                .map((id) => games.find((g) => g.appid === id))
                .filter(Boolean) as Game[]
              return (
                <button
                  key={collection.id}
                  type="button"
                  onClick={() => navigate(`/collections/view/${encodeURIComponent(collection.id)}`)}
                  className="group flex flex-col rounded-3xl border border-white/[.07] bg-card/40 backdrop-blur-md overflow-hidden transition-colors hover:border-white/[.14] text-left"
                >
                  <div className="relative aspect-[16/10] w-full overflow-hidden bg-card">
                    {previews.length === 0 ? (
                      <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40">
                        <Layers3 className="h-10 w-10" />
                      </div>
                    ) : (
                      <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-px bg-background">
                        {previews.map((g) => (
                          <div key={g.appid} className="relative overflow-hidden">
                            <img
                              src={proxyImageUrl(g.image) || "./fallbacks/game-hero-16x9.svg"}
                              alt=""
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          </div>
                        ))}
                        {Array.from({ length: Math.max(0, 4 - previews.length) }).map((_, idx) => (
                          <div key={`empty-${idx}`} className="bg-card" />
                        ))}
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                    <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-2">
                      <span className="rounded-full border border-white/10 bg-black/60 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold text-foreground">
                        {collection.appids.length} games
                      </span>
                      <span className="rounded-full border border-white/10 bg-black/60 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold text-foreground opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1">
                        Open <ArrowRight className="h-2.5 w-2.5" />
                      </span>
                    </div>
                  </div>
                  <div className="px-4 py-3 border-t border-white/[.05]">
                    <p className="truncate text-sm font-semibold text-white">{collection.name}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      )}

      <section id="featured">
        <div>
          {loading ? (
            <>
              <div className="mb-5">
                <Skeleton className="h-7 w-56 mb-2 bg-muted/40" />
                <Skeleton className="h-4 w-96 bg-muted/30" />
              </div>
              <div className="grid gap-4 sm:gap-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
                {Array.from({ length: itemsPerPage }).map((_, i) => (
                  <GameCardSkeleton key={`skeleton-all-${i}`} />
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="mb-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <SectionHeading
                  eyebrow="Library"
                  title="All games"
                  className="mb-0"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setRefreshKey((prev) => prev + 1)
                    loadGames(true)
                  }}
                  disabled={refreshing}
                  className="rounded-full px-6"
                >
                  {refreshing ? "Refreshing..." : "Refresh Games"}
                </Button>
              </div>

              <div className="stagger-grid grid gap-4 sm:gap-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
                {(loading || refreshing) ? (
                  Array.from({ length: itemsPerPage }).map((_, i) => (
                    <GameCardSkeleton key={`skeleton-all-${i}`} />
                  ))
                ) : (
                  paginatedFeaturedGames.map((game) => {
                    const isGamePopular = popularAppIds.has(game.appid)

                    return <GameCard key={game.appid} game={game} stats={gameStats[game.appid]} isPopular={isGamePopular} />
                  })
                )}
              </div>
            </>
          )}

          <PaginationBar
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            wrapperClassName="mt-8"
          />

          {featuredGames.length === 0 && !loading && !isOnline && (
            <div className="text-center py-20">
              <div className="max-w-xl mx-auto">
                <OfflineBanner
                  onRetry={() => {
                    setGamesError(null)
                    setLoading(true)
                    loadGames(true)
                  }}
                />
              </div>
            </div>
          )}

          {featuredGames.length === 0 && emptyStateReady && !loading && isOnline && (
            <div className="text-center py-20">
              <div className="max-w-xl mx-auto">
                <ErrorMessage
                  title="No Games Available"
                  message="We couldn't find any games at the moment. Please try again later or contact support if the issue persists."
                  errorCode={generateErrorCode(ErrorTypes.GAME_FETCH, "launcher-empty")}
                  retry={() => {
                    setGamesError(null)
                    setLoading(true)
                    loadGames(true)
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Cloud library removal — undo toast. Fixed at bottom-center so it sits
          above the rest of the page but doesn't shift layout. 6 second
          self-dismiss timer matches the state in handleCloudRemoval. */}
      {cloudRemovalUndo && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9998] flex items-center gap-3 rounded-full border border-white/[.07] bg-background/92 px-4 py-2.5 text-sm text-foreground shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
          role="status"
        >
          <span className="text-foreground/80">
            Removed <span className="font-medium text-white">{cloudRemovalUndo.game?.name || cloudRemovalUndo.appid}</span> from cloud library
          </span>
          <button
            type="button"
            onClick={() => void handleCloudRemovalUndo()}
            className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground transition-colors hover:brightness-110 active:scale-95"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={() => setCloudRemovalUndo(null)}
            className="rounded-full p-0.5 text-muted-foreground/80 hover:text-foreground/90 transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

function formatLastPlayed(timestamp: number): string {
  if (!timestamp) return ""
  const delta = Date.now() - timestamp
  if (delta < 60_000) return "just now"
  const mins = Math.floor(delta / 60_000)
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`
  const months = Math.floor(days / 30)
  return `${months} month${months === 1 ? "" : "s"} ago`
}

function formatPlaytimeCompact(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 1000) return `${h}h`
  const k = Math.round(h / 100) / 10
  return `${k}kh`
}

function StatsRow({
  totalGames,
  totalSizeGB,
  totalDownloads,
  totalRequests,
  updatedGamesLast7Days,
  usersOnline,
  playersNow,
  totalPlaytimeSeconds,
}: {
  totalGames: number
  totalSizeGB: number
  totalDownloads: number
  totalRequests: number
  updatedGamesLast7Days: number
  usersOnline: number
  playersNow: number
  totalPlaytimeSeconds: number
}) {
  const showStorage = totalSizeGB > 0
  const storageDisplay = totalSizeGB >= 1024
    ? <AnimatedCounter value={Math.round((totalSizeGB / 1024) * 10) / 10} suffix="TB" />
    : <AnimatedCounter value={totalSizeGB} suffix="GB" />

  return (
    <section className="anim anim-d1 rounded-2xl border border-white/[.07] bg-background/60 backdrop-blur-sm">
      <div className="px-4 sm:px-6">
        <div className="flex flex-col gap-1 py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
              <span className="text-sm font-semibold text-white">
                {showStorage ? storageDisplay : '?'}
              </span>
              <span className="whitespace-nowrap text-xs text-muted-foreground/80 font-medium">Storage</span>
            </div>
            <div className="w-px h-4 bg-white/[.07] hidden sm:block" />
            <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
              <span className="text-sm font-semibold text-white">
                {totalGames === 0 ? '?' : <AnimatedCounter value={totalGames} format={formatNumber} />}
              </span>
              <span className="whitespace-nowrap text-xs text-muted-foreground/80 font-medium">Games</span>
            </div>
            <div className="w-px h-4 bg-white/[.07] hidden sm:block" />
            <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
              <span className="text-sm font-semibold text-white">
                {totalDownloads === 0 ? '?' : <AnimatedCounter value={totalDownloads} format={formatNumber} />}
              </span>
              <span className="whitespace-nowrap text-xs text-muted-foreground/80 font-medium">Downloads</span>
            </div>
            <div className="w-px h-4 bg-white/[.07] hidden sm:block" />
            <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
              <span className="text-sm font-semibold text-white">
                {totalRequests === 0 ? '?' : <AnimatedCounter value={totalRequests} format={formatNumber} />}
              </span>
              <span className="whitespace-nowrap text-xs text-muted-foreground/80 font-medium">Requests</span>
            </div>
            <div className="w-px h-4 bg-white/[.07] hidden sm:block" />
            <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
              <span className="text-sm font-semibold text-white">
                <AnimatedCounter value={updatedGamesLast7Days} format={formatNumber} />
              </span>
              <span className="whitespace-nowrap text-xs text-muted-foreground/80 font-medium">Updated (7d)</span>
            </div>
            <div className="w-px h-4 bg-white/[.07] hidden sm:block" />
            <div className="flex shrink-0 items-center gap-2 whitespace-nowrap" title="UC.Direct users online right now">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500" />
              </span>
              <span className="text-sm font-semibold text-sky-300 tabular-nums">
                <AnimatedCounter value={usersOnline} format={formatNumber} />
              </span>
              <span className="text-xs text-muted-foreground/80 font-medium">Now online</span>
            </div>
            <div className="w-px h-4 bg-white/[.07] hidden sm:block" />
            <div className="flex shrink-0 items-center gap-2 whitespace-nowrap" title="People in a running game right now">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="text-sm font-semibold text-emerald-400 tabular-nums">
                <AnimatedCounter value={playersNow} format={formatNumber} />
              </span>
              <span className="text-xs text-muted-foreground/80 font-medium">Now playing</span>
            </div>
            <div className="w-px h-4 bg-white/[.07] hidden sm:block" />
            <div className="flex shrink-0 items-center gap-2 whitespace-nowrap" title="All-time playtime tracked by UC.Direct">
              <span className="text-sm font-semibold text-amber-400">
                {formatPlaytimeCompact(totalPlaytimeSeconds)}
              </span>
              <span className="text-xs text-muted-foreground/80 font-medium">Total playtime</span>
            </div>
            <div className="flex shrink-0 items-center gap-1 whitespace-nowrap" title="These stats are tracked by UC.Direct">
              <span className="text-xs text-muted-foreground/60 font-medium italic">Tracked by</span>
              <span className="text-xs font-semibold text-violet-400">UC.Direct</span>
            </div>
          </div>
          <p className="hidden shrink-0 whitespace-nowrap text-xs text-muted-foreground/60 italic md:block">
            We prefer dangerous freedom over peaceful slavery
          </p>
        </div>
      </div>
    </section>
  )
}

function SectionHeading({
  eyebrow,
  title,
  icon,
  actionLabel,
  onAction,
  className,
}: {
  eyebrow?: string
  title: string
  icon?: React.ReactNode
  actionLabel?: string
  onAction?: () => void
  className?: string
}) {
  return (
    <div className={`mb-6 flex flex-col md:flex-row md:items-end justify-between gap-3 ${className ?? ""}`}>
      <div>
        {eyebrow && <p className="section-label mb-2">{eyebrow}</p>}
        <h2 className="text-2xl font-light tracking-tight text-white flex items-center gap-2">
          {icon}
          {title}
        </h2>
      </div>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:text-white hover:border-zinc-500 transition-all"
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}
