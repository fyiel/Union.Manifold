import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { GameCard } from "@/components/GameCard"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { PaginationBar } from "@/components/PaginationBar"
import { Filter, Wifi, X, SlidersHorizontal, RefreshCw, Heart, Star, ChevronRight, Search } from "lucide-react"
import { useDebounce } from "@/hooks/use-debounce"
import { parseSize } from "@/lib/search-utils"
import { getInstalledVersionLabel, hasInstalledVersionUpdate, hasOnlineMode, generateErrorCode, ErrorTypes, proxyImageUrl } from "@/lib/utils"
import { cn } from "@/lib/utils"
import { addSearchToHistory } from "@/lib/user-history"
import { APIErrorBoundary } from "@/components/error-boundary"
import { GamesGridSkeleton } from "@/components/api-fallback"
import { LoadingAnimated } from "@/components/brand/brand-assets"
import { CriticalLoadModal } from "@/components/CriticalLoadModal"
import { OfflineBanner } from "@/components/OfflineBanner"
import { apiFetch } from "@/lib/api"
import { useConnectivityStatus } from "@/hooks/use-online-status"

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
  addedOrder?: number
}

interface Filters {
  searchTerm: string
  genres: string[]
  developers: string[]
  sizeRange: [number, number]
  sortBy: string
  online?: boolean
  nsfwOnly?: boolean
}

const DEFAULT_FILTERS: Filters = {
  searchTerm: "",
  genres: [],
  developers: [],
  sizeRange: [0, 500],
  sortBy: "random",
  online: false,
  nsfwOnly: false,
}

export function SearchPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [isFiltersOpen, setIsFiltersOpen] = useState(false)
  const [developerQuery, setDeveloperQuery] = useState("")
  const { isOnline, browserOnline, serviceReachable } = useConnectivityStatus()
  const hasCriticalServiceInterruption = browserOnline && !serviceReachable

  const normalizeSort = useCallback((value: string | null) => {
    const allowed = new Set([
      "random",
      "added",
      "name",
      "date",
      "updated",
      "size",
      "downloads-desc",
      "downloads-asc",
      "views-desc",
      "views-asc",
    ])
    return value && allowed.has(value) ? value : "random"
  }, [])

  const extractDeveloper = (description: string): string => {
    const developerMatch = description.match(/(?:by|from|developer|dev|studio)\s+([^.,\n]+)/i)
    return developerMatch ? developerMatch[1].trim() : "Unknown"
  }

  const initialFilters: Filters = useMemo(() => ({
    ...DEFAULT_FILTERS,
    searchTerm: searchParams.get("q") || "",
    sortBy: normalizeSort(searchParams.get("sort")),
    online: searchParams.get("online") === "1",
    nsfwOnly: searchParams.get("nsfw") === "1",
  }), [])

  const [filters, setFilters] = useState<Filters>(initialFilters)
  const [searchInput, setSearchInput] = useState<string>(initialFilters.searchTerm)
  const debouncedSearchInput = useDebounce(searchInput, 400)

  useEffect(() => {
    setFilters((prev) => prev.searchTerm === debouncedSearchInput ? prev : { ...prev, searchTerm: debouncedSearchInput })
    setIsSearching(false)
  }, [debouncedSearchInput])

  const [games, setGames] = useState<Game[]>([])
  const [totalGames, setTotalGames] = useState(0)
  const [meta, setMeta] = useState<{ genres: string[]; developers: string[] }>({ genres: [], developers: [] })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filtering, setFiltering] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [gameStats, setGameStats] = useState<Record<string, { downloads: number; views: number }>>({})
  const [gamesError, setGamesError] = useState<{ type: string; message: string; code: string } | null>(null)
  const [_statsError, setStatsError] = useState<{ type: string; message: string; code: string } | null>(null)
  const [criticalLoadOpen, setCriticalLoadOpen] = useState(false)
  const [didYouMeanResults, setDidYouMeanResults] = useState<any[]>([])
  const [installedVersionMap, setInstalledVersionMap] = useState<Record<string, string[]>>({})

  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 20
  const isInitialMount = useRef(true)

  const syncFiltersToUrl = useCallback((f: Filters) => {
    const params = new URLSearchParams()
    if (f.searchTerm) params.set("q", f.searchTerm)
    if (f.sortBy && f.sortBy !== "random") params.set("sort", f.sortBy)
    if (f.online) params.set("online", "1")
    if (f.nsfwOnly) params.set("nsfw", "1")
    setSearchParams(params, { replace: true })
  }, [setSearchParams])

  const updateFilter = useCallback(<K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value }
      syncFiltersToUrl(next)
      return next
    })
  }, [syncFiltersToUrl])

  const toggleGenre = useCallback((genre: string) => {
    setFilters((prev) => {
      const genres = prev.genres.includes(genre) ? prev.genres.filter((g) => g !== genre) : [...prev.genres, genre]
      const next = { ...prev, genres }
      syncFiltersToUrl(next)
      return next
    })
  }, [syncFiltersToUrl])

  const toggleDeveloper = useCallback((developer: string) => {
    setFilters((prev) => {
      const developers = prev.developers.includes(developer)
        ? prev.developers.filter((d) => d !== developer)
        : [...prev.developers, developer]
      const next = { ...prev, developers }
      syncFiltersToUrl(next)
      return next
    })
  }, [syncFiltersToUrl])

  useEffect(() => {
    loadGames()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, currentPage])

  useEffect(() => {
    if (!isInitialMount.current) {
      // scroll to top of main scroll container if any; safe no-op otherwise
      try { window.scrollTo({ top: 0, behavior: "smooth" }) } catch {}
    }
  }, [currentPage])

  useEffect(() => {
    setCurrentPage(1)
  }, [filters])

  useEffect(() => {
    fetchMeta()
    isInitialMount.current = false
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadInstalledVersions = async () => {
      try {
        const installedList =
          ((await window.ucDownloads?.listInstalledGlobal?.()) as any[]) ||
          ((await window.ucDownloads?.listInstalled?.()) as any[]) ||
          []

        if (cancelled) return

        const nextVersions: Record<string, string[]> = {}
        for (const entry of installedList) {
          const meta = (entry && (entry.metadata || entry.game)) || entry
          if (!meta?.appid) continue
          const versionLabel = getInstalledVersionLabel(entry)
          if (!versionLabel) continue
          nextVersions[meta.appid] = Array.from(new Set([...(nextVersions[meta.appid] || []), versionLabel]))
        }

        setInstalledVersionMap(nextVersions)
      } catch {
        if (!cancelled) setInstalledVersionMap({})
      }
    }

    const handleRefresh = () => {
      void loadInstalledVersions()
    }

    void loadInstalledVersions()
    window.addEventListener("focus", handleRefresh)
    window.addEventListener("uc_game_installed", handleRefresh)
    return () => {
      cancelled = true
      window.removeEventListener("focus", handleRefresh)
      window.removeEventListener("uc_game_installed", handleRefresh)
    }
  }, [])

  useEffect(() => {
    const q = filters.searchTerm.trim()
    if (!loading && q.length >= 2 && games.length === 0) {
      apiFetch(`/api/games/suggestions?q=${encodeURIComponent(q)}&limit=8&nsfw=true`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data) setDidYouMeanResults(Array.isArray(data.didYouMean) ? data.didYouMean : [])
        })
        .catch(() => {})
    } else {
      setDidYouMeanResults([])
    }
  }, [loading, games, filters.searchTerm])

  useEffect(() => {
    setCriticalLoadOpen(Boolean(gamesError) && hasCriticalServiceInterruption)
  }, [gamesError, hasCriticalServiceInterruption])

  const fetchMeta = async () => {
    try {
      const res = await apiFetch("/api/meta")
      if (res.ok) {
        setMeta(await res.json())
      }
    } catch (e) {
      console.error(e)
    }
  }

  const fetchGames = async (): Promise<{ items: Game[]; total: number }> => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return { items: [], total: 0 }
    }

    try {
      const params = new URLSearchParams()
      if (filters.searchTerm) params.set("q", filters.searchTerm)
      filters.genres.forEach((g) => params.append("genres", g))
      filters.developers.forEach((d) => params.append("developers", d))
      if (filters.online) params.set("online", "true")

      if (filters.nsfwOnly) {
        params.set("nsfwOnly", "true")
      } else {
        params.set("nsfw", "false")
      }

      if (filters.sortBy) params.set("sort", filters.sortBy)

      params.set("page", currentPage.toString())
      params.set("limit", itemsPerPage.toString())

      const response = await apiFetch(`/api/games?${params.toString()}`)

      if (!response.ok) {
        throw new Error(`API route failed: ${response.status}`)
      }

      const total = Number(response.headers.get("X-Total-Count") || 0)

      const data = await response.json()
      const items = data.map((game: any, index: number) => ({
        ...game,
        developer: game.developer && game.developer !== "Unknown" ? game.developer : extractDeveloper(game.description),
        addedOrder: index + (currentPage - 1) * itemsPerPage,
      }))

      return { items, total }
    } catch (error) {
      console.error("Error fetching games:", error)
      setGamesError({
        type: "games",
        message: "Unable to load games. Please try again or contact support if the issue persists.",
        code: generateErrorCode(ErrorTypes.SEARCH_FETCH, "search-page"),
      })
      return { items: [], total: 0 }
    }
  }

  const loadGames = async () => {
    setLoading(true)
    try {
      setGamesError(null)
      const { items, total } = await fetchGames()
      setGames(items)
      setTotalGames(total)

      if (items.length > 0) {
        fetchGameStats()
      }
    } catch (error) {
      console.error("Error loading games:", error)
      setGamesError({
        type: "games",
        message: "Unable to load games. Please try again or contact support if the issue persists.",
        code: generateErrorCode(ErrorTypes.SEARCH_FETCH, "search-page"),
      })
    } finally {
      setLoading(false)
    }
  }

  const fetchGameStats = async () => {
    try {
      setStatsError(null)
      const response = await apiFetch("/api/downloads/all")

      if (!response.ok) {
        const errorCode = generateErrorCode(ErrorTypes.STATS_FETCH, "search-page")
        setStatsError({
          type: "stats",
          message: `Unable to load game statistics (Status: ${response.status}). The games are still available.`,
          code: errorCode,
        })
        throw new Error(`Stats API route failed: ${response.status}`)
      }

      const data = await response.json()
      if (data && typeof data === "object") {
        setGameStats(data)
      }
    } catch (error) {
      console.error("[UC] Error fetching game stats:", error)
      setStatsError({
        type: "stats",
        message: "Unable to load game statistics. The games are still available.",
        code: generateErrorCode(ErrorTypes.STATS_FETCH, "search-page"),
      })
    }
  }

  const refreshGames = async () => {
    if (!filtering) setRefreshing(true)
    try {
      const { items, total } = await fetchGames()
      setGames(items)
      setTotalGames(total)
    } catch (error) {
      console.error("Error refreshing games:", error)
    } finally {
      if (!filtering) setRefreshing(false)
    }
  }

  const isValidDeveloperName = (developer: string | undefined): boolean => {
    if (!developer || developer === "Unknown" || developer.trim() === "") return false
    const trimmed = developer.trim()
    if (trimmed.length < 2 || trimmed.length > 50) return false

    const descriptionPatterns = [
      /\b(this|the|game|is|was|has|with|for|from|by|on|in|at|and|but|or|yet|so|because|although|while|if|then|when|where|why|how)\b/i,
      /\.{2,}/,
      /.{80,}/,
      /^[A-Z][^.!?]*[.!?]$/,
      /\n/,
      /<[^>]*>/,
      /http[s]?:\/\//,
      /\b(description|about|story|plot|features?|overview|summary)\b/i,
    ]
    if (descriptionPatterns.some((pattern) => pattern.test(trimmed))) return false

    const validNamePattern = /^[\w\s\-\.,'&()]+$/u
    if (!validNamePattern.test(trimmed)) return false

    const words = trimmed.split(/\s+/)
    if (words.length > 6) return false
    if (trimmed.includes(" is ") || trimmed.includes(" was ") || trimmed.includes(" has ")) return false

    return true
  }

  const filterOptions = useMemo(() => {
    return {
      allGenres: meta.genres.filter((genre) => String(genre).toLowerCase() !== "nsfw"),
      allDevelopers: meta.developers.filter((developer) => isValidDeveloperName(developer)),
    }
  }, [meta])

  const filteredGames = useMemo(() => {
    let filtered = games

    if (filters.sizeRange[0] > 0 || filters.sizeRange[1] < 500) {
      const minSizeBytes = filters.sizeRange[0] * 1024 * 1024 * 1024
      const maxSizeBytes = filters.sizeRange[1] * 1024 * 1024 * 1024
      filtered = filtered.filter((game) => {
        const gameSize = parseSize(game.size)
        return gameSize > 0 && gameSize >= minSizeBytes && gameSize <= maxSizeBytes
      })
    }

    if (filters.online) {
      filtered = filtered.filter((game) => hasOnlineMode(game.hasCoOp))
    }

    if (filters.sortBy !== "random") {
      filtered.sort((a, b) => {
        switch (filters.sortBy) {
          case "added":
            return (a.addedOrder ?? 0) - (b.addedOrder ?? 0) || a.name.localeCompare(b.name)
          case "date":
            return new Date(b.release_date).getTime() - new Date(a.release_date).getTime() || a.name.localeCompare(b.name)
          case "updated": {
            const aTime = a.update_time ? new Date(a.update_time).getTime() : 0
            const bTime = b.update_time ? new Date(b.update_time).getTime() : 0
            return bTime - aTime || a.name.localeCompare(b.name)
          }
          case "size":
            return parseSize(b.size) - parseSize(a.size) || a.name.localeCompare(b.name)
          case "downloads-desc": {
            const downloadsA = gameStats[a.appid]?.downloads || 0
            const downloadsB = gameStats[b.appid]?.downloads || 0
            return downloadsB - downloadsA || a.name.localeCompare(b.name)
          }
          case "downloads-asc": {
            const downloadsAscA = gameStats[a.appid]?.downloads || 0
            const downloadsAscB = gameStats[b.appid]?.downloads || 0
            return downloadsAscA - downloadsAscB || b.name.localeCompare(a.name)
          }
          case "views-desc": {
            const viewsA = gameStats[a.appid]?.views || 0
            const viewsB = gameStats[b.appid]?.views || 0
            return viewsB - viewsA || a.name.localeCompare(b.name)
          }
          case "views-asc": {
            const viewsAscA = gameStats[a.appid]?.views || 0
            const viewsAscB = gameStats[b.appid]?.views || 0
            return viewsAscA - viewsAscB || b.name.localeCompare(a.name)
          }
          default:
            return a.name.localeCompare(b.name)
        }
      })
    }

    if (filters.sortBy === "random") {
      const shuffled = [...filtered]
      const seed = Date.now()
      let random = seed
      for (let i = shuffled.length - 1; i > 0; i--) {
        random = (random * 9301 + 49297) % 233280
        const j = Math.floor((random / 233280) * (i + 1))
        ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
      }
      return shuffled
    }

    return filtered
  }, [games, filters, gameStats])

  const totalPages = Math.ceil(totalGames / itemsPerPage)
  const startItem = (currentPage - 1) * itemsPerPage + 1
  const endItem = Math.min(currentPage * itemsPerPage, totalGames)

  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  const removeAppliedSearch = useCallback(() => {
    setSearchInput("")
    updateFilter("searchTerm", "")
  }, [updateFilter])

  const removeSizeRange = useCallback(() => {
    updateFilter("sizeRange", [0, 500])
  }, [updateFilter])

  const clearFilters = useCallback(() => {
    setDeveloperQuery("")
    setSearchInput("")
    setFilters(DEFAULT_FILTERS)
    setSearchParams(new URLSearchParams(), { replace: true })
  }, [setSearchParams])

  const appliedFilterCount = useMemo(() => {
    let count = 0
    if (filters.searchTerm.trim()) count++
    count += filters.genres.length
    count += filters.developers.length
    if (filters.online) count++
    if (filters.nsfwOnly) count++
    if (filters.sortBy !== "random") count++
    if (filters.sizeRange[0] !== 0 || filters.sizeRange[1] !== 500) count++
    return count
  }, [filters])

  const sortLabel = useMemo(() => {
    switch (filters.sortBy) {
      case "added": return "Last Added"
      case "name": return "Name"
      case "date": return "Release Date"
      case "updated": return "Last Updated"
      case "size": return "Size"
      case "downloads-desc": return "Most Downloads"
      case "downloads-asc": return "Least Downloads"
      case "views-desc": return "Most Views"
      case "views-asc": return "Least Views"
      default: return "Random"
    }
  }, [filters.sortBy])

  const filteredDevelopers = useMemo(() => {
    const q = developerQuery.trim().toLowerCase()
    if (!q) return filterOptions.allDevelopers
    return filterOptions.allDevelopers.filter((developer) => developer.toLowerCase().includes(q))
  }, [developerQuery, filterOptions.allDevelopers])

  const FilterPanel = () => (
    <div className="space-y-6">
      {/* Genres */}
      <FilterSection
        title="Genres"
        action={
          filters.genres.length > 0 ? (
            <button
              type="button"
              onClick={() => updateFilter("genres", [])}
              className="text-xs text-zinc-400 hover:text-zinc-100 transition-colors"
            >
              Clear ({filters.genres.length})
            </button>
          ) : null
        }
      >
        <div className="flex flex-wrap gap-1.5">
          {filterOptions.allGenres.map((genre) => {
            const active = filters.genres.includes(genre)
            return (
              <button
                key={genre}
                type="button"
                onClick={() => toggleGenre(genre)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition-all border active:scale-95",
                  active
                    ? "bg-white text-black border-white"
                    : "bg-white/[.03] text-zinc-300 border-white/[.07] hover:bg-white/[.07] hover:text-white"
                )}
              >
                {genre}
              </button>
            )
          })}
        </div>
      </FilterSection>

      {/* Modes */}
      <FilterSection title="Modes">
        <div className="space-y-2">
          <ModeToggle
            label="Multiplayer Only"
            description="Show only games with multiplayer."
            checked={Boolean(filters.online)}
            onCheckedChange={(v) => updateFilter("online", v)}
          />
          <ModeToggle
            label="NSFW Only"
            description={filters.nsfwOnly ? "Showing only NSFW results." : "NSFW is hidden from results."}
            checked={Boolean(filters.nsfwOnly)}
            onCheckedChange={(v) => updateFilter("nsfwOnly", v)}
          />
        </div>
      </FilterSection>

      {/* Size range */}
      <FilterSection title="Size Range (GB)">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider">Min</label>
            <Input
              type="number"
              min={0}
              value={filters.sizeRange[0] === 0 ? "" : filters.sizeRange[0]}
              onChange={(e) => {
                const val = e.target.value === "" ? 0 : Math.max(0, parseInt(e.target.value) || 0)
                updateFilter("sizeRange", [val, filters.sizeRange[1]])
              }}
              className="h-9 rounded-xl bg-white/[.03] border-white/[.07]"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider">Max</label>
            <Input
              type="number"
              min={0}
              value={filters.sizeRange[1] === 0 ? "" : filters.sizeRange[1]}
              onChange={(e) => {
                const val = e.target.value === "" ? 0 : Math.max(0, parseInt(e.target.value) || 0)
                updateFilter("sizeRange", [filters.sizeRange[0], val])
              }}
              className="h-9 rounded-xl bg-white/[.03] border-white/[.07]"
            />
          </div>
        </div>
      </FilterSection>

      {/* Developers */}
      <FilterSection
        title="Developers"
        action={
          filters.developers.length > 0 ? (
            <button
              type="button"
              onClick={() => updateFilter("developers", [])}
              className="text-xs text-zinc-400 hover:text-zinc-100 transition-colors"
            >
              Clear ({filters.developers.length})
            </button>
          ) : null
        }
      >
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
            <Input
              value={developerQuery}
              onChange={(e) => setDeveloperQuery(e.target.value)}
              placeholder="Search developers"
              className="h-9 rounded-xl bg-white/[.03] border-white/[.07] pl-8"
            />
          </div>
          <ScrollArea className="h-44 rounded-xl border border-white/[.07] bg-white/[.02] p-1">
            <div className="grid grid-cols-1 gap-0.5">
              {filteredDevelopers.slice(0, 200).map((developer) => {
                const active = filters.developers.includes(developer)
                return (
                  <button
                    key={developer}
                    type="button"
                    onClick={() => toggleDeveloper(developer)}
                    className={cn(
                      "text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors",
                      active
                        ? "bg-white text-black font-semibold"
                        : "text-zinc-300 hover:bg-white/[.05]"
                    )}
                  >
                    {developer}
                  </button>
                )
              })}
              {filteredDevelopers.length > 200 && (
                <p className="px-2.5 py-1.5 text-[11px] text-zinc-500 italic">
                  Showing first 200. Refine your search.
                </p>
              )}
            </div>
          </ScrollArea>
        </div>
      </FilterSection>
    </div>
  )

  return (
    <div className="relative">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-zinc-100 mb-1">Search</h1>
          <p className="text-sm text-zinc-400">Find your next adventure with detailed filters.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate("/wishlist")}>
            <Star className="h-3.5 w-3.5" /> Wishlist
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate("/liked")}>
            <Heart className="h-3.5 w-3.5" /> Liked
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={refreshGames}
            disabled={refreshing}
            className="gap-1.5"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block">
          <div className="sticky top-4 max-h-[calc(100vh-7rem)] overflow-hidden rounded-3xl border border-white/[.07] bg-zinc-950/60 backdrop-blur-md flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[.07]">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-zinc-400" />
                <h2 className="text-sm font-semibold tracking-tight">Filters</h2>
                {appliedFilterCount > 0 && (
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{appliedFilterCount}</Badge>
                )}
              </div>
              {appliedFilterCount > 0 && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-xs text-zinc-400 hover:text-zinc-100 transition-colors"
                >
                  Reset all
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 uc-scrollbar">
              <FilterPanel />
            </div>
          </div>
        </aside>

        {/* Results column */}
        <div className="min-w-0 space-y-4">
          {/* Search + sort + mobile filter button */}
          <div className="rounded-3xl border border-white/[.07] bg-zinc-950/60 backdrop-blur-md p-3 sm:p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                <Input
                  value={searchInput}
                  onChange={(e) => {
                    setIsSearching(true)
                    setSearchInput(e.target.value)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && searchInput.trim()) {
                      addSearchToHistory(searchInput.trim())
                    }
                  }}
                  placeholder="Search games…"
                  className="rounded-2xl bg-white/[.03] border-white/[.07] pl-10 h-11"
                />
                {isSearching && (
                  <div className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-400">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  </div>
                )}
              </div>
              <Select value={filters.sortBy} onValueChange={(v) => updateFilter("sortBy", v)}>
                <SelectTrigger className="rounded-2xl bg-white/[.03] border-white/[.07] h-11 w-full sm:w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="random">Random</SelectItem>
                  <SelectItem value="added">Last Added</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="date">Release Date</SelectItem>
                  <SelectItem value="updated">Last Updated</SelectItem>
                  <SelectItem value="size">Size</SelectItem>
                  <SelectItem value="downloads-desc">Most Downloads</SelectItem>
                  <SelectItem value="downloads-asc">Least Downloads</SelectItem>
                  <SelectItem value="views-desc">Most Views</SelectItem>
                  <SelectItem value="views-asc">Least Views</SelectItem>
                </SelectContent>
              </Select>

              <Sheet open={isFiltersOpen} onOpenChange={setIsFiltersOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" className="lg:hidden rounded-2xl h-11 gap-2">
                    <SlidersHorizontal className="h-4 w-4" />
                    Filters
                    {appliedFilterCount > 0 && (
                      <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{appliedFilterCount}</Badge>
                    )}
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-full sm:max-w-md flex flex-col h-full p-0">
                  <SheetHeader className="px-5 py-4 border-b border-white/[.07]">
                    <SheetTitle>Filters</SheetTitle>
                    <SheetDescription>Changes apply instantly.</SheetDescription>
                  </SheetHeader>
                  <div className="flex-1 overflow-y-auto px-5 py-4 uc-scrollbar">
                    <FilterPanel />
                  </div>
                  <div className="px-5 py-3 border-t border-white/[.07] flex gap-2">
                    <Button variant="outline" onClick={clearFilters} className="flex-1 rounded-2xl h-11">
                      Reset
                    </Button>
                    <Button onClick={() => setIsFiltersOpen(false)} className="flex-[2] rounded-2xl h-11">
                      Done
                    </Button>
                  </div>
                </SheetContent>
              </Sheet>
            </div>

            {/* Applied filter chips */}
            {appliedFilterCount > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {filters.searchTerm.trim() && (
                  <FilterChip label={`Search: ${filters.searchTerm.trim()}`} onRemove={removeAppliedSearch} />
                )}
                {filters.sortBy !== "random" && (
                  <FilterChip label={`Sort: ${sortLabel}`} onRemove={() => updateFilter("sortBy", "random")} />
                )}
                {(filters.sizeRange[0] !== 0 || filters.sizeRange[1] !== 500) && (
                  <FilterChip
                    label={`${filters.sizeRange[0]}–${filters.sizeRange[1]}GB`}
                    onRemove={removeSizeRange}
                  />
                )}
                {filters.online && (
                  <FilterChip
                    label="Multiplayer"
                    icon={<Wifi className="h-3 w-3" />}
                    tone="emerald"
                    onRemove={() => updateFilter("online", false)}
                  />
                )}
                {filters.nsfwOnly && (
                  <FilterChip label="NSFW" tone="red" onRemove={() => updateFilter("nsfwOnly", false)} />
                )}
                {filters.genres.filter((g) => g.toLowerCase() !== "nsfw").map((genre) => (
                  <FilterChip key={genre} label={genre} onRemove={() => toggleGenre(genre)} />
                ))}
                {filters.developers.map((developer) => (
                  <FilterChip key={developer} label={developer} onRemove={() => toggleDeveloper(developer)} />
                ))}
              </div>
            )}
          </div>

          {/* Results */}
          <div>
            <CriticalLoadModal
              open={Boolean(gamesError) && hasCriticalServiceInterruption && criticalLoadOpen}
              onOpenChange={setCriticalLoadOpen}
              title="Critical Data Load Failure"
              message={gamesError?.message || "Unable to load game data right now."}
              errorCode={gamesError?.code}
              onRetry={() => {
                setGamesError(null)
                setLoading(true)
                loadGames()
              }}
              onContinue={() => setCriticalLoadOpen(false)}
            />

            {!isOnline && games.length === 0 && !loading && (
              <div className="mb-6">
                <OfflineBanner
                  onRetry={() => {
                    setGamesError(null)
                    setLoading(true)
                    loadGames()
                  }}
                />
              </div>
            )}

            {!isOnline && (games.length > 0 || loading) && (
              <div className="mb-6">
                <OfflineBanner
                  variant="compact"
                  onRetry={() => {
                    setGamesError(null)
                    setLoading(true)
                    loadGames()
                  }}
                />
              </div>
            )}

            <APIErrorBoundary>
              {loading ? (
                <div className="space-y-4">
                  <Skeleton className="h-7 w-48 rounded-lg udl-skeleton-d1" />
                  <GamesGridSkeleton count={Math.min(itemsPerPage, filteredGames.length || itemsPerPage)} />
                </div>
              ) : (
                <>
                  <div className="mb-4 flex items-baseline gap-3">
                    <h2 className="text-lg sm:text-xl font-bold text-zinc-100">Results</h2>
                    <span className="text-xs sm:text-sm font-medium text-zinc-400 bg-white/[.05] px-2.5 py-0.5 rounded-full border border-white/[.07]">
                      {totalGames.toLocaleString()} {totalGames === 1 ? "game" : "games"}
                    </span>
                    {totalGames > itemsPerPage && (
                      <span className="text-xs text-zinc-400 italic hidden sm:inline">
                        {startItem}–{endItem}
                      </span>
                    )}
                  </div>

                  <div className="relative">
                    {filtering && (
                      <div className="absolute inset-0 bg-zinc-900/40 backdrop-blur-md z-40 flex items-center justify-center rounded-3xl transition-all duration-300">
                        <div className="flex flex-col items-center gap-4 bg-black/60 p-8 rounded-3xl border border-white/[.07] shadow-2xl">
                          <LoadingAnimated className="h-12 w-12" />
                          <span className="text-sm font-semibold tracking-wider uppercase text-white">Filtering…</span>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
                      {filteredGames.map((game) => (
                        <GameCard
                          key={game.appid}
                          game={game}
                          stats={gameStats[game.appid]}
                          updateAvailable={hasInstalledVersionUpdate(game.version, installedVersionMap[game.appid] || [])}
                          updateLabel={game.version ? `Update available - ${game.version}` : "Update available"}
                        />
                      ))}
                    </div>

                    {filteredGames.length === 0 && (
                      <div className="text-center py-20 rounded-3xl bg-white/[.02] border border-dashed border-white/[.07]">
                        <div className="max-w-md mx-auto flex flex-col items-center gap-6">
                          <div className="h-20 w-20 rounded-full bg-white/[.04] flex items-center justify-center border border-white/[.07] shadow-inner">
                            <Filter className="h-10 w-10 text-zinc-400" />
                          </div>
                          <div className="space-y-2">
                            <h3 className="text-2xl font-bold">No games found</h3>
                            <p className="text-zinc-400">
                              No games match your search criteria. Try adjusting your filters.
                            </p>
                          </div>

                          {didYouMeanResults.length > 0 && (
                            <div className="w-full space-y-4 pt-4">
                              <div className="flex items-center gap-2">
                                <div className="h-px flex-1 bg-gradient-to-r from-transparent to-white/10" />
                                <span className="text-xs font-bold uppercase tracking-widest text-zinc-400 px-2">Suggestions</span>
                                <div className="h-px flex-1 bg-gradient-to-l from-transparent to-white/10" />
                              </div>
                              <div className="grid grid-cols-1 gap-2">
                                {didYouMeanResults.map((game) => (
                                  <button
                                    key={game.appid}
                                    type="button"
                                    onClick={() => navigate(`/game/${game.appid}`)}
                                    className="group flex items-center gap-4 p-3 rounded-2xl bg-white/[.03] border border-white/[.07] hover:bg-white/[.06] transition-all duration-300 text-left"
                                  >
                                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-white/[.07] shadow-lg">
                                      {game.image ? (
                                        <img
                                          src={proxyImageUrl(game.image)}
                                          alt={game.name}
                                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                                        />
                                      ) : (
                                        <div className="h-full w-full bg-zinc-800" />
                                      )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <h4 className="font-bold text-zinc-100 truncate group-hover:text-white transition-colors">{game.name}</h4>
                                      {game.developer && (
                                        <p className="text-xs text-zinc-400 truncate">{game.developer}</p>
                                      )}
                                    </div>
                                    <ChevronRight className="h-5 w-5 text-zinc-400 group-hover:text-white transition-all duration-300 group-hover:translate-x-1" />
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {totalGames > itemsPerPage && (
                      <PaginationBar
                        currentPage={currentPage}
                        totalPages={totalPages}
                        onPageChange={setCurrentPage}
                        wrapperClassName="mt-10"
                      />
                    )}
                  </div>
                </>
              )}
            </APIErrorBoundary>
          </div>
        </div>
      </div>
    </div>
  )
}

function FilterSection({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">{title}</label>
        {action}
      </div>
      {children}
    </div>
  )
}

function ModeToggle({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string
  description: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-white/[.07] bg-white/[.02] hover:bg-white/[.04] transition-colors">
      <div className="min-w-0 space-y-0.5">
        <p className="text-xs font-semibold text-zinc-100">{label}</p>
        <p className="text-[10px] text-zinc-400 leading-snug">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

function FilterChip({
  label,
  icon,
  tone,
  onRemove,
}: {
  label: string
  icon?: React.ReactNode
  tone?: "emerald" | "red"
  onRemove: () => void
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border backdrop-blur-md",
        tone === "emerald" && "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
        tone === "red" && "bg-red-500/10 text-red-400 border-red-500/20",
        !tone && "bg-white/[.04] text-zinc-200 border-white/[.07]"
      )}
    >
      {icon}
      <span className="max-w-[180px] truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className={cn(
          "ml-0.5 inline-flex items-center justify-center h-4 w-4 rounded-full transition-colors",
          tone === "emerald" && "hover:bg-emerald-500/20",
          tone === "red" && "hover:bg-red-500/20",
          !tone && "hover:bg-white/[.08]"
        )}
        aria-label={`Remove ${label}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}
