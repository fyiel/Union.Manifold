import { useEffect, useMemo, useRef, useState } from "react"
import { useDownloads, type DownloadItem } from "@/context/downloads-context"
import { useNavigate } from "react-router-dom"
import { useGamesData } from "@/hooks/use-games"
import { useRunningGamesSessions } from "@/hooks/use-running-games"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { pickGameExecutable, proxyImageUrl } from "@/lib/utils"
import {
  HardDrive,
  PauseCircle,
  XCircle,
  Square,
} from "lucide-react"
import {
  AlertTriangle,
  Download,
  Play,
} from "@/components/icons"
import { ExePickerModal } from "@/components/ExePickerModal"
import { DesktopShortcutModal } from "@/components/DesktopShortcutModal"
import { GameLaunchPreflightModal, type LaunchPreflightResult } from "@/components/GameLaunchPreflightModal"
import { CommentMarkdown } from "@/components/CommentMarkdown"
import { gameLogger } from "@/lib/logger"

// Pick the best-available cover image for a download row, falling back to the
// bundled banner asset when the catalog row is missing entirely (offline boot,
// catalog refresh pending, external/installing-only games not in /api/games).
// Avoids the "no thumbnail, blank box" symptom on the activity list.
function downloadItemImageSrc(game: any | null | undefined): string {
  const candidate =
    game?.hero_image ||
    game?.splash ||
    game?.image ||
    game?.localHeroImage ||
    game?.localSplash ||
    game?.localImage ||
    "./fallbacks/game-hero-16x9.svg"
  return proxyImageUrl(candidate) || candidate
}

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

type DiskInfo = {
  id: string
  name: string
  path: string
  totalBytes: number
  freeBytes: number
}

type SpaceCheck = NonNullable<DownloadItem["spaceCheck"]>

type SpacePromptState = {
  appid?: string | null
  gameName?: string | null
  downloadId: string
  spaceCheck: SpaceCheck
}

function suggestDrivePath(currentPath: string, nextRoot: string) {
  if (!currentPath) return nextRoot
  const normalizedRoot = nextRoot.endsWith("\\") || nextRoot.endsWith("/") ? nextRoot : `${nextRoot}\\`
  const driveMatch = currentPath.match(/^[a-z]:[\\/]/i)
  if (!driveMatch) return normalizedRoot
  const relative = currentPath.slice(driveMatch[0].length).replace(/^[\\/]+/, "")
  return relative ? `${normalizedRoot}${relative}` : normalizedRoot
}

// Module-level persistence for chart data (survives page navigation unmount/remount)
let _persistedNetworkHistory: number[] = []
let _persistedDiskHistory: number[] = []
let _persistedPeakSpeed = 0
let _persistedForAppId: string | null = null

// Steam-style throughput chart: filled vertical bars for the network history
// (green), a smoothed line over them for disk I/O (amber). Renders against a
// shared max so both series read on the same scale.
const CHART_WIDTH = 600
const CHART_HEIGHT = 90

function renderBars(points: number[], _color: string, sharedMax?: number) {
  const height = CHART_HEIGHT
  const width = CHART_WIDTH
  if (!points.length) return null
  const max = sharedMax ?? Math.max(...points, 1)
  // ~60 samples fill the width. Each bar is a thin column with a small gap.
  const slot = width / Math.max(points.length, 1)
  const barWidth = Math.max(2, slot * 0.7)
  const offset = (slot - barWidth) / 2

  return (
    <g>
      {points.map((value, index) => {
        const x = index * slot + offset
        // Floor height a little so we always see something while bytes are
        // moving — Steam does the same so the chart never looks "empty".
        const safeValue = value > 0 ? value : 0
        const barHeight = max > 0 ? Math.max(safeValue > 0 ? 2 : 0, (safeValue / max) * height) : 0
        return (
          <rect
            key={`bar-${index}`}
            x={x}
            y={height - barHeight}
            width={barWidth}
            height={barHeight}
            fill="url(#netGradient)"
            rx={1}
          />
        )
      })}
    </g>
  )
}

function renderLine(points: number[], color: string, sharedMax?: number) {
  const height = CHART_HEIGHT
  const width = CHART_WIDTH
  if (!points.length) return null
  const max = sharedMax ?? Math.max(...points, 1)
  // Build a smoothed polyline by sampling each point at the centre of its slot.
  const slot = width / Math.max(points.length, 1)
  const path = points
    .map((value, index) => {
      const x = index * slot + slot / 2
      const safeValue = value > 0 ? value : 0
      const y = max > 0 ? height - (safeValue / max) * height : height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")
  return (
    <polyline
      points={path}
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  )
}

function ChartGradients() {
  return (
    <defs>
      <linearGradient id="netGradient" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stopColor="#22c55e" stopOpacity="0.95" />
        <stop offset="100%" stopColor="#16a34a" stopOpacity="0.55" />
      </linearGradient>
      <linearGradient id="netGlow" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stopColor="#22c55e" stopOpacity="0.18" />
        <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
      </linearGradient>
    </defs>
  )
}

function computeGroupStats(
  items: Array<{
    status: string
    totalBytes: number
    receivedBytes: number
    speedBps: number
    extractProgress?: number | null
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
  const effectiveSpeed = phase === "paused" ? 0 : speedBps
  const etaSeconds = totalBytes > 0 && effectiveSpeed > 0 ? (totalBytes - receivedBytes) / effectiveSpeed : null
  const extractionSamples = activeItems
    .map((item) => item.extractProgress)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  const extractionProgress = extractionSamples.length
    ? Math.max(0, Math.min(100, Math.max(...extractionSamples)))
    : null
  const progress = extractionProgress ?? (totalBytes > 0 ? (receivedBytes / totalBytes) * 100 : 0)

  return {
    totalBytes,
    receivedBytes,
    speedBps: effectiveSpeed,
    etaSeconds,
    progress,
    extractionProgress,
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

function getGroupPriority(items: DownloadItem[]) {
  if (items.some((item) => ["downloading", "verifying", "retrying"].includes(item.status))) return 0
  if (items.some((item) => ["extracting", "installing"].includes(item.status))) return 1
  if (items.some((item) => item.status === "paused")) return 2
  if (items.some((item) => item.status === "queued")) return 3
  if (items.some((item) => ["completed", "extracted"].includes(item.status))) return 4
  return 5
}
const INSTALL_READY_STATUS = "install_ready"

function groupCanPause(items: DownloadItem[]) {
  return items.some((item) => ["downloading", "retrying", "extracting", "installing", "verifying"].includes(item.status))
}

function groupIsPaused(items: DownloadItem[], phase?: string | null) {
  if (phase) return phase === "paused"
  return !groupCanPause(items) && items.some((item) => item.status === "paused")
}

/** Live session timer — ticks every second, shows h/m/s. */
function SessionTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(() => Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
  useEffect(() => {
    const id = setInterval(
      () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000))),
      1000
    )
    return () => clearInterval(id)
  }, [startedAt])
  const h = Math.floor(elapsed / 3600)
  const m = Math.floor((elapsed % 3600) / 60)
  const s = elapsed % 60
  if (h > 0) return <>{h}h {m}m</>
  if (m > 0) return <>{m}m {s}s</>
  return <>{s}s</>
}

export function DownloadsPage() {
  const isWindows = typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent)
  const {
    downloads,
    startGameDownload,
    cancelGroup,
    pauseGroup,
    pauseAll,
    resumeAll,
    resumeGroup,
    resumeDownload,
    openPath,
    clearCompleted,
    clearByAppid,
    dismissByAppid,
  } = useDownloads()
  const navigate = useNavigate()
  const { games } = useGamesData()
  const runningSessions = useRunningGamesSessions()

  // Watch the user's bandwidth cap so we can decorate active rows when the
  // cap is biting (current speed is at/near the configured ceiling). Stored
  // as KB/s; convert to bytes-per-second for comparison with `speedBps`.
  const [bandwidthLimitKBps, setBandwidthLimitKBps] = useState(0)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const value = await window.ucSettings?.get?.('downloadBandwidthLimitKBps')
        if (!cancelled) setBandwidthLimitKBps(Number(value) > 0 ? Math.floor(Number(value)) : 0)
      } catch { /* ignore */ }
    })()
    const off = window.ucSettings?.onChanged?.((data: any) => {
      if (!data) return
      if (data.key === 'downloadBandwidthLimitKBps') {
        setBandwidthLimitKBps(Number(data.value) > 0 ? Math.floor(Number(data.value)) : 0)
      } else if (data.key === '__CLEAR_ALL__') {
        setBandwidthLimitKBps(0)
      }
    })
    return () => {
      cancelled = true
      if (typeof off === 'function') off()
    }
  }, [])
  const bandwidthLimitBps = bandwidthLimitKBps * 1024

  const grouped = useMemo(() => {
    return downloads.reduce<Record<string, typeof downloads>>((acc, item) => {
      acc[item.appid] = acc[item.appid] || []
      acc[item.appid].push(item)
      return acc
    }, {})
  }, [downloads])

  const activeGroups = Object.values(grouped)
    .filter((items) => {
      const hasActive = items.some((item) => ACTIVE_DOWNLOAD_STATUSES.includes(item.status))
      const hasCompletedAndQueued = items.some((item) => ["completed", "extracted"].includes(item.status)) && items.some((item) => item.status === "queued")
      return hasActive || hasCompletedAndQueued
    })
    .sort((left, right) => getGroupPriority(left) - getGroupPriority(right))
  const queuedGroups = Object.values(grouped)
    .filter((items) => items.every((item) => item.status === "queued"))
    .sort((left, right) => getGroupPriority(left) - getGroupPriority(right))
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
  const secondaryActiveGroups = primaryGroup ? activeGroups.slice(1) : activeGroups
  const hasAnyPausableGroups = useMemo(
    () => Object.values(grouped).some((items) => groupCanPause(items) || items.some((item) => item.status === "queued")),
    [grouped]
  )
  const hasAnyPausedGroups = useMemo(
    () => Object.values(grouped).some((items) => groupIsPaused(items)),
    [grouped]
  )
  const primaryGame = primaryGroup ? games.find((game) => game.appid === primaryGroup[0]?.appid) : null
  const primaryIsInstalling = primaryGroup ? primaryGroup.some((it) => it.status === 'installing' || it.status === 'extracting') : false

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
  const [shortcutModalAlwaysCreate, setShortcutModalAlwaysCreate] = useState(false)
  const [launchPreflightOpen, setLaunchPreflightOpen] = useState(false)
  const [launchPreflightResult, setLaunchPreflightResult] = useState<LaunchPreflightResult | null>(null)
  const [installingAppId, setInstallingAppId] = useState<string | null>(null)
  const [spacePrompt, setSpacePrompt] = useState<SpacePromptState | null>(null)
  const [selectedSpaceDriveId, setSelectedSpaceDriveId] = useState("")
  const [switchingDrive, setSwitchingDrive] = useState(false)
  const primaryStatsRef = useRef<{
    totalBytes: number
    receivedBytes: number
    speedBps: number
    etaSeconds: number | null
    progress: number
  } | null>(null)
  const lastSampleRef = useRef<{ time: number; received: number } | null>(null)
  const isPausedRef = useRef(false)

  const primaryStats = useMemo(() => {
    if (!primaryGroup) return null
    return computeGroupStats(primaryGroup)
  }, [primaryGroup])
  const primaryPhase = primaryStats?.phase ?? null
  const primaryIsPaused = primaryGroup ? groupIsPaused(primaryGroup, primaryPhase) : false
  isPausedRef.current = primaryIsPaused
  const primaryCanPause = primaryGroup ? groupCanPause(primaryGroup) : false
  const primaryTotalParts = useMemo(() => {
    if (!primaryGroup) return 1
    return getTotalParts(primaryGroup)
  }, [primaryGroup])

  useEffect(() => {
    primaryStatsRef.current = primaryStats
  }, [primaryStats])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail
      if (!detail?.downloadId || !detail?.spaceCheck) return
      setSpacePrompt({
        appid: detail.appid,
        gameName: detail.gameName,
        downloadId: detail.downloadId,
        spaceCheck: detail.spaceCheck,
      })
    }

    window.addEventListener("uc_insufficient_space", handler)
    return () => window.removeEventListener("uc_insufficient_space", handler)
  }, [])

  useEffect(() => {
    if (!spacePrompt) return
    const preferredDrive = spacePrompt.spaceCheck.drives.find((drive) => drive.freeBytes >= spacePrompt.spaceCheck.requiredBytes)
    const currentDrive = spacePrompt.spaceCheck.drives.find((drive) => spacePrompt.spaceCheck.targetPath.startsWith(drive.path))
    setSelectedSpaceDriveId(preferredDrive?.id || currentDrive?.id || spacePrompt.spaceCheck.drives[0]?.id || "")
  }, [spacePrompt])

  useEffect(() => {
    if (!spacePrompt) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (switchingDrive) return
      event.preventDefault()
      setSpacePrompt(null)
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [spacePrompt, switchingDrive])

  useEffect(() => {
    if (!primaryGroup || !primaryStats) {
      setNetworkHistory([])
      setDiskHistory([])
      setPeakSpeed(0)
      // Do NOT clear persisted data here — primaryGroup may be transiently null
      // on mount while the downloads context is still populating. Clearing here
      // would destroy the history before it can be restored when the group loads.
      lastSampleRef.current = null
      return
    }

    const appId = primaryGroup?.[0]?.appid ?? null

    // If a genuinely different download is now active, discard old chart data.
    if (_persistedForAppId !== null && _persistedForAppId !== appId) {
      _persistedNetworkHistory = []
      _persistedDiskHistory = []
      _persistedPeakSpeed = 0
    }

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

      // Don't accumulate zero samples while paused — preserve history so the
      // chart still shows the pre-pause activity when the download resumes.
      if (isPausedRef.current) {
        // Reset the disk-speed baseline so the first tick after resume
        // doesn't compute a huge delta from bytes that downloaded before the pause.
        lastSampleRef.current = null
        return
      }

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

  const setAlwaysCreateShortcut = async (value: boolean) => {
    if (!window.ucSettings?.set) return
    try {
      await window.ucSettings.set('alwaysCreateDesktopShortcut', value)
    } catch {}
  }

  const createDesktopShortcut = async (appid: string, exePath?: string | null) => {
    if (!window.ucDownloads?.createDesktopShortcut) return
    const game = games.find((g) => g.appid === appid)
    if (!game) return
    try {
      const result = await window.ucDownloads.createDesktopShortcut(game.name, appid, exePath || undefined)
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
      // New simple path: ask the main process to either resume from any
      // partial it finds on disk OR start fresh. It owns the filesystem
      // truth — the renderer just provides a fresh URL.
      if (window.ucDownloads?.smartStart) {
        // First make sure we have a fresh download URL from the API.
        const { requestDownloadToken, fetchDownloadLinks, selectHost, resolveDownloadUrl } = await import("@/lib/downloads")
        try {
          const token = await requestDownloadToken(appid)
          const links = await fetchDownloadLinks(appid, token)
          const sourceUrl = links.redirectUrl || selectHost(links.hosts, "ucfiles").links[0]?.url
          if (!sourceUrl) throw new Error("No download link available")
          const resolved = await resolveDownloadUrl("ucfiles", sourceUrl)
          const finalUrl = resolved?.resolved ? resolved.url : sourceUrl

          // Reuse the existing downloadId from state if there is one, else generate one.
          const existing = downloads.find((item) => item.appid === appid && item.url)
          const downloadId = existing?.id || `${appid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}-0`

          // Make sure the install metadata is on disk first so smartStart can
          // write the manifest snapshot.
          if (window.ucDownloads?.saveInstalledMetadata) {
            try {
              await window.ucDownloads.saveInstalledMetadata(appid, {
                ...game,
                downloadedVersion: game.version || undefined,
              })
            } catch { }
          }

          // Reset any "failed/cancelled" UI rows for this appid so progress
          // shows up against the new (or existing) downloadId.
          if (!existing) {
            clearByAppid(appid)
          }

          const result = await window.ucDownloads.smartStart({
            appid,
            downloadId,
            gameName: game.name,
            url: finalUrl,
            filename: resolved?.filename || existing?.filename,
            totalBytes: resolved?.size || existing?.totalBytes,
          })

          if (result?.alreadyComplete) {
            // File on disk is full size — kick off install directly.
            if (window.ucDownloads?.installDownloadedArchive) {
              await window.ucDownloads.installDownloadedArchive(appid)
            }
            return
          }
          if (result?.ok) return
          // smartStart returned !ok — fall through to legacy path
          console.warn("[UC] smartStart failed, falling back to fresh download", result?.error)
        } catch (err) {
          console.warn("[UC] smartStart pre-resolve failed, falling back", err)
        }
      }
      // Legacy fallback path
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
      if ((result?.code === "INSUFFICIENT_SPACE" || result?.error === "insufficient_space") && result.spaceCheck) {
        setSpacePrompt({
          appid,
          gameName: games.find((game) => game.appid === appid)?.name || appid,
          downloadId: result.downloadId || `installing:${appid}`,
          spaceCheck: result.spaceCheck,
        })
        return
      }
      if (!result?.ok) {
        throw new Error(result?.error || "Failed to install downloaded archive")
      }
    } catch (err) {
      gameLogger.error('Failed to install downloaded archive', { data: { appid, err } })
    } finally {
      setInstallingAppId((current) => (current === appid ? null : current))
    }
  }

  const handleSwitchInstallDrive = async () => {
    if (!spacePrompt || !selectedSpaceDriveId || !window.ucDownloads?.setDownloadPath) return
    const selectedDrive = spacePrompt.spaceCheck.drives.find((drive) => drive.id === selectedSpaceDriveId)
    if (!selectedDrive) return
    setSwitchingDrive(true)
    try {
      const currentPath = (await window.ucDownloads.getDownloadPath?.())?.path || spacePrompt.spaceCheck.targetPath
      const nextPath = suggestDrivePath(currentPath, selectedDrive.path)
      const result = await window.ucDownloads.setDownloadPath(nextPath)
      if (!result?.ok) {
        throw new Error("Failed to change install path")
      }
      const retryAppId = spacePrompt.appid
      setSpacePrompt(null)
      if (retryAppId) await handleInstallReady(retryAppId)
    } catch (error) {
      gameLogger.error("Failed to switch install drive", { data: { error, selectedSpaceDriveId } })
    } finally {
      setSwitchingDrive(false)
    }
  }

  const handlePickInstallFolder = async () => {
    if (!spacePrompt || !window.ucDownloads?.pickDownloadPath) return
    setSwitchingDrive(true)
    try {
      const result = await window.ucDownloads.pickDownloadPath()
      if (!result?.ok || !result.path) return
      const retryAppId = spacePrompt.appid
      setSpacePrompt(null)
      if (retryAppId) await handleInstallReady(retryAppId)
    } catch (error) {
      gameLogger.error("Failed to pick install folder", { data: { error } })
    } finally {
      setSwitchingDrive(false)
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
      setShortcutModalAlwaysCreate(false)
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

  const isCompletelyIdle =
    !primaryGroup &&
    runningGames.length === 0 &&
    queuedGroups.length === 0 &&
    installReadyGroups.length === 0 &&
    completedGroups.length === 0 &&
    cancelledGroups.length === 0

  return (
    <div className="container mx-auto max-w-7xl space-y-8">
      {/* Header Section */}
      <div className="flex items-end justify-between anim">
        <div className="space-y-1">
          <p className="section-label">Library</p>
          <h1 className="text-3xl font-light tracking-tight text-white sm:text-4xl">Activity</h1>
          <p className="text-sm text-muted-foreground/80">Manage your downloads, installations and running games</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => void resumeAll()}
            disabled={!hasAnyPausedGroups}
            className="gap-2 rounded-full border-white/[.07] px-4 text-sm font-medium text-foreground/80 hover:border-zinc-500 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            Resume all
          </Button>
          <Button
            variant="outline"
            onClick={() => void pauseAll()}
            disabled={!hasAnyPausableGroups}
            className="gap-2 rounded-full border-white/[.07] px-4 text-sm font-medium text-foreground/80 hover:border-zinc-500 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-50"
          >
            <PauseCircle className="h-4 w-4" />
            Pause all
          </Button>
          <Button
            variant="outline"
            onClick={clearCompleted}
            className="rounded-full border-white/[.07] px-5 text-sm font-medium text-foreground/80 hover:border-zinc-500 hover:text-white active:scale-95"
          >
            Clear history
          </Button>
        </div>
      </div>

      {/* Big empty state when nothing is downloading, installed-recently, queued,
          or running. Better than five "no items" placeholders stacked. */}
      {isCompletelyIdle && (
        <div className="rounded-3xl border border-white/[.07] bg-card/40 px-6 py-16 text-center backdrop-blur-sm anim anim-d1">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[.05]">
            <Download className="h-6 w-6 text-muted-foreground/80" />
          </div>
          <h2 className="mt-4 text-lg font-light text-white">Nothing happening here</h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground/80">
            Start a download from any game's page and you'll see live progress, throughput, and post-install controls here.
          </p>
          <Button
            onClick={() => navigate("/")}
            className="mt-6 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground hover:brightness-110 active:scale-95"
          >
            Browse catalogue
          </Button>
        </div>
      )}

      {/* Now Playing — rich cards with game art, session timer, no PID */}
      {runningGames.length > 0 && (
        <section className="space-y-3 anim anim-d1">
          <div className="flex items-center gap-3">
            <div className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
            </div>
            <p className="section-label text-muted-foreground">Now Playing</p>
            <Badge variant="secondary" className="rounded-full bg-green-500/10 px-2.5 py-0.5 text-[11px] font-medium text-green-300 ring-1 ring-green-500/20">
              {runningGames.length}
            </Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {runningGames.map((rg) => {
              const game = games.find((g) => g.appid === rg.appid)
              const heroSrc = proxyImageUrl(
                (game as any)?.hero_image ||
                (game as any)?.localHeroImage ||
                game?.splash ||
                (game as any)?.localSplash ||
                game?.image ||
                (game as any)?.localImage ||
                "./fallbacks/game-hero-16x9.svg"
              )
              const coverSrc = proxyImageUrl(
                (game as any)?.image ||
                (game as any)?.localImage ||
                (game as any)?.splash ||
                ""
              ) || "./fallbacks/game-card-3x4.svg"
              const session = runningSessions.find((s) => s.appid === rg.appid)
              return (
                <div
                  key={rg.appid}
                  className="group relative overflow-hidden rounded-2xl border border-green-500/20 bg-card shadow-lg shadow-green-500/5 transition-all hover:border-green-500/35 hover:shadow-green-500/10"
                >
                  {/* Full-bleed hero as ambient background */}
                  <div className="absolute inset-0">
                    <img src={heroSrc} alt={rg.gameName} className="h-full w-full object-cover opacity-45 transition-opacity group-hover:opacity-55" />
                    <div className="absolute inset-0 bg-gradient-to-r from-background via-background/75 to-background/15" />
                  </div>
                  <div className="relative flex items-center justify-between gap-3 p-4">
                    <div className="flex min-w-0 items-center gap-3">
                      {/* Portrait cover art thumbnail */}
                      <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-lg ring-1 ring-white/[.08] shadow-md">
                        <img src={coverSrc} alt="" className="h-full w-full object-cover" />
                        {/* Pulsing live indicator overlay */}
                        <div className="absolute inset-0 flex items-end justify-center pb-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.8)] animate-pulse" />
                        </div>
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-white leading-snug">{rg.gameName}</div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px]">
                          <span className="inline-flex items-center gap-1 font-medium text-green-300">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
                            Running
                          </span>
                          {session && (
                            <>
                              <span className="text-muted-foreground/60">·</span>
                              <span className="font-mono text-muted-foreground">
                                <SessionTimer startedAt={session.startedAt} />
                              </span>
                            </>
                          )}
                        </div>
                        {game?.genres && game.genres.length > 0 && (
                          <div className="mt-1 text-[10px] text-muted-foreground/60 truncate">{game.genres.slice(0, 2).join(" · ")}</div>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleQuitGame(rg.appid)}
                      className="shrink-0 gap-1.5 rounded-full border-white/10 bg-card/70 px-3 text-xs text-foreground/80 backdrop-blur-sm hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300 active:scale-95"
                    >
                      <Square className="h-3 w-3" />
                      Stop
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Primary Active Download */}
      {primaryGroup && primaryStats && (
        <section className="anim anim-d1">
          <div className="relative overflow-hidden rounded-3xl border border-white/[.07] bg-card/70 shadow-2xl shadow-black/40 backdrop-blur-xl">
            {/* HERO BACKGROUND — prefer hero_image/splash for the big art so it's
                actually cinematic rather than a blurred capsule */}
            <div className="absolute inset-0">
              <img
                src={proxyImageUrl((primaryGame as any)?.hero_image || (primaryGame as any)?.localHeroImage || primaryGame?.splash || (primaryGame as any)?.localSplash || primaryGame?.image || (primaryGame as any)?.localImage || "./fallbacks/game-hero-16x9.svg")}
                alt=""
                className="h-full w-full object-cover opacity-50"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/20" />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-background/10" />
            </div>

            <div className="relative z-10 grid gap-6 p-6 lg:grid-cols-[1fr_280px] lg:p-8">
              {/* LEFT: identity + actions + progress + perf */}
              <div className="min-w-0 space-y-6">
                {/* Identity row */}
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                  {/* Capsule cover */}
                  <div className="relative h-32 w-24 flex-shrink-0 overflow-hidden rounded-xl border border-white/[.08] bg-card shadow-2xl shadow-black/50">
                    <img
                      src={proxyImageUrl(primaryGame?.image || (primaryGame as any)?.localImage || "./fallbacks/game-card-3x4.svg")}
                      alt={primaryGroup[0]?.gameName || "Download"}
                      className="h-full w-full object-cover"
                    />
                  </div>

                  <div className="min-w-0 flex-1 space-y-3">
                    {/* Logo if available, else fall back to the text title */}
                    {(primaryGame as any)?.hero_logo ? (
                      <div className="-mt-1">
                        <img
                          src={proxyImageUrl((primaryGame as any).hero_logo)}
                          alt={primaryGroup[0]?.gameName || ""}
                          className="h-16 max-w-[320px] object-contain object-left drop-shadow-[0_4px_18px_rgba(0,0,0,0.6)]"
                        />
                        <span className="sr-only">{primaryGroup[0]?.gameName}</span>
                      </div>
                    ) : (
                      <h2 className="text-2xl font-light tracking-tight text-white sm:text-3xl">
                        {primaryGroup[0]?.gameName || "Unknown"}
                      </h2>
                    )}

                    {/* Meta chips */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full border border-white/10 bg-card/70 px-2.5 py-0.5 text-[11px] font-medium text-foreground/80 backdrop-blur-sm">
                        {primaryStats?.phase === "queued" ? "Queued" :
                         primaryStats?.phase === "paused" ? "Paused" :
                         primaryStats?.phase === "verifying" ? "Verifying" :
                         primaryStats?.phase === "retrying" ? "Retrying" :
                         primaryStats?.phase === "installing" || primaryStats?.phase === "extracting" ? "Installing" :
                         "Downloading"}
                      </span>
                      {primaryGame?.version && (
                        <span className="rounded-full border border-white/10 bg-card/70 px-2.5 py-0.5 text-[11px] font-mono text-foreground/80 backdrop-blur-sm">
                          {primaryGame.version}
                        </span>
                      )}
                      {primaryGame?.size && (
                        <span className="rounded-full border border-white/10 bg-card/70 px-2.5 py-0.5 text-[11px] font-medium text-foreground/80 backdrop-blur-sm">
                          {primaryGame.size}
                        </span>
                      )}
                      {Array.isArray(primaryGame?.genres) && primaryGame.genres.slice(0, 2).map((g) => (
                        <span key={g} className="rounded-full border border-white/10 bg-card/70 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground backdrop-blur-sm">{g}</span>
                      ))}
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {primaryIsPaused ? (
                        <Button
                          onClick={() => primaryGroup && resumeGroup(primaryGroup[0]?.appid)}
                          className="gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:brightness-110 active:scale-95"
                        >
                          <Play className="h-4 w-4" />
                          Resume
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          onClick={() => primaryGroup && void pauseGroup(primaryGroup[0]?.appid)}
                          disabled={!primaryCanPause}
                          className="gap-2 rounded-full border-white/10 bg-card/60 px-5 text-sm font-medium text-foreground/90 backdrop-blur-sm hover:border-white/20 hover:bg-secondary/80 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                        >
                          <PauseCircle className="h-4 w-4" />
                          Pause
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        onClick={() => primaryGroup && cancelGroup(primaryGroup[0]?.appid)}
                        className="gap-2 rounded-full border-white/10 bg-card/60 px-5 text-sm font-medium text-muted-foreground backdrop-blur-sm hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400 active:scale-95"
                      >
                        <XCircle className="h-4 w-4" />
                        Cancel
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Progress */}
                <div className="space-y-2">
                  <div className="flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
                        {primaryStats?.phase === "queued" ? "Waiting in queue" :
                         primaryStats?.phase === "paused" ? "Paused — resume to continue" :
                         primaryStats?.phase === "verifying" ? "Verifying archive integrity" :
                         primaryStats?.phase === "retrying" ? "Repairing download" :
                         primaryStats?.phase === "installing" || primaryStats?.phase === "extracting" ? "Installing game data" :
                         "Downloading game data"}
                      </div>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="font-mono text-2xl font-light tabular-nums text-white">
                          {Math.round(primaryStats.progress)}<span className="text-muted-foreground/80">%</span>
                        </span>
                        {primaryStats.phase !== "installing" && primaryStats.phase !== "extracting" && (
                          <span className="font-mono text-sm tabular-nums text-muted-foreground/80">
                            {formatBytes(primaryStats.receivedBytes)} / {formatBytes(primaryStats.totalBytes)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">ETA</div>
                      <div className="font-mono text-base tabular-nums text-white">{formatEta(primaryStats.etaSeconds)}</div>
                    </div>
                  </div>
                  <Progress
                    value={primaryStats.progress}
                    className="h-2 overflow-hidden bg-secondary/70 [&_[data-slot=progress-indicator]]:bg-gradient-to-r [&_[data-slot=progress-indicator]]:from-zinc-200 [&_[data-slot=progress-indicator]]:to-white"
                  />
                </div>

                {/* Compact stats row */}
                <div className="grid grid-cols-4 gap-2 rounded-2xl border border-white/[.07] bg-card/40 px-3 py-3 backdrop-blur-sm">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">Speed</div>
                    <div className="mt-0.5 font-mono text-sm tabular-nums text-white">{formatSpeed(currentNetwork)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">Avg</div>
                    <div className="mt-0.5 font-mono text-sm tabular-nums text-foreground/80">{formatSpeed(averageSpeed)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">Peak</div>
                    <div className="mt-0.5 font-mono text-sm tabular-nums text-foreground/80">{formatSpeed(peakNetworkSpeed)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">Disk</div>
                    <div className="mt-0.5 font-mono text-sm tabular-nums text-foreground/80">{formatSpeed(currentDisk)}</div>
                  </div>
                </div>

                {/* Steam-style throughput chart — bars + line on a shared scale */}
                <div className="rounded-2xl border border-white/[.07] bg-black/30 px-4 py-3 backdrop-blur-sm">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">Throughput</span>
                    <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-sm bg-gradient-to-b from-green-500 to-green-700" />
                        Network
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-[2px] w-3 rounded-full bg-amber-400" />
                        Disk I/O
                      </span>
                    </div>
                  </div>
                  <div className="relative">
                    <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio="none" className="h-20 w-full">
                      <ChartGradients />
                      {/* Soft glow behind the bars to lift them off the background */}
                      {networkHistory.length > 0 && (() => {
                        const sharedMax = Math.max(...networkHistory, ...diskHistory, 1)
                        return (
                          <>
                            {renderBars(networkHistory, "url(#netGradient)", sharedMax)}
                            {renderLine(diskHistory, "#fbbf24", sharedMax)}
                          </>
                        )
                      })()}
                      {networkHistory.length === 0 && (
                        <line x1="0" y1={CHART_HEIGHT - 1} x2={CHART_WIDTH} y2={CHART_HEIGHT - 1} stroke="rgb(63 63 70)" strokeWidth="1" />
                      )}
                    </svg>
                    {/* Bottom rule */}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-secondary/80" />
                  </div>
                </div>
              </div>

              {/* RIGHT: screenshots strip — the second-most "art-rich" piece of
                  catalog data, finally surfaced. Stacks under the main column
                  on smaller screens. */}
              {Array.isArray((primaryGame as any)?.screenshots) && (primaryGame as any).screenshots.length > 0 && (
                <div className="hidden lg:block">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">Screenshots</span>
                    <span className="font-mono text-[10px] text-muted-foreground/60">{Math.min((primaryGame as any).screenshots.length, 4)} of {(primaryGame as any).screenshots.length}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(primaryGame as any).screenshots.slice(0, 4).map((shot: string, i: number) => (
                      <div key={i} className="relative aspect-video overflow-hidden rounded-lg border border-white/[.06] bg-card">
                        <img
                          src={proxyImageUrl(shot)}
                          alt={`Screenshot ${i + 1}`}
                          className="h-full w-full object-cover opacity-90 transition-opacity hover:opacity-100"
                          loading="lazy"
                        />
                      </div>
                    ))}
                  </div>
                  {primaryGame?.developer && (
                    <div className="mt-3 rounded-xl border border-white/[.06] bg-card/40 px-3 py-2 text-xs text-muted-foreground backdrop-blur-sm">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">Developer</div>
                      <div className="mt-0.5 truncate text-foreground/90">{primaryGame.developer}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {secondaryActiveGroups.length > 0 && (
        <section className="space-y-3 anim anim-d2">
          <div className="flex items-center gap-3">
            <p className="section-label">Also Running</p>
            <Badge variant="secondary" className="rounded-full bg-secondary/80 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {secondaryActiveGroups.length}
            </Badge>
          </div>

          <div className="space-y-2.5">
            {secondaryActiveGroups.map((items) => {
              const { totalBytes, receivedBytes, speedBps, etaSeconds, progress, phase, extractionProgress } = computeGroupStats(items)
              const totalParts = getTotalParts(items)
              const gameName = items[0]?.gameName || "Unknown"
              const appid = items[0]?.appid
              const game = appid ? games.find((g) => g.appid === appid) : null
              const canPause = groupCanPause(items)
              const isPausedGroup = groupIsPaused(items, phase)
              const groupStatus = phase === "installing"
                ? "Installing"
                : phase === "extracting"
                  ? "Extracting"
                  : phase === "paused"
                    ? "Paused"
                    : phase === "verifying"
                      ? "Verifying"
                      : phase === "retrying"
                        ? "Retrying"
                        : "Downloading"
              const statusTone = phase === "paused" ? "text-amber-300 bg-amber-500/10 border-amber-500/20"
                : phase === "installing" || phase === "extracting" ? "text-sky-300 bg-sky-500/10 border-sky-500/20"
                : "text-foreground/80 bg-white/[.06] border-white/10"

              return (
                <div
                  key={`active-${items[0].appid}-${gameName}`}
                  className="group relative overflow-hidden rounded-2xl border border-white/[.07] bg-card/70 backdrop-blur-md transition-all hover:border-white/[.14]"
                >
                  {/* Subtle hero art in the background of each row */}
                  <div className="absolute inset-0 opacity-25">
                    <img
                      src={proxyImageUrl((game as any)?.hero_image || (game as any)?.localHeroImage || game?.splash || (game as any)?.localSplash || game?.image || (game as any)?.localImage || "./fallbacks/game-hero-16x9.svg")}
                      alt=""
                      className="h-full w-full object-cover blur-[2px]"
                    />
                    <div className="absolute inset-0 bg-gradient-to-r from-card via-card/85 to-card/40" />
                  </div>

                  <div className="relative flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
                    <div className="flex items-center gap-4 sm:w-[280px]">
                      <div className="relative h-14 w-24 flex-shrink-0 overflow-hidden rounded-lg border border-white/[.07] bg-secondary shadow-md shadow-black/40">
                        <img
                          src={downloadItemImageSrc(game)}
                          alt={gameName}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-white">{gameName}</h3>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className={`rounded-full border px-2 py-0.5 font-medium ${statusTone}`}>{groupStatus}</span>
                          {game?.version && (
                            <span className="rounded bg-white/[.04] px-1.5 py-0.5 font-mono text-muted-foreground">{game.version}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex-1 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground/80">
                          {phase === "installing" || phase === "extracting"
                            ? extractionProgress != null
                              ? `Installing game data... ${Math.round(extractionProgress)}%`
                              : "Installing game data..."
                            : phase === "verifying"
                              ? "Verifying archive integrity..."
                              : phase === "retrying"
                                ? "Repairing download..."
                                : phase === "paused"
                                  ? "Download paused"
                                  : "Downloading..."}
                        </span>
                        <span className="font-mono text-muted-foreground">
                          {phase === "installing" || phase === "extracting"
                            ? `${Math.round(progress)}%`
                            : `${formatBytes(receivedBytes)} / ${formatBytes(totalBytes)}`}
                        </span>
                      </div>
                      <Progress value={progress} className="h-1.5 bg-secondary" />
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground/80">
                        <span>ETA: {formatEta(etaSeconds)}</span>
                        <span className="inline-flex items-center gap-1.5">
                          {/* Show a "Capped" pill when the user has a
                              bandwidth limit set AND the current row is
                              within 15% of it — confirms the limit is
                              actually biting rather than just configured.
                              `phase === "downloading"` keeps us from
                              advertising a cap on extracting / installing
                              rows where speedBps is unrelated. */}
                          {bandwidthLimitBps > 0
                            && phase === "downloading"
                            && speedBps > 0
                            && speedBps >= bandwidthLimitBps * 0.85
                            && (
                              <span
                                className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/[.08] px-1.5 py-0.5 text-[9px] font-semibold text-amber-200"
                                title={`Bandwidth cap: ${(bandwidthLimitKBps / 1024).toFixed(bandwidthLimitKBps >= 10240 ? 0 : 1)} MB/s. Change it in Settings → Downloads.`}
                              >
                                Capped
                              </span>
                            )}
                          <span>{formatSpeed(speedBps)}</span>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {appid && (isPausedGroup ? (
                        <Button
                          size="sm"
                          onClick={() => void resumeGroup(appid)}
                          className="rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground hover:brightness-110 active:scale-95"
                        >
                          <Play className="mr-1.5 h-3.5 w-3.5" />
                          Resume
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void pauseGroup(appid)}
                          disabled={!canPause}
                          className="rounded-full px-3 text-xs text-muted-foreground hover:bg-secondary hover:text-white disabled:pointer-events-none disabled:opacity-50"
                        >
                          <PauseCircle className="mr-1.5 h-3.5 w-3.5" />
                          Pause
                        </Button>
                      ))}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => cancelGroup(items[0]?.appid)}
                        className="rounded-full px-3 text-xs text-muted-foreground/80 hover:bg-red-500/10 hover:text-red-400"
                      >
                        <XCircle className="mr-1.5 h-3.5 w-3.5" />
                        Cancel
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Queue Section */}
      {queuedGroups.length > 0 && (
      <section className="space-y-3 anim anim-d2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <p className="section-label">Up Next</p>
            <Badge variant="secondary" className="rounded-full bg-secondary/80 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {queuedGroups.length}
            </Badge>
          </div>
        </div>

        <div className="space-y-2.5">
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
                className="group overflow-hidden rounded-2xl border border-white/[.07] bg-card/60 backdrop-blur-sm transition-all hover:border-border"
              >
                <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
                  {/* Game Info */}
                  <div className="flex items-center gap-4 sm:w-[280px]">
                    <div className="relative h-14 w-24 flex-shrink-0 overflow-hidden rounded-lg border border-white/[.07] bg-secondary">
                      <img
                        src={downloadItemImageSrc(game)}
                        alt={gameName}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-white">{gameName}</h3>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground/80">
                        {game?.version && (
                          <span className="rounded bg-secondary/80 px-1.5 py-0.5 font-mono">{game.version}</span>
                        )}
                        <span className={`rounded px-1.5 py-0.5 ${
                          groupStatus === "Paused" 
                            ? "bg-amber-500/10 text-amber-400" 
                            : "bg-secondary/80 text-muted-foreground"
                        }`}>
                          {groupStatus}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Progress */}
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground/80">
                        {queuedOnly
                          ? "Waiting in queue..."
                          : phase === "installing"
                            ? "Installing..."
                            : phase === "extracting"
                              ? "Extracting..."
                              : "Downloading..."}
                      </span>
                      <span className="font-mono text-muted-foreground">
                        {formatBytes(receivedBytes)} / {formatBytes(totalBytes)}
                      </span>
                    </div>
                    <Progress value={progress} className="h-1.5 bg-secondary" />
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground/80">
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
                      className="rounded-full px-3 text-xs text-muted-foreground/80 hover:bg-red-500/10 hover:text-red-400"
                    >
                      <XCircle className="mr-1.5 h-3.5 w-3.5" />
                      Cancel
                    </Button>
                  </div>
                </div>

                {/* Footer */}
                <div className="border-t border-white/[.05] bg-card/40 px-4 py-2">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground/60">
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
      )}

      {/* Install Ready Section */}
      {installReadyGroups.length > 0 && (
      <section className="space-y-3 anim anim-d3">
        <div className="flex items-center gap-3">
          <p className="section-label">Ready to Install</p>
          <Badge variant="secondary" className="rounded-full bg-sky-500/10 px-2.5 py-0.5 text-[11px] font-medium text-sky-300 ring-1 ring-sky-500/20">
            {installReadyGroups.length}
          </Badge>
        </div>

        <div className="space-y-2.5">
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
                    <div className="relative h-14 w-24 flex-shrink-0 overflow-hidden rounded-lg border border-white/[.07] bg-secondary">
                      <img
                        src={downloadItemImageSrc(game)}
                        alt={gameName}
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute bottom-1 right-1 rounded bg-blue-500/90 px-1.5 py-0.5 text-[9px] font-bold text-white">
                        READY
                      </div>
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-white">{gameName}</h3>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground/80">
                        {game?.version && (
                          <span className="rounded bg-secondary/80 px-1.5 py-0.5 font-mono">{game.version}</span>
                        )}
                        <span className="text-muted-foreground/60">•</span>
                        <span>{readyAt ? new Date(readyAt).toLocaleDateString() : "Ready"}</span>
                      </div>
                      <p className="mt-1.5 max-w-md text-[11px] text-muted-foreground/80">{readyNote}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        void handleInstallReady(appid)
                      }}
                      disabled={!appid || installingAppId === appid}
                      className="gap-2 rounded-full bg-primary px-4 text-xs font-medium text-primary-foreground hover:brightness-110 active:scale-95 disabled:opacity-50"
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
                      className="rounded-full border-border px-4 text-xs text-muted-foreground hover:border-zinc-500 hover:text-white active:scale-95"
                    >
                      View
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (appid) {
                          void dismissByAppid(appid)
                        }
                      }}
                      className="rounded-full px-3 text-xs text-muted-foreground/80 hover:bg-secondary hover:text-foreground/80"
                    >
                      Remove
                    </Button>
                  </div>
                </div>

                <div className="border-t border-white/[.05] bg-card/40 px-4 py-2">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground/60">
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
      )}

      {/* Completed Section */}
      {completedGroups.length > 0 && (
      <section className="space-y-3 anim anim-d4">
        <div className="flex items-center gap-3">
          <p className="section-label">Recently Installed</p>
          <Badge variant="secondary" className="rounded-full bg-green-500/10 px-2.5 py-0.5 text-[11px] font-medium text-green-400 ring-1 ring-green-500/20">
            {completedGroups.length}
          </Badge>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {completedGroups.map((items) => {
            const gameName = items[0]?.gameName || "Unknown"
            const appid = items[0]?.appid
            const game = appid ? games.find((g) => g.appid === appid) : null
            const finishedAt = items
              .map((item) => item.completedAt || 0)
              .sort((a, b) => b - a)[0]
            // Hero art for the card background — falls back through every
            // available asset before landing on the bundled placeholder.
            const heroSrc = proxyImageUrl(
              (game as any)?.hero_image ||
              (game as any)?.localHeroImage ||
              game?.splash ||
              (game as any)?.localSplash ||
              game?.image ||
              (game as any)?.localImage ||
              "./fallbacks/game-hero-16x9.svg"
            )
            const logoSrc = (game as any)?.hero_logo ? proxyImageUrl((game as any).hero_logo) : null

            return (
              <div
                key={`completed-${items[0].appid}-${gameName}`}
                className="group relative cursor-pointer overflow-hidden rounded-2xl border border-white/[.07] bg-card shadow-xl shadow-black/40 transition-all hover:border-green-500/40 hover:shadow-green-500/10"
                onClick={() => {
                  if (appid) navigate(`/game/${appid}`)
                }}
              >
                {/* Hero art background */}
                <div className="relative aspect-[16/7] overflow-hidden">
                  <img
                    src={heroSrc}
                    alt={gameName}
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  {/* Dark gradient overlay so foreground UI stays legible */}
                  <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-background/10" />
                  <div className="absolute inset-0 bg-gradient-to-r from-background/70 via-transparent to-transparent" />

                  {/* Installed badge top-right */}
                  <div className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/15 px-2.5 py-1 text-[10px] font-semibold text-green-300 backdrop-blur-sm">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                    Installed
                  </div>

                  {/* Logo / title bottom-left */}
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    {logoSrc ? (
                      <img
                        src={logoSrc}
                        alt={gameName}
                        className="h-12 max-w-[220px] object-contain object-left drop-shadow-[0_3px_10px_rgba(0,0,0,0.7)]"
                      />
                    ) : (
                      <h3 className="truncate text-lg font-semibold text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.7)]">
                        {gameName}
                      </h3>
                    )}
                  </div>
                </div>

                {/* Footer with action */}
                <div className="flex items-center justify-between gap-3 border-t border-white/[.05] bg-background/80 px-4 py-3 backdrop-blur-sm">
                  <div className="min-w-0 space-y-0.5">
                    {logoSrc && (
                      // When the logo is shown above, repeat the name in the
                      // footer as a small label so the card is still
                      // identifiable by text.
                      <p className="truncate text-xs font-medium text-foreground/80">{gameName}</p>
                    )}
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/80">
                      {game?.version && (
                        <span className="rounded bg-secondary/80 px-1.5 py-0.5 font-mono text-[10px]">{game.version}</span>
                      )}
                      <span className="text-muted-foreground/40">•</span>
                      <span>{finishedAt ? new Date(finishedAt).toLocaleDateString() : "Completed"}</span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation()
                      if (appid) {
                        void handleLaunch(appid, gameName, items[0]?.savePath)
                      }
                    }}
                    className="gap-2 rounded-full bg-primary px-5 text-xs font-semibold text-primary-foreground hover:brightness-110 active:scale-95"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    Play
                  </Button>
                </div>

                {/* Comment ribbon if the catalog has a note */}
                {game?.comment && (
                  <div className="border-t border-amber-500/20 bg-amber-500/[0.06] px-4 py-2 text-[11px] text-amber-300/90">
                    <strong className="text-amber-200">Note:</strong>
                    <CommentMarkdown text={game.comment} className="ml-1 inline text-[11px] text-amber-200/90" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>
      )}

      {/* Cancelled / Failed Section */}
      {cancelledGroups.length > 0 && (
        <section className="space-y-3 anim anim-d5">
          <div className="flex items-center gap-3">
            <p className="section-label">Failed / Cancelled</p>
            <Badge variant="secondary" className="rounded-full bg-red-500/10 px-2.5 py-0.5 text-[11px] font-medium text-red-400 ring-1 ring-red-500/20">
              {cancelledGroups.length}
            </Badge>
          </div>

          <div className="space-y-2.5">
            {cancelledGroups.map((items) => {
              const gameName = items[0]?.gameName || "Unknown"
              const appid = items[0]?.appid
              const game = appid ? games.find((g) => g.appid === appid) : null
              const status = items[0]?.status || "cancelled"
              const statusLabel = status === "cancelled" ? "Cancelled" : status === "extract_failed" ? "Extract Failed" : "Failed"
              const errorMsg = items[0]?.error || null

              return (
                <div
                  key={`cancelled-${items[0].appid}-${gameName}`}
                  className="group relative overflow-hidden rounded-2xl border border-red-500/15 bg-card/60 backdrop-blur-sm transition-all hover:border-red-500/30 hover:bg-card/80"
                >
                  {/* Desaturated hero art */}
                  <div className="absolute inset-0 opacity-20 grayscale">
                    <img
                      src={proxyImageUrl((game as any)?.hero_image || (game as any)?.localHeroImage || game?.splash || (game as any)?.localSplash || game?.image || (game as any)?.localImage || "./fallbacks/game-hero-16x9.svg")}
                      alt=""
                      className="h-full w-full object-cover blur-[2px]"
                    />
                    <div className="absolute inset-0 bg-gradient-to-r from-card via-card/90 to-card/50" />
                  </div>

                  <div className="relative flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-4">
                      <div className="relative h-14 w-24 flex-shrink-0 overflow-hidden rounded-lg border border-white/[.07] bg-secondary">
                        <img
                          src={downloadItemImageSrc(game)}
                          alt={gameName}
                          className="h-full w-full object-cover grayscale opacity-60"
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                          <XCircle className="h-6 w-6 text-red-400" />
                        </div>
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-foreground/90">{gameName}</h3>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 font-medium text-red-300">{statusLabel}</span>
                          {game?.version && (
                            <span className="rounded bg-white/[.04] px-1.5 py-0.5 font-mono text-muted-foreground/80">{game.version}</span>
                          )}
                        </div>
                        {errorMsg && (
                          <p className="mt-2 max-w-md truncate text-[11px] text-red-300/70" title={errorMsg}>
                            {errorMsg}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => { void handleRetry(appid) }}
                        disabled={retryingAppId === appid}
                        className="gap-2 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground hover:brightness-110 active:scale-95 disabled:opacity-50"
                      >
                        {retryingAppId === appid ? "Retrying..." : "Retry"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { if (appid) void dismissByAppid(appid) }}
                        className="rounded-full px-3 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {spacePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/72 backdrop-blur-md" onClick={() => !switchingDrive && setSpacePrompt(null)} />
          <div className="relative w-full max-w-lg rounded-3xl border border-white/[.07] bg-background/88 backdrop-blur-2xl p-5 shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-red-500/10 p-2 text-red-400">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-semibold text-white">Not enough free space</h3>
                <p className="text-sm text-muted-foreground">
                  {spacePrompt.gameName || "This game"} cannot be extracted on the current install drive yet.
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-foreground/90">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Required free space</span>
                <span className="font-mono">{formatBytes(spacePrompt.spaceCheck.requiredBytes)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-muted-foreground">Available now</span>
                <span className="font-mono">{formatBytes(spacePrompt.spaceCheck.freeBytes)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-muted-foreground">Shortfall</span>
                <span className="font-mono text-red-300">{formatBytes(spacePrompt.spaceCheck.shortfallBytes)}</span>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <label className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground/80">Install drive</label>
              <Select value={selectedSpaceDriveId} onValueChange={setSelectedSpaceDriveId}>
                <SelectTrigger className="border-white/[.08] bg-card text-foreground">
                  <SelectValue placeholder="Choose a drive" />
                </SelectTrigger>
                <SelectContent>
                  {spacePrompt.spaceCheck.drives.map((drive: DiskInfo) => (
                    <SelectItem key={drive.id} value={drive.id}>
                      {drive.name} • {formatBytes(drive.freeBytes)} free
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground/80">Choose a drive with enough free space, or free space on the current one and retry.</p>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={() => setSpacePrompt(null)} disabled={switchingDrive}>Close</Button>
              <Button variant="outline" onClick={handlePickInstallFolder} disabled={switchingDrive} className="border-white/[.08] text-foreground/90">
                Choose Folder
              </Button>
              <Button onClick={handleSwitchInstallDrive} disabled={switchingDrive || !selectedSpaceDriveId} className="bg-primary text-primary-foreground hover:brightness-110">
                {switchingDrive ? "Switching..." : "Switch Drive And Retry"}
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
        gameName={exePickerGameName || undefined}
        baseFolder={exePickerFolder}
        onSelect={handleExePicked}
        onClose={() => setExePickerOpen(false)}
      />
      <DesktopShortcutModal
        open={shortcutModalOpen}
        gameName={games.find((g) => g.appid === pendingAppId)?.name || "Game"}
        defaultAlwaysCreate={shortcutModalAlwaysCreate}
        onCreateShortcut={async (alwaysCreate) => {
          if (alwaysCreate) {
            await setAlwaysCreateShortcut(true)
          }
          if (pendingExePath && pendingAppId) {
            await createDesktopShortcut(pendingAppId, pendingExePath)
            await setShortcutAskedForGame(pendingAppId)
            await launchGame(pendingAppId, pendingExePath)
          }
        }}
        onSkip={async (alwaysCreate) => {
          if (alwaysCreate) {
            await setAlwaysCreateShortcut(true)
          }
          if (pendingAppId) {
            await setShortcutAskedForGame(pendingAppId)
          }
          if (pendingExePath && pendingAppId) {
            await launchGame(pendingAppId, pendingExePath)
          }
        }}
        onClose={async (alwaysCreate) => {
          if (alwaysCreate) {
            await setAlwaysCreateShortcut(true)
          }
          if (pendingAppId) {
            await setShortcutAskedForGame(pendingAppId)
          }
          setShortcutModalOpen(false)
          setPendingExePath(null)
          setPendingAppId(null)
          setShortcutModalAlwaysCreate(false)
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



