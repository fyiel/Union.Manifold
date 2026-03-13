import { useState, useEffect, useCallback, useRef } from 'react'
import { Bell, Camera, Clock, Gamepad2, Hammer, Loader2, Pause, Play, Square, Volume2, VolumeX, X } from 'lucide-react'
import { ControllerOverlayFlyout } from './ControllerOverlayFlyout'

type OverlayApi = NonNullable<Window['ucOverlay']> & {
  onToast?: (callback: (data: { appid: string | null }) => void) => () => void
  getGameInfo?: (appid?: string) => Promise<{ ok: boolean; appid?: string | null; gameName?: string; startedAt?: number; pid?: number; image?: string | null }>
  onPositionChanged?: (callback: (data: { position: string }) => void) => () => void
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
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toastProgressRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const playtimeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clockIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

  const formatEta = useCallback((seconds: number | null) => {
    if (!seconds || seconds <= 0) return '--'
    const minutes = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    if (minutes > 60) {
      const hours = Math.floor(minutes / 60)
      return `${hours}h ${minutes % 60}m`
    }
    if (minutes > 0) return `${minutes}m ${secs}s`
    return `${secs}s`
  }, [])

  const handleVolumeChange = useCallback(async (newVolume: number) => {
    setVolume(newVolume)
    if (window.ucSystem?.setVolume) {
      try {
        await window.ucSystem.setVolume(newVolume)
      } catch {}
    }
  }, [])

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
    const result = await overlay.getGameInfo(appid || undefined)
    if (result.ok && result.appid) {
      setGameInfo({
        appid: result.appid,
        gameName: result.gameName || result.appid,
        startedAt: result.startedAt || Date.now(),
        image: result.image || null,
      })
      return
    }
    setGameInfo(null)
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
      setAnimated(false)
      hideTimeoutRef.current = setTimeout(() => setMode('hidden'), 180)
      return
    }
    setMode(nextMode)
    if (appid !== undefined) setCurrentAppid(appid)
    requestAnimationFrame(() => requestAnimationFrame(() => setAnimated(true)))
    if (nextMode === 'toast') {
      setToastProgress(100)
      const start = Date.now()
      const duration = 5000
      toastProgressRef.current = setInterval(() => {
        const progress = Math.max(0, 100 - ((Date.now() - start) / duration) * 100)
        setToastProgress(progress)
        if (progress <= 0 && toastProgressRef.current) clearInterval(toastProgressRef.current)
      }, 50)
      toastTimerRef.current = setTimeout(() => {
        setAnimated(false)
        hideTimeoutRef.current = setTimeout(() => setMode('hidden'), 180)
      }, 5150)
    }
    if (nextMode === 'panel') {
      refreshDownloads()
      loadInstalledGames()
    }
  }, [clearToastTimers, loadInstalledGames, refreshDownloads])

  useEffect(() => {
    const overlay = getOverlayApi()
    if (!overlay) return

    const unsubShow = overlay.onShow((data) => {
      setCurrentAppid(data.appid)
      refreshGameInfo(data.appid)
      enterMode('panel', data.appid)
    })

    const unsubHide = overlay.onHide(() => {
      setGameInfo(null)
      enterMode('hidden')
    })

    const unsubStateChanged = overlay.onStateChanged((data) => {
      if (!data.visible) {
        setGameInfo(null)
        enterMode('hidden')
      }
    })

    const unsubToast = overlay.onToast?.((data) => {
      setCurrentAppid(data.appid)
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
    })

    overlay.getSettings().then((settings) => {
      if (!settings.ok) return
      setHotkey(settings.hotkey || 'Ctrl+Shift+Tab')
      setDock(getDock(settings.position))
    }).catch(() => {})

    overlay.getStatus().then((status) => {
      if (!status.ok) return
      setDock(getDock(status.position))
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
    if (currentAppid && (window as unknown as Record<string, unknown>).ucDownloads) {
      ;(window as unknown as { ucDownloads: { quitGameExecutable: (id: string) => void } }).ucDownloads.quitGameExecutable(currentAppid)
    }
    closePanelAndHide()
  }, [closePanelAndHide, currentAppid])

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
  const panelSideStyle = dock === 'right' ? { right: 24 } : { left: 24 }
  const toastSideStyle = dock === 'right' ? { right: 24 } : { left: 24 }
  const panelTransform = animated
    ? 'translate3d(0, 0, 0) scale(1)'
    : `translate3d(${dock === 'right' ? '14px' : '-14px'}, 0, 0) scale(0.98)`

  if (mode === 'hidden') return null

  if (mode === 'toast') {
    return (
      <div
        className="pointer-events-none fixed bottom-6 z-[9999] w-[320px]"
        style={{
          ...toastSideStyle,
          opacity: animated ? 1 : 0,
          transform: animated ? 'translateY(0)' : 'translateY(12px)',
          transition: 'opacity 180ms ease, transform 180ms ease',
        }}
      >
        <div className="glass overflow-hidden rounded-[24px] border border-white/[.07] bg-zinc-950/80 shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
          <div className="flex items-center gap-3 p-4">
            <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl bg-white text-black">
              {gameInfo?.image ? (
                <img src={gameInfo.image} alt="" className="h-full w-full object-cover" />
              ) : (
                <Hammer size={16} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Overlay Ready</div>
              <div className="truncate text-sm font-semibold tracking-tight text-white">
                {gameInfo?.gameName || currentAppid || 'Game session'}
              </div>
            </div>
            <div className="rounded-full border border-white/[.07] bg-zinc-900/80 px-2.5 py-1 font-mono text-[10px] text-zinc-400">
              {hotkey}
            </div>
          </div>
          <div className="px-4 pb-3 text-xs text-zinc-400">Open the full panel to manage downloads, controls, and session tools.</div>
          <div className="h-px bg-white/[.06]" />
          <div className="h-1 bg-white/[.06]">
            <div
              className="h-full rounded-r-full bg-white"
              style={{ width: `${toastProgress}%`, transition: 'width 50ms linear' }}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[9998]" onClick={closePanelAndHide}>
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.06), transparent 0 28%), linear-gradient(180deg, rgba(9,9,11,0.18), rgba(9,9,11,0.06) 38%, rgba(9,9,11,0.14) 100%)',
        }}
      />

      <div
        className="pointer-events-auto absolute left-1/2 top-6 z-[9999] -translate-x-1/2"
        onClick={(event) => event.stopPropagation()}
        style={{
          opacity: animated ? 1 : 0,
          transform: `translateX(-50%) translateY(${animated ? '0' : '-8px'})`,
          transition: 'opacity 180ms ease, transform 180ms ease',
        }}
      >
        <div className="glass flex items-center gap-3 rounded-full border border-white/[.07] bg-zinc-950/70 px-4 py-2 shadow-[0_12px_40px_rgba(0,0,0,0.4)]">
          <Clock size={14} className="text-zinc-500" />
          <span className="font-mono text-sm text-zinc-100">{formatTime(currentTime)}</span>
          <span className="h-1 w-1 rounded-full bg-zinc-700" />
          <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">{gameInfo ? 'Session live' : 'Overlay standby'}</span>
        </div>
      </div>

      <div
        className="pointer-events-auto absolute bottom-6 top-6 z-[9999] w-[380px]"
        style={{
          ...panelSideStyle,
          opacity: animated ? 1 : 0,
          transform: panelTransform,
          transition: 'opacity 180ms ease, transform 180ms ease',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="glass flex h-full flex-col overflow-hidden rounded-[30px] border border-white/[.07] bg-zinc-950/78 shadow-[0_28px_100px_rgba(0,0,0,0.58)]">
          <div className="flex items-center gap-4 border-b border-white/[.07] px-5 py-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-black">
              <Hammer size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">UnionCrax Direct</div>
              <div className="truncate text-lg font-black tracking-tight text-white">Overlay Console</div>
            </div>
            <div className="rounded-full border border-white/[.07] bg-zinc-900/80 px-3 py-1 font-mono text-[10px] text-zinc-400">
              {hotkey}
            </div>
            <button
              onClick={closePanelAndHide}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[.07] bg-zinc-900/80 text-zinc-400 transition hover:bg-white/[.05] hover:text-white active:scale-95"
              aria-label="Close overlay"
            >
              <X size={14} />
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
            <section className="relative overflow-hidden rounded-[28px] border border-white/[.07] bg-zinc-900/70 p-5">
              {gameInfo?.image && (
                <>
                  <img src={gameInfo.image} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" />
                  <div className="absolute inset-0 bg-gradient-to-br from-zinc-950/90 via-zinc-950/82 to-zinc-900/78" />
                </>
              )}
              <div className="relative space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-full border border-white/[.07] bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-black">
                    {gameInfo ? 'Now playing' : 'Ready'}
                  </span>
                  <span className="rounded-full border border-white/[.07] bg-zinc-900/80 px-3 py-1 font-mono text-[11px] text-zinc-300">
                    {gameInfo ? playtime : `${activeDownloads.length} active`}
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="text-2xl font-black tracking-tight text-white">
                    {gameInfo?.gameName || 'Your session hub is ready'}
                  </div>
                  <p className="text-sm text-zinc-400">
                    {gameInfo
                      ? 'Control the current session, monitor installs, and keep system actions one keypress away.'
                      : 'Use the overlay to launch installed titles, track active installs, and manage session tools without leaving the game.'}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {gameInfo ? (
                    <>
                      <button
                        onClick={closePanelAndHide}
                        className="flex items-center gap-3 rounded-full border border-white/[.07] bg-white px-4 py-3 text-left text-black transition hover:bg-zinc-200 active:scale-95"
                      >
                        <Play size={15} />
                        <div>
                          <div className="text-sm font-semibold">Resume game</div>
                          <div className="text-[11px] text-black/60">Return to the current session</div>
                        </div>
                      </button>
                      <button
                        onClick={quitGame}
                        className="flex items-center gap-3 rounded-full border border-red-500/20 bg-red-500/10 px-4 py-3 text-left text-red-200 transition hover:bg-red-500/15 active:scale-95"
                      >
                        <Square size={15} />
                        <div>
                          <div className="text-sm font-semibold">Quit game</div>
                          <div className="text-[11px] text-red-200/70">Stop the running executable</div>
                        </div>
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="rounded-full border border-white/[.07] bg-zinc-950/75 px-4 py-3">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Installed</div>
                        <div className="mt-1 text-lg font-semibold tracking-tight text-white">{installedGames.length}</div>
                      </div>
                      <div className="rounded-full border border-white/[.07] bg-zinc-950/75 px-4 py-3">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Notifications</div>
                        <div className="mt-1 text-lg font-semibold tracking-tight text-white">{unreadNotifications.length}</div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </section>

            <section className="grid grid-cols-2 gap-3">
              <button
                onClick={handleScreenshot}
                className="flex items-center gap-3 rounded-full border border-white/[.07] bg-zinc-900/75 px-4 py-3 text-left text-zinc-200 transition hover:bg-white/[.05] active:scale-95"
              >
                <div className={`flex h-9 w-9 items-center justify-center rounded-full ${screenshotTaken ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/[.05] text-zinc-300'}`}>
                  <Camera size={15} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white">Screenshot</div>
                  <div className="text-[11px] text-zinc-500">{screenshotTaken ? 'Saved to your captures folder' : 'Capture the current frame'}</div>
                </div>
              </button>

              <button
                onClick={() => setShowNotifications((current) => !current)}
                className="flex items-center gap-3 rounded-full border border-white/[.07] bg-zinc-900/75 px-4 py-3 text-left text-zinc-200 transition hover:bg-white/[.05] active:scale-95"
              >
                <div className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white/[.05] text-zinc-300">
                  <Bell size={15} />
                  {unreadNotifications.length > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[9px] font-bold text-black">
                      {unreadNotifications.length > 9 ? '9+' : unreadNotifications.length}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white">Notifications</div>
                  <div className="text-[11px] text-zinc-500">{showNotifications ? 'Hide inbox' : 'Review recent system events'}</div>
                </div>
              </button>

              <div className="col-span-2 rounded-[26px] border border-white/[.07] bg-zinc-900/75 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleMuteToggle}
                      className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[.07] bg-zinc-950/80 text-zinc-300 transition hover:bg-white/[.05] hover:text-white active:scale-95"
                      aria-label={isMuted ? 'Unmute' : 'Mute'}
                    >
                      {isMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                    </button>
                    <div>
                      <div className="text-sm font-semibold text-white">System volume</div>
                      <div className="text-[11px] text-zinc-500">{isMuted ? 'Muted' : `${volume}% output`}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowControllerFlyout((current) => !current)}
                    className="flex items-center gap-2 rounded-full border border-white/[.07] bg-zinc-950/80 px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/[.05] hover:text-white active:scale-95"
                  >
                    <Gamepad2 size={14} />
                    Controls
                  </button>
                </div>
                <div className="mt-4">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={isMuted ? 0 : volume}
                    onChange={(event) => handleVolumeChange(Number(event.target.value))}
                    className="h-1.5 w-full appearance-none rounded-full bg-transparent"
                    style={{
                      background: `linear-gradient(to right, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.95) ${isMuted ? 0 : volume}%, rgba(255,255,255,0.12) ${isMuted ? 0 : volume}%, rgba(255,255,255,0.12) 100%)`,
                    }}
                  />
                </div>
              </div>
            </section>

            {(showNotifications || unreadNotifications.length > 0) && (
              <section className="rounded-[28px] border border-white/[.07] bg-zinc-900/72 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Inbox</div>
                    <div className="text-lg font-semibold tracking-tight text-white">Recent notifications</div>
                  </div>
                  <div className="rounded-full border border-white/[.07] bg-zinc-950/80 px-3 py-1 text-xs text-zinc-400">
                    {notifications.length} total
                  </div>
                </div>

                {notifications.length === 0 ? (
                  <div className="rounded-[22px] border border-dashed border-white/[.07] bg-zinc-950/60 px-4 py-6 text-center text-sm text-zinc-500">
                    No notifications yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {notifications.slice(0, 6).map((notification) => (
                      <div
                        key={notification.id}
                        className={`rounded-[22px] border px-4 py-3 ${notification.read ? 'border-white/[.05] bg-zinc-950/60' : 'border-white/[.08] bg-white/[.03]'}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              {!notification.read && <span className="h-2 w-2 rounded-full bg-white" />}
                              <div className="truncate text-sm font-semibold text-white">{notification.title}</div>
                            </div>
                            <div className="mt-1 text-xs text-zinc-400">{notification.body}</div>
                          </div>
                          <span className="text-[11px] text-zinc-500">{formatNotificationTime(notification.timestamp)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            <section className="rounded-[28px] border border-white/[.07] bg-zinc-900/72 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Downloads</div>
                  <div className="text-lg font-semibold tracking-tight text-white">Activity queue</div>
                </div>
                <div className="rounded-full border border-white/[.07] bg-zinc-950/80 px-3 py-1 text-xs text-zinc-400">
                  {activeDownloads.length} active
                </div>
              </div>

              {activeDownloads.length === 0 ? (
                <div className="rounded-[22px] border border-dashed border-white/[.07] bg-zinc-950/60 px-4 py-6 text-center text-sm text-zinc-500">
                  No active downloads. Start a new install to monitor it here.
                </div>
              ) : (
                <div className="space-y-3">
                  {activeDownloads.slice(0, 5).map((download) => {
                    const progress = download.totalBytes > 0 ? Math.round((download.receivedBytes / download.totalBytes) * 100) : 0
                    const canPause = download.status === 'downloading'
                    const canResume = download.status === 'paused'
                    const isInstalling = download.status === 'extracting' || download.status === 'installing'
                    const speedLabel = isInstalling ? 'Disk write' : 'Download speed'

                    return (
                      <div key={download.id} className="rounded-[24px] border border-white/[.07] bg-zinc-950/70 p-4">
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-white">{download.gameName || download.appid}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${getDownloadBadge(download.status)}`}>
                                {getDownloadLabel(download.status)}
                              </span>
                              <span className="rounded-full border border-white/[.07] bg-zinc-900/80 px-2.5 py-1 font-mono text-[10px] text-zinc-400">
                                {progress}%
                              </span>
                            </div>
                          </div>

                          {(canPause || canResume) && (
                            <button
                              onClick={() => {
                                if (canPause) window.ucOverlay?.pauseDownload(download.id)
                                if (canResume) window.ucOverlay?.resumeDownload(download.id)
                              }}
                              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[.07] bg-zinc-900/80 text-zinc-300 transition hover:bg-white/[.05] hover:text-white active:scale-95"
                              aria-label={canPause ? 'Pause download' : 'Resume download'}
                            >
                              {canPause ? <Pause size={14} /> : <Play size={14} />}
                            </button>
                          )}
                        </div>

                        <div className="mb-3 h-2 overflow-hidden rounded-full bg-white/[.06]">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${progress}%`, background: getDownloadProgress(download.status), transition: 'width 300ms ease' }}
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-[20px] border border-white/[.07] bg-zinc-900/75 px-3 py-2.5">
                            <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{speedLabel}</div>
                            <div className="mt-1 text-sm font-semibold text-white">{formatSpeed(download.speedBps)}</div>
                          </div>
                          <div className="rounded-[20px] border border-white/[.07] bg-zinc-900/75 px-3 py-2.5">
                            <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">ETA</div>
                            <div className="mt-1 text-sm font-semibold text-white">{formatEta(download.etaSeconds)}</div>
                          </div>
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-zinc-400">
                          <span>{formatBytes(download.receivedBytes)} / {formatBytes(download.totalBytes)}</span>
                          <span className="inline-flex items-center gap-1.5">
                            {(download.status === 'extracting' || download.status === 'installing' || download.status === 'verifying') && (
                              <Loader2 size={12} className="animate-spin text-zinc-500" />
                            )}
                            {download.status === 'retrying' ? 'Recovery in progress' : isInstalling ? 'Writing extracted data to disk' : 'Tracking live transfer speed'}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            {!gameInfo && installedGames.length > 0 && (
              <section className="rounded-[28px] border border-white/[.07] bg-zinc-900/72 p-4">
                <div className="mb-3">
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Library</div>
                  <div className="text-lg font-semibold tracking-tight text-white">Recently installed</div>
                </div>
                <div className="space-y-2">
                  {installedGames.map((game) => (
                    <button
                      key={game.appid}
                      onClick={() => quickLaunchGame(game)}
                      className="flex w-full items-center gap-3 rounded-full border border-white/[.07] bg-zinc-950/70 px-4 py-3 text-left transition hover:bg-white/[.05] active:scale-95"
                    >
                      <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl bg-white/[.05] text-zinc-400">
                        {game.metadata?.image ? (
                          <img src={game.metadata.image} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <Gamepad2 size={16} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-white">{game.metadata?.name || game.name || game.appid}</div>
                        <div className="text-[11px] text-zinc-500">Launch from the overlay</div>
                      </div>
                      <Play size={14} className="text-zinc-500" />
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>

          <div className="border-t border-white/[.07] px-5 py-4">
            <div className="flex items-center justify-between gap-3 rounded-full border border-white/[.07] bg-zinc-900/70 px-4 py-3 text-xs text-zinc-400">
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-white/[.07] bg-zinc-950/80 px-2.5 py-1 font-mono text-[10px] text-zinc-400">Esc</span>
                Close overlay
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-white/[.07] bg-zinc-950/80 px-2.5 py-1 font-mono text-[10px] text-zinc-400">{hotkey}</span>
                Toggle overlay
              </div>
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
