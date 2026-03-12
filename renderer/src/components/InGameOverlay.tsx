import { useState, useEffect, useCallback, useRef } from 'react'
import { Hammer, X, Clock, Download, Square, Play, Gamepad2, Loader2, Pause, Volume2, VolumeX, Bell, Camera, Minus, Plus } from 'lucide-react'
import { ControllerOverlayFlyout } from './ControllerOverlayFlyout'

declare global {
  interface Window {
    ucOverlay?: {
      show: (appid?: string) => Promise<{ ok: boolean; error?: string }>
      hide: () => Promise<{ ok: boolean; error?: string }>
      toggle: (appid?: string) => Promise<{ ok: boolean; visible?: boolean; error?: string }>
      getStatus: () => Promise<{
        ok: boolean
        enabled: boolean
        visible: boolean
        hotkey: string
        autoShow: boolean
        position: string
        currentAppid: string | null
      }>
      getSettings: () => Promise<{
        ok: boolean
        enabled: boolean
        hotkey: string
        autoShow: boolean
        position: string
      }>
      setSettings: (settings: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>
      onShow: (callback: (data: { appid: string | null }) => void) => () => void
      onHide: (callback: () => void) => () => void
      onStateChanged: (callback: (data: { visible: boolean; appid: string | null }) => void) => () => void
      onToast: (callback: (data: { appid: string | null }) => void) => () => void
      getGameInfo: (appid?: string) => Promise<{ ok: boolean; appid?: string | null; gameName?: string; startedAt?: number; pid?: number; image?: string | null }>
      getRunningGames: () => Promise<{ ok: boolean; games: { appid: string; gameName: string; startedAt: number; pid: number }[] }>
      getDownloads: () => Promise<{ ok: boolean; downloads: OverlayDownloadItem[] }>
      onDownloadUpdate: (callback: (data: unknown) => void) => () => void
      pauseDownload: (downloadId: string) => Promise<{ ok: boolean }>
      resumeDownload: (downloadId: string) => Promise<{ ok: boolean }>
      onPositionChanged: (callback: (data: { position: string }) => void) => () => void
    }
  }
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
  // New state for additional features
  const [currentTime, setCurrentTime] = useState(new Date())
  const [volume, setVolume] = useState(50)
  const [isMuted, setIsMuted] = useState(false)
  const [notifications, setNotifications] = useState<SystemNotification[]>([])
  const [showNotifications, setShowNotifications] = useState(false)
  const [screenshotTaken, setScreenshotTaken] = useState(false)
  // Controller flyout state
  const [showControllerFlyout, setShowControllerFlyout] = useState(false)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toastProgressRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const playtimeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clockIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const modeRef = useRef<OverlayMode>(mode)
  modeRef.current = mode

  // Force overlay window to be fully transparent (overrides globals.css bg-background)
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

  // Clock ticker - always running when overlay is visible
  useEffect(() => {
    if (mode !== 'hidden') {
      setCurrentTime(new Date())
      clockIntervalRef.current = setInterval(() => setCurrentTime(new Date()), 1000)
    }
    return () => {
      if (clockIntervalRef.current) { clearInterval(clockIntervalRef.current); clockIntervalRef.current = null }
    }
  }, [mode])

  // Refresh volume and notifications when panel opens
  useEffect(() => {
    if (mode === 'panel') {
      // Refresh volume
      if (window.ucSystem?.getVolume) {
        window.ucSystem.getVolume().then(r => { if (r.ok) setVolume(r.volume ?? 50) }).catch(() => {})
        window.ucSystem.getMuted().then(r => { if (r.ok) setIsMuted(r.muted ?? false) }).catch(() => {})
      }
      // Refresh notifications
      if (window.ucSystem?.getNotifications) {
        window.ucSystem.getNotifications().then(r => { if (r.ok) setNotifications(r.notifications || []) }).catch(() => {})
      }
    }
  }, [mode])

  const formatBytes = useCallback((bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }, [])

  const formatSpeed = useCallback((bps: number) => {
    if (bps <= 0) return '-'
    return formatBytes(bps) + '/s'
  }, [formatBytes])

  const formatTime = useCallback((date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }, [])

  const formatNotificationTime = useCallback((timestamp: number) => {
    const now = Date.now()
    const diff = now - timestamp
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    if (minutes < 1) return 'now'
    if (minutes < 60) return `${minutes}m`
    if (hours < 24) return `${hours}h`
    return `${days}d`
  }, [])

  const handleVolumeChange = useCallback(async (newVolume: number) => {
    setVolume(newVolume)
    if (window.ucSystem?.setVolume) {
      try { await window.ucSystem.setVolume(newVolume) } catch { /* ignore */ }
    }
  }, [])

  const handleMuteToggle = useCallback(async () => {
    const newMuted = !isMuted
    setIsMuted(newMuted)
    if (window.ucSystem?.setMuted) {
      try { await window.ucSystem.setMuted(newMuted) } catch { /* ignore */ }
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
      } catch { /* ignore */ }
    }
    setTimeout(() => setScreenshotTaken(false), 1500)
  }, [])

  const updatePlaytime = useCallback((startedAt: number) => {
    const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
    const h = Math.floor(elapsed / 3600)
    const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0')
    const s = String(elapsed % 60).padStart(2, '0')
    setPlaytime(h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`)
  }, [])

  const refreshGameInfo = useCallback(async (appid?: string | null) => {
    if (!window.ucOverlay?.getGameInfo) return
    const result = await window.ucOverlay.getGameInfo(appid || undefined)
    if (result.ok && result.appid) {
      setGameInfo({
        appid: result.appid,
        gameName: result.gameName || result.appid,
        startedAt: result.startedAt || Date.now(),
        image: result.image || null
      })
    } else {
      setGameInfo(null)
    }
  }, [])

  const refreshDownloads = useCallback(async () => {
    if (!window.ucOverlay?.getDownloads) return
    const result = await window.ucOverlay.getDownloads()
    if (result.ok) setDownloads(result.downloads || [])
  }, [])

  const loadInstalledGames = useCallback(async () => {
    try {
      const uc = (window as unknown as { ucDownloads?: { listInstalledGlobal: () => Promise<InstalledGame[]> } }).ucDownloads
      if (!uc?.listInstalledGlobal) return
      const list = await uc.listInstalledGlobal()
      const sorted = (list || [])
        .filter(g => g && g.appid)
        .sort((a, b) => (b.installedAt || 0) - (a.installedAt || 0))
        .slice(0, 6)
      setInstalledGames(sorted)
    } catch { /* ignore */ }
  }, [])

  const clearToastTimers = useCallback(() => {
    if (toastTimerRef.current) { clearTimeout(toastTimerRef.current); toastTimerRef.current = null }
    if (toastProgressRef.current) { clearInterval(toastProgressRef.current); toastProgressRef.current = null }
    if (hideTimeoutRef.current) { clearTimeout(hideTimeoutRef.current); hideTimeoutRef.current = null }
  }, [])

  const enterMode = useCallback((newMode: OverlayMode, appid?: string | null) => {
    clearToastTimers()
    if (newMode === 'hidden') {
      setAnimated(false)
      hideTimeoutRef.current = setTimeout(() => setMode('hidden'), 200)
      return
    }
    setMode(newMode)
    if (appid !== undefined) setCurrentAppid(appid)
    requestAnimationFrame(() => requestAnimationFrame(() => setAnimated(true)))
    if (newMode === 'toast') {
      setToastProgress(100)
      const start = Date.now()
      const duration = 5000
      toastProgressRef.current = setInterval(() => {
        const pct = Math.max(0, 100 - ((Date.now() - start) / duration) * 100)
        setToastProgress(pct)
        if (pct <= 0) clearInterval(toastProgressRef.current!)
      }, 50)
      toastTimerRef.current = setTimeout(() => {
        setAnimated(false)
        hideTimeoutRef.current = setTimeout(() => setMode('hidden'), 200)
      }, 5200)
    }
    if (newMode === 'panel') { refreshDownloads(); loadInstalledGames() }
  }, [clearToastTimers, refreshDownloads, loadInstalledGames])

  // IPC event listeners
  useEffect(() => {
    if (!window.ucOverlay) return

    const unsubShow = window.ucOverlay.onShow((data) => {
      setCurrentAppid(data.appid)
      refreshGameInfo(data.appid)
      enterMode('panel', data.appid)
    })

    const unsubHide = window.ucOverlay.onHide(() => {
      setGameInfo(null)
      enterMode('hidden')
    })

    const unsubStateChanged = window.ucOverlay.onStateChanged((data) => {
      if (!data.visible) { setGameInfo(null); enterMode('hidden') }
    })

    const unsubToast = window.ucOverlay.onToast?.((data) => {
      setCurrentAppid(data.appid)
      refreshGameInfo(data.appid)
      enterMode('toast', data.appid)
    })

    window.ucOverlay.getSettings().then(s => {
      if (s.ok) setHotkey(s.hotkey || 'Ctrl+Shift+Tab')
    }).catch(() => {})

    const unsubDownloads = window.ucOverlay.onDownloadUpdate?.((data: unknown) => {
      const item = data as { downloadId?: string; appid?: string; gameName?: string; status?: string; receivedBytes?: number; totalBytes?: number; speedBps?: number; etaSeconds?: number | null }
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
      setDownloads(prev => {
        if (['completed', 'failed', 'cancelled'].includes(entry.status)) {
          return prev.filter(d => d.id !== entry.id)
        }
        const idx = prev.findIndex(d => d.id === entry.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = entry
          return next
        }
        return [...prev, entry]
      })
    })

    return () => {
      unsubShow()
      unsubHide()
      unsubStateChanged()
      unsubToast?.()
      unsubDownloads?.()
    }
  }, [refreshGameInfo, enterMode, refreshDownloads])

  // Playtime ticker (panel only)
  useEffect(() => {
    if (mode === 'panel' && gameInfo?.startedAt) {
      updatePlaytime(gameInfo.startedAt)
      playtimeIntervalRef.current = setInterval(() => updatePlaytime(gameInfo.startedAt), 1000)
    }
    return () => {
      if (playtimeIntervalRef.current) { clearInterval(playtimeIntervalRef.current); playtimeIntervalRef.current = null }
    }
  }, [mode, gameInfo?.startedAt, updatePlaytime])

  // ESC closes panel
  useEffect(() => {
    if (mode !== 'panel') return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { enterMode('hidden'); window.ucOverlay?.hide() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mode, enterMode])

  const closePanelAndHide = useCallback(() => {
    enterMode('hidden')
    setTimeout(() => window.ucOverlay?.hide(), 220)
  }, [enterMode])

  const quitGame = useCallback(() => {
    if (currentAppid && (window as unknown as Record<string, unknown>).ucDownloads) {
      (window as unknown as { ucDownloads: { quitGameExecutable: (id: string) => void } }).ucDownloads.quitGameExecutable(currentAppid)
    }
    closePanelAndHide()
  }, [currentAppid, closePanelAndHide])

  const quickLaunchGame = useCallback(async (game: InstalledGame) => {
    const uc = (window as unknown as { ucDownloads?: { listGameExecutables: (appid: string) => Promise<{ ok: boolean; exes?: { path: string }[] }>; launchGameExecutable: (appid: string, exePath: string, name: string, show: boolean) => Promise<{ ok: boolean }> }; ucSettings?: { get: (key: string) => Promise<string | null> } })
    const downloads = uc.ucDownloads
    if (!downloads?.launchGameExecutable || !downloads?.listGameExecutables) return
    const gameName = game.metadata?.name || game.name || game.appid
    enterMode('hidden') // immediately start closing panel
    try {
      const settings = (window as unknown as { ucSettings?: { get: (key: string) => Promise<string | null> } }).ucSettings
      const savedExe = await settings?.get?.(`gameExe:${game.appid}`)
      if (savedExe) {
        const res = await downloads.launchGameExecutable(game.appid, savedExe, gameName, false)
        if (res?.ok) {
          setGameInfo({ appid: game.appid, gameName, startedAt: Date.now(), image: game.metadata?.image || null })
          enterMode('toast', game.appid)
        }
        return
      }
      const result = await downloads.listGameExecutables(game.appid)
      if (result?.ok && result.exes?.[0]?.path) {
        const res = await downloads.launchGameExecutable(game.appid, result.exes[0].path, gameName, false)
        if (res?.ok) {
          setGameInfo({ appid: game.appid, gameName, startedAt: Date.now(), image: game.metadata?.image || null })
          enterMode('toast', game.appid)
        }
      }
    } catch { /* ignore */ }
  }, [enterMode])

  const activeDownloads = downloads.filter(d => ['downloading', 'extracting', 'installing', 'queued', 'paused', 'verifying', 'retrying'].includes(d.status))
  const unreadNotifications = notifications.filter(n => !n.read)

  if (mode === 'hidden') return null

  // ─── TOAST ───
  if (mode === 'toast') {
    return (
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          left: 24,
          width: 272,
          pointerEvents: 'none',
          zIndex: 9999,
          opacity: animated ? 1 : 0,
          transform: animated ? 'translateY(0)' : 'translateY(12px)',
          transition: 'opacity 0.18s ease, transform 0.18s ease',
        }}
      >
        <div style={{
          background: '#0d0d15',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 12,
          padding: '12px 14px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 7, flexShrink: 0,
              background: gameInfo?.image ? 'transparent' : 'linear-gradient(135deg,#7c3aed,#3b82f6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden',
            }}>
              {gameInfo?.image ? (
                <img src={gameInfo.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <Hammer size={14} color="white" />
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.9)', lineHeight: 1.1 }}>Now Playing</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'white', lineHeight: 1.2, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {gameInfo?.gameName || currentAppid || 'Game'}
              </div>
            </div>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
          </div>
          <div style={{ height: 2, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginBottom: 6 }}>
            <div style={{
              height: '100%', borderRadius: 2,
              background: 'linear-gradient(90deg,#7c3aed,#3b82f6)',
              width: `${toastProgress}%`,
              transition: 'width 0.05s linear',
            }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Press to open overlay</span>
            <kbd style={{
              fontSize: 9, fontFamily: 'monospace', color: 'rgba(255,255,255,0.4)',
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 4, padding: '1px 5px',
            }}>{hotkey}</kbd>
          </div>
        </div>
      </div>
    )
  }

  // ─── PANEL ───
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'transparent' }}
      onClick={closePanelAndHide}
    >

      {/* Clock - Top Middle */}
      <div
        style={{
          position: 'absolute',
          top: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9999,
          opacity: animated ? 1 : 0,
          transition: 'opacity 0.18s ease',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{
          background: 'rgba(13, 13, 21, 0.85)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 12,
          padding: '8px 16px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <Clock size={14} color="rgba(255,255,255,0.6)" />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'white', fontFamily: 'monospace' }}>
            {formatTime(currentTime)}
          </span>
        </div>
      </div>

      {/* Quick Actions Bar - Top Right */}
      <div
        style={{
          position: 'absolute',
          top: 20,
          right: 20,
          zIndex: 9999,
          display: 'flex',
          gap: 8,
          opacity: animated ? 1 : 0,
          transition: 'opacity 0.18s ease',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Screenshot Button */}
        <button
          onClick={handleScreenshot}
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: screenshotTaken ? 'rgba(34, 197, 94, 0.2)' : 'rgba(13, 13, 21, 0.85)',
            border: '1px solid rgba(255,255,255,0.12)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            transition: 'all 0.15s ease',
          }}
          title="Take Screenshot"
        >
          <Camera size={16} color={screenshotTaken ? '#22c55e' : 'rgba(255,255,255,0.7)'} />
        </button>

        {/* Notifications Button */}
        <button
          onClick={() => setShowNotifications(!showNotifications)}
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: showNotifications ? 'rgba(59, 130, 246, 0.2)' : 'rgba(13, 13, 21, 0.85)',
            border: '1px solid rgba(255,255,255,0.12)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            position: 'relative',
            transition: 'all 0.15s ease',
          }}
          title="Notifications"
        >
          <Bell size={16} color={showNotifications ? '#60a5fa' : 'rgba(255,255,255,0.7)'} />
          {unreadNotifications.length > 0 && (
            <div style={{
              position: 'absolute',
              top: -4,
              right: -4,
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: '#ef4444',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              fontWeight: 700,
              color: 'white',
            }}>
              {unreadNotifications.length > 9 ? '9+' : unreadNotifications.length}
            </div>
          )}
        </button>

        {/* Volume Control */}
        <div style={{
          height: 40,
          borderRadius: 10,
          background: 'rgba(13, 13, 21, 0.85)',
          border: '1px solid rgba(255,255,255,0.12)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px',
          gap: 6,
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        }}>
          <button
            onClick={handleMuteToggle}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 4,
            }}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <VolumeX size={16} color="rgba(255,255,255,0.5)" /> : <Volume2 size={16} color="rgba(255,255,255,0.7)" />}
          </button>
          <div style={{ width: 60, position: 'relative' }}>
            <input
              type="range"
              min="0"
              max="100"
              value={isMuted ? 0 : volume}
              onChange={(e) => handleVolumeChange(Number(e.target.value))}
              style={{
                width: '100%',
                height: 4,
                appearance: 'none',
                background: `linear-gradient(to right, #7c3aed 0%, #7c3aed ${isMuted ? 0 : volume}%, rgba(255,255,255,0.15) ${isMuted ? 0 : volume}%, rgba(255,255,255,0.15) 100%)`,
                borderRadius: 2,
                cursor: 'pointer',
              }}
            />
          </div>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', minWidth: 24, textAlign: 'right', fontFamily: 'monospace' }}>
            {isMuted ? 0 : volume}%
          </span>
        </div>

        {/* Controller Button */}
        <button
          onClick={() => setShowControllerFlyout(!showControllerFlyout)}
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: showControllerFlyout ? 'rgba(139, 92, 246, 0.2)' : 'rgba(13, 13, 21, 0.85)',
            border: '1px solid rgba(255,255,255,0.12)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            position: 'relative',
            transition: 'all 0.15s ease',
          }}
          title="Controller Settings"
        >
          <Gamepad2 size={16} color={showControllerFlyout ? '#a78bfa' : 'rgba(255,255,255,0.7)'} />
        </button>
      </div>

      {/* Notifications Panel */}
      {showNotifications && (
        <div
          style={{
            position: 'absolute',
            top: 70,
            right: 20,
            width: 280,
            maxHeight: 300,
            background: 'rgba(13, 13, 21, 0.95)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 12,
            boxShadow: '0 16px 48px rgba(0,0,0,0.8)',
            overflow: 'hidden',
            zIndex: 9999,
            opacity: animated ? 1 : 0,
            transform: animated ? 'translateY(0)' : 'translateY(-8px)',
            transition: 'opacity 0.18s ease, transform 0.18s ease',
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'white' }}>Notifications</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{notifications.length} total</span>
          </div>
          <div style={{ maxHeight: 230, overflowY: 'auto' }}>
            {notifications.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center' }}>
                <Bell size={24} color="rgba(255,255,255,0.2)" style={{ marginBottom: 8 }} />
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>No notifications</div>
              </div>
            ) : (
              notifications.slice(0, 10).map(n => (
                <div
                  key={n.id}
                  style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    cursor: 'pointer',
                    background: n.read ? 'transparent' : 'rgba(59, 130, 246, 0.05)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    {!n.read && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6', marginTop: 5, flexShrink: 0 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'white', marginBottom: 2 }}>{n.title}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.body}</div>
                    </div>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>{formatNotificationTime(n.timestamp)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Floating card */}
      <div
        style={{
          position: 'absolute',
          top: 20,
          left: 20,
          width: 310,
          maxHeight: 'calc(100vh - 40px)',
          borderRadius: 16,
          background: '#0d0d15',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.9)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          opacity: animated ? 1 : 0,
          transform: animated ? 'scale(1) translateY(0)' : 'scale(0.96) translateY(-8px)',
          transition: 'opacity 0.18s ease, transform 0.18s ease',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg,#7c3aed,#3b82f6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Hammer size={16} color="white" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'white', lineHeight: 1 }}>UC.Direct</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 2, lineHeight: 1 }}>In-Game Overlay</div>
          </div>
          <button onClick={closePanelAndHide} style={{ padding: 4, borderRadius: 6, background: 'transparent', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.35)', display: 'flex' }}>
            <X size={14} />
          </button>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {/* Now Playing */}
          {gameInfo && (
            <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Now Playing</span>
              </div>
              <div style={{ borderRadius: 10, overflow: 'hidden', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                {gameInfo.image && (
                  <div style={{ width: '100%', height: 80, overflow: 'hidden' }}>
                    <img src={gameInfo.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                )}
                <div style={{ padding: '10px 12px' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{gameInfo.gameName}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                    <Clock size={12} color="rgba(255,255,255,0.3)" />
                    <span style={{ fontSize: 13, fontFamily: 'monospace', color: 'rgba(255,255,255,0.7)' }}>{playtime}</span>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginLeft: 2 }}>session</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Active Downloads */}
          {activeDownloads.length > 0 && (
            <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Download size={12} color="#60a5fa" />
                <span style={{ fontSize: 10, fontWeight: 700, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Downloads</span>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginLeft: 'auto' }}>{activeDownloads.length} active</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {activeDownloads.slice(0, 5).map(dl => {
                  const pct = dl.totalBytes > 0 ? Math.round((dl.receivedBytes / dl.totalBytes) * 100) : 0
                  const canPause = dl.status === 'downloading'
                  const canResume = dl.status === 'paused'
                  return (
                    <div key={dl.id} style={{ borderRadius: 8, padding: '8px 10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>{dl.gameName || dl.appid}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', fontFamily: 'monospace' }}>{pct}%</span>
                          {(canPause || canResume) && (
                            <button
                              onClick={() => {
                                if (canPause) window.ucOverlay?.pauseDownload(dl.id)
                                else if (canResume) window.ucOverlay?.resumeDownload(dl.id)
                              }}
                              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: '2px 4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 0 }}
                              title={canPause ? 'Pause' : 'Resume'}
                            >
                              {canPause ? <Pause size={10} color="#9ca3af" /> : <Play size={10} color="#60a5fa" />}
                            </button>
                          )}
                        </div>
                      </div>
                      <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginBottom: 4 }}>
                        <div style={{ height: '100%', borderRadius: 2, background: dl.status === 'extracting' ? 'linear-gradient(90deg,#f59e0b,#d97706)' : dl.status === 'verifying' ? 'linear-gradient(90deg,#06b6d4,#0891b2)' : dl.status === 'retrying' ? 'linear-gradient(90deg,#ef4444,#dc2626)' : dl.status === 'paused' ? '#6b7280' : dl.status === 'queued' ? '#4b5563' : 'linear-gradient(90deg,#3b82f6,#7c3aed)', width: `${pct}%`, transition: 'width 0.3s' }} />
                      </div>
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>
                        {dl.status === 'extracting' ? 'Extracting...' : dl.status === 'verifying' ? 'Verifying integrity...' : dl.status === 'retrying' ? 'Corrupt - retrying...' : dl.status === 'queued' ? 'Queued' : dl.status === 'paused' ? 'Paused' : `${formatSpeed(dl.speedBps)} · ${formatBytes(dl.receivedBytes)} / ${formatBytes(dl.totalBytes)}`}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Quick Actions (only when in-game) */}
          {gameInfo && (
            <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <button onClick={closePanelAndHide} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.15)', cursor: 'pointer', textAlign: 'left' }}>
                  <Play size={14} color="#60a5fa" />
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>Resume</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Back to game</div>
                  </div>
                </button>
                <button onClick={quitGame} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)', cursor: 'pointer', textAlign: 'left' }}>
                  <Square size={14} color="#f87171" />
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#f87171' }}>Quit Game</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Stop process</div>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Recently Installed (when not in-game) */}
          {!gameInfo && installedGames.length > 0 && (
            <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Gamepad2 size={12} color="#a78bfa" />
                <span style={{ fontSize: 10, fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Recently Installed</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {installedGames.map(game => (
                  <button
                    key={game.appid}
                    onClick={() => quickLaunchGame(game)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                      borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)',
                      cursor: 'pointer', textAlign: 'left', width: '100%',
                    }}
                  >
                    <div style={{
                      width: 28, height: 28, borderRadius: 6, flexShrink: 0, overflow: 'hidden',
                      background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {game.metadata?.image ? (
                        <img src={game.metadata.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <Gamepad2 size={14} color="rgba(255,255,255,0.3)" />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {game.metadata?.name || game.name || game.appid}
                      </div>
                    </div>
                    <Play size={12} color="rgba(255,255,255,0.25)" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div style={{ padding: '12px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 4, borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>Close</span>
              <kbd style={{ fontSize: 9, fontFamily: 'monospace', color: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: '1px 5px' }}>Esc</kbd>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.1)' }}>·</span>
              <kbd style={{ fontSize: 9, fontFamily: 'monospace', color: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: '1px 5px' }}>{hotkey}</kbd>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>Toggle</span>
            </div>
          </div>
        </div>
      </div>

      {/* Controller Overlay Flyout */}
      <ControllerOverlayFlyout 
        visible={showControllerFlyout} 
        onClose={() => setShowControllerFlyout(false)}
        position="right"
      />
    </div>
  )
}

export default InGameOverlay
