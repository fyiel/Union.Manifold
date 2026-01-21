import { memo, useCallback, useEffect, useState, type MouseEvent } from "react"
import { Link } from "react-router-dom"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Calendar, HardDrive, Download, Eye, Wifi, Flame, Play, Square } from "lucide-react"
import { formatNumber, hasOnlineMode, pickGameExecutable, proxyImageUrl } from "@/lib/utils"
import { useDownloads } from "@/context/downloads-context"
import { apiUrl } from "@/lib/api"
import { ExePickerModal } from "@/components/ExePickerModal"

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
  const [hoveredStats, setHoveredStats] = useState<{ downloads: number; views: number } | null>(null)
  const [isLoadingStats, setIsLoadingStats] = useState(false)
  const isCompact = size === "compact"

  const genres = Array.isArray(game.genres) ? game.genres : []
  const isNSFW = genres.some((genre) => genre.toLowerCase() === "nsfw")
  const displayStats = initialStats || hoveredStats || { downloads: 0, views: 0 }

  const { openPath, downloads } = useDownloads()
  const [installedPath, setInstalledPath] = useState<string | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [exePickerOpen, setExePickerOpen] = useState(false)
  const [exePickerExes, setExePickerExes] = useState<Array<{ name: string; path: string }>>([])

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
    const interval = setInterval(checkRunning, 2000)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [game.appid])

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

  const appDownloads = downloads.filter((item) => item.appid === game.appid)
  const hasActive = appDownloads.some((item) =>
    ["downloading", "paused", "extracting", "installing"].includes(item.status)
  )
  const isCancelled = appDownloads.some((item) => item.status === "cancelled")
  const isQueuedOnly = appDownloads.length > 0 && appDownloads.every((item) => item.status === "queued")
  const isQueued = isQueuedOnly && !hasActive
  const isInstalling = hasActive && !isCancelled

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
    } catch {}
  }

  const openExePicker = (exes: Array<{ name: string; path: string }>) => {
    setExePickerExes(exes)
    setExePickerOpen(true)
  }

  const handleExePicked = async (path: string) => {
    if (!window.ucDownloads?.launchGameExecutable) return
    const res = await window.ucDownloads.launchGameExecutable(game.appid, path)
    if (res && res.ok) {
      await setSavedExe(path)
      setIsRunning(true)
      setExePickerOpen(false)
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
        console.error('[UC] Failed to quit game:', err)
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
        const res = await window.ucDownloads.launchGameExecutable(game.appid, savedExe)
        if (res && res.ok) {
          setIsRunning(true)
          return
        }
        await setSavedExe(null)
      }
      const result = await window.ucDownloads.listGameExecutables(game.appid)
      const exes = result?.exes || []
      const { pick, confident } = pickGameExecutable(exes, game.name, game.source)
      if (pick && confident) {
        const res = await window.ucDownloads.launchGameExecutable(game.appid, pick.path)
        if (res && res.ok) {
          await setSavedExe(pick.path)
          setIsRunning(true)
          return
        }
      }
      openExePicker(exes)
    } catch {
      if (installedPath) openPath(installedPath)
    }
  }

  return (
    <div className="relative group/container">
      <Link to={`/game/${game.appid}`}>
        <Card
          className={`group overflow-hidden transition-all duration-500 hover:scale-[1.02] hover:shadow-2xl hover:shadow-primary/20 bg-card/95 backdrop-blur-sm border-2 border-border/50 hover:border-primary/50 flex flex-col h-full ${
            isCompact ? "rounded-2xl" : "rounded-3xl"
          }`}
          onMouseEnter={fetchStatsOnHover}
        >
          <div className={`relative overflow-hidden ${isCompact ? "aspect-[4/5]" : "aspect-[3/4]"}`}>
            <img
              src={proxyImageUrl((typeof navigator !== 'undefined' && !navigator.onLine && previewImage) ? previewImage : game.image) || "/banner.png"}
              alt={game.name}
              className={`h-full w-full object-cover transition-all duration-500 group-hover:scale-105 group-hover:brightness-110 ${
                isNSFW ? "blur-md" : ""
              }`}
              loading="lazy"
            />
            {isNSFW && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                <div className="bg-red-600 text-white px-4 py-2 rounded-full text-sm font-bold">18+</div>
              </div>
            )}
            {isInstalled && (
              <div className="absolute inset-0 z-20 flex items-center justify-center">
                <button
                  onClick={handlePlayClick}
                  className={`group/play relative inline-flex items-center justify-center h-14 w-14 rounded-full shadow-lg transition-transform duration-300 hover:scale-110 hover:shadow-xl ${
                    isRunning
                      ? "bg-destructive text-destructive-foreground shadow-destructive/40 hover:shadow-destructive/60"
                      : "bg-primary text-primary-foreground shadow-primary/40 hover:shadow-primary/60"
                  }`}
                >
                  <span className={`absolute inset-0 rounded-full opacity-0 transition-opacity duration-300 group-hover/play:opacity-100 blur-lg ${
                    isRunning ? "bg-destructive/20" : "bg-primary/20"
                  }`} />
                  <span className={`absolute -inset-2 rounded-full border opacity-0 transition-opacity duration-300 group-hover/play:opacity-100 ${
                    isRunning ? "border-destructive/40" : "border-primary/40"
                  }`} />
                  {isRunning ? <Square className="relative h-6 w-6" /> : <Play className="relative h-6 w-6" />}
                </button>
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-60 group-hover:opacity-80 transition-opacity duration-300" />

            {isQueued || isInstalling ? (
              <div className="absolute top-3 left-3 z-20">
                <div className="inline-flex items-center gap-2 rounded-full bg-sky-500/90 px-3 py-1.5 text-xs font-semibold text-white shadow-lg shadow-sky-500/40">
                  <Download className="h-4 w-4" />
                  {isQueued ? "Queued" : "Installing"}
                </div>
              </div>
            ) : null}

            {isPopular && (
              <div className="absolute top-3 left-3 z-20">
                <div className="inline-flex items-center gap-2 overflow-hidden rounded-full transition-all duration-300 ease-out bg-gradient-to-r from-orange-600/90 to-red-600/90 backdrop-blur-sm px-3 py-1.5 shadow-lg shadow-orange-500/50 group-hover/container:shadow-xl group-hover/container:shadow-orange-500/70">
                  <Flame className="flex-none h-5 w-5 text-white animate-pulse" />
                  <span className="text-sm font-bold text-white">Popular</span>
                </div>
              </div>
            )}

            {hasOnlineMode(game.hasCoOp) && (
              <div className={`absolute z-20 ${isPopular || isInstalling || isQueued ? "top-14 left-3" : "top-3 left-3"}`}>
                <div className="inline-flex items-center gap-2 overflow-hidden rounded-full transition-all duration-300 ease-out bg-gradient-to-r from-emerald-600/90 to-green-600/90 backdrop-blur-sm px-3 py-1.5 shadow-lg shadow-emerald-500/50 group-hover/container:shadow-xl group-hover/container:shadow-emerald-500/70">
                  <Wifi className="flex-none h-5 w-5 text-white animate-pulse" />
                  <span className="text-sm font-bold text-white">Online</span>
                </div>
              </div>
            )}

            <div className="absolute bottom-3 left-3 right-3 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-2 group-hover:translate-y-0">
              <div className="flex flex-col gap-2 bg-black/80 backdrop-blur-md rounded-2xl p-3 border border-white/10">
                <div className="flex items-center justify-between text-white text-sm">
                  <div className="flex items-center gap-2">
                    <div className="bg-primary/20 rounded-lg p-1.5">
                      <Eye className="h-4 w-4 text-primary" />
                    </div>
                    <span className="font-semibold">{formatNumber(displayStats.views)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="bg-primary/20 rounded-lg p-1.5">
                      <Download className="h-4 w-4 text-primary" />
                    </div>
                    <span className="font-semibold">{formatNumber(displayStats.downloads)}</span>
                  </div>
                </div>
                {isInstalled && (
                  <div className="mt-2 flex justify-end text-xs text-white/80">
                    Installed
                  </div>
                )}
              </div>
            </div>
          </div>
          <CardContent className={`${isCompact ? "p-4" : "p-6"} flex-1 flex flex-col`}>
            <h3
              className={`font-bold line-clamp-1 text-card-foreground font-montserrat group-hover:text-primary transition-colors duration-300 ${
                isCompact ? "text-lg mb-1" : "text-xl mb-2"
              }`}
            >
              {game.name}
            </h3>
            <p
              className={`text-muted-foreground leading-relaxed flex-1 ${
                isCompact ? "text-xs mb-3 line-clamp-1" : "text-sm mb-4 line-clamp-2"
              }`}
            >
              {game.description}
            </p>

            <div className={`flex flex-wrap gap-2 ${isCompact ? "mb-3" : "mb-4"}`}>
              {genres.slice(0, isCompact ? 1 : 2).map((genre) => (
                <Badge
                  key={genre}
                  variant="secondary"
                  className={`text-xs rounded-full bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 transition-colors ${
                    isCompact ? "px-2.5 py-0.5" : "px-3 py-1"
                  }`}
                >
                  {genre}
                </Badge>
              ))}
              {genres.length > (isCompact ? 1 : 2) && (
                <Badge
                  variant="outline"
                  className={`text-xs rounded-full border-primary/30 text-primary ${
                    isCompact ? "px-2.5 py-0.5" : "px-3 py-1"
                  }`}
                >
                  +{genres.length - (isCompact ? 1 : 2)}
                </Badge>
              )}
            </div>

            <div
              className={`flex items-center justify-between text-muted-foreground border-t border-border/50 ${
                isCompact ? "pt-2 text-xs" : "pt-3 text-sm"
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="bg-primary/10 rounded-lg p-1.5">
                  <Calendar className="h-3.5 w-3.5 text-primary" />
                </div>
                <span className="font-medium">
                  {(() => {
                    const year = new Date(game.release_date).getFullYear()
                    return isNaN(year) ? "Unknown" : year
                  })()}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="bg-primary/10 rounded-lg p-1.5">
                  <HardDrive className="h-3.5 w-3.5 text-primary" />
                </div>
                <span className="font-medium">{game.size}</span>
              </div>
            </div>

            <div className={isCompact ? "mt-2" : "mt-3"}>
              <Badge
                variant="outline"
                className={`text-xs rounded-full border-primary/30 text-primary bg-primary/5 ${
                  isCompact ? "px-2.5 py-0.5" : "px-3 py-1"
                }`}
              >
                {game.source}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </Link>
      <ExePickerModal
        open={exePickerOpen}
        title="Select executable"
        message={`We couldn't confidently detect the correct exe for "${game.name}". Please choose the one to launch.`}
        exes={exePickerExes}
        onSelect={handleExePicked}
        onClose={() => setExePickerOpen(false)}
      />
    </div>
  )
})
