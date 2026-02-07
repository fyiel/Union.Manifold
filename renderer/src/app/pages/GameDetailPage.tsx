
import { useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { GameCard } from "@/components/GameCard"
import { GameComments } from "@/components/GameComments"
import { useDownloads } from "@/context/downloads-context"
import { apiUrl } from "@/lib/api"
import { getPreferredDownloadHost, setPreferredDownloadHost, type PreferredDownloadHost } from "@/lib/downloads"
import { formatNumber, hasOnlineMode, pickGameExecutable, proxyImageUrl } from "@/lib/utils"
import type { Game } from "@/lib/types"
import { useGamesData } from "@/hooks/use-games"
import { addViewedGameToHistory, hasCookieConsent } from "@/lib/user-history"
import { useOnlineStatus } from "@/hooks/use-online-status"
import { OfflineBanner } from "@/components/OfflineBanner"
import {
  AlertTriangle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  ExternalLink,
  Flame,
  HardDrive,
  RefreshCw,
  ShieldCheck,
  Settings,
  Square,
  Trash2,
  Unlink2,
  User,
  Wifi,
  X,
  FolderOpen,
  Info,
} from "lucide-react"
import { ExePickerModal } from "@/components/ExePickerModal"
import { AdminPromptModal } from "@/components/AdminPromptModal"
import { DownloadHostModal } from "@/components/DownloadHostModal"
import { DesktopShortcutModal } from "@/components/DesktopShortcutModal"
import { EditGameMetadataModal } from "@/components/EditGameMetadataModal"
import { gameLogger } from "@/lib/logger"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export function GameDetailPage() {
  const isWindows = typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent)
  const isOnline = useOnlineStatus()
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
  const [exePickerExes, setExePickerExes] = useState<Array<{ name: string; path: string; size?: number; depth?: number }>>([])
  const [isGameRunning, setIsGameRunning] = useState(false)
  const [stoppingGame, setStoppingGame] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)
  const [adminPromptOpen, setAdminPromptOpen] = useState(false)
  const [pendingExePath, setPendingExePath] = useState<string | null>(null)
  const [shortcutModalOpen, setShortcutModalOpen] = useState(false)
  const [hostSelectorOpen, setHostSelectorOpen] = useState(false)
  const [selectedHost, setSelectedHost] = useState<PreferredDownloadHost>("pixeldrain")
  const [defaultHost, setDefaultHost] = useState<PreferredDownloadHost>("pixeldrain")
  const [exePickerTitle, setExePickerTitle] = useState("Select executable")
  const [exePickerMessage, setExePickerMessage] = useState("We couldn't confidently detect the correct exe. Please choose the one to launch.")
  const [exePickerCurrentPath, setExePickerCurrentPath] = useState<string | null>(null)
  const [exePickerActionLabel, setExePickerActionLabel] = useState("Launch")
  const [exePickerFolder, setExePickerFolder] = useState<string | null>(null)
  const [exePickerMode, setExePickerMode] = useState<"launch" | "set">("launch")
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const [shortcutFeedback, setShortcutFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [pendingDeleteAction, setPendingDeleteAction] = useState<"installed" | "installing" | null>(null)
  const [editMetadataOpen, setEditMetadataOpen] = useState(false)

  const appid = params.id || ""

  const persistGameName = (id: string, name?: string | null) => {
    if (!id || !name) return
    try {
      localStorage.setItem(`uc_game_name:${id}`, name)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        setError(null)

        // External games don't exist on the API — load directly from local manifest
        const isExternalId = appid.startsWith('external-')

        if (!isExternalId) {
          const response = await fetch(apiUrl(`/api/games/${encodeURIComponent(appid)}`))
          if (!response.ok) {
            throw new Error(`Unable to load game (${response.status})`)
          }
          const data = await response.json()
          setGame(data)
          persistGameName(appid, data?.name)
          window.dispatchEvent(new CustomEvent("uc_game_name", { detail: { appid, name: data?.name } }))
          setSelectedImage(data.splash || data.image)
          return
        }

        // For external (or offline fallback), load from installed manifest
        throw new Error('load from manifest')
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
              persistGameName(appid, meta?.name)
              window.dispatchEvent(new CustomEvent("uc_game_name", { detail: { appid, name: meta?.name } }))
              setSelectedImage(localImg || meta.splash || meta.image)
              setError(null)
              return
            }
          }
        } catch {}
        // Don't show error for external games that simply need manifest
        if (!appid.startsWith('external-')) {
          setError(err instanceof Error ? err.message : "Failed to load game")
        }
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

  const openHostSelector = async () => {
    const dontShowHostSelector = await window.ucSettings?.get?.('dontShowHostSelector')
    if (dontShowHostSelector) {
      const preferred = await getPreferredDownloadHost()
      await startDownload(preferred)
      return
    }
    setHostSelectorOpen(true)
    try {
      const preferred = await getPreferredDownloadHost()
      setSelectedHost(preferred)
      setDefaultHost(preferred)
    } catch {}
  }

  const startDownload = async (preferredHost?: PreferredDownloadHost) => {
    if (!game) return
    const isCancelled = downloads.some((item) => item.appid === game.appid && item.status === "cancelled")
    const hasFailedDownload = downloads.some(
      (item) => item.appid === game.appid && ["failed", "extract_failed"].includes(item.status)
    )
    const hasFailedInstall = installingManifest?.installStatus === "failed"
    const hasCancelledInstall = installingManifest?.installStatus === "cancelled"
    if (installedManifest || (installingManifest && !isCancelled && !hasFailedInstall && !hasCancelledInstall && !hasFailedDownload)) return
    if (installingManifest && (isCancelled || hasFailedInstall || hasCancelledInstall)) {
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
      await startGameDownload(game, preferredHost)
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
      const runAsAdminEnabled = await getRunAsAdminEnabled()
      
      if (savedExe) {
        await launchGame(savedExe, runAsAdminEnabled)
        return
      }
      
      const result = await window.ucDownloads.listGameExecutables(game.appid)
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
      await openExePicker(exes, { mode: "launch", actionLabel: "Launch", folder })
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
    if (!game || !game.genres) return []
    const currentGenres = new Set(game.genres.map((genre) => genre.toLowerCase()))
    const isCurrentNSFW = currentGenres.has("nsfw")
    const candidates = games.filter((g) => g.appid !== game.appid)
    const filtered = candidates.filter((g) => {
      const genres = Array.isArray(g.genres) ? g.genres.map((genre) => genre.toLowerCase()) : []
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
    if (!isOnline) {
      return (
        <div className="space-y-4">
          <OfflineBanner variant="compact" />
          <div className="rounded-2xl border border-muted/40 bg-muted/10 px-4 py-3 text-sm text-muted-foreground">
            This game isn't available offline. Check your Library for installed games.
          </div>
        </div>
      )
    }
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {error || "Unable to load this game."}
      </div>
    )
  }

  const effectiveDownloadCount = downloadCount || stats[game.appid]?.downloads || 0
  const effectiveViewCount = viewCount || stats[game.appid]?.views || 0
  const isPopular = popularAppIds.has(game.appid)
  const isExternalGame = Boolean(installedManifest?.isExternal)
  const isUCMatched = isExternalGame && game.source !== "external"
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
  const hasCancelledManifest = installingManifest?.installStatus === "cancelled"
  const isInstalled = Boolean(installedManifest)
  const showActionMenu = isInstalled
  const isInstalling =
    (Boolean(installingManifest) && !isCancelled && !hasCancelledManifest && !isFailed && !isPaused) || (isActivelyDownloading && !isCancelled) || (downloading && !isCancelled)
  const actionLabel = isGameRunning
    ? "Quit"
    : isInstalled
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
  const actionDisabled = !isGameRunning && (isInstalling || isQueued || isFailed)

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
    if (!window.ucSettings?.get || !game) return false
    try {
      return await window.ucSettings.get(`shortcutAsked:${game.appid}`)
    } catch {
      return false
    }
  }

  const setShortcutAskedForGame = async () => {
    if (!window.ucSettings?.set || !game) return
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

  const dirname = (targetPath: string | null | undefined) => {
    if (!targetPath) return null
    const parts = targetPath.split(/[/\\]+/).filter(Boolean)
    parts.pop()
    return parts.length ? parts.join("\\") : null
  }

  const createDesktopShortcut = async (exePath: string) => {
    if (!window.ucDownloads?.createDesktopShortcut || !game) return
    try {
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

  const openExePicker = async (
    exes: Array<{ name: string; path: string; size?: number; depth?: number }>,
    opts?: { title?: string; message?: string; actionLabel?: string; mode?: "launch" | "set"; currentPath?: string | null; folder?: string | null }
  ) => {
    const savedExe = await getSavedExe()
    setExePickerTitle(opts?.title || "Select executable")
    setExePickerMessage(opts?.message || `We couldn't confidently detect the correct exe for "${game?.name}". Please choose the one to launch.`)
    setExePickerActionLabel(opts?.actionLabel || "Launch")
    setExePickerMode(opts?.mode || "launch")
    setExePickerExes(exes)
    setExePickerCurrentPath(opts?.currentPath ?? savedExe ?? null)
    setExePickerFolder(opts?.folder ?? null)
    setExePickerOpen(true)
  }

  const openExecutablePicker = async () => {
    if (!game || !window.ucDownloads?.listGameExecutables) return
    try {
      const [result, savedExe] = await Promise.all([
        window.ucDownloads.listGameExecutables(game.appid),
        getSavedExe(),
      ])
      const exes = result?.exes || []
      await openExePicker(exes, {
        title: "Set launch executable",
        message: exes.length
          ? `Select the exe to launch for "${game.name}".`
          : `No executables detected for "${game.name}" yet. Browse and pick the correct one.`,
        actionLabel: "Set",
        mode: "set",
        currentPath: savedExe || null,
      })
    } catch {
      await openExePicker([], {
        title: "Set launch executable",
        message: `Unable to list executables for "${game.name}".`,
        actionLabel: "Set",
        mode: "set",
        currentPath: null,
      })
    }
  }

  const openGameFiles = async () => {
    if (!game) return
    try {
      let folder: string | null = null
      let discoveredExePath: string | null = null
      if (window.ucDownloads?.listGameExecutables) {
        const result = await window.ucDownloads.listGameExecutables(game.appid)
        folder = result?.folder || null
        if (result?.exes?.[0]?.path) {
          discoveredExePath = result.exes[0].path
        }
      }

      const savedExe = await getSavedExe()
      const preferredExePath = savedExe || discoveredExePath
      const exeDir = preferredExePath ? dirname(preferredExePath) : null
      const candidate = exeDir || null
      if (folder && candidate && candidate.toLowerCase().startsWith(folder.toLowerCase())) {
        folder = candidate
      } else if (!folder && candidate) {
        folder = candidate
      } else if (folder && window.ucDownloads?.findGameSubfolder) {
        const subfolder = await window.ucDownloads.findGameSubfolder(folder)
        if (subfolder) {
          folder = subfolder
        }
      }

      if (folder && window.ucDownloads?.openPath) {
        await window.ucDownloads.openPath(folder)
      }
    } catch (err) {
      console.error("[UC] Failed to open game files", err)
    }
  }

  const handleCreateShortcut = async () => {
    if (!game || !window.ucDownloads?.createDesktopShortcut) return
    try {
      setShortcutFeedback(null)
      let targetExe = await getSavedExe()
      let exes: Array<{ name: string; path: string; size?: number; depth?: number }> = []
      let folder: string | null = null

      if (!targetExe && window.ucDownloads?.listGameExecutables) {
        const result = await window.ucDownloads.listGameExecutables(game.appid)
        exes = result?.exes || []
        folder = result?.folder || null

        // Try auto-detection before asking the user
        const { pick, confident } = pickGameExecutable(exes, game.name, game.source, folder)
        if (pick && confident) {
          targetExe = pick.path
        }
      }

      if (!targetExe) {
        await openExePicker(exes, {
          title: "Set launch executable",
          message: `Select the exe before creating a shortcut for "${game.name}".`,
          actionLabel: "Set",
          folder,
          mode: "set",
          currentPath: null,
        })
        setShortcutFeedback({ type: 'error', message: 'Select an executable before creating a shortcut.' })
        return
      }

      const res = await window.ucDownloads.createDesktopShortcut(game.name, targetExe)
      if (res?.ok) {
        gameLogger.info('Desktop shortcut created (details)', { appid: game.appid })
        setShortcutFeedback({ type: 'success', message: 'Desktop shortcut created.' })
      } else if (res?.existed) {
        gameLogger.info('Desktop shortcut already exists', { appid: game.appid })
        setShortcutFeedback({ type: 'success', message: 'Desktop shortcut already exists.' })
      } else {
        gameLogger.error('Failed to create desktop shortcut from details', { data: res })
        setShortcutFeedback({ type: 'error', message: 'Failed to create desktop shortcut.' })
      }
      setTimeout(() => setShortcutFeedback(null), 3000)
    } catch (err) {
      gameLogger.error('Error creating desktop shortcut (details)', { data: err })
      setShortcutFeedback({ type: 'error', message: 'Failed to create desktop shortcut.' })
      setTimeout(() => setShortcutFeedback(null), 3000)
    }
  }

  const handleDeleteGame = () => {
    if (!game) return
    if (isInstalling) {
      setPendingDeleteAction("installing")
      return
    }
    setPendingDeleteAction("installed")
  }

  const runDeleteGame = async (action: "installed" | "installing") => {
    if (!game) return
    try {
      if (action === "installing") {
        await window.ucDownloads?.deleteInstalling?.(game.appid)
        setInstallingManifest(null)
      }
      if (action === "installed") {
        await window.ucDownloads?.deleteInstalled?.(game.appid)
        await window.ucDownloads?.deleteDesktopShortcut?.(game.name)
        setInstalledManifest(null)
      }
      clearByAppid(game.appid)
      setIsGameRunning(false)
    } catch {
      // swallow
    }
  }

  const launchGame = async (path: string, asAdmin: boolean = false) => {
    if (!window.ucDownloads) return
    const launchFn = asAdmin && isWindows
      ? window.ucDownloads.launchGameExecutableAsAdmin 
      : window.ucDownloads.launchGameExecutable
    
    if (!launchFn) return
    const res = await launchFn(game.appid, path, game.name)
    if (res && res.ok) {
      await setSavedExe(path)
      setExePickerOpen(false)
      setAdminPromptOpen(false)
      setShortcutModalOpen(false)
      setPendingExePath(null)
      setIsGameRunning(true)
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
    if (exePickerMode === "set") {
      await setSavedExe(path)
      setExePickerCurrentPath(path)
      // Do NOT close the modal, match Library behavior
      return
    }
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
                  {isExternalGame && (
                    <Badge className="px-3 py-1 rounded-full bg-yellow-500/20 border-yellow-500/30 text-yellow-400 font-semibold flex items-center gap-1.5">
                      <Info className="h-3 w-3" />
                      Externally Added
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
                <div className="flex items-center gap-3">
                  <Button
                    size="lg"
                    className={`flex-1 font-bold text-lg py-6 rounded-xl shadow-lg transition-all duration-200 ${
                      isGameRunning
                        ? "bg-destructive hover:bg-destructive/90 shadow-destructive/25"
                        : "bg-primary hover:bg-primary/90 shadow-primary/25"
                    }`}
                    onClick={() => {
                      if (isGameRunning) {
                        void stopRunningGame()
                      } else if (isInstalled) {
                        void launchInstalledGame()
                      } else if (isPaused) {
                        void resumeGroup(game.appid)
                      } else {
                        void openHostSelector()
                      }
                    }}
                    disabled={actionDisabled || (isGameRunning && stoppingGame)}
                  >
                    {isGameRunning ? <Square className="mr-2 h-5 w-5" /> : <Download className="mr-2 h-5 w-5" />}
                    {actionLabel}
                  </Button>

                  {showActionMenu ? (
                    <Popover open={actionMenuOpen} onOpenChange={setActionMenuOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-[52px] w-[52px] rounded-xl border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
                          aria-label="Game actions"
                        >
                          <Settings className="h-5 w-5" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-56 rounded-2xl p-2">
                        <button
                          type="button"
                          onClick={() => {
                            void openExecutablePicker()
                          }}
                          className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:text-primary hover:bg-primary/10"
                        >
                          <Settings className="mr-2 h-4 w-4" />
                          Set Executable
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActionMenuOpen(false)
                            void handleCreateShortcut()
                          }}
                          className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:text-primary hover:bg-primary/10"
                        >
                          <ExternalLink className="mr-2 h-4 w-4" />
                          Create Desktop Shortcut
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActionMenuOpen(false)
                            void openGameFiles()
                          }}
                          className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:text-primary hover:bg-primary/10"
                        >
                          <FolderOpen className="mr-2 h-4 w-4" />
                          Open Game Files
                        </button>
                        {isExternalGame && (
                          <button
                            type="button"
                            onClick={() => {
                              setActionMenuOpen(false)
                              setEditMetadataOpen(true)
                            }}
                            className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:text-primary hover:bg-primary/10"
                          >
                            <Settings className="mr-2 h-4 w-4" />
                            Edit Details
                          </button>
                        )}
                        <div className="my-1 h-px bg-border/60" />
                        <button
                          type="button"
                          onClick={() => {
                            setActionMenuOpen(false)
                            void handleDeleteGame()
                          }}
                          className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
                        >
                          {installedManifest?.isExternal ? (
                            <>
                              <Unlink2 className="mr-2 h-4 w-4" />
                              Unlink Game
                            </>
                          ) : (
                            <>
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete Game
                            </>
                          )}
                        </button>
                      </PopoverContent>
                    </Popover>
                  ) : null}
                </div>

                {isFailed && (
                  <Button
                    variant="secondary"
                    className="mt-3 w-full"
                    onClick={() => void openHostSelector()}
                    disabled={downloading}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Retry
                  </Button>
                )}

                {shortcutFeedback && (
                  <div className={`mt-2 text-xs ${shortcutFeedback.type === 'success' ? 'text-emerald-400' : 'text-destructive'}`}>
                    {shortcutFeedback.message}
                  </div>
                )}

                {(downloadError || failedDownload?.error) && (
                  <div className="mt-3 text-xs text-destructive">{downloadError || failedDownload?.error}</div>
                )}
              </div>

              <div className={`grid grid-cols-2 gap-3${isUCMatched ? ' opacity-40 blur-[2px] pointer-events-none select-none' : ''}`}>
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
                <div className="flex items-center justify-between">
                  <h3 className="font-black text-foreground font-montserrat">Details</h3>
                  {isExternalGame && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2.5 text-xs text-primary hover:text-primary hover:bg-primary/10"
                      onClick={() => setEditMetadataOpen(true)}
                    >
                      <Settings className="mr-1.5 h-3 w-3" />
                      Edit
                    </Button>
                  )}
                </div>

                {isUCMatched && (
                  <div className="flex items-start gap-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-3 py-2 text-xs text-yellow-400">
                    <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                    <span>Matched from UC catalog — details may not reflect your installed version.</span>
                  </div>
                )}

                <div className={`space-y-3 text-sm${isUCMatched ? ' opacity-50 blur-[1.5px] select-none' : ''}`}>
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
      <DownloadHostModal
        open={hostSelectorOpen}
        selectedHost={selectedHost}
        defaultHost={defaultHost}
        onSelect={setSelectedHost}
        onConfirm={async (dontShowAgain) => {
          setHostSelectorOpen(false)
          try {
            setPreferredDownloadHost(selectedHost)
            if (dontShowAgain) {
              await window.ucSettings?.set?.('dontShowHostSelector', true)
            }
          } catch {}
          await startDownload(selectedHost)
        }}
        onClose={() => setHostSelectorOpen(false)}
      />
      {pendingDeleteAction && game && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setPendingDeleteAction(null)}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-border/60 bg-slate-950/95 p-5 text-white shadow-2xl">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {pendingDeleteAction === "installing"
                ? "Remove download"
                : installedManifest?.isExternal
                  ? "Unlink game"
                  : "Delete game"}
            </div>
            <p className="mt-2 text-sm text-slate-300">
              {pendingDeleteAction === "installing"
                ? `Remove "${game.name}" from the installing list? This will delete any downloaded data.`
                : installedManifest?.isExternal
                  ? `Unlink "${game.name}" from UnionCrax? This only removes it from your library \u2014 your game files won't be touched.`
                  : `Delete "${game.name}" permanently? This removes the installed files from disk.`}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPendingDeleteAction(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  const action = pendingDeleteAction
                  setPendingDeleteAction(null)
                  setTimeout(() => {
                    void runDeleteGame(action)
                  }, 0)
                }}
              >
                {pendingDeleteAction === "installing" ? "Remove" : installedManifest?.isExternal ? "Unlink" : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}
      <ExePickerModal
        open={exePickerOpen}
        title={exePickerTitle}
        message={exePickerMessage}
        exes={exePickerExes}
        currentExePath={exePickerCurrentPath}
        actionLabel={exePickerActionLabel}
        gameName={game?.name}
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
      {isExternalGame && game && (
        <EditGameMetadataModal
          open={editMetadataOpen}
          onOpenChange={setEditMetadataOpen}
          game={game}
          onSaved={(updates) => {
            // Update in-memory game state with new metadata
            setGame((prev) => prev ? { ...prev, ...updates } as Game : prev)
            // Update selected image (banner) if splash/banner was updated
            if (updates.splash) {
              setSelectedImage(proxyImageUrl(updates.splash))
            } else if (updates.image && !updates.splash) {
              // If only card image updated, use it as fallback for banner
              setSelectedImage(proxyImageUrl(updates.image))
            }
          }}
        />
      )}
    </div>
  )
}
