
import { useEffect, useCallback, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react"
import { createPortal } from "react-dom"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { GameCard } from "@/components/GameCard"
import { GameComments } from "@/components/GameComments"
import { CommentMarkdown } from "@/components/CommentMarkdown"
import { useDownloads } from "@/context/downloads-context"
import { apiUrl, apiFetch } from "@/lib/api"
import { getPreferredDownloadHost, setPreferredDownloadHost, requestDownloadToken, type PreferredDownloadHost, type DownloadConfig } from "@/lib/downloads"
import { formatNumber, getUnambiguousExecutable, hasOnlineMode, matchAdminExecutable, proxyImageUrl, cn, timeAgoLong } from "@/lib/utils"
import { rememberGameName } from "@/lib/rpc-game-cache"
import { getPrefetchedGameDetail } from "@/lib/game-detail-prefetch"
import { useAccountLists } from "@/hooks/use-account-lists"
import { useRpcGameMute } from "@/hooks/use-rpc-game-mute"
import type { Game } from "@/lib/types"
import { useGamesData } from "@/hooks/use-games"
import { addViewedGameToHistory, hasCookieConsent } from "@/lib/user-history"
import { useConnectivityStatus } from "@/hooks/use-online-status"
import { OfflineLockout } from "@/components/OfflineLockout"
import { CriticalLoadModal } from "@/components/CriticalLoadModal"
import { X } from "@/components/icons"
import { Calendar, HardDrive, RefreshCw, Square } from "lucide-react"
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  Flame,
  Heart,
  ShieldCheck,
  Settings,
  Star,
  Trash2,
  Unlink2,
  User,
  Wifi,
  FolderOpen,
  Info,
  Loader2,
  Minus,
  MoreHorizontal,
  Plus,
  Play,
  Terminal,
} from "@/components/icons"
import { ExePickerModal } from "@/components/ExePickerModal"
import { GameLaunchFailedModal } from "@/components/GameLaunchFailedModal"
import { GameLaunchPreflightModal, type LaunchPreflightResult } from "@/components/GameLaunchPreflightModal"
import { GameExperience } from "@/components/GameExperience"
import { GameExperiencePrompt } from "@/components/GameExperiencePrompt"
import { GameRatingSummary } from "@/components/GameRatingSummary"
import { DownloadCheckModal } from "@/components/DownloadCheckModal"
import { DesktopShortcutModal } from "@/components/DesktopShortcutModal"
import { EditGameMetadataModal } from "@/components/EditGameMetadataModal"
import { GameActionContextMenu, GameActionMenuPanel, type CollectionPickerEntry } from "@/components/GameActionMenu"
import { useUserCollections } from "@/hooks/use-user-collections"
import { UpdateBackupWarningModal } from "@/components/VersionConflictModal"
import { GameLinuxConfigModal } from "@/components/GameLinuxConfigModal"
import { LaunchOptionsModal } from "@/components/LaunchOptionsModal"
import { gameLogger } from "@/lib/logger"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { MediaImage } from "@/components/ui/media-image"
import { MediaLightbox } from "@/components/MediaLightbox"
import { GamePageSkeleton } from "@/components/GamePageSkeleton"
import { SystemRequirements } from "@/components/SystemRequirements"
import { SystemRequirementsCheck } from "@/components/SystemRequirementsCheck"
import { GameVersionStatus } from "@/components/GameVersionStatus"
import { GameNotesPanel } from "@/components/GameNotesPanel"
import { PlaytimeChart } from "@/components/PlaytimeChart"
import { CommunityPlaytimeChart } from "@/components/CommunityPlaytimeChart"
import { GameTopPlayers, GameCommunityActivity, GameNowPlaying } from "@/components/GameCommunityActivity"
import { useAuth } from "@/hooks/useAuth"
import { useMotionPreferences } from "@/hooks/use-motion-preferences"
import { useImageColors } from "@/hooks/use-image-colors"
import { AuraBackground } from "@/components/aura-background"
import { PageAura } from "@/components/page-aura"

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
  const { isOnline, browserOnline, serviceReachable } = useConnectivityStatus()
  const navigate = useNavigate()
  const params = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [authState] = useAuth()
  const { startGameDownload, resumeGroup, downloads, clearByAppid } = useDownloads()
  const { games, stats } = useGamesData()
  const accountLists = useAccountLists()
  const rpcMute = useRpcGameMute(params.id || null)
  // Hooks must run before any early-return branch below, so hoist motion
  // prefs up here next to the other top-level hook calls. The result is
  // only consumed by the ambient-background JSX further down.
  const { colorAuraEnabled, reducedMotionEffective } = useMotionPreferences()
  const [game, setGame] = useState<Game | null>(null)
  // Colour extraction for the ambient background — must be hoisted here so
  // the hook count is stable across renders (game may be null while loading).
  const ambientImageSrc = game ? proxyImageUrl(game.hero_image || game.splash || game.image) : undefined
  const imageColors = useImageColors(ambientImageSrc, game?.appid)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [criticalLoadOpen, setCriticalLoadOpen] = useState(false)
  const hasCriticalServiceInterruption = browserOnline && !serviceReachable
  const [reloadNonce, setReloadNonce] = useState(0)
  const [downloadCount, setDownloadCount] = useState(0)
  const [viewCount, setViewCount] = useState(0)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  // Tabbed content area — matches the website's game page so the launcher
  // stays to roughly one screen instead of a long card stack.
  const [activeTab, setActiveTab] = useState<'overview' | 'screenshots' | 'community' | 'you'>('overview')
  const [selectedImage, setSelectedImage] = useState<string>("")
  const [heroImageLoaded, setHeroImageLoaded] = useState(false)
  const [logoLoaded, setLogoLoaded] = useState(false)
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
  const [selectedHost, setSelectedHost] = useState<PreferredDownloadHost>("ucfiles")
  const [defaultHost, setDefaultHost] = useState<PreferredDownloadHost>("ucfiles")
  const [downloadToken, setDownloadToken] = useState<string | null>(null)
  const [isCheckingLinks, setIsCheckingLinks] = useState(false)
  // Tracks whether the upcoming DownloadCheckModal session should auto-
  // confirm if every check goes green. Set when openHostSelector runs in
  // "auto" mode; consumed by the modal once it mounts.
  const [downloadAutoConfirm, setDownloadAutoConfirm] = useState(false)
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
  const [launchOptionsOpen, setLaunchOptionsOpen] = useState(false)

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
  const deepLinkLaunchHandledRef = useRef(false)

  // ProtonDB state
  const [protonData, setProtonData] = useState<any>(null)
  const [protonLoading, setProtonLoading] = useState(false)

  const appid = params.id || ""

  // Sync critical-load modal open state — placed here (after all state/ref
  // declarations) so the hook order is stable across renders (Rules of Hooks).
  useEffect(() => {
    setCriticalLoadOpen(Boolean(error) && hasCriticalServiceInterruption)
  }, [error, hasCriticalServiceInterruption])

  useEffect(() => {
    deepLinkLaunchHandledRef.current = false
  }, [appid])

  // Reset loaded states when the game changes or selected image changes
  useEffect(() => {
    setHeroImageLoaded(false)
  }, [selectedImage, appid])

  useEffect(() => {
    setLogoLoaded(false)
  }, [appid])

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
    // LRU-capped cache (see lib/rpc-game-cache.ts). Previously this wrote a
    // `uc_game_name:<id>` key per game that was never cleaned up.
    if (!id || !name) return
    rememberGameName(id, name)
  }

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        setError(null)

        // External games don't exist on the API - load directly from local manifest
        const isExternalId = appid.startsWith('external-')

        if (!isExternalId) {
          // If the GameCard's hover-intent prefetch already landed a body
          // for this appid we render from cache immediately (no skeleton),
          // then drop the loading flag right away. The api fetch below is
          // skipped on a fresh hit; a stale hit still goes through.
          const prefetched = getPrefetchedGameDetail(appid)
          if (prefetched) {
            setGame(prefetched)
            persistGameName(appid, prefetched?.name)
            window.dispatchEvent(new CustomEvent("uc_game_name", { detail: { appid, name: prefetched?.name, genres: prefetched?.genres } }))
            setSelectedImage(prefetched.hero_image || prefetched.splash || "")
            setLoading(false)
            return
          }
          const response = await apiFetch(`/api/games/${encodeURIComponent(appid)}`)
          if (response.status === 404) {
            // The game id genuinely doesn't exist on the API — usually
            // because it was removed from the catalog or the user followed
            // a stale link. Skip the network-error retry path and show a
            // dedicated "not found" UI; the existing manifest fallback
            // below still kicks in for locally-installed external entries.
            setError("not-found")
            setLoading(false)
            return
          }
          if (!response.ok) {
            throw new Error(`Unable to load game (${response.status})`)
          }
          const data = await response.json()
          setGame(data)
          persistGameName(appid, data?.name)
          window.dispatchEvent(new CustomEvent("uc_game_name", { detail: { appid, name: data?.name, genres: data?.genres } }))
          setSelectedImage(data.hero_image || data.splash || "")
          return
        }

        // For external (or offline fallback), load from installed manifest
        throw new Error('load from manifest')
      } catch (err) {
        gameLogger.warn("Game detail API load failed; attempting manifest fallback", {
          context: "Game",
          data: {
            appid,
            isExternal: appid.startsWith('external-'),
            error: err instanceof Error ? err.message : String(err),
          },
        })
        // Try fallback: ask main process for installed manifest
        try {
          if (window.ucDownloads?.getInstalledGlobal || window.ucDownloads?.getInstalled) {
            const manifest = await (window.ucDownloads.getInstalledGlobal?.(appid) || window.ucDownloads.getInstalled(appid))
            if (manifest && manifest.metadata) {
              const meta = manifest.metadata
              setGame(meta)
              persistGameName(appid, meta?.name)
              window.dispatchEvent(new CustomEvent("uc_game_name", { detail: { appid, name: meta?.name, genres: meta?.genres } }))
              // This branch is the offline / installed-manifest path: prefer the
              // locally-cached hero so the banner renders without a network round
              // trip (the remote URL would just 404 while offline).
              setSelectedImage(meta.localHeroImage || meta.localSplash || meta.hero_image || meta.splash || "")
              setError(null)
              gameLogger.info("Game detail fallback loaded from local manifest", {
                context: "Game",
                data: {
                  appid,
                },
              })
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
  }, [appid, reloadNonce])

  // A narrow signature of THIS game's download/install items (id + status only).
  // The status effects below must re-run on meaningful transitions (download
  // completes, install finishes) but NOT on every byte-progress tick — keying
  // them on the raw `downloads` array re-issued getInstalled/getInstalling/
  // listInstalledByAppid IPC to disk many times per second during any active
  // download anywhere in the app.
  const thisGameDownloadKey = useMemo(
    () => downloads.filter((d) => d.appid === appid).map((d) => `${d.id}:${d.status}`).join("|"),
    [downloads, appid],
  )

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
  }, [appid, thisGameDownloadKey])

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
  }, [appid, thisGameDownloadKey, installedManifest])

  useEffect(() => {
    if (!appid) return

    const fetchCounts = async () => {
      try {
        const downloadsRes = await apiFetch(`/api/downloads/count/${encodeURIComponent(appid)}`)
        if (downloadsRes.ok) {
          const data = await downloadsRes.json()
          if (data.success) setDownloadCount(data.downloads || 0)
        }
        const viewsRes = await apiFetch(`/api/views/${encodeURIComponent(appid)}`)
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
        const res = await apiFetch(`/api/views/${encodeURIComponent(appid)}`, {
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

  // Tear down the quick-exit IPC subscription if the page unmounts before the
  // event arrives (e.g. the user navigates away during the handoff grace).
  // Since we now accept the event past the 12 s window, an orphaned listener
  // could otherwise call setState on an unmounted page.
  useEffect(() => {
    return () => {
      try { gameQuickExitUnsubRef.current?.() } catch { }
      gameQuickExitUnsubRef.current = null
      gameJustLaunchedRef.current = 0
    }
  }, [])

  const handleHVTagClick = () => {
    // The Important Note lives in the Overview tab — switch to it first so the
    // scroll target is mounted before we scroll/highlight it.
    setActiveTab('overview')
    setTimeout(() => {
      if (importantNoteRef.current) {
        importantNoteRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setHighlightImportantNote(true)
        setTimeout(() => setHighlightImportantNote(false), 3000)
      }
    }, 50)
  }

  // Switch to the Community tab and scroll to an element inside it. Tab panels
  // render with `hidden` while inactive, so we flip the tab first and scroll on
  // the next frame. Used by the playtime nudge and the rating panel's CTA.
  const goToCommunity = (elementId: "comments" | "game-experience") => {
    setActiveTab("community")
    setTimeout(() => {
      if (elementId === "comments") {
        // GameComments owns its own scroll + highlight flash (it listens for
        // this event) so the landing spot is unmistakable.
        window.dispatchEvent(new CustomEvent("uc:focus-comments"))
      } else {
        document.getElementById(elementId)?.scrollIntoView({ behavior: "smooth", block: "start" })
      }
    }, 80)
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

  // Keyboard + zoom/pan are handled inside <MediaLightbox/>.

  const openHostSelector = async () => {
    if (!game) return
    // Three modes:
    //   "always" — current popup-every-time behaviour (default for users
    //              upgrading from a build where skipLinkCheck was false).
    //   "auto"   — open the modal but auto-confirm when everything's green.
    //              Users still see the popup whenever something matters
    //              (dead host, low disk, sysreq fail, HV title, etc.).
    //   "skip"   — never run the availability check, just queue immediately.
    //
    // We also honour the legacy `skipLinkCheck` boolean so existing settings
    // keep working until the next time the user touches the UI.
    let mode = await window.ucSettings?.get?.('downloadCheckMode') as ('always' | 'auto' | 'skip' | undefined)
    if (!mode) {
      const legacy = await window.ucSettings?.get?.('skipLinkCheck')
      mode = legacy === true ? 'skip' : 'auto'
    }

    try {
      const preferred = await getPreferredDownloadHost()
      setSelectedHost(preferred)
      setDefaultHost(preferred)

      if (mode === 'skip') {
        // Skip the popup entirely — start the download with defaults.
        setIsCheckingLinks(false)
        await startDownload(preferred)
        return
      }

      // Both "always" and "auto" run the availability check; "auto" tells
      // the modal to auto-confirm when every gate clears (see
      // autoConfirmIfGreen below).
      setDownloadAutoConfirm(mode === 'auto')
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
        // The saved path is absolute and can go stale after an update re-extracts
        // the game (different top-level folder, renamed exe, etc.). If it no longer
        // resolves, drop it and fall through to re-detection instead of dead-ending
        // on the "executable no longer exists" modal and forcing a manual reselect.
        const pre = await window.ucDownloads?.preflightGameLaunch?.(game.appid, savedExe)
        const exeMissing = pre?.ok && pre.checks?.some((c) => c.code === "exe-not-found")
        if (exeMissing) {
          await setSavedExe(null)
        } else {
          await handleLaunchWithShortcutCheck(savedExe)
          return
        }
      }

      const result = await window.ucDownloads.listGameExecutables(game.appid)
      const exes = result?.exes || []
      const folder = result?.folder || null
      const browseFolder = folder

      // Prefer the executable staff selected in the admin panel — it's the
      // authoritative choice for our release and avoids the wrong-exe guess.
      const adminExe = matchAdminExecutable(exes, game.game_executable_path, folder)
      if (adminExe) {
        await handleLaunchWithShortcutCheck(adminExe.path)
        return
      }

      // No admin exe set. If the folder has exactly one real executable there's
      // nothing to choose between — launch it directly. Only when it's
      // ambiguous (2+ candidates) do we surface the picker, so we never
      // silently guess the wrong .exe.
      const single = getUnambiguousExecutable(exes)
      if (single) {
        await handleLaunchWithShortcutCheck(single.path)
        return
      }

      // Ambiguous (or nothing found) — show the picker with the heuristic
      // best-guess highlighted so the launch target is an explicit choice.
      // Once picked it's saved, so this popup only appears on the first launch.
      await openExePicker(exes, {
        mode: "launch",
        actionLabel: "Launch",
        folder: browseFolder,
        message: exes.length
          ? `Our team hasn't set the launch file for "${game.name}" yet, so UC.D can't be sure which executable is the game. Pick the one to run — usually the largest, named after the game.`
          : `No executables were found for "${game.name}" yet. It may still be extracting, or you can browse to the correct file.`,
      })
    } catch { }
  }

  const launchInstalledGameRef = useRef(launchInstalledGame)
  launchInstalledGameRef.current = launchInstalledGame

  useEffect(() => {
    if (searchParams.get("launch") !== "1") return
    if (!game || loading) return
    if (deepLinkLaunchHandledRef.current) return
    deepLinkLaunchHandledRef.current = true
    setSearchParams({}, { replace: true })
    void launchInstalledGameRef.current()
  }, [game, loading, searchParams, setSearchParams])

  // Deep-link download intent. Other surfaces (right-click "Download", the
  // collection/library download buttons) route here with ?download=1 instead
  // of queueing silently, so the pre-download check modal + host selector —
  // which only live on this page — run consistently everywhere.
  const openHostSelectorRef = useRef<() => void | Promise<void>>(() => {})
  openHostSelectorRef.current = openHostSelector
  const deepLinkDownloadHandledRef = useRef(false)
  useEffect(() => {
    if (searchParams.get("download") !== "1") return
    if (!game || loading) return
    if (deepLinkDownloadHandledRef.current) return
    deepLinkDownloadHandledRef.current = true
    setSearchParams({}, { replace: true })
    void openHostSelectorRef.current()
  }, [game, loading, searchParams, setSearchParams])

  // Forward-declared so the auto-open effect below can reference it; the
  // ref is wired to the real `hasUpdate` value further down the file.
  const hasUpdateRef = useRef(false)
  const deepLinkUpdateHandledRef = useRef(false)

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
  // Local (uc-local://) copies of the art the metadata cacher wrote next to the
  // install. Source from the dedicated installedManifest effect first, but also
  // fall back to the game object itself — when we load offline from the local
  // manifest, `game` IS that metadata and already carries these fields, which
  // covers the first render before the installedManifest effect resolves.
  const localArt = {
    hero: installedMeta?.localHeroImage || game?.localHeroImage,
    splash: installedMeta?.localSplash || game?.localSplash,
    image: installedMeta?.localImage || game?.localImage,
    logo: installedMeta?.localHeroLogo || game?.localHeroLogo,
  }
  // Offline, the remote CDN art (hero_image/splash/image) can't load — but the
  // local copies can. So when offline, prefer the locally-cached art; online
  // keeps remote first (freshest / highest quality). Returns first usable URL.
  const pickArt = (remote: Array<string | undefined | null>, local: Array<string | undefined | null>): string => {
    const ordered = isOnline ? [...remote, ...local] : [...local, ...remote]
    return ordered.find((u) => typeof u === "string" && u.trim().length > 0) || ""
  }
  const localScreenshots: string[] = Array.isArray(installedMeta?.localScreenshots)
    ? installedMeta.localScreenshots.filter((entry: unknown): entry is string => typeof entry === "string" && entry.length > 0)
    : []
  const resolvedScreenshots = useMemo<string[]>(() => {
    if ((!game?.screenshots || game.screenshots.length === 0) && localScreenshots.length) {
      return localScreenshots
    }
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

  // Must be hoisted before any early return to keep the hook call count stable.
  const userCollections = useUserCollections()

  const collectionPicker = useMemo(() => ({
    collections: userCollections.collections.map<CollectionPickerEntry>((c) => ({
      id: c.id,
      name: c.name,
      included: game ? c.appids.includes(game.appid) : false,
    })),
    onAddToCollection: async (collectionId: string) => {
      if (!game) return
      const target = userCollections.collections.find((c) => c.id === collectionId)
      if (!target) return
      if (!target.appids.includes(game.appid)) {
        await userCollections.setMembership(target, [...target.appids, game.appid])
      }
    },
    onRemoveFromCollection: async (collectionId: string) => {
      if (!game) return
      const target = userCollections.collections.find((c) => c.id === collectionId)
      if (!target) return
      await userCollections.setMembership(target, target.appids.filter((id) => id !== game.appid))
    },
    onCreateCollection: async (name: string) => {
      if (!game) return
      await userCollections.create(name, [game.appid])
    },
  }), [userCollections, game])

  // Auto-open the update flow when GameCard hands us off via `?update=1`.
  // Must sit *before* the early returns below so the hook count stays
  // consistent between the loading and loaded renders (Rules of Hooks).
  useEffect(() => {
    if (searchParams.get("update") !== "1") return
    if (!game || loading) return
    const isInstalled = installedVersions.length > 0 || Boolean(installedManifest)
    // Wait until install state has resolved before deciding — otherwise we
    // could miss the chance because hasUpdate is still false on first render.
    if (installedVersionLabels.length === 0 && isInstalled) return
    if (deepLinkUpdateHandledRef.current) return
    const hasUpdate =
      isInstalled &&
      Boolean(game?.version) &&
      installedVersionLabels.length > 0 &&
      !installedVersionLabels.includes(game.version ?? "")
    deepLinkUpdateHandledRef.current = true
    const next = new URLSearchParams(searchParams)
    next.delete("update")
    setSearchParams(next, { replace: true })
    if (hasUpdate) {
      setUpdateWarningOpen(true)
    }
  }, [game, loading, installedVersions, installedManifest, installedVersionLabels, searchParams, setSearchParams])

  if (loading) {
    return (
      <div className="space-y-6">
        <GamePageSkeleton />
      </div>
    )
  }

  if (error || !game) {
    if (!isOnline) {
      // Offline and the game isn't installed locally (an installed game would
      // have loaded from its manifest above). Show the standard lockout rather
      // than a half-broken page — installed games stay reachable from Library.
      return <OfflineLockout />
    }
    // Dedicated "not found" path — the API returned 404, so retrying isn't
    // going to help. Show a calm explanation instead of a critical error.
    if (error === "not-found") {
      return (
        <div className="space-y-6 pt-12">
          <div className="mx-auto max-w-md rounded-3xl border border-dashed border-white/[.07] bg-white/[.02] px-8 py-10 text-center space-y-3">
            <div className="mx-auto h-12 w-12 rounded-full bg-white/[.04] border border-white/[.07] flex items-center justify-center">
              <Info className="h-5 w-5 text-muted-foreground/80" />
            </div>
            <h3 className="text-base font-semibold text-white">This game isn't in the catalog</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              We couldn't find <span className="font-mono text-foreground/80">{appid}</span> on union-crax.xyz. It may have been removed, renamed, or you might have followed an outdated link.
            </p>
            <div className="flex justify-center gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => navigate("/search")}>
                Browse the catalog
              </Button>
              <Button size="sm" onClick={() => navigate("/")}>
                Back to home
              </Button>
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="space-y-5">
        <CriticalLoadModal
          open={Boolean(error) && hasCriticalServiceInterruption && criticalLoadOpen}
          onOpenChange={setCriticalLoadOpen}
          title="Critical Data Load Failure"
          message={error || "Unable to load this game."}
          onRetry={() => {
            setError(null)
            setLoading(true)
            setReloadNonce((prev) => prev + 1)
          }}
          onContinue={() => setCriticalLoadOpen(false)}
        />

        <div className="rounded-2xl border border-border bg-card/55 px-4 py-3 text-sm text-foreground/80">
          We could not load this page right now. You can continue browsing or head back home.
        </div>

        <div className="flex justify-center">
          <Button
            variant="secondary"
            className="rounded-full px-7"
            onClick={() => navigate("/")}
          >
            <ChevronLeft className="mr-2 h-4 w-4" />
            Back to Home
          </Button>
        </div>
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
  // The big banner/splash must be a WIDE image. Prefer the real hero/splash
  // (remote, then the locally-cached copies) and only fall back to the
  // portrait cover (`image` / `localImage`) as a last resort — otherwise an
  // installed game with a perfectly good hero-image.jpg shows its box-art
  // stretched across the banner.
  const heroImage =
    selectedImage ||
    pickArt(
      [game.hero_image, game.splash, game.image],
      [localArt.hero, localArt.splash, localArt.image],
    )
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
  hasUpdateRef.current = hasUpdate
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
      : hasUpdate
        ? "Update"
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

  const createDesktopShortcut = async (exePath?: string | null) => {
    if (!window.ucDownloads?.createDesktopShortcut || !game) return null
    try {
      const result = await window.ucDownloads.createDesktopShortcut(game.name, game.appid, exePath || undefined)
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
      const exePath = await getSavedExe()
      const res = await createDesktopShortcut(exePath)
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

  const handleActionCardContextMenu= (event: ReactMouseEvent<HTMLDivElement>) => {
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
        setInstalledVersions([])
        setSelectedImage("")
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

      // Fast path: IPC event from main process when it detects a quick exit.
      // The main process is authoritative here — it only emits this for a real
      // quick exit (game died <5 s after launch, no successor adopted). Because
      // of the Windows launcher-handoff grace the event can arrive AFTER our
      // 12 s wall-clock window, so we trust it as long as we're still "armed"
      // (ref !== 0) rather than re-checking the deadline, which previously
      // swallowed the event and is why the modal stopped appearing.
      try { gameQuickExitUnsubRef.current?.() } catch { }
      gameQuickExitUnsubRef.current = window.ucDownloads?.onGameQuickExit?.((data) => {
        if (data?.appid !== game.appid) return
        if (gameJustLaunchedRef.current === 0) return
        gameJustLaunchedRef.current = 0
        try { gameQuickExitUnsubRef.current?.() } catch { }
        gameQuickExitUnsubRef.current = null
        void showStartFailedModal()
      }) ?? null
      // Fallback: the isGameRunning useEffect below detects exits within the 12 s window
    } else {
      // Launch failed outright (exe missing, spawn error, etc.). Previously this
      // path did nothing, so clicking Play on a broken exe looked like a no-op.
      // Surface the failure modal so the user can pick a different executable.
      setIsGameRunning(false)
      setGameStartFailedOpen(true)
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

  // Background source. Two mutually exclusive modes:
  //   • Animated backgrounds ON  → colour glow blobs only (no image)
  //   • Animated backgrounds OFF → static blurred cover image only
  const backgroundImage = pickArt(
    [game.hero_image, game.splash, game.image],
    [localArt.hero, localArt.splash, localArt.image],
  )
  // Wordmark/logo — offline prefers the cached copy so installed games keep
  // their logo instead of falling back to the plain text title.
  const heroLogo = pickArt([game.hero_logo], [localArt.logo])

  return (
    <div className="relative">
      {/* Ambient page background */}
      {game && (
        <>
          {/* Base layer: the game's own ambient aura, always visible. */}
          <AuraBackground
            colors={imageColors}
            show={colorAuraEnabled}
            reducedMotion={reducedMotionEffective}
            fallbackImageSrc={backgroundImage ? (proxyImageUrl(backgroundImage) || "./fallbacks/game-hero-16x9.svg") : "./fallbacks/game-hero-16x9.svg"}
          />
          {/* Overlay: fades in with hovered related-card colors. Stacking (vs
              swapping the base layer's colors) avoids triggering its internal
              slot crossfade on every hover, which read as a flash. */}
          <PageAura />
        </>
      )}

      <div className="relative z-10 space-y-12">
      <section className="relative pt-6">
        <div className="max-w-6xl mx-auto">
          <div className="relative rounded-3xl overflow-hidden border border-white/[.07] bg-[#1A1A1A]/80 backdrop-blur-md shadow-[0_8px_32px_0_rgba(0,0,0,0.5)]">
              <div className="relative aspect-video overflow-hidden">
                {!heroImageLoaded && <div className="udl-skeleton absolute inset-0 z-0 rounded-none" />}
                <MediaImage
                  unwrapped
                  src={proxyImageUrl(heroImage || "") || "./fallbacks/game-hero-16x9.svg"}
                  alt={game.name}
                  fallbackSrc="./fallbacks/game-hero-16x9.svg"
                  className="h-full w-full object-cover"
                  onLoad={() => setHeroImageLoaded(true)}
                  onError={() => setHeroImageLoaded(true)}
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
                        : "bg-secondary/50 border-white/[.07] text-white hover:bg-zinc-700"
                        }`}
                    >
                      {genre}
                    </Badge>
                  ))}
                  {isPopular && (
                    <Badge className="px-3 py-1 rounded-full bg-secondary/60 text-white backdrop-blur-sm border border-white/10 text-xs font-bold uppercase tracking-wider shadow-lg">
                      <Flame className="w-3 h-3 mr-1 fill-current" /> Popular
                    </Badge>
                  )}
                  {hasOnlineMode(game?.hasCoOp) && (
                    <Badge className="px-3 py-1 rounded-full bg-emerald-500/20 border-emerald-500/30 text-emerald-400 font-semibold flex items-center gap-1.5 backdrop-blur-md">
                      <Wifi className="h-3 w-3" />
                      Multiplayer
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
                    <Badge className="px-3 py-1 rounded-full bg-secondary/60 border-white/[.07] text-foreground/80 font-semibold flex items-center gap-1.5 backdrop-blur-md">
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
                  {heroLogo ? (
                    <div className="relative h-20 w-full max-w-[min(70vw,520px)] md:h-28">
                      {!logoLoaded && <div className="udl-skeleton absolute inset-0 rounded-lg" />}
                      <MediaImage
                        unwrapped
                        src={proxyImageUrl(heroLogo) || ""}
                        alt={`${game.name} logo`}
                        showErrorState={false}
                        className="h-full w-full object-contain object-left drop-shadow-[0_8px_32px_rgba(0,0,0,0.45)]"
                        onLoad={() => setLogoLoaded(true)}
                        onError={() => setLogoLoaded(true)}
                      />
                    </div>
                  ) : null}
                  <h1 className={cn(
                    "text-4xl md:text-6xl font-black text-white tracking-tight",
                    heroLogo ? "text-xl md:text-2xl text-white/90" : ""
                  )}>
                    {game.name}
                  </h1>
                  <div className="text-lg text-white/90 flex items-center gap-2 font-medium">
                    <User className="h-4 w-4" />
                    {game.developer || "Unknown Developer"}
                  </div>
                  {/* Live "who's in this game right now" — self-hides when
                      nobody is currently playing. */}
                  {game?.appid && <GameNowPlaying appid={game.appid} className="mt-3" />}
                </div>
              </div>
            </div>

          </div>
      </section>

      {/* Version Switcher Tab Bar removed - single-version system */}

      <section className="max-w-6xl mx-auto py-12">
          {/* "You've played X for Y — leave a review" nudge. Self-hides unless
              the signed-in viewer has playtime on this game. */}
          {game?.appid && (
            <div className="mb-6">
              <GameExperiencePrompt
                key={game.appid}
                appid={game.appid}
                gameName={game.name}
                onLeaveComment={() => goToCommunity("comments")}
                onRate={() => goToCommunity("game-experience")}
              />
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6 min-w-0">
              {/* Tab bar — keeps the page to roughly one screen. Mirrors the
                  website's game page tabs. */}
              {(() => {
                const tabs: { id: typeof activeTab; label: string; show: boolean }[] = [
                  { id: "overview", label: "Overview", show: true },
                  { id: "screenshots", label: "Screenshots", show: true },
                  { id: "community", label: "Community", show: true },
                  { id: "you", label: "You", show: authState.isAuthenticated },
                ]
                return (
                  <div className="flex flex-wrap items-center gap-1.5 border-b border-white/[.07] pb-3">
                    {tabs.filter((t) => t.show).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setActiveTab(t.id)}
                        aria-pressed={activeTab === t.id}
                        className={`rounded-full border px-4 py-2 text-sm font-semibold transition-colors active:scale-95 ${
                          activeTab === t.id
                            ? "border-white/15 bg-white/[.08] text-white"
                            : "border-white/[.07] bg-white/[.03] text-foreground/70 hover:bg-white/[.06] hover:text-white"
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                )
              })()}

              {/* ── Overview tab ─────────────────────────────────────── */}
              <div className={activeTab === "overview" ? "space-y-6" : "hidden"}>
              <div className="p-6 rounded-2xl bg-card/40 border border-white/[.07]">
                <h2 className="text-2xl font-black text-white mb-4 tracking-tight">About This Game</h2>
                <p className="text-base text-foreground/80 leading-relaxed whitespace-pre-wrap font-medium">
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
                    : 'bg-secondary/50 border border-white/[.07]'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div className={`p-2 rounded-full shrink-0 ${
                      game.hasHv ? 'bg-red-900/50' : 'bg-secondary/50'
                    }`}>
                      <AlertTriangle className={`h-5 w-5 ${game.hasHv ? 'text-red-400' : 'text-white'}`} />
                    </div>
                    <div>
                      <h3 className={`font-bold mb-1 ${game.hasHv ? 'text-red-300' : 'text-white'}`}>Important Note</h3>
                      <CommentMarkdown text={game.comment} className={`text-sm font-medium ${game.hasHv ? 'text-red-200' : 'text-foreground/80'}`} />
                    </div>
                  </div>
                </div>
              )}

              {/* DLC — always rendered, with an empty state instead of
                  vanishing when none are listed. */}
              <div className="p-6 rounded-2xl bg-card/40 border border-white/[.07]">
                <h2 className="text-2xl font-black text-white mb-4">
                  {game?.dlc && game.dlc.length > 0 ? `Included DLC (${game.dlc.length})` : "DLC"}
                </h2>
                {game?.dlc && game.dlc.length > 0 ? (
                  <ul className="space-y-2 max-h-[400px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-foreground/20 hover:scrollbar-thumb-foreground/40">
                    {game.dlc.map((dlc, index) => (
                      <li key={`${dlc}-${index}`} className="flex items-center gap-3 text-foreground/80 font-medium bg-card/40 p-3 rounded-2xl border border-white/[.07] shadow-sm">
                        <span className="h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                        {dlc}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-center font-medium text-muted-foreground/80 py-6 bg-card/30 rounded-2xl border border-white/[.07]">
                    No DLC is listed for this game yet.
                  </div>
                )}
              </div>

              {game?.appid && (
                <>
                  <SystemRequirementsCheck
                    minRequirements={game.minRequirements}
                    recommendedRequirements={game.recommendedRequirements}
                    linuxMinRequirements={game.linuxMinRequirements}
                    linuxRecommendedRequirements={game.linuxRecommendedRequirements}
                  />
                  <SystemRequirements appid={game.appid} />
                </>
              )}
              </div>
              {/* end Overview tab */}

              {/* ── Screenshots tab (always present; shows an empty state
                  rather than vanishing when there are none) ──────────── */}
              <div className={activeTab === "screenshots" ? "" : "hidden"}>
                {resolvedScreenshots.length > 0 ? (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-xl font-black text-white">Screenshots</h3>
                      <span className="text-sm font-medium text-muted-foreground">{resolvedScreenshots.length} images</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {resolvedScreenshots.map((screenshot, index) => (
                        <button
                          key={`${screenshot}-${index}`}
                          onClick={() => openLightbox(index)}
                          className="relative w-full aspect-video rounded-2xl overflow-hidden border border-white/[.07] hover:border-zinc-600 hover:scale-[1.02] transition-transform shadow-md active:scale-95"
                          aria-label={`Open screenshot ${index + 1}`}
                        >
                          <MediaImage
                            unwrapped
                            src={proxyImageUrl(screenshot) || "./fallbacks/game-shot-16x9.svg"}
                            alt={`Screenshot ${index + 1}`}
                            fallbackSrc="./fallbacks/game-shot-16x9.svg"
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="rounded-2xl border border-white/[.07] bg-card/40 py-16 text-center">
                    <div className="text-sm font-semibold text-foreground/80">No screenshots available</div>
                    <div className="text-xs text-muted-foreground/70 mt-1">This game doesn&apos;t have any screenshots yet.</div>
                  </div>
                )}
              </div>

              {/* ── Community tab ────────────────────────────────────── */}
              <div className={activeTab === "community" ? "space-y-6" : "hidden"}>
                {game?.appid && <CommunityPlaytimeChart appid={game.appid} gameName={game.name} gameImage={game.image} />}
                {game?.appid && <GameTopPlayers appid={game.appid} />}
                {game?.appid && <GameCommunityActivity appid={game.appid} />}
                <GameExperience
                  appid={game.appid}
                  gameName={game.name}
                  onLeaveComment={() => goToCommunity("comments")}
                />
                {game?.appid && (
                  <GameComments appid={game.appid} gameName={game.name} />
                )}
              </div>

              {/* ── You tab (signed-in only) ─────────────────────────── */}
              {authState.isAuthenticated && (
                <div className={activeTab === "you" ? "space-y-6" : "hidden"}>
                  {game?.appid && <PlaytimeChart appid={game.appid} gameName={game.name} gameImage={game.image} />}
                  {game?.appid && isInstalled && <GameNotesPanel appid={game.appid} />}
                </div>
              )}

            </div>
            <div className="space-y-6 lg:sticky lg:top-24 lg:self-start">
              {/*
                Redesigned action card.
                Goals:
                  - Status pill at the top so users see "Installed v1.2.3" /
                    "Running" / "Downloading 23 %" without parsing the button.
                  - One hero CTA that does the right thing for the current
                    state (Play / Update / Install / Resume / Quit / Download).
                  - A horizontal row of quick-action chips (Open Files, Set
                    Executable, Wishlist, Liked, Hide RPC) — replaces the
                    old "Actions" outline button whose label and shape made
                    the card feel half-finished.
                  - Less-common actions (Linux config, Create Shortcut, Edit
                    Details, Delete) tucked behind a small overflow button.
              */}
              <div
                className="rounded-3xl bg-background/60 border border-white/[.07] backdrop-blur-md shadow-xl cursor-context-menu overflow-hidden"
                onContextMenu={handleActionCardContextMenu}
              >
                {/* Status header */}
                {(() => {
                  let dotClass = "bg-zinc-500"
                  let label: string = "Not installed"
                  let sub: string | null = null
                  if (isGameRunning) {
                    dotClass = "bg-emerald-400 animate-pulse"
                    label = "Running"
                  } else if (isInstalling) {
                    dotClass = "bg-amber-400 animate-pulse"
                    label = "Installing"
                  } else if (isQueued) {
                    dotClass = "bg-zinc-400 animate-pulse"
                    label = "Queued for download"
                  } else if (isPaused) {
                    dotClass = "bg-zinc-400"
                    label = "Download paused"
                  } else if (isFailed) {
                    dotClass = "bg-red-400"
                    label = "Download failed"
                  } else if (isInstallReady) {
                    dotClass = "bg-sky-400"
                    label = "Ready to install"
                  } else if (isInstalled) {
                    dotClass = hasUpdate ? "bg-amber-400" : "bg-emerald-400"
                    label = hasUpdate ? "Update available" : "Installed"
                    if (installedVersionLabels[0]) sub = `v${installedVersionLabels[0]}`
                  }
                  return (
                    <div className="flex items-center justify-between gap-3 px-6 pt-5 pb-4 border-b border-white/[.05]">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={cn("h-2 w-2 rounded-full shrink-0", dotClass)} aria-hidden />
                        <span className="text-sm font-semibold text-white truncate">{label}</span>
                        {sub && <span className="text-xs text-muted-foreground/80 truncate">· {sub}</span>}
                      </div>
                      {/* Overflow for less-common actions. Compact icon button
                          instead of the outline "Actions" text button. */}
                      {(showActionMenu || isExternalGame) && (
                        <Popover open={actionMenuOpen} onOpenChange={setActionMenuOpen}>
                          <PopoverTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setActionMenuContextPosition(null)}
                              className="h-8 w-8 rounded-full text-muted-foreground hover:bg-white/[.06] hover:text-white"
                              aria-label="More game actions"
                              title="More game actions"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent align="end" sideOffset={6} className="w-auto border-none bg-transparent p-0 shadow-none">
                            <GameActionMenuPanel
                              gameName={game?.name || "Game"}
                              gameSource={game?.source}
                              isExternal={Boolean(installedManifest?.isExternal)}
                              isLinux={isLinux}
                              shortcutFeedback={shortcutFeedback}
                              // Show the FULL action set in the overflow
                              // menu — the chip row below is a quick-access
                              // subset, but users expect the 3-dot menu to be
                              // exhaustive. Duplication between chips and
                              // menu is intentional (Steam / Epic / GOG all
                              // do this) so right-click and overflow line up.
                              onSetExecutable={showActionMenu ? () => {
                                setActionMenuOpen(false)
                                void openExecutablePicker()
                              } : null}
                              onOpenFiles={showActionMenu ? () => {
                                setActionMenuOpen(false)
                                void openGameFiles()
                              } : null}
                              onCreateShortcut={showActionMenu ? () => {
                                void handleCreateShortcut()
                              } : null}
                              onLaunchOptions={showActionMenu ? () => {
                                setActionMenuOpen(false)
                                setLaunchOptionsOpen(true)
                              } : null}
                              onEditDetails={isExternalGame ? () => {
                                setActionMenuOpen(false)
                                setEditMetadataOpen(true)
                              } : undefined}
                              onLinuxConfig={isLinux && showActionMenu ? () => {
                                setActionMenuOpen(false)
                                setLinuxConfigOpen(true)
                              } : undefined}
                              onDelete={showActionMenu ? () => {
                                setActionMenuOpen(false)
                                void handleDeleteGame()
                              } : null}
                              wishlist={accountLists.authed === false || !game?.appid ? undefined : {
                                inList: accountLists.wishlist.has(game.appid),
                                toggle: () => { void accountLists.toggleWishlist(game.appid, game.name) },
                              }}
                              favorites={accountLists.authed === false || !game?.appid ? undefined : {
                                inList: accountLists.favorites.has(game.appid),
                                toggle: () => { void accountLists.toggleFavorite(game.appid, game.name) },
                              }}
                              rpcMute={game?.appid ? {
                                muted: rpcMute.muted,
                                toggle: () => { void rpcMute.toggle() },
                              } : undefined}
                            />
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                  )
                })()}

                {/* Hero CTA */}
                <div className="px-6 pt-5 pb-4">
                  <Button
                    size="lg"
                    className={`w-full font-black text-lg py-7 rounded-2xl shadow-lg transition-all duration-300 active:scale-[0.98] ${isGameRunning
                        ? "bg-destructive hover:bg-destructive/90"
                        : "bg-primary text-primary-foreground hover:brightness-110"
                      }`}
                    onClick={() => {
                      if (isGameRunning) {
                        void stopRunningGame()
                      } else if (hasUpdate) {
                        // White "Update" button drives the update flow (via
                        // the backup warning modal) instead of launching.
                        setUpdateWarningOpen(true)
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
                    ) : hasUpdate ? (
                      <RefreshCw className="mr-2 h-5 w-5" />
                    ) : isInstalled ? (
                      <Play className="mr-2 h-5 w-5" />
                    ) : isInstallReady ? (
                      <HardDrive className="mr-2 h-5 w-5" />
                    ) : (
                      <Download className="mr-2 h-5 w-5" />
                    )}
                    {actionLabel}
                  </Button>

                  {isFailed && (
                    <Button
                      variant="secondary"
                      className="mt-3 w-full rounded-xl"
                      onClick={() => void openHostSelector()}
                      disabled={downloading}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Retry
                    </Button>
                  )}

                  {shortcutFeedback && (
                    <div className={`mt-2 text-xs ${shortcutFeedback.type === 'success' ? 'text-foreground/80' : 'text-destructive'}`}>
                      {shortcutFeedback.message}
                    </div>
                  )}

                  {(downloadError || failedDownload?.error) && (
                    <div className="mt-3 text-xs text-destructive">{downloadError || failedDownload?.error}</div>
                  )}
                </div>

                {/* Quick action chips */}
                {(() => {
                  const chips: Array<{
                    key: string
                    icon: typeof Play
                    label: string
                    onClick: () => void
                    active?: boolean
                    activeIconClass?: string
                  }> = []
                  if (showActionMenu) {
                    chips.push({
                      key: "files",
                      icon: FolderOpen,
                      label: "Open files",
                      onClick: () => { void openGameFiles() },
                    })
                    chips.push({
                      key: "exe",
                      icon: Settings,
                      label: "Executable",
                      onClick: () => { void openExecutablePicker() },
                    })
                  }
                  if (accountLists.authed !== false && game?.appid) {
                    chips.push({
                      key: "wishlist",
                      icon: Star,
                      label: accountLists.wishlist.has(game.appid) ? "Wishlisted" : "Wishlist",
                      onClick: () => { void accountLists.toggleWishlist(game.appid, game.name) },
                      active: accountLists.wishlist.has(game.appid),
                      activeIconClass: "text-amber-400",
                    })
                    chips.push({
                      key: "liked",
                      icon: Heart,
                      label: accountLists.favorites.has(game.appid) ? "Liked" : "Like",
                      onClick: () => { void accountLists.toggleFavorite(game.appid, game.name) },
                      active: accountLists.favorites.has(game.appid),
                      activeIconClass: "text-rose-400",
                    })
                  }
                  if (game?.appid) {
                    chips.push({
                      key: "rpc",
                      icon: rpcMute.muted ? EyeOff : Eye,
                      label: rpcMute.muted ? "RPC hidden" : "On Discord",
                      onClick: () => { void rpcMute.toggle() },
                      active: rpcMute.muted,
                      activeIconClass: "text-fuchsia-400",
                    })
                  }
                  if (chips.length === 0) return null
                  return (
                    <div className="flex flex-wrap gap-1.5 border-t border-white/[.05] bg-white/[.015] px-3 py-3">
                      {chips.map(({ key, icon: Icon, label, onClick, active, activeIconClass }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={onClick}
                          title={label}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold transition-colors active:scale-95",
                            active
                              ? "border-white/15 bg-white/[.07] text-white"
                              : "border-white/[.07] bg-white/[.03] text-foreground/80 hover:bg-white/[.07] hover:text-white"
                          )}
                        >
                          <Icon className={cn("h-3.5 w-3.5", active ? activeIconClass : "text-muted-foreground")} />
                          <span className="truncate max-w-[7rem]">{label}</span>
                        </button>
                      ))}
                    </div>
                  )
                })()}
              </div>

              <GameActionContextMenu
                open={Boolean(actionMenuContextPosition)}
                position={actionMenuContextPosition}
                onClose={() => setActionMenuContextPosition(null)}
                gameName={game?.name || "Game"}
                gameSource={game?.source}
                isExternal={Boolean(installedManifest?.isExternal)}
                isLinux={isLinux}
                shortcutFeedback={null}
                onSetExecutable={showActionMenu ? () => {
                  setActionMenuContextPosition(null)
                  void openExecutablePicker()
                } : undefined}
                onOpenFiles={showActionMenu ? () => {
                  setActionMenuContextPosition(null)
                  void openGameFiles()
                } : undefined}
                onCreateShortcut={showActionMenu ? () => {
                  setActionMenuContextPosition(null)
                  void handleCreateShortcut()
                } : undefined}
                onLaunchOptions={showActionMenu ? () => {
                  setActionMenuContextPosition(null)
                  setLaunchOptionsOpen(true)
                } : undefined}
                onEditDetails={isExternalGame ? () => {
                  setActionMenuContextPosition(null)
                  setEditMetadataOpen(true)
                } : undefined}
                onLinuxConfig={isLinux && showActionMenu ? () => {
                  setActionMenuContextPosition(null)
                  setLinuxConfigOpen(true)
                } : undefined}
                onDelete={showActionMenu ? () => {
                  setActionMenuContextPosition(null)
                  void handleDeleteGame()
                } : undefined}
                wishlist={accountLists.authed === false || !game?.appid ? undefined : {
                  inList: accountLists.wishlist.has(game.appid),
                  toggle: () => { void accountLists.toggleWishlist(game.appid, game.name) },
                }}
                favorites={accountLists.authed === false || !game?.appid ? undefined : {
                  inList: accountLists.favorites.has(game.appid),
                  toggle: () => { void accountLists.toggleFavorite(game.appid, game.name) },
                }}
                rpcMute={game?.appid ? {
                  muted: rpcMute.muted,
                  toggle: () => { void rpcMute.toggle() },
                } : undefined}
                collectionPicker={collectionPicker}
              />

              {/* Compact stats strip. Was two oversized cards with giant icons +
                  shadows — now a single horizontal panel so the sidebar stays
                  scannable instead of feeling like a stack of dashboards. */}
              <div className={cn(
                "flex items-stretch rounded-2xl bg-card/60 border border-white/[.07] backdrop-blur-md overflow-hidden shadow-md",
                isUCMatched && "opacity-40 blur-[2px] pointer-events-none select-none"
              )}>
                <div className="flex-1 flex items-center gap-3 px-4 py-3">
                  <Download className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <div className="text-base font-bold text-white tabular-nums leading-tight truncate">
                      {formatNumber(effectiveDownloadCount)}
                    </div>
                    <div className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-wider">Downloads</div>
                  </div>
                </div>
                <div className="w-px bg-white/[.05]" />
                <div className="flex-1 flex items-center gap-3 px-4 py-3">
                  <Eye className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <div className="text-base font-bold text-white tabular-nums leading-tight truncate">
                      {formatNumber(effectiveViewCount)}
                    </div>
                    <div className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-wider">Views</div>
                  </div>
                </div>
              </div>

              {/* Rating quick-view — average stars, count and Windows/Linux
                  split at a glance; opens the full rating panel. */}
              {game?.appid && (
                <GameRatingSummary
                  appid={game.appid}
                  onOpen={() => goToCommunity("game-experience")}
                />
              )}

              {/* Lighter Details card — was p-8 rounded-3xl with shadow-xl,
                  which made it dominate the sidebar. Toned down to match the
                  rest of the redesigned column. */}
              <div className="p-5 rounded-2xl bg-card/60 border border-white/[.07] backdrop-blur-md space-y-4 shadow-md">
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Details</h3>
                  {isExternalGame && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2.5 text-xs text-muted-foreground hover:text-white hover:bg-white/[.05]"
                      onClick={() => setEditMetadataOpen(true)}
                    >
                      <Settings className="mr-1.5 h-3 w-3" />
                      Edit
                    </Button>
                  )}
                </div>

                {isUCMatched && (
                  <div className="flex items-start gap-2 rounded-lg bg-secondary/50 border border-border/50 px-3 py-2 text-xs text-muted-foreground">
                    <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                    <span>Matched from UC catalog - details may not reflect your installed version.</span>
                  </div>
                )}

                <div className={`space-y-4 text-sm font-medium${isUCMatched ? ' opacity-50 blur-[1.5px] select-none' : ''}`}>
                  <div className="flex items-center justify-between py-1.5 border-b border-white/[.07] pb-3">
                    <span className="text-muted-foreground flex items-center gap-2.5">
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
                    <span className="text-muted-foreground flex items-center gap-2.5">
                      <Calendar className="h-4 w-4" />
                      Date Added
                    </span>
                    <span className="font-bold text-white">
                      {dateAddedLabel}
                    </span>
                  </div>

                  {game.update_time && (
                    <div className="flex items-center justify-between py-1.5 border-b border-white/[.07] pb-3">
                      <span className="text-muted-foreground flex items-center gap-2.5">
                        <RefreshCw className="h-4 w-4" />
                        Edited
                      </span>
                      <span className="font-bold text-white">
                        {timeAgoLong(game.update_time) || "just now"}
                      </span>
                    </div>
                  )}

                  {(game.version || installedVersionLabels.length > 0) && (() => {
                    const displayVersion = installedVersionLabels[0] || game.version || ""
                    const isBeta = /\s*[-–]\s*BETA\s*$/i.test(displayVersion)
                    const baseVersion = isBeta ? displayVersion.replace(/\s*[-–]\s*BETA\s*$/i, "").trim() : displayVersion
                    return (
                      <div className="flex items-center justify-between py-1.5 border-b border-white/[.07] pb-3">
                        <span className="text-muted-foreground">Version</span>
                        <span className={`font-bold ${isBeta ? "text-red-400" : "text-white"}`}>
                          {baseVersion}
                          {isBeta && <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wider bg-red-500/20 text-red-400 border border-red-500/30 rounded px-1 py-0.5">BETA</span>}
                        </span>
                      </div>
                    )
                  })()}

                  <div className="flex items-center justify-between py-1.5 border-b border-white/[.07] pb-3">
                    <span className="text-muted-foreground flex items-center gap-2.5">
                      <HardDrive className="h-4 w-4" />
                      Size
                    </span>
                    <span className="font-bold text-white">{game?.size || "Unknown"}</span>
                  </div>

                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-muted-foreground flex items-center gap-2.5">Source</span>
                    <span className="font-bold text-white">
                      {game?.source ? (
                        <span className="relative group/source inline-flex">
                          <Badge variant="outline" className="px-2.5 py-1 text-xs max-w-[200px] border-white/[.07] bg-card/40 shadow-sm">
                            <span className="truncate inline-block">{game.source}</span>
                          </Badge>
                          <span className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 w-64 -translate-x-1/2 rounded-2xl border border-white/[.07] bg-background/95 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground shadow-xl opacity-0 transition-opacity duration-150 group-hover/source:opacity-100 group-focus-within/source:opacity-100">
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

              {/* Playtime chart, notes and community feeds now live in the
                  You / Community content tabs to keep this sidebar focused on
                  the install/play actions and key details. */}

            </div>
          </div>
      </section>

      {relatedGames.length > 0 && (
        <section className="py-20 relative z-10">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-black text-white mb-10 text-center">
              You May Also Like
            </h2>
            <div className="mb-6 text-center">
              <Link
                to="/search?sort=recommended"
                className="text-sm font-semibold text-foreground/80 underline decoration-zinc-500/60 underline-offset-4 transition hover:text-white hover:decoration-white"
              >
                More Recommended
              </Link>
            </div>
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

      <MediaLightbox
        open={lightboxOpen}
        index={lightboxIndex}
        onIndexChange={setLightboxIndex}
        onClose={() => setLightboxOpen(false)}
        images={lightboxScreenshots.map((shot, i) => ({
          src: proxyImageUrl(getHighQualityScreenshotUrl(shot)) || "./fallbacks/game-shot-16x9.svg",
          alt: `Screenshot ${i + 1}`,
          fallbackSrc: "./fallbacks/game-shot-16x9.svg",
        }))}
      />
      </div>{/* close relative z-10 */}
      <UpdateBackupWarningModal
        open={updateWarningOpen}
        currentVersion={installedVersionLabels[0] ?? null}
        newVersion={game?.version ?? null}
        releasedAt={game?.update_time ?? null}
        gameName={game?.name ?? null}
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
        autoConfirmIfGreen={downloadAutoConfirm}
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
            className="absolute inset-0 bg-black/72 backdrop-blur-md"
            onClick={() => setPendingDeleteAction(null)}
          />
          <div className="relative w-full max-w-md rounded-3xl border border-white/[.07] bg-background/88 backdrop-blur-2xl p-5 text-foreground shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
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
        onPickExecutable={() => { void openExecutablePicker() }}
        hasOnlineSupport={hasOnlineMode(game?.hasCoOp)}
      />
      <LaunchOptionsModal
        open={launchOptionsOpen}
        appid={game.appid}
        gameName={game.name}
        onClose={() => setLaunchOptionsOpen(false)}
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
