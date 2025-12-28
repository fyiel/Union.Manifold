"use client"

import type React from "react"

import { useState, useEffect, useRef, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { Search, Clock, Tag, Gamepad2, X, Lightbulb } from "lucide-react"
import Fuse from "fuse.js"
import { getRecentSearches, addSearchToHistory } from "@/lib/user-history"
import { formatNumber, triggerHapticFeedback, getSimilarSuggestions } from "@/lib/utils"
import { apiUrl } from "@/lib/api"

interface SearchSuggestionsProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (e: React.FormEvent) => void
  placeholder?: string
  className?: string
}

export function SearchSuggestions({
  value,
  onChange,
  onSubmit,
  placeholder = "Search for a game or genre...",
  className = "",
}: SearchSuggestionsProps) {
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const [games, setGames] = useState<any[]>([])
  const [gameStats, setGameStats] = useState<Record<string, { downloads: number; views: number }>>({})
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setRecentSearches(getRecentSearches(3))

    const loadData = async () => {
      try {
        const gamesResponse = await fetch(apiUrl("/api/games"))
        if (!gamesResponse.ok) {
          throw new Error(`API route failed: ${gamesResponse.status}`)
        }
        const gamesData = await gamesResponse.json()
        const processedGames = gamesData.map((game: any) => ({
          ...game,
          searchText: `${game.name} ${game.description} ${game.genres?.join(" ") || ""}`
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^\w\s]/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        }))
        setGames(processedGames)

        const response = await fetch(apiUrl("/api/downloads/all"))
        const stats = await response.json()
        if (stats && typeof stats === "object") {
          setGameStats(stats)
        }
      } catch (error) {
        console.error("Error loading data for suggestions:", error)
      }
    }

    loadData()
  }, [])

  const handleInputFocus = () => {
    setShowSuggestions(true)
  }

  const handleSuggestionClick = (suggestion: string) => {
    onChange(suggestion)
    setShowSuggestions(false)
    addSearchToHistory(suggestion)
    navigate(`/search?q=${encodeURIComponent(suggestion)}`)
  }

  const handleClearRecent = (searchToRemove: string) => {
    setRecentSearches((prev) => prev.filter((search) => search !== searchToRemove))
  }

  const suggestions = useMemo(() => {
    if (games.length === 0) return { allGenres: [], popularGames: [], matchingGames: [], didYouMean: [] }

    const genreCount: Record<string, number> = {}
    games.forEach((game) => {
      if (game.genres && Array.isArray(game.genres)) {
        game.genres.forEach((genre: string) => {
          const lowerGenre = genre.toLowerCase()
          genreCount[lowerGenre] = (genreCount[lowerGenre] || 0) + 1
        })
      }
    })

    const popularGames = games
      .map((game) => ({
        ...game,
        downloads: gameStats[game.appid]?.downloads || 0,
      }))
      .sort((a, b) => b.downloads - a.downloads)
      .slice(0, 4)

    let matchingGames: any[] = []
    let didYouMean: string[] = []

    if (value.trim()) {
      const searchTerm = value.trim()

      const fuseOptions = {
        keys: [
          { name: "name", weight: 0.7 },
          { name: "description", weight: 0.2 },
          { name: "genres", weight: 0.1 },
        ],
        threshold: 0.4,
        includeScore: true,
        shouldSort: true,
        minMatchCharLength: 2,
      }

      const fuse = new Fuse(games, fuseOptions)
      const fuseResults = fuse.search(searchTerm)

      matchingGames = fuseResults.slice(0, 6).map((result) => result.item)

      if (matchingGames.length === 0) {
        const allGameNames = games.map((game) => game.name)
        const allGenres = Object.keys(genreCount)
        const allSearchTerms = [...allGameNames, ...allGenres]

        didYouMean = getSimilarSuggestions(searchTerm, allSearchTerms, 2, 3)
      }
    }

    return {
      allGenres: Object.entries(genreCount).map(([genre, count]) => ({ genre, count })),
      popularGames,
      matchingGames,
      didYouMean,
    }
  }, [games, gameStats, value])

  const filteredGenres = suggestions.allGenres
    .filter((item) => !value.trim() || item.genre.toLowerCase().includes(value.toLowerCase()))
    .sort((a, b) => (value.trim() ? 0 : b.count - a.count))
    .slice(0, value.trim() ? 10 : 4)

  const shouldShowPopularGames = suggestions.popularGames.length > 0
  const shouldShowMatchingGames = value.trim() && suggestions.matchingGames.length > 0

  const hasAnySuggestions =
    shouldShowPopularGames || shouldShowMatchingGames || filteredGenres.length > 0 || recentSearches.length > 0

  return (
    <Popover open={showSuggestions}>
      <div className={`relative ${className}`}>
        <PopoverAnchor asChild>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              placeholder={placeholder}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onFocus={handleInputFocus}
              onMouseDown={() => setShowSuggestions(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onSubmit(e as any)
                }
                if (e.key === "Escape") {
                  setShowSuggestions(false)
                }
              }}
              className="pl-10 text-center"
            />
          </div>
        </PopoverAnchor>

        {showSuggestions && (
          <PopoverContent
            align="start"
            side="bottom"
            sideOffset={8}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onEscapeKeyDown={() => setShowSuggestions(false)}
            onInteractOutside={(e) => {
              const target = e.target as Node
              if (inputRef.current && inputRef.current.contains(target)) return
              setShowSuggestions(false)
            }}
            className="z-[1000] w-[var(--radix-popover-trigger-width)] max-h-80 overflow-y-auto rounded-3xl border-2 border-border/50 bg-card/95 p-0 backdrop-blur-sm shadow-xl"
          >
            {!hasAnySuggestions && !value.trim() && (
              <div className="p-4 text-sm text-muted-foreground text-center">
                Start typing to see suggestions.
              </div>
            )}

            {!hasAnySuggestions && value.trim() && (
              <div className="p-4 text-sm text-muted-foreground text-center">
                Searching suggestions...
              </div>
            )}

            {hasAnySuggestions && (
              <>
                {recentSearches.length > 0 && (
                <div className="p-3 border-b border-border/50">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-muted-foreground">Recent Searches</span>
                  </div>
                  <div className="space-y-1">
                    {recentSearches.map((search, index) => (
                      <div
                        key={`recent-${index}`}
                        className="flex items-center justify-between p-2 rounded-lg hover:bg-primary/10 cursor-pointer group transition-colors"
                        onClick={() => {
                          triggerHapticFeedback("light")
                          handleSuggestionClick(search)
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <Search className="h-3 w-3 text-muted-foreground" />
                          <span className="text-sm">{search}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleClearRecent(search)
                          }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {filteredGenres.length > 0 && (
                <div className="p-3 border-b border-border/50">
                  <div className="flex items-center gap-2 mb-2">
                    <Tag className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-muted-foreground">Genres</span>
                  </div>
                  <div className="space-y-1">
                    {filteredGenres.map((item, index) => (
                      <div
                        key={`genre-${index}`}
                        className="flex items-center gap-2 p-2 rounded-lg hover:bg-primary/10 cursor-pointer transition-colors"
                        onClick={() => {
                          triggerHapticFeedback("light")
                          handleSuggestionClick(item.genre)
                        }}
                      >
                        <Tag className="h-3 w-3 text-muted-foreground" />
                        <span className="text-sm capitalize">{item.genre}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {shouldShowMatchingGames && (
                <div className="p-3 border-b border-border/50">
                  <div className="flex items-center gap-2 mb-2">
                    <Search className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-muted-foreground">Matching Games</span>
                  </div>
                  <div className="space-y-1">
                    {suggestions.matchingGames.map((game) => (
                      <div
                        key={`match-${game.appid}`}
                        className="flex items-center gap-2 p-2 rounded-lg hover:bg-primary/10 cursor-pointer transition-colors"
                        onClick={() => {
                          triggerHapticFeedback("light")
                          setShowSuggestions(false)
                          navigate(`/game/${game.appid}`)
                        }}
                      >
                        <Gamepad2 className="h-3 w-3 text-muted-foreground" />
                        <span className="text-sm">{game.name}</span>
                        {gameStats[game.appid]?.downloads > 0 && (
                          <span className="text-xs text-muted-foreground ml-auto">
                            {formatNumber(gameStats[game.appid].downloads)} downloads
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {shouldShowPopularGames && (
                <div className="p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Gamepad2 className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-muted-foreground">Popular Games</span>
                  </div>
                  <div className="space-y-1">
                    {suggestions.popularGames.map((game) => (
                      <div
                        key={`popular-${game.appid}`}
                        className="flex items-center gap-2 p-2 rounded-lg hover:bg-primary/10 cursor-pointer transition-colors"
                        onClick={() => {
                          triggerHapticFeedback("light")
                          setShowSuggestions(false)
                          navigate(`/game/${game.appid}`)
                        }}
                      >
                        <Gamepad2 className="h-3 w-3 text-muted-foreground" />
                        <span className="text-sm">{game.name}</span>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {formatNumber(game.downloads)} downloads
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!shouldShowMatchingGames && !shouldShowPopularGames && filteredGenres.length === 0 && value && (
                <div className="p-3">
                  <div className="p-2 text-sm text-muted-foreground text-center">No suggestions found for "{value}"</div>
                  {suggestions.didYouMean.length > 0 && (
                    <div className="mt-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Lightbulb className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium text-muted-foreground">Did you mean?</span>
                      </div>
                      <div className="space-y-1">
                        {suggestions.didYouMean.map((suggestion, index) => (
                          <div
                            key={`didyoumean-${index}`}
                            className="flex items-center gap-2 p-2 rounded-lg hover:bg-primary/10 cursor-pointer transition-colors"
                            onClick={() => {
                              triggerHapticFeedback("light")
                              handleSuggestionClick(suggestion)
                            }}
                          >
                            <Search className="h-3 w-3 text-muted-foreground" />
                            <span className="text-sm">{suggestion}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              </>
            )}
          </PopoverContent>
        )}
      </div>
    </Popover>
  )
}




