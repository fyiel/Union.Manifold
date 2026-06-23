import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Loader2 } from "@/components/icons"
import { Calendar, HardDrive, Square, RefreshCw, ImageOff } from "lucide-react"
import {
  Download,
  Eye,
  Wifi,
  Flame,
  Play,
} from "@/components/icons"
import { formatNumber, getCardImage, hasOnlineMode, isGameVersionUpdate, proxyImageUrl, timeAgo } from "@/lib/utils"
import { GameActionContextMenu } from "@/components/GameActionMenu"
import { useDownloads, useDownloadsSelector } from "@/context/downloads-context"
import { useGameLaunch } from "@/context/game-launch-context"
import { apiUrl } from "@/lib/api"
import { useNsfwReveal } from "@/hooks/use-nsfw-reveal"
import { useRunningGame } from "@/hooks/use-running-games"
import { useUniversalGameMenuProps } from "@/hooks/use-universal-game-menu"
import { schedulePrefetchGameDetail } from "@/lib/game-detail-prefetch"
import { isImageKnownBad, markImageFailed, forgetImageFailure } from "@/lib/image-failure-cache"
import { GameArtAura } from "@/components/game-art-aura"

interface GameCardProps {
  game: {
    appid: string
    name: string
    description: string
    genres: string[]
    image: string
    release_date: string
    size: string
    source: string
    version?: string
    splash?: string
    hero_image?: string
    background_image?: string
    hero_logo?: string
    localImage?: string
    localSplash?: string
    localHeroImage?: string
    localBackgroundImage?: string
    developer?: string
    store?: string
    link?: string
    dlc?: string[]
    comment?: string
    hasCoOp?: boolean
    posted_time?: string
    edited_time?: string
    update_time?: string
    release_time?: string
    /** Admin-selected launcher exe (relative to install folder). Preferred
     *  over heuristic detection when present. */
    game_executable_path?: string | null
  }
  stats?: {
    downloads: number
    views: number
  }
  isPopular?: boolean
  size?: "default" | "compact"
  updateAvailable?: boolean
  updateLabel?: string
}

export const GameCard = memo(function GameCard({
  game,
  stats: initialStats,
  isPopular = false,
  size = "default",
  updateAvailable = false,
  updateLabel = "Update available",
}: GameCardProps) {
  const isWindows = typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent)
  const [hoveredStats, setHoveredStats] = useState<{ downloads: number; views: number } | null>(null)
  const [isLoadingStats, setIsLoadingStats] = useState(false)
  const isCompact = size === "compact"
  const cardFallbackImage = isCompact ? "./fallbacks/game-card-4x5.svg" : "./fallbacks/game-card-3x4.svg"

  const genres = Array.isArray(game.genres) ? game.genres : []
  const displayGenres = genres.filter((genre) => String(genre).toLowerCase() !== "nsfw")
  const isNSFW = genres.some((genre) => genre.toLowerCase() === "nsfw")
  const { revealed: nsfwRevealed, reveal: revealNsfw } = useNsfwReveal(game.appid)
  const nsfwGateUp = isNSFW && !nsfwRevealed
  const displayStats = initialStats || hoveredStats || { downloads: 0, views: 0 }

  const navigate = useNavigate()
  const { openPath } = useDownloads()
  const downloadState = useDownloadsSelector(
    useCallback(
      (items) => {
        const appDownloads = items.filter((item) => item.appid === game.appid)
        const hasActive = appDownloads.some((item) =>
          ["downloading", "paused", "extracting", "installing"].includes(item.status)
        )
        const isCancelled = appDownloads.some((item) => item.status === "cancelled")
        const isQueuedOnly = appDownloads.length > 0 && appDownloads.every((item) => item.status === "queued")
        const isQueued = isQueuedOnly && !hasActive
        const isInstalling = hasActive && !isCancelled
        return { isQueued, isInstalling }
      },
      [game.appid]
    ),
    useCallback(
      (prev: { isQueued: boolean; isInstalling: boolean }, next: { isQueued: boolean; isInstalling: boolean }) =>
        prev.isQueued === next.isQueued && prev.isInstalling === next.isInstalling,
      []
    )
  )
  const [installedPath, setInstalledPath] = useState<string | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)
  // Pulled from the shared module-level cache (one bulk IPC fetch on first
  // subscription, then push-based updates via ucPresence.onChanged). Replaces
  // the per-card 60s polling loop that used to fire ~N IPC calls/minute on a
  // populated library grid.
  // Running state comes straight from the shared running-games cache. The
  // central GameLaunchProvider flips it optimistically (setRunningOptimistic)
  // on launch/stop, so the card no longer needs a local mirror or its own
  // quick-exit watch.
  const isRunning = useRunningGame(isInstalled ? game.appid : null)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const [imageCandidateIndex, setImageCandidateIndex] = useState(0)
  const prefetchCancelRef = useRef<(() => void) | null>(null)
  const { requestLaunch, stopGame } = useGameLaunch()

  useEffect(() => {
    let mounted = true
      ; (async () => {
        try {
          if (mounted) {
            setInstalledPath(null)
            setIsInstalled(false)
          }
          if (window.ucDownloads?.getInstalledGlobal || window.ucDownloads?.getInstalled) {
            const manifest = await (window.ucDownloads.getInstalledGlobal?.(game.appid) || window.ucDownloads.getInstalled(game.appid))
            if (!mounted) return
            if (manifest) setIsInstalled(true)
            if (manifest && Array.isArray(manifest.files) && manifest.files.length) {
              // prefer first file path for Open action
              setInstalledPath(manifest.files[0].path || null)
            }
          }
        } catch {
          if (mounted) {
            setInstalledPath(null)
            setIsInstalled(false)
          }
        }
      })()
    return () => {
      mounted = false
    }
  }, [game.appid])

  // Running poll + quick-exit detection now live in the shared running-games
  // cache and the central GameLaunchProvider respectively — nothing per-card.

  const fetchStatsOnHover = useCallback(async () => {
    if (initialStats && (initialStats.downloads > 0 || initialStats.views > 0)) {
      return
    }

    if (isLoadingStats) {
      return
    }

    setIsLoadingStats(true)
    try {
      const response = await fetch(apiUrl(`/api/stats/${encodeURIComponent(game.appid)}`))
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          const stats = { downloads: data.downloads, views: data.views }
          setHoveredStats(stats)
        }
      }
    } catch (error) {
      console.error(`[UC] Error fetching stats for ${game.appid}:`, error)
    } finally {
      setIsLoadingStats(false)
    }
  }, [game.appid, initialStats, isLoadingStats])

  const { isQueued, isInstalling } = downloadState

  const handlePlayClick = async (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()

    // If an update is available, the white button must update the game — not
    // launch it. We don't have the host-selector / backup flow available in a
    // card, so hand off to the detail page with an auto-open update query
    // parameter. The detail page knows how to show the changelog, run the
    // backup, and queue the download.
    if (updateAvailable && isInstalled && !isRunning) {
      navigate(`/game/${encodeURIComponent(game.appid)}?update=1`)
      return
    }

    // Running → stop, otherwise launch. Both go through the shared
    // GameLaunchProvider (resolve exe → preflight → shortcut → launch →
    // quick-exit), which renders the single, portaled picker at the app root.
    if (isRunning) {
      void stopGame(game.appid)
      return
    }
    void requestLaunch(game)
  }

  // Universal right-click menu. All surfaces (GameCard, GameCardCompact,
  // LibraryPage, GameDetailPage) feed their `game` through
  // useUniversalGameMenuProps so every right-click shows the same actions in
  // the same order — Download / Open Files / Wishlist / Liked / Hide from
  // Discord / Collections — gated only on actual availability. Page-specific
  // wrinkles (the Library's delete handler, the detail page's exe picker,
  // etc.) come in via the second arg.
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null)
  const closeContextMenu = useCallback(() => setContextMenuPos(null), [])
  const menuProps = useUniversalGameMenuProps(game, {
    onOpenFiles: isInstalled && installedPath ? () => {
      closeContextMenu()
      openPath(installedPath)
    } : null,
  })

  const cardImageCandidates = useMemo(() => {
    const candidates = [
      game.localImage,
      game.image,
      game.hero_image,
      game.background_image,
      game.splash,
      cardFallbackImage,
    ]
    const seen = new Set<string>()
    return candidates.reduce<string[]>((next, candidate) => {
      const raw = String(candidate || "").trim()
      if (!raw) return next
      const resolved = proxyImageUrl(getCardImage(raw)) || proxyImageUrl(raw) || raw
      if (!resolved || seen.has(resolved)) return next
      seen.add(resolved)
      next.push(resolved)
      return next
    }, [])
  }, [cardFallbackImage, game.background_image, game.hero_image, game.image, game.localImage, game.splash])

  // Skip past any candidate URLs we already know failed this session — no
  // point hitting the spinner-then-fallback path again on every re-mount when
  // we have the answer cached. Falls through to the SVG fallback if every
  // candidate is poisoned, which matches the existing behaviour.
  const resolvedCandidateIndex = useMemo(() => {
    let idx = imageCandidateIndex
    while (
      idx < cardImageCandidates.length - 1
      && cardImageCandidates[idx]
      && cardImageCandidates[idx] !== cardFallbackImage
      && isImageKnownBad(cardImageCandidates[idx])
    ) {
      idx += 1
    }
    return idx
  }, [cardImageCandidates, imageCandidateIndex, cardFallbackImage])

  const cardImageSrc = cardImageCandidates[resolvedCandidateIndex] || cardFallbackImage

  // Reset only when the underlying source URLs change. Previously this
  // depended on `cardImageCandidates` (a useMemo array). React is permitted
  // to discard memo caches and recompute — that produces a new array
  // reference even though every URL inside is identical, which re-fired this
  // effect on unrelated re-renders (e.g. hover / sort) and flashed the
  // skeleton back on.
  useEffect(() => {
    setImageCandidateIndex(0)
    setImageLoaded(false)
    setImageFailed(false)
  }, [
    cardFallbackImage,
    game.background_image,
    game.hero_image,
    game.image,
    game.localImage,
    game.splash,
  ])

  return (
    <GameArtAura src={cardImageSrc} scopeKey={game.appid} className="group/container h-full">
    <div className="relative h-full"
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setContextMenuPos({ x: event.clientX, y: event.clientY })
      }}
    >
      <Link to={`/game/${game.appid}`} className="block h-full">
        <div
          className="group relative h-full overflow-hidden rounded-2xl glass hover:bg-white/[.03] transition-all duration-300 flex flex-col"
          onMouseEnter={() => {
            // Stats hover (unchanged) + hover-intent prefetch of the game
            // detail JSON so navigating into the page feels instant.
            void fetchStatsOnHover()
            prefetchCancelRef.current = schedulePrefetchGameDetail(game.appid)
          }}
          onMouseLeave={() => {
            if (prefetchCancelRef.current) {
              prefetchCancelRef.current()
              prefetchCancelRef.current = null
            }
          }}
        >
          {/* Image Section */}
          <div className={`relative w-full overflow-hidden ${isCompact ? "aspect-[4/5]" : "aspect-[3/4]"}`}>
            <div className="absolute inset-0 z-10 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-70 transition-opacity duration-300 group-hover:opacity-50" />

            {!imageLoaded && <div className="udl-skeleton absolute inset-0 z-0 rounded-none" />}

            <img
              src={cardImageSrc}
              alt={game.name}
              data-uc-handled="1"
              className={`h-full w-full object-cover transition-all duration-500 ease-in-out group-hover:scale-105 ${
                nsfwGateUp ? "blur-xl brightness-50" : ""
                } ${imageLoaded ? "opacity-100" : "opacity-0"}`}
              loading="lazy"
              ref={(node) => {
                // Browser-cached images can finish loading BEFORE the React
                // tree subscribes its onLoad — so we never get the event and
                // the skeleton spins forever. When we mount over a complete
                // image, mark it loaded synchronously. Common cause: changing
                // a sort/filter that re-renders the same cards with the same
                // src; the browser already has them, no network call happens.
                if (node && node.complete && node.naturalWidth > 0) {
                  setImageLoaded(true)
                  setImageFailed(false)
                  if (cardImageSrc) forgetImageFailure(cardImageSrc)
                }
              }}
              onLoad={() => {
                // The current candidate worked — pull it out of the failure
                // cache in case it had been poisoned by an earlier transient.
                if (cardImageSrc) forgetImageFailure(cardImageSrc)
                setImageLoaded(true)
                setImageFailed(false)
              }}
              onError={() => {
                // Remember this URL is bad so other cards / re-mounts skip it.
                if (cardImageSrc && cardImageSrc !== cardFallbackImage) {
                  markImageFailed(cardImageSrc)
                }
                if (resolvedCandidateIndex < cardImageCandidates.length - 1) {
                  setImageCandidateIndex(resolvedCandidateIndex + 1)
                  return
                }
                setImageLoaded(true)
                setImageFailed(true)
              }}
            />

            {!imageLoaded && !imageFailed && (
              <div aria-hidden className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-white/70 drop-shadow" />
              </div>
            )}

            {imageFailed && (
              <div
                aria-hidden
                role="img"
                aria-label={`${game.name} cover failed to load`}
                className="pointer-events-none absolute inset-0 z-[5] flex flex-col items-center justify-center gap-1 bg-card/70 text-muted-foreground"
              >
                <ImageOff className="h-6 w-6" />
                <span className="text-[10px] uppercase tracking-wider">Image unavailable</span>
              </div>
            )}

            {/* NSFW overlay: show Reveal button when not revealed. Renders
                ABOVE the play button (z-40) so the reveal target is always
                clickable — previously z-20 sat below the z-30 play overlay,
                which swallowed every click on installed cards. */}
            {nsfwGateUp && (
              <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/50 gap-2">
                <div className="bg-red-600 text-white px-3 py-1 rounded-full text-xs font-bold">18+</div>
                <button
                  type="button"
                  aria-label={`Reveal NSFW cover for ${game.name}`}
                  className="mt-1 bg-secondary/80 hover:bg-primary hover:text-primary-foreground text-white text-xs font-semibold px-3 py-1.5 rounded-full border border-border transition-all active:scale-95 focus-visible:outline-none"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    revealNsfw()
                  }}
                >
                  Reveal
                </button>
                <span className="text-white/50 text-[10px]">Tap to reveal</span>
              </div>
            )}

            {/* Play Button Overlay — running state always visible, otherwise
                hover-only. Hidden entirely while the NSFW gate is up so the
                reveal click target is never blocked. The wrapper is
                pointer-events-none and the button itself re-enables them, so
                the empty (transparent) area never swallows clicks meant for
                layers below. */}
            {isInstalled && !nsfwGateUp && (
              <>
                <div
                  className={`pointer-events-none absolute inset-0 z-20 bg-black/40 transition-opacity duration-200 ${
                    isRunning ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                />
                <div
                  className={`pointer-events-none absolute inset-0 z-30 flex items-center justify-center transition-all duration-200 ${
                    isRunning
                      ? "opacity-100"
                      : "opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100"
                  }`}
                >
                  <button
                    onClick={handlePlayClick}
                    aria-label={isRunning ? "Stop game" : updateAvailable ? "Update game" : "Launch game"}
                    className={`group/play pointer-events-auto relative inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/20 shadow-xl transition-transform duration-200 hover:scale-110 active:scale-95 ${
                      isRunning ? "bg-red-600 text-white" : "bg-primary text-primary-foreground"
                    }`}
                  >
                    {isRunning ? (
                      <Square className="relative h-5 w-5 fill-current" />
                    ) : (
                      updateAvailable
                        ? <RefreshCw className="relative h-5 w-5" />
                        : <Play className="relative h-5 w-5 fill-current ml-0.5" />
                    )}
                  </button>
                </div>
              </>
            )}

            {/* Status Badges */}
            <div className="absolute top-3 left-3 z-30 flex flex-col gap-2">
              {(isQueued || isInstalling) && (
                <Badge className="bg-primary text-primary-foreground border-none shadow-lg shadow-white/20 animate-pulse">
                  <Download className="w-3 h-3 mr-1" />
                  {isQueued ? "Queued" : "Installing"}
                </Badge>
              )}

              {isPopular && (
                <Badge className="bg-secondary/60 text-white backdrop-blur-sm border border-white/10 px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-full">
                  <Flame className="w-3 h-3 mr-1 fill-current" /> Popular
                </Badge>
              )}

              {hasOnlineMode(game.hasCoOp) && (
                <Badge variant="online" className="bg-secondary/60 backdrop-blur-sm border border-white/10 px-3 py-1 text-xs font-semibold flex items-center gap-1 rounded-full">
                  <Wifi className="w-3 h-3 mr-1 text-green-400" />
                  <span className="text-white">MP</span>
                </Badge>
              )}

              {updateAvailable && isInstalled && (
                <Badge className="bg-emerald-500/15 backdrop-blur-sm border border-emerald-400/25 px-3 py-1 text-xs font-semibold flex items-center gap-1 rounded-full text-emerald-100">
                  <RefreshCw className="w-3 h-3 mr-1 text-emerald-200" />
                  <span>{updateLabel}</span>
                </Badge>
              )}

              {isGameVersionUpdate(game) && (
                <Badge className="bg-secondary/60 backdrop-blur-sm border border-white/10 px-3 py-1 text-xs font-semibold flex items-center gap-1 rounded-full">
                  <RefreshCw className="w-3 h-3 mr-1 text-foreground/80" />
                  <span className="text-foreground/80">Updated {timeAgo(game.update_time)}</span>
                </Badge>
              )}
            </div>

            {/* Hover Stats Overlay */}
            <div className="absolute bottom-0 left-0 right-0 z-20 p-4 pt-10 translate-y-full bg-gradient-to-t from-black/90 via-black/60 to-transparent transition-transform duration-300 ease-out group-hover:translate-y-0">
              <div className="flex items-center justify-between text-xs font-medium text-white/90">
                <div className="flex items-center gap-1.5 bg-black/50 rounded-full px-2 py-1 border border-border/50">
                  <Download className="w-3.5 h-3.5 text-muted-foreground" />
                  <span>{formatNumber(displayStats.downloads)}</span>
                </div>
                <div className="flex items-center gap-1.5 bg-black/50 rounded-full px-2 py-1 border border-border/50">
                  <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                  <span>{formatNumber(displayStats.views)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Content Section */}
          <div className={`${isCompact ? "p-3" : "p-4"} flex flex-col flex-1 space-y-3 relative z-20`}>
            <div className="space-y-1">
              <h3 className="font-medium text-sm leading-tight line-clamp-1 text-white">
                {game.name}
              </h3>
              <div className="flex flex-wrap gap-1.5 h-6 overflow-hidden">
                {displayGenres.slice(0, 3).map((genre) => (
                  <span
                    key={genre}
                    className="text-[10px] uppercase font-medium tracking-wider text-muted-foreground bg-white/5 border border-white/[.08] px-2 py-0.5 rounded-full whitespace-nowrap"
                  >
                    {genre}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground/80 pt-2 border-t border-white/[.07] mt-auto">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                <span>{game.release_date?.split("-")[0] || "N/A"}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5" />
                <span>{game.size}</span>
              </div>
            </div>
          </div>
        </div>
      </Link>

      {/* The launch picker / shortcut / preflight / failed modals are mounted
          once at the app root by GameLaunchProvider — not per card. */}

      {/* Universal right-click menu — appears on every card site-wide. */}
      <GameActionContextMenu
        open={contextMenuPos != null}
        position={contextMenuPos}
        onClose={closeContextMenu}
        {...menuProps}
      />
    </div>
    </GameArtAura>
  )
})
