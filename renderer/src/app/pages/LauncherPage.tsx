import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from "react"
import { useNavigate } from "react-router-dom"
import { GameCard } from "@/components/GameCard"
import { GameCardCompact } from "@/components/GameCardCompact"
import { GameCardSkeleton } from "@/components/GameCardSkeleton"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorMessage } from "@/components/ErrorMessage"
import { AnimatedCounter } from "@/components/AnimatedCounter"
import { OfflineBanner } from "@/components/OfflineBanner"
import { HeroSlider } from "@/components/HeroSlider"
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel"
import { PaginationBar } from "@/components/PaginationBar"
import { apiUrl } from "@/lib/api"
import { formatNumber, generateErrorCode, ErrorTypes } from "@/lib/utils"
import { useOnlineStatus } from "@/hooks/use-online-status"
import { ArrowRight } from "lucide-react"

const extractDeveloper = (description: string): string => {
  const developerMatch = description.match(/(?:by|from|developer|dev|studio)\s+([^.,\n]+)/i)
  return developerMatch ? developerMatch[1].trim() : "Unknown"
}

const normalizeSearchText = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

const shuffleGames = <T,>(items: T[]) => {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
      ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

interface Game {
  appid: string
  name: string
  description: string
  genres: string[]
  image: string
  release_date: string
  size: string
  source: string
  version?: string
  update_time?: string
  searchText?: string
  developer?: string
  hasCoOp?: boolean
}

export function LauncherPage() {
  const navigate = useNavigate()
  const isOnline = useOnlineStatus()

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

  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [gameStats, setGameStats] = useState<Record<string, { downloads: number; views: number }>>({})
  const [refreshKey, setRefreshKey] = useState(0)
  const [gamesError, setGamesError] = useState<{ type: string; message: string; code: string } | null>(null)
  const [hasLoadedGames, setHasLoadedGames] = useState(false)
  const [emptyStateReady, setEmptyStateReady] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [recentlyInstalledGames, setRecentlyInstalledGames] = useState<Game[]>([])
  const itemsPerPage = 20
  const [statsCacheTime, setStatsCacheTime] = useState<number>(0)

  const activeLoadIdRef = useRef(0)

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
      try {
        if (typeof window !== "undefined") {
          const installedList =
            ((await window.ucDownloads?.listInstalledGlobal?.()) as any[]) ||
            ((await window.ucDownloads?.listInstalled?.()) as any[]) ||
            []

          for (const entry of installedList) {
            const meta = (entry && (entry.metadata || entry.game)) || entry
            if (meta && meta.appid) {
              // Use remote image only; localImage is a file path that can't be used in web context
              installedMap.set(meta.appid, {
                ...meta,
                name: meta.name || meta.appid,
                image: meta.image || "./banner.png",
                genres: Array.isArray(meta.genres) ? meta.genres : [],
              })
            }
          }
        }
      } catch {
        // ignore installed lookup failures
      }

      const installedGames = Array.from(installedMap.values())
      // prefer most recently added if available
      installedGames.sort((a: any, b: any) => (b.addedAt || 0) - (a.addedAt || 0))
      const resolved = installedGames.slice(0, 10)

      if (!ignore) {
        setRecentlyInstalledGames(resolved)
      }
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

  const fetchGameStats = async (forceRefresh = false) => {
    try {
      if (!forceRefresh && Object.keys(gameStats).length > 0) {
        const now = Date.now()
        const recentCache = now - statsCacheTime < 30000
        if (recentCache) return
      }

      const response = await fetch(apiUrl("/api/downloads/all"))

      if (!response.ok) {
        throw new Error(`Stats API route failed: ${response.status}`)
      }

      const data = await response.json()
      if (data && typeof data === "object") {
        startTransition(() => {
          setGameStats(data)
          setStatsCacheTime(Date.now())
        })
      }
    } catch (error) {
      console.error("[UC] Error fetching game stats:", error)
    }
  }

  const fetchGames = async (): Promise<Game[]> => {
    // Check offline before attempting fetch
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      // Don't set an error - we'll show the offline banner instead
      return []
    }

    const response = await fetch(apiUrl("/api/games"))

    if (!response.ok) {
      throw new GamesFetchError(`API route failed: ${response.status}`, response.status)
    }

    const data = await response.json()
    return data.map((game: any) => ({
      ...game,
      searchText: normalizeSearchText(`${game.name} ${game.description} ${game.genres?.join(" ") || ""}`),
      developer: game.developer && game.developer !== "Unknown" ? game.developer : extractDeveloper(game.description),
    }))
  }

  const loadGames = async (forceRefresh = false) => {
    const loadId = ++activeLoadIdRef.current
    const isInitialLoad = !hasLoadedGames && games.length === 0
    const maxAttempts = isInitialLoad ? 12 : 2

    // While the DB/API is warming up, keep the skeleton visible rather than flashing empty/error states.
    let refreshStart: number | null = null
    if (isInitialLoad) setLoading(true)
    if (forceRefresh) {
      setRefreshing(true)
      refreshStart = Date.now()
    }
    setGamesError(null)

    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      try {
        const gamesData = await fetchGames()
        if (loadId !== activeLoadIdRef.current) return

        startTransition(() => {
          setGames(gamesData)
          setHasLoadedGames(true)
        })

        if (gamesData.length > 0) {
          fetchGameStats(forceRefresh)
        }

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
    return refreshKey > 0 ? shuffleGames(games) : games
  }, [games, refreshKey])

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
    <div className="space-y-10 pb-4">
      {/* Full-width hero slider */}
      <HeroSlider games={games} gameStats={gameStats} loading={loading} />

      {/* Stats row */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 anim anim-d1">
        <div className="rounded-2xl border border-white/[.07] bg-zinc-900/60 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Catalogue</div>
          <div className="mt-2 text-2xl font-bold text-white">
            {stats.totalGames === 0 ? (
              <span className="text-zinc-600">—</span>
            ) : (
              <AnimatedCounter value={stats.totalGames} format={formatNumber} />
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-white/[.07] bg-zinc-900/60 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Downloads</div>
          <div className="mt-2 text-2xl font-bold text-white">
            {stats.totalDownloads === 0 ? (
              <span className="text-zinc-600">—</span>
            ) : (
              <AnimatedCounter value={stats.totalDownloads} format={formatNumber} />
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-white/[.07] bg-zinc-900/60 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Storage</div>
          <div className="mt-2 text-2xl font-bold text-white">
            {displayTotalSizeGB >= 1024 ? (
              <AnimatedCounter value={displayTotalSizeTB} suffix="TB" />
            ) : displayTotalSizeGB > 0 ? (
              <AnimatedCounter value={displayTotalSizeGB} suffix="GB" />
            ) : (
              <span className="text-zinc-600">—</span>
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-white/[.07] bg-zinc-900/60 p-4 flex flex-col justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Quick access</div>
          <div className="mt-3 flex flex-col gap-1.5">
            <Button
              size="sm"
              className="w-full rounded-full bg-white text-[12px] font-semibold text-black hover:bg-zinc-200 active:scale-95"
              onClick={() => navigate("/library")}
            >
              My Library
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="w-full rounded-full text-[12px] text-zinc-400 hover:bg-white/[.04] hover:text-white active:scale-95"
              onClick={() => typeof window !== "undefined" && window.dispatchEvent(new Event("uc_open_search_popup"))}
            >
              Search
            </Button>
          </div>
        </div>
      </section>

      {recentlyInstalledGames.length > 0 && (
        <section className="py-12 sm:py-16 md:py-20 px-4">
          <div className="container mx-auto max-w-7xl">
            <div className="mb-10">
              <p className="section-label mb-2">Your Games</p>
              <h2 className="text-2xl font-light tracking-tight text-white">
                Recently Installed
              </h2>
            </div>

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
                    <div className="h-full rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/60 p-4 flex flex-col items-center justify-center text-center transition hover:border-zinc-500 active:scale-[.98]">
                      <div className="text-sm font-semibold text-zinc-200">View all</div>
                      <div className="mt-2 text-zinc-400 group-hover:text-white"><ArrowRight className="h-4 w-4" /></div>
                    </div>
                  </button>
                </CarouselItem>
              </CarouselContent>
              <CarouselPrevious />
              <CarouselNext />
            </Carousel>
          </div>
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

      {gamesError && isOnline && !loading && (
        <section className="py-6 px-4">
          <div className="container mx-auto max-w-4xl">
            <div className="mb-6">
              <ErrorMessage
                title="Games Loading Issue"
                message={gamesError.message}
                errorCode={gamesError.code}
                retry={() => {
                  setGamesError(null)
                  setLoading(true)
                  loadGames(true)
                }}
              />
            </div>
          </div>
        </section>
      )}

      {(loading || newReleases.length > 0) && (
        <section className="py-12 sm:py-16 md:py-20 px-4 overflow-visible">
          <div className="container mx-auto max-w-7xl">
            {loading ? (
              <>
                <div className="mb-10">
                  <Skeleton className="h-10 w-48 mb-3" />
                  <Skeleton className="h-5 w-80" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <GameCardSkeleton key={`skeleton-latest-${index}`} />
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="mb-10">
                  <p className="section-label mb-2">New</p>
                  <h2 className="text-2xl font-light tracking-tight text-white">Latest Games</h2>
                </div>
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
                        <GameCard game={game} stats={gameStats[game.appid]} />
                      </CarouselItem>
                    ))}
                  </CarouselContent>
                  <CarouselPrevious />
                  <CarouselNext />
                </Carousel>
              </>
            )}
          </div>
        </section>
      )}

      {(loading || popularReleases.length > 0) && (
        <section className="relative py-16 sm:py-20 md:py-24 px-4 overflow-hidden">
          <div className="container relative z-10 mx-auto max-w-7xl">
            {loading ? (
              <div className="mb-12">
                <Skeleton className="h-12 w-64 mb-4" />
                <Skeleton className="h-6 w-96" />
              </div>
            ) : (
              <div className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                  <p className="section-label mb-2">Trending</p>
                  <h2 className="text-2xl font-light tracking-tight text-white">
                    Most Popular
                  </h2>
                </div>
              </div>
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
                <CarouselContent className="-ml-2 md:-ml-4 pb-10">
                  {popularReleases.map((game) => (
                    <CarouselItem
                      key={game.appid}
                      className="pl-2 md:pl-4 basis-full sm:basis-1/2 md:basis-1/3 lg:basis-1/3 xl:basis-1/4"
                    >
                      <GameCard game={game} stats={gameStats[game.appid]} isPopular />
                    </CarouselItem>
                  ))}
                </CarouselContent>
                <CarouselPrevious className="left-0 -translate-x-1/2 bg-black/50 hover:bg-black/80 border-white/10 text-white backdrop-blur-md" />
                <CarouselNext className="right-0 translate-x-1/2 bg-black/50 hover:bg-black/80 border-white/10 text-white backdrop-blur-md" />
              </Carousel>
            )}
          </div>
        </section>
      )}

      <section id="featured" className="py-16 px-4">
        <div className="container mx-auto max-w-7xl">
          {loading ? (
            <>
              <div className="mb-10">
                <Skeleton className="h-10 w-56 mb-3 bg-muted/40" />
                <Skeleton className="h-5 w-96 bg-muted/30" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                {Array.from({ length: 20 }).map((_, i) => (
                  <GameCardSkeleton key={`skeleton-all-${i}`} />
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="mb-10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <p className="section-label mb-2">Library</p>
                  <h2 className="text-2xl font-light tracking-tight text-white">All Games</h2>
                </div>
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

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 stagger-grid">
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

          {featuredGames.length === 0 && hasLoadedGames && emptyStateReady && !loading && isOnline && (
            <div className="text-center py-20">
              <div className="max-w-xl mx-auto">
                <ErrorMessage
                  title={gamesError ? "Games Loading Issue" : "No Games Available"}
                  message={
                    gamesError
                      ? gamesError.message
                      : "We couldn't find any games at the moment. Please try again later or contact support if the issue persists."
                  }
                  errorCode={gamesError ? gamesError.code : generateErrorCode(ErrorTypes.GAME_FETCH, "launcher-empty")}
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
    </div>
  )
}
