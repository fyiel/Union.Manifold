
import { useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { GameCard } from "@/components/GameCard"
import { GameComments } from "@/components/GameComments"
import { useDownloads } from "@/context/downloads-context"
import { apiUrl } from "@/lib/api"
import { formatNumber, hasOnlineMode, pickGameExecutable, proxyImageUrl } from "@/lib/utils"
import type { Game } from "@/lib/types"
import { useGamesData } from "@/hooks/use-games"
import { addViewedGameToHistory, hasCookieConsent } from "@/lib/user-history"
import {
  AlertTriangle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  Flame,
  HardDrive,
  RefreshCw,
  ShieldCheck,
  Square,
  User,
  Wifi,
  X,
} from "lucide-react"
import { ExePickerModal } from "@/components/ExePickerModal"

export function GameDetailPage() {
  const params = useParams()
  const { startGameDownload, resumeGroup, downloads, clearByAppid } = useDownloads()
  const { games, stats } = useGamesData()
  const [game, setGame] = useState<Game | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloadCount, setDownloadCount] = useState(0)
  const [viewCount, setViewCount] = useState(0)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [selectedImage, setSelectedImage] = useState<string>("")
  const [installedManifest, setInstalledManifest] = useState<any | null>(null)
  const [installingManifest, setInstallingManifest] = useState<any | null>(null)
  const [exePickerOpen, setExePickerOpen] = useState(false)
  const [exePickerExes, setExePickerExes] = useState<Array<{ name: string; path: string }>>([])
  const [isGameRunning, setIsGameRunning] = useState(false)
  const [stoppingGame, setStoppingGame] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)

  const appid = params.id || ""

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        const response = await fetch(apiUrl(`/api/games/${encodeURIComponent(appid)}`))
        if (!response.ok) {
          throw new Error(`Unable to load game (${response.status})`)
        }
        const data = await response.json()
        setGame(data)
        setSelectedImage(data.splash || data.image)
      } catch (err) {
        // Try fallback: ask main process for installed manifest
        try {
          if (window.ucDownloads?.getInstalledGlobal || window.ucDownloads?.getInstalled) {
            const manifest = await (window.ucDownloads.getInstalledGlobal?.(appid) || window.ucDownloads.getInstalled(appid))
            if (manifest && manifest.metadata) {
              // prefer a locally stored image when offline
              const meta = manifest.metadata
              const localImg = meta.localImage || meta.image
              setGame(meta)
              setSelectedImage(localImg || meta.splash || meta.image)
              setError(null)
              return
            }
          }
        } catch {}
        setError(err instanceof Error ? err.message : "Failed to load game")
      } finally {
        setLoading(false)
      }
    }

    if (appid) {
      load()
    }
  }, [appid])

  useEffect(() => {
    if (!appid) return
    let mounted = true
    const loadStatus = async () => {
      try {
        const [installed, installing] = await Promise.all([
          window.ucDownloads?.getInstalledGlobal?.(appid) || window.ucDownloads?.getInstalled?.(appid) || null,
          window.ucDownloads?.getInstallingGlobal?.(appid) || window.ucDownloads?.getInstalling?.(appid) || null,
        ])
        if (!mounted) return
        setInstalledManifest(installed)
        setInstallingManifest(installing)
      } catch {
        if (!mounted) return
        setInstalledManifest(null)
        setInstallingManifest(null)
      }
    }
    loadStatus()
    return () => {
      mounted = false
    }
  }, [appid, downloads])

  useEffect(() => {
    if (!appid) return

    const fetchCounts = async () => {
      try {
        const downloadsRes = await fetch(apiUrl(`/api/downloads/count/${encodeURIComponent(appid)}`))
        if (downloadsRes.ok) {
          const data = await downloadsRes.json()
          if (data.success) setDownloadCount(data.downloads || 0)
        }
        const viewsRes = await fetch(apiUrl(`/api/views/${encodeURIComponent(appid)}`))
        if (viewsRes.ok) {
          const data = await viewsRes.json()
          if (data.success) setViewCount(data.viewCount || 0)
        }
      } catch (err) {
        console.error("[UC] Failed to fetch counts", err)
      }
    }

    fetchCounts()
  }, [appid])

  useEffect(() => {
    if (!appid) return
    fetch(apiUrl(`/api/views/${encodeURIComponent(appid)}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    })
      .then(() => {
        if (hasCookieConsent()) addViewedGameToHistory(appid)
      })
      .catch(() => {})
  }, [appid])

  useEffect(() => {
    if (!appid || !window.ucDownloads?.getRunningGame) return
    let mounted = true
    const refresh = async () => {
      try {
        const res = await window.ucDownloads?.getRunningGame?.(appid)
        if (!mounted) return
        setIsGameRunning(Boolean(res && res.ok && res.running))
      } catch {
        if (!mounted) return
        setIsGameRunning(false)
      }
    }
    void refresh()
    const timer = setInterval(refresh, 3000)
    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [appid])

  const openLightbox = (index: number) => {
    setLightboxIndex(index)
    setLightboxOpen(true)
  }

  const closeLightbox = () => {
    setLightboxOpen(false)
  }

  const nextLightbox = () => {
    if (!game?.screenshots || game.screenshots.length === 0) return
    setLightboxIndex((prev) => (prev + 1) % game.screenshots.length)
  }

  const prevLightbox = () => {
    if (!game?.screenshots || game.screenshots.length === 0) return
    setLightboxIndex((prev) => (prev - 1 + game.screenshots.length) % game.screenshots.length)
  }

  useEffect(() => {
    if (!lightboxOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox()
      if (e.key === "ArrowRight") nextLightbox()
      if (e.key === "ArrowLeft") prevLightbox()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [lightboxOpen])

  const startDownload = async () => {
    if (!game) return
    const isCancelled = downloads.some((item) => item.appid === game.appid && item.status === "cancelled")
    const hasFailedDownload = downloads.some(
      (item) => item.appid === game.appid && ["failed", "extract_failed"].includes(item.status)
    )
    const hasFailedInstall = installingManifest?.installStatus === "failed"
    if (installedManifest || (installingManifest && !isCancelled && !hasFailedInstall && !hasFailedDownload)) return
    if (installingManifest && (isCancelled || hasFailedInstall)) {
      try {
        await window.ucDownloads?.deleteInstalling?.(game.appid)
      } catch {}
      setInstallingManifest(null)
    }
    if (hasFailedDownload) {
      clearByAppid(game.appid)
    }
    setDownloadError(null)
    setDownloading(true)
    try {
      await startGameDownload(game)
      setDownloadCount((prev) => prev + 1)
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Failed to start download")
    } finally {
      setDownloading(false)
    }
  }

  const launchInstalledGame = async () => {
    if (!game) return
    if (!window.ucDownloads?.listGameExecutables || !window.ucDownloads?.launchGameExecutable) return
    try {
      const savedExe = await getSavedExe()
      if (savedExe) {
        const res = await window.ucDownloads.launchGameExecutable(game.appid, savedExe)
        if (res && res.ok) {
          setIsGameRunning(true)
          return
        }
        await setSavedExe(null)
      }
      const result = await window.ucDownloads.listGameExecutables(game.appid)
      const exes = result?.exes || []
      const { pick, confident } = pickGameExecutable(exes, game.name)
      if (pick && confident) {
        const res = await window.ucDownloads.launchGameExecutable(game.appid, pick.path)
        if (res && res.ok) {
          await setSavedExe(pick.path)
          setIsGameRunning(true)
          return
        }
      }
      openExePicker(exes)
    } catch {}
  }
  const popularAppIds = useMemo(() => {
    const withStats = games.filter((g) => {
      const st = stats[g.appid]
      return st && (st.downloads > 0 || st.views > 0)
    })
    const sorted = [...withStats].sort((a, b) => {
      const statsA = stats[a.appid] || { downloads: 0, views: 0 }
      const statsB = stats[b.appid] || { downloads: 0, views: 0 }
      if (statsA.downloads !== statsB.downloads) return statsB.downloads - statsA.downloads
      return statsB.views - statsA.views
    })
    return new Set(sorted.slice(0, 8).map((g) => g.appid))
  }, [games, stats])

  const relatedGames = useMemo(() => {
    if (!game) return []
    const currentGenres = new Set(game.genres.map((genre) => genre.toLowerCase()))
    const isCurrentNSFW = currentGenres.has("nsfw")
    const candidates = games.filter((g) => g.appid !== game.appid)
    const filtered = candidates.filter((g) => {
      const genres = g.genres.map((genre) => genre.toLowerCase())
      const isNsfw = genres.includes("nsfw")
      if (isCurrentNSFW && !isNsfw) return false
      if (!isCurrentNSFW && isNsfw) return false
      return genres.some((genre) => currentGenres.has(genre))
    })
    return filtered.slice(0, 4)
  }, [game, games])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (error || !game) {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {error || "Unable to load this game."}
      </div>
    )
  }

  const effectiveDownloadCount = downloadCount || stats[game.appid]?.downloads || 0
  const effectiveViewCount = viewCount || stats[game.appid]?.views || 0
  const isPopular = popularAppIds.has(game.appid)
  const appDownloads = downloads.filter((item) => item.appid === game.appid)
  const isActiveDownload = appDownloads.some((item) =>
    ["downloading", "paused", "extracting", "installing"].includes(item.status)
  )
  const isActivelyDownloading = appDownloads.some((item) =>
    ["downloading", "extracting", "installing"].includes(item.status)
  )
  const isPaused = appDownloads.some((item) => item.status === "paused") && !isActivelyDownloading
  const isQueuedOnly = appDownloads.length > 0 && appDownloads.every((item) => item.status === "queued")
  const isQueued = isQueuedOnly && !isActiveDownload
  const failedDownload = appDownloads.find((item) => ["failed", "extract_failed"].includes(item.status))
  const isFailed = Boolean(failedDownload) && !isActiveDownload && !isPaused && !isQueued
  const isCancelled = downloads.some((item) => item.appid === game.appid && item.status === "cancelled")
  const isInstalled = Boolean(installedManifest)
  const isInstalling =
    (Boolean(installingManifest) && !isCancelled && !isFailed && !isPaused) || (isActivelyDownloading && !isCancelled) || (downloading && !isCancelled)
  const actionLabel = isInstalled
    ? "Play"
    : isPaused
      ? "Resume"
      : isQueued
        ? "Queued"
        : isFailed
          ? "Download failed"
          : isInstalling
            ? "Installing"
            : "Download Now"
  const actionDisabled = isInstalling || isQueued || isFailed

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
      setExePickerOpen(false)
      setIsGameRunning(true)
    }
  }

  const stopRunningGame = async () => {
    if (!window.ucDownloads?.quitGameExecutable) return
    setStoppingGame(true)
    try {
      await window.ucDownloads.quitGameExecutable(game.appid)
      setIsGameRunning(false)
    } catch {}
    setStoppingGame(false)
  }

  return (
    <div className="space-y-12">
      <section className="relative">
        <div className="container mx-auto px-4">
          <div className="max-w-6xl mx-auto">
            <div className="relative rounded-3xl overflow-hidden border border-border/50 bg-card/30 backdrop-blur-sm">
              <div className="relative aspect-video">
                <img
                  src={proxyImageUrl(selectedImage || game.splash || game.image) || "/banner.png"}
                  alt={game.name}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
              </div>

              <div className="absolute bottom-0 left-0 right-0 p-8">
                <div className="flex flex-wrap gap-2 mb-4">
                  {game.genres?.map((genre) => (
                    <Badge
                      key={genre}
                      variant={genre.toLowerCase() === "nsfw" ? "destructive" : "default"}
                      className="px-3 py-1 rounded-full bg-primary/20 border-primary/30 text-primary font-semibold"
                    >
                      {genre}
                    </Badge>
                  ))}
                  {isPopular && (
                    <Badge className="px-3 py-1 rounded-full bg-orange-500/20 border-orange-500/30 text-orange-400 font-semibold flex items-center gap-1.5">
                      <Flame className="h-3 w-3" />
                      Popular
                    </Badge>
                  )}
                  {hasOnlineMode(game.hasCoOp) && (
                    <Badge className="px-3 py-1 rounded-full bg-emerald-500/20 border-emerald-500/30 text-emerald-400 font-semibold flex items-center gap-1.5">
                      <Wifi className="h-3 w-3" />
                      Online
                    </Badge>
                  )}
                </div>

                <h1 className="text-4xl md:text-6xl font-black text-foreground font-montserrat mb-3 text-balance">
                  {game.name}
                </h1>
                <p className="text-lg text-muted-foreground flex items-center gap-2">
                  <User className="h-4 w-4" />
                  {game.developer || "Unknown Developer"}
                </p>
              </div>
            </div>

          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-12">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-8">
              <div className="p-8 rounded-2xl bg-card/30 border border-border/50">
                <h2 className="text-2xl font-black text-foreground font-montserrat mb-4">About This Game</h2>
                <p className="text-base text-muted-foreground leading-relaxed whitespace-pre-wrap">
                  {game.description}
                </p>
              </div>

              {game.screenshots && game.screenshots.length > 0 && (
                <div className="p-6 rounded-2xl bg-card/30 border border-border/50">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-black text-foreground">Screenshots</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">{game.screenshots.length} images</span>
                      <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => openLightbox(0)}>
                        View All
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {game.screenshots.slice(0, 6).map((screenshot, index) => (
                      <button
                        key={`${screenshot}-${index}`}
                        onClick={() => openLightbox(index)}
                        className="relative w-full aspect-video rounded-lg overflow-hidden border border-border/60 hover:scale-[1.02] transition-transform"
                        aria-label={`Open screenshot ${index + 1}`}
                      >
                        <img
                          src={proxyImageUrl(screenshot) || "/banner.png"}
                          alt={`Screenshot ${index + 1}`}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      </button>
                    ))}

                    {game.screenshots.length > 6 && (
                      <button
                        onClick={() => openLightbox(6)}
                        className="relative col-span-2 sm:col-auto w-full aspect-video rounded-lg overflow-hidden border border-border/60 flex items-center justify-center bg-background/50"
                        aria-label="View more screenshots"
                      >
                        <div className="text-center">
                          <div className="text-lg font-bold">+{game.screenshots.length - 6}</div>
                          <div className="text-sm text-muted-foreground">more</div>
                        </div>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {game.dlc && game.dlc.length > 0 && (
                <div className="p-8 rounded-2xl bg-card/30 border border-border/50">
                  <h2 className="text-2xl font-black text-foreground font-montserrat mb-4">
                    Included DLC ({game.dlc.length})
                  </h2>
                  <ul className="space-y-2">
                    {game.dlc.map((dlc, index) => (
                      <li key={`${dlc}-${index}`} className="flex items-center gap-2 text-muted-foreground">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                        {dlc}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {game.comment && (
                <div className="p-6 rounded-2xl bg-primary/10 border border-primary/20">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-semibold text-foreground mb-1">Important Note</h3>
                      <p className="text-sm text-muted-foreground">{game.comment}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-4">
              <div className="p-6 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30">
                <Button
                  size="lg"
                  className="w-full font-bold text-lg py-6 rounded-xl bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25"
                  onClick={() => {
                    if (isInstalled) {
                      void launchInstalledGame()
                    } else if (isPaused) {
                      void resumeGroup(game.appid)
                    } else {
                      void startDownload()
                    }
                  }}
                  disabled={actionDisabled}
                >
                  <Download className="mr-2 h-5 w-5" />
                  {actionLabel}
                </Button>

                {isFailed && (
                  <Button
                    variant="secondary"
                    className="mt-3 w-full"
                    onClick={() => void startDownload()}
                    disabled={downloading}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Retry
                  </Button>
                )}

                {isGameRunning && (
                  <Button
                    variant="destructive"
                    className="mt-3 w-full"
                    onClick={() => void stopRunningGame()}
                    disabled={stoppingGame}
                  >
                    <Square className="mr-2 h-4 w-4" />
                    Quit Game
                  </Button>
                )}

                {(downloadError || failedDownload?.error) && (
                  <div className="mt-3 text-xs text-destructive">{downloadError || failedDownload?.error}</div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 rounded-xl bg-card/30 border border-border/50 text-center">
                  <Download className="h-5 w-5 text-primary mx-auto mb-2" />
                  <div className="text-2xl font-black text-foreground font-montserrat">
                    {formatNumber(effectiveDownloadCount)}
                  </div>
                  <div className="text-xs text-muted-foreground">Downloads</div>
                </div>

                <div className="p-4 rounded-xl bg-card/30 border border-border/50 text-center">
                  <Eye className="h-5 w-5 text-primary mx-auto mb-2" />
                  <div className="text-2xl font-black text-foreground font-montserrat">
                    {formatNumber(effectiveViewCount)}
                  </div>
                  <div className="text-xs text-muted-foreground">Views</div>
                </div>
              </div>

              <div className="p-6 rounded-2xl bg-card/30 border border-border/50 space-y-4">
                <h3 className="font-black text-foreground font-montserrat">Details</h3>

                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      Released
                    </span>
                    <span className="font-semibold text-foreground">
                      {(() => {
                        const date = new Date(game.release_date)
                        return isNaN(date.getTime()) ? game.release_date : date.toLocaleDateString()
                      })()}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground flex items-center gap-2">
                      <HardDrive className="h-4 w-4" />
                      Size
                    </span>
                    <span className="font-semibold text-foreground">{game.size || "Unknown"}</span>
                  </div>

                  {game.version && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Version</span>
                      <span className="font-semibold text-foreground">{game.version}</span>
                    </div>
                  )}

                  {game.update_time && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Updated</span>
                      <span className="font-semibold text-foreground">
                        {(() => {
                          const date = new Date(game.update_time)
                          return isNaN(date.getTime()) ? game.update_time : date.toLocaleDateString()
                        })()}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4" />
                      Source
                    </span>
                    <span className="font-semibold text-foreground">{game.source || "Unknown"}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <GameComments appid={game.appid} gameName={game.name} />

      {relatedGames.length > 0 && (
        <section className="py-16 px-4 bg-card/20">
          <div className="container mx-auto max-w-7xl">
            <h2 className="text-3xl md:text-4xl font-black text-foreground font-montserrat mb-8">
              You May Also Like
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {relatedGames.map((relatedGame) => (
                <GameCard
                  key={relatedGame.appid}
                  game={relatedGame}
                  stats={stats[relatedGame.appid]}
                  isPopular={popularAppIds.has(relatedGame.appid)}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {game.screenshots && lightboxOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/80 z-50" onClick={closeLightbox} aria-hidden="true" />

          <button
            className="absolute top-6 right-6 z-60 bg-background/60 rounded-full p-2"
            onClick={closeLightbox}
            aria-label="Close"
          >
            <X className="h-5 w-5 text-foreground" />
          </button>

          <button
            onClick={prevLightbox}
            className="absolute left-6 z-60 p-2 rounded-full bg-background/60"
            aria-label="Previous"
          >
            <ChevronLeft className="h-6 w-6 text-foreground" />
          </button>

          <div className="relative z-60 max-w-[95vw] max-h-[88vh] flex items-center justify-center px-4 pointer-events-auto">
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-full max-w-[1200px] max-h-[80vh] flex items-center justify-center">
                <img
                  src={proxyImageUrl(game.screenshots[lightboxIndex]) || "/banner.png"}
                  alt={`Screenshot ${lightboxIndex + 1}`}
                  className="max-w-full max-h-full object-contain mx-auto"
                />
              </div>
            </div>
          </div>

          <button
            onClick={nextLightbox}
            className="absolute right-6 z-60 p-2 rounded-full bg-background/60"
            aria-label="Next"
          >
            <ChevronRight className="h-6 w-6 text-foreground" />
          </button>

          <div className="absolute bottom-6 text-center text-sm text-muted-foreground z-60">
            {`${lightboxIndex + 1} / ${game.screenshots.length}`}
          </div>
        </div>
      )}
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
}
