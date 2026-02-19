import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState, startTransition } from "react"
import { useNavigate } from "react-router-dom"
import { GameCard } from "@/components/GameCard"
import { GameCardCompact } from "@/components/GameCardCompact"
import { GameCardSkeleton } from "@/components/GameCardSkeleton"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { SearchSuggestions } from "@/components/SearchSuggestions"
import { ErrorMessage } from "@/components/ErrorMessage"
import { AnimatedCounter } from "@/components/AnimatedCounter"
import { OfflineBanner } from "@/components/OfflineBanner"
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { apiUrl } from "@/lib/api"
import { formatNumber, generateErrorCode, ErrorTypes } from "@/lib/utils"
import { useOnlineStatus } from "@/hooks/use-online-status"
import { Hammer, SlidersHorizontal, Wifi, EyeOff, ArrowRight, Server, Search } from "lucide-react"

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
    return status === 429 || status === 500 || status === 502 || status === 503 || status === 504
  }

  const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [searchInput, setSearchInput] = useState("")
  const [refreshing, setRefreshing] = useState(false)
  const [gameStats, setGameStats] = useState<Record<string, { downloads: number; views: number }>>({})
  const [refreshKey, setRefreshKey] = useState(0)
  const [gamesError, setGamesError] = useState<{ type: string; message: string; code: string } | null>(null)
  const [hasLoadedGames, setHasLoadedGames] = useState(false)
  const [emptyStateReady, setEmptyStateReady] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [recentlyInstalledGames, setRecentlyInstalledGames] = useState<Game[]>([])
  const [shortcutLabel, setShortcutLabel] = useState("Ctrl+K")
  const itemsPerPage = 20
  const [statsCacheTime, setStatsCacheTime] = useState<number>(0)

  const activeLoadIdRef = useRef(0)

  useEffect(() => {
    if (typeof navigator === "undefined") return
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform)
    setShortcutLabel(isMac ? "Cmd+K" : "Ctrl+K")
  }, [])

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
                image: meta.image || "/banner.png",
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
      // Don't set an error — we'll show the offline banner instead
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

  const handleSearchSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault()
      if (searchInput.trim()) {
        navigate(`/search?q=${encodeURIComponent(searchInput.trim())}`)
      }
    },
    [searchInput, navigate]
  )

  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value)
  }, [])

  return (
    <div className="min-h-screen bg-background">
      <section id="hero" className="relative py-20 sm:py-24 md:py-32 px-4 text-center">
        <div className="container mx-auto max-w-5xl">
          <div className="flex justify-center mb-8">
            <div className="p-4 sm:p-6 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 shadow-lg shadow-primary/10">
              <Hammer className="h-12 w-12 sm:h-16 sm:w-16 text-primary" />
            </div>
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-7xl font-black mb-6 sm:mb-8 text-foreground font-montserrat text-balance leading-tight">
            Free Games for{" "}
            <span className="bg-gradient-to-r from-primary via-purple-400 to-primary bg-clip-text text-transparent">
              Everyone
            </span>
          </h1>
          <p className="text-base sm:text-xl md:text-2xl text-muted-foreground mb-8 sm:mb-12 max-w-3xl mx-auto leading-relaxed text-pretty">
            Join UnionCrax and fulfill all your gaming needs. No matter who you are, where you're from, or how much
            money you make - we make games accessible to everyone.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              size="lg"
              className="font-semibold text-base sm:text-lg px-6 sm:px-8 py-5 sm:py-6 rounded-xl bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25"
              onClick={() => document.getElementById("featured")?.scrollIntoView({ behavior: "smooth" })}
            >
              Browse Games
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="font-semibold text-base sm:text-lg px-6 sm:px-8 py-5 sm:py-6 rounded-xl border-2 bg-transparent"
              onClick={() => window.open("https://union-crax.xyz/discord", "_blank", "noreferrer")}
            >
              Join Discord
            </Button>
          </div>
        </div>
      </section>

      {/* Announcement Banner */}
      <section className="py-8 px-4 border-y border-border/50">
        <div className="container mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center gap-3 px-6 py-3 rounded-full bg-gradient-to-r from-orange-400/15 via-orange-300/15 to-orange-200/15 border border-orange-200/30 shadow-sm">
            <Hammer className="h-5 w-5 text-orange-500" />
            <span className="text-base font-semibold text-foreground/90">
              UnionCrax.Direct is currently in beta —{" "}
              <a
                href="https://github.com/Union-Crax/UnionCrax.Direct/issues"
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-orange-500 underline underline-offset-4 decoration-orange-300/30 hover:decoration-orange-500/60"
              >
                Report issues on GitHub
              </a>
              .
            </span>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-12 sm:py-16 md:py-20 px-4">
        <div className="container mx-auto max-w-6xl">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="group p-5 sm:p-8 rounded-2xl bg-gradient-to-br from-card to-card/50 border border-border/50 hover:border-primary/30 transition-all space-y-3">
              <div className="text-3xl sm:text-4xl md:text-5xl font-black bg-gradient-to-br from-primary to-purple-400 bg-clip-text text-transparent font-montserrat">
                {displayTotalSizeGB >= 1024 ? (
                  <AnimatedCounter value={displayTotalSizeTB} suffix="TB" />
                ) : displayTotalSizeGB && displayTotalSizeGB > 0 ? (
                  <AnimatedCounter value={displayTotalSizeGB} suffix="GB" />
                ) : (
                  "?"
                )}
              </div>
              <div className="text-foreground/90 font-semibold">Total Storage*</div>
              <div className="text-xs text-muted-foreground leading-relaxed">
                * Actual bandwidth used is around{" "}
                {(() => {
                  const bandwidthGB = displayTotalSizeGB * 3
                  const bandwidthTB = Math.round((bandwidthGB / 1024) * 10) / 10
                  return bandwidthGB >= 1024
                    ? `${bandwidthTB}TB`
                    : `${Math.round(bandwidthGB * 10) / 10}GB`
                })()} as we upload to multiple hosts
              </div>
            </div>

            <div className="group p-5 sm:p-8 rounded-2xl bg-gradient-to-br from-card to-card/50 border border-border/50 hover:border-primary/30 transition-all space-y-3">
              <div className="text-3xl sm:text-4xl md:text-5xl font-black bg-gradient-to-br from-primary to-purple-400 bg-clip-text text-transparent font-montserrat">
                {stats.totalGames === 0 ? "?" : <AnimatedCounter value={stats.totalGames} format={formatNumber} />}
              </div>
              <div className="text-foreground/90 font-semibold">Games Available*</div>
              <div className="text-xs text-muted-foreground">
                * Restored {stats.totalGames === 0 ? "0" : stats.totalGames} of 1228 games after the attack
              </div>
            </div>

            <div className="group p-5 sm:p-8 rounded-2xl bg-gradient-to-br from-card to-card/50 border border-border/50 hover:border-primary/30 transition-all space-y-3">
              <div className="text-3xl sm:text-4xl md:text-5xl font-black bg-gradient-to-br from-primary to-purple-400 bg-clip-text text-transparent font-montserrat">
                {stats.totalDownloads === 0 ? (
                  "?"
                ) : (
                  <AnimatedCounter value={stats.totalDownloads} format={formatNumber} />
                )}
              </div>
              <div className="text-foreground/90 font-semibold">Total Downloads</div>
            </div>

            <div className="group p-5 sm:p-8 rounded-2xl bg-gradient-to-br from-card to-card/50 border border-border/50 hover:border-primary/30 transition-all space-y-3">
              <div className="text-3xl sm:text-4xl md:text-5xl font-black bg-gradient-to-br from-primary to-purple-400 bg-clip-text text-transparent font-montserrat">
                {stats.totalGames === 0 ? "0%" : <AnimatedCounter value={100} suffix="%" />}
              </div>
              <div className="text-foreground/90 font-semibold">Free Forever</div>
            </div>
          </div>
          <div className="text-center mt-8">
            <p className="text-sm text-muted-foreground italic">We prefer dangerous freedom over peaceful slavery</p>
          </div>
        </div>
      </section>

      {/* Search Bar (clickable - opens global search popup) */}
      <div id="home-search" className="py-8 px-4 border-y border-border/50 bg-card/30">
        <div className="container mx-auto max-w-3xl">
          <div
            role="button"
            tabIndex={0}
            onClick={() => typeof window !== "undefined" && window.dispatchEvent(new Event("uc_open_search_popup"))}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                window.dispatchEvent(new Event("uc_open_search_popup"))
              }
            }}
            className="w-full px-4 py-3 text-base rounded-xl border-2 cursor-pointer text-muted-foreground flex items-center gap-3 transition-colors hover:border-primary/50 border-input"
          >
            <Search className="h-5 w-5 flex-shrink-0" aria-hidden />
            <span>Click to search ({shortcutLabel})</span>
          </div>
        </div>
      </div>

      {recentlyInstalledGames.length > 0 && (
        <section className="py-12 sm:py-16 md:py-20 px-4">
          <div className="container mx-auto max-w-7xl">
            <div className="mb-10">
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-black text-foreground font-montserrat mb-3">
                Recently Installed
              </h2>
              <p className="text-base sm:text-lg text-muted-foreground">
                Games you installed on this device
              </p>
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
                    <div className="h-full rounded-2xl border border-dashed border-border/60 bg-card/60 p-4 flex flex-col items-center justify-center text-center transition hover:border-primary/50">
                      <div className="text-sm font-semibold text-foreground">Manage installs</div>
                      <div className="text-xs text-muted-foreground mt-1">Open your library</div>
                      <div className="mt-3 text-xs text-primary group-hover:underline">/library</div>
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
                  <Skeleton className="h-10 w-48 mb-3 bg-muted/40" />
                  <Skeleton className="h-5 w-80 bg-muted/30" />
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
                  <h2 className="text-3xl sm:text-4xl md:text-5xl font-black text-foreground font-montserrat mb-3">Latest Games</h2>
                  <p className="text-base sm:text-lg text-muted-foreground">Recently added games to our collection</p>
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
          <div className="absolute inset-0 bg-gradient-to-b from-primary/10 via-background/50 to-background pointer-events-none -z-10" />
          <div className="container relative z-10 mx-auto max-w-7xl">
            {loading ? (
              <div className="mb-12">
                <Skeleton className="h-12 w-64 mb-4 bg-muted/20" />
                <Skeleton className="h-6 w-96 bg-muted/10" />
              </div>
            ) : (
              <div className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                  <h2 className="text-4xl sm:text-5xl md:text-6xl font-black bg-gradient-to-r from-white to-white/50 bg-clip-text text-transparent font-montserrat mb-3 tracking-tight">
                    Most Popular
                  </h2>
                  <p className="text-lg sm:text-xl text-muted-foreground font-medium">Top trending downloads in our community</p>
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
                  <h2 className="text-4xl md:text-5xl font-black text-foreground font-montserrat mb-3">All Games</h2>
                  <p className="text-lg text-muted-foreground">Browse our complete collection</p>
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

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
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

          {totalPages > 1 && (
            <div className="mt-8">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                      className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>

                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNumber
                    if (totalPages <= 5) {
                      pageNumber = i + 1
                    } else if (currentPage <= 3) {
                      pageNumber = i + 1
                    } else if (currentPage >= totalPages - 2) {
                      pageNumber = totalPages - 4 + i
                    } else {
                      pageNumber = currentPage - 2 + i
                    }

                    return (
                      <PaginationItem key={pageNumber}>
                        <PaginationLink
                          onClick={() => setCurrentPage(pageNumber)}
                          isActive={currentPage === pageNumber}
                          className="cursor-pointer"
                        >
                          {pageNumber}
                        </PaginationLink>
                      </PaginationItem>
                    )
                  })}

                  <PaginationItem>
                    <PaginationNext
                      onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                      className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}

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
