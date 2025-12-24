
import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { GameCard } from "@/components/GameCard"
import { GameCardSkeleton } from "@/components/GameCardSkeleton"
import { SearchSuggestions } from "@/components/SearchSuggestions"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
import { Flag, X, SlidersHorizontal, RefreshCw } from "lucide-react"
import { apiUrl } from "@/lib/api"
import { parseSize, normalizeString } from "@/lib/search-utils"
import { hasOnlineMode } from "@/lib/utils"
import { addSearchToHistory } from "@/lib/user-history"

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

const sortLabels: Record<string, string> = {
  random: "Random",
  added: "Last Added",
  name: "Name",
  date: "Release Date",
  updated: "Last Updated",
  size: "Size",
  "downloads-desc": "Most Downloads",
  "downloads-asc": "Least Downloads",
  "views-desc": "Most Views",
  "views-asc": "Least Views",
}

export function SearchPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [isFiltersOpen, setIsFiltersOpen] = useState(false)
  const [developerQuery, setDeveloperQuery] = useState("")
  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filtering, setFiltering] = useState(false)
  const [gameStats, setGameStats] = useState<Record<string, { downloads: number; views: number }>>({})
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 20

  const initialSearch = searchParams.get("q") || ""
  const initialOnline = searchParams.get("online") === "1"
  const initialNsfw = searchParams.get("nsfw") === "1"

  const [draftFilters, setDraftFilters] = useState<Filters>({
    searchTerm: initialSearch,
    genres: initialNsfw ? ["nsfw"] : [],
    developers: [],
    sizeRange: [0, 500],
    sortBy: "random",
    online: initialOnline,
    nsfwOnly: initialNsfw,
  })

  const [appliedFilters, setAppliedFilters] = useState<Filters>({
    searchTerm: initialSearch,
    genres: initialNsfw ? ["nsfw"] : [],
    developers: [],
    sizeRange: [0, 500],
    sortBy: "random",
    online: initialOnline,
    nsfwOnly: initialNsfw,
  })

  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(appliedFilters.searchTerm)

  useEffect(() => {
    const nextSearch = searchParams.get("q") || ""
    const nextOnline = searchParams.get("online") === "1"
    const nextNsfw = searchParams.get("nsfw") === "1"
    const updated = {
      searchTerm: nextSearch,
      genres: nextNsfw ? ["nsfw"] : [],
      developers: [],
      sizeRange: [0, 500],
      sortBy: "random",
      online: nextOnline,
      nsfwOnly: nextNsfw,
    }
    setDraftFilters(updated)
    setAppliedFilters(updated)
  }, [searchParams])

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearchTerm(appliedFilters.searchTerm)
    }, 300)
    return () => window.clearTimeout(handle)
  }, [appliedFilters.searchTerm])

  useEffect(() => {
    setCurrentPage(1)
  }, [appliedFilters, debouncedSearchTerm])

  const extractDeveloper = (description: string): string => {
    const match = description.match(/(?:by|from|developer|dev|studio)\s+([^.,\n]+)/i)
    return match ? match[1].trim() : "Unknown"
  }
  const fetchGames = async (): Promise<Game[]> => {
    const response = await fetch(apiUrl("/api/games"))
    if (!response.ok) {
      throw new Error(`Failed to load games (${response.status})`)
    }
    const data = await response.json()
    return data.map((game: Game, index: number) => ({
      ...game,
      searchText: normalizeString(`${game.name} ${game.description} ${game.genres?.join(" ") || ""}`),
      developer: game.developer && game.developer !== "Unknown" ? game.developer : extractDeveloper(game.description),
      addedOrder: index,
    }))
  }

  const fetchGameStats = async () => {
    try {
      const response = await fetch(apiUrl("/api/downloads/all"))
      if (!response.ok) {
        throw new Error(`Failed to load stats (${response.status})`)
      }
      const data = await response.json()
      if (data && typeof data === "object") {
        setGameStats(data)
      }
    } catch (error) {
      console.error("[UC] Stats fetch failed:", error)
    }
  }

  const loadGames = useCallback(async () => {
    try {
      const gamesData = await fetchGames()
      setGames(gamesData)
      if (gamesData.length > 0) {
        fetchGameStats()
      }
    } catch (error) {
      console.error("[UC] Search games load failed:", error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadGames()
  }, [loadGames])

  const refreshGames = async () => {
    setRefreshing(true)
    try {
      const gamesData = await fetchGames()
      setGames(gamesData)
    } catch (error) {
      console.error("[UC] Search games refresh failed:", error)
    } finally {
      setRefreshing(false)
    }
  }

  const filterOptions = useMemo(() => {
    const genreSet = new Set<string>()
    const developerSet = new Set<string>()

    games.forEach((game) => {
      if (Array.isArray(game.genres)) {
        game.genres.forEach((genre) => genreSet.add(genre))
      }
      if (game.developer) {
        developerSet.add(game.developer)
      }
    })

    return {
      allGenres: Array.from(genreSet).sort(),
      allDevelopers: Array.from(developerSet).sort(),
    }
  }, [games])

  const updateDraftFilter = useCallback((key: keyof Filters, value: Filters[keyof Filters]) => {
    setDraftFilters((prev) => ({ ...prev, [key]: value }))
  }, [])

  const toggleDraftGenre = useCallback((genre: string) => {
    setDraftFilters((prev) => ({
      ...prev,
      genres: prev.genres.includes(genre)
        ? prev.genres.filter((g) => g !== genre)
        : [...prev.genres, genre],
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

  const applyFilters = useCallback(async () => {
    setFiltering(true)
    setAppliedFilters({ ...draftFilters })
    if (draftFilters.searchTerm.trim()) {
      addSearchToHistory(draftFilters.searchTerm.trim())
    }
    const params = new URLSearchParams()
    if (draftFilters.searchTerm.trim()) params.set("q", draftFilters.searchTerm.trim())
    if (draftFilters.online) params.set("online", "1")
    if (draftFilters.nsfwOnly) params.set("nsfw", "1")
    navigate(params.toString() ? `/search?${params.toString()}` : "/search")
    window.setTimeout(() => setFiltering(false), 150)
  }, [draftFilters, navigate])

  const clearFilters = useCallback(() => {
    const cleared: Filters = {
      searchTerm: "",
      genres: [],
      developers: [],
      sizeRange: [0, 500],
      sortBy: "random",
      online: false,
      nsfwOnly: false,
    }
    setDraftFilters(cleared)
    setAppliedFilters(cleared)
    navigate("/search")
  }, [navigate])

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

  const filteredDevelopers = useMemo(() => {
    const q = developerQuery.trim().toLowerCase()
    if (!q) return filterOptions.allDevelopers
    return filterOptions.allDevelopers.filter((developer) => developer.toLowerCase().includes(q))
  }, [developerQuery, filterOptions.allDevelopers])
  const filteredGames = useMemo(() => {
    let filtered = [...games]
    const term = normalizeString(debouncedSearchTerm)

    if (term) {
      const parts = term.split(/\s+/).filter(Boolean)
      filtered = filtered.filter((game) => {
        const searchable = normalizeString(`${game.name} ${game.description} ${game.genres?.join(" ") || ""}`)
        return parts.every((part) => searchable.includes(part))
      })
    }

    if (appliedFilters.genres.length > 0) {
      filtered = filtered.filter((game) =>
        appliedFilters.genres.some((genre) => game.genres?.some((g) => g.toLowerCase() === genre.toLowerCase()))
      )
    }

    if (appliedFilters.developers.length > 0) {
      filtered = filtered.filter((game) => appliedFilters.developers.includes(game.developer || "Unknown"))
    }

    if (appliedFilters.sizeRange[0] > 0 || appliedFilters.sizeRange[1] < 500) {
      const minSizeBytes = appliedFilters.sizeRange[0] * 1024 * 1024 * 1024
      const maxSizeBytes = appliedFilters.sizeRange[1] * 1024 * 1024 * 1024
      filtered = filtered.filter((game) => {
        const sizeBytes = parseSize(game.size || "")
        return sizeBytes >= minSizeBytes && sizeBytes <= maxSizeBytes
      })
    }

    if (appliedFilters.online) {
      filtered = filtered.filter((game) => hasOnlineMode(game.source))
    }

    if (appliedFilters.nsfwOnly) {
      filtered = filtered.filter((game) =>
        game.genres?.some((genre) => genre.toLowerCase() === "nsfw")
      )
    }

    if (appliedFilters.sortBy !== "random") {
      filtered.sort((a, b) => {
        switch (appliedFilters.sortBy) {
          case "downloads-desc":
            return (gameStats[b.appid]?.downloads || 0) - (gameStats[a.appid]?.downloads || 0)
          case "downloads-asc":
            return (gameStats[a.appid]?.downloads || 0) - (gameStats[b.appid]?.downloads || 0)
          case "views-desc":
            return (gameStats[b.appid]?.views || 0) - (gameStats[a.appid]?.views || 0)
          case "views-asc":
            return (gameStats[a.appid]?.views || 0) - (gameStats[b.appid]?.views || 0)
          case "name":
            return a.name.localeCompare(b.name)
          case "date":
            return new Date(b.release_date).getTime() - new Date(a.release_date).getTime()
          case "updated":
            return new Date(b.update_time || 0).getTime() - new Date(a.update_time || 0).getTime()
          case "size":
            return parseSize(b.size || "") - parseSize(a.size || "")
          case "added":
            return (a.addedOrder || 0) - (b.addedOrder || 0)
          default:
            return 0
        }
      })
    } else if (filtered.length > 1) {
      filtered = filtered
        .map((game) => ({ game, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .map((item) => item.game)
    }

    return filtered
  }, [games, debouncedSearchTerm, appliedFilters, gameStats])

  const totalPages = Math.max(1, Math.ceil(filteredGames.length / itemsPerPage))
  const startItem = (currentPage - 1) * itemsPerPage + 1
  const endItem = Math.min(currentPage * itemsPerPage, filteredGames.length)
  const paginatedGames = filteredGames.slice(startItem - 1, endItem)
  const sortLabel = sortLabels[appliedFilters.sortBy] || sortLabels.random

  const removeAppliedSearch = () => {
    setAppliedFilters((prev) => ({ ...prev, searchTerm: "" }))
    setDraftFilters((prev) => ({ ...prev, searchTerm: "" }))
  }

  const removeAppliedSort = () => {
    setAppliedFilters((prev) => ({ ...prev, sortBy: "random" }))
    setDraftFilters((prev) => ({ ...prev, sortBy: "random" }))
  }

  const removeAppliedSizeRange = () => {
    setAppliedFilters((prev) => ({ ...prev, sizeRange: [0, 500] }))
    setDraftFilters((prev) => ({ ...prev, sizeRange: [0, 500] }))
  }

  const removeAppliedOnline = () => {
    setAppliedFilters((prev) => ({ ...prev, online: false }))
    setDraftFilters((prev) => ({ ...prev, online: false }))
  }

  const removeAppliedNsfwOnly = () => {
    setAppliedFilters((prev) => ({ ...prev, nsfwOnly: false }))
    setDraftFilters((prev) => ({ ...prev, nsfwOnly: false }))
  }

  const removeAppliedGenre = (genre: string) => {
    setAppliedFilters((prev) => ({ ...prev, genres: prev.genres.filter((g) => g !== genre) }))
    setDraftFilters((prev) => ({ ...prev, genres: prev.genres.filter((g) => g !== genre) }))
  }

  const removeAppliedDeveloper = (developer: string) => {
    setAppliedFilters((prev) => ({ ...prev, developers: prev.developers.filter((d) => d !== developer) }))
    setDraftFilters((prev) => ({ ...prev, developers: prev.developers.filter((d) => d !== developer) }))
  }

  return (
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
                            <p className="text-sm font-semibold text-foreground">Show online-fix games</p>
                            <p className="text-xs text-muted-foreground">Filters by games that support online mode.</p>
                          </div>
                          <Switch
                            checked={Boolean(draftFilters.online)}
                            onCheckedChange={(checked) => updateDraftFilter("online", Boolean(checked))}
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium">NSFW Only</label>
                        <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/40 px-4 py-3">
                          <div className="space-y-0.5">
                            <p className="text-sm font-semibold text-foreground">Show NSFW games</p>
                            <p className="text-xs text-muted-foreground">Only shows games tagged as NSFW.</p>
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
                            onValueChange={(value) => updateDraftFilter("sizeRange", value as [number, number])}
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

              <Button
                onClick={applyFilters}
                disabled={!hasUnappliedChanges || filtering}
                variant={hasUnappliedChanges ? "default" : "secondary"}
              >
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
                <SearchSuggestions
                  value={draftFilters.searchTerm}
                  onChange={(value) => updateDraftFilter("searchTerm", value)}
                  onSubmit={(e) => {
                    e.preventDefault()
                    applyFilters()
                  }}
                  placeholder="Search games..."
                  className="w-full"
                />
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
                    className="gap-2 text-xs sm:text-sm rounded-full border-border/60 bg-muted/40 px-3 py-1 shadow-sm"
                  >
                    <Flag className="h-3 w-3" />
                    Online
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 rounded-full hover:bg-foreground/10"
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
                    className="gap-2 text-xs sm:text-sm rounded-full border-border/60 bg-red-500/10 text-red-600 px-3 py-1 shadow-sm"
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

                {appliedFilters.genres.map((genre) => (
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
        {loading ? (
          <>
            <div className="mb-6">
              <div className="h-7 w-48 mb-3 rounded-lg bg-muted/40" />
              <div className="h-4 w-32 rounded-lg bg-muted/30" />
            </div>
            <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
              {Array.from({ length: itemsPerPage }).map((_, idx) => (
                <GameCardSkeleton key={idx} />
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="mb-4 sm:mb-6">
              <h2 className="text-lg sm:text-xl font-semibold text-foreground mb-2 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                Search Results ({filteredGames.length} games)
                {filteredGames.length > itemsPerPage && (
                  <span className="text-xs sm:text-sm text-muted-foreground font-normal">
                    Showing {startItem}-{endItem} of {filteredGames.length}
                  </span>
                )}
              </h2>
            </div>

            <div className="relative">
              {filtering && (
                <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-10 flex items-center justify-center rounded-lg">
                  <div className="flex items-center gap-3 bg-card p-4 rounded-lg shadow-lg">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
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
          </>
        )}
      </div>
    </div>
  )
}
