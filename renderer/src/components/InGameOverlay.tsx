import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Bell, Camera, Clock, Download, Gamepad2,
  Pause, Play, Square, Volume2, VolumeX, X, Zap,
} from 'lucide-react'
import { ControllerOverlayFlyout } from './ControllerOverlayFlyout'
import { LogoStaticDark } from './brand/brand-assets'
import { proxyImageUrl } from '@/lib/utils'

type OverlayApi = NonNullable<Window['ucOverlay']> & {
  onToast?: (callback: (data: {
    appid: string | null
    durationMs?: number
    vertical?: 'top' | 'bottom'
  }) => void) => () => void
  getGameInfo?: (appid?: string) => Promise<{
    ok: boolean; appid?: string | null; gameName?: string
    startedAt?: number; pid?: number; image?: string | null
  }>
  onPositionChanged?: (callback: (data: {
    position: string
    toastDurationMs?: number
    toastVertical?: 'top' | 'bottom'
  }) => void) => () => void
}

interface OverlayDownloadItem {
  id: string; appid: string; gameName: string; status: string
  receivedBytes: number; totalBytes: number; speedBps: number
  etaSeconds: number | null
}

interface SystemNotification {
  id: string; title: string; body: string
  appId?: string; icon?: string; timestamp: number; read: boolean
}

interface GameInfo {
  appid: string | null; gameName: string
  startedAt: number; image?: string | null
}

interface InstalledGame {
  appid: string; name?: string
  metadata?: { name?: string; image?: string }
  installedAt?: number
}

type OverlayMode  = 'hidden' | 'toast' | 'panel'
type OverlayDock  = 'left' | 'right'
type OverlayVert  = 'top' | 'bottom'

const ACTIVE_DL_STATUSES = ['downloading', 'extracting', 'installing', 'queued', 'paused', 'verifying', 'retrying']

function getDock(pos?: string | null): OverlayDock {
  return pos?.toLowerCase().includes('right') ? 'right' : 'left'
}

function dlStatusColor(s: string) {
  if (s === 'extracting' || s === 'installing') return 'text-amber-300'
  if (s === 'verifying')  return 'text-cyan-300'
  if (s === 'retrying')   return 'text-red-400'
  if (s === 'paused')     return 'text-zinc-400'
  if (s === 'queued')     return 'text-zinc-500'
  return 'text-white'
}

function dlBarGradient(s: string) {
  if (s === 'extracting' || s === 'installing') return 'linear-gradient(90deg,#f59e0b,#fbbf24)'
  if (s === 'verifying')  return 'linear-gradient(90deg,#06b6d4,#22d3ee)'
  if (s === 'retrying')   return 'linear-gradient(90deg,#ef4444,#f87171)'
  if (s === 'paused')     return 'rgba(113,113,122,0.8)'
  if (s === 'queued')     return 'rgba(82,82,91,0.8)'
  return 'linear-gradient(90deg,#fff,#d4d4d8)'
}

function dlLabel(s: string) {
  const map: Record<string, string> = {
    extracting: 'Extracting', installing: 'Installing',
    verifying: 'Verifying', retrying: 'Retrying',
    paused: 'Paused', queued: 'Queued',
  }
  return map[s] ?? 'Downloading'
}

function getOverlayApi() { return window.ucOverlay as OverlayApi | undefined }

export function InGameOverlay() {
  const [mode,              setMode]              = useState<OverlayMode>('hidden')
  const [animated,          setAnimated]          = useState(false)
  const [currentAppid,      setCurrentAppid]      = useState<string | null>(null)
  const [hotkey,            setHotkey]            = useState('Ctrl+Shift+Tab')
  const [gameInfo,          setGameInfo]          = useState<GameInfo | null>(null)
  const [playtime,          setPlaytime]          = useState('0:00')
  const [downloads,         setDownloads]         = useState<OverlayDownloadItem[]>([])
  const [installedGames,    setInstalledGames]    = useState<InstalledGame[]>([])
  const [toastProgress,     setToastProgress]     = useState(100)
  const [currentTime,       setCurrentTime]       = useState(new Date())
  const [volume,            setVolume]            = useState(50)
  const [isMuted,           setIsMuted]           = useState(false)
  const [notifications,     setNotifications]     = useState<SystemNotification[]>([])
  const [showNotifications, setShowNotifications] = useState(false)
  const [screenshotFlash,   setScreenshotFlash]   = useState(false)
  const [showController,    setShowController]    = useState(false)
  const [dock,              setDock]              = useState<OverlayDock>('left')
  const [toastDurationMs,   setToastDurationMs]   = useState(5000)
  const [toastVertical,     setToastVertical]     = useState<OverlayVert>('bottom')

  const currentAppidRef   = useRef<string | null>(null)
  const modeRef           = useRef<OverlayMode>(mode)
  const toastTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toastProgressRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const playtimeRef       = useRef<ReturnType<typeof setInterval> | null>(null)
  const hideTimeoutRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clockRef          = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => { currentAppidRef.current = currentAppid }, [currentAppid])
  useEffect(() => { modeRef.current = mode }, [mode])

  // Transparent root
  useEffect(() => {
    for (const el of [document.documentElement, document.body, document.getElementById('root')]) {
      if (!el) continue
      el.style.setProperty('background', 'transparent', 'important')
      el.style.setProperty('background-color', 'transparent', 'important')
    }
  }, [])

  // Clock
  useEffect(() => {
    if (mode === 'hidden') return
    setCurrentTime(new Date())
    clockRef.current = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => { if (clockRef.current) clearInterval(clockRef.current) }
  }, [mode])

  // Volume / notifications when panel opens
  useEffect(() => {
    if (mode !== 'panel') return
    window.ucSystem?.getVolume?.().then(r => { if (r.ok) setVolume(r.volume ?? 50) }).catch(() => {})
    window.ucSystem?.getMuted?.().then(r => { if (r.ok) setIsMuted(r.muted ?? false) }).catch(() => {})
    window.ucSystem?.getNotifications?.().then(r => { if (r.ok) setNotifications(r.notifications || []) }).catch(() => {})
  }, [mode])

  const formatBytes = useCallback((n: number) => {
    if (n === 0) return '0 B'
    const s = ['B','KB','MB','GB','TB']
    const u = Math.min(Math.floor(Math.log(n) / Math.log(1024)), s.length - 1)
    const v = n / Math.pow(1024, u)
    return `${parseFloat(v.toFixed(v >= 10 || u === 0 ? 0 : 1))} ${s[u]}`
  }, [])

  const formatSpeed = useCallback((bps: number) =>
    bps <= 0 ? '0 B/s' : `${formatBytes(bps)}/s`, [formatBytes])

  const formatTime = useCallback((d: Date) =>
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), [])

  const formatNotifTime = useCallback((ts: number) => {
    const diff = Date.now() - ts
    const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000)
    return m < 1 ? 'now' : m < 60 ? `${m}m` : h < 24 ? `${h}h` : `${d}d`
  }, [])

  const handleVolume = useCallback(async (v: number) => {
    const c = Math.max(0, Math.min(100, v))
    const mute = c === 0
    setVolume(c)
    if (isMuted !== mute) setIsMuted(mute)
    try { await window.ucSystem?.setVolume?.(c) } catch {}
    if (isMuted !== mute) { try { await window.ucSystem?.setMuted?.(mute) } catch {} }
  }, [isMuted])

  const handleMuteToggle = useCallback(async () => {
    const next = !isMuted
    setIsMuted(next)
    try { await window.ucSystem?.setMuted?.(next) } catch {}
  }, [isMuted])

  const handleScreenshot = useCallback(async () => {
    setScreenshotFlash(true)
    try { await window.ucSystem?.takeScreenshot?.() } catch {}
    setTimeout(() => setScreenshotFlash(false), 1200)
  }, [])

  const updatePlaytime = useCallback((startedAt: number) => {
    const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
    const h = Math.floor(s / 3600)
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
    const ss = String(s % 60).padStart(2, '0')
    setPlaytime(h > 0 ? `${h}:${m}:${ss}` : `${m}:${ss}`)
  }, [])

  const refreshGameInfo = useCallback(async (appid?: string | null) => {
    const api = getOverlayApi()
    if (!api?.getGameInfo) return
    const id = appid ?? currentAppidRef.current ?? undefined
    const r = await api.getGameInfo(id)
    if (r.ok && r.appid) {
      setGameInfo({ appid: r.appid, gameName: r.gameName || r.appid, startedAt: r.startedAt || Date.now(), image: r.image || null })
      return
    }
    if (id) {
      try {
        const fb = await api.getGameInfo()
        if (fb.ok && fb.appid) {
          setGameInfo({ appid: fb.appid, gameName: fb.gameName || fb.appid, startedAt: fb.startedAt || Date.now(), image: fb.image || null })
          return
        }
      } catch {}
    }
    setGameInfo(prev => (prev && id && prev.appid === id) ? prev : null)
  }, [])

  const refreshDownloads = useCallback(async () => {
    const api = getOverlayApi()
    if (!api?.getDownloads) return
    const r = await api.getDownloads()
    if (r.ok) {
      setDownloads((r.downloads || []).map((d: any) => ({
        id: d.id ?? d.downloadId ?? d.appid ?? '',
        appid: d.appid ?? '', gameName: d.gameName ?? d.filename ?? '',
        status: d.status ?? 'queued', receivedBytes: d.receivedBytes ?? 0,
        totalBytes: d.totalBytes ?? 0, speedBps: d.speedBps ?? 0,
        etaSeconds: d.etaSeconds ?? null,
      })))
    }
  }, [])

  const loadInstalledGames = useCallback(async () => {
    try {
      const uc = (window as any).ucDownloads
      if (!uc?.listInstalledGlobal) return
      const list: InstalledGame[] = await uc.listInstalledGlobal()
      setInstalledGames(
        (list || []).filter(i => i?.appid)
          .sort((a, b) => (b.installedAt || 0) - (a.installedAt || 0))
          .slice(0, 6)
      )
    } catch {}
  }, [])

  const clearToastTimers = useCallback(() => {
    if (toastTimerRef.current)    clearTimeout(toastTimerRef.current)
    if (toastProgressRef.current) clearInterval(toastProgressRef.current)
    if (hideTimeoutRef.current)   clearTimeout(hideTimeoutRef.current)
    toastTimerRef.current = toastProgressRef.current = hideTimeoutRef.current = null
  }, [])

  const enterMode = useCallback((next: OverlayMode, appid?: string | null) => {
    clearToastTimers()
    if (next === 'hidden') {
      modeRef.current = 'hidden'
      setAnimated(false)
      hideTimeoutRef.current = setTimeout(() => setMode('hidden'), 200)
      return
    }
    if (modeRef.current === next) setMode('hidden')
    modeRef.current = next
    setAnimated(false)
    requestAnimationFrame(() => {
      setMode(next)
      if (appid !== undefined) setCurrentAppid(appid)
      requestAnimationFrame(() => setAnimated(true))
    })
    if (next === 'toast') {
      setToastProgress(100)
      const start = Date.now()
      const dur = Math.max(2000, toastDurationMs)
      toastProgressRef.current = setInterval(() => {
        const p = Math.max(0, 100 - ((Date.now() - start) / dur) * 100)
        setToastProgress(p)
        if (p <= 0 && toastProgressRef.current) clearInterval(toastProgressRef.current)
      }, 50)
      toastTimerRef.current = setTimeout(() => {
        setAnimated(false)
        hideTimeoutRef.current = setTimeout(() => setMode('hidden'), 200)
      }, dur + 150)
    }
    if (next === 'panel') {
      refreshDownloads()
      loadInstalledGames()
    }
  }, [clearToastTimers, loadInstalledGames, refreshDownloads, toastDurationMs])

  // Subscribe to overlay API events
  useEffect(() => {
    const api = getOverlayApi()
    if (!api) return

    const unsubs = [
      api.onShow(data => {
        setCurrentAppid(data.appid ?? null)
        refreshGameInfo(data.appid)
        enterMode('panel', data.appid)
      }),
      api.onHide(() => enterMode('hidden')),
      api.onStateChanged(data => {
        if (data.appid) setCurrentAppid(data.appid)
        if (!data.visible) enterMode('hidden')
      }),
      api.onToast?.((data) => {
        if (typeof data.durationMs === 'number')
          setToastDurationMs(Math.max(2000, Math.min(12000, Math.round(data.durationMs))))
        if (data.vertical === 'top' || data.vertical === 'bottom')
          setToastVertical(data.vertical)
        setCurrentAppid(data.appid ?? null)
        refreshGameInfo(data.appid)
        enterMode('toast', data.appid)
      }),
      api.onDownloadUpdate?.((raw: unknown) => {
        const d = raw as any
        if (!d?.downloadId) return
        const entry: OverlayDownloadItem = {
          id: d.downloadId, appid: d.appid || '',
          gameName: d.gameName || d.appid || 'Unknown',
          status: d.status || 'downloading',
          receivedBytes: d.receivedBytes || 0, totalBytes: d.totalBytes || 0,
          speedBps: d.speedBps || 0, etaSeconds: d.etaSeconds ?? null,
        }
        setDownloads(prev => {
          if (['completed','failed','cancelled'].includes(entry.status))
            return prev.filter(x => x.id !== entry.id)
          const i = prev.findIndex(x => x.id === entry.id)
          if (i >= 0) { const n = [...prev]; n[i] = entry; return n }
          return [...prev, entry]
        })
      }),
      api.onPositionChanged?.((data) => {
        setDock(getDock(data.position))
        if (typeof data.toastDurationMs === 'number')
          setToastDurationMs(Math.max(2000, Math.min(12000, Math.round(data.toastDurationMs))))
        if (data.toastVertical === 'top' || data.toastVertical === 'bottom')
          setToastVertical(data.toastVertical)
      }),
    ].filter(Boolean) as Array<() => void>

    api.getSettings().then(s => {
      if (!s.ok) return
      setHotkey(s.hotkey || 'Ctrl+Shift+Tab')
      setDock(getDock(s.position))
      setToastDurationMs(Math.max(2000, Math.min(12000, Math.round(s.toastDurationMs || 5000))))
      setToastVertical(s.toastVertical === 'top' ? 'top' : 'bottom')
    }).catch(() => {})

    api.getStatus().then(s => {
      if (!s.ok) return
      setDock(getDock(s.position))
      if (s.currentAppid) { setCurrentAppid(s.currentAppid); refreshGameInfo(s.currentAppid) }
    }).catch(() => {})

    return () => unsubs.forEach(u => u())
  }, [enterMode, refreshGameInfo])

  // Playtime ticker
  useEffect(() => {
    if (mode !== 'panel' || !gameInfo?.startedAt) return
    updatePlaytime(gameInfo.startedAt)
    playtimeRef.current = setInterval(() => updatePlaytime(gameInfo.startedAt), 1000)
    return () => { if (playtimeRef.current) clearInterval(playtimeRef.current) }
  }, [gameInfo?.startedAt, mode, updatePlaytime])

  // Escape key
  useEffect(() => {
    if (mode !== 'panel') return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { enterMode('hidden'); window.ucOverlay?.hide() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [enterMode, mode])

  const closePanelAndHide = useCallback(() => {
    enterMode('hidden')
    setTimeout(() => window.ucOverlay?.hide(), 200)
  }, [enterMode])

  const quitGame = useCallback(() => {
    const id = gameInfo?.appid ?? currentAppid
    if (id) (window as any).ucDownloads?.quitGameExecutable?.(id)
    closePanelAndHide()
  }, [closePanelAndHide, currentAppid, gameInfo?.appid])

  const quickLaunch = useCallback(async (game: InstalledGame) => {
    const uc = (window as any)
    const api = uc.ucDownloads
    if (!api?.launchGameExecutable || !api?.listGameExecutables) return
    const name = game.metadata?.name || game.name || game.appid
    enterMode('hidden')
    try {
      const saved = await uc.ucSettings?.get?.(`gameExe:${game.appid}`)
      if (saved) {
        const r = await api.launchGameExecutable(game.appid, saved, name, false)
        if (r?.ok) { setGameInfo({ appid: game.appid, gameName: name, startedAt: Date.now(), image: game.metadata?.image || null }); enterMode('toast', game.appid) }
        return
      }
      const r = await api.listGameExecutables(game.appid)
      if (r?.ok && r.exes?.[0]?.path) {
        const l = await api.launchGameExecutable(game.appid, r.exes[0].path, name, false)
        if (l?.ok) { setGameInfo({ appid: game.appid, gameName: name, startedAt: Date.now(), image: game.metadata?.image || null }); enterMode('toast', game.appid) }
      }
    } catch {}
  }, [enterMode])

  const activeDl        = downloads.filter(d => ACTIVE_DL_STATUSES.includes(d.status))
  const unreadNotifs    = notifications.filter(n => !n.read)
  const sessionAppid    = gameInfo?.appid ?? currentAppid
  const hasSession      = Boolean(sessionAppid)

  // Panel animation: slide from the dock edge
  const panelSlide = animated
    ? 'opacity-100 translate-x-0'
    : dock === 'right' ? 'opacity-0 translate-x-6' : 'opacity-0 -translate-x-6'

  if (mode === 'hidden') return null

  // ── Toast ──────────────────────────────────────────────────────────────────
  if (mode === 'toast') {
    const toastStyle = dock === 'right' ? { right: 20 } : { left: 20 }
    const toastVClass = toastVertical === 'top' ? 'top-5' : 'bottom-5'
    return (
      <div className={`pointer-events-none fixed ${toastVClass} z-[9999] w-72`} style={toastStyle}>
        <div className={`overlay-panel rounded-2xl p-3 shadow-[0_16px_48px_rgba(0,0,0,0.7)] transition-all duration-200 ${animated ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white">
              {gameInfo?.image
                ? <img src={proxyImageUrl(gameInfo.image)} alt="" className="h-full w-full object-cover" />
                : <LogoStaticDark className="h-[15px] w-[15px]" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="section-label !text-zinc-400">Now Playing</div>
              <div className="truncate text-sm font-semibold text-white leading-tight">
                {gameInfo?.gameName || currentAppid || 'Game session'}
              </div>
            </div>
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
          </div>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[.08]">
            <div className="h-full rounded-full bg-white/80" style={{ width: `${toastProgress}%`, transition: 'width 50ms linear' }} />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[9px] text-zinc-600">Press to open overlay</span>
            <span className="token-chip text-[9px]">{hotkey}</span>
          </div>
        </div>
      </div>
    )
  }

  // ── Panel ──────────────────────────────────────────────────────────────────
  const panelPos  = dock === 'right' ? 'right-4' : 'left-4'
  const actionsPos = dock === 'right' ? 'left-4' : 'right-4'

  return (
    <div
      className={`fixed inset-0 z-[9998] transition-colors duration-300 ${mode === 'panel' ? 'bg-black/40' : ''}`}
      onClick={closePanelAndHide}
    >
      {/* ── Floating quick actions (opposite side of panel) ─────── */}
      <div
        className={`pointer-events-auto absolute top-4 ${actionsPos} flex items-center gap-2 transition-all duration-200 ${animated ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-3'}`}
        onClick={e => e.stopPropagation()}
      >
        {/* Screenshot */}
        <button
          onClick={handleScreenshot}
          className={`overlay-panel flex h-9 w-9 items-center justify-center rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.6)] transition hover:bg-zinc-700/80 hover:text-white active:scale-95 ${screenshotFlash ? 'text-emerald-300' : 'text-zinc-400'}`}
          title="Screenshot"
        >
          <Camera size={14} />
        </button>

        {/* Notifications */}
        <button
          onClick={() => setShowNotifications(v => !v)}
          className={`overlay-panel relative flex h-9 w-9 items-center justify-center rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.6)] transition hover:bg-zinc-700/80 hover:text-white active:scale-95 ${showNotifications ? 'text-sky-300' : 'text-zinc-400'}`}
          title="Notifications"
        >
          <Bell size={14} />
          {unreadNotifs.length > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[9px] font-bold text-black">
              {unreadNotifs.length > 9 ? '9+' : unreadNotifs.length}
            </span>
          )}
        </button>

        {/* Controller */}
        <button
          onClick={() => setShowController(v => !v)}
          className={`overlay-panel flex h-9 w-9 items-center justify-center rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.6)] transition hover:bg-zinc-700/80 hover:text-white active:scale-95 ${showController ? 'text-violet-300' : 'text-zinc-400'}`}
          title="Controller"
        >
          <Gamepad2 size={14} />
        </button>
      </div>

      {/* ── Notifications dropdown ──────────────────────────────── */}
      {showNotifications && (
        <div
          className={`overlay-panel pointer-events-auto absolute top-[60px] ${actionsPos} w-72 overflow-hidden rounded-2xl shadow-[0_16px_48px_rgba(0,0,0,0.7)] transition-all duration-200 ${animated ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-white/[.06] px-3 py-2.5">
            <span className="text-xs font-semibold text-white">Notifications</span>
            <span className="text-[10px] text-zinc-600">{notifications.length}</span>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {notifications.length === 0
              ? (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                  <Bell size={18} className="text-zinc-700" />
                  <span className="text-xs text-zinc-600">No notifications</span>
                </div>
              )
              : (
                <div className="space-y-px p-2">
                  {notifications.slice(0, 10).map(n => (
                    <div key={n.id} className={`rounded-xl px-3 py-2 ${n.read ? 'bg-transparent' : 'bg-white/[.04]'}`}>
                      <div className="flex items-start gap-2">
                        {!n.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium text-white">{n.title}</div>
                          <div className="mt-0.5 truncate text-[11px] text-zinc-500">{n.body}</div>
                        </div>
                        <span className="shrink-0 text-[10px] text-zinc-600">{formatNotifTime(n.timestamp)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </div>
        </div>
      )}

      {/* ── Main panel ─────────────────────────────────────────── */}
      <div
        className={`pointer-events-auto absolute top-4 ${panelPos} w-80 max-h-[calc(100vh-32px)] transition-all duration-200 ${panelSlide}`}
        onClick={e => e.stopPropagation()}
      >
<div className="overlay-panel flex h-full flex-col overflow-hidden rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.8)]">

          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/[.06]">
            {/* Time pill */}
            <div className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-2 py-1">
              <Clock size={11} className="text-zinc-500" />
              <span className="font-mono text-xs text-zinc-300">{formatTime(currentTime)}</span>
            </div>
            <div className="flex-1" />
            {/* Logo + wordmark */}
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white">
                <LogoStaticDark className="h-[13px] w-[13px]" />
              </div>
              <span className="text-sm font-brand text-white">UnionCrax</span>
            </div>
            <div className="flex-1" />
            <button
              onClick={closePanelAndHide}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-white/[.08] bg-zinc-900 text-zinc-500 transition hover:bg-white/[.08] hover:text-white active:scale-90"
            >
              <X size={13} />
            </button>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto">

            {/* Now Playing */}
            {hasSession && (
              <section className="px-4 py-3 border-b border-white/[.05]">
                {/* Game art banner */}
                {gameInfo?.image && (
                  <div className="relative mb-3 h-20 overflow-hidden rounded-xl">
                    <img src={proxyImageUrl(gameInfo.image)} alt="" className="h-full w-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/80 to-transparent" />
                    <div className="absolute bottom-2 left-3 flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      <span className="section-label !text-emerald-300">Live</span>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    {!gameInfo?.image && (
                      <div className="mb-1 flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        <span className="section-label !text-emerald-400">Live</span>
                      </div>
                    )}
                    <div className="truncate text-sm font-semibold text-white">
                      {gameInfo?.gameName || 'Session active'}
                    </div>
                    {gameInfo?.startedAt && (
                      <div className="mt-0.5 flex items-center gap-1 text-[11px] text-zinc-500">
                        <Clock size={10} />
                        <span className="font-mono text-zinc-300">{playtime}</span>
                        <span>session</span>
                      </div>
                    )}
                  </div>
                  <Zap size={14} className="shrink-0 text-emerald-400/60" />
                </div>
              </section>
            )}

            {/* Downloads */}
            {activeDl.length > 0 && (
              <section className="px-4 py-3 border-b border-white/[.05]">
                <div className="mb-2.5 flex items-center gap-1.5">
                  <Download size={11} className="text-sky-400" />
                  <span className="section-label !text-sky-400">Downloads</span>
                  <span className="ml-auto text-[10px] text-zinc-600">{activeDl.length}</span>
                </div>
                <div className="space-y-2">
                  {activeDl.slice(0, 4).map(dl => {
                    const pct = dl.totalBytes > 0 ? Math.round((dl.receivedBytes / dl.totalBytes) * 100) : 0
                    const statusLine = dl.status === 'extracting' ? 'Extracting…'
                      : dl.status === 'installing' ? 'Installing…'
                      : dl.status === 'verifying' ? 'Verifying…'
                      : dl.status === 'retrying' ? 'Recovery…'
                      : dl.status === 'queued' ? 'Queued'
                      : dl.status === 'paused' ? 'Paused'
                      : `${formatSpeed(dl.speedBps)} · ${formatBytes(dl.receivedBytes)} / ${formatBytes(dl.totalBytes)}`
                    return (
                        <div key={dl.id} className="rounded-xl border border-zinc-800 bg-zinc-900 p-2.5">
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-medium text-white">{dl.gameName || dl.appid}</div>
                            <div className="mt-0.5 flex items-center gap-2">
                              <span className={`text-[9px] font-semibold uppercase tracking-[0.12em] ${dlStatusColor(dl.status)}`}>
                                {dlLabel(dl.status)}
                              </span>
                              <span className="text-[9px] text-zinc-600">{pct}%</span>
                            </div>
                          </div>
                          {(dl.status === 'downloading' || dl.status === 'paused') && (
                            <button
                              onClick={() => dl.status === 'downloading'
                                ? window.ucOverlay?.pauseDownload(dl.id)
                                : window.ucOverlay?.resumeDownload(dl.id)}
                              className="flex h-6 w-6 items-center justify-center rounded-lg border border-white/[.08] bg-zinc-900 text-zinc-400 transition hover:text-white active:scale-90"
                            >
                              {dl.status === 'downloading' ? <Pause size={10} /> : <Play size={10} />}
                            </button>
                          )}
                        </div>
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[.07]">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: dlBarGradient(dl.status), transition: 'width 300ms ease' }} />
                        </div>
                        <div className="mt-1.5 text-[10px] text-zinc-600">{statusLine}</div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {/* Volume */}
            <section className="px-4 py-3 border-b border-white/[.05]">
              <div className="flex items-center gap-2.5">
                <button
                  onClick={handleMuteToggle}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/[.08] bg-zinc-900 text-zinc-400 transition hover:text-white active:scale-90"
                >
                  {isMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                </button>
                <input
                  type="range" min="0" max="100"
                  value={isMuted ? 0 : volume}
                  onChange={e => handleVolume(Number(e.target.value))}
                  className="h-1 flex-1 appearance-none rounded-full bg-transparent"
                  style={{
                    background: `linear-gradient(to right,rgba(255,255,255,0.9) 0%,rgba(255,255,255,0.9) ${isMuted ? 0 : volume}%,rgba(255,255,255,0.1) ${isMuted ? 0 : volume}%,rgba(255,255,255,0.1) 100%)`
                  }}
                />
                <span className="w-8 text-right font-mono text-[10px] text-zinc-500">
                  {isMuted ? '0' : volume}%
                </span>
              </div>
            </section>

            {/* Session controls */}
            {hasSession && (
              <section className="px-4 py-3 border-b border-white/[.05]">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={closePanelAndHide}
                    className="flex items-center gap-2 rounded-xl border border-zinc-700/60 bg-zinc-800 px-3 py-2 text-left text-white transition hover:bg-zinc-700 active:scale-95"
                  >
                    <Play size={13} />
                    <div>
                      <div className="text-xs font-semibold">Resume</div>
                      <div className="text-[10px] text-zinc-500">Back to game</div>
                    </div>
                  </button>
                  <button
                    onClick={quitGame}
                    className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-left text-red-300 transition hover:bg-red-500/20 active:scale-95"
                  >
                    <Square size={13} />
                    <div>
                      <div className="text-xs font-semibold">Quit</div>
                      <div className="text-[10px] text-red-400/60">Stop process</div>
                    </div>
                  </button>
                </div>
              </section>
            )}

            {/* Recently installed (no active session) */}
            {!hasSession && installedGames.length > 0 && (
              <section className="px-4 py-3">
                <div className="mb-2 flex items-center gap-1.5">
                  <Gamepad2 size={11} className="text-violet-400" />
                  <span className="section-label !text-violet-400">Recent games</span>
                </div>
                <div className="space-y-0.5">
                  {installedGames.map(game => (
                    <button
                      key={game.appid}
                      onClick={() => quickLaunch(game)}
                      className="flex w-full items-center gap-2.5 rounded-xl border border-transparent px-3 py-2 text-left transition hover:border-white/[.06] hover:bg-white/[.04] active:scale-[0.98]"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/[.06]">
                        {game.metadata?.image
                          ? <img src={proxyImageUrl(game.metadata.image)} alt="" className="h-full w-full object-cover" />
                          : <Gamepad2 size={13} className="text-zinc-500" />}
                      </div>
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-200">
                        {game.metadata?.name || game.name || game.appid}
                      </span>
                      <Play size={11} className="shrink-0 text-zinc-600" />
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-center gap-2 border-t border-white/[.05] px-4 py-2.5">
            <span className="text-[10px] text-zinc-700">Close</span>
            <span className="token-chip text-[9px]">Esc</span>
            <span className="text-zinc-800">·</span>
            <span className="token-chip text-[9px]">{hotkey}</span>
            <span className="text-[10px] text-zinc-700">Toggle</span>
          </div>
        </div>
      </div>

      {/* Controller flyout */}
      <ControllerOverlayFlyout
        visible={showController}
        onClose={() => setShowController(false)}
        position={dock === 'right' ? 'left' : 'right'}
      />
    </div>
  )
}

export default InGameOverlay
