import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Download, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiUrl } from '@/lib/api'
import { formatNumber, cn } from '@/lib/utils'

interface Game {
  appid: string
  name: string
  description: string
  genres: string[]
  image: string
  splash?: string
  release_date?: string
  size?: string
  source?: string
  version?: string
  update_time?: string
}

interface GameStats {
  downloads: number
  views: number
}

interface HeroSliderProps {
  games: Game[]
  gameStats?: Record<string, GameStats>
  loading?: boolean
}

type SliderHeroAsset = {
  heroUrl: string | null
  logoUrl: string | null
}

export function HeroSlider({ games, gameStats = {}, loading = false }: HeroSliderProps) {
  const navigate = useNavigate()
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [sgdbHeroesByAppid, setSgdbHeroesByAppid] = useState<Record<string, SliderHeroAsset>>({})
  const autoPlayRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchStartXRef = useRef<number | null>(null)

  const getHeroImage = useCallback((featuredGame: Game) => {
    const imageUrl = featuredGame.splash?.trim() || featuredGame.image
    return imageUrl
      .replace('/t_thumb/', '/t_original/')
      .replace('/t_cover_big_2x/', '/t_original/')
      .replace('/t_cover_big/', '/t_original/')
      .replace('/t_screenshot_med/', '/t_original/')
  }, [])

  const hasDedicatedHeroAsset = useCallback((game: Game) => {
    const splash = game.splash?.trim()
    if (!splash) return false
    const normalized = splash.toLowerCase()
    return !normalized.includes('t_cover_big') && !normalized.includes('t_thumb')
  }, [])

  const sliderGames = useMemo(() => {
    const isNsfw = (g: Game) =>
      Array.isArray(g.genres) && g.genres.some((genre) => genre?.toLowerCase() === 'nsfw')

    const sortedGames = [...games]
      .filter((g) => !isNsfw(g))
      .sort((a, b) => {
        const aStats = gameStats[a.appid] || { downloads: 0, views: 0 }
        const bStats = gameStats[b.appid] || { downloads: 0, views: 0 }
        if (bStats.downloads !== aStats.downloads) return bStats.downloads - aStats.downloads
        if (bStats.views !== aStats.views) return bStats.views - aStats.views
        return a.name.localeCompare(b.name)
      })

    const withDedicated = sortedGames.filter(hasDedicatedHeroAsset)
    const withoutDedicated = sortedGames.filter((g) => !hasDedicatedHeroAsset(g))

    return [...withDedicated, ...withoutDedicated].slice(0, 10)
  }, [games, gameStats, hasDedicatedHeroAsset])

  const total = sliderGames.length
  const game = sliderGames[currentIndex]

  // Fetch SteamGridDB heroes
  useEffect(() => {
    let cancelled = false
    const loadSteamGridHeroes = async () => {
      const appids = sliderGames.map((g) => g.appid)
      if (appids.length === 0) return
      const missing = appids.filter((appid) => !(appid in sgdbHeroesByAppid))
      if (missing.length === 0) return

      try {
        const params = new URLSearchParams()
        missing.forEach((appid) => params.append('appid', appid))
        const response = await fetch(apiUrl(`/api/steamgriddb/heroes?${params.toString()}`))
        if (!response.ok) return
        const data = await response.json()
        const updates: Record<string, SliderHeroAsset> = {}
        for (const appid of missing) {
          updates[appid] = {
            heroUrl: typeof data?.[appid]?.heroStatic?.url === 'string' ? data[appid].heroStatic.url : null,
            logoUrl: typeof data?.[appid]?.logoStatic?.url === 'string' ? data[appid].logoStatic.url : null,
          }
        }
        if (!cancelled) setSgdbHeroesByAppid((prev) => ({ ...prev, ...updates }))
      } catch {
        // Ignore lookup failures; fall back to IGDB splash art
      }
    }
    loadSteamGridHeroes()
    return () => { cancelled = true }
  }, [sliderGames, sgdbHeroesByAppid])

  const getSliderImageSrc = useCallback(
    (featuredGame: Game) => {
      const resolvedHero = sgdbHeroesByAppid[featuredGame.appid]
      if (resolvedHero === undefined) return null
      return resolvedHero.heroUrl || getHeroImage(featuredGame)
    },
    [getHeroImage, sgdbHeroesByAppid],
  )

  const getSliderLogoSrc = useCallback(
    (featuredGame: Game) => sgdbHeroesByAppid[featuredGame.appid]?.logoUrl || null,
    [sgdbHeroesByAppid],
  )

  const currentHeroSrc = game ? getSliderImageSrc(game) : null
  const currentLogoSrc = game ? getSliderLogoSrc(game) : null

  const goTo = useCallback(
    (index: number) => {
      if (isTransitioning || total === 0) return
      setIsTransitioning(true)
      setCurrentIndex(((index % total) + total) % total)
      setTimeout(() => setIsTransitioning(false), 500)
    },
    [isTransitioning, total],
  )

  const next = useCallback(() => goTo(currentIndex + 1), [currentIndex, goTo])
  const prev = useCallback(() => goTo(currentIndex - 1), [currentIndex, goTo])

  // Autoplay
  useEffect(() => {
    if (total === 0 || isPaused) return
    autoPlayRef.current = setTimeout(() => goTo(currentIndex + 1), 5000)
    return () => {
      if (autoPlayRef.current) clearTimeout(autoPlayRef.current)
    }
  }, [currentIndex, total, isPaused, goTo])

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prev, next])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX
  }, [])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartXRef.current === null) return
    const delta = e.changedTouches[0].clientX - touchStartXRef.current
    touchStartXRef.current = null
    if (Math.abs(delta) > 50) {
      if (delta > 0) prev()
      else next()
    }
  }, [prev, next])

  const currentStats = game ? gameStats[game.appid] : undefined
  const downloadCount = currentStats?.downloads ?? 0

  if (loading) {
    return (
      <div
        className="relative overflow-hidden rounded-3xl bg-zinc-900 udl-skeleton w-full"
        style={{ height: 480 }}
      />
    )
  }

  if (total === 0) return null

  return (
    <div
      className="relative overflow-hidden rounded-3xl w-full select-none"
      style={{ height: 480 }}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Background hero image */}
      {currentHeroSrc ? (
        <img
          key={`hero-${game.appid}-${currentIndex}`}
          src={currentHeroSrc}
          alt={game.name}
          className={cn(
            'absolute inset-0 h-full w-full object-cover transition-opacity duration-500',
            isTransitioning ? 'opacity-0' : 'opacity-100',
          )}
          draggable={false}
        />
      ) : (
        <div className="absolute inset-0 bg-zinc-900" />
      )}

      {/* Gradient overlays */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-transparent" />

      {/* Content */}
      <div className="absolute inset-0 flex flex-col justify-end p-6 sm:p-8 xl:p-10">
        <div
          className={cn(
            'max-w-xl space-y-4 transition-all duration-500',
            isTransitioning ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0',
          )}
        >
          {/* Game logo or title */}
          {currentLogoSrc ? (
            <img
              src={currentLogoSrc}
              alt={`${game.name} logo`}
              className="max-h-[72px] w-auto max-w-[260px] object-contain drop-shadow-2xl"
              draggable={false}
            />
          ) : (
            <h2 className="text-3xl font-bold tracking-tight text-white drop-shadow-lg sm:text-4xl">
              {game.name}
            </h2>
          )}

          {/* Genres + download count */}
          <div className="flex flex-wrap items-center gap-2">
            {(game.genres || [])
              .filter((g) => g?.toLowerCase() !== 'nsfw')
              .slice(0, 3)
              .map((genre) => (
                <span
                  key={genre}
                  className="rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm"
                >
                  {genre}
                </span>
              ))}
            {downloadCount > 0 && (
              <span className="flex items-center gap-1 rounded-full border border-white/10 bg-black/40 px-2.5 py-1 text-[11px] font-medium text-zinc-300 backdrop-blur-sm">
                <Download className="h-3 w-3 opacity-60" />
                {formatNumber(downloadCount)}
              </span>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button
              size="lg"
              className="h-10 rounded-full bg-white px-5 text-sm font-semibold text-black hover:-translate-y-0.5 hover:bg-zinc-200 active:scale-95"
              onClick={() => navigate(`/game/${game.appid}`)}
            >
              <Info className="mr-1.5 h-4 w-4" />
              View Game
            </Button>
          </div>
        </div>

        {/* Navigation bar: prev + dots + next */}
        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={prev}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur-sm transition hover:bg-black/70 active:scale-95"
            aria-label="Previous game"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <div className="flex flex-1 items-center gap-1.5">
            {sliderGames.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Slide ${i + 1}`}
                className={cn(
                  'h-1 rounded-full transition-all duration-300',
                  i === currentIndex
                    ? 'w-8 bg-white'
                    : 'w-1.5 bg-white/30 hover:bg-white/50',
                )}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={next}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur-sm transition hover:bg-black/70 active:scale-95"
            aria-label="Next game"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
