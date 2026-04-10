import { useState, useEffect, useCallback, useRef } from 'react'
import { Bell, Camera, Clock, Download, Gamepad2, Hammer, Pause, Play, Square, Volume2, VolumeX, X } from 'lucide-react'
import { ControllerOverlayFlyout } from './ControllerOverlayFlyout'

type OverlayApi = NonNullable<Window['ucOverlay']> & {
  onToast?: (callback: (data: {
    appid: string | null
    durationMs?: number
    vertical?: 'top' | 'bottom'
  }) => void) => () => void
  getGameInfo?: (appid?: string) => Promise<{ ok: boolean; appid?: string | null; gameName?: string; startedAt?: number; pid?: number; image?: string | null }>
  onPositionChanged?: (callback: (data: {
    position: string
    toastDurationMs?: number
    toastVertical?: 'top' | 'bottom'
  }) => void) => () => void
}

interface OverlayDownloadItem {
  id: string
  appid: string
  gameName: string
  status: string
  receivedBytes: number
  totalBytes: number
  speedBps: number
  etaSeconds: number | null
}

interface SystemNotification {
  id: string
  title: string
  body: string
  appId?: string
  icon?: string
  timestamp: number
  read: boolean
}

interface GameInfo {
  appid: string | null
  gameName: string
  startedAt: number
  image?: string | null
}

interface InstalledGame {
  appid: string
  name?: string
  metadata?: { name?: string; image?: string }
  installedAt?: number
}

type OverlayMode = 'hidden' | 'toast' | 'panel'
type OverlayDock = 'left' | 'right'
type OverlayVertical = 'top' | 'bottom'

const ACTIVE_DOWNLOAD_STATUSES = ['downloading', 'extracting', 'installing', 'queued', 'paused', 'verifying', 'retrying']

function getDock(position?: string | null): OverlayDock {
  return position?.toLowerCase().includes('right') ? 'right' : 'left'
}

function getDownloadBadge(status: string) {
  switch (status) {
    case 'extracting':
    case 'installing':
      return 'bg-amber-500/10 text-amber-300 border border-amber-400/15'
    case 'verifying':
      return 'bg-cyan-500/10 text-cyan-300 border border-cyan-400/15'
    case 'retrying':
      return 'bg-red-500/10 text-red-300 border border-red-400/15'
    case 'paused':
      return 'bg-zinc-800 text-zinc-300 border border-white/[.07]'
    case 'queued':
      return 'bg-zinc-900 text-zinc-400 border border-white/[.07]'
    default:
      return 'bg-white text-black border border-white/50'
  }
}

function getDownloadProgress(status: string) {
  switch (status) {
    case 'extracting':
    case 'installing':
      return 'linear-gradient(90deg, rgba(251,191,36,0.95), rgba(245,158,11,0.8))'
    case 'verifying':
      return 'linear-gradient(90deg, rgba(34,211,238,0.9), rgba(6,182,212,0.75))'
    case 'retrying':
      return 'linear-gradient(90deg, rgba(248,113,113,0.95), rgba(239,68,68,0.75))'
    case 'paused':
      return 'rgba(113,113,122,0.9)'
    case 'queued':
      return 'rgba(82,82,91,0.9)'
    default:
      return 'linear-gradient(90deg, rgba(255,255,255,0.95), rgba(212,212,216,0.7))'
  }
}

function getDownloadLabel(status: string) {
  switch (status) {
    case 'extracting':
      return 'Extracting'
    case 'installing':
      return 'Installing'
    case 'verifying':
      return 'Verifying'
    case 'retrying':
      return 'Retrying'
    case 'paused':
      return 'Paused'
    case 'queued':
      return 'Queued'
    default:
      return 'Downloading'
  }
}

function getOverlayApi() {
  return window.ucOverlay as OverlayApi | undefined
}

export function InGameOverlay() {
  const [mode, setMode] = useState<OverlayMode>('hidden')
  const [animated, setAnimated] = useState(false)
  const [currentAppid, setCurrentAppid] = useState<string | null>(null)
  const [hotkey, setHotkey] = useState('Ctrl+Shift+Tab')
  const [gameInfo, setGameInfo] = useState<GameInfo | null>(null)
  const [playtime, setPlaytime] = useState('0:00')
  const [downloads, setDownloads] = useState<OverlayDownloadItem[]>([])
  const [installedGames, setInstalledGames] = useState<InstalledGame[]>([])
  const [toastProgress, setToastProgress] = useState(100)
  const [currentTime, setCurrentTime] = useState(new Date())
  const [volume, setVolume] = useState(50)
  const [isMuted, setIsMuted] = useState(false)
  const [notifications, setNotifications] = useState<SystemNotification[]>([])
  const [showNotifications, setShowNotifications] = useState(false)
  const [screenshotTaken, setScreenshotTaken] = useState(false)
  const [showControllerFlyout, setShowControllerFlyout] = useState(false)
  const [dock, setDock] = useState<OverlayDock>('left')
  const [toastDurationMs, setToastDurationMs] = useState(5000)
  const [toastVertical, setToastVertical] = useState<OverlayVertical>('bottom')
  const [screenDimmed, setScreenDimmed] = useState(false)  
  const currentAppidRef = useRef<string | null>(null)
  const modeRef = useRef<OverlayMode>(mode)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toastProgressRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const playtimeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clockIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    currentAppidRef.current = currentAppid
  }, [currentAppid])

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  useEffect(() => {
    const setTransparent = (el: HTMLElement | null) => {
      if (!el) return
      el.style.setProperty('background', 'transparent', 'important')
      el.style.setProperty('background-color', 'transparent', 'important')
    }
    setTransparent(document.documentElement)
    setTransparent(document.body)
    setTransparent(document.getElementById('root'))
  }, [])

  useEffect(() => {
    if (mode === 'hidden') return
    setCurrentTime(new Date())
    clockIntervalRef.current = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => {
      if (clockIntervalRef.current) {
        clearInterval(clockIntervalRef.current)
        clockIntervalRef.current = null
      }
    }
  }, [mode])

  useEffect(() => {
    if (mode !== 'panel') return
    if (window.ucSystem?.getVolume) {
      window.ucSystem.getVolume().then((result) => {
        if (result.ok) setVolume(result.volume ?? 50)
      }).catch(() => {})
      window.ucSystem.getMuted().then((result) => {
        if (result.ok) setIsMuted(result.muted ?? false)
      }).catch(() => {})
    }
    if (window.ucSystem?.getNotifications) {
      window.ucSystem.getNotifications().then((result) => {
        if (result.ok) setNotifications(result.notifications || [])
      }).catch(() => {})
    }
  }, [mode])

  // Dim screen when overlay is visible
  useEffect(() => {
    if (mode === 'panel') {
      setScreenDimmed(true)
    } else if (mode === 'hidden') {
      setScreenDimmed(false)
    }
  }, [mode])

  const formatBytes = useCallback((bytes: number) => {
    if (bytes === 0) return '0 B'
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1)
    const value = bytes / Math.pow(1024, unit)
    return `${parseFloat(value.toFixed(value >= 10 || unit === 0 ? 0 : 1))} ${sizes[unit]}`
  }, [])

  const formatSpeed = useCallback((bps: number) => {
    if (bps <= 0) return '0 B/s'
    return `${formatBytes(bps)}/s`
  }, [formatBytes])

  const formatTime = useCallback((date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }, [])

  const formatNotificationTime = useCallback((timestamp: number) => {
    const diff = Date.now() - timestamp
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    if (minutes < 1) return 'now'
    if (minutes < 60) return `${minutes}m`
    if (hours < 24) return `${hours}h`
    return `${days}d`
  }, [])

  const handleVolumeChange = useCallback(async (newVolume: number) => {
    const clamped = Math.max(0, Math.min(100, newVolume))
    const shouldMute = clamped === 0
    setVolume(clamped)
    if (isMuted !== shouldMute) setIsMuted(shouldMute)
    if (window.ucSystem?.setVolume) {
      try {
        await window.ucSystem.setVolume(clamped)
      } catch {}
    }
    if (window.ucSystem?.setMuted && isMuted !== shouldMute) {
      try {
        await window.ucSystem.setMuted(shouldMute)
      } catch {}
    }
  }, [isMuted])

  const handleMuteToggle = useCallback(async () => {
    const nextMuted = !isMuted
    setIsMuted(nextMuted)
    if (window.ucSystem?.setMuted) {
      try {
        await window.ucSystem.setMuted(nextMuted)
      } catch {}
    }
  }, [isMuted])

  const handleScreenshot = useCallback(async () => {
    setScreenshotTaken(true)
    if (window.ucSystem?.takeScreenshot) {
      try {
        const result = await window.ucSystem.takeScreenshot()
        if (result.ok) {
          setTimeout(() => setScreenshotTaken(false), 1500)
          return
        }
      } catch {}
    }
    setTimeout(() => setScreenshotTaken(false), 1500)
  }, [])

  const updatePlaytime = useCallback((startedAt: number) => {
    const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
    const hours = Math.floor(elapsed / 3600)
    const minutes = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0')
    const seconds = String(elapsed % 60).padStart(2, '0')
    setPlaytime(hours > 0 ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`)
  }, [])

  const refreshGameInfo = useCallback(async (appid?: string | null) => {
    const overlay = getOverlayApi()
    if (!overlay?.getGameInfo) return
    const resolvedAppid = appid ?? currentAppidRef.current ?? undefined
    const result = await overlay.getGameInfo(resolvedAppid)
    if (result.ok && result.appid) {
      setGameInfo({
        appid: result.appid,
        gameName: result.gameName || result.appid,
        startedAt: result.startedAt || Date.now(),
        image: result.image || null,
      })
      return
    }
    if (resolvedAppid) {
      try {
        const fallback = await overlay.getGameInfo()
        if (fallback.ok && fallback.appid) {
          setGameInfo({
            appid: fallback.appid,
            gameName: fallback.gameName || fallback.appid,
            startedAt: fallback.startedAt || Date.now(),
            image: fallback.image || null,
          })
          return
        }
      } catch {}
    }
    if (overlay.getStatus) {
      try {
        const status = await overlay.getStatus()
        if (status?.ok && !status.currentAppid) {
          setCurrentAppid(null)
          setGameInfo(null)
          return
        }
      } catch {}
    }
    setGameInfo((prev) => {
      if (prev && resolvedAppid && prev.appid === resolvedAppid) return prev
      return null
    })
  }, [])

  const refreshDownloads = useCallback(async () => {
    const overlay = getOverlayApi()
    if (!overlay?.getDownloads) return
    const result = await overlay.getDownloads()
    if (result.ok) setDownloads(result.downloads || [])
  }, [])

  const loadInstalledGames = useCallback(async () => {
    try {
      const uc = (window as unknown as { ucDownloads?: { listInstalledGlobal: () => Promise<InstalledGame[]> } }).ucDownloads
      if (!uc?.listInstalledGlobal) return
      const list = await uc.listInstalledGlobal()
      const sorted = (list || [])
        .filter((item) => item && item.appid)
        .sort((a, b) => (b.installedAt || 0) - (a.installedAt || 0))
        .slice(0, 6)
      setInstalledGames(sorted)
    } catch {}
  }, [])

  const clearToastTimers = useCallback(() => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current)
      toastTimerRef.current = null
    }
    if (toastProgressRef.current) {
      clearInterval(toastProgressRef.current)
      toastProgressRef.current = null
    }
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = null
    }
  }, [])

  const enterMode = useCallback((nextMode: OverlayMode, appid?: string | null) => {
    clearToastTimers()
    if (nextMode === 'hidden') {
      modeRef.current = 'hidden'
      setAnimated(false)
      hideTimeoutRef.current = setTimeout(() => setMode('hidden'), 180)
      return
    }
    // Force React to re-render even if mode is the same (e.g. toast → toast).
    // This handles the case where a new toast fires while the old toast's mode
    // was stale (BrowserWindow hidden but renderer still thought it was toast).
    if (modeRef.current === nextMode) {
      setMode('hidden')
    }
    modeRef.current = nextMode
    setAnimated(false)
    // Use rAF to ensure the DOM resets before animating in
    requestAnimationFrame(() => {
      setMode(nextMode)
      if (appid !== undefined) setCurrentAppid(appid)
      requestAnimationFrame(() => setAnimated(true))
    })
    if (nextMode === 'toast') {
      setToastProgress(100)
      const start = Date.now()
      const duration = Math.max(2000, toastDurationMs)
      toastProgressRef.current = setInterval(() => {
        const progress = Math.max(0, 100 - ((Date.now() - start) / duration) * 100)
        setToastProgress(progress)
        if (progress <= 0 && toastProgressRef.current) clearInterval(toastProgressRef.current)
      }, 50)
      toastTimerRef.current = setTimeout(() => {
        setAnimated(false)
        hideTimeoutRef.current = setTimeout(() => setMode('hidden'), 180)
      }, duration + 150)
    }
    if (nextMode === 'panel') {
      refreshDownloads()
      loadInstalledGames()
    }
  }, [clearToastTimers, loadInstalledGames, refreshDownloads, toastDurationMs])

  useEffect(() => {
    const overlay = getOverlayApi()
    if (!overlay) return

    const unsubShow = overlay.onShow((data) => {
      setCurrentAppid(data.appid ?? null)
      refreshGameInfo(data.appid)
      enterMode('panel', data.appid)
    })

    const unsubHide = overlay.onHide(() => {
      enterMode('hidden')
    })

    const unsubStateChanged = overlay.onStateChanged((data) => {
      if (data.appid) setCurrentAppid(data.appid)
      if (!data.visible) {
        enterMode('hidden')
      }
    })

    const unsubToast = overlay.onToast?.((data) => {
      if (typeof data.durationMs === 'number') {
        setToastDurationMs(Math.max(2000, Math.min(12000, Math.round(data.durationMs))))
      }
      if (data.vertical === 'top' || data.vertical === 'bottom') {
        setToastVertical(data.vertical)
      }
      setCurrentAppid(data.appid ?? null)
      refreshGameInfo(data.appid)
      enterMode('toast', data.appid)
    })

    const unsubDownloads = overlay.onDownloadUpdate?.((data: unknown) => {
      const item = data as {
        downloadId?: string
        appid?: string
        gameName?: string
        status?: string
        receivedBytes?: number
        totalBytes?: number
        speedBps?: number
        etaSeconds?: number | null
      }
      if (!item?.downloadId) return
      const entry: OverlayDownloadItem = {
        id: item.downloadId,
        appid: item.appid || '',
        gameName: item.gameName || item.appid || 'Unknown',
        status: item.status || 'downloading',
        receivedBytes: item.receivedBytes || 0,
        totalBytes: item.totalBytes || 0,
        speedBps: item.speedBps || 0,
        etaSeconds: item.etaSeconds ?? null,
      }
      setDownloads((prev) => {
        if (['completed', 'failed', 'cancelled'].includes(entry.status)) {
          return prev.filter((download) => download.id !== entry.id)
        }
        const index = prev.findIndex((download) => download.id === entry.id)
        if (index >= 0) {
          const next = [...prev]
          next[index] = entry
          return next
        }
        return [...prev, entry]
      })
    })

    const unsubPosition = overlay.onPositionChanged?.((data) => {
      setDock(getDock(data.position))
      if (typeof data.toastDurationMs === 'number') {
        setToastDurationMs(Math.max(2000, Math.min(12000, Math.round(data.toastDurationMs))))
      }
      if (data.toastVertical === 'top' || data.toastVertical === 'bottom') {
        setToastVertical(data.toastVertical)
      }
    })

    overlay.getSettings().then((settings) => {
      if (!settings.ok) return
      setHotkey(settings.hotkey || 'Ctrl+Shift+Tab')
      setDock(getDock(settings.position))
      setToastDurationMs(Math.max(2000, Math.min(12000, Math.round(settings.toastDurationMs || 5000))))
      setToastVertical(settings.toastVertical === 'top' ? 'top' : 'bottom')
    }).catch(() => {})

    overlay.getStatus().then((status) => {
      if (!status.ok) return
      setDock(getDock(status.position))
      if (status.currentAppid) {
        setCurrentAppid(status.currentAppid)
        refreshGameInfo(status.currentAppid)
      }
    }).catch(() => {})

    return () => {
      unsubShow()
      unsubHide()
      unsubStateChanged()
      unsubToast?.()
      unsubDownloads?.()
      unsubPosition?.()
    }
  }, [enterMode, refreshGameInfo])

  useEffect(() => {
    if (mode !== 'panel' || !gameInfo?.startedAt) return
    updatePlaytime(gameInfo.startedAt)
    playtimeIntervalRef.current = setInterval(() => updatePlaytime(gameInfo.startedAt), 1000)
    return () => {
      if (playtimeIntervalRef.current) {
        clearInterval(playtimeIntervalRef.current)
        playtimeIntervalRef.current = null
      }
    }
  }, [gameInfo?.startedAt, mode, updatePlaytime])

  useEffect(() => {
    if (mode !== 'panel') return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        enterMode('hidden')
        window.ucOverlay?.hide()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enterMode, mode])

  const closePanelAndHide = useCallback(() => {
    enterMode('hidden')
    setTimeout(() => window.ucOverlay?.hide(), 200)
  }, [enterMode])

  const quitGame = useCallback(() => {
    const sessionId = gameInfo?.appid ?? currentAppid
    if (sessionId && (window as unknown as Record<string, unknown>).ucDownloads) {
      ;(window as unknown as { ucDownloads: { quitGameExecutable: (id: string) => void } }).ucDownloads.quitGameExecutable(sessionId)
    }
    closePanelAndHide()
  }, [closePanelAndHide, currentAppid, gameInfo?.appid])

  const quickLaunchGame = useCallback(async (game: InstalledGame) => {
    const uc = (window as unknown as {
      ucDownloads?: {
        listGameExecutables: (appid: string) => Promise<{ ok: boolean; exes?: { path: string }[] }>
        launchGameExecutable: (appid: string, exePath: string, name: string, show: boolean) => Promise<{ ok: boolean }>
      }
      ucSettings?: { get: (key: string) => Promise<string | null> }
    })
    const downloadsApi = uc.ucDownloads
    if (!downloadsApi?.launchGameExecutable || !downloadsApi?.listGameExecutables) return
    const gameName = game.metadata?.name || game.name || game.appid
    enterMode('hidden')
    try {
      const savedExe = await uc.ucSettings?.get?.(`gameExe:${game.appid}`)
      if (savedExe) {
        const result = await downloadsApi.launchGameExecutable(game.appid, savedExe, gameName, false)
        if (result?.ok) {
          setGameInfo({ appid: game.appid, gameName, startedAt: Date.now(), image: game.metadata?.image || null })
          enterMode('toast', game.appid)
        }
        return
      }
      const result = await downloadsApi.listGameExecutables(game.appid)
      if (result?.ok && result.exes?.[0]?.path) {
        const launch = await downloadsApi.launchGameExecutable(game.appid, result.exes[0].path, gameName, false)
        if (launch?.ok) {
          setGameInfo({ appid: game.appid, gameName, startedAt: Date.now(), image: game.metadata?.image || null })
          enterMode('toast', game.appid)
        }
      }
    } catch {}
  }, [enterMode])

  const activeDownloads = downloads.filter((download) => ACTIVE_DOWNLOAD_STATUSES.includes(download.status))
  const unreadNotifications = notifications.filter((notification) => !notification.read)
  const sessionAppid = gameInfo?.appid ?? currentAppid
  const hasSession = Boolean(sessionAppid)
  const panelSideClass = dock === 'right' ? 'right-6' : 'left-6'
  const quickActionsSideClass = dock === 'right' ? 'left-6' : 'right-6'
  const toastSideStyle = dock === 'right' ? { right: 24 } : { left: 24 }
  const toastVerticalClass = toastVertical === 'top' ? 'top-6' : 'bottom-6'

  if (mode === 'hidden') return null

  if (mode === 'toast') {
    return (
      <div
        className={`pointer-events-none fixed ${toastVerticalClass} z-[9999] w-[280px]`}
        style={toastSideStyle}
      >
        <div
          className={`glass rounded-2xl border border-white/[.08] !bg-zinc-950/92 p-3 shadow-[0_18px_60px_rgba(0,0,0,0.7)] transition-all duration-200 ${
            animated ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-white text-black">
              {gameInfo?.image ? (
                <img src={gameInfo.image} alt="" className="h-full w-full object-cover" />
              ) : (
                <Hammer size={15} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Now Playing</div>
              <div className="truncate text-sm font-semibold text-white">
                {gameInfo?.gameName || currentAppid || 'Game session'}
              </div>
            </div>
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[.08]">
            <div
              className="h-full rounded-full bg-white"
              style={{ width: `${toastProgress}%`, transition: 'width 50ms linear' }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-500">
            <span>Press to open overlay</span>
            <span className="token-chip text-[9px]">{hotkey}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div 
      className={`fixed inset-0 z-[9998] transition-all duration-300 ${
        screenDimmed ? 'bg-black/50' : ''
      }`}
      onClick={closePanelAndHide}
    >
      <div
        className={`pointer-events-auto absolute top-5 left-1/2 -translate-x-1/2 transition-all duration-200 ${
          animated ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="glass flex items-center gap-2 rounded-full border border-white/[.08] !bg-zinc-950/92 px-3 py-2 shadow-[0_12px_40px_rgba(0,0,0,0.55)]">
          <Clock size={14} className="text-zinc-500" />
          <span className="text-sm font-mono text-zinc-200">{formatTime(currentTime)}</span>
        </div>
      </div>

      <div
        className={`pointer-events-auto absolute top-5 ${quickActionsSideClass} flex items-center gap-2 transition-all duration-200 ${
          animated ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          onClick={handleScreenshot}
          className={`glass flex h-10 w-10 items-center justify-center rounded-xl border border-white/[.08] !bg-zinc-950/92 text-zinc-300 shadow-[0_12px_40px_rgba(0,0,0,0.55)] transition hover:bg-white/[.06] hover:text-white active:scale-95 ${
            screenshotTaken ? 'bg-emerald-500/10 text-emerald-300' : ''
          }`}
          title="Take Screenshot"
          aria-label="Take Screenshot"
        >
          <Camera size={15} />
        </button>

        <button
          onClick={() => setShowNotifications((current) => !current)}
          className={`glass relative flex h-10 w-10 items-center justify-center rounded-xl border border-white/[.08] !bg-zinc-950/92 text-zinc-300 shadow-[0_12px_40px_rgba(0,0,0,0.55)] transition hover:bg-white/[.06] hover:text-white active:scale-95 ${
            showNotifications ? 'bg-sky-500/10 text-sky-200' : ''
          }`}
          title="Notifications"
          aria-label="Notifications"
        >
          <Bell size={15} />
          {unreadNotifications.length > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[9px] font-bold text-black">
              {unreadNotifications.length > 9 ? '9+' : unreadNotifications.length}
            </span>
          )}
        </button>

        <div className="glass flex h-10 items-center gap-2 rounded-xl border border-white/[.08] !bg-zinc-950/92 px-2.5 shadow-[0_12px_40px_rgba(0,0,0,0.55)]">
          <button
            onClick={handleMuteToggle}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[.08] bg-zinc-900/85 text-zinc-400 transition hover:bg-white/[.06] hover:text-white active:scale-95"
            title={isMuted ? 'Unmute' : 'Mute'}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          <input
            type="range"
            min="0"
            max="100"
            value={isMuted ? 0 : volume}
            onChange={(event) => handleVolumeChange(Number(event.target.value))}
            className="h-1 w-20 appearance-none rounded-full bg-transparent"
            style={{
              background: `linear-gradient(to right, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.95) ${
                isMuted ? 0 : volume
              }%, rgba(255,255,255,0.15) ${isMuted ? 0 : volume}%, rgba(255,255,255,0.15) 100%)`,
            }}
          />
          <span className="w-9 text-right font-mono text-[10px] text-zinc-400">
            {isMuted ? 0 : volume}%
          </span>
        </div>

        <button
          onClick={() => setShowControllerFlyout((current) => !current)}
          className={`glass flex h-10 w-10 items-center justify-center rounded-xl border border-white/[.08] !bg-zinc-950/92 text-zinc-300 shadow-[0_12px_40px_rgba(0,0,0,0.55)] transition hover:bg-white/[.06] hover:text-white active:scale-95 ${
            showControllerFlyout ? 'bg-violet-500/10 text-violet-200' : ''
          }`}
          title="Controller Settings"
          aria-label="Controller Settings"
        >
          <Gamepad2 size={15} />
        </button>
      </div>

      {showNotifications && (
        <div
          className={`pointer-events-auto absolute top-[68px] ${quickActionsSideClass} w-[280px] overflow-hidden rounded-2xl border border-white/[.08] !bg-zinc-950/92 shadow-[0_24px_60px_rgba(0,0,0,0.7)] transition-all duration-200 ${
            animated ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
          }`}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-white/[.06] px-3 py-2">
            <span className="text-xs font-semibold text-white">Notifications</span>
            <span className="text-[10px] text-zinc-500">{notifications.length} total</span>
          </div>
          <div className="max-h-[230px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-4 py-6 text-center">
                <Bell size={20} className="text-zinc-600" />
                <div className="text-xs text-zinc-500">No notifications yet</div>
              </div>
            ) : (
              <div className="space-y-1 p-2">
                {notifications.slice(0, 10).map((notification) => (
                  <div
                    key={notification.id}
                    className={`rounded-xl border px-3 py-2 ${
                      notification.read
                        ? 'border-white/[.05] bg-white/[.02]'
                        : 'border-white/[.08] bg-white/[.05]'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {!notification.read && <span className="mt-1 h-2 w-2 rounded-full bg-sky-400" />}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-semibold text-white">{notification.title}</div>
                        <div className="mt-1 truncate text-[11px] text-zinc-500">{notification.body}</div>
                      </div>
                      <span className="text-[10px] text-zinc-500">{formatNotificationTime(notification.timestamp)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div
        className={`pointer-events-auto absolute top-5 ${panelSideClass} w-[320px] max-h-[calc(100vh-40px)] transition-all duration-200 ${
          animated ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-2 scale-[0.98]'
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="glass flex h-full flex-col overflow-hidden rounded-2xl border border-white/[.08] !bg-zinc-950/92 shadow-[0_28px_80px_rgba(0,0,0,0.7)]">
          <div className="flex items-center gap-3 border-b border-white/[.06] px-4 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-black">
              <Hammer size={15} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-brand text-white">UnionCrax.Direct</div>
              <div className="text-[10px] text-zinc-500">In-Game Overlay</div>
            </div>
            <button
              onClick={closePanelAndHide}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[.08] bg-zinc-900/85 text-zinc-400 transition hover:bg-white/[.06] hover:text-white active:scale-95"
              aria-label="Close overlay"
            >
              <X size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {hasSession && (
              <section className="border-b border-white/[.06] px-4 py-3">
                <div className="mb-2 flex items-center gap-2 text-emerald-300">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">Now Playing</span>
                </div>
                <div className="overflow-hidden rounded-xl border border-white/[.06] bg-white/[.03]">
                  {gameInfo?.image && (
                    <div className="h-20 w-full overflow-hidden">
                      <img src={gameInfo.image} alt="" className="h-full w-full object-cover" />
                    </div>
                  )}
                  <div className="p-3">
                    <div className="truncate text-sm font-semibold text-white">
                      {gameInfo?.gameName || 'Session active'}
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
                      <Clock size={12} className="text-zinc-500" />
                      {gameInfo?.startedAt ? (
                        <>
                          <span className="font-mono text-zinc-200">{playtime}</span>
                          <span className="text-[10px] text-zinc-500">session</span>
                        </>
                      ) : (
                        <span className="text-[10px] text-zinc-500">Live session</span>
                      )}
                    </div>
                    {!gameInfo?.gameName && sessionAppid && (
                      <div className="mt-2">
                        <span className="token-chip text-[9px]">App {sessionAppid}</span>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}

            {activeDownloads.length > 0 && (
              <section className="border-b border-white/[.06] px-4 py-3">
                <div className="flex items-center gap-2">
                  <Download size={12} className="text-sky-300" />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-200">Downloads</span>
                  <span className="ml-auto text-[10px] text-zinc-500">{activeDownloads.length} active</span>
                </div>
                <div className="mt-3 space-y-2">
                  {activeDownloads.slice(0, 5).map((download) => {
                    const progress = download.totalBytes > 0 ? Math.round((download.receivedBytes / download.totalBytes) * 100) : 0
                    const canPause = download.status === 'downloading'
                    const canResume = download.status === 'paused'
                    const statusLine = download.status === 'extracting'
                      ? 'Extracting...'
                      : download.status === 'installing'
                        ? 'Installing...'
                        : download.status === 'verifying'
                          ? 'Verifying integrity...'
                          : download.status === 'retrying'
                            ? 'Recovery in progress...'
                            : download.status === 'queued'
                              ? 'Queued'
                              : download.status === 'paused'
                                ? 'Paused'
                                : `${formatSpeed(download.speedBps)} | ${formatBytes(download.receivedBytes)} / ${formatBytes(download.totalBytes)}`

                    return (
                      <div key={download.id} className="rounded-xl border border-white/[.06] bg-white/[.03] p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-semibold text-white">{download.gameName || download.appid}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] ${getDownloadBadge(download.status)}`}>
                                {getDownloadLabel(download.status)}
                              </span>
                              <span className="token-chip text-[9px]">{progress}%</span>
                            </div>
                          </div>
                          {(canPause || canResume) && (
                            <button
                              onClick={() => {
                                if (canPause) window.ucOverlay?.pauseDownload(download.id)
                                if (canResume) window.ucOverlay?.resumeDownload(download.id)
                              }}
                              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[.08] bg-zinc-900/85 text-zinc-300 transition hover:bg-white/[.06] hover:text-white active:scale-95"
                              aria-label={canPause ? 'Pause download' : 'Resume download'}
                            >
                              {canPause ? <Pause size={12} /> : <Play size={12} />}
                            </button>
                          )}
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[.08]">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${progress}%`, background: getDownloadProgress(download.status), transition: 'width 300ms ease' }}
                          />
                        </div>
                        <div className="mt-2 text-[10px] text-zinc-500">{statusLine}</div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {hasSession && (
              <section className="border-b border-white/[.06] px-4 py-3">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={closePanelAndHide}
                    className="flex items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.06] px-3 py-2 text-left text-white transition hover:bg-white/[.12] active:scale-95"
                  >
                    <Play size={14} />
                    <div>
                      <div className="text-xs font-semibold">Resume</div>
                      <div className="text-[10px] text-zinc-400">Back to game</div>
                    </div>
                  </button>
                  <button
                    onClick={quitGame}
                    className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-left text-red-200 transition hover:bg-red-500/15 active:scale-95"
                  >
                    <Square size={14} />
                    <div>
                      <div className="text-xs font-semibold">Quit game</div>
                      <div className="text-[10px] text-red-200/70">Stop process</div>
                    </div>
                  </button>
                </div>
              </section>
            )}

            {!hasSession && installedGames.length > 0 && (
              <section className="border-b border-white/[.06] px-4 py-3">
                <div className="flex items-center gap-2">
                  <Gamepad2 size={12} className="text-violet-300" />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-200">Recently installed</span>
                </div>
                <div className="mt-2 space-y-1">
                  {installedGames.map((game) => (
                    <button
                      key={game.appid}
                      onClick={() => quickLaunchGame(game)}
                      className="flex w-full items-center gap-2 rounded-xl border border-white/[.06] bg-white/[.03] px-3 py-2 text-left transition hover:bg-white/[.06] active:scale-95"
                    >
                      <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-white/[.05] text-zinc-400">
                        {game.metadata?.image ? (
                          <img src={game.metadata.image} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <Gamepad2 size={14} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-semibold text-white">
                          {game.metadata?.name || game.name || game.appid}
                        </div>
                      </div>
                      <Play size={12} className="text-zinc-500" />
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>

          <div className="border-t border-white/[.06] px-4 py-3">
            <div className="flex items-center justify-center gap-2 text-[10px] text-zinc-500">
              <span>Close</span>
              <span className="token-chip text-[9px]">Esc</span>
              <span className="text-zinc-700">|</span>
              <span className="token-chip text-[9px]">{hotkey}</span>
              <span>Toggle</span>
            </div>
          </div>
        </div>
      </div>

      <ControllerOverlayFlyout
        visible={showControllerFlyout}
        onClose={() => setShowControllerFlyout(false)}
        position={dock === 'right' ? 'left' : 'right'}
      />
    </div>
  )
}

export default InGameOverlay
