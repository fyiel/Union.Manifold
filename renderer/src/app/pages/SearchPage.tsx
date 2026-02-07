import { useState, useEffect, useMemo, useCallback } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { GameCard } from "@/components/GameCard"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { Filter, Wifi, X, SlidersHorizontal, RefreshCw, Heart, Star } from "lucide-react"
import { useDebounce } from "@/hooks/use-debounce"
import { parseSize } from "@/lib/search-utils"
import { hasOnlineMode, generateErrorCode, ErrorTypes } from "@/lib/utils"
import { addSearchToHistory } from "@/lib/user-history"
import { APIErrorBoundary } from "@/components/error-boundary"
import { GamesGridSkeleton } from "@/components/api-fallback"
import { ErrorMessage } from "@/components/ErrorMessage"
import { OfflineBanner } from "@/components/OfflineBanner"
import { apiFetch } from "@/lib/api"
import { useOnlineStatus } from "@/hooks/use-online-status"

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

export function SearchPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [isFiltersOpen, setIsFiltersOpen] = useState(false)
  const [developerQuery, setDeveloperQuery] = useState("")
  const isOnline = useOnlineStatus()

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

  const [games, setGames] = useState<Game[]>([])
  const [totalGames, setTotalGames] = useState(0)
  const [meta, setMeta] = useState<{ genres: string[]; developers: string[] }>({ genres: [], developers: [] })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filtering, setFiltering] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [gameStats, setGameStats] = useState<Record<string, { downloads: number; views: number }>>({})
  const [refreshKey, setRefreshKey] = useState(0)
  const [gamesError, setGamesError] = useState<{ type: string; message: string; code: string } | null>(null)
  const [statsError, setStatsError] = useState<{ type: string; message: string; code: string } | null>(null)

  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 20

  const [draftFilters, setDraftFilters] = useState<Filters>({
    searchTerm: searchParams.get("q") || "",
    genres: [],
    developers: [],
    sizeRange: [0, 500],
    sortBy: normalizeSort(searchParams.get("sort")),
    online: searchParams.get("online") === "1",
    nsfwOnly: searchParams.get("nsfw") === "1",
  })

  const [appliedFilters, setAppliedFilters] = useState<Filters>({
    searchTerm: searchParams.get("q") || "",
    genres: [],
    developers: [],
    sizeRange: [0, 500],
    sortBy: normalizeSort(searchParams.get("sort")),
    online: searchParams.get("online") === "1",
    nsfwOnly: searchParams.get("nsfw") === "1",
  })

  const debouncedSearchTerm = useDebounce(appliedFilters.searchTerm, 300)
  const debouncedDraftSearchTerm = useDebounce(draftFilters.searchTerm, 500)
  const searchParamsKey = searchParams.toString()

  useEffect(() => {
    loadGames()
  }, [appliedFilters, currentPage, searchParamsKey])

  useEffect(() => {
    const sortBy = normalizeSort(searchParams.get("sort"))
    setDraftFilters((prev) => ({ ...prev, sortBy }))
    setAppliedFilters((prev) => ({ ...prev, sortBy }))
  }, [searchParamsKey, normalizeSort, searchParams])

  useEffect(() => {
    setCurrentPage(1)
  }, [appliedFilters, debouncedSearchTerm])

  useEffect(() => {
    setAppliedFilters((prev) => ({ ...prev, searchTerm: debouncedDraftSearchTerm }))
    setIsSearching(false)
  }, [debouncedDraftSearchTerm])

  useEffect(() => {
    fetchMeta()
  }, [])

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
    // Don't attempt API calls when offline
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return { items: [], total: 0 }
    }

    try {
      const params = new URLSearchParams()
      if (appliedFilters.searchTerm) params.set("q", appliedFilters.searchTerm)

      appliedFilters.genres.forEach((g) => params.append("genres", g))
      appliedFilters.developers.forEach((d) => params.append("developers", d))
      if (appliedFilters.online) params.set("online", "true")

      const allowNsfw = Boolean(appliedFilters.nsfwOnly)
      params.set("nsfw", allowNsfw ? "true" : "false")
      // NSFW mode controls inclusion via the API; it does not force an NSFW-only filter.

      if (appliedFilters.sortBy) params.set("sort", appliedFilters.sortBy)

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
      setGamesError({
        type: "games",
        message: "Unable to refresh games. Please try again or contact support if the issue persists.",
        code: generateErrorCode(ErrorTypes.SEARCH_FETCH, "search-page-refresh"),
      })
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

    if (descriptionPatterns.some((pattern) => pattern.test(trimmed))) {
      return false
    }

    const validNamePattern = /^[\w\s\-\.,'&()]+$/u
    if (!validNamePattern.test(trimmed)) {
      return false
    }

    const words = trimmed.split(/\s+/)
    if (words.length > 6) {
      return false
    }

    if (trimmed.includes(" is ") || trimmed.includes(" was ") || trimmed.includes(" has ")) {
      return false
    }

    const capitalizedWords = words.filter((word) => /^[A-Z]/.test(word))
    if (capitalizedWords.length === words.length && words.length > 1) {
      return true
    }

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

    if (appliedFilters.sizeRange[0] > 0 || appliedFilters.sizeRange[1] < 500) {
      const minSizeBytes = appliedFilters.sizeRange[0] * 1024 * 1024 * 1024
      const maxSizeBytes = appliedFilters.sizeRange[1] * 1024 * 1024 * 1024

      filtered = filtered.filter((game) => {
        const gameSize = parseSize(game.size)
        return gameSize > 0 && gameSize >= minSizeBytes && gameSize <= maxSizeBytes
      })
    }

    if (appliedFilters.online) {
      filtered = filtered.filter((game) => hasOnlineMode(game.hasCoOp))
    }

    if (appliedFilters.sortBy !== "random") {
      filtered.sort((a, b) => {
        switch (appliedFilters.sortBy) {
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

    if (appliedFilters.sortBy === "random") {
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
  }, [games, debouncedSearchTerm, appliedFilters, gameStats])

  const paginatedGames = filteredGames

  const totalPages = Math.ceil(totalGames / itemsPerPage)
  const startItem = (currentPage - 1) * itemsPerPage + 1
  const endItem = Math.min(currentPage * itemsPerPage, totalGames)

  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  const updateDraftFilter = useCallback((key: keyof Filters, value: any) => {
    setDraftFilters((prev) => ({ ...prev, [key]: value }))
  }, [])

  const toggleDraftGenre = useCallback((genre: string) => {
    setDraftFilters((prev) => ({
      ...prev,
      genres: prev.genres.includes(genre) ? prev.genres.filter((g) => g !== genre) : [...prev.genres, genre],
    }))
  }, [])

  const toggleDraftDeveloper = useCallback((developer: string) => {
    setDraftFilters((prev) => ({
      ...prev,
      developers: prev.developers.includes(developer)
        ? prev.developers.filter((d) => d !== developer)
        : [...prev.developers, developer],
    }))
  }, [])

  const removeAppliedGenre = useCallback((genre: string) => {
    setAppliedFilters((prev) => ({
      ...prev,
      genres: prev.genres.filter((g) => g !== genre),
    }))
    setDraftFilters((prev) => ({
      ...prev,
      genres: prev.genres.filter((g) => g !== genre),
    }))
  }, [])

  const removeAppliedDeveloper = useCallback((developer: string) => {
    setAppliedFilters((prev) => ({
      ...prev,
      developers: prev.developers.filter((d) => d !== developer),
    }))
    setDraftFilters((prev) => ({
      ...prev,
      developers: prev.developers.filter((d) => d !== developer),
    }))
  }, [])

  const removeAppliedOnline = useCallback(() => {
    setAppliedFilters((prev) => ({
      ...prev,
      online: false,
    }))
    setDraftFilters((prev) => ({
      ...prev,
      online: false,
    }))
  }, [])

  const removeAppliedNsfwOnly = useCallback(() => {
    setAppliedFilters((prev) => ({ ...prev, nsfwOnly: false }))
    setDraftFilters((prev) => ({ ...prev, nsfwOnly: false }))
  }, [])

  const removeAppliedSearch = useCallback(() => {
    setAppliedFilters((prev) => ({ ...prev, searchTerm: "" }))
    setDraftFilters((prev) => ({ ...prev, searchTerm: "" }))
  }, [])

  const removeAppliedSizeRange = useCallback(() => {
    setAppliedFilters((prev) => ({ ...prev, sizeRange: [0, 500] }))
    setDraftFilters((prev) => ({ ...prev, sizeRange: [0, 500] }))
  }, [])

  const removeAppliedSort = useCallback(() => {
    setAppliedFilters((prev) => ({ ...prev, sortBy: "random" }))
    setDraftFilters((prev) => ({ ...prev, sortBy: "random" }))
  }, [])

  const applyFilters = useCallback(async () => {
    setFiltering(true)
    await new Promise((resolve) => setTimeout(resolve, 50))

    setAppliedFilters({ ...draftFilters })

    await refreshGames()

    if (draftFilters.searchTerm.trim()) {
      addSearchToHistory(draftFilters.searchTerm.trim())
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
    setFiltering(false)
  }, [draftFilters, refreshGames])

  const clearFilters = useCallback(() => {
    const clearedFilters = {
      searchTerm: "",
      genres: [],
      developers: [],
      sizeRange: [0, 500] as [number, number],
      sortBy: "random",
      online: false,
      nsfwOnly: false,
    }
    setDeveloperQuery("")
    setDraftFilters(clearedFilters)
    setAppliedFilters(clearedFilters)
  }, [])

  const hasUnappliedChanges = useMemo(() => {
    return JSON.stringify(draftFilters) !== JSON.stringify(appliedFilters)
  }, [draftFilters, appliedFilters])

  const appliedFilterCount = useMemo(() => {
    let count = 0
    if (appliedFilters.searchTerm.trim()) count++
    count += appliedFilters.genres.length
    count += appliedFilters.developers.length
    if (appliedFilters.online) count++
    if (appliedFilters.nsfwOnly) count++
    if (appliedFilters.sortBy !== "random") count++
    if (appliedFilters.sizeRange[0] !== 0 || appliedFilters.sizeRange[1] !== 500) count++
    return count
  }, [appliedFilters])

  const sortLabel = useMemo(() => {
    switch (appliedFilters.sortBy) {
      case "added":
        return "Last Added"
      case "name":
        return "Name"
      case "date":
        return "Release Date"
      case "updated":
        return "Last Updated"
      case "size":
        return "Size"
      case "downloads-desc":
        return "Most Downloads"
      case "downloads-asc":
        return "Least Downloads"
      case "views-desc":
        return "Most Views"
      case "views-asc":
        return "Least Views"
      default:
        return "Random"
    }
  }, [appliedFilters.sortBy])

  const filteredDevelopers = useMemo(() => {
    const q = developerQuery.trim().toLowerCase()
    if (!q) return filterOptions.allDevelopers
    return filterOptions.allDevelopers.filter((developer) => developer.toLowerCase().includes(q))
  }, [developerQuery, filterOptions.allDevelopers])

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-7xl px-3 sm:px-4 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground font-montserrat mb-1 sm:mb-2">
              Advanced Search
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground">
              Find exactly what you're looking for with detailed filters
            </p>
          </div>
          <Button
            variant="outline"
            onClick={refreshGames}
            disabled={refreshing}
            className="flex items-center gap-2 bg-transparent w-full sm:w-auto justify-center sm:justify-start"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            <span className="hidden xs:inline">Refresh</span>
          </Button>
        </div>

        <div className="mb-5">
          <Card className="border border-border/60 bg-card/40">
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-lg">Your Lists</CardTitle>
                <p className="text-sm text-muted-foreground">Jump to wishlist or liked games.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="gap-2" onClick={() => navigate("/wishlist")}>
                  <Star className="h-4 w-4" />
                  Wishlist
                </Button>
                <Button variant="outline" className="gap-2" onClick={() => navigate("/liked")}>
                  <Heart className="h-4 w-4" />
                  Liked
                </Button>
              </div>
            </CardHeader>
          </Card>
        </div>

        <div className="mb-5">
          <Card className="border border-border/60 bg-card/40 backdrop-blur-sm">
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <CardTitle className="text-lg flex items-center gap-2">
                  <SlidersHorizontal className="h-5 w-5" />
                  Search & Filters
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Quick search + sort is always visible. Open the filter panel for genres, developers, size, and online-only.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Sheet open={isFiltersOpen} onOpenChange={setIsFiltersOpen}>
                  <SheetTrigger asChild>
                    <Button variant="outline" className="gap-2">
                      <SlidersHorizontal className="h-4 w-4" />
                      Filters
                      {appliedFilterCount > 0 && (
                        <Badge variant="secondary" className="ml-1">
                          {appliedFilterCount}
                        </Badge>
                      )}
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="right" className="w-full sm:max-w-lg">
                    <SheetHeader>
                      <SheetTitle>Filters</SheetTitle>
                      <SheetDescription>Refine results, then apply changes.</SheetDescription>
                    </SheetHeader>

                    <div className="flex-1 overflow-y-auto px-4 pb-4">
                      <div className="space-y-5">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Online Only</label>
                          <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/40 px-4 py-3">
                            <div className="space-y-0.5">
                              <p className="text-sm font-semibold text-foreground">Show online games</p>
                              <p className="text-xs text-muted-foreground">Filters using the online/co-op badge.</p>
                            </div>
                            <Switch
                              checked={Boolean(draftFilters.online)}
                              onCheckedChange={(checked) => updateDraftFilter("online", Boolean(checked))}
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium">NSFW Mode</label>
                          <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/40 px-4 py-3">
                            <div className="space-y-0.5">
                              <p className="text-sm font-semibold text-foreground">Show NSFW games</p>
                              <p className="text-xs text-muted-foreground">Includes NSFW titles in results.</p>
                            </div>
                            <Switch
                              checked={Boolean(draftFilters.nsfwOnly)}
                              onCheckedChange={(checked) => updateDraftFilter("nsfwOnly", Boolean(checked))}
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium">Size Range</label>
                          <div className="rounded-xl border border-border/60 bg-background/40 p-4 space-y-3">
                            <p className="text-xs text-muted-foreground">
                              {draftFilters.sizeRange[0]}GB - {draftFilters.sizeRange[1]}GB
                            </p>
                            <Slider
                              value={draftFilters.sizeRange}
                              onValueChange={(value) => updateDraftFilter("sizeRange", value)}
                              max={500}
                              min={0}
                              step={5}
                              className="w-full"
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium">Genres</label>
                          <ScrollArea className="h-56 rounded-xl border border-border/60 bg-background/40 p-2">
                            <div className="grid grid-cols-1 gap-1">
                              {filterOptions.allGenres.map((genre) => (
                                <button
                                  key={genre}
                                  type="button"
                                  className={`text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                                    draftFilters.genres.includes(genre)
                                      ? "bg-primary text-primary-foreground"
                                      : "hover:bg-muted"
                                  }`}
                                  onClick={() => toggleDraftGenre(genre)}
                                >
                                  {genre}
                                </button>
                              ))}
                            </div>
                          </ScrollArea>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium">Developers</label>
                          <Input
                            value={developerQuery}
                            onChange={(e) => setDeveloperQuery(e.target.value)}
                            placeholder="Search developers..."
                          />
                          <ScrollArea className="h-56 rounded-xl border border-border/60 bg-background/40 p-2">
                            <div className="grid grid-cols-1 gap-1">
                              {filteredDevelopers.slice(0, 200).map((developer) => (
                                <button
                                  key={developer}
                                  type="button"
                                  className={`text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                                    draftFilters.developers.includes(developer)
                                      ? "bg-primary text-primary-foreground"
                                      : "hover:bg-muted"
                                  }`}
                                  onClick={() => toggleDraftDeveloper(developer)}
                                >
                                  {developer}
                                </button>
                              ))}
                              {filteredDevelopers.length > 200 && (
                                <p className="px-3 py-2 text-xs text-muted-foreground">
                                  Showing first 200 matches. Refine your search to narrow it down.
                                </p>
                              )}
                            </div>
                          </ScrollArea>
                        </div>
                      </div>
                    </div>

                    <div className="mt-auto border-t border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+16px)] flex flex-col sm:flex-row gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={clearFilters}
                        disabled={filtering}
                        className="w-full sm:w-auto sm:flex-1"
                      >
                        Reset
                      </Button>
                      <Button
                        size="sm"
                        onClick={async () => {
                          await applyFilters()
                          setIsFiltersOpen(false)
                        }}
                        disabled={!hasUnappliedChanges || filtering}
                        className="w-full sm:w-auto sm:flex-1"
                        variant={hasUnappliedChanges ? "default" : "secondary"}
                      >
                        {filtering ? "Applying..." : `Apply${hasUnappliedChanges ? " *" : ""}`}
                      </Button>
                    </div>
                  </SheetContent>
                </Sheet>

                <Button onClick={applyFilters} disabled={!hasUnappliedChanges || filtering} variant={hasUnappliedChanges ? "default" : "secondary"}>
                  {filtering ? "Applying..." : `Apply${hasUnappliedChanges ? " *" : ""}`}
                </Button>

                <Button variant="ghost" onClick={clearFilters} disabled={filtering}>
                  <X className="h-4 w-4 mr-2" />
                  Reset
                </Button>
              </div>
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Search</label>
                  <div className="relative">
                    <Input
                      value={draftFilters.searchTerm}
                      onChange={(e) => {
                        setIsSearching(true)
                        updateDraftFilter("searchTerm", e.target.value)
                      }}
                      placeholder="Search games..."
                    />
                    {isSearching && (
                      <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Sort By</label>
                  <Select value={draftFilters.sortBy} onValueChange={(value) => updateDraftFilter("sortBy", value)}>
                    <SelectTrigger>
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
                </div>
              </div>

              {appliedFilterCount > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {appliedFilters.searchTerm.trim() && (
                    <Badge
                      variant="outline"
                      className="gap-2 text-xs sm:text-sm rounded-full border-border/60 bg-muted/40 px-3 py-1 shadow-sm"
                    >
                      <span className="text-muted-foreground">Search:</span>
                      <span className="max-w-[240px] truncate">{appliedFilters.searchTerm.trim()}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 rounded-full hover:bg-foreground/10"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation()
                          removeAppliedSearch()
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </Badge>
                  )}

                  {appliedFilters.sortBy !== "random" && (
                    <Badge
                      variant="outline"
                      className="gap-2 text-xs sm:text-sm rounded-full border-border/60 bg-muted/40 px-3 py-1 shadow-sm"
                    >
                      <span className="text-muted-foreground">Sort:</span>
                      <span className="truncate">{sortLabel}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 rounded-full hover:bg-foreground/10"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation()
                          removeAppliedSort()
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </Badge>
                  )}

                  {(appliedFilters.sizeRange[0] !== 0 || appliedFilters.sizeRange[1] !== 500) && (
                    <Badge
                      variant="outline"
                      className="gap-2 text-xs sm:text-sm rounded-full border-border/60 bg-muted/40 px-3 py-1 shadow-sm"
                    >
                      <span className="text-muted-foreground">Size:</span>
                      <span className="truncate">
                        {appliedFilters.sizeRange[0]}-{appliedFilters.sizeRange[1]}GB
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 rounded-full hover:bg-foreground/10"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation()
                          removeAppliedSizeRange()
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </Badge>
                  )}

                  {appliedFilters.online && (
                    <Badge
                      variant="outline"
                      className="gap-2 text-xs sm:text-sm rounded-full bg-gradient-to-r from-emerald-600/90 to-green-600/90 text-white border-emerald-500/40 px-3 py-1.5 shadow-lg shadow-emerald-500/30"
                    >
                      <Wifi className="h-3 w-3" />
                      Online
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 rounded-full hover:bg-white/15"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation()
                          removeAppliedOnline()
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </Badge>
                  )}

                  {appliedFilters.nsfwOnly && (
                    <Badge
                      variant="outline"
                      className="gap-2 text-xs sm:text-sm rounded-full border-border/60 bg-red-500/10 text-red-600 dark:text-red-400 px-3 py-1 shadow-sm"
                    >
                      NSFW
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 rounded-full hover:bg-red-500/15"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation()
                          removeAppliedNsfwOnly()
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </Badge>
                  )}

                  {appliedFilters.genres.filter((genre) => String(genre).toLowerCase() !== "nsfw").map((genre) => (
                    <Badge
                      key={genre}
                      variant="outline"
                      className="gap-2 text-xs sm:text-sm rounded-full border-border/60 bg-muted/40 px-3 py-1 shadow-sm"
                    >
                      <span className="truncate">{genre}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 rounded-full hover:bg-foreground/10"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation()
                          removeAppliedGenre(genre)
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </Badge>
                  ))}

                  {appliedFilters.developers.map((developer) => (
                    <Badge
                      key={developer}
                      variant="outline"
                      className="gap-2 text-xs sm:text-sm rounded-full border-border/60 bg-muted/40 px-3 py-1 shadow-sm"
                    >
                      <span className="max-w-[240px] truncate">{developer}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 rounded-full hover:bg-foreground/10"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation()
                          removeAppliedDeveloper(developer)
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
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

          {gamesError && isOnline && (
            <div className="mb-6">
              <div className="mb-6">
                <ErrorMessage
                  title="Games Loading Issue"
                  message={gamesError.message}
                  errorCode={gamesError.code}
                  retry={() => {
                    setGamesError(null)
                    setLoading(true)
                    loadGames()
                  }}
                />
              </div>
            </div>
          )}

          <APIErrorBoundary>
            {loading ? (
              <>
                <div className="mb-6">
                  <Skeleton className="h-7 w-48 mb-3 bg-muted/40" />
                  <Skeleton className="h-4 w-32 bg-muted/30" />
                </div>

                <GamesGridSkeleton count={Math.min(itemsPerPage, filteredGames.length || itemsPerPage)} />
              </>
            ) : (
              <>
                <div className="mb-4 sm:mb-6">
                  <h2 className="text-lg sm:text-xl font-semibold text-foreground mb-2 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                    Search Results ({filteredGames.length} games)
                    {filteredGames.length > itemsPerPage && (
                      <span className="text-xs sm:text-sm text-muted-foreground font-normal">
                        • Showing {startItem}-{endItem} of {filteredGames.length}
                      </span>
                    )}
                  </h2>
                </div>

                <div className="relative">
                  {filtering && (
                    <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-10 flex items-center justify-center rounded-lg">
                      <div className="flex items-center gap-3 bg-card p-4 rounded-lg shadow-lg">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                        <span className="text-sm font-medium">Filtering games...</span>
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
                    {paginatedGames.map((game) => (
                      <GameCard key={game.appid} game={game} stats={gameStats[game.appid]} />
                    ))}
                  </div>

                  {totalPages > 1 && (
                    <div className="mt-6 sm:mt-8 overflow-x-auto">
                      <Pagination>
                        <PaginationContent className="min-w-max">
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
                </div>

                {filteredGames.length === 0 && games.length === 0 && (
                  <div className="text-center py-12 sm:py-20">
                    <div className="max-w-xl mx-auto">
                      <ErrorMessage
                        title="Games Loading Issue"
                        message="We couldn't load any games. Please try again or contact support if the issue persists."
                        errorCode={generateErrorCode(ErrorTypes.SEARCH_FETCH, "search-page-empty")}
                        retry={() => {
                          setGamesError(null)
                          setLoading(true)
                          loadGames()
                        }}
                      />
                    </div>
                  </div>
                )}

                {filteredGames.length === 0 && games.length > 0 && (
                  <div className="text-center py-12 sm:py-20">
                    <div className="max-w-xl mx-auto">
                      <div className="flex flex-col items-center gap-4">
                        <div className="p-4 rounded-full bg-muted">
                          <Filter className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <div>
                          <h3 className="text-lg sm:text-xl font-semibold text-foreground mb-2">No games found</h3>
                          <p className="text-sm sm:text-base text-muted-foreground">
                            No games match your search criteria. Try adjusting your filters or search terms.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </APIErrorBoundary>
        </div>
      </div>
    </div>
  )
}
