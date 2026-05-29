import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Download, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiUrl } from '@/lib/api'
import { cn, proxyImageUrl } from '@/lib/utils'
import { useMotionPreferences } from '@/hooks/use-motion-preferences'

type SliderHeroAsset = {
  heroUrl: string | null
  logoUrl: string | null
}

interface Game {
  appid: string
  name: string
  description: string
  genres: string[]
  image: string
  splash?: string
  hero_image?: string
  hero_logo?: string
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

export function HeroSlider({ games, gameStats = {}, loading = false }: HeroSliderProps) {
  const navigate = useNavigate()
  const { reducedMotionEffective } = useMotionPreferences()
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  // Pause auto-rotate while the window is in the background. Otherwise the
  // 5-second timer keeps ticking and the user comes back to a slide they
  // never saw, plus we waste CPU running transitions no one is watching.
  const [pageHidden, setPageHidden] = useState<boolean>(() =>
    typeof document !== "undefined" && document.visibilityState === "hidden"
  )
  const [failedLogoByAppid, setFailedLogoByAppid] = useState<Record<string, true>>({})
  const [sgdbHeroesByAppid, setSgdbHeroesByAppid] = useState<Record<string, SliderHeroAsset>>({})
  const autoPlayRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchStartXRef = useRef<number | null>(null)

  useEffect(() => {
    if (typeof document === "undefined") return
    const onVisibility = () => setPageHidden(document.visibilityState === "hidden")
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [])

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

  useEffect(() => {
    let cancelled = false
    const load = async () => {
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
        // ignore
      }
    }
    load()
    return () => { cancelled = true }
  }, [sliderGames, sgdbHeroesByAppid])

  const getSliderImageSrc = useCallback(
    (featuredGame: Game) => {
      const resolved = sgdbHeroesByAppid[featuredGame.appid]
      if (resolved === undefined) return null
      return resolved.heroUrl || getHeroImage(featuredGame)
    },
    [getHeroImage, sgdbHeroesByAppid],
  )

  const getSliderLogoSrc = useCallback(
    (featuredGame: Game) => sgdbHeroesByAppid[featuredGame.appid]?.logoUrl || featuredGame.hero_logo || null,
    [sgdbHeroesByAppid],
  )

  const currentHeroSrc = game ? getSliderImageSrc(game) : null
  const currentLogoSrc = game && !failedLogoByAppid[game.appid] ? getSliderLogoSrc(game) : null

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

  useEffect(() => {
    if (total === 0) {
      setCurrentIndex(0)
      return
    }
    if (currentIndex >= total) setCurrentIndex(0)
  }, [currentIndex, total])

  useEffect(() => {
    if (total === 0) return
    const preloadIndexes = [
      currentIndex,
      (currentIndex + 1) % total,
      (currentIndex - 1 + total) % total,
    ]
    preloadIndexes.forEach((index) => {
      const slide = sliderGames[index]
      if (!slide) return
      const source = getSliderImageSrc(slide)
      if (!source) return
      const image = new window.Image()
      image.decoding = 'async'
      image.src = proxyImageUrl(source)
    })
  }, [currentIndex, total, sliderGames, getSliderImageSrc])

  useEffect(() => {
    // Auto-advance only when the slider is actually visible AND the user
    // hasn't asked for reduced motion. Manual prev/next still works either
    // way, but we stop hijacking attention on background tabs / motion-
    // sensitive users.
    if (total === 0 || isPaused || pageHidden || reducedMotionEffective) return
    autoPlayRef.current = setTimeout(() => goTo(currentIndex + 1), 5000)
    return () => {
      if (autoPlayRef.current) clearTimeout(autoPlayRef.current)
    }
  }, [currentIndex, total, isPaused, pageHidden, reducedMotionEffective, goTo])

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

  if (loading || total === 0 || (game && currentHeroSrc === null)) {
    return (
      <section className="relative w-full overflow-hidden rounded-3xl h-[368px] sm:h-[428px] md:h-[488px] bg-[#1A1A1A]/80">
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />
        <div className="absolute inset-y-0 left-0 flex items-end px-6 sm:px-12 pb-10 sm:pb-12">
          <div className="space-y-3">
            <div className="h-6 w-40 udl-skeleton rounded-full" />
            <div className="h-10 w-64 udl-skeleton rounded-xl" />
            <div className="h-4 w-80 udl-skeleton rounded-full" />
            <div className="flex gap-3 pt-1">
              <div className="h-10 w-32 udl-skeleton rounded-full" />
              <div className="h-10 w-24 udl-skeleton rounded-full" />
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section
      id="hero"
      className="relative w-full overflow-hidden rounded-3xl h-[368px] sm:h-[428px] md:h-[488px] select-none"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') { event.preventDefault(); next() }
        if (event.key === 'ArrowLeft')  { event.preventDefault(); prev() }
      }}
      tabIndex={0}
      role="region"
      aria-roledescription="carousel"
      aria-label="Featured Games Slider"
    >
      {/* Background slides */}
      {sliderGames.map((g, i) => {
        if (Math.abs(i - currentIndex) > 1 && Math.abs(i - currentIndex) !== total - 1) {
          return null
        }
        const src = getSliderImageSrc(g)
        if (!src) return null
        const proxied = proxyImageUrl(src)
        return (
          <div
            key={g.appid}
            className={cn(
              'absolute inset-0 transition-opacity duration-700 ease-in-out',
              i === currentIndex ? 'opacity-100' : 'opacity-0 pointer-events-none',
            )}
          >
            <img
              src={proxied}
              alt={g.name}
              className={cn(
                'absolute inset-0 h-full w-full object-cover object-center transition-transform duration-[6000ms] ease-out',
                i === currentIndex ? 'scale-110' : 'scale-100',
              )}
              draggable={false}
            />
          </div>
        )
      })}

      {/* Gradient overlays */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/50 to-transparent pointer-events-none z-[1]" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20 pointer-events-none z-[1]" />

      {/* Content */}
      <div
        className={cn(
          'absolute inset-0 flex items-end pl-16 sm:pl-20 pr-8 sm:pr-12 pb-10 sm:pb-12 transition-all duration-500 ease-out z-[2]',
          isTransitioning ? 'opacity-0 translate-y-4 scale-[0.98]' : 'opacity-100 translate-y-0 scale-100',
        )}
      >
        <div className="w-full max-w-[1800px] mx-auto">
          {/* Badges */}
          <div className={cn(
            'flex flex-wrap items-center gap-2 mb-2 transition-all duration-500 delay-100',
            isTransitioning ? 'opacity-0 translate-x-[-8px]' : 'opacity-100 translate-x-0',
          )}>
            {game.version && (
              <span className="bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-full">
                {game.version}
              </span>
            )}
            <span className="bg-white/10 text-white text-xs font-bold px-3 py-1 rounded-full backdrop-blur-sm border border-white/[.08]">
              PC
            </span>
            {game.source && (
              <span className="bg-white/10 text-white text-xs font-bold px-3 py-1 rounded-full backdrop-blur-sm border border-white/[.08] uppercase">
                {game.source}
              </span>
            )}
            {game.release_date && (
              <span className="bg-white/10 text-white text-xs font-bold px-3 py-1 rounded-full backdrop-blur-sm border border-white/[.08]">
                {new Date(game.release_date).getFullYear()}
              </span>
            )}
          </div>

          {/* Logo (if available) */}
          {currentLogoSrc ? (
            <div className={cn(
              'relative mb-3 h-16 max-w-[min(68vw,420px)] transition-all duration-500 delay-150 sm:h-20',
              isTransitioning ? 'opacity-0 translate-y-3' : 'opacity-100 translate-y-0',
            )}>
              <img
                src={proxyImageUrl(currentLogoSrc)}
                alt={`${game.name} logo`}
                className="absolute inset-0 h-full w-full object-contain object-left drop-shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
                onError={() => {
                  setFailedLogoByAppid((prev) => ({ ...prev, [game.appid]: true }))
                }}
                draggable={false}
              />
            </div>
          ) : null}

          <h1 className={cn(
            'text-2xl sm:text-3xl md:text-4xl font-light text-white mb-2 leading-tight max-w-xl line-clamp-2 transition-all duration-500 delay-150',
            currentLogoSrc ? 'text-sm sm:text-lg md:text-xl text-white/85 font-medium' : '',
            isTransitioning ? 'opacity-0 translate-y-3' : 'opacity-100 translate-y-0',
          )}>
            {game.name}
          </h1>

          {/* Description */}
          <p className={cn(
            'text-sm text-white/75 max-w-lg mb-4 line-clamp-2 leading-relaxed transition-all duration-500 delay-200 hidden sm:block',
            isTransitioning ? 'opacity-0 translate-y-3' : 'opacity-100 translate-y-0',
          )}>
            {game.description?.replace(/<[^>]+>/g, '').slice(0, 150)}
            {(game.description?.length ?? 0) > 150 ? '...' : ''}
          </p>

          {/* Actions */}
          <div className={cn(
            'flex flex-wrap items-center gap-3 transition-all duration-500 delay-[250ms]',
            isTransitioning ? 'opacity-0 translate-y-3' : 'opacity-100 translate-y-0',
          )}>
            <Button
              size="default"
              className="rounded-full px-6 font-medium"
              onClick={() => navigate(`/game/${game.appid}`)}
            >
              <Download className="mr-2 h-4 w-4" />
              Download Now
            </Button>
            <Button
              size="default"
              variant="outline"
              className="rounded-full px-6 font-medium border-border bg-secondary/50 backdrop-blur-md text-white hover:bg-zinc-700 hover:border-zinc-500"
              onClick={() => navigate(`/game/${game.appid}`)}
            >
              <Info className="mr-2 h-4 w-4" />
              Details
            </Button>
          </div>
        </div>
      </div>

      {/* Prev / Next */}
      <button
        onClick={prev}
        className="absolute left-3 sm:left-5 top-1/2 -translate-y-1/2 h-10 w-10 sm:h-12 sm:w-12 flex items-center justify-center rounded-full bg-secondary/80 hover:bg-primary hover:text-primary-foreground text-foreground/80 border border-white/[.08] backdrop-blur-sm transition-all active:scale-95 z-[3]"
        aria-label="Previous slide"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button
        onClick={next}
        className="absolute right-3 sm:right-5 top-1/2 -translate-y-1/2 h-10 w-10 sm:h-12 sm:w-12 flex items-center justify-center rounded-full bg-secondary/80 hover:bg-primary hover:text-primary-foreground text-foreground/80 border border-white/[.08] backdrop-blur-sm transition-all active:scale-95 z-[3]"
        aria-label="Next slide"
      >
        <ChevronRight className="h-5 w-5" />
      </button>

      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 z-[4] h-1.5 bg-transparent">
        {!isPaused && (
          <div
            key={currentIndex}
            className="h-full rounded-r-full origin-left"
            style={{ animation: 'slider-progress 5s linear forwards', backgroundColor: 'var(--primary)' }}
          />
        )}
      </div>

      {/* Dot navigation */}
      <div className="absolute bottom-3 right-6 sm:right-12 flex items-center gap-1.5 z-[3]">
        {sliderGames.map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            className={cn(
              'rounded-full transition-all duration-300',
              i === currentIndex
                ? 'w-6 h-2 bg-white'
                : 'w-2 h-2 bg-white/30 hover:bg-white/60',
            )}
            aria-label={`Go to slide ${i + 1}`}
          />
        ))}
      </div>
    </section>
  )
}
