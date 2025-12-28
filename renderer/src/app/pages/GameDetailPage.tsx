
import { useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { GameCard } from "@/components/GameCard"
import { useDownloads } from "@/context/downloads-context"
import { apiUrl } from "@/lib/api"
import { formatNumber, hasOnlineMode, proxyImageUrl } from "@/lib/utils"
import type { Game } from "@/lib/types"
import { useGamesData } from "@/hooks/use-games"
import { addViewedGameToHistory, hasCookieConsent } from "@/lib/user-history"
import { AlertTriangle, Calendar, Download, Eye, Flame, HardDrive, ShieldCheck, User, Wifi } from "lucide-react"

export function GameDetailPage() {
  const params = useParams()
  const { startGameDownload, downloads } = useDownloads()
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

  const startDownload = async () => {
    if (!game) return
    if (installedManifest || installingManifest) return
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
        const res = await window.ucDownloads.launchGameExecutable(savedExe)
        if (res && res.ok) return
        await setSavedExe(null)
      }
      const result = await window.ucDownloads.listGameExecutables(game.appid)
      const exes = result?.exes || []
      const pick = pickExe(exes)
      if (pick) {
        const res = await window.ucDownloads.launchGameExecutable(pick.path)
        if (res && res.ok) {
          await setSavedExe(pick.path)
        }
      }
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
  const isActiveDownload = downloads.some(
    (item) =>
      item.appid === game.appid &&
      ["downloading", "paused", "extracting", "installing"].includes(item.status)
  )
  const isQueued = downloads.some((item) => item.appid === game.appid && item.status === "queued")
  const isCancelled = downloads.some((item) => item.appid === game.appid && item.status === "cancelled")
  const isInstalled = Boolean(installedManifest)
  const isInstalling = (Boolean(installingManifest) && !isCancelled) || isActiveDownload || downloading
  const actionLabel = isInstalled ? "Play" : isQueued ? "Queued" : isInstalling ? "Installing" : "Download Now"
  const actionDisabled = isInstalling || isQueued

  const pickExe = (exes: Array<{ name: string; path: string }>) => {
    if (!exes.length) return null
    const nameToken = game.name.toLowerCase().replace(/[^a-z0-9]+/g, "")
    const scored = exes.map((exe) => {
      const lower = exe.name.toLowerCase()
      const pathLower = exe.path.toLowerCase()
      let score = 0
      if (nameToken && (lower.includes(nameToken) || pathLower.includes(nameToken))) score += 5
      if (lower.includes("launcher")) score += 3
      if (lower.includes("game")) score += 2
      if (lower.includes("setup") || lower.includes("uninstall")) score -= 3
      return { exe, score }
    })
    scored.sort((a, b) => b.score - a.score)
    return scored[0].exe
  }

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
                  {game.hasCoOp && (
                    <Badge className="px-3 py-1 rounded-full bg-blue-500/20 border-blue-500/30 text-blue-400 font-semibold flex items-center gap-1.5">
                      <Wifi className="h-3 w-3" />
                      Co-op
                    </Badge>
                  )}
                  {isPopular && (
                    <Badge className="px-3 py-1 rounded-full bg-orange-500/20 border-orange-500/30 text-orange-400 font-semibold flex items-center gap-1.5">
                      <Flame className="h-3 w-3" />
                      Popular
                    </Badge>
                  )}
                  {hasOnlineMode(game.source) && (
                    <Badge className="px-3 py-1 rounded-full bg-emerald-500/20 border-emerald-500/30 text-emerald-300 font-semibold flex items-center gap-1.5">
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

            {game.screenshots && game.screenshots.length > 0 && (
              <div className="mt-8 space-y-4">
                <h2 className="text-xl font-semibold text-foreground">Screenshots</h2>
                <div className="flex gap-3 overflow-x-auto pb-2">
                  <button
                    onClick={() => setSelectedImage(game.splash || game.image)}
                    className={`relative flex-shrink-0 w-32 h-20 rounded-xl overflow-hidden border-2 transition-all ${
                      selectedImage === (game.splash || game.image)
                        ? "border-primary shadow-lg shadow-primary/25"
                        : "border-border/50 hover:border-primary/50"
                    }`}
                  >
                    <img
                      src={proxyImageUrl(game.splash || game.image) || "/banner.png"}
                      alt="Main"
                      className="h-full w-full object-cover"
                    />
                  </button>

                  {game.screenshots.map((screenshot, index) => (
                    <button
                      key={screenshot}
                      onClick={() => setSelectedImage(screenshot)}
                      className={`relative flex-shrink-0 w-32 h-20 rounded-xl overflow-hidden border-2 transition-all ${
                        selectedImage === screenshot
                          ? "border-primary shadow-lg shadow-primary/25"
                          : "border-border/50 hover:border-primary/50"
                      }`}
                    >
                      <img
                        src={proxyImageUrl(screenshot) || "/banner.png"}
                        alt={`Screenshot ${index + 1}`}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}
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
                    } else {
                      void startDownload()
                    }
                  }}
                  disabled={actionDisabled}
                >
                  <Download className="mr-2 h-5 w-5" />
                  {actionLabel}
                </Button>

                {downloadError && (
                  <div className="mt-3 text-xs text-destructive">{downloadError}</div>
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
    </div>
  )
}
