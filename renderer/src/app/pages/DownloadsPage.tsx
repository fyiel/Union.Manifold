import { useEffect, useMemo, useRef, useState } from "react"
import { useDownloads } from "@/context/downloads-context"
import { useNavigate } from "react-router-dom"
import { useGamesData } from "@/hooks/use-games"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { pickGameExecutable, proxyImageUrl } from "@/lib/utils"
import { Download, HardDrive, PauseCircle, Play, XCircle, Square } from "lucide-react"
import { ExePickerModal } from "@/components/ExePickerModal"
import { DesktopShortcutModal } from "@/components/DesktopShortcutModal"
import { GameLaunchPreflightModal, type LaunchPreflightResult } from "@/components/GameLaunchPreflightModal"
import { gameLogger } from "@/lib/logger"

function formatBytes(bytes: number) {
  if (!bytes) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let index = 0
  let value = bytes
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index++
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`
}

function formatSpeed(bytesPerSecond: number) {
  if (!bytesPerSecond) return "0 B/s"
  return `${formatBytes(bytesPerSecond)}/s`
}

function formatEta(seconds: number | null) {
  if (!seconds || seconds <= 0) return "--"
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  if (mins > 60) {
    const hours = Math.floor(mins / 60)
    return `${hours}h ${mins % 60}m`
  }
  if (mins > 0) return `${mins}m ${secs}s`
  return `${secs}s`
}

// Module-level persistence for chart data (survives page navigation unmount/remount)
let _persistedNetworkHistory: number[] = []
let _persistedDiskHistory: number[] = []
let _persistedPeakSpeed = 0
let _persistedForAppId: string | null = null

function renderBars(points: number[], color: string) {
  const width = 600
  const height = 70
  if (!points.length) {
    return <line x1="0" y1={height} x2={width} y2={height} stroke={color} strokeWidth="1" opacity="0.35" />
  }
  const max = Math.max(...points, 1)
  const barSlot = width / Math.max(points.length, 1)
  const barWidth = Math.max(1, barSlot * 0.22)
  const offset = (barSlot - barWidth) / 2

  return (
    <>
      {points.map((value, index) => {
        const x = index * barSlot + offset
        const barHeight = (value / max) * height
        return (
          <rect
            key={`${color}-${index}`}
            x={x}
            y={height - barHeight}
            width={barWidth}
            height={barHeight}
            fill={color}
            opacity="0.85"
          />
        )
      })}
    </>
  )
}

function renderLine(points: number[], color: string) {
  const width = 600
  const height = 70
  if (!points.length) {
    return <polyline points={`0,${height} ${width},${height}`} fill="none" stroke={color} strokeWidth="2" opacity="0.6" />
  }
  const max = Math.max(...points, 1)
  const path = points
    .map((value, index) => {
      const x = points.length === 1 ? 0 : (index / (points.length - 1)) * width
      const y = height - (value / max) * height
      return `${x},${y}`
    })
    .join(" ")
  return <polyline points={path} fill="none" stroke={color} strokeWidth="2" opacity="0.9" />
}

function computeGroupStats(
  items: Array<{
    status: string
    totalBytes: number
    receivedBytes: number
    speedBps: number
    filename: string
    partIndex?: number
    partTotal?: number
  }>
) {
  const overallReceivedBytes = items.reduce((sum, item) => sum + (item.receivedBytes || 0), 0)
  const totalParts = getTotalParts(items)
  const knownTotals = items.filter((item) => (item.totalBytes || 0) > 0)
  const knownTotalBytes = knownTotals.reduce((sum, item) => sum + (item.totalBytes || 0), 0)
  let overallTotalBytes = knownTotalBytes
  if (totalParts > 1 && knownTotals.length > 0) {
    const avgPartSize = knownTotalBytes / knownTotals.length
    overallTotalBytes = Math.max(avgPartSize * totalParts, knownTotalBytes)
  }
  overallTotalBytes = Math.max(overallTotalBytes, overallReceivedBytes)
  const installingItems = items.filter((item) => item.status === "installing")
  const extractingItems = items.filter((item) => item.status === "extracting")
  const verifyingItems = items.filter((item) => item.status === "verifying")
  const retryingItems = items.filter((item) => item.status === "retrying")
  const downloadingItems = items.filter((item) => item.status === "downloading" || item.status === "paused")
  const queuedItems = items.filter((item) => item.status === "queued")
  const queuedOnly = items.every((item) => item.status === "queued")
  const pausedOnly = items.every((item) => item.status === "paused")
  const activeItems = installingItems.length
    ? installingItems
    : extractingItems.length
      ? extractingItems
      : verifyingItems.length
        ? verifyingItems
        : retryingItems.length
          ? retryingItems
          : downloadingItems.length
            ? downloadingItems
            : items

  const primaryItem =
    downloadingItems[0] ||
    verifyingItems[0] ||
    retryingItems[0] ||
    installingItems[0] ||
    extractingItems[0] ||
    queuedItems[0] ||
    activeItems[0] ||
    items[0]
  let totalBytes = activeItems.reduce((sum, item) => sum + (item.totalBytes || 0), 0)
  let receivedBytes = activeItems.reduce((sum, item) => sum + (item.receivedBytes || 0), 0)
  const speedBps = activeItems.reduce((sum, item) => sum + (item.speedBps || 0), 0)
  const phase = queuedOnly
    ? "queued"
    : pausedOnly
      ? "paused"
      : installingItems.length
        ? "installing"
        : extractingItems.length
          ? "extracting"
          : verifyingItems.length
            ? "verifying"
            : retryingItems.length
              ? "retrying"
              : "downloading"
  if (overallTotalBytes > 0) {
    totalBytes = overallTotalBytes
    receivedBytes = Math.min(overallReceivedBytes, overallTotalBytes)
  }
  const effectiveSpeed = phase === "extracting" || phase === "installing" || phase === "paused" ? 0 : speedBps
  const etaSeconds = totalBytes > 0 && effectiveSpeed > 0 ? (totalBytes - receivedBytes) / effectiveSpeed : null
  const progress = totalBytes > 0 ? (receivedBytes / totalBytes) * 100 : 0

  return {
    totalBytes,
    receivedBytes,
    speedBps: effectiveSpeed,
    etaSeconds,
    progress,
    phase,
    overallTotalBytes,
    overallReceivedBytes,
    primaryPartReceived: primaryItem?.receivedBytes || 0,
    primaryPartFilename: primaryItem?.filename || "",
    primaryPartIndex: primaryItem?.partIndex,
  }
}

function getPartsLabel(items: Array<{ filename: string; partTotal?: number }>) {
  return getTotalParts(items) <= 1 ? "file" : "parts"
}

function parsePartIndex(filename: string) {
  const lower = filename.toLowerCase()
  const partMatch = lower.match(/part\s*([0-9]{1,3})/)
  const extMatch = lower.match(/\.([0-9]{3})$/)
  if (partMatch?.[1]) return Number(partMatch[1])
  if (extMatch?.[1]) return Number(extMatch[1])
  return null
}

function getTotalParts(items: Array<{ filename: string; partTotal?: number }>) {
  const hintedTotals = items
    .map((item) => item.partTotal)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0)
  if (hintedTotals.length > 0) {
    return Math.max(Math.max(...hintedTotals), items.length)
  }
  const parsed = items.map((item) => parsePartIndex(item.filename)).filter((n) => typeof n === "number") as number[]
  if (parsed.length > 0) {
    const max = Math.max(...parsed)
    return Math.max(max, items.length)
  }
  return items.length
}

function getPartIndex(filename: string, index: number, total: number, partIndex?: number) {
  const partNum = partIndex ?? parsePartIndex(filename) ?? (total > 1 ? index + 1 : 1)
  return { partNum, total }
}

const ACTIVE_DOWNLOAD_STATUSES = ["downloading", "paused", "extracting", "installing", "verifying", "retrying"]
const INSTALL_READY_STATUS = "install_ready"

export function DownloadsPage() {
  const isWindows = typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent)
  const {
    downloads,
    startGameDownload,
    cancelGroup,
    pauseDownload,
    resumeDownload,
    resumeGroup,
    openPath,
    clearCompleted,
    clearByAppid,
  } = useDownloads()
  const navigate = useNavigate()
  const { games } = useGamesData()

  const grouped = useMemo(() => {
    return downloads.reduce<Record<string, typeof downloads>>((acc, item) => {
      acc[item.appid] = acc[item.appid] || []
      acc[item.appid].push(item)
      return acc
    }, {})
  }, [downloads])

  const activeGroups = Object.values(grouped).filter((items) => {
    const hasActive = items.some((item) => ACTIVE_DOWNLOAD_STATUSES.includes(item.status))
    const hasCompletedAndQueued = items.some((item) => ["completed", "extracted"].includes(item.status)) && items.some((item) => item.status === "queued")
    return hasActive || hasCompletedAndQueued
  })
  const queuedGroups = Object.values(grouped).filter((items) =>
    items.every((item) => item.status === "queued")
  )
  const installReadyGroups = Object.values(grouped).filter((items) =>
    items.some((item) => item.status === INSTALL_READY_STATUS)
  )
  const completedGroups = Object.values(grouped).filter((items) =>
    items.every((item) => ["completed", "extracted"].includes(item.status))
  )
  const cancelledGroups = Object.values(grouped).filter((items) =>
    items.every((item) => ["cancelled", "failed", "extract_failed"].includes(item.status))
  )

  const primaryGroup = activeGroups[0] || queuedGroups[0]
  const primaryGame = primaryGroup ? games.find((game) => game.appid === primaryGroup[0]?.appid) : null
  const primaryIsInstalling = primaryGroup ? primaryGroup.some((it) => it.status === 'installing' || it.status === 'extracting') : false
  const primaryIsPaused = primaryGroup ? primaryGroup.some((it) => it.status === 'paused') : false

  const currentAppId = primaryGroup?.[0]?.appid ?? null
  const [networkHistory, setNetworkHistory] = useState<number[]>(
    _persistedForAppId === currentAppId ? _persistedNetworkHistory : []
  )
  const [diskHistory, setDiskHistory] = useState<number[]>(
    _persistedForAppId === currentAppId ? _persistedDiskHistory : []
  )
  const [peakSpeed, setPeakSpeed] = useState(
    _persistedForAppId === currentAppId ? _persistedPeakSpeed : 0
  )
  const [exePickerOpen, setExePickerOpen] = useState(false)
  const [exePickerTitle, setExePickerTitle] = useState("")
  const [exePickerMessage, setExePickerMessage] = useState("")
  const [exePickerAppId, setExePickerAppId] = useState<string | null>(null)
  const [exePickerGameName, setExePickerGameName] = useState<string | null>(null)
  const [exePickerFolder, setExePickerFolder] = useState<string | null>(null)
  const [exePickerExes, setExePickerExes] = useState<Array<{ name: string; path: string; size?: number; depth?: number }>>([])
  const [retryingAppId, setRetryingAppId] = useState<string | null>(null)
  const [runningGames, setRunningGames] = useState<Array<{ appid: string; gameName: string; pid: number }>>([])
  const [pendingExePath, setPendingExePath] = useState<string | null>(null)
  const [pendingAppId, setPendingAppId] = useState<string | null>(null);
  const [shortcutModalOpen, setShortcutModalOpen] = useState(false)
  const [launchPreflightOpen, setLaunchPreflightOpen] = useState(false)
  const [launchPreflightResult, setLaunchPreflightResult] = useState<LaunchPreflightResult | null>(null)
  const [installingAppId, setInstallingAppId] = useState<string | null>(null)
  const primaryStatsRef = useRef<{
    totalBytes: number
    receivedBytes: number
    speedBps: number
    etaSeconds: number | null
    progress: number
  } | null>(null)
  const lastSampleRef = useRef<{ time: number; received: number } | null>(null)

  const primaryStats = useMemo(() => {
    if (!primaryGroup) return null
    return computeGroupStats(primaryGroup)
  }, [primaryGroup])
  const primaryTotalParts = useMemo(() => {
    if (!primaryGroup) return 1
    return getTotalParts(primaryGroup)
  }, [primaryGroup])

  useEffect(() => {
    primaryStatsRef.current = primaryStats
  }, [primaryStats])

  useEffect(() => {
    if (!primaryGroup || !primaryStats) {
      setNetworkHistory([])
      setDiskHistory([])
      setPeakSpeed(0)
    _persistedNetworkHistory = []
    _persistedDiskHistory = []
    _persistedPeakSpeed = 0
    _persistedForAppId = null
    lastSampleRef.current = null
    return
  }

    const appId = primaryGroup?.[0]?.appid ?? null
    // Restore persisted chart data if same download is still active
    if (_persistedForAppId === appId && _persistedNetworkHistory.length > 0) {
      setNetworkHistory(_persistedNetworkHistory)
      setDiskHistory(_persistedDiskHistory)
      setPeakSpeed(_persistedPeakSpeed)
    } else {
      setNetworkHistory([])
      setDiskHistory([])
      setPeakSpeed(0)
    }
    _persistedForAppId = appId
    const interval = setInterval(() => {
      const stats = primaryStatsRef.current
      if (!stats) return
      const now = Date.now()
      const networkSpeed = stats.speedBps || 0
      const lastSample = lastSampleRef.current
      let diskSpeed = 0
      if (lastSample) {
        const deltaBytes = stats.receivedBytes - lastSample.received
        const deltaTime = Math.max(0.001, (now - lastSample.time) / 1000)
        diskSpeed = Math.max(0, deltaBytes / deltaTime)
      }
      lastSampleRef.current = { time: now, received: stats.receivedBytes }

      // If download is complete and speed is zero, stop adding data points
      if (stats.progress >= 99.9 && networkSpeed === 0 && diskSpeed === 0) {
        return
      }

      setNetworkHistory((prev) => {
        const next = [...prev, networkSpeed].slice(-60)
        _persistedNetworkHistory = next
        return next
      })
      setDiskHistory((prev) => {
        const next = [...prev, diskSpeed].slice(-60)
        _persistedDiskHistory = next
        return next
      })
      setPeakSpeed((prev) => {
        const next = Math.max(prev, networkSpeed)
        _persistedPeakSpeed = next
        return next
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [primaryGroup?.[0]?.appid])

  useEffect(() => {
    let mounted = true
    const checkRunningGames = async () => {
      if (!window.ucDownloads?.listInstalledGlobal || !window.ucDownloads?.getRunningGame) return
      try {
        const installed = await window.ucDownloads.listInstalledGlobal()
        const running: Array<{ appid: string; gameName: string; pid: number }> = []
        
        for (const entry of installed) {
          if (!entry?.appid) continue
          const result = await window.ucDownloads.getRunningGame(entry.appid)
          if (result?.ok && result.running && result.pid) {
            const game = games.find((g) => g.appid === entry.appid)
            running.push({
              appid: entry.appid,
              gameName: game?.name || entry.name || entry.appid,
              pid: result.pid
            })
          }
        }
        
        if (mounted) {
          setRunningGames(running)
        }
      } catch (err) {
        gameLogger.error('Failed to check running games', { data: err })
      }
    }
    
    void checkRunningGames()
    const interval = setInterval(checkRunningGames, 3000)
    
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [games])

  const currentNetwork = networkHistory[networkHistory.length - 1] ?? primaryStats?.speedBps ?? 0
  const currentDisk = diskHistory[diskHistory.length - 1] ?? 0
  const averageSpeed = useMemo(() => {
    const nonZeroSamples = networkHistory.filter((sample) => sample > 0)
    if (nonZeroSamples.length > 0) {
      return nonZeroSamples.reduce((sum, sample) => sum + sample, 0) / nonZeroSamples.length
    }
    return primaryStats?.speedBps ?? 0
  }, [networkHistory, primaryStats?.speedBps])
  const peakNetworkSpeed = useMemo(() => {
    if (networkHistory.length > 0) {
      return Math.max(...networkHistory)
    }
    return peakSpeed
  }, [networkHistory, peakSpeed])

  const getSavedExe = async (appid: string) => {
    if (!window.ucSettings?.get) return null
    try {
      return await window.ucSettings.get(`gameExe:${appid}`)
    } catch {
      return null
    }
  }

  const setSavedExe = async (appid: string, path: string | null) => {
    if (!window.ucSettings?.set) return
    try {
      await window.ucSettings.set(`gameExe:${appid}`, path || null)
    } catch {}
  }

  const getShortcutAskedForGame = async (appid: string) => {
    if (!window.ucSettings?.get) return false
    try {
      return await window.ucSettings.get(`shortcutAsked:${appid}`)
    } catch {
      return false
    }
  }

  const setShortcutAskedForGame = async (appid: string) => {
    if (!window.ucSettings?.set) return
    try {
      await window.ucSettings.set(`shortcutAsked:${appid}`, true)
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

  const createDesktopShortcut = async (appid: string, exePath: string) => {
    if (!window.ucDownloads?.createDesktopShortcut) return
    const game = games.find((g) => g.appid === appid)
    if (!game) return
    try {
      const result = await window.ucDownloads.createDesktopShortcut(game.name, exePath)
      if (result?.ok) {
        gameLogger.info('Desktop shortcut created', { appid })
      } else {
        gameLogger.error('Failed to create desktop shortcut', { data: result })
      }
    } catch (err) {
      gameLogger.error('Error creating desktop shortcut', { data: err })
    }
  }

  const openExePicker = (appid: string, gameName: string, exes: Array<{ name: string; path: string; size?: number; depth?: number }>, folder?: string | null, message?: string) => {
    setExePickerTitle("Select executable")
    setExePickerMessage(message || `We couldn't confidently detect the correct exe for "${gameName}". Please choose the one to launch.`)
    setExePickerAppId(appid)
    setExePickerGameName(gameName)
    setExePickerFolder(folder || null)
    setExePickerExes(exes)
    setExePickerOpen(true)
  }

  const runLaunchPreflight = async (appid: string, path: string) => {
    const result = await window.ucDownloads?.preflightGameLaunch?.(appid, path)
    if (!result?.ok) return true
    if (result.canLaunch && result.checks.length === 0) return true

    setPendingAppId(appid)
    setPendingExePath(path)
    setLaunchPreflightResult(result)
    setLaunchPreflightOpen(true)
    return false
  }

  const reopenExecutablePicker = async () => {
    if (!pendingAppId) return
    const game = games.find((entry) => entry.appid === pendingAppId)
    if (!game || !window.ucDownloads?.listGameExecutables) return

    try {
      const result = await window.ucDownloads.listGameExecutables(pendingAppId)
      openExePicker(pendingAppId, game.name, result?.exes || [], result?.folder || null)
    } finally {
      setLaunchPreflightOpen(false)
    }
  }

  const handleRetry = async (appid?: string) => {
    if (!appid) return
    const game = games.find((g) => g.appid === appid)
    if (!game) return
    setRetryingAppId(appid)
    try {
      clearByAppid(appid)
      await startGameDownload(game)
    } catch (err) {
      console.error("[UC] Failed to retry download", err)
    } finally {
      setRetryingAppId((current) => (current === appid ? null : current))
    }
  }

  const handleInstallReady = async (appid?: string) => {
    if (!appid || !window.ucDownloads?.installDownloadedArchive) return
    setInstallingAppId(appid)
    try {
      clearByAppid(appid)
      const result = await window.ucDownloads.installDownloadedArchive(appid)
      if (!result?.ok) {
        throw new Error(result?.error || "Failed to install downloaded archive")
      }
    } catch (err) {
      gameLogger.error('Failed to install downloaded archive', { data: { appid, err } })
    } finally {
      setInstallingAppId((current) => (current === appid ? null : current))
    }
  }

  const launchGame = async (appid: string, path: string) => {
    if (!window.ucDownloads?.launchGameExecutable) return
    const game = games.find((g) => g.appid === appid)
    const gameName = game?.name || appid
    const showGameName = await window.ucSettings?.get?.('rpcShowGameName') ?? true
    const res = await window.ucDownloads.launchGameExecutable(appid, path, gameName, showGameName)
    if (res && res.ok) {
      await setSavedExe(appid, path)
      setExePickerOpen(false)
      setShortcutModalOpen(false)
      setPendingExePath(null)
      setPendingAppId(null)
    }
  }

  const handleLaunchWithShortcutCheck = async (appid: string, path: string, options?: { skipPreflight?: boolean }) => {
    if (!options?.skipPreflight) {
      const passed = await runLaunchPreflight(appid, path)
      if (!passed) return
    }

    // Check if we should show shortcut modal BEFORE launching
    const alreadyAsked = await getShortcutAskedForGame(appid)
    const alwaysCreate = await getAlwaysCreateShortcut()
    
    if (alwaysCreate && !alreadyAsked) {
      // Auto-create shortcut without asking, then launch
      await createDesktopShortcut(appid, path)
      await setShortcutAskedForGame(appid)
      await launchGame(appid, path)
    } else if (!alreadyAsked && !alwaysCreate) {
      // Show the shortcut prompt BEFORE launching
      setPendingExePath(path)
      setPendingAppId(appid)
      setExePickerOpen(false)
      setShortcutModalOpen(true)
    } else {
      // No shortcut needed, just launch
      await launchGame(appid, path)
    }
  }

  const handleExePicked = async (path: string) => {
    if (!exePickerAppId) return
    setPendingExePath(path)
    setPendingAppId(exePickerAppId)
    await handleLaunchWithShortcutCheck(exePickerAppId, path)
  }

  const handleLaunch = async (appid: string, gameName: string, fallbackPath?: string) => {
    if (!appid) return
    if (!window.ucDownloads?.listGameExecutables || !window.ucDownloads?.launchGameExecutable) {
      if (fallbackPath) openPath(fallbackPath)
      return
    }
    try {
      const savedExe = await getSavedExe(appid)
      
      if (savedExe) {
        await handleLaunchWithShortcutCheck(appid, savedExe)
        return
      }
      
      const result = await window.ucDownloads.listGameExecutables(appid)
      const exes = result?.exes || []
      const folder = result?.folder || null
      const { pick, confident } = pickGameExecutable(exes, gameName, undefined, folder)
      if (pick && confident) {
        await handleLaunchWithShortcutCheck(appid, pick.path)
        return
      }
      openExePicker(appid, gameName, exes, folder)
    } catch {
      openExePicker(appid, gameName, [], null, `Unable to list executables for "${gameName}".`)
    }
  }

  const handleQuitGame = async (appid: string) => {
    if (!window.ucDownloads?.quitGameExecutable) return
    try {
      const result = await window.ucDownloads.quitGameExecutable(appid)
      if (result?.ok && result.stopped) {
        setRunningGames((prev) => prev.filter((g) => g.appid !== appid))
      }
    } catch (err) {
      gameLogger.error('Failed to quit game', { data: err })
    }
  }

  return (
    <div className="container mx-auto max-w-7xl space-y-8">
      {/* Header Section */}
      <div className="flex items-end justify-between anim">
        <div className="space-y-1">
          <p className="section-label">Downloads</p>
          <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">Activity</h1>
          <p className="text-sm text-zinc-500">Manage your downloads, installations and running games</p>
        </div>
        <Button 
          variant="outline" 
          onClick={clearCompleted} 
          className="rounded-full border-white/[.07] px-5 text-sm font-medium text-zinc-300 hover:border-zinc-500 hover:text-white active:scale-95"
        >
          Clear history
        </Button>
      </div>

      {/* Now Playing Section */}
      {runningGames.length > 0 && (
        <section className="space-y-4 anim anim-d1">
          <div className="flex items-center gap-3">
            <div className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
            <p className="section-label text-zinc-400">Now Playing</p>
          </div>
          <div className="space-y-3">
            {runningGames.map((game) => (
              <div
                key={game.appid}
                className="group flex items-center justify-between rounded-2xl border border-white/[.07] bg-zinc-900/60 p-4 backdrop-blur-md transition-all hover:border-zinc-700 hover:bg-white/[.03]"
              >
                <div className="flex items-center gap-4">
                  <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-green-500/20 to-green-600/10 ring-1 ring-green-500/30">
                    <Play className="h-5 w-5 text-green-400" />
                    <div className="absolute -right-1 -top-1 h-3 w-3 animate-pulse rounded-full bg-green-400 ring-2 ring-zinc-900" />
                  </div>
                  <div>
                    <div className="font-semibold text-white">{game.gameName}</div>
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <span className="inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                        Running
                      </span>
                      <span className="text-zinc-600">•</span>
                      <span className="font-mono text-zinc-600">PID {game.pid}</span>
                    </div>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleQuitGame(game.appid)}
                  className="gap-2 rounded-full border-zinc-700 text-zinc-400 hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-400 active:scale-95"
                >
                  <Square className="h-3.5 w-3.5" />
                  Stop
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Primary Active Download */}
      {primaryGroup && primaryStats && (
        <section className="anim anim-d1">
          <div className="relative overflow-hidden rounded-3xl border border-white/[.07] bg-zinc-900/70 shadow-2xl shadow-black/40 backdrop-blur-xl">
            {/* Background Image with Gradient Overlay */}
            <div className="absolute inset-0">
              {primaryGame?.image && (
                <img
                  src={proxyImageUrl(primaryGame.image)}
                  alt={primaryGroup[0]?.gameName || "Download"}
                  className="h-full w-full scale-110 object-cover opacity-20 blur-3xl saturate-50"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-br from-zinc-950/80 via-zinc-900/90 to-zinc-950/80" />
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/60 via-transparent to-transparent" />
            </div>

            <div className="relative z-10 p-6 lg:p-8">
              {/* Header Row */}
              <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex items-start gap-4">
                  {/* Game Thumbnail */}
                  {primaryGame?.image && (
                    <div className="relative h-20 w-32 flex-shrink-0 overflow-hidden rounded-xl border border-white/[.07] bg-zinc-900/80 shadow-lg">
                      <img
                        src={proxyImageUrl(primaryGame.image)}
                        alt={primaryGroup[0]?.gameName || "Download"}
                        className="h-full w-full object-cover"
                      />
                      {/* Status Indicator */}
                      <div className="absolute bottom-2 left-2">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          primaryStats?.phase === "paused" 
                            ? "bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/30"
                            : primaryStats?.phase === "installing" || primaryStats?.phase === "extracting"
                              ? "bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/30"
                              : "bg-white/10 text-white ring-1 ring-white/20"
                        }`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${
                            primaryStats?.phase === "paused"
                              ? "bg-amber-400"
                              : "animate-pulse bg-white"
                          }`} />
                          {primaryStats?.phase === "queued"
                            ? "Queued"
                            : primaryStats?.phase === "paused"
                              ? "Paused"
                              : primaryStats?.phase === "installing"
                                ? "Installing"
                                : primaryStats?.phase === "extracting"
                                  ? "Extracting"
                                  : "Active"}
                        </span>
                      </div>
                    </div>
                  )}
                  
                  {/* Game Info */}
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-black tracking-tight text-white sm:text-2xl">
                        {primaryGroup[0]?.gameName || "Unknown"}
                      </h2>
                      {primaryGame?.version && (
                        <span className="rounded-full border border-white/10 bg-zinc-800/60 px-2.5 py-0.5 text-[11px] font-medium text-zinc-400">
                          v{primaryGame.version}
                        </span>
                      )}
                    </div>
                    
                    {primaryTotalParts > 1 && (
                      <div className="text-xs text-zinc-500">
                        {(() => {
                          const info = getPartIndex(
                            primaryStats.primaryPartFilename || "",
                            0,
                            primaryTotalParts,
                            primaryStats.primaryPartIndex
                          )
                          return `Part ${info.partNum} of ${info.total}`
                        })()}
                      </div>
                    )}

                    {/* Quick Stats Row */}
                    <div className="flex flex-wrap items-center gap-4 pt-1">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-zinc-500">ETA</span>
                        <span className="font-mono font-bold tabular-nums text-white">{formatEta(primaryStats.etaSeconds)}</span>
                      </div>
                      <div className="h-3 w-px bg-zinc-700" />
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-zinc-500">{primaryTotalParts > 1 ? "Parts" : "File"}</span>
                        <span className="font-bold text-white">{primaryTotalParts}</span>
                      </div>
                      <div className="h-3 w-px bg-zinc-700" />
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-zinc-500">Avg</span>
                        <span className="font-mono font-bold tabular-nums text-white">{formatSpeed(averageSpeed)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-2">
                  {primaryIsPaused ? (
                    <Button 
                      onClick={() => primaryGroup && resumeGroup(primaryGroup[0]?.appid)} 
                      className="gap-2 rounded-full bg-white px-5 text-sm font-bold text-black hover:bg-zinc-200 active:scale-95"
                    >
                      <Play className="h-4 w-4" />
                      Resume
                    </Button>
                  ) : (
                    <Button 
                      variant="outline" 
                      onClick={() => primaryGroup && primaryGroup.forEach((it) => pauseDownload(it.id))} 
                      className="gap-2 rounded-full border-white/[.07] px-5 text-sm font-medium text-zinc-300 hover:border-zinc-500 hover:text-white active:scale-95"
                    >
                      <PauseCircle className="h-4 w-4" />
                      Pause
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => primaryGroup && cancelGroup(primaryGroup[0]?.appid)}
                    className="gap-2 rounded-full border-white/[.07] px-5 text-sm font-medium text-zinc-400 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400 active:scale-95"
                  >
                    <XCircle className="h-4 w-4" />
                    Cancel
                  </Button>
                </div>
              </div>

              {/* Progress Section */}
              <div className="mt-6 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400">
                    {(() => {
                      const part = getPartIndex(
                        primaryStats.primaryPartFilename || "",
                        0,
                        primaryTotalParts,
                        primaryStats.primaryPartIndex
                      ).partNum
                      if (primaryStats?.phase === "queued") return "Waiting in queue..."
                      if (primaryStats?.phase === "paused") return "Download paused"
                      if (primaryStats?.phase === "verifying") return "Verifying archive integrity..."
                      if (primaryStats?.phase === "retrying") return "Verification failed - re-downloading..."
                      if (primaryStats?.phase === "installing" || primaryStats?.phase === "extracting") {
                        return primaryTotalParts > 1 ? `Installing part ${part} of ${primaryTotalParts}...` : "Installing game data..."
                      }
                      return "Downloading game data..."
                    })()}
                  </span>
                  <span className="font-mono text-sm font-bold tabular-nums text-white">
                    {formatBytes(primaryStats.receivedBytes)} <span className="text-zinc-500">/</span> {formatBytes(primaryStats.totalBytes)}
                  </span>
                </div>
                
                {/* Enhanced Progress Bar */}
                <div className="relative">
                  <Progress
                    value={primaryStats.progress}
                    className="h-3 bg-zinc-800/80 [&_[data-slot=progress-indicator]]:bg-gradient-to-r [&_[data-slot=progress-indicator]]:from-white [&_[data-slot=progress-indicator]]:to-zinc-300"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-black/80">
                    {Math.round(primaryStats.progress)}%
                  </div>
                </div>

                {primaryStats.phase !== "downloading" && primaryStats.overallTotalBytes > 0 && (
                  <div className="text-xs text-zinc-500">
                    Total downloaded: {formatBytes(primaryStats.overallReceivedBytes)} / {formatBytes(primaryStats.overallTotalBytes)}
                  </div>
                )}
              </div>

              {/* Performance Chart */}
              <div className="mt-6 rounded-2xl border border-white/[.07] bg-zinc-900/50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Performance Monitor</span>
                  <div className="flex items-center gap-4 text-xs text-zinc-500">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-white" />
                      Network
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-zinc-500" />
                      Disk I/O
                    </span>
                  </div>
                </div>
                <svg viewBox="0 0 600 70" className="h-16 w-full">
                  {renderBars(networkHistory, "rgb(255 255 255)")}
                  {renderLine(diskHistory, "rgb(113 113 122)")}
                </svg>
              </div>

              {/* Stats Grid */}
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-white/[.07] bg-zinc-800/40 p-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Download</div>
                  <div className="mt-1 font-mono text-lg font-bold tabular-nums text-white">{formatSpeed(currentNetwork)}</div>
                </div>
                <div className="rounded-xl border border-white/[.07] bg-zinc-800/40 p-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Peak</div>
                  <div className="mt-1 font-mono text-lg font-bold tabular-nums text-white">{formatSpeed(peakNetworkSpeed)}</div>
                </div>
                <div className="rounded-xl border border-white/[.07] bg-zinc-800/40 p-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Disk Write</div>
                  <div className="mt-1 font-mono text-lg font-bold tabular-nums text-white">{formatSpeed(currentDisk)}</div>
                </div>
                <div className="rounded-xl border border-white/[.07] bg-zinc-800/40 p-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Transferred</div>
                  <div className="mt-1 font-mono text-lg font-bold tabular-nums text-white">{formatBytes(primaryStats.receivedBytes)}</div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}
      {/* Queue Section */}
      <section className="space-y-4 anim anim-d2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <p className="section-label">Download Queue</p>
            <Badge variant="secondary" className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-[11px] font-medium text-zinc-400">
              {queuedGroups.length}
            </Badge>
          </div>
        </div>

        {queuedGroups.length === 0 && (
          <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 p-8 text-center">
            <Download className="mx-auto mb-3 h-8 w-8 text-zinc-700" />
            <p className="text-sm text-zinc-500">Queue is empty</p>
            <p className="mt-1 text-xs text-zinc-600">Start a download from any game page to see it here</p>
          </div>
        )}

        <div className="space-y-3">
          {queuedGroups.map((items) => {
            const {
              totalBytes,
              receivedBytes,
              speedBps,
              etaSeconds,
              progress,
              phase,
              overallTotalBytes,
              overallReceivedBytes,
              primaryPartReceived,
              primaryPartFilename,
              primaryPartIndex,
            } = computeGroupStats(items)
            const totalParts = getTotalParts(items)
            const gameName = items[0]?.gameName || "Unknown"
            const appid = items[0]?.appid
            const game = appid ? games.find((g) => g.appid === appid) : null
            const queuedOnly = items.every((item) => item.status === "queued")
            const groupStatus = items.some((item) => item.status === "paused")
              ? "Paused"
              : phase === "installing"
                ? "Installing"
                : phase === "extracting"
                  ? "Extracting"
                  : "Queued"

            return (
              <div
                key={`${items[0].appid}-${gameName}`}
                className="group overflow-hidden rounded-2xl border border-white/[.07] bg-zinc-900/60 backdrop-blur-sm transition-all hover:border-zinc-700"
              >
                <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
                  {/* Game Info */}
                  <div className="flex items-center gap-4 sm:w-[280px]">
                    <div className="relative h-14 w-24 flex-shrink-0 overflow-hidden rounded-lg border border-white/[.07] bg-zinc-800">
                      {game?.image ? (
                        <img
                          src={proxyImageUrl(game.image)}
                          alt={gameName}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      ) : null}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-white">{gameName}</h3>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                        {game?.version && (
                          <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono">{game.version}</span>
                        )}
                        <span className={`rounded px-1.5 py-0.5 ${
                          groupStatus === "Paused" 
                            ? "bg-amber-500/10 text-amber-400" 
                            : "bg-zinc-800/80 text-zinc-400"
                        }`}>
                          {groupStatus}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Progress */}
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500">
                        {queuedOnly
                          ? "Waiting in queue..."
                          : phase === "installing"
                            ? "Installing..."
                            : phase === "extracting"
                              ? "Extracting..."
                              : "Downloading..."}
                      </span>
                      <span className="font-mono text-zinc-400">
                        {formatBytes(receivedBytes)} / {formatBytes(totalBytes)}
                      </span>
                    </div>
                    <Progress value={progress} className="h-1.5 bg-zinc-800" />
                    <div className="flex items-center justify-between text-[11px] text-zinc-500">
                      <span>ETA: {formatEta(etaSeconds)}</span>
                      <span>{formatSpeed(speedBps)}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      onClick={() => cancelGroup(items[0]?.appid)}
                      className="rounded-full px-3 text-xs text-zinc-500 hover:bg-red-500/10 hover:text-red-400"
                    >
                      <XCircle className="mr-1.5 h-3.5 w-3.5" />
                      Cancel
                    </Button>
                  </div>
                </div>

                {/* Footer */}
                <div className="border-t border-white/[.05] bg-zinc-900/40 px-4 py-2">
                  <div className="flex items-center justify-between text-[11px] text-zinc-600">
                    <span>{totalParts} {getPartsLabel(items)}</span>
                    <span>
                      {(() => {
                        const part = getPartIndex(primaryPartFilename || "", 0, totalParts, primaryPartIndex).partNum
                        if (queuedOnly) return "Waiting..."
                        if (phase === "downloading") return `Part ${part}/${totalParts}`
                        if (totalParts > 1) return `Installing ${part}/${totalParts}`
                        return "Installing..."
                      })()}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Install Ready Section */}
      <section className="space-y-4 anim anim-d3">
        <div className="flex items-center gap-3">
          <p className="section-label">Ready to Install</p>
          <Badge variant="secondary" className="rounded-full bg-blue-500/10 px-2.5 py-0.5 text-[11px] font-medium text-blue-400 ring-1 ring-blue-500/20">
            {installReadyGroups.length}
          </Badge>
        </div>

        {installReadyGroups.length === 0 && (
          <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 p-8 text-center">
            <HardDrive className="mx-auto mb-3 h-8 w-8 text-zinc-700" />
            <p className="text-sm text-zinc-500">No pending installations</p>
            <p className="mt-1 text-xs text-zinc-600">Downloads ready for extraction will appear here</p>
          </div>
        )}

        <div className="space-y-3">
          {installReadyGroups.map((items) => {
            const gameName = items[0]?.gameName || "Unknown"
            const appid = items[0]?.appid
            const game = appid ? games.find((g) => g.appid === appid) : null
            const readyAt = items
              .map((item) => item.completedAt || 0)
              .sort((a, b) => b - a)[0]
            const readyNote = items.find((item) => item.error)?.error || "Download complete. Click Install to extract and set up the game."
            const totalParts = getTotalParts(items)

            return (
              <div
                key={`install-ready-${items[0].appid}-${gameName}`}
                className="group overflow-hidden rounded-2xl border border-blue-500/20 bg-gradient-to-r from-blue-500/5 to-transparent backdrop-blur-sm transition-all hover:border-blue-500/30"
              >
                <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="relative h-14 w-24 flex-shrink-0 overflow-hidden rounded-lg border border-white/[.07] bg-zinc-800">
                      {game?.image ? (
                        <img
                          src={proxyImageUrl(game.image)}
                          alt={gameName}
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                      <div className="absolute bottom-1 right-1 rounded bg-blue-500/90 px-1.5 py-0.5 text-[9px] font-bold text-white">
                        READY
                      </div>
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-white">{gameName}</h3>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                        {game?.version && (
                          <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono">{game.version}</span>
                        )}
                        <span className="text-zinc-600">•</span>
                        <span>{readyAt ? new Date(readyAt).toLocaleDateString() : "Ready"}</span>
                      </div>
                      <p className="mt-1.5 max-w-md text-[11px] text-zinc-500">{readyNote}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        void handleInstallReady(appid)
                      }}
                      disabled={!appid || installingAppId === appid}
                      className="gap-2 rounded-full bg-white px-4 text-xs font-medium text-black hover:bg-zinc-200 active:scale-95 disabled:opacity-50"
                    >
                      <HardDrive className="h-3.5 w-3.5" />
                      {installingAppId === appid ? "Starting..." : "Install Now"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (appid) navigate(`/game/${appid}`)
                      }}
                      className="rounded-full border-zinc-700 px-4 text-xs text-zinc-400 hover:border-zinc-500 hover:text-white active:scale-95"
                    >
                      View
                    </Button>
                  </div>
                </div>

                <div className="border-t border-white/[.05] bg-zinc-900/40 px-4 py-2">
                  <div className="flex items-center justify-between text-[11px] text-zinc-600">
                    <span>{totalParts} {getPartsLabel(items)}</span>
                    <span className="flex items-center gap-1.5 text-blue-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                      Ready to install
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Completed Section */}
      <section className="space-y-4 anim anim-d4">
        <div className="flex items-center gap-3">
          <p className="section-label">Completed</p>
          <Badge variant="secondary" className="rounded-full bg-green-500/10 px-2.5 py-0.5 text-[11px] font-medium text-green-400 ring-1 ring-green-500/20">
            {completedGroups.length}
          </Badge>
        </div>

        {completedGroups.length === 0 && (
          <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 p-8 text-center">
            <Play className="mx-auto mb-3 h-8 w-8 text-zinc-700" />
            <p className="text-sm text-zinc-500">No completed downloads yet</p>
            <p className="mt-1 text-xs text-zinc-600">Successfully installed games will appear here</p>
          </div>
        )}

        <div className="space-y-3">
          {completedGroups.map((items) => {
            const gameName = items[0]?.gameName || "Unknown"
            const appid = items[0]?.appid
            const game = appid ? games.find((g) => g.appid === appid) : null
            const finishedAt = items
              .map((item) => item.completedAt || 0)
              .sort((a, b) => b - a)[0]
            const totalParts = getTotalParts(items)

            return (
              <div
                key={`completed-${items[0].appid}-${gameName}`}
                className="group cursor-pointer overflow-hidden rounded-2xl border border-white/[.07] bg-zinc-900/60 backdrop-blur-sm transition-all hover:border-green-500/30 hover:bg-white/[.03]"
                onClick={() => {
                  if (appid) navigate(`/game/${appid}`)
                }}
              >
                <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="relative h-14 w-24 flex-shrink-0 overflow-hidden rounded-lg border border-white/[.07] bg-zinc-800">
                      {game?.image ? (
                        <img
                          src={proxyImageUrl(game.image)}
                          alt={gameName}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      ) : null}
                      <div className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-white">
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-white group-hover:text-green-50">{gameName}</h3>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                        {game?.version && (
                          <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono">{game.version}</span>
                        )}
                        <span className="text-zinc-600">•</span>
                        <span>{finishedAt ? new Date(finishedAt).toLocaleDateString() : "Completed"}</span>
                      </div>
                      {game?.comment && (
                        <p className="mt-1.5 max-w-md text-[11px] text-amber-400/80">
                          Note: {game.comment}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation()
                        if (appid) {
                          void handleLaunch(appid, gameName, items[0]?.savePath)
                        }
                      }}
                      className="gap-2 rounded-full bg-white px-4 text-xs font-medium text-black hover:bg-zinc-200 active:scale-95"
                    >
                      <Play className="h-3.5 w-3.5" />
                      Launch
                    </Button>
                  </div>
                </div>

                <div className="border-t border-white/[.05] bg-zinc-900/40 px-4 py-2">
                  <div className="flex items-center justify-between text-[11px] text-zinc-600">
                    <span>{totalParts} {getPartsLabel(items)}</span>
                    <span className="flex items-center gap-1.5 text-green-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                      Installed
                    </span>
                  </div>
                </div>
              </div>
            )}
          )}
        </div>
      </section>

      {/* Cancelled / Failed Section */}
      <section className="space-y-4 anim anim-d5">
        <div className="flex items-center gap-3">
          <p className="section-label">Failed / Cancelled</p>
          <Badge variant="secondary" className="rounded-full bg-red-500/10 px-2.5 py-0.5 text-[11px] font-medium text-red-400 ring-1 ring-red-500/20">
            {cancelledGroups.length}
          </Badge>
        </div>

        {cancelledGroups.length === 0 && (
          <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 p-8 text-center">
            <XCircle className="mx-auto mb-3 h-8 w-8 text-zinc-700" />
            <p className="text-sm text-zinc-500">No failed downloads</p>
            <p className="mt-1 text-xs text-zinc-600">Cancelled or failed downloads will appear here</p>
          </div>
        )}

        <div className="space-y-3">
          {cancelledGroups.map((items) => {
            const gameName = items[0]?.gameName || "Unknown"
            const appid = items[0]?.appid
            const game = appid ? games.find((g) => g.appid === appid) : null
            const status = items[0]?.status || "cancelled"
            const statusLabel = status === "cancelled" ? "Cancelled" : status === "extract_failed" ? "Extract Failed" : "Failed"
            const totalParts = getTotalParts(items)

            return (
              <div
                key={`cancelled-${items[0].appid}-${gameName}`}
                className="group overflow-hidden rounded-2xl border border-red-500/10 bg-zinc-900/40 opacity-75 backdrop-blur-sm transition-all hover:opacity-100"
              >
                <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="relative h-14 w-24 flex-shrink-0 overflow-hidden rounded-lg border border-white/[.07] bg-zinc-800 grayscale">
                      {game?.image ? (
                        <img
                          src={proxyImageUrl(game.image)}
                          alt={gameName}
                          className="h-full w-full object-cover opacity-50"
                        />
                      ) : null}
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                        <XCircle className="h-6 w-6 text-red-400/80" />
                      </div>
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-zinc-400">{gameName}</h3>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-red-400">{statusLabel}</span>
                        {game?.version && (
                          <>
                            <span className="text-zinc-600">•</span>
                            <span className="text-zinc-500 font-mono">{game.version}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        void handleRetry(appid)
                      }}
                      disabled={retryingAppId === appid}
                      className="gap-2 rounded-full bg-white px-4 text-xs font-medium text-black hover:bg-zinc-200 active:scale-95 disabled:opacity-50"
                    >
                      {retryingAppId === appid ? "Retrying..." : "Retry"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (appid) clearByAppid(appid)
                      }}
                      className="rounded-full px-3 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                    >
                      Remove
                    </Button>
                  </div>
                </div>

                <div className="border-t border-white/[.05] bg-zinc-900/40 px-4 py-2">
                  <div className="flex items-center justify-between text-[11px] text-zinc-600">
                    <span>{totalParts} {getPartsLabel(items)}</span>
                    <span className="flex items-center gap-1.5 text-red-400/70">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-400/70" />
                      {statusLabel}
                    </span>
                  </div>
                </div>
              </div>
            )}
          )}
        </div>
      </section>

      <ExePickerModal
        open={exePickerOpen}
        title={exePickerTitle}
        message={exePickerMessage}
        exes={exePickerExes}
        gameName={exePickerGameName || undefined}
        baseFolder={exePickerFolder}
        onSelect={handleExePicked}
        onClose={() => setExePickerOpen(false)}
      />
      <DesktopShortcutModal
        open={shortcutModalOpen}
        gameName={games.find((g) => g.appid === pendingAppId)?.name || "Game"}
        onCreateShortcut={async () => {
          if (pendingExePath && pendingAppId) {
            await createDesktopShortcut(pendingAppId, pendingExePath)
            await setShortcutAskedForGame(pendingAppId)
            await launchGame(pendingAppId, pendingExePath)
          }
        }}
        onSkip={async () => {
          if (pendingAppId) {
            await setShortcutAskedForGame(pendingAppId)
          }
          if (pendingExePath && pendingAppId) {
            await launchGame(pendingAppId, pendingExePath)
          }
        }}
        onClose={async () => {
          if (pendingAppId) {
            await setShortcutAskedForGame(pendingAppId)
          }
          setShortcutModalOpen(false)
          setPendingExePath(null)
          setPendingAppId(null)
        }}
      />
      <GameLaunchPreflightModal
        open={launchPreflightOpen}
        gameName={games.find((g) => g.appid === pendingAppId)?.name || 'Game'}
        result={launchPreflightResult}
        onClose={() => {
          setLaunchPreflightOpen(false)
          setLaunchPreflightResult(null)
          setPendingExePath(null)
          setPendingAppId(null)
        }}
        onChooseAnother={reopenExecutablePicker}
        onContinue={launchPreflightResult?.canLaunch && pendingExePath && pendingAppId
          ? async () => {
              const nextPath = pendingExePath
              const nextAppId = pendingAppId
              setLaunchPreflightOpen(false)
              setLaunchPreflightResult(null)
              await handleLaunchWithShortcutCheck(nextAppId, nextPath, { skipPreflight: true })
            }
          : undefined}
      />
    </div>
  )
}



