import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { GameCard } from "@/components/GameCard"
import { GameCardCompact } from "@/components/GameCardCompact"
import { GameCardSkeleton } from "@/components/GameCardSkeleton"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { SearchSuggestions } from "@/components/SearchSuggestions"
import { ErrorMessage } from "@/components/ErrorMessage"
import { AnimatedCounter } from "@/components/AnimatedCounter"
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
import { Hammer, SlidersHorizontal, Wifi, EyeOff, ArrowRight, Server } from "lucide-react"

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

  const extractDeveloper = (description: string): string => {
    const developerMatch = description.match(/(?:by|from|developer|dev|studio)\s+([^.,\n]+)/i)
    return developerMatch ? developerMatch[1].trim() : "Unknown"
  }

  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [searchInput, setSearchInput] = useState("")
  const [refreshing, setRefreshing] = useState(false)
  const [gameStats, setGameStats] = useState<Record<string, { downloads: number; views: number }>>({})
  const [refreshKey, setRefreshKey] = useState(0)
  const [gamesError, setGamesError] = useState<{ type: string; message: string; code: string } | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [recentlyInstalledGames, setRecentlyInstalledGames] = useState<Game[]>([])
  const itemsPerPage = 20

  useEffect(() => {
    loadGames()
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
        return
      }

      const response = await fetch(apiUrl("/api/downloads/all"))

      if (!response.ok) {
        throw new Error(`Stats API route failed: ${response.status}`)
      }

      const data = await response.json()
      if (data && typeof data === "object") {
        setGameStats(data)
      }
    } catch (error) {
      console.error("[UC] Error fetching game stats:", error)
    }
  }

  const fetchGames = async (): Promise<Game[]> => {
    try {
      const response = await fetch(apiUrl("/api/games"))

      if (!response.ok) {
        const errorCode = generateErrorCode(ErrorTypes.GAME_FETCH, "launcher")

        setGamesError({
          type: "games",
          message: `Unable to load games (Status: ${response.status}). Please try again or contact support if the issue persists.`,
          code: errorCode,
        })

        throw new Error(`API route failed: ${response.status}`)
      }

      const data = await response.json()
      return data.map((game: any) => ({
        ...game,
        searchText: `${game.name} ${game.description} ${game.genres?.join(" ") || ""}`
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^\w\s]/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
        developer: game.developer && game.developer !== "Unknown" ? game.developer : extractDeveloper(game.description),
      }))
    } catch (error) {
      console.error("Error fetching games:", error)
      setGamesError({
        type: "games",
        message: "Unable to load games. Please try again or contact support if the issue persists.",
        code: generateErrorCode(ErrorTypes.GAME_FETCH, "launcher"),
      })
      return []
    }
  }

  const loadGames = async (forceRefresh = false) => {
    try {
      if (forceRefresh) {
        setRefreshing(true)
      }
      const gamesData = await fetchGames()
      setGames(gamesData)
      if (gamesData.length > 0) {
        fetchGameStats(forceRefresh)
      }
    } catch (error) {
      console.error("Error loading games:", error)
      setGamesError({
        type: "games",
        message: "Unable to load games. Please try again or contact support if the issue persists.",
        code: generateErrorCode(ErrorTypes.GAME_FETCH, "launcher"),
      })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const newReleases = useMemo(() => {
    return games.slice(0, 8)
  }, [games])

  const popularReleases = useMemo(() => {
    const gamesWithDownloads = games.filter((game) => {
      const stats = gameStats[game.appid]
      const isNSFW = Array.isArray(game.genres) && game.genres.some((genre) => genre.toLowerCase() === "nsfw")
      return stats && (stats.downloads > 0 || stats.views > 0) && !isNSFW
    })

    const sorted = gamesWithDownloads.sort((a, b) => {
      const statsA = gameStats[a.appid] || { downloads: 0, views: 0 }
      const statsB = gameStats[b.appid] || { downloads: 0, views: 0 }

      if (statsA.downloads !== statsB.downloads) {
        return statsB.downloads - statsA.downloads
      }

      return statsB.views - statsA.views
    })

    return sorted.slice(0, 8)
  }, [games, gameStats])

  const featuredGames = useMemo(() => {
    return [...games].sort(() => Math.random() - 0.5)
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
      <section className="relative py-32 px-4 text-center">
        <div className="container mx-auto max-w-5xl">
          <div className="flex justify-center mb-8">
            <div className="p-6 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 shadow-lg shadow-primary/10">
              <Hammer className="h-16 w-16 text-primary" />
            </div>
          </div>
          <h1 className="text-5xl md:text-7xl font-black mb-8 text-foreground font-montserrat text-balance leading-tight">
            Free Games for{" "}
            <span className="bg-gradient-to-r from-primary via-purple-400 to-primary bg-clip-text text-transparent">
              Everyone
            </span>
          </h1>
          <p className="text-xl md:text-2xl text-muted-foreground mb-12 max-w-3xl mx-auto leading-relaxed text-pretty">
            Join UnionCrax and fulfill all your gaming needs. No matter who you are, where you're from, or how much
            money you make - we make games accessible to everyone.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              size="lg"
              className="font-semibold text-lg px-8 py-6 rounded-xl bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25"
              onClick={() => document.getElementById("featured")?.scrollIntoView({ behavior: "smooth" })}
            >
              Browse Games
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="font-semibold text-lg px-8 py-6 rounded-xl border-2 bg-transparent"
              onClick={() => window.open("https://union-crax.xyz/discord", "_blank", "noreferrer")}
            >
              Join Discord
            </Button>
          </div>
        </div>
      </section>

      <section className="py-8 px-4 border-y border-border/50">
        <div className="container mx-auto max-w-4xl text-center">
          <div
            className="inline-flex items-center gap-3 px-6 py-3 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-600 hover:bg-amber-500/15 transition-all cursor-pointer group"
            onClick={() => window.open("https://union-crax.xyz/request", "_blank", "noreferrer")}
          >
            <Hammer className="h-5 w-5" />
            <span className="text-base font-semibold">
              Requests are back, but they will be processed slower.
            </span>
            <span className="text-amber-700 font-semibold">Submit a request</span>
            <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
          </div>
        </div>
      </section>

      <section className="py-20 px-4">
        <div className="container mx-auto max-w-6xl">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="group p-8 rounded-2xl bg-gradient-to-br from-card to-card/50 border border-border/50 hover:border-primary/30 transition-all space-y-3">
              <div className="text-5xl font-black bg-gradient-to-br from-primary to-purple-400 bg-clip-text text-transparent font-montserrat">
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

            <div className="group p-8 rounded-2xl bg-gradient-to-br from-card to-card/50 border border-border/50 hover:border-primary/30 transition-all space-y-3">
              <div className="text-5xl font-black bg-gradient-to-br from-primary to-purple-400 bg-clip-text text-transparent font-montserrat">
                {stats.totalGames === 0 ? "?" : <AnimatedCounter value={stats.totalGames} format={formatNumber} />}
              </div>
              <div className="text-foreground/90 font-semibold">Games Available*</div>
              <div className="text-xs text-muted-foreground">
                * Restored {stats.totalGames === 0 ? "0" : stats.totalGames} of 1228 games after the attack
              </div>
            </div>

            <div className="group p-8 rounded-2xl bg-gradient-to-br from-card to-card/50 border border-border/50 hover:border-primary/30 transition-all space-y-3">
              <div className="text-5xl font-black bg-gradient-to-br from-primary to-purple-400 bg-clip-text text-transparent font-montserrat">
                {stats.totalDownloads === 0 ? (
                  "?"
                ) : (
                  <AnimatedCounter value={stats.totalDownloads} format={formatNumber} />
                )}
              </div>
              <div className="text-foreground/90 font-semibold">Total Downloads</div>
            </div>

            <div className="group p-8 rounded-2xl bg-gradient-to-br from-card to-card/50 border border-border/50 hover:border-primary/30 transition-all space-y-3">
              <div className="text-5xl font-black bg-gradient-to-br from-primary to-purple-400 bg-clip-text text-transparent font-montserrat">
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

      <section className="py-10 px-4 border-y border-border/50 bg-card/30">
        <div className="container mx-auto max-w-6xl">
          <div className="flex flex-col gap-4">
            <form onSubmit={handleSearchSubmit} className="relative max-w-3xl mx-auto w-full">
              <SearchSuggestions
                value={searchInput}
                onChange={handleSearchChange}
                onSubmit={handleSearchSubmit}
                placeholder="Search for a game or genre..."
                className="w-full h-14 text-lg rounded-xl"
              />
            </form>

            <div className="flex items-center justify-center gap-3 flex-wrap">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  navigate(`/search?nsfw=1${searchInput ? `&q=${encodeURIComponent(searchInput)}` : ""}`)
                }
                className="px-4 py-2 rounded-full flex items-center gap-2 hover:bg-primary/10 hover:border-primary/50"
              >
                <EyeOff className="h-4 w-4" />
                <span>NSFW</span>
              </Button>

              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  navigate(`/search?online=1${searchInput ? `&q=${encodeURIComponent(searchInput)}` : ""}`)
                }
                className="px-4 py-2 rounded-full flex items-center gap-2 hover:bg-primary/10 hover:border-primary/50"
              >
                <Wifi className="h-4 w-4" />
                <span>Online</span>
              </Button>

              <Button
                variant="outline"
                onClick={() => navigate("/search")}
                className="px-4 py-2 rounded-full border-primary/30 hover:bg-primary/10"
              >
                <SlidersHorizontal className="h-4 w-4 mr-2" />
                Advanced Search
              </Button>
            </div>
          </div>
        </div>
      </section>

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

      {gamesError && (
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
        <section className="py-20 px-4 overflow-visible">
          <div className="container mx-auto max-w-7xl">
            {loading ? (
              <div className="mb-10">
                <Skeleton className="h-10 w-48 mb-3 bg-muted/40" />
                <Skeleton className="h-5 w-80 bg-muted/30" />
              </div>
            ) : (
              <div className="mb-10">
                <h2 className="text-4xl md:text-5xl font-black text-foreground font-montserrat mb-3">Latest Games</h2>
                <p className="text-lg text-muted-foreground">Recently added games to our collection</p>
              </div>
            )}

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
                {loading
                  ? Array.from({ length: 8 }).map((_, index) => (
                      <CarouselItem
                        key={index}
                        className="pl-2 md:pl-4 basis-full sm:basis-1/2 md:basis-1/3 lg:basis-1/3 xl:basis-1/4"
                      >
                        <GameCardSkeleton />
                      </CarouselItem>
                    ))
                  : newReleases.map((game) => (
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
          </div>
        </section>
      )}

      {(loading || popularReleases.length > 0) && (
        <section className="py-20 px-4 bg-card/20 overflow-visible">
          <div className="container mx-auto max-w-7xl">
            {loading ? (
              <div className="mb-10">
                <Skeleton className="h-10 w-48 mb-3 bg-muted/40" />
                <Skeleton className="h-5 w-80 bg-muted/30" />
              </div>
            ) : (
              <div className="mb-10">
                <h2 className="text-4xl md:text-5xl font-black text-foreground font-montserrat mb-3">Most Popular</h2>
                <p className="text-lg text-muted-foreground">Top downloads in our community</p>
              </div>
            )}

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
                {loading
                  ? Array.from({ length: 8 }).map((_, index) => (
                      <CarouselItem
                        key={index}
                        className="pl-2 md:pl-4 basis-full sm:basis-1/2 md:basis-1/3 lg:basis-1/3 xl:basis-1/4"
                      >
                        <GameCardSkeleton />
                      </CarouselItem>
                    ))
                  : popularReleases.map((game) => (
                      <CarouselItem
                        key={game.appid}
                        className="pl-2 md:pl-4 basis-full sm:basis-1/2 md:basis-1/3 lg:basis-1/3 xl:basis-1/4"
                      >
                        <GameCard game={game} stats={gameStats[game.appid]} isPopular />
                      </CarouselItem>
                    ))}
              </CarouselContent>
              <CarouselPrevious />
              <CarouselNext />
            </Carousel>
          </div>
        </section>
      )}

      <section id="featured" className="py-16 px-4">
        <div className="container mx-auto max-w-7xl">
          {loading ? (
            <div className="mb-10">
              <Skeleton className="h-10 w-56 mb-3 bg-muted/40" />
              <Skeleton className="h-5 w-96 bg-muted/30" />
            </div>
          ) : (
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
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {paginatedFeaturedGames.map((game) => {
              const isGamePopular = popularReleases.some((popularGame) => popularGame.appid === game.appid)

              return <GameCard key={game.appid} game={game} stats={gameStats[game.appid]} isPopular={isGamePopular} />
            })}
          </div>

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

          {featuredGames.length === 0 && !loading && (
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
