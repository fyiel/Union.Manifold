import { memo, useCallback, useEffect, useState, type MouseEvent } from "react"
import { Link } from "react-router-dom"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Calendar, HardDrive, Download, Eye, Wifi, Flame, Play, Square } from "lucide-react"
import { formatNumber, hasOnlineMode, pickGameExecutable, proxyImageUrl } from "@/lib/utils"
import { useDownloads, useDownloadsSelector } from "@/context/downloads-context"
import { apiUrl } from "@/lib/api"
import { ExePickerModal } from "@/components/ExePickerModal"
import { AdminPromptModal } from "@/components/AdminPromptModal"
import { DesktopShortcutModal } from "@/components/DesktopShortcutModal"
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
    developer?: string
    store?: string
    link?: string
    dlc?: string[]
    comment?: string
    hasCoOp?: boolean
  }
  stats?: {
    downloads: number
    views: number
  }
  isPopular?: boolean
  size?: "default" | "compact"
}

export const GameCard = memo(function GameCard({
  game,
  stats: initialStats,
  isPopular = false,
  size = "default",
}: GameCardProps) {
  const isWindows = typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent)
  const [hoveredStats, setHoveredStats] = useState<{ downloads: number; views: number } | null>(null)
  const [isLoadingStats, setIsLoadingStats] = useState(false)
  const isCompact = size === "compact"

  const genres = Array.isArray(game.genres) ? game.genres : []
  const displayGenres = genres.filter((genre) => String(genre).toLowerCase() !== "nsfw")
  const isNSFW = genres.some((genre) => genre.toLowerCase() === "nsfw")
  const [allowNsfwReveal, setAllowNsfwReveal] = useState(false)
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
      (prev, next) =>
        prev.isQueued === next.isQueued && prev.isInstalling === next.isInstalling,
      []
    )
  )
  const [installedPath, setInstalledPath] = useState<string | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [exePickerOpen, setExePickerOpen] = useState(false)
  const [exePickerExes, setExePickerExes] = useState<Array<{ name: string; path: string; size?: number; depth?: number }>>([])
  const [exePickerFolder, setExePickerFolder] = useState<string | null>(null)
  const [adminPromptOpen, setAdminPromptOpen] = useState(false)
  const [pendingExePath, setPendingExePath] = useState<string | null>(null)
  const [shortcutModalOpen, setShortcutModalOpen] = useState(false)

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

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        if (mounted) {
          setInstalledPath(null)
          setIsInstalled(false)
        }
        if (window.ucDownloads?.getInstalledGlobal || window.ucDownloads?.getInstalled) {
          const manifest = await (window.ucDownloads.getInstalledGlobal?.(game.appid) || window.ucDownloads.getInstalled(game.appid))
          if (!mounted) return
          if (manifest) setIsInstalled(true)
          if (manifest && manifest.metadata) {
            // if manifest saved a local image, prefer it for display when offline
            const localImg = manifest.metadata.localImage || manifest.metadata.image
            if (localImg) {
              setPreviewImage(localImg)
            }
          }
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

  const getExeKey = (versionLabel?: string | null) =>
    versionLabel ? `gameExe:${game.appid}:${versionLabel}` : `gameExe:${game.appid}`

  const getSavedExe = async (versionLabel?: string | null, allowLegacyFallback: boolean = true) => {
    if (!window.ucSettings?.get) return null
    try {
      const key = getExeKey(versionLabel)
      const versioned = await window.ucSettings.get(key)
      if (versioned) return versioned
      if (versionLabel && allowLegacyFallback) {
        return await window.ucSettings.get(`gameExe:${game.appid}`)
      }
      return versioned
    } catch {
      return null
    }
  }

  const setSavedExe = async (path: string | null, versionLabel?: string | null) => {
    if (!window.ucSettings?.set) return
    try {
      const key = getExeKey(versionLabel)
      await window.ucSettings.set(key, path || null)
      if (!versionLabel) {
        await window.ucSettings.set(`gameExe:${game.appid}`, path || null)
      }
    } catch {}
  }

  const getAdminPromptShown = async () => {
    if (!isWindows) return true
    if (!window.ucSettings?.get) return false
    try {
      return await window.ucSettings.get('adminPromptShown')
    } catch {
      return false
    }
  }

  const setAdminPromptShown = async () => {
    if (!window.ucSettings?.set) return
    try {
      await window.ucSettings.set('adminPromptShown', true)
    } catch {}
  }

  const getRunAsAdminEnabled = async () => {
    if (!isWindows) return false
    if (!window.ucSettings?.get) return false
    try {
      return await window.ucSettings.get('runGamesAsAdmin')
    } catch {
      return false
    }
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
    } catch {}
  }

  const getAlwaysCreateShortcut = async () => {
    if (!window.ucSettings?.get) return false
    try {
      return await window.ucSettings.get('alwaysCreateDesktopShortcut')
    } catch {
      return false
    }
  }

  const createDesktopShortcut = async (exePath: string) => {
    if (!window.ucDownloads?.createDesktopShortcut) return
    try {
      try {
        await window.ucDownloads?.deleteDesktopShortcut?.(game.name)
      } catch {}
      const result = await window.ucDownloads.createDesktopShortcut(game.name, exePath)
      if (result?.ok) {
        gameLogger.info('Desktop shortcut created', { appid: game.appid })
      } else {
        gameLogger.error('Failed to create desktop shortcut', { data: result })
      }
    } catch (err) {
      gameLogger.error('Error creating desktop shortcut', { data: err })
    }
  }

  const getInstalledVersionLabels = async () => {
    try {
      if (!window.ucDownloads?.listInstalledByAppid) return []
      const list = await window.ucDownloads.listInstalledByAppid(game.appid)
      const labels = (Array.isArray(list) ? list : [])
        .map((manifest) => manifest?.metadata?.downloadedVersion || manifest?.metadata?.version || manifest?.version)
        .filter(Boolean)
        .map((label) => String(label))
      return Array.from(new Set(labels))
    } catch {
      return []
    }
  }

  const resolveCardVersionLabel = async () => {
    const labels = await getInstalledVersionLabels()
    if (labels.length === 1) return labels[0]
    return game.version || null
  }

  const listGameExecutablesWithFallback = async () => {
    if (!window.ucDownloads?.listGameExecutables) return null
    const preferredLabel = await resolveCardVersionLabel()
    let result = await window.ucDownloads.listGameExecutables(game.appid, preferredLabel || null)
    if (!result?.ok || !result.exes?.length) {
      result = await window.ucDownloads.listGameExecutables(game.appid)
    }
    return result
  }

  const openExePicker = (exes: Array<{ name: string; path: string; size?: number; depth?: number }>, folder?: string | null) => {
    setExePickerExes(exes)
    setExePickerFolder(folder || null)
    setExePickerOpen(true)
  }

  const launchGame = async (path: string, asAdmin: boolean = false) => {
    if (!window.ucDownloads) return
    const launchFn = asAdmin && isWindows
      ? window.ucDownloads.launchGameExecutableAsAdmin 
      : window.ucDownloads.launchGameExecutable
    
    if (!launchFn) return
    const showGameName = await window.ucSettings?.get?.('rpcShowGameName') ?? true
    const res = await launchFn(game.appid, path, game.name, showGameName)
    if (res && res.ok) {
      const preferredLabel = await resolveCardVersionLabel()
      await setSavedExe(path, preferredLabel)
      setIsRunning(true)
      setExePickerOpen(false)
      setAdminPromptOpen(false)
      setShortcutModalOpen(false)
      setPendingExePath(null)
    }
  }

  const handleAdminDecision = async (path: string, asAdmin: boolean) => {
    if (!isWindows) {
      await launchGame(path, false)
      return
    }
    await setAdminPromptShown()
    
    // Check if we should show shortcut modal BEFORE launching
    const alreadyAsked = await getShortcutAskedForGame()
    const alwaysCreate = await getAlwaysCreateShortcut()
    
    if (alwaysCreate && !alreadyAsked) {
      // Auto-create shortcut without asking, then launch
      await createDesktopShortcut(path)
      await setShortcutAskedForGame()
      await launchGame(path, asAdmin)
    } else if (!alreadyAsked && !alwaysCreate) {
      // Show the shortcut prompt BEFORE launching
      setPendingExePath(path)
      setAdminPromptOpen(false)
      setShortcutModalOpen(true)
      // Store asAdmin preference for later
      await window.ucSettings?.set?.('runGamesAsAdmin', asAdmin)
    } else {
      // No shortcut needed, just launch
      await launchGame(path, asAdmin)
    }
  }

  const handleExePicked = async (path: string) => {
    setPendingExePath(path)
    const promptShown = await getAdminPromptShown()
    const runAsAdminEnabled = await getRunAsAdminEnabled()
    
    if (!promptShown) {
      if (isWindows) {
        setAdminPromptOpen(true)
      } else {
        await launchGame(path, false)
      }
      setExePickerOpen(false)
    } else {
      await launchGame(path, runAsAdminEnabled)
    }
  }

  const handlePlayClick = async (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    
    // If game is running, stop it
    if (isRunning && window.ucDownloads?.quitGameExecutable) {
      try {
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
      const preferredLabel = await resolveCardVersionLabel()
      const installedLabels = await getInstalledVersionLabels()
      const allowLegacyFallback = installedLabels.length <= 1
      const savedExe = await getSavedExe(preferredLabel, allowLegacyFallback)
      const runAsAdminEnabled = await getRunAsAdminEnabled()
      
      if (savedExe) {
        await launchGame(savedExe, runAsAdminEnabled)
        return
      }
      
      const result = await listGameExecutablesWithFallback()
      if (!result) {
        if (installedPath) openPath(installedPath)
        return
      }
      const exes = result?.exes || []
      const folder = result?.folder || null
      const { pick, confident } = pickGameExecutable(exes, game.name, game.source, folder)
      if (pick && confident) {
        setPendingExePath(pick.path)
        const promptShown = await getAdminPromptShown()
        
        if (!promptShown) {
          if (isWindows) {
            setAdminPromptOpen(true)
          } else {
            await launchGame(pick.path, false)
          }
        } else {
          await launchGame(pick.path, runAsAdminEnabled)
        }
        return
      }
      openExePicker(exes, folder)
    } catch {
      if (installedPath) openPath(installedPath)
    }
  }

  return (
    <div className="relative group/container h-full">
      <Link to={`/game/${game.appid}`} className="block h-full">
        <Card
          className={`group relative h-full overflow-hidden border border-white/10 bg-black/40 backdrop-blur-md transition-all duration-500 hover:-translate-y-1 hover:shadow-[0_0_30px_rgba(var(--primary),0.15)] hover:border-primary/50 flex flex-col gap-0 py-0 ${
            isCompact ? "rounded-xl" : "rounded-2xl"
          }`}
          onMouseEnter={fetchStatsOnHover}
        >
          {/* Image Section */}
          <div className={`relative w-full overflow-hidden ${isCompact ? "aspect-[4/5]" : "aspect-[3/4]"}`}>
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent z-10 opacity-70 transition-opacity duration-300 group-hover:opacity-50" />
            
            <img
              src={proxyImageUrl((typeof navigator !== 'undefined' && !navigator.onLine && previewImage) ? previewImage : game.image) || "/banner.png"}
              alt={game.name}
              className={`h-full w-full object-cover transition-all duration-700 ease-in-out group-hover:scale-110 ${
                isNSFW
                  ? (allowNsfwReveal ? "blur-md group-hover:blur-none" : "blur-xl brightness-50")
                  : (imageLoaded ? "" : "blur-lg")
              }`}
              loading="lazy"
              onLoad={() => setImageLoaded(true)}
            />

            {/* NSFW Overlay */}
            {isNSFW && !isInstalled && !allowNsfwReveal && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                 <Badge variant="destructive" className="text-xs px-3 py-1">18+ NSFW</Badge>
              </div>
            )}

            {/* Play Button Overlay */}
            {isInstalled && (
              <div className="absolute inset-0 z-30 flex items-center justify-center">
                <button
                  onClick={handlePlayClick}
                  className={`group/play relative inline-flex items-center justify-center h-14 w-14 rounded-full shadow-[0_0_20px_rgba(var(--primary),0.5)] transition-transform duration-300 hover:scale-110 hover:shadow-[0_0_30px_rgba(var(--primary),0.7)] ${
                    isRunning
                      ? "bg-red-600 text-white shadow-red-500/40"
                      : "bg-primary text-primary-foreground"
                  }`}
                >
                  <span className={`absolute inset-0 rounded-full opacity-0 transition-opacity duration-300 group-hover/play:opacity-100 blur-lg ${
                    isRunning ? "bg-red-500/40" : "bg-primary/40"
                  }`} />
                  {isRunning ? <Square className="relative h-6 w-6 fill-current" /> : <Play className="relative h-6 w-6 fill-current ml-1" />}
                </button>
              </div>
            )}

            {/* Status Badges */}
            <div className="absolute top-3 left-3 z-30 flex flex-col gap-2">
                {(isQueued || isInstalling) && (
                  <Badge className="bg-sky-500 text-white border-none shadow-lg shadow-sky-500/40 animate-pulse">
                     <Download className="w-3 h-3 mr-1" />
                     {isQueued ? "Queued" : "Installing"}
                  </Badge>
                )}
                
                {isPopular && (
                  <Badge className="bg-primary/90 hover:bg-primary text-primary-foreground backdrop-blur-md shadow-[0_0_15px_rgba(var(--primary),0.4)] border-0 px-2 py-0.5 text-xs font-bold uppercase tracking-wider animate-in fade-in zoom-in duration-300">
                    <Flame className="w-3 h-3 mr-1 fill-current" /> Popular
                  </Badge>
                )}
                
                {hasOnlineMode(game.hasCoOp) && (
                  <Badge variant="online" className="px-2 py-0.5 text-xs font-semibold flex items-center gap-1">
                    <Wifi className="w-3 h-3 mr-1 text-green-400" />
                    <span className="text-white">Online</span>
                  </Badge>
                )}
            </div>

            {/* Hover Stats Overlay */}
            <div className="absolute bottom-0 left-0 right-0 z-20 p-4 translate-y-full transition-transform duration-300 ease-out group-hover:translate-y-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent pt-10">
                <div className="flex items-center justify-between text-xs font-medium text-white/90">
                  <div className="flex items-center gap-1.5 bg-black/40 rounded-full px-2 py-1 backdrop-blur-sm border border-white/10">
                    <Download className="w-3.5 h-3.5 text-primary" />
                    <span>{formatNumber(displayStats.downloads)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-black/40 rounded-full px-2 py-1 backdrop-blur-sm border border-white/10">
                    <Eye className="w-3.5 h-3.5 text-blue-400" />
                    <span>{formatNumber(displayStats.views)}</span>
                  </div>
                </div>
            </div>
          </div>

          {/* Content Section */}
          <CardContent className={`${isCompact ? "p-3" : "p-4"} flex-1 flex flex-col space-y-2 relative z-20 bg-background/5`}>
            <div className="space-y-1">
              <h3
                className={`font-bold leading-tight line-clamp-1 text-white group-hover:text-primary transition-colors duration-300 ${
                  isCompact ? "text-base" : "text-lg"
                }`}
              >
                {game.name}
              </h3>
              <div className="flex flex-wrap gap-1.5 h-5 overflow-hidden">
                 {displayGenres.slice(0, 2).map((genre) => (
                  <span 
                    key={genre} 
                    className="text-[10px] uppercase font-bold tracking-wider text-white/50 bg-white/5 px-1.5 py-0.5 rounded-sm whitespace-nowrap"
                  >
                    {genre}
                  </span>
                 ))}
              </div>
            </div>

             <div className="flex items-center justify-between text-xs text-white/60 pt-2 border-t border-white/5 mt-auto">
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>{game.release_date?.split("-")[0] || "N/A"}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <HardDrive className="w-3.5 h-3.5" />
                  <span>{game.size}</span>
                </div>
             </div>
          </CardContent>
        </Card>
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
      <AdminPromptModal
        open={adminPromptOpen}
        gameName={game.name}
        onRunAsAdmin={async () => {
          if (pendingExePath) {
            await handleAdminDecision(pendingExePath, true)
          }
        }}
        onContinueWithoutAdmin={async () => {
          if (pendingExePath) {
            await handleAdminDecision(pendingExePath, false)
          }
        }}
        onClose={() => {
          setAdminPromptOpen(false)
          setPendingExePath(null)
        }}
      />
      <DesktopShortcutModal
        open={shortcutModalOpen}
        gameName={game.name}
        onCreateShortcut={async () => {
          if (pendingExePath) {
            await createDesktopShortcut(pendingExePath)
            await setShortcutAskedForGame()
            const runAsAdmin = await getRunAsAdminEnabled()
            await launchGame(pendingExePath, runAsAdmin)
          }
        }}
        onSkip={async () => {
          await setShortcutAskedForGame()
          if (pendingExePath) {
            const runAsAdmin = await getRunAsAdminEnabled()
            await launchGame(pendingExePath, runAsAdmin)
          }
        }}
        onClose={async () => {
          await setShortcutAskedForGame()
          setShortcutModalOpen(false)
          setPendingExePath(null)
        }}
      />
    </div>
  )
})
