
import { useEffect, useCallback, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react"
import { createPortal } from "react-dom"
import { useParams } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { GameCard } from "@/components/GameCard"
import { GameComments } from "@/components/GameComments"
import { useDownloads } from "@/context/downloads-context"
import { apiUrl, apiFetch } from "@/lib/api"
import { getPreferredDownloadHost, setPreferredDownloadHost, requestDownloadToken, type PreferredDownloadHost, type DownloadConfig } from "@/lib/downloads"
import { formatNumber, hasOnlineMode, pickGameExecutable, proxyImageUrl, proxyMediaUrl, cn, timeAgoLong } from "@/lib/utils"
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
  Layers3,
  Loader2,
  Minus,
  MoreHorizontal,
  Plus,
  Play,
  Tags,
  Terminal,
} from "lucide-react"
import { ExePickerModal } from "@/components/ExePickerModal"
import { GameLaunchFailedModal } from "@/components/GameLaunchFailedModal"
import { GameLaunchPreflightModal, type LaunchPreflightResult } from "@/components/GameLaunchPreflightModal"
import { LinuxExperiences } from "@/components/LinuxExperiences"
import { DownloadCheckModal } from "@/components/DownloadCheckModal"
import { DesktopShortcutModal } from "@/components/DesktopShortcutModal"
import { EditGameMetadataModal } from "@/components/EditGameMetadataModal"
import { GameActionContextMenu, GameActionMenuPanel } from "@/components/GameActionMenu"
import { UpdateBackupWarningModal } from "@/components/VersionConflictModal"
import { GameLinuxConfigModal } from "@/components/GameLinuxConfigModal"
import { gameLogger } from "@/lib/logger"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { GamePageSkeleton } from "@/components/GamePageSkeleton"
import { SystemRequirements } from "@/components/SystemRequirements"
import { GameVersionStatus } from "@/components/GameVersionStatus"
import { useAuth } from "@/hooks/useAuth"

const PROTON_RANK_COLORS: Record<string, string> = {
  platinum: "text-[#b3e5fc] border-[#b3e5fc]/30",
  gold: "text-[#ffd700] border-[#ffd700]/30",
  silver: "text-[#c0c0c0] border-[#c0c0c0]/30",
  bronze: "text-[#cd7f32] border-[#cd7f32]/30",
  borked: "text-[#f44336] border-[#f44336]/30",
}

const MIN_LIGHTBOX_ZOOM = 1
const MAX_LIGHTBOX_ZOOM = 3
const LIGHTBOX_ZOOM_STEP = 0.25

function getHighQualityScreenshotUrl(url: string): string {
  if (!url) return url

  return url
    .replace('/t_screenshot_med/', '/t_original/')
    .replace('/t_thumb/', '/t_original/')
}

export function GameDetailPage() {
  const isWindows = typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent)
  const isLinux = typeof navigator !== 'undefined' && /linux/i.test(navigator.userAgent)
  const isOnline = useOnlineStatus()
  const params = useParams()
  const [authState] = useAuth()
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
  const [installedVersions, setInstalledVersions] = useState<any[]>([])
  const [installingManifest, setInstallingManifest] = useState<any | null>(null)
  const [exePickerOpen, setExePickerOpen] = useState(false)
  const [exePickerExes, setExePickerExes] = useState<Array<{ name: string; path: string; size?: number; depth?: number }>>([])
  const [isGameRunning, setIsGameRunning] = useState(false)
  const [stoppingGame, setStoppingGame] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)
  const [lightboxZoom, setLightboxZoom] = useState(1)
  const [lightboxPan, setLightboxPan] = useState({ x: 0, y: 0 })
  const [lightboxDragging, setLightboxDragging] = useState(false)
  const [pendingExePath, setPendingExePath] = useState<string | null>(null)
  const [shortcutModalOpen, setShortcutModalOpen] = useState(false)
  const [shortcutModalAlwaysCreate, setShortcutModalAlwaysCreate] = useState(false)
  const [launchPreflightOpen, setLaunchPreflightOpen] = useState(false)
  const [launchPreflightResult, setLaunchPreflightResult] = useState<LaunchPreflightResult | null>(null)
  const [hostSelectorOpen, setHostSelectorOpen] = useState(false)
  const [selectedHost, setSelectedHost] = useState<PreferredDownloadHost>("pixeldrain")
  const [defaultHost, setDefaultHost] = useState<PreferredDownloadHost>("pixeldrain")
  const [downloadToken, setDownloadToken] = useState<string | null>(null)
  const [isCheckingLinks, setIsCheckingLinks] = useState(false)
  const [exePickerTitle, setExePickerTitle] = useState("Select executable")
  const [exePickerMessage, setExePickerMessage] = useState("We couldn't confidently detect the correct exe. Please choose the one to launch.")
  const [exePickerCurrentPath, setExePickerCurrentPath] = useState<string | null>(null)
  const [exePickerActionLabel, setExePickerActionLabel] = useState("Launch")
  const [exePickerFolder, setExePickerFolder] = useState<string | null>(null)
  const [exePickerMode, setExePickerMode] = useState<"launch" | "set">("launch")
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const [actionMenuContextPosition, setActionMenuContextPosition] = useState<{ x: number; y: number } | null>(null)
  const [shortcutFeedback, setShortcutFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [pendingDeleteAction, setPendingDeleteAction] = useState<"installed" | "installing" | null>(null)
  const [editMetadataOpen, setEditMetadataOpen] = useState(false)
  const [updateWarningOpen, setUpdateWarningOpen] = useState(false)
  const [pendingForceDownload, setPendingForceDownload] = useState(false)
  const [gameStartFailedOpen, setGameStartFailedOpen] = useState(false)
  const [linuxConfigOpen, setLinuxConfigOpen] = useState(false)

  // Collection/tag editing state
  const [gameMeta, setGameMeta] = useState<{ collections?: string[]; tags?: string[] }>({})
  const [collectionInput, setCollectionInput] = useState("")
  const [tagInput, setTagInput] = useState("")

  // Ref to track whether a game was just launched (cleared on manual quit)
  // Stores the expiry timestamp of the quick-exit detection window (0 = not watching)
  const gameJustLaunchedRef = useRef<number>(0)
  const gameQuickExitUnsubRef = useRef<(() => void) | null>(null)
  const lightboxViewportRef = useRef<HTMLDivElement | null>(null)
  const lightboxPanPointerRef = useRef<number | null>(null)
  const lightboxPanStartRef = useRef({ x: 0, y: 0 })
  const lightboxPanOffsetStartRef = useRef({ x: 0, y: 0 })
  const suppressLightboxImageClickRef = useRef(false)
  const importantNoteRef = useRef<HTMLDivElement | null>(null)
  const [highlightImportantNote, setHighlightImportantNote] = useState(false)

  // ProtonDB state
  const [protonData, setProtonData] = useState<any>(null)
  const [protonLoading, setProtonLoading] = useState(false)

  const appid = params.id || ""

  // ── Load library meta (collections/tags) for this game ──
  useEffect(() => {
    if (!appid) return
    let cancelled = false
    ;(async () => {
      try {
        const allMeta = (await window.ucSettings?.get?.("libraryGameMeta")) || {}
        if (!cancelled) setGameMeta(allMeta[appid] || {})
      } catch {}
    })()
    return () => { cancelled = true }
  }, [appid])

  const saveGameMeta = useCallback(async (updated: { collections?: string[]; tags?: string[] }) => {
    setGameMeta(updated)
    try {
      const allMeta = (await window.ucSettings?.get?.("libraryGameMeta")) || {}
      allMeta[appid] = updated
      await window.ucSettings?.set?.("libraryGameMeta", allMeta)
    } catch {}
  }, [appid])

  const addCollection = useCallback(async () => {
    const val = collectionInput.trim()
    if (!val) return
    const existing = gameMeta.collections || []
    if (existing.includes(val)) { setCollectionInput(""); return }
    await saveGameMeta({ ...gameMeta, collections: [...existing, val] })
    setCollectionInput("")
  }, [collectionInput, gameMeta, saveGameMeta])

  const removeCollection = useCallback(async (name: string) => {
    const existing = gameMeta.collections || []
    await saveGameMeta({ ...gameMeta, collections: existing.filter((c) => c !== name) })
  }, [gameMeta, saveGameMeta])

  const addTag = useCallback(async () => {
    const val = tagInput.trim()
    if (!val) return
    const existing = gameMeta.tags || []
    if (existing.includes(val)) { setTagInput(""); return }
    await saveGameMeta({ ...gameMeta, tags: [...existing, val] })
    setTagInput("")
  }, [tagInput, gameMeta, saveGameMeta])

  const removeTag = useCallback(async (name: string) => {
    const existing = gameMeta.tags || []
    await saveGameMeta({ ...gameMeta, tags: existing.filter((t) => t !== name) })
  }, [gameMeta, saveGameMeta])

  // Fetch ProtonDB summary for this game (proxied through the web API)
  useEffect(() => {
    if (!game?.appid) return
    let cancelled = false
    setProtonLoading(true)

    apiFetch(`/api/protondb/${game.appid}`)
      .then(async (res) => {
        if (!res.ok) return { success: false }
        return await res.json()
      })
      .then((data) => {
        if (cancelled) return
        setProtonData(data)
      })
      .catch(() => {
        if (!cancelled) setProtonData({ success: false })
      })
      .finally(() => {
        if (!cancelled) setProtonLoading(false)
      })

    return () => { cancelled = true }
  }, [game?.appid])

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

        // External games don't exist on the API - load directly from local manifest
        const isExternalId = appid.startsWith('external-')

        if (!isExternalId) {
          const response = await fetch(apiUrl(`/api/games/${encodeURIComponent(appid)}`))
          if (!response.ok) {
            throw new Error(`Unable to load game (${response.status})`)
          }
          const data = await response.json()
          setGame(data)
          persistGameName(appid, data?.name)
          window.dispatchEvent(new CustomEvent("uc_game_name", { detail: { appid, name: data?.name, genres: data?.genres } }))
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
              window.dispatchEvent(new CustomEvent("uc_game_name", { detail: { appid, name: meta?.name, genres: meta?.genres } }))
              setSelectedImage(localImg || meta.splash || meta.image)
              setError(null)
              return
            }
          }
        } catch { }
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
    if (!installedManifest?.metadata || !game) return
    const meta = installedManifest.metadata
    const localHero = meta.localSplash || meta.localImage
    if (!localHero) return
    const isDefaultSelected = !selectedImage || selectedImage === game.splash || selectedImage === game.image
    if (isDefaultSelected) setSelectedImage(localHero)
  }, [installedManifest, game, selectedImage])

  useEffect(() => {
    if (!appid) return
    let mounted = true
    const loadInstalledVersions = async () => {
      try {
        if (window.ucDownloads?.listInstalledByAppid) {
          const list = await window.ucDownloads.listInstalledByAppid(appid)
          if (!mounted) return
          setInstalledVersions(Array.isArray(list) ? list : [])
          return
        }
      } catch { }
      if (!mounted) return
      setInstalledVersions(installedManifest ? [installedManifest] : [])
    }
    loadInstalledVersions()
    return () => {
      mounted = false
    }
  }, [appid, downloads, installedManifest])

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
    let cancelled = false
    const run = async () => {
      try {
        const res = await fetch(apiUrl(`/api/views/${encodeURIComponent(appid)}`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
        if (cancelled) return
        if (res.ok) {
          if (hasCookieConsent()) addViewedGameToHistory(appid)
        }
      } catch {
        // ignore
      }

      try {
        await apiFetch("/api/view-history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appid }),
        })
      } catch {
        // ignore
      }
    }
    void run()
    return () => {
      cancelled = true
    }
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

  // When isGameRunning flips to false within the quick-exit window, show the modal
  useEffect(() => {
    if (isGameRunning || !(gameJustLaunchedRef.current > Date.now())) return
    gameJustLaunchedRef.current = 0
    try { gameQuickExitUnsubRef.current?.() } catch { }
    gameQuickExitUnsubRef.current = null
    setGameStartFailedOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGameRunning])

  const handleHVTagClick = () => {
    if (importantNoteRef.current) {
      importantNoteRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setHighlightImportantNote(true)
      setTimeout(() => setHighlightImportantNote(false), 3000)
    }
  }

  const clampLightboxPan = (nextX: number, nextY: number, zoomValue = lightboxZoom) => {
    const viewport = lightboxViewportRef.current
    if (!viewport || zoomValue <= 1) {
      return { x: 0, y: 0 }
    }

    const maxX = ((viewport.clientWidth * zoomValue) - viewport.clientWidth) / 2
    const maxY = ((viewport.clientHeight * zoomValue) - viewport.clientHeight) / 2

    return {
      x: Math.min(maxX, Math.max(-maxX, nextX)),
      y: Math.min(maxY, Math.max(-maxY, nextY)),
    }
  }

  const openLightbox = (index: number) => {
    setLightboxIndex(index)
    setLightboxZoom(1)
    setLightboxPan({ x: 0, y: 0 })
    setLightboxDragging(false)
    lightboxPanPointerRef.current = null
    setLightboxOpen(true)
  }

  const closeLightbox = () => {
    setLightboxZoom(1)
    setLightboxPan({ x: 0, y: 0 })
    setLightboxDragging(false)
    lightboxPanPointerRef.current = null
    setLightboxOpen(false)
  }

  const nextLightbox = () => {
    if (!lightboxScreenshots.length) return
    setLightboxZoom(1)
    setLightboxPan({ x: 0, y: 0 })
    setLightboxIndex((prev) => (prev + 1) % lightboxScreenshots.length)
  }

  const prevLightbox = () => {
    if (!lightboxScreenshots.length) return
    setLightboxZoom(1)
    setLightboxPan({ x: 0, y: 0 })
    setLightboxIndex((prev) => (prev - 1 + lightboxScreenshots.length) % lightboxScreenshots.length)
  }

  const zoomInLightbox = () => {
    setLightboxZoom((prev) => {
      const next = Math.min(MAX_LIGHTBOX_ZOOM, prev + LIGHTBOX_ZOOM_STEP)
      setLightboxPan((pan) => clampLightboxPan(pan.x, pan.y, next))
      return next
    })
  }

  const zoomOutLightbox = () => {
    setLightboxZoom((prev) => {
      const next = Math.max(MIN_LIGHTBOX_ZOOM, prev - LIGHTBOX_ZOOM_STEP)
      setLightboxPan((pan) => clampLightboxPan(pan.x, pan.y, next))
      return next
    })
  }

  const resetLightboxZoom = () => {
    setLightboxZoom(1)
    setLightboxPan({ x: 0, y: 0 })
    setLightboxDragging(false)
    lightboxPanPointerRef.current = null
  }

  const handleLightboxPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (lightboxZoom <= 1) return

    event.preventDefault()
    suppressLightboxImageClickRef.current = false
    lightboxPanPointerRef.current = event.pointerId
    lightboxPanStartRef.current = { x: event.clientX, y: event.clientY }
    lightboxPanOffsetStartRef.current = { ...lightboxPan }
    setLightboxDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleLightboxPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!lightboxDragging || lightboxPanPointerRef.current !== event.pointerId || lightboxZoom <= 1) return

    const deltaX = event.clientX - lightboxPanStartRef.current.x
    const deltaY = event.clientY - lightboxPanStartRef.current.y

    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      suppressLightboxImageClickRef.current = true
    }

    const next = clampLightboxPan(
      lightboxPanOffsetStartRef.current.x + deltaX,
      lightboxPanOffsetStartRef.current.y + deltaY,
    )

    setLightboxPan(next)
  }

  const handleLightboxPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (lightboxPanPointerRef.current !== event.pointerId) return

    lightboxPanPointerRef.current = null
    setLightboxDragging(false)

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  useEffect(() => {
    if (!lightboxOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox()
      if (e.key === "ArrowRight") nextLightbox()
      if (e.key === "ArrowLeft") prevLightbox()
      if (e.key === "+" || e.key === "=") zoomInLightbox()
      if (e.key === "-" || e.key === "_") zoomOutLightbox()
      if (e.key === "0") resetLightboxZoom()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [lightboxOpen, nextLightbox, prevLightbox, closeLightbox, zoomInLightbox, zoomOutLightbox, resetLightboxZoom])

  const openHostSelector = async () => {
    if (!game) return
    const skipLinkCheck = await window.ucSettings?.get?.('skipLinkCheck')

    // If user wants to skip just the link check, show a simpler flow
    // Otherwise run the full availability check modal
    try {
      const preferred = await getPreferredDownloadHost()
      setSelectedHost(preferred)
      setDefaultHost(preferred)

      if (skipLinkCheck) {
        // Skip availability check but still show host selector
        setDownloadToken(null)
        setIsCheckingLinks(false)
        setHostSelectorOpen(true)
        return
      }

      // Acquire download token for availability check
      setIsCheckingLinks(true)
      const token = await requestDownloadToken(game.appid)
      setDownloadToken(token)
      setHostSelectorOpen(true)
    } catch (err) {
      // If token fails, fall back to old behavior (just download)
      setIsCheckingLinks(false)
      const preferred = await getPreferredDownloadHost()
      await startDownload(preferred)
    }
  }

  const startDownload = async (preferredHost?: PreferredDownloadHost, config?: DownloadConfig, force?: boolean) => {
    if (!game) return
    const isCancelled = downloads.some((item) => item.appid === game.appid && item.status === "cancelled")
    const hasFailedDownload = downloads.some(
      (item) => item.appid === game.appid && ["failed", "extract_failed"].includes(item.status)
    )
    const hasFailedInstall = installingManifest?.installStatus === "failed"
    const hasCancelledInstall = installingManifest?.installStatus === "cancelled"
    // Check if this is a stale installing manifest (no corresponding download items)
    const hasActiveItems = downloads.some(
      (item) => item.appid === game.appid && ["queued", "downloading", "paused", "extracting", "installing"].includes(item.status)
    )
    // Block re-download when items are already active/queued (even if installingManifest hasn't loaded yet)
    if (!force && (installedManifest || (hasActiveItems && !isCancelled && !hasFailedInstall && !hasCancelledInstall && !hasFailedDownload))) return
    // When force-downloading (version switch), clear ALL old download items for this appid
    // to prevent "part 1 of 2" display bugs from stale completed items
    if (force) {
      clearByAppid(game.appid)
    }
    // Clean up stale or failed installing manifests before allowing re-download
    if (installingManifest && (!hasActiveItems || isCancelled || hasFailedInstall || hasCancelledInstall || force)) {
      try {
        await window.ucDownloads?.deleteInstalling?.(game.appid)
      } catch { }
      setInstallingManifest(null)
    }
    if (hasFailedDownload && !force) {
      clearByAppid(game.appid)
    }
    setDownloadError(null)
    setDownloading(true)
    try {
      await startGameDownload(game, preferredHost, config)
      setDownloadCount((prev) => prev + 1)
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Failed to start download")
    } finally {
      setDownloading(false)
    }
  }

  const installDownloadedArchive = async () => {
    if (!game || !window.ucDownloads?.installDownloadedArchive) return
    setDownloadError(null)
    setDownloading(true)
    try {
      clearByAppid(game.appid)
      const result = await window.ucDownloads.installDownloadedArchive(game.appid)
      if (!result?.ok) {
        throw new Error(result?.error || "Failed to install downloaded archive")
      }
      setInstallingManifest((prev: any) => prev ? { ...prev, installStatus: "extracting", installError: null } : prev)
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Failed to install downloaded archive")
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
        await handleLaunchWithShortcutCheck(savedExe)
        return
      }

      const result = await window.ucDownloads.listGameExecutables(game.appid)
      const exes = result?.exes || []
      const folder = result?.folder || null
      const browseFolder = folder
      const { pick, confident } = pickGameExecutable(exes, game.name, game.source, folder)
      if (pick && confident) {
        await handleLaunchWithShortcutCheck(pick.path)
        return
      }
      await openExePicker(exes, { mode: "launch", actionLabel: "Launch", folder: browseFolder })
    } catch { }
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

  // Determine if the currently selected page version matches any installed version
  // (must be called before early returns to maintain hook order)
  const installedVersionLabels = useMemo(() => {
    const labels = installedVersions
      .map((manifest) => manifest?.metadata?.downloadedVersion || manifest?.metadata?.version || manifest?.version)
      .filter(Boolean)
      .map((label) => String(label))
    return Array.from(new Set(labels))
  }, [installedVersions])
  const hasInstalledVersions = installedVersions.length > 0 || Boolean(installedManifest)

  const installedMeta = installedManifest?.metadata || null
  const localScreenshots = Array.isArray(installedMeta?.localScreenshots) ? installedMeta.localScreenshots : []
  const resolvedScreenshots = useMemo(() => {
    if (!game?.screenshots || game.screenshots.length === 0) return []
    if (!localScreenshots.length) return game.screenshots
    return game.screenshots.map((shot, index) => localScreenshots[index] || shot)
  }, [game?.screenshots, localScreenshots])
  const lightboxScreenshots = useMemo(() => {
    if (!game?.screenshots || game.screenshots.length === 0) return resolvedScreenshots

    return game.screenshots.map((shot, index) => {
      const fallback = resolvedScreenshots[index] || shot
      return isOnline ? shot || fallback : fallback || shot
    })
  }, [game?.screenshots, isOnline, resolvedScreenshots])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#09090b] pb-12">
        <GamePageSkeleton />
      </div>
    )
  }

  if (error || !game) {
    if (!isOnline) {
      return (
        <div className="space-y-4">
          <OfflineBanner variant="compact" />
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-400">
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
  const dateAdded = game.release_time
    ? new Date(game.release_time)
    : typeof game.addedAt === "number"
      ? new Date(game.addedAt)
      : null
  const dateAddedLabel = dateAdded && !isNaN(dateAdded.getTime())
    ? dateAdded.toLocaleDateString()
    : "Unknown"
  const heroImage = selectedImage || installedMeta?.localSplash || installedMeta?.localImage || game.splash || game.image
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
  const isInstalled = hasInstalledVersions
  const isInstallReady = Boolean(installingManifest) && installingManifest?.installStatus === "downloaded" && !isInstalled
  const hasUpdate = isInstalled && Boolean(game?.version) && installedVersionLabels.length > 0 && !installedVersionLabels.includes(game.version ?? '')
  const showActionMenu = isInstalled
  // Only treat as "installing" from manifest if there are corresponding download items.
  // If the manifest exists but no download items remain (e.g. items were lost), it's a stale
  // manifest and the user should be able to retry the download.
  const hasDownloadItems = appDownloads.length > 0
  const isInstalling =
    (Boolean(installingManifest) && hasDownloadItems && !isCancelled && !hasCancelledManifest && !isFailed && !isPaused) || (isActivelyDownloading && !isCancelled) || (downloading && !isCancelled)
  const actionLabel = isGameRunning
    ? "Quit"
    : isCheckingLinks
      ? "Checking..."
      : isInstalled
        ? "Play"
        : isInstallReady
          ? "Install"
        : isPaused
          ? "Resume"
          : isQueued
            ? "Queued"
            : isFailed
              ? "Download failed"
              : isInstalling
                ? "Installing"
                : "Download Now"
  const actionDisabled = !isGameRunning && (isCheckingLinks || isInstalling || isQueued || (isFailed && !isInstallReady))

  const getSavedExe = async () => {
    if (!window.ucSettings?.get) return null
    try {
      return await window.ucSettings.get(`gameExe:${game.appid}`) || null
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

  const dirname = (targetPath: string | null | undefined) => {
    if (!targetPath) return null
    const parts = targetPath.split(/[/\\]+/).filter(Boolean)
    parts.pop()
    return parts.length ? parts.join("\\") : null
  }

  const createDesktopShortcut = async (exePath: string) => {
    if (!window.ucDownloads?.createDesktopShortcut || !game) return null
    try {
      try {
        await window.ucDownloads?.deleteDesktopShortcut?.(game.name)
      } catch { }
      const result = await window.ucDownloads.createDesktopShortcut(game.name, exePath)
      if (result?.ok) {
        gameLogger.info('Desktop shortcut created', { appid: game.appid })
      } else {
        gameLogger.error('Failed to create desktop shortcut', { data: result })
      }
      return result
    } catch (err) {
      gameLogger.error('Error creating desktop shortcut', { data: err })
      return null
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
        folder: result?.folder || null,
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

  const runLaunchPreflight = async (path: string) => {
    if (!game) return true
    const result = await window.ucDownloads?.preflightGameLaunch?.(game.appid, path)
    if (!result?.ok) return true
    if (result.canLaunch && result.checks.length === 0) return true

    setPendingExePath(path)
    setLaunchPreflightResult(result)
    setLaunchPreflightOpen(true)
    return false
  }

  const reopenLaunchExecutablePicker = async () => {
    if (!game || !window.ucDownloads?.listGameExecutables) return
    try {
      const result = await window.ucDownloads.listGameExecutables(game.appid)
      const exes = result?.exes || []
      await openExePicker(exes, {
        title: 'Select executable',
        message: `We couldn't confidently detect the correct exe for "${game.name}". Please choose the one to launch.`,
        actionLabel: 'Launch',
        mode: 'launch',
        currentPath: pendingExePath,
        folder: result?.folder || null,
      })
    } finally {
      setLaunchPreflightOpen(false)
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

      const res = await createDesktopShortcut(targetExe)
      if (res?.ok) {
        gameLogger.info('Desktop shortcut created (details)', { appid: game.appid })
        setShortcutFeedback({ type: 'success', message: 'Desktop shortcut created.' })
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

  const handleActionCardContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!showActionMenu) return
    event.preventDefault()
    setActionMenuOpen(false)
    setActionMenuContextPosition({ x: event.clientX, y: event.clientY })
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

  const launchGame = async (path: string) => {
    if (!window.ucDownloads?.launchGameExecutable) return
    const showGameName = await window.ucSettings?.get?.('rpcShowGameName') ?? true
    const res = await window.ucDownloads.launchGameExecutable(game.appid, path, game.name, showGameName)
    if (res && res.ok) {
      await setSavedExe(path)
      setExePickerOpen(false)
      setShortcutModalOpen(false)
      setPendingExePath(null)
      setIsGameRunning(true)
      setGameStartFailedOpen(false)

      // Quick-exit detection window: 12 seconds after launch.
      // If the game exits within this window (detected via IPC event or polling), show the modal.
      // Games that exit normally after 12+ seconds won't trigger it.
      gameJustLaunchedRef.current = Date.now() + 12000

      const showStartFailedModal = () => {
        setIsGameRunning(false)
        setGameStartFailedOpen(true)
      }

      // Fast path: IPC event from main process when it detects a quick exit
      try { gameQuickExitUnsubRef.current?.() } catch { }
      gameQuickExitUnsubRef.current = window.ucDownloads?.onGameQuickExit?.((data) => {
        if (data?.appid !== game.appid) return
        if (!(gameJustLaunchedRef.current > Date.now())) return
        gameJustLaunchedRef.current = 0
        try { gameQuickExitUnsubRef.current?.() } catch { }
        gameQuickExitUnsubRef.current = null
        void showStartFailedModal()
      }) ?? null
      // Fallback: the isGameRunning useEffect below detects exits within the 12 s window
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
    if (exePickerMode === "set") {
      await setSavedExe(path)
      setExePickerCurrentPath(path)
      // Do NOT close the modal, match Library behavior
      return
    }
    await handleLaunchWithShortcutCheck(path)
  }

  const stopRunningGame = async () => {
    if (!window.ucDownloads?.quitGameExecutable) return
    // Clear the launch tracking so the quick-exit modal doesn't appear on manual quit
    gameJustLaunchedRef.current = 0
    try { gameQuickExitUnsubRef.current?.() } catch { }
    gameQuickExitUnsubRef.current = null
    setStoppingGame(true)
    try {
      await window.ucDownloads.quitGameExecutable(game.appid)
      setIsGameRunning(false)
    } catch { }
    setStoppingGame(false)
  }

  // Determine which background to use for the ambient page bg
  const backgroundImage = game.hero_image || game.splash || game.image
  const useAnimatedBackground = Boolean(game.hero_animated)

  return (
    <div className="relative">
      {/* Ambient page background */}
      {backgroundImage && (
        <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
          {useAnimatedBackground ? (
            <video
              src={proxyMediaUrl(game.hero_animated || "")}
              className="absolute inset-0 h-full w-full object-cover opacity-25"
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
            />
          ) : (
            <img
              src={proxyImageUrl(backgroundImage) || "./banner.png"}
              alt=""
              aria-hidden="true"
              className="uc-ambient-drift absolute inset-0 h-full w-full object-cover opacity-30 blur-[8px] scale-110"
            />
          )}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_40%)]" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-black/70 to-[#09090b]" />
        </div>
      )}

      <div className="relative z-10 space-y-12">
      <section className="relative pt-6">
        <div className="container mx-auto px-4">
          <div className="max-w-6xl mx-auto">
            <div className="relative rounded-3xl overflow-hidden border border-white/[.07] bg-[#1A1A1A]/80 backdrop-blur-md shadow-[0_8px_32px_0_rgba(0,0,0,0.5)]">
              <div className="relative aspect-video overflow-hidden">
                <img
                  src={proxyImageUrl(heroImage || "") || "./banner.png"}
                  alt={game.name}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
              </div>

              <div className="absolute bottom-0 left-0 right-0 p-8">
                <div className="flex flex-wrap gap-2 mb-4">
                  {game?.genres?.map((genre) => (
                    <Badge
                      key={genre}
                      variant={genre.toLowerCase() === "nsfw" ? "destructive" : "default"}
                      className={`px-3 py-1 rounded-full font-semibold backdrop-blur-md border shadow-lg ${genre.toLowerCase() === "nsfw"
                        ? "bg-red-500/20 border-red-500/30 text-red-400"
                        : "bg-zinc-800/50 border-white/[.07] text-white hover:bg-zinc-700"
                        }`}
                    >
                      {genre}
                    </Badge>
                  ))}
                  {isPopular && (
                    <Badge className="px-3 py-1 rounded-full bg-zinc-800/60 text-white backdrop-blur-sm border border-white/10 text-xs font-bold uppercase tracking-wider shadow-lg">
                      <Flame className="w-3 h-3 mr-1 fill-current" /> Popular
                    </Badge>
                  )}
                  {hasOnlineMode(game?.hasCoOp) && (
                    <Badge className="px-3 py-1 rounded-full bg-emerald-500/20 border-emerald-500/30 text-emerald-400 font-semibold flex items-center gap-1.5 backdrop-blur-md">
                      <Wifi className="h-3 w-3" />
                      Online
                    </Badge>
                  )}
                  {game?.hasHv && (
                    <Badge className="px-3 py-1 rounded-full bg-red-500/20 border-red-500/30 text-red-400 font-semibold backdrop-blur-md cursor-pointer transition-transform hover:scale-105 active:scale-95"
                      onClick={handleHVTagClick}
                      title="Scroll to important notes"
                    >
                      HV
                    </Badge>
                  )}
                  {isExternalGame && (
                    <Badge className="px-3 py-1 rounded-full bg-zinc-800/60 border-white/[.07] text-zinc-300 font-semibold flex items-center gap-1.5 backdrop-blur-md">
                      <Info className="h-3 w-3" />
                      Externally Added
                    </Badge>
                  )}
                  {protonLoading ? (
                    <Badge
                      variant="online"
                      className="px-3 py-1 rounded-full text-sky-400 border-sky-500/30 font-semibold flex items-center gap-1.5 backdrop-blur-md"
                    >
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Linux: Loading...
                    </Badge>
                  ) : protonData && protonData.success ? (
                    <Badge
                      variant="online"
                      className={cn(
                        "px-3 py-1 rounded-full font-semibold flex items-center gap-1.5 backdrop-blur-md cursor-pointer transition-all hover:bg-black/80",
                        PROTON_RANK_COLORS[protonData.rating?.toLowerCase()] || "text-sky-400 border-sky-500/30"
                      )}
                      onClick={() => window.open(protonData.url || `https://www.protondb.com/app/${game.appid}`, "_blank")}
                      title="ProtonDB - Linux compatibility rating"
                    >
                      <ShieldCheck className="h-3 w-3" />
                      Linux: {protonData.rating ? protonData.rating.charAt(0).toUpperCase() + protonData.rating.slice(1) : "Rated"}
                    </Badge>
                  ) : protonData && !protonData.success ? (
                    <Badge
                      variant="online"
                      className="px-3 py-1 rounded-full text-sky-400 border-sky-500/30 font-semibold flex items-center gap-1.5 backdrop-blur-md cursor-pointer transition-all hover:bg-black/80"
                      onClick={() => window.open("https://www.protondb.com/", "_blank")}
                      title="ProtonDB - Linux compatibility rating not available"
                    >
                      <ShieldCheck className="h-3 w-3" />
                      Linux: N/A
                    </Badge>
                  ) : null}
                </div>

                <div className="space-y-3">
                  {game.hero_logo ? (
                    <div className="relative h-20 w-full max-w-[min(70vw,520px)] md:h-28">
                      <img
                        src={proxyImageUrl(game.hero_logo) || ""}
                        alt={`${game.name} logo`}
                        className="h-full w-full object-contain object-left drop-shadow-[0_8px_32px_rgba(0,0,0,0.45)]"
                      />
                    </div>
                  ) : null}
                  <h1 className={cn(
                    "text-4xl md:text-6xl font-black text-white tracking-tight",
                    game.hero_logo ? "text-xl md:text-2xl text-white/90" : ""
                  )}>
                    {game.name}
                  </h1>
                  <p className="text-lg text-white/90 flex items-center gap-2 font-medium">
                    <User className="h-4 w-4" />
                    {game.developer || "Unknown Developer"}
                  </p>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* Version Switcher Tab Bar removed - single-version system */}

      <section className="container mx-auto px-4 py-12">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-8">
              <div className="p-8 rounded-3xl bg-zinc-900/60 border border-white/[.07] backdrop-blur-md shadow-xl">
                <h2 className="text-2xl font-black text-white mb-4 tracking-tight">About This Game</h2>
                <p className="text-base text-zinc-300 leading-relaxed whitespace-pre-wrap font-medium">
                  {game.description}
                </p>
              </div>

              {/* Additional Notes */}
              {game?.comment && (
                <div
                  ref={importantNoteRef}
                  className={`p-6 rounded-3xl backdrop-blur-md shadow-xl transition-all duration-500 ${
                    highlightImportantNote
                      ? 'ring-2 ring-yellow-400/60 scale-[1.02]'
                      : ''
                  } ${game.hasHv
                    ? 'bg-red-950/30 border border-red-500/30'
                    : 'bg-zinc-800/50 border border-white/[.07]'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div className={`p-2 rounded-full shrink-0 ${
                      game.hasHv ? 'bg-red-900/50' : 'bg-zinc-800/50'
                    }`}>
                      <AlertTriangle className={`h-5 w-5 ${game.hasHv ? 'text-red-400' : 'text-white'}`} />
                    </div>
                    <div>
                      <h3 className={`font-bold mb-1 ${game.hasHv ? 'text-red-300' : 'text-white'}`}>Important Note</h3>
                      <p className={`text-sm font-medium leading-relaxed ${game.hasHv ? 'text-red-200' : 'text-zinc-300'}`}>{game.comment}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Linux Experiences (community submissions) */}
              <div className="rounded-3xl overflow-hidden backdrop-blur-md bg-zinc-900/60 border border-white/[.07] shadow-xl">
                <LinuxExperiences appid={game.appid} />
              </div>

              {resolvedScreenshots.length > 0 && (
                <div className="p-8 rounded-3xl bg-zinc-900/60 border border-white/[.07] backdrop-blur-md shadow-xl">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xl font-black text-white">Screenshots</h3>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-zinc-400">{resolvedScreenshots.length} images</span>
                      <Button variant="outline" size="sm" className="h-8 px-3 rounded-full border-white/[.07] bg-zinc-900/40 hover:bg-zinc-800 text-white shadow-sm active:scale-95" onClick={() => openLightbox(0)}>
                        View All
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {resolvedScreenshots.slice(0, 6).map((screenshot, index) => (
                      <button
                        key={`${screenshot}-${index}`}
                        onClick={() => openLightbox(index)}
                        className="relative w-full aspect-video rounded-2xl overflow-hidden border border-white/[.07] hover:border-zinc-600 hover:scale-[1.02] transition-transform shadow-md active:scale-95"
                        aria-label={`Open screenshot ${index + 1}`}
                      >
                        <img
                          src={proxyImageUrl(screenshot) || "./banner.png"}
                          alt={`Screenshot ${index + 1}`}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      </button>
                    ))}

                    {resolvedScreenshots.length > 6 && (
                      <button
                        onClick={() => openLightbox(6)}
                        className="relative col-span-2 sm:col-auto w-full aspect-video rounded-2xl overflow-hidden border border-white/[.07] flex items-center justify-center bg-zinc-900/40 hover:bg-zinc-800 transition-colors backdrop-blur-sm active:scale-95"
                        aria-label="View more screenshots"
                      >
                        <div className="text-center">
                          <div className="text-xl font-black text-white">+{resolvedScreenshots.length - 6}</div>
                          <div className="text-sm font-medium text-zinc-400">more</div>
                        </div>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {game?.dlc && game.dlc.length > 0 && (
                <div className="p-8 rounded-3xl bg-zinc-900/60 border border-white/[.07] backdrop-blur-md shadow-xl">
                  <h2 className="text-2xl font-black text-white mb-4">
                    Included DLC ({game.dlc.length})
                  </h2>
                  <ul className="space-y-2 max-h-[400px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-foreground/20 hover:scrollbar-thumb-foreground/40">
                    {game.dlc.map((dlc, index) => (
                      <li key={`${dlc}-${index}`} className="flex items-center gap-3 text-zinc-300 font-medium bg-zinc-900/40 p-3 rounded-2xl border border-white/[.07] shadow-sm">
                        <span className="h-2 w-2 rounded-full bg-white flex-shrink-0" />
                        {dlc}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {game?.appid && (
                <SystemRequirements appid={game.appid} />
              )}

            </div>
            <div className="space-y-6">
              <div
                className={`p-8 rounded-3xl bg-zinc-950/60 border border-white/[.07] backdrop-blur-md shadow-xl ${showActionMenu ? "cursor-context-menu" : ""}`}
                onContextMenu={handleActionCardContextMenu}
              >
                <div className="flex items-center gap-3">
                  <Button
                    size="lg"
                    className={`flex-1 font-black text-lg py-7 rounded-full shadow-lg transition-all duration-300 active:scale-95 ${isGameRunning
                        ? "bg-destructive hover:bg-destructive/90"
                        : "bg-white text-black hover:bg-zinc-200"
                      }`}
                    onClick={() => {
                      if (isGameRunning) {
                        void stopRunningGame()
                      } else if (isInstalled) {
                        void launchInstalledGame()
                      } else if (isInstallReady) {
                        void installDownloadedArchive()
                      } else if (isPaused) {
                        void resumeGroup(game.appid)
                      } else {
                        void openHostSelector()
                      }
                    }}
                    disabled={actionDisabled || (isGameRunning && stoppingGame)}
                  >
                    {isGameRunning ? (
                      <Square className="mr-2 h-5 w-5" />
                    ) : isCheckingLinks ? (
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    ) : isInstalled ? (
                      <Play className="mr-2 h-5 w-5" />
                    ) : isInstallReady ? (
                      <HardDrive className="mr-2 h-5 w-5" />
                    ) : (
                      <Download className="mr-2 h-5 w-5" />
                    )}
                    {actionLabel}
                  </Button>

                  {showActionMenu ? (
                    <Popover open={actionMenuOpen} onOpenChange={setActionMenuOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          size="lg"
                          onClick={() => setActionMenuContextPosition(null)}
                          className="h-[52px] rounded-full border-white/[.07] bg-zinc-900/60 px-4 text-zinc-300 hover:bg-zinc-800 hover:text-white backdrop-blur-md active:scale-95"
                          aria-label="Game actions"
                        >
                          <MoreHorizontal className="h-4.5 w-4.5" />
                          <span className="text-sm font-medium">Actions</span>
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-auto border-none bg-transparent p-0 shadow-none">
                        <GameActionMenuPanel
                          gameName={game?.name || "Game"}
                          gameSource={game?.source}
                          isExternal={Boolean(installedManifest?.isExternal)}
                          isLinux={isLinux}
                          shortcutFeedback={shortcutFeedback}
                          onSetExecutable={() => {
                            setActionMenuOpen(false)
                            void openExecutablePicker()
                          }}
                          onOpenFiles={() => {
                            setActionMenuOpen(false)
                            void openGameFiles()
                          }}
                          onCreateShortcut={() => {
                            void handleCreateShortcut()
                          }}
                          onEditDetails={isExternalGame ? () => {
                            setActionMenuOpen(false)
                            setEditMetadataOpen(true)
                          } : undefined}
                          onLinuxConfig={isLinux ? () => {
                            setActionMenuOpen(false)
                            setLinuxConfigOpen(true)
                          } : undefined}
                          onDelete={() => {
                            setActionMenuOpen(false)
                            void handleDeleteGame()
                          }}
                        />
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

                {hasUpdate && !isInstalling && !isGameRunning && (
                  <Button
                    variant="outline"
                    className="mt-2 w-full border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 hover:text-amber-300"
                    onClick={() => setUpdateWarningOpen(true)}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Update available - {game.version}
                  </Button>
                )}

                {shortcutFeedback && (
                  <div className={`mt-2 text-xs ${shortcutFeedback.type === 'success' ? 'text-zinc-300' : 'text-destructive'}`}>
                    {shortcutFeedback.message}
                  </div>
                )}

                {(downloadError || failedDownload?.error) && (
                  <div className="mt-3 text-xs text-destructive">{downloadError || failedDownload?.error}</div>
                )}
              </div>

              <GameActionContextMenu
                open={Boolean(actionMenuContextPosition && showActionMenu)}
                position={actionMenuContextPosition}
                onClose={() => setActionMenuContextPosition(null)}
                gameName={game?.name || "Game"}
                gameSource={game?.source}
                isExternal={Boolean(installedManifest?.isExternal)}
                isLinux={isLinux}
                shortcutFeedback={null}
                onSetExecutable={() => {
                  setActionMenuContextPosition(null)
                  void openExecutablePicker()
                }}
                onOpenFiles={() => {
                  setActionMenuContextPosition(null)
                  void openGameFiles()
                }}
                onCreateShortcut={() => {
                  setActionMenuContextPosition(null)
                  void handleCreateShortcut()
                }}
                onEditDetails={isExternalGame ? () => {
                  setActionMenuContextPosition(null)
                  setEditMetadataOpen(true)
                } : undefined}
                onLinuxConfig={isLinux ? () => {
                  setActionMenuContextPosition(null)
                  setLinuxConfigOpen(true)
                } : undefined}
                onDelete={() => {
                  setActionMenuContextPosition(null)
                  void handleDeleteGame()
                }}
              />

              <div className={`grid grid-cols-2 gap-4${isUCMatched ? ' opacity-40 blur-[2px] pointer-events-none select-none' : ''}`}>
                <div className="p-5 rounded-3xl bg-zinc-900/60 border border-white/[.07] backdrop-blur-md text-center shadow-xl">
                  <Download className="h-6 w-6 text-white mx-auto mb-3 drop-shadow-md" />
                  <div className="text-3xl font-black text-white tracking-tight">
                    {formatNumber(effectiveDownloadCount)}
                  </div>
                  <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider mt-1">Downloads</div>
                </div>

                <div className="p-5 rounded-3xl bg-zinc-900/60 border border-white/[.07] backdrop-blur-md text-center shadow-xl">
                  <Eye className="h-6 w-6 text-blue-500 mx-auto mb-3 drop-shadow-md" />
                  <div className="text-3xl font-black text-white tracking-tight">
                    {formatNumber(effectiveViewCount)}
                  </div>
                  <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider mt-1">Views</div>
                </div>
              </div>

              <div className="p-8 rounded-3xl bg-zinc-900/60 border border-white/[.07] backdrop-blur-md space-y-5 shadow-xl">
                <div className="flex items-center justify-between">
                  <h3 className="font-black text-white tracking-tight">Details</h3>
                  {isExternalGame && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2.5 text-xs text-zinc-400 hover:text-white hover:bg-white/[.05]"
                      onClick={() => setEditMetadataOpen(true)}
                    >
                      <Settings className="mr-1.5 h-3 w-3" />
                      Edit
                    </Button>
                  )}
                </div>

                {isUCMatched && (
                  <div className="flex items-start gap-2 rounded-lg bg-zinc-800/50 border border-zinc-700/50 px-3 py-2 text-xs text-zinc-400">
                    <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                    <span>Matched from UC catalog - details may not reflect your installed version.</span>
                  </div>
                )}

                <div className={`space-y-4 text-sm font-medium${isUCMatched ? ' opacity-50 blur-[1.5px] select-none' : ''}`}>
                  <div className="flex items-center justify-between py-1.5 border-b border-white/[.07] pb-3">
                    <span className="text-zinc-400 flex items-center gap-2.5">
                      <Calendar className="h-4 w-4" />
                      Released
                    </span>
                    <span className="font-bold text-white">
                      {(() => {
                        const date = new Date(game.release_date)
                        return isNaN(date.getTime()) ? game.release_date : date.toLocaleDateString()
                      })()}
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-1.5 border-b border-white/[.07] pb-3">
                    <span className="text-zinc-400 flex items-center gap-2.5">
                      <Calendar className="h-4 w-4" />
                      Date Added
                    </span>
                    <span className="font-bold text-white">
                      {dateAddedLabel}
                    </span>
                  </div>

                  {game.update_time && (
                    <div className="flex items-center justify-between py-1.5 border-b border-white/[.07] pb-3">
                      <span className="text-zinc-400 flex items-center gap-2.5">
                        <RefreshCw className="h-4 w-4" />
                        Edited
                      </span>
                      <span className="font-bold text-white">
                        {timeAgoLong(game.update_time) || "just now"}
                      </span>
                    </div>
                  )}

                  {(game.version || installedVersionLabels.length > 0) && (
                    <div className="flex items-center justify-between py-1.5 border-b border-white/[.07] pb-3">
                      <span className="text-zinc-400">Version</span>
                      <span className="font-bold text-white">
                        {installedVersionLabels[0] || game.version}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between py-1.5 border-b border-white/[.07] pb-3">
                    <span className="text-zinc-400 flex items-center gap-2.5">
                      <HardDrive className="h-4 w-4" />
                      Size
                    </span>
                    <span className="font-bold text-white">{game?.size || "Unknown"}</span>
                  </div>

                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-zinc-400 flex items-center gap-2.5">Source</span>
                    <span className="font-bold text-white">
                      {game?.source ? (
                        <span className="relative group/source inline-flex">
                          <Badge variant="outline" className="px-2.5 py-1 text-xs max-w-[200px] border-white/[.07] bg-zinc-900/40 shadow-sm">
                            <span className="truncate inline-block">{game.source}</span>
                          </Badge>
                          <span className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 w-64 -translate-x-1/2 rounded-2xl border border-white/[.07] bg-zinc-950/95 px-3 py-2 text-[11px] leading-relaxed text-zinc-400 shadow-xl opacity-0 transition-opacity duration-150 group-hover/source:opacity-100 group-focus-within/source:opacity-100">
                            Source: {game.source}
                          </span>
                        </span>
                      ) : (
                        "Unknown"
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {game?.appid && (
                <GameVersionStatus
                  appid={game.appid}
                  gameName={game.name}
                  localVersionString={installedVersionLabels[0] || game.version || undefined}
                  isAuthed={authState.isAuthenticated}
                />
              )}

              {/* ── Collections & Tags ── */}
              <div className="p-8 rounded-3xl bg-zinc-900/60 border border-white/[.07] backdrop-blur-md space-y-5 shadow-xl">
                <div className="space-y-3">
                  <h3 className="section-label flex items-center gap-2">
                    <Layers3 className="h-4 w-4 text-zinc-400" />
                    Collections
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {(gameMeta.collections || []).map((c) => (
                      <Badge
                        key={c}
                        className="rounded-full border-zinc-700/50 bg-zinc-800/50 text-zinc-300 pl-2.5 pr-1 gap-1 cursor-pointer hover:bg-zinc-700/50"
                        onClick={() => void removeCollection(c)}
                      >
                        {c}
                        <X className="h-3 w-3 ml-0.5" />
                      </Badge>
                    ))}
                    {!(gameMeta.collections?.length) && (
                      <span className="text-xs text-zinc-500 italic">No collections</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={collectionInput}
                      onChange={(e) => setCollectionInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void addCollection() }}
                      placeholder="Add collection..."
                      className="h-8 text-xs flex-1"
                    />
                    <Button size="sm" className="h-8 px-3" onClick={() => void addCollection()} disabled={!collectionInput.trim()}>
                      Add
                    </Button>
                  </div>
                </div>
                <div className="h-px bg-white/10" />
                <div className="space-y-3">
                  <h3 className="section-label flex items-center gap-2">
                    <Tags className="h-4 w-4 text-zinc-400" />
                    Tags
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {(gameMeta.tags || []).map((t) => (
                      <Badge
                        key={t}
                        className="rounded-full border-zinc-700/50 bg-zinc-800/50 text-zinc-300 pl-2.5 pr-1 gap-1 cursor-pointer hover:bg-zinc-700/50"
                        onClick={() => void removeTag(t)}
                      >
                        #{t}
                        <X className="h-3 w-3 ml-0.5" />
                      </Badge>
                    ))}
                    {!(gameMeta.tags?.length) && (
                      <span className="text-xs text-zinc-500 italic">No tags</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void addTag() }}
                      placeholder="Add tag..."
                      className="h-8 text-xs flex-1"
                    />
                    <Button size="sm" className="h-8 px-3" onClick={() => void addTag()} disabled={!tagInput.trim()}>
                      Add
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="container mx-auto px-4 relative z-10">
        <div className="max-w-6xl mx-auto rounded-3xl overflow-hidden backdrop-blur-md bg-zinc-900/60 border border-white/[.07] shadow-xl">
          <GameComments appid={game.appid} gameName={game.name} />
        </div>
      </div>

      {relatedGames.length > 0 && (
        <section className="py-20 px-4 relative z-10">
          <div className="container mx-auto max-w-7xl">
            <h2 className="text-3xl md:text-4xl font-black text-white mb-10 text-center">
              You May Also Like
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 stagger-grid">
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

      {lightboxScreenshots.length > 0 && lightboxOpen && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/90 backdrop-blur-md z-[10000]" onClick={closeLightbox} aria-hidden="true" />

          <button
            className="absolute top-6 right-6 z-[10010] bg-zinc-800/50 hover:bg-zinc-700 border border-white/[.07] rounded-full p-3 backdrop-blur-md transition-all active:scale-95"
            onClick={closeLightbox}
            aria-label="Close"
          >
            <X className="h-6 w-6 text-white" />
          </button>

          <button
            onClick={prevLightbox}
            className="absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 z-[10010] p-2 sm:p-4 rounded-full bg-zinc-800/60 hover:bg-zinc-800 border border-white/[.07] backdrop-blur-md transition-all active:scale-95"
            aria-label="Previous"
          >
            <ChevronLeft className="h-6 w-6 sm:h-8 sm:w-8 text-white" />
          </button>

          <div
            className="relative z-[10010] max-w-[98vw] max-h-[92vh] flex items-center justify-center px-2 sm:px-4 pointer-events-auto"
            onWheel={(event) => {
              event.preventDefault()
              if (event.deltaY < 0) {
                zoomInLightbox()
              } else {
                zoomOutLightbox()
              }
            }}
          >
            <div className="w-full h-full flex items-center justify-center">
              <div
                ref={lightboxViewportRef}
                className="w-full max-w-[1600px] max-h-[88vh] flex items-center justify-center rounded-2xl overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.8)] border border-white/[.07]"
                style={{ touchAction: lightboxZoom > 1 ? "none" : "auto" }}
                onPointerDown={handleLightboxPointerDown}
                onPointerMove={handleLightboxPointerMove}
                onPointerUp={handleLightboxPointerUp}
                onPointerCancel={handleLightboxPointerUp}
              >
                <img
                  src={proxyImageUrl(getHighQualityScreenshotUrl(lightboxScreenshots[lightboxIndex])) || "./banner.png"}
                  alt={`Screenshot ${lightboxIndex + 1}`}
                  className={cn(
                    "max-w-full max-h-full object-contain mx-auto transition-transform duration-200 select-none",
                    lightboxZoom > 1 ? (lightboxDragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in",
                  )}
                  draggable={false}
                  onDragStart={(event) => event.preventDefault()}
                  style={{ transform: `translate(${lightboxPan.x}px, ${lightboxPan.y}px) scale(${lightboxZoom})` }}
                  onClick={() => {
                    if (suppressLightboxImageClickRef.current) {
                      suppressLightboxImageClickRef.current = false
                      return
                    }

                    if (lightboxZoom > 1) {
                      resetLightboxZoom()
                    } else {
                      setLightboxZoom(2)
                      setLightboxPan({ x: 0, y: 0 })
                    }
                  }}
                />
              </div>
            </div>
          </div>

          <button
            onClick={nextLightbox}
            className="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 z-[10010] p-2 sm:p-4 rounded-full bg-zinc-800/60 hover:bg-zinc-800 border border-white/[.07] backdrop-blur-md transition-all active:scale-95"
            aria-label="Next"
          >
            <ChevronRight className="h-6 w-6 sm:h-8 sm:w-8 text-white" />
          </button>

          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 bg-black/55 backdrop-blur-md px-3 sm:px-4 py-2 rounded-full border border-white/[.07] text-xs sm:text-sm font-bold text-white z-[10010] tracking-widest shadow-lg flex items-center gap-2 sm:gap-3">
            <button
              onClick={prevLightbox}
              className="md:hidden h-8 w-8 rounded-full border border-white/[.12] bg-zinc-900/70 hover:bg-zinc-800/80 flex items-center justify-center active:scale-95"
              aria-label="Previous screenshot"
            >
              <ChevronLeft className="h-4 w-4 text-white" />
            </button>
            <button
              onClick={zoomOutLightbox}
              className="h-8 w-8 rounded-full border border-white/[.12] bg-zinc-900/70 hover:bg-zinc-800/80 flex items-center justify-center active:scale-95"
              aria-label="Zoom out"
            >
              <Minus className="h-4 w-4 text-white" />
            </button>
            <button
              onClick={resetLightboxZoom}
              className="px-3 h-8 rounded-full border border-white/[.12] bg-zinc-900/70 hover:bg-zinc-800/80 text-[11px] sm:text-xs font-black text-white active:scale-95"
              aria-label="Reset zoom"
            >
              {`${Math.round(lightboxZoom * 100)}%`}
            </button>
            <button
              onClick={zoomInLightbox}
              className="h-8 w-8 rounded-full border border-white/[.12] bg-zinc-900/70 hover:bg-zinc-800/80 flex items-center justify-center active:scale-95"
              aria-label="Zoom in"
            >
              <Plus className="h-4 w-4 text-white" />
            </button>
            <span>{`${lightboxIndex + 1} / ${lightboxScreenshots.length}`}</span>
            <button
              onClick={nextLightbox}
              className="md:hidden h-8 w-8 rounded-full border border-white/[.12] bg-zinc-900/70 hover:bg-zinc-800/80 flex items-center justify-center active:scale-95"
              aria-label="Next screenshot"
            >
              <ChevronRight className="h-4 w-4 text-white" />
            </button>
          </div>
        </div>,
        document.body,
      )}
      </div>{/* close relative z-10 */}
      <UpdateBackupWarningModal
        open={updateWarningOpen}
        onProceed={async () => {
          setUpdateWarningOpen(false)
          setPendingForceDownload(true)
          void openHostSelector()
        }}
        onClose={() => setUpdateWarningOpen(false)}
      />
      <DownloadCheckModal
        open={hostSelectorOpen}
        game={game}
        downloadToken={downloadToken}
        defaultHost={defaultHost}
        onCheckingChange={setIsCheckingLinks}
        onConfirm={async (config: DownloadConfig) => {
          setHostSelectorOpen(false)
          setDownloadToken(null)
          setIsCheckingLinks(false)
          try {
            setPreferredDownloadHost(config.host)
          } catch { }
          const shouldForce = pendingForceDownload
          if (shouldForce) {
            try {
              // Back up the installed folder instead of deleting it outright.
              // If the download/extraction fails, main.cjs will restore from backup.
              await window.ucDownloads?.createUpdateBackup?.(game.appid)
              setInstalledManifest(null)
            } catch { }
          }
          await startDownload(config.host, config, shouldForce)
          setPendingForceDownload(false)
        }}
        onClose={() => {
          setHostSelectorOpen(false)
          setDownloadToken(null)
          setIsCheckingLinks(false)
          setPendingForceDownload(false)
        }}
      />
      {pendingDeleteAction && game && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setPendingDeleteAction(null)}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-border/60 bg-card/95 p-5 text-foreground shadow-2xl">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {pendingDeleteAction === "installing"
                ? "Remove download"
                : installedManifest?.isExternal
                  ? "Unlink game"
                  : "Delete game"}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
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
        onChooseAnother={reopenLaunchExecutablePicker}
        onContinue={launchPreflightResult?.canLaunch && pendingExePath
          ? async () => {
              const nextPath = pendingExePath
              setLaunchPreflightOpen(false)
              setLaunchPreflightResult(null)
              await handleLaunchWithShortcutCheck(nextPath, { skipPreflight: true })
            }
          : undefined}
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
      <GameLaunchFailedModal
        open={gameStartFailedOpen}
        gameName={game.name}
        onClose={() => setGameStartFailedOpen(false)}
      />
      {isLinux && (
        <GameLinuxConfigModal
          open={linuxConfigOpen}
          appid={game.appid}
          gameName={game.name}
          onClose={() => setLinuxConfigOpen(false)}
        />
      )}
    </div>
  )
}
