import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react"
import { Link } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Calendar, HardDrive, Download, Eye, Wifi, Flame, Play, Square, RefreshCw } from "lucide-react"
import { formatNumber, getCardImage, hasOnlineMode, isGameVersionUpdate, pickGameExecutable, proxyImageUrl, timeAgo } from "@/lib/utils"
import { reportPlayEvent } from "@/lib/cloud-collections"
import { GameActionContextMenu, type CollectionPickerEntry } from "@/components/GameActionMenu"
import { useAccountLists } from "@/hooks/use-account-lists"
import { useUserCollections } from "@/hooks/use-user-collections"
import { useDownloads, useDownloadsSelector } from "@/context/downloads-context"
import { apiUrl } from "@/lib/api"
import { nsfwRevealedAppids } from "@/lib/nsfw-session"
import { ExePickerModal } from "@/components/ExePickerModal"
import { DesktopShortcutModal } from "@/components/DesktopShortcutModal"
import { GameLaunchFailedModal } from "@/components/GameLaunchFailedModal"
import { GameLaunchPreflightModal, type LaunchPreflightResult } from "@/components/GameLaunchPreflightModal"
import { gameLogger } from "@/lib/logger"

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
    update_time?: string
    release_time?: string
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
  const [allowNsfwReveal, setAllowNsfwReveal] = useState(false)
  const [sessionRevealed, setSessionRevealed] = useState(false)
  const displayStats = initialStats || hoveredStats || { downloads: 0, views: 0 }

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
  const [isRunning, setIsRunning] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageCandidateIndex, setImageCandidateIndex] = useState(0)
  const [exePickerOpen, setExePickerOpen] = useState(false)
  const [exePickerExes, setExePickerExes] = useState<Array<{ name: string; path: string; size?: number; depth?: number }>>([])
  const [exePickerFolder, setExePickerFolder] = useState<string | null>(null)
  const [pendingExePath, setPendingExePath] = useState<string | null>(null)
  const [shortcutModalOpen, setShortcutModalOpen] = useState(false)
  const [shortcutModalAlwaysCreate, setShortcutModalAlwaysCreate] = useState(false)
  const [gameStartFailedOpen, setGameStartFailedOpen] = useState(false)
  const [launchPreflightOpen, setLaunchPreflightOpen] = useState(false)
  const [launchPreflightResult, setLaunchPreflightResult] = useState<LaunchPreflightResult | null>(null)
  const gameJustLaunchedRef = useRef<number>(0)
  const gameQuickExitUnsubRef = useRef<(() => void) | null>(null)

  // Sync NSFW reveal preference from localStorage
  useEffect(() => {
    const syncPreference = () => {
      try {
        setAllowNsfwReveal(localStorage.getItem("uc_show_nsfw") === "1")
      } catch {
        setAllowNsfwReveal(false)
      }
    }
    syncPreference()
    const onStorage = (e: StorageEvent) => {
      if (e.key === "uc_show_nsfw") syncPreference()
    }
    const onPreferenceChange = () => syncPreference()
    window.addEventListener("storage", onStorage)
    window.addEventListener("uc_nsfw_pref", onPreferenceChange)
    return () => {
      window.removeEventListener("storage", onStorage)
      window.removeEventListener("uc_nsfw_pref", onPreferenceChange)
    }
  }, [])

  // Session reveal: in-memory only - resets on page reload, never persisted to storage.
  useEffect(() => {
    const checkSession = () => setSessionRevealed(nsfwRevealedAppids.has(game.appid))
    checkSession()
    window.addEventListener("uc_nsfw_session_changed", checkSession)
    return () => window.removeEventListener("uc_nsfw_session_changed", checkSession)
  }, [game.appid])

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

  useEffect(() => {
    if (!isInstalled) {
      setIsRunning(false)
      return
    }

    let mounted = true
    const checkRunning = async () => {
      if (!window.ucDownloads?.getRunningGame) return
      try {
        const result = await window.ucDownloads.getRunningGame(game.appid)
        if (mounted && result?.ok) {
          setIsRunning(result.running || false)
        }
      } catch {
        if (mounted) setIsRunning(false)
      }
    }
    void checkRunning()
    const interval = setInterval(checkRunning, 5000)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [game.appid, isInstalled])

  // If the running state flips to false within the quick-exit window, show the modal
  useEffect(() => {
    if (isRunning || !(gameJustLaunchedRef.current > Date.now())) return
    gameJustLaunchedRef.current = 0
    try { gameQuickExitUnsubRef.current?.() } catch { }
    gameQuickExitUnsubRef.current = null
    setGameStartFailedOpen(true)
  }, [isRunning])

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

  const getSavedExe = async () => {
    if (!window.ucSettings?.get) return null
    try {
      return await window.ucSettings.get(`gameExe:${game.appid}`)
    } catch {
      return null
    }
  }

  const setSavedExe = async (path: string | null) => {
    if (!window.ucSettings?.set) return
    try {
      await window.ucSettings.set(`gameExe:${game.appid}`, path || null)
    } catch { }
  }

  const getShortcutAskedForGame = async () => {
    if (!window.ucSettings?.get) return false
    try {
      return await window.ucSettings.get(`shortcutAsked:${game.appid}`)
    } catch {
      return false
    }
  }

  const setShortcutAskedForGame = async () => {
    if (!window.ucSettings?.set) return
    try {
      await window.ucSettings.set(`shortcutAsked:${game.appid}`, true)
    } catch { }
  }

  const getAlwaysCreateShortcut = async () => {
    if (!window.ucSettings?.get) return false
    try {
      return await window.ucSettings.get('alwaysCreateDesktopShortcut')
    } catch {
      return false
    }
  }

  const setAlwaysCreateShortcut = async (value: boolean) => {
    if (!window.ucSettings?.set) return
    try {
      await window.ucSettings.set('alwaysCreateDesktopShortcut', value)
    } catch { }
  }

  const createDesktopShortcut = async (exePath?: string | null) => {
    if (!window.ucDownloads?.createDesktopShortcut) return
    try {
      const result = await window.ucDownloads.createDesktopShortcut(game.name, game.appid, exePath || undefined)
      if (result?.ok) {
        gameLogger.info('Desktop shortcut created', { appid: game.appid })
      } else {
        gameLogger.error('Failed to create desktop shortcut', { data: result })
      }
    } catch (err) {
      gameLogger.error('Error creating desktop shortcut', { data: err })
    }
  }

  const listGameExecutables = async () => {
    if (!window.ucDownloads?.listGameExecutables) return null
    return await window.ucDownloads.listGameExecutables(game.appid)
  }

  const openExePicker = (exes: Array<{ name: string; path: string; size?: number; depth?: number }>, folder?: string | null) => {
    setExePickerExes(exes)
    setExePickerFolder(folder || null)
    setExePickerOpen(true)
  }

  const runLaunchPreflight = async (path: string) => {
    const result = await window.ucDownloads?.preflightGameLaunch?.(game.appid, path)
    if (!result?.ok) return true
    if (result.canLaunch && result.checks.length === 0) return true

    setPendingExePath(path)
    setLaunchPreflightResult(result)
    setLaunchPreflightOpen(true)
    return false
  }

  const reopenExecutablePicker = async () => {
    try {
      const result = await listGameExecutables()
      const exes = result?.exes || []
      const folder = result?.folder || null
      setLaunchPreflightOpen(false)
      openExePicker(exes, folder)
    } catch {
      setLaunchPreflightOpen(false)
    }
  }

  const launchGame = async (path: string) => {
    if (!window.ucDownloads?.launchGameExecutable) return
    const showGameName = await window.ucSettings?.get?.('rpcShowGameName') ?? true
    const res = await window.ucDownloads.launchGameExecutable(game.appid, path, game.name, showGameName)
    if (res && res.ok) {
      // Fire-and-forget: record a 'play' event for the account so the
      // recently-played view stays current across devices.
      void reportPlayEvent(game.appid, "play")
      await setSavedExe(path)
      setIsRunning(true)
      setExePickerOpen(false)
      setShortcutModalOpen(false)
      setPendingExePath(null)
      setGameStartFailedOpen(false)

      // Quick-exit detection window: 12 seconds after launch
      gameJustLaunchedRef.current = Date.now() + 12000

      const showStartFailedModal = () => {
        setIsRunning(false)
        setGameStartFailedOpen(true)
      }

      try { gameQuickExitUnsubRef.current?.() } catch { }
      gameQuickExitUnsubRef.current = window.ucDownloads?.onGameQuickExit?.((data) => {
        if (data?.appid !== game.appid) return
        if (!(gameJustLaunchedRef.current > Date.now())) return
        gameJustLaunchedRef.current = 0
        try { gameQuickExitUnsubRef.current?.() } catch { }
        gameQuickExitUnsubRef.current = null
        void showStartFailedModal()
      }) ?? null
    }
  }

  const handleLaunchWithShortcutCheck = async (path: string, options?: { skipPreflight?: boolean }) => {
    if (!options?.skipPreflight) {
      const passed = await runLaunchPreflight(path)
      if (!passed) return
    }

    // Check if we should show shortcut modal BEFORE launching
    const alreadyAsked = await getShortcutAskedForGame()
    const alwaysCreate = await getAlwaysCreateShortcut()

    if (alwaysCreate && !alreadyAsked) {
      // Auto-create shortcut without asking, then launch
      await createDesktopShortcut(path)
      await setShortcutAskedForGame()
      await launchGame(path)
    } else if (!alreadyAsked && !alwaysCreate) {
      // Show the shortcut prompt BEFORE launching
      setPendingExePath(path)
      setShortcutModalAlwaysCreate(false)
      setExePickerOpen(false)
      setShortcutModalOpen(true)
    } else {
      // No shortcut needed, just launch
      await launchGame(path)
    }
  }

  const handleExePicked = async (path: string) => {
    setPendingExePath(path)
    await handleLaunchWithShortcutCheck(path)
  }

  const handlePlayClick = async (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()

    // If game is running, stop it
    if (isRunning && window.ucDownloads?.quitGameExecutable) {
      try {
        gameJustLaunchedRef.current = 0
        try { gameQuickExitUnsubRef.current?.() } catch { }
        gameQuickExitUnsubRef.current = null
        const result = await window.ucDownloads.quitGameExecutable(game.appid)
        if (result?.ok && result.stopped) {
          setIsRunning(false)
        }
      } catch (err) {
        gameLogger.error('Failed to quit game', { data: err })
      }
      return
    }

    if (!window.ucDownloads?.listGameExecutables || !window.ucDownloads?.launchGameExecutable) {
      if (installedPath) openPath(installedPath)
      return
    }
    try {
      const savedExe = await getSavedExe()

      if (savedExe) {
        await handleLaunchWithShortcutCheck(savedExe)
        return
      }

      const result = await listGameExecutables()
      if (!result) {
        if (installedPath) openPath(installedPath)
        return
      }
      const exes = result?.exes || []
      const folder = result?.folder || null
      const browseFolder = folder
      const { pick, confident } = pickGameExecutable(exes, game.name, game.source, folder)
      if (pick && confident) {
        await handleLaunchWithShortcutCheck(pick.path)
        return
      }
      openExePicker(exes, browseFolder)
    } catch {
      if (installedPath) openPath(installedPath)
    }
  }

  // Universal right-click menu. Works on every GameCard regardless of
  // installed/uninstalled state — picks up the relevant action set:
  //  - Wishlist + Liked toggles for any game
  //  - Add to collection (cloud-synced when authed)
  //  - Open Files when installed
  const accountLists = useAccountLists()
  const userCollections = useUserCollections()
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null)
  const closeContextMenu = useCallback(() => setContextMenuPos(null), [])

  const collectionPicker = useMemo(() => ({
    collections: userCollections.collections.map<CollectionPickerEntry>((c) => ({
      id: c.id,
      name: c.name,
      included: c.appids.includes(game.appid),
    })),
    onAddToCollection: async (collectionId: string) => {
      const target = userCollections.collections.find((c) => c.id === collectionId)
      if (!target) return
      if (!target.appids.includes(game.appid)) {
        await userCollections.setMembership(target, [...target.appids, game.appid])
      }
    },
    onRemoveFromCollection: async (collectionId: string) => {
      const target = userCollections.collections.find((c) => c.id === collectionId)
      if (!target) return
      await userCollections.setMembership(
        target,
        target.appids.filter((id) => id !== game.appid)
      )
    },
    onCreateCollection: async (name: string) => {
      await userCollections.create(name, [game.appid])
    },
  }), [userCollections, game.appid])

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

  const cardImageSrc = cardImageCandidates[imageCandidateIndex] || cardFallbackImage

  useEffect(() => {
    setImageCandidateIndex(0)
    setImageLoaded(false)
  }, [cardImageCandidates])

  return (
    <div className="relative group/container h-full"
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setContextMenuPos({ x: event.clientX, y: event.clientY })
      }}
    >
      <Link to={`/game/${game.appid}`} className="block h-full">
        <div
          className="group relative h-full overflow-hidden rounded-2xl glass hover:bg-white/[.03] transition-all duration-300 flex flex-col"
          onMouseEnter={fetchStatsOnHover}
        >
          {/* Image Section */}
          <div className={`relative w-full overflow-hidden ${isCompact ? "aspect-[4/5]" : "aspect-[3/4]"}`}>
            <div className="absolute inset-0 z-10 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-70 transition-opacity duration-300 group-hover:opacity-50" />

            {!imageLoaded && <div className="udl-skeleton absolute inset-0 z-0 rounded-none" />}

            <img
              src={cardImageSrc}
              alt={game.name}
              className={`h-full w-full object-cover transition-all duration-500 ease-in-out group-hover:scale-105 ${
                isNSFW && !(sessionRevealed || allowNsfwReveal)
                  ? "blur-xl brightness-50"
                  : ""
                }`}
              loading="lazy"
              onLoad={() => setImageLoaded(true)}
              onError={() => {
                if (imageCandidateIndex < cardImageCandidates.length - 1) {
                  setImageCandidateIndex((current) => current + 1)
                  return
                }
                setImageLoaded(true)
              }}
            />

            {/* NSFW overlay: show Reveal button when not revealed */}
            {isNSFW && !(sessionRevealed || allowNsfwReveal) && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/50 gap-2">
                <div className="bg-red-600 text-white px-3 py-1 rounded-full text-xs font-bold">18+</div>
                <button
                  type="button"
                  aria-label={`Reveal NSFW cover for ${game.name}`}
                  className="mt-1 bg-zinc-800/80 hover:bg-white hover:text-black text-white text-xs font-semibold px-3 py-1.5 rounded-full border border-zinc-700 transition-all active:scale-95 focus-visible:outline-none"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    nsfwRevealedAppids.add(game.appid)
                    setSessionRevealed(true)
                    window.dispatchEvent(new Event('uc_nsfw_session_changed'))
                  }}
                >
                  Reveal
                </button>
                <span className="text-white/50 text-[10px]">Tap to reveal</span>
              </div>
            )}

            {/* Play Button Overlay — running state always visible, otherwise hover-only */}
            {isInstalled && (
              <>
                <div
                  className={`pointer-events-none absolute inset-0 z-20 bg-black/40 transition-opacity duration-200 ${
                    isRunning ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                />
                <div
                  className={`absolute inset-0 z-30 flex items-center justify-center transition-all duration-200 ${
                    isRunning
                      ? "opacity-100"
                      : "opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100"
                  }`}
                >
                  <button
                    onClick={handlePlayClick}
                    aria-label={isRunning ? "Stop game" : updateAvailable ? "Update game" : "Launch game"}
                    className={`group/play relative inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/20 shadow-xl transition-transform duration-200 hover:scale-110 active:scale-95 ${
                      isRunning ? "bg-red-600 text-white" : "bg-white text-black"
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
                <Badge className="bg-white text-black border-none shadow-lg shadow-white/20 animate-pulse">
                  <Download className="w-3 h-3 mr-1" />
                  {isQueued ? "Queued" : "Installing"}
                </Badge>
              )}

              {isPopular && (
                <Badge className="bg-zinc-800/60 text-white backdrop-blur-sm border border-white/10 px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-full">
                  <Flame className="w-3 h-3 mr-1 fill-current" /> Popular
                </Badge>
              )}

              {hasOnlineMode(game.hasCoOp) && (
                <Badge variant="online" className="bg-zinc-800/60 backdrop-blur-sm border border-white/10 px-3 py-1 text-xs font-semibold flex items-center gap-1 rounded-full">
                  <Wifi className="w-3 h-3 mr-1 text-white" />
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
                <Badge className="bg-zinc-800/60 backdrop-blur-sm border border-white/10 px-3 py-1 text-xs font-semibold flex items-center gap-1 rounded-full">
                  <RefreshCw className="w-3 h-3 mr-1 text-zinc-300" />
                  <span className="text-zinc-300">Updated {timeAgo(game.update_time)}</span>
                </Badge>
              )}
            </div>

            {/* Hover Stats Overlay */}
            <div className="absolute bottom-0 left-0 right-0 z-20 p-4 pt-10 translate-y-full bg-gradient-to-t from-black/90 via-black/60 to-transparent transition-transform duration-300 ease-out group-hover:translate-y-0">
              <div className="flex items-center justify-between text-xs font-medium text-white/90">
                <div className="flex items-center gap-1.5 bg-black/50 rounded-full px-2 py-1 border border-zinc-800/50">
                  <Download className="w-3.5 h-3.5 text-zinc-400" />
                  <span>{formatNumber(displayStats.downloads)}</span>
                </div>
                <div className="flex items-center gap-1.5 bg-black/50 rounded-full px-2 py-1 border border-zinc-800/50">
                  <Eye className="w-3.5 h-3.5 text-zinc-400" />
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
                    className="text-[10px] uppercase font-medium tracking-wider text-zinc-400 bg-white/5 border border-white/[.08] px-2 py-0.5 rounded-full whitespace-nowrap"
                  >
                    {genre}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-zinc-500 pt-2 border-t border-white/[.07] mt-auto">
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
      <ExePickerModal
        open={exePickerOpen}
        title="Select executable"
        message={`We couldn't confidently detect the correct exe for "${game.name}". Please choose the one to launch.`}
        exes={exePickerExes}
        gameName={game.name}
        baseFolder={exePickerFolder}
        onSelect={handleExePicked}
        onClose={() => setExePickerOpen(false)}
      />
      <DesktopShortcutModal
        open={shortcutModalOpen}
        gameName={game.name}
        defaultAlwaysCreate={shortcutModalAlwaysCreate}
        onCreateShortcut={async (alwaysCreate) => {
          if (alwaysCreate) {
            await setAlwaysCreateShortcut(true)
          }
          if (pendingExePath) {
            await createDesktopShortcut(pendingExePath)
            await setShortcutAskedForGame()
            await launchGame(pendingExePath)
          }
        }}
        onSkip={async (alwaysCreate) => {
          if (alwaysCreate) {
            await setAlwaysCreateShortcut(true)
          }
          await setShortcutAskedForGame()
          if (pendingExePath) {
            await launchGame(pendingExePath)
          }
        }}
        onClose={async (alwaysCreate) => {
          if (alwaysCreate) {
            await setAlwaysCreateShortcut(true)
          }
          await setShortcutAskedForGame()
          setShortcutModalOpen(false)
          setPendingExePath(null)
          setShortcutModalAlwaysCreate(false)
        }}
      />
      <GameLaunchPreflightModal
        open={launchPreflightOpen}
        gameName={game.name}
        result={launchPreflightResult}
        onClose={() => {
          setLaunchPreflightOpen(false)
          setLaunchPreflightResult(null)
          setPendingExePath(null)
        }}
        onChooseAnother={reopenExecutablePicker}
        onContinue={launchPreflightResult?.canLaunch && pendingExePath
          ? async () => {
              const nextPath = pendingExePath
              setLaunchPreflightOpen(false)
              setLaunchPreflightResult(null)
              await handleLaunchWithShortcutCheck(nextPath, { skipPreflight: true })
            }
          : undefined}
      />
      <GameLaunchFailedModal
        open={gameStartFailedOpen}
        gameName={game.name}
        onClose={() => setGameStartFailedOpen(false)}
      />

      {/* Universal right-click menu — appears on every card site-wide. */}
      <GameActionContextMenu
        open={contextMenuPos != null}
        position={contextMenuPos}
        onClose={closeContextMenu}
        gameName={game.name}
        gameSource={game.source}
        isExternal={false}
        // Library-only actions are not wired here — the LibraryPage's own
        // context menu (with delete, executable picker, etc.) takes over
        // when right-clicking inside the library grid.
        onSetExecutable={null}
        onOpenFiles={isInstalled && installedPath ? () => { closeContextMenu(); openPath(installedPath) } : null}
        onCreateShortcut={null}
        onDelete={null}
        wishlist={accountLists.authed === false ? undefined : {
          inList: accountLists.wishlist.has(game.appid),
          toggle: () => { void accountLists.toggleWishlist(game.appid, game.name) },
        }}
        favorites={accountLists.authed === false ? undefined : {
          inList: accountLists.favorites.has(game.appid),
          toggle: () => { void accountLists.toggleFavorite(game.appid, game.name) },
        }}
        collectionPicker={collectionPicker}
      />
    </div>
  )
})
