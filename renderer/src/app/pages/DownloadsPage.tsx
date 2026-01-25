import { useEffect, useMemo, useRef, useState } from "react"
import { useDownloads } from "@/context/downloads-context"
import { useNavigate } from "react-router-dom"
import { useGamesData } from "@/hooks/use-games"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { pickGameExecutable, proxyImageUrl } from "@/lib/utils"
import { Download, PauseCircle, Play, XCircle, Square } from "lucide-react"
import { ExePickerModal } from "@/components/ExePickerModal"
import { AdminPromptModal } from "@/components/AdminPromptModal"
import { DesktopShortcutModal } from "@/components/DesktopShortcutModal"
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
    filename?: string
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
  const downloadingItems = items.filter((item) => item.status === "downloading" || item.status === "paused")
  const queuedItems = items.filter((item) => item.status === "queued")
  const queuedOnly = items.every((item) => item.status === "queued")
  const pausedOnly = items.every((item) => item.status === "paused")
  const activeItems = installingItems.length
    ? installingItems
    : extractingItems.length
      ? extractingItems
      : downloadingItems.length
        ? downloadingItems
        : items

  const primaryItem =
    downloadingItems[0] ||
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
  const [networkHistory, setNetworkHistory] = useState<number[]>([])
  const [diskHistory, setDiskHistory] = useState<number[]>([])
  const [peakSpeed, setPeakSpeed] = useState(0)
  const [exePickerOpen, setExePickerOpen] = useState(false)
  const [exePickerTitle, setExePickerTitle] = useState("")
  const [exePickerMessage, setExePickerMessage] = useState("")
  const [exePickerAppId, setExePickerAppId] = useState<string | null>(null)
  const [exePickerExes, setExePickerExes] = useState<Array<{ name: string; path: string }>>([])
  const [retryingAppId, setRetryingAppId] = useState<string | null>(null)
  const [runningGames, setRunningGames] = useState<Array<{ appid: string; gameName: string; pid: number }>>([])
  const [adminPromptOpen, setAdminPromptOpen] = useState(false)
  const [pendingExePath, setPendingExePath] = useState<string | null>(null)
  const [pendingAppId, setPendingAppId] = useState<string | null>(null);
  const [shortcutModalOpen, setShortcutModalOpen] = useState(false)
  const primaryStatsRef = useRef<{
    totalBytes: number
    receivedBytes: number
    speedBps: number
    etaSeconds: number | null
    progress: number
  } | null>(null)
  const lastSampleRef = useRef<{ time: number; received: number } | null>(null)
  const startTimeRef = useRef<number | null>(null)

  const grouped = useMemo(() => {
    return downloads.reduce<Record<string, typeof downloads>>((acc, item) => {
      acc[item.appid] = acc[item.appid] || []
      acc[item.appid].push(item)
      return acc
    }, {})
  }, [downloads])

  const activeGroups = Object.values(grouped).filter((items) => {
    const hasActive = items.some((item) => ["downloading", "paused", "extracting", "installing"].includes(item.status))
    const hasCompletedAndQueued = items.some((item) => ["completed", "extracted"].includes(item.status)) && items.some((item) => item.status === "queued")
    return hasActive || hasCompletedAndQueued
  })
  const queuedGroups = Object.values(grouped).filter((items) =>
    items.every((item) => item.status === "queued")
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
      lastSampleRef.current = null
      startTimeRef.current = null
      return
    }

    setNetworkHistory([])
    setDiskHistory([])
    setPeakSpeed(0)
    lastSampleRef.current = { time: Date.now(), received: primaryStats.receivedBytes }
    startTimeRef.current = Date.now()

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
      setNetworkHistory((prev) => [...prev, networkSpeed].slice(-60))
      setDiskHistory((prev) => [...prev, diskSpeed].slice(-60))
      setPeakSpeed((prev) => Math.max(prev, networkSpeed))
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
  // show disk speed in the main 'Current' box when installing (extraction)
  const currentShown = primaryIsInstalling ? currentDisk : currentNetwork
  const averageSpeed = useMemo(() => {
    if (!primaryStats || !startTimeRef.current) return 0
    const elapsed = Math.max(1, (Date.now() - startTimeRef.current) / 1000)
    return primaryStats.receivedBytes / elapsed
  }, [primaryStats, networkHistory.length])

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

  const openExePicker = (appid: string, gameName: string, exes: Array<{ name: string; path: string }>, message?: string) => {
    setExePickerTitle("Select executable")
    setExePickerMessage(message || `We couldn't confidently detect the correct exe for "${gameName}". Please choose the one to launch.`)
    setExePickerAppId(appid)
    setExePickerExes(exes)
    setExePickerOpen(true)
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

  const launchGame = async (appid: string, path: string, asAdmin: boolean = false) => {
    if (!window.ucDownloads) return
    const launchFn = asAdmin && isWindows
      ? window.ucDownloads.launchGameExecutableAsAdmin 
      : window.ucDownloads.launchGameExecutable
    
    if (!launchFn) return
    const res = await launchFn(appid, path)
    if (res && res.ok) {
      await setSavedExe(appid, path)
      setExePickerOpen(false)
      setAdminPromptOpen(false)
      setShortcutModalOpen(false)
      setPendingExePath(null)
      setPendingAppId(null)
    }
  }

  const handleAdminDecision = async (appid: string, path: string, asAdmin: boolean) => {
    if (!isWindows) {
      await launchGame(appid, path, false)
      return
    }
    await setAdminPromptShown()
    
    // Check if we should show shortcut modal BEFORE launching
    const alreadyAsked = await getShortcutAskedForGame(appid)
    const alwaysCreate = await getAlwaysCreateShortcut()
    
    if (alwaysCreate && !alreadyAsked) {
      // Auto-create shortcut without asking, then launch
      await createDesktopShortcut(appid, path)
      await setShortcutAskedForGame(appid)
      await launchGame(appid, path, asAdmin)
    } else if (!alreadyAsked && !alwaysCreate) {
      // Show the shortcut prompt BEFORE launching
      setPendingExePath(path)
      setPendingAppId(appid)
      setAdminPromptOpen(false)
      setShortcutModalOpen(true)
      // Store asAdmin preference for later
      await window.ucSettings?.set?.('runGamesAsAdmin', asAdmin)
    } else {
      // No shortcut needed, just launch
      await launchGame(appid, path, asAdmin)
    }
  }

  const handleExePicked = async (path: string) => {
    if (!exePickerAppId) return
    setPendingExePath(path)
    setPendingAppId(exePickerAppId)
    const promptShown = await getAdminPromptShown()
    const runAsAdminEnabled = await getRunAsAdminEnabled()
    
    if (!promptShown) {
      if (isWindows) {
        setAdminPromptOpen(true)
      } else {
        await launchGame(exePickerAppId, path, false)
      }
      setExePickerOpen(false)
    } else {
      await launchGame(exePickerAppId, path, runAsAdminEnabled)
    }
  }

  const handleLaunch = async (appid: string, gameName: string, fallbackPath?: string) => {
    if (!appid) return
    if (!window.ucDownloads?.listGameExecutables || !window.ucDownloads?.launchGameExecutable) {
      if (fallbackPath) openPath(fallbackPath)
      return
    }
    try {
      const savedExe = await getSavedExe(appid)
      const runAsAdminEnabled = await getRunAsAdminEnabled()
      
      if (savedExe) {
        await launchGame(appid, savedExe, runAsAdminEnabled)
        return
      }
      
      const result = await window.ucDownloads.listGameExecutables(appid)
      const exes = result?.exes || []
      const { pick, confident } = pickGameExecutable(exes, gameName)
      if (pick && confident) {
        setPendingExePath(pick.path)
        setPendingAppId(appid)
        const promptShown = await getAdminPromptShown()
        
        if (!promptShown) {
          if (isWindows) {
            setAdminPromptOpen(true)
          } else {
            await launchGame(appid, pick.path, false)
          }
        } else {
          await launchGame(appid, pick.path, runAsAdminEnabled)
        }
        return
      }
      openExePicker(appid, gameName, exes)
    } catch {
      openExePicker(appid, gameName, [], `Unable to list executables for "${gameName}".`)
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black font-montserrat">Activity</h1>
          <p className="text-sm text-muted-foreground">Track downloads, installs, and completed titles.</p>
        </div>
        <Button variant="outline" onClick={clearCompleted}>
          Clear
        </Button>
      </div>

      {runningGames.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-bold font-montserrat">Running Games</h2>
          <div className="space-y-3">
            {runningGames.map((game) => (
              <div
                key={game.appid}
                className="flex items-center justify-between rounded-xl border border-border/60 bg-card/60 p-4 transition-all hover:bg-card"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/20">
                    <Play className="h-5 w-5 text-green-500" />
                  </div>
                  <div>
                    <div className="font-semibold">{game.gameName}</div>
                    <div className="text-xs text-muted-foreground">Running • PID: {game.pid}</div>
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleQuitGame(game.appid)}
                  className="gap-2"
                >
                  <Square className="h-4 w-4" />
                  Quit
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {primaryGroup && primaryStats && (
        <section>
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-950/95 to-slate-900/90 shadow-lg shadow-black/20">
            <div className="absolute inset-0">
              {primaryGame?.image && (
                <img
                  src={proxyImageUrl(primaryGame.image)}
                  alt={primaryGroup[0]?.gameName || "Download"}
                  className="h-full w-full scale-110 object-cover opacity-45 blur-2xl saturate-90"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-br from-slate-950/75 via-slate-950/85 to-slate-900/80" />
            </div>
            <div className="relative z-10 space-y-6 p-6 lg:p-8">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {primaryStats?.phase === "queued"
                        ? "Queued"
                        : primaryStats?.phase === "paused"
                          ? "Paused"
                          : primaryStats?.phase === "installing"
                            ? "Now installing"
                            : primaryStats?.phase === "extracting"
                              ? "Now extracting"
                              : "Now downloading"}
                    </p>
                    <div className="flex items-center gap-3">
                      {primaryGame?.image && (
                        <div className="h-10 w-16 overflow-hidden rounded-md border border-white/10 bg-slate-900/60">
                          <img
                            src={proxyImageUrl(primaryGame.image)}
                            alt={primaryGroup[0]?.gameName || "Download"}
                            className="h-full w-full object-cover"
                          />
                        </div>
                      )}
                      <h2 className="text-2xl sm:text-3xl font-black font-montserrat">
                        {primaryGroup[0]?.gameName || "Unknown"}
                      </h2>
                    </div>
                    {primaryTotalParts > 1 && (
                      <div className="text-xs text-muted-foreground">
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
                    <div className="flex flex-wrap gap-6 text-xs text-muted-foreground">
                      <div>
                        <div className="text-foreground font-semibold">ETA</div>
                      <div>{formatEta(primaryStats.etaSeconds)}</div>
                    </div>
                    <div>
                      <div className="text-foreground font-semibold">{primaryTotalParts > 1 ? "Parts" : "File"}</div>
                      <div>{primaryTotalParts}</div>
                    </div>
                    <div>
                      <div className="text-foreground font-semibold">Average speed</div>
                      <div>{formatSpeed(averageSpeed)}</div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  {primaryIsPaused ? (
                    <Button variant="outline" onClick={() => primaryGroup && resumeGroup(primaryGroup[0]?.appid)} className="justify-center gap-2">
                      <Play className="h-4 w-4" />
                      Resume
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={() => primaryGroup && primaryGroup.forEach((it) => pauseDownload(it.id))} className="justify-center gap-2">
                      <PauseCircle className="h-4 w-4" />
                      Pause
                    </Button>
                  )}

                  <Button
                    variant="outline"
                    onClick={() => primaryGroup && cancelGroup(primaryGroup[0]?.appid)}
                    className="justify-center gap-2"
                  >
                    <XCircle className="h-4 w-4" />
                    Cancel
                  </Button>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {(() => {
                      const part = getPartIndex(
                        primaryStats.primaryPartFilename || "",
                        0,
                        primaryTotalParts,
                        primaryStats.primaryPartIndex
                      ).partNum
                      if (primaryStats?.phase === "queued") {
                        return "Queued"
                      }
                      if (primaryStats?.phase === "paused") {
                        return "Paused"
                      }
                      if (primaryStats?.phase === "installing" || primaryStats?.phase === "extracting") {
                        return primaryTotalParts > 1 ? `Installing part ${part} of ${primaryTotalParts}` : "Installing data"
                      }
                      return "Downloading data"
                    })()}
                  </span>
                  <span>
                    {formatBytes(primaryStats.receivedBytes)} / {formatBytes(primaryStats.totalBytes)}
                  </span>
                </div>
                <Progress
                  value={primaryStats.progress}
                  className="h-2 bg-slate-800/90 [&_[data-slot=progress-indicator]]:bg-primary/80"
                />
                {primaryStats.phase !== "downloading" && primaryStats.overallTotalBytes > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Downloaded {formatBytes(primaryStats.overallReceivedBytes)} / {formatBytes(primaryStats.overallTotalBytes)}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">Performance</span>
                  <div className="flex items-center gap-4">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-sky-400" />
                      Network
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-400" />
                      Disk
                    </span>
                  </div>
                </div>
                <svg viewBox="0 0 600 70" className="mt-3 h-20 w-full">
                  {renderBars(networkHistory, "rgb(56 189 248)")}
                  {renderLine(diskHistory, "rgb(52 211 153)")}
                </svg>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
                  <div className="text-xs text-muted-foreground">Current</div>
                  <div className="text-lg font-semibold text-foreground">{formatSpeed(currentShown)}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
                  <div className="text-xs text-muted-foreground">Peak</div>
                  <div className="text-lg font-semibold text-foreground">{formatSpeed(peakSpeed)}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
                  <div className="text-xs text-muted-foreground">Total</div>
                  <div className="text-lg font-semibold text-foreground">{formatBytes(primaryStats.receivedBytes)}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
                  <div className="text-xs text-muted-foreground">Disk usage</div>
                  <div className="text-lg font-semibold text-foreground">{formatSpeed(currentDisk)}</div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Download className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-black font-montserrat">Queue</h2>
          <Badge variant="secondary" className="rounded-full">
            {queuedGroups.length}
          </Badge>
        </div>

        {queuedGroups.length === 0 && (
          <div className="rounded-2xl border border-border/60 bg-card/60 p-6 text-sm text-muted-foreground">
            Queue is empty. Start a download from any game page.
          </div>
        )}

        <div className="space-y-4">
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
                className="rounded-xl border border-border/60 bg-gradient-to-b from-slate-950/70 via-slate-950/50 to-slate-900/40 shadow-lg shadow-black/20"
              >
                <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-4 sm:w-[320px]">
                    <div className="h-14 w-24 overflow-hidden rounded-md border border-border/50 bg-muted">
                      {game?.image ? (
                        <img
                          src={proxyImageUrl(game.image)}
                          alt={gameName}
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{groupStatus}</div>
                      <h3 className="truncate text-base font-semibold">{gameName}</h3>
                      <div className="text-xs text-muted-foreground">
                        {totalParts} {getPartsLabel(items)}
                        {overallTotalBytes > 0 && (
                          <span>
                            {" "}- {formatBytes(overallReceivedBytes)} / {formatBytes(overallTotalBytes)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {queuedOnly
                          ? "Queued"
                          : phase === "installing"
                            ? "Installing data"
                            : phase === "extracting"
                              ? "Extracting data"
                              : "Downloading data"}
                      </span>
                      <span>
                        {formatBytes(receivedBytes)} / {formatBytes(totalBytes)}
                      </span>
                    </div>
                    <Progress value={progress} className="h-2" />
                    {phase !== "downloading" && overallTotalBytes > 0 && (
                      <div className="text-xs text-muted-foreground">
                        Downloaded {formatBytes(overallReceivedBytes)} / {formatBytes(overallTotalBytes)}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>ETA {formatEta(etaSeconds)}</span>
                      <span>{formatSpeed(speedBps)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 sm:justify-end">
                    <Button size="sm" variant="ghost" onClick={() => cancelGroup(items[0]?.appid)}>
                      Cancel
                    </Button>
                  </div>
                </div>

                <div className="border-t border-border/50 px-5 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{totalParts} {getPartsLabel(items)}</span>
                    <span>
                      {(() => {
                        const part = getPartIndex(primaryPartFilename || "", 0, totalParts, primaryPartIndex).partNum
                        if (queuedOnly) {
                          return "Queued"
                        }
                        if (phase === "downloading") {
                          return `Part ${part} of ${totalParts}`
                        }
                        if (totalParts > 1) {
                          return `Installing part ${part} of ${totalParts}`
                        }
                        return "Installing data"
                      })()}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Download className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-black font-montserrat">Completed</h2>
          <Badge variant="secondary" className="rounded-full">
            {completedGroups.length}
          </Badge>
        </div>

        {completedGroups.length === 0 && (
          <div className="rounded-2xl border border-border/60 bg-card/60 p-6 text-sm text-muted-foreground">
            Completed downloads will appear here.
          </div>
        )}

        <div className="space-y-4">
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
                className="cursor-pointer rounded-xl border border-border/60 bg-gradient-to-b from-slate-950/60 via-slate-950/40 to-slate-900/30 shadow-lg shadow-black/20 transition hover:border-primary/40"
                onClick={() => {
                  if (appid) navigate(`/game/${appid}`)
                }}
              >
                <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="h-14 w-24 overflow-hidden rounded-md border border-border/50 bg-muted">
                      {game?.image ? (
                        <img
                          src={proxyImageUrl(game.image)}
                          alt={gameName}
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                    <div>
                      <h3 className="text-base font-semibold">{gameName}</h3>
                      <div className="text-xs text-muted-foreground">
                        {game?.version ? `${game.version}` : "Unknown version"} - {game?.source || "Unknown source"} - Completed {finishedAt ? new Date(finishedAt).toLocaleString() : ""}
                      </div>
                      {game?.comment && (
                        <div className="mt-2 text-xs text-amber-200/90">
                          Important note: {game.comment}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(event) => {
                        event.stopPropagation()
                        if (appid) {
                          void handleLaunch(appid, gameName, items[0]?.savePath)
                        }
                      }}
                    >
                      Launch
                    </Button>
                  </div>
                </div>

                <div className="border-t border-border/50 px-5 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{totalParts} {getPartsLabel(items)}</span>
                    <Badge variant="outline" className="rounded-full">
                      Completed
                    </Badge>
                  </div>
                </div>
              </div>
            )}
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <XCircle className="h-5 w-5 text-destructive" />
          <h2 className="text-xl font-black font-montserrat">Cancelled / Failed</h2>
          <Badge variant="secondary" className="rounded-full">
            {cancelledGroups.length}
          </Badge>
        </div>

        {cancelledGroups.length === 0 && (
          <div className="rounded-2xl border border-border/60 bg-card/60 p-6 text-sm text-muted-foreground">
            Cancelled or failed downloads will appear here.
          </div>
        )}

        <div className="space-y-4">
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
                className="rounded-xl border border-destructive/40 bg-gradient-to-b from-slate-950/60 via-slate-950/40 to-slate-900/30 shadow-lg shadow-black/20"
              >
                <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="h-14 w-24 overflow-hidden rounded-md border border-border/50 bg-muted">
                      {game?.image ? (
                        <img
                          src={proxyImageUrl(game.image)}
                          alt={gameName}
                          className="h-full w-full object-cover opacity-60"
                        />
                      ) : null}
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-muted-foreground">{gameName}</h3>
                      <div className="text-xs text-destructive">
                        {statusLabel}
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
                    >
                      Retry
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (appid) clearByAppid(appid)
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </div>

                <div className="border-t border-border/50 px-5 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{totalParts} {getPartsLabel(items)}</span>
                    <Badge variant="outline" className="rounded-full border-destructive/40 text-destructive">
                      {statusLabel}
                    </Badge>
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
        onSelect={handleExePicked}
        onClose={() => setExePickerOpen(false)}
      />
      <AdminPromptModal
        open={adminPromptOpen}
        gameName={games.find((g) => g.appid === pendingAppId)?.name || "Game"}
        onRunAsAdmin={async () => {
          if (pendingExePath && pendingAppId) {
            await handleAdminDecision(pendingAppId, pendingExePath, true)
          }
        }}
        onContinueWithoutAdmin={async () => {
          if (pendingExePath && pendingAppId) {
            await handleAdminDecision(pendingAppId, pendingExePath, false)
          }
        }}
        onClose={() => {
          setAdminPromptOpen(false)
          setPendingExePath(null)
          setPendingAppId(null)
        }}
      />
      <DesktopShortcutModal
        open={shortcutModalOpen}
        gameName={games.find((g) => g.appid === pendingAppId)?.name || "Game"}
        onCreateShortcut={async () => {
          if (pendingExePath && pendingAppId) {
            await createDesktopShortcut(pendingAppId, pendingExePath)
            await setShortcutAskedForGame(pendingAppId)
            const runAsAdmin = await getRunAsAdminEnabled()
            await launchGame(pendingAppId, pendingExePath, runAsAdmin)
          }
        }}
        onSkip={async () => {
          if (pendingAppId) {
            await setShortcutAskedForGame(pendingAppId)
          }
          if (pendingExePath && pendingAppId) {
            const runAsAdmin = await getRunAsAdminEnabled()
            await launchGame(pendingAppId, pendingExePath, runAsAdmin)
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
    </div>
  )
}


