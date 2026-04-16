"use client"

import type React from "react"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Search, ChevronRight, ArrowRight, X, Trash2 } from "lucide-react"
import { useDebounce } from "@/hooks/use-debounce"
import { addSearchToHistory, getRecentSearches, clearSearchHistory } from "@/lib/user-history"
import { formatNumber, triggerHapticFeedback, proxyImageUrl } from "@/lib/utils"
import { apiFetch } from "@/lib/api"

interface SearchSuggestionsProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (e: React.FormEvent) => void
  placeholder?: string
  className?: string
  inputId?: string
  highlight?: boolean
  showFiltersButton?: boolean
  popup?: boolean
  enableShortcut?: boolean
  showShortcutHint?: boolean
  openEventName?: string
  hideInputWhenClosed?: boolean
  closeOnSubmit?: boolean
}

export function SearchSuggestions({
  value,
  onChange,
  onSubmit,
  placeholder = "Search for a game, genre or IGDB ID...",
  className = "",
  inputId,
  highlight = false,
  showFiltersButton = true,
  popup = false,
  enableShortcut = false,
  showShortcutHint = enableShortcut,
  openEventName,
  hideInputWhenClosed = false,
  closeOnSubmit = false,
}: SearchSuggestionsProps) {
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [results, setResults] = useState<any[]>([])
  const [didYouMeanResults, setDidYouMeanResults] = useState<any[]>([])
  const [resultsTotal, setResultsTotal] = useState<number>(0)
  const [popularGames, setPopularGames] = useState<any[]>([])
  const [recentlyAddedGames, setRecentlyAddedGames] = useState<any[]>([])
  const [trendingGames, setTrendingGames] = useState<any[]>([])
  const [browseLoading, setBrowseLoading] = useState(false)
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const [showNsfw, setShowNsfw] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [searchScope, setSearchScope] = useState<"all" | "title" | "developer" | "genres">("title")
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const resultsListId = useId()

  const debouncedValue = useDebounce(value, 300)

  const shortcutLabel = useMemo(() => {
    if (typeof navigator === "undefined") return "Ctrl+K"
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform)
    return isMac ? "Cmd+K" : "Ctrl+K"
  }, [])

  useEffect(() => {
    async function search() {
      if (!debouncedValue || debouncedValue.length < 2) {
        setResults([])
        setDidYouMeanResults([])
        setResultsTotal(0)
        return
      }
      try {
        // Always include NSFW titles in suggestions; UI will blur/reveal based on preference.
        const res = await apiFetch(
          `/api/games/suggestions?q=${encodeURIComponent(debouncedValue)}&limit=20&scope=${encodeURIComponent(searchScope)}&nsfw=true`,
        )
        if (!res.ok) return
        const data = await res.json()
        const items = Array.isArray(data?.items) ? data.items : []
        const didYouMean = Array.isArray(data?.didYouMean) ? data.didYouMean : []
        setResults(items)
        setDidYouMeanResults(didYouMean)
        setResultsTotal(Number(data?.total) || items.length)
      } catch (e) {
        console.error(e)
      }
    }
    search()
  }, [debouncedValue, searchScope, showNsfw])

  useEffect(() => {
    if (!showSuggestions) return
    if (value.trim().length > 0) return

    let ignore = false
    const loadBrowseLists = async () => {
      if (browseLoading) return
      setBrowseLoading(true)
      try {
        const res = await apiFetch(`/api/games/browse?limit=6&nsfw=true`)
        if (!res.ok) return
        const data = await res.json()
        if (ignore) return
        setPopularGames(Array.isArray(data?.popular) ? data.popular : [])
        setRecentlyAddedGames(Array.isArray(data?.recentlyAdded) ? data.recentlyAdded : [])
        setTrendingGames(Array.isArray(data?.trending) ? data.trending : [])
      } catch {
        // ignore browse list failures
      } finally {
        if (!ignore) setBrowseLoading(false)
      }
    }

    loadBrowseLists()

    return () => {
      ignore = true
    }
  }, [showSuggestions, value, showNsfw])

  useEffect(() => {
    const nsfwPreferenceKey = "uc_show_nsfw"
    const syncPreference = () => {
      try {
        setShowNsfw(localStorage.getItem(nsfwPreferenceKey) === "1")
      } catch {
        setShowNsfw(false)
      }
    }

    syncPreference()

    const onStorage = (event: StorageEvent) => {
      if (event.key === nsfwPreferenceKey) syncPreference()
    }
    const onPreferenceChange = () => syncPreference()

    window.addEventListener("storage", onStorage)
    window.addEventListener("uc_nsfw_pref", onPreferenceChange)

    return () => {
      window.removeEventListener("storage", onStorage)
      window.removeEventListener("uc_nsfw_pref", onPreferenceChange)
    }
  }, [])

  useEffect(() => {
    const loadSearchHistory = async () => {
      try {
        const response = await apiFetch("/api/search-history")
        if (response.ok) {
          const data = await response.json()
          const items = Array.isArray(data?.items) ? data.items : []
          setRecentSearches(items.map((item: any) => String(item.term || item).trim()).filter(Boolean))
          return
        }
      } catch {
        // ignore and fallback to local
      }
      setRecentSearches(getRecentSearches(6))
    }

    loadSearchHistory()
  }, [])

  useEffect(() => {
    if (!showSuggestions || popup) return
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [showSuggestions, popup])

  // Lock body scroll and capture wheel events when popup is open
  const overlayRef = useRef<HTMLDivElement>(null)
  const popupContentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!popup || !showSuggestions) return
    const originalOverflow = document.body.style.overflow
    const originalPaddingRight = document.body.style.paddingRight
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    
    document.body.style.overflow = "hidden"
    document.body.style.paddingRight = `${scrollbarWidth}px`

    // Block wheel events on the backdrop only — allow them inside the popup card for scrolling
    const el = overlayRef.current
    const blockWheel = (e: WheelEvent) => {
      if (popupContentRef.current && popupContentRef.current.contains(e.target as Node)) return
      e.preventDefault()
      e.stopPropagation()
    }
    if (el) el.addEventListener("wheel", blockWheel, { passive: false })
    
    return () => {
      document.body.style.overflow = originalOverflow
      document.body.style.paddingRight = originalPaddingRight
      if (el) el.removeEventListener("wheel", blockWheel)
    }
  }, [popup, showSuggestions])

  useEffect(() => {
    if (!enableShortcut) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.key || event.defaultPrevented) return
      const isShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k"
      if (!isShortcut) return
      event.preventDefault()
      setShowSuggestions(true)
      window.setTimeout(() => inputRef.current?.focus(), 0)
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [enableShortcut])

  useEffect(() => {
    if (!openEventName) return
    const onOpen = () => {
      setShowSuggestions(true)
      window.setTimeout(() => inputRef.current?.focus(), 0)
    }

    window.addEventListener(openEventName, onOpen as EventListener)
    return () => window.removeEventListener(openEventName, onOpen as EventListener)
  }, [openEventName])

  const handleInputFocus = () => {
    setShowSuggestions(true)
  }

  const handleSuggestionClick = (suggestion: string) => {
    onChange(suggestion)
    setShowSuggestions(false)
    saveSearchTerm(suggestion)
    navigate(`/search?q=${encodeURIComponent(suggestion)}`)
  }

  const trimmedValue = value.trim()
  const isQueryTooShort = trimmedValue.length > 0 && trimmedValue.length < 2
  const filtersHref = trimmedValue ? `/search?q=${encodeURIComponent(trimmedValue)}` : "/search"

  const saveSearchTerm = async (term: string) => {
    const normalized = term.trim()
    if (!normalized) return
    addSearchToHistory(normalized)
    setRecentSearches((prev) => {
      const filtered = prev.filter((item) => item.toLowerCase() !== normalized.toLowerCase())
      return [normalized, ...filtered].slice(0, 6)
    })
    try {
      await apiFetch("/api/search-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term: normalized }),
      })
    } catch {
      // ignore remote save failures
    }
  }

  const showPanel = showSuggestions

  const hasResults = results.length > 0
  const searchResults = { items: results, total: resultsTotal || results.length }

  useEffect(() => {
    if (showPanel && popup) {
      window.setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [showPanel, popup])

  useEffect(() => {
    setActiveIndex(-1)
  }, [trimmedValue, showPanel, searchScope])

  const browseItems = useMemo(() => {
    if (trimmedValue.length > 0) return []
    const recentItems = recentSearches.map((term) => ({
      key: `recent-${term.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}`,
      type: "recent" as const,
      term,
    }))
    const trendingItems = trendingGames.map((game) => ({
      key: `trending-${game.appid}`,
      type: "game" as const,
      game,
    }))
    const popularItems = popularGames.map((game) => ({
      key: `popular-${game.appid}`,
      type: "game" as const,
      game,
    }))
    const recentAddedItems = recentlyAddedGames.map((game) => ({
      key: `recently-added-${game.appid}`,
      type: "game" as const,
      game,
    }))
    return [...recentItems, ...trendingItems, ...popularItems, ...recentAddedItems]
  }, [trimmedValue.length, recentSearches, trendingGames, popularGames, recentlyAddedGames])

  const activeItems = useMemo(() => {
    if (!isQueryTooShort && trimmedValue.length >= 2) {
      if (hasResults) {
        return results.map((game) => ({
          key: `result-${game.appid}`,
          type: "game" as const,
          game,
        }))
      }
      if (didYouMeanResults.length > 0) {
        return didYouMeanResults.map((game) => ({
          key: `didyoumean-${game.appid}`,
          type: "game" as const,
          game,
        }))
      }
    }
    return browseItems
  }, [browseItems, didYouMeanResults, results, hasResults, isQueryTooShort, trimmedValue.length])

  const activeItemKey = activeItems[activeIndex]?.key
  const activeItemId = activeItemKey ? `search-suggestion-${activeItemKey}` : undefined

  const renderInput = () => (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
      <Input
        id={inputId}
        ref={inputRef}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={handleInputFocus}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && activeItems.length > 0) {
            e.preventDefault()
            setShowSuggestions(true)
            setActiveIndex((prev) => Math.min(prev + 1, activeItems.length - 1))
            return
          }
          if (e.key === "ArrowUp" && activeItems.length > 0) {
            e.preventDefault()
            setActiveIndex((prev) => (prev <= 0 ? -1 : prev - 1))
            return
          }
          if (e.key === "Enter" && activeIndex >= 0 && activeItems.length > 0) {
            e.preventDefault()
            const activeItem = activeItems[activeIndex]
            if (activeItem?.type === "game" && activeItem.game) {
              triggerHapticFeedback("light")
              setShowSuggestions(false)
              navigate(`/game/${activeItem.game.appid}`)
            } else if (activeItem?.type === "recent" && activeItem.term) {
              triggerHapticFeedback("light")
              handleSuggestionClick(activeItem.term)
            }
            return
          }
          if (e.key === "Enter") {
            if (value.trim()) {
              saveSearchTerm(value.trim())
            }
            onSubmit(e as any)
            if (closeOnSubmit) {
              setShowSuggestions(false)
            }
          }
          if (e.key === "Escape") {
            setShowSuggestions(false)
          }
        }}
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={hasResults || didYouMeanResults.length > 0 ? resultsListId : undefined}
        aria-activedescendant={activeIndex >= 0 ? activeItemId : undefined}
        className={`h-11 pl-11 pr-16 text-left rounded-full border border-white/[.07] bg-zinc-900/70 text-zinc-200 placeholder:text-zinc-500 shadow-none focus-visible:ring-0 focus-visible:border-white focus-visible:bg-zinc-900/90 transition-all duration-200 ${
          highlight ? "ring-2 ring-zinc-500 shadow-lg shadow-white/5" : ""
        } ${className}`}
      />
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-2">
        {showShortcutHint && !value.trim() && (
          <span className="hidden rounded-md border border-white/[.07] bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-zinc-500 sm:inline">
            {shortcutLabel}
          </span>
        )}
        {value.trim() && (
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Clear search"
            onClick={() => {
              onChange("")
              setActiveIndex(-1)
              inputRef.current?.focus()
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )

  const renderResults = () => (
    <>
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[.07] text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
        <span>Results</span>
        <div className="flex items-center gap-3">
          {!isQueryTooShort && trimmedValue.length >= 2 && <span>{searchResults.total}</span>}
          {showShortcutHint && (
            <span className="hidden rounded-md border border-white/[.07] bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-zinc-500 sm:inline">
              {shortcutLabel}
            </span>
          )}
        </div>
      </div>
      <div className="sr-only" aria-live="polite">
        {isQueryTooShort
          ? "Search term too short."
          : trimmedValue.length >= 2
            ? `${searchResults.total} results.`
            : "Browse search suggestions."}
      </div>

      {!isQueryTooShort && trimmedValue.length >= 2 && (
        <div className="px-4 pt-3 pb-2">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Search in</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {[
              { value: "all", label: "All" },
              { value: "title", label: "Titles" },
              { value: "developer", label: "Developers" },
              { value: "genres", label: "Genres" },
            ].map((scope) => (
              <button
                key={scope.value}
                type="button"
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  searchScope === scope.value
                    ? "border-white/[.07] bg-white text-black"
                    : "border-white/[.07] bg-zinc-800/50 text-zinc-400 hover:text-zinc-200"
                }`}
                onClick={() => setSearchScope(scope.value as typeof searchScope)}
              >
                {scope.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {trimmedValue.length === 0 && (
        <div className="px-4 py-5 text-sm text-zinc-500">
          Start typing to search by title, dev, or IGDB ID.
        </div>
      )}

      {isQueryTooShort && (
        <div className="px-4 py-5 text-sm text-zinc-500">Please enter at least 2 characters.</div>
      )}

      {!isQueryTooShort && trimmedValue.length >= 2 && hasResults && (
        <div className="p-2" role="listbox" id={resultsListId}>
          {searchResults.items.map((game) => (
            <button
              key={game.appid}
              type="button"
              className={`group w-full flex items-center gap-4 rounded-2xl px-3 py-2.5 text-left transition-all duration-300 ease-out hover:bg-zinc-800/50 border border-transparent active:scale-[0.98] ${
                activeItemKey === `result-${game.appid}` ? "bg-zinc-800/50 border-white/[.07]" : ""
              }`}
              id={`search-suggestion-result-${game.appid}`}
              role="option"
              aria-selected={activeItemKey === `result-${game.appid}`}
              onClick={() => {
                triggerHapticFeedback("light")
                setShowSuggestions(false)
                navigate(`/game/${game.appid}`)
              }}
              onMouseEnter={() =>
                setActiveIndex(activeItems.findIndex((item) => item.key === `result-${game.appid}`))
              }
            >
              <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-xl bg-zinc-800">
                {game.image ? (
                  <img
                    src={proxyImageUrl(game.image)}
                    alt={game.name}
                    className={`h-full w-full object-cover ${
                      Array.isArray(game.genres) && game.genres.some((g: string) => g.toLowerCase() === "nsfw")
                        ? showNsfw ? "blur-sm group-hover:blur-none" : "blur-sm"
                        : ""
                    }`}
                  />
                ) : (
                  <div className="h-full w-full bg-zinc-800" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-zinc-200 line-clamp-1">{game.name}</div>
                {game.description && (
                  <div className="text-xs text-zinc-500 line-clamp-2">{game.description}</div>
                )}
                {!game.description && game.developer && (
                  <div className="text-xs text-zinc-500 line-clamp-1">by {game.developer}</div>
                )}
              </div>
              <ChevronRight className="h-4 w-4 text-zinc-500 transition-transform duration-300 ease-out group-hover:translate-x-1.5" />
            </button>
          ))}
        </div>
      )}

      {!isQueryTooShort && trimmedValue.length >= 2 && !hasResults && didYouMeanResults.length === 0 && (
        <div className="px-4 py-6 text-sm text-zinc-500">No results found.</div>
      )}

      {!isQueryTooShort && trimmedValue.length >= 2 && !hasResults && didYouMeanResults.length > 0 && (
        <div className="p-2" role="listbox" id={resultsListId}>
          <div className="px-2 pt-2 text-xs uppercase tracking-wide text-zinc-500">Did you mean</div>
          {didYouMeanResults.map((game) => (
            <button
              key={`didyoumean-${game.appid}`}
              type="button"
              className={`group w-full flex items-center gap-3 rounded-2xl px-2 py-2 text-left transition-all duration-300 ease-out hover:bg-zinc-800/50 active:scale-[0.98] ${
                activeItemKey === `didyoumean-${game.appid}` ? "bg-zinc-800/50" : ""
              }`}
              id={`search-suggestion-didyoumean-${game.appid}`}
              role="option"
              aria-selected={activeItemKey === `didyoumean-${game.appid}`}
              onClick={() => {
                triggerHapticFeedback("light")
                setShowSuggestions(false)
                navigate(`/game/${game.appid}`)
              }}
              onMouseEnter={() =>
                setActiveIndex(activeItems.findIndex((item) => item.key === `didyoumean-${game.appid}`))
              }
            >
              <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-xl bg-zinc-800">
                {game.image ? (
                  <img
                    src={proxyImageUrl(game.image)}
                    alt={game.name}
                    className={`h-full w-full object-cover ${
                      Array.isArray(game.genres) && game.genres.some((g: string) => g.toLowerCase() === "nsfw")
                        ? showNsfw ? "blur-sm group-hover:blur-none" : "blur-sm"
                        : ""
                    }`}
                  />
                ) : (
                  <div className="h-full w-full bg-zinc-800" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-zinc-200 line-clamp-1">{game.name}</div>
                {game.developer && (
                  <div className="text-xs text-zinc-500 line-clamp-1">by {game.developer}</div>
                )}
              </div>
              <ChevronRight className="h-4 w-4 text-zinc-500 transition-transform duration-300 ease-out group-hover:translate-x-1.5" />
            </button>
          ))}
        </div>
      )}

      {!isQueryTooShort && trimmedValue.length >= 2 && (
        <button
          type="button"
          className="group w-full flex items-center justify-center gap-2 border-t border-white/[.07] px-4 py-3 text-sm font-medium text-zinc-200 hover:bg-white/[.03] transition-colors duration-300 ease-out active:scale-[0.98]"
          onClick={() => {
            triggerHapticFeedback("light")
            handleSuggestionClick(trimmedValue)
          }}
        >
          View all results
          <ArrowRight className="h-4 w-4 transition-transform duration-300 ease-out group-hover:translate-x-1.5" />
        </button>
      )}

      {trimmedValue.length === 0 && recentSearches.length > 0 && (
        <div className="border-t border-white/[.07] p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Recent searches</div>
            <button
              type="button"
              onClick={async () => {
                clearSearchHistory()
                setRecentSearches([])
                triggerHapticFeedback("light")
                try {
                  await apiFetch("/api/search-history", { method: "DELETE" })
                } catch {
                  // ignore
                }
              }}
              className="text-xs text-zinc-500 hover:text-red-500 transition-colors flex items-center gap-1"
              title="Clear search history"
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {recentSearches.map((term) => (
              <button
                key={`recent-${term}`}
                type="button"
                className={`rounded-full border border-white/[.07] bg-zinc-800/50 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors duration-200 ease-out hover:bg-zinc-700/50 hover:text-zinc-200 active:scale-95 ${
                  activeItemKey === `recent-${term.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}`
                    ? "border-white/20 bg-zinc-700/50 text-zinc-200"
                    : ""
                }`}
                id={`search-suggestion-recent-${term.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}`}
                role="option"
                aria-selected={
                  activeItemKey === `recent-${term.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}`
                }
                onClick={() => {
                  triggerHapticFeedback("light")
                  handleSuggestionClick(term)
                }}
                onMouseEnter={() =>
                  setActiveIndex(
                    activeItems.findIndex(
                      (item) =>
                        item.key === `recent-${term.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}`
                    )
                  )
                }
              >
                {term}
              </button>
            ))}
          </div>
        </div>
      )}

      {trimmedValue.length === 0 && (browseLoading || trendingGames.length > 0) && (
        <div className="border-t border-white/[.07] p-3">
          <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Trending (24h)</div>
          {browseLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-2 py-2">
                  <Skeleton className="h-10 w-10 rounded-xl flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <Skeleton className="h-4 w-32 mb-1" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {trendingGames.map((game) => (
                <button
                  key={`trending-${game.appid}`}
                  type="button"
                  className={`group w-full flex items-center gap-3 rounded-2xl px-2 py-2 text-left transition-all duration-300 ease-out hover:bg-zinc-800/50 active:scale-[0.98] ${
                    activeItemKey === `trending-${game.appid}` ? "bg-zinc-800/50" : ""
                  }`}
                  id={`search-suggestion-trending-${game.appid}`}
                  role="option"
                  aria-selected={activeItemKey === `trending-${game.appid}`}
                  onClick={() => {
                    triggerHapticFeedback("light")
                    setShowSuggestions(false)
                    navigate(`/game/${game.appid}`)
                  }}
                  onMouseEnter={() =>
                    setActiveIndex(activeItems.findIndex((item) => item.key === `trending-${game.appid}`))
                  }
                >
                  <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-xl bg-zinc-800">
                    {game.image ? (
                      <img
                        src={proxyImageUrl(game.image)}
                        alt={game.name}
                        className={`h-full w-full object-cover ${
                          Array.isArray(game.genres) && game.genres.some((g: string) => g.toLowerCase() === "nsfw")
                            ? showNsfw ? "blur-sm group-hover:blur-none" : "blur-sm"
                            : ""
                        }`}
                      />
                    ) : (
                      <div className="h-full w-full bg-zinc-800" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-zinc-200 line-clamp-1">{game.name}</div>
                    <div className="text-xs text-zinc-500">{formatNumber(game.downloads)} downloads</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-zinc-500 transition-transform duration-300 ease-out group-hover:translate-x-1.5" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {trimmedValue.length === 0 && (browseLoading || popularGames.length > 0) && (
        <div className="border-t border-white/[.07] p-3">
          <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Popular games</div>
          {browseLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-2 py-2">
                  <Skeleton className="h-10 w-10 rounded-xl flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <Skeleton className="h-4 w-32 mb-1" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {popularGames.map((game) => (
                <button
                  key={`popular-${game.appid}`}
                  type="button"
                  className={`group w-full flex items-center gap-3 rounded-2xl px-2 py-2 text-left transition-all duration-300 ease-out hover:bg-zinc-800/50 active:scale-[0.98] ${
                    activeItemKey === `popular-${game.appid}` ? "bg-zinc-800/50" : ""
                  }`}
                  id={`search-suggestion-popular-${game.appid}`}
                  role="option"
                  aria-selected={activeItemKey === `popular-${game.appid}`}
                  onClick={() => {
                    triggerHapticFeedback("light")
                    setShowSuggestions(false)
                    navigate(`/game/${game.appid}`)
                  }}
                  onMouseEnter={() =>
                    setActiveIndex(activeItems.findIndex((item) => item.key === `popular-${game.appid}`))
                  }
                >
                  <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-xl bg-zinc-800">
                    {game.image ? (
                      <img
                        src={proxyImageUrl(game.image)}
                        alt={game.name}
                        className={`h-full w-full object-cover ${
                          Array.isArray(game.genres) && game.genres.some((g: string) => g.toLowerCase() === "nsfw")
                            ? showNsfw ? "blur-sm group-hover:blur-none" : "blur-sm"
                            : ""
                        }`}
                      />
                    ) : (
                      <div className="h-full w-full bg-zinc-800" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-zinc-200 line-clamp-1">{game.name}</div>
                    <div className="text-xs text-zinc-500">{formatNumber(game.downloads)} downloads</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-zinc-500 transition-transform duration-300 ease-out group-hover:translate-x-1.5" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {trimmedValue.length === 0 && (browseLoading || recentlyAddedGames.length > 0) && (
        <div className="border-t border-white/[.07] p-3">
          <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Recently added</div>
          {browseLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-2 py-2">
                  <Skeleton className="h-10 w-10 rounded-xl flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <Skeleton className="h-4 w-32 mb-1" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {recentlyAddedGames.map((game) => (
                <button
                  key={`recently-added-${game.appid}`}
                  type="button"
                  className={`group w-full flex items-center gap-3 rounded-2xl px-2 py-2 text-left transition-all duration-300 ease-out hover:bg-zinc-800/50 active:scale-[0.98] ${
                    activeItemKey === `recently-added-${game.appid}` ? "bg-zinc-800/50" : ""
                  }`}
                  id={`search-suggestion-recently-added-${game.appid}`}
                  role="option"
                  aria-selected={activeItemKey === `recently-added-${game.appid}`}
                  onClick={() => {
                    triggerHapticFeedback("light")
                    setShowSuggestions(false)
                    navigate(`/game/${game.appid}`)
                  }}
                  onMouseEnter={() =>
                    setActiveIndex(
                      activeItems.findIndex((item) => item.key === `recently-added-${game.appid}`)
                    )
                  }
                >
                  <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-xl bg-zinc-800">
                    {game.image ? (
                      <img
                        src={proxyImageUrl(game.image)}
                        alt={game.name}
                        className={`h-full w-full object-cover ${
                          Array.isArray(game.genres) && game.genres.some((g: string) => g.toLowerCase() === "nsfw")
                            ? showNsfw ? "blur-sm group-hover:blur-none" : "blur-sm"
                            : ""
                        }`}
                      />
                    ) : (
                      <div className="h-full w-full bg-zinc-800" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-zinc-200 line-clamp-1">{game.name}</div>
                    {game.update_time && (
                      <div className="text-xs text-zinc-500">
                        Updated {new Date(game.update_time).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 text-zinc-500 transition-transform duration-300 ease-out group-hover:translate-x-1.5" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {popup && showPanel ? (!hideInputWhenClosed ? <div className="h-9" /> : null) : hideInputWhenClosed ? null : renderInput()}

      {popup && showPanel && (
        <div
          ref={overlayRef}
          className="pointer-events-auto fixed inset-0 z-[90] bg-zinc-950/60 backdrop-blur-sm animate-in fade-in duration-300 ease-out"
          onClick={() => setShowSuggestions(false)}
        >
          <div className="mx-auto w-full max-w-2xl px-4 pt-24" onClick={(e) => e.stopPropagation()}>
            <div className="overflow-hidden rounded-[2.5rem] border border-white/[.07] bg-zinc-950/90 shadow-[0_32px_64px_-12px_rgba(0,0,0,0.5)] backdrop-blur-3xl animate-in fade-in slide-in-from-bottom-8 duration-500 ease-out">
              <div className="flex items-center gap-3 px-6 py-5 border-b border-white/[.07]">
                <div className="flex-1">{renderInput()}</div>
                {showFiltersButton && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      triggerHapticFeedback("light")
                      setShowSuggestions(false)
                      if (trimmedValue.length >= 2) {
                        saveSearchTerm(trimmedValue)
                      }
                      navigate(filtersHref)
                    }}
                  >
                    Filters
                  </Button>
                )}
              </div>
              <ScrollArea ref={popupContentRef} className="w-full" viewportClassName="max-h-[360px]">{renderResults()}</ScrollArea>
            </div>
          </div>
        </div>
      )}

      {!popup && showPanel && (
        <div className="absolute left-0 right-0 top-[calc(100%+16px)] z-[60] max-h-[480px] overflow-y-auto rounded-[2rem] border border-white/[.07] bg-zinc-950/90 p-0 backdrop-blur-2xl shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300 ease-out">
          {renderResults()}
        </div>
      )}
    </div>
  )
}
