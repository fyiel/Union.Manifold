import { useEffect, useMemo, useRef, useState } from "react"
import { useDownloads } from "@/context/downloads-context"
import { useGamesData } from "@/hooks/use-games"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { proxyImageUrl } from "@/lib/utils"
import { Download, FolderOpen, PauseCircle, XCircle } from "lucide-react"

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

function renderSparkline(points: number[], color: string) {
  const width = 260
  const height = 70
  if (!points.length) {
    return <polyline points={`0,${height} ${width},${height}`} fill="none" stroke={color} strokeWidth="2" />
  }
  const max = Math.max(...points, 1)
  const path = points
    .map((value, index) => {
      const x = points.length === 1 ? 0 : (index / (points.length - 1)) * width
      const y = height - (value / max) * height
      return `${x},${y}`
    })
    .join(" ")
  return <polyline points={path} fill="none" stroke={color} strokeWidth="2" />
}

export function DownloadsPage() {
  const { downloads, cancelDownload, showInFolder, openPath, clearCompleted } = useDownloads()
  const { games } = useGamesData()
  const [networkHistory, setNetworkHistory] = useState<number[]>([])
  const [diskHistory, setDiskHistory] = useState<number[]>([])
  const [peakSpeed, setPeakSpeed] = useState(0)
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

  const activeGroups = Object.values(grouped).filter((items) =>
    items.some((item) => ["queued", "downloading", "paused"].includes(item.status))
  )
  const completedGroups = Object.values(grouped).filter((items) =>
    items.every((item) => ["completed", "failed", "cancelled"].includes(item.status))
  )

  const primaryGroup = activeGroups[0]
  const primaryGame = primaryGroup ? games.find((game) => game.appid === primaryGroup[0]?.appid) : null

  const primaryStats = useMemo(() => {
    if (!primaryGroup) return null
    const totalBytes = primaryGroup.reduce((sum, item) => sum + (item.totalBytes || 0), 0)
    const receivedBytes = primaryGroup.reduce((sum, item) => sum + (item.receivedBytes || 0), 0)
    const speedBps = primaryGroup.reduce((sum, item) => sum + (item.speedBps || 0), 0)
    const etaSeconds = totalBytes > 0 && speedBps > 0 ? (totalBytes - receivedBytes) / speedBps : null
    const progress = totalBytes > 0 ? (receivedBytes / totalBytes) * 100 : 0

    return { totalBytes, receivedBytes, speedBps, etaSeconds, progress }
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

  const currentNetwork = networkHistory[networkHistory.length - 1] ?? primaryStats?.speedBps ?? 0
  const currentDisk = diskHistory[diskHistory.length - 1] ?? 0
  const averageSpeed = useMemo(() => {
    if (!primaryStats || !startTimeRef.current) return 0
    const elapsed = Math.max(1, (Date.now() - startTimeRef.current) / 1000)
    return primaryStats.receivedBytes / elapsed
  }, [primaryStats, networkHistory.length])

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black font-montserrat">Downloads</h1>
          <p className="text-sm text-muted-foreground">Track live progress and completed downloads in-app.</p>
        </div>
        <Button variant="outline" onClick={clearCompleted}>
          Clear completed
        </Button>
      </div>

      {primaryGroup && primaryStats && (
        <section>
          <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/30">
            <div className="absolute inset-0">
              {primaryGame?.image && (
                <img
                  src={proxyImageUrl(primaryGame.image)}
                  alt={primaryGroup[0]?.gameName || "Download"}
                  className="h-full w-full object-cover opacity-40"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-background/40" />
            </div>

            <div className="relative z-10 space-y-6 p-6 lg:p-8">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Now downloading</p>
                  <h2 className="text-2xl sm:text-3xl font-black font-montserrat">
                    {primaryGroup[0]?.gameName || "Unknown"}
                  </h2>
                  <div className="flex flex-wrap gap-6 text-xs text-muted-foreground">
                    <div>
                      <div className="text-foreground font-semibold">ETA</div>
                      <div>{formatEta(primaryStats.etaSeconds)}</div>
                    </div>
                    <div>
                      <div className="text-foreground font-semibold">Files</div>
                      <div>{primaryGroup.length}</div>
                    </div>
                    <div>
                      <div className="text-foreground font-semibold">Average speed</div>
                      <div>{formatSpeed(averageSpeed)}</div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    variant="outline"
                    onClick={() => cancelDownload(primaryGroup[0]?.id)}
                    className="justify-center gap-2"
                  >
                    <XCircle className="h-4 w-4" />
                    Cancel
                  </Button>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Downloading data</span>
                  <span>
                    {formatBytes(primaryStats.receivedBytes)} / {formatBytes(primaryStats.totalBytes)}
                  </span>
                </div>
                <Progress value={primaryStats.progress} className="h-2" />
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-border/60 bg-background/70 p-4">
                  <div className="text-xs text-muted-foreground">Current</div>
                  <div className="text-lg font-semibold">{formatSpeed(currentNetwork)}</div>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/70 p-4">
                  <div className="text-xs text-muted-foreground">Peak</div>
                  <div className="text-lg font-semibold">{formatSpeed(peakSpeed)}</div>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/70 p-4">
                  <div className="text-xs text-muted-foreground">Total</div>
                  <div className="text-lg font-semibold">{formatBytes(primaryStats.receivedBytes)}</div>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/70 p-4">
                  <div className="text-xs text-muted-foreground">Disk usage</div>
                  <div className="text-lg font-semibold">{formatSpeed(currentDisk)}</div>
                </div>
              </div>

              <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
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
                <svg viewBox="0 0 260 70" className="mt-3 h-20 w-full">
                  {renderSparkline(networkHistory, "rgb(56 189 248)")}
                  {renderSparkline(diskHistory, "rgb(52 211 153)")}
                </svg>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Download className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-black font-montserrat">Active</h2>
          <Badge variant="secondary" className="rounded-full">
            {activeGroups.length}
          </Badge>
        </div>

        {activeGroups.length === 0 && (
          <div className="rounded-2xl border border-border/60 bg-card/60 p-6 text-sm text-muted-foreground">
            No active downloads. Start a download from any game page.
          </div>
        )}

        <div className="grid gap-6">
          {activeGroups.map((items) => {
            const totalBytes = items.reduce((sum, item) => sum + (item.totalBytes || 0), 0)
            const receivedBytes = items.reduce((sum, item) => sum + (item.receivedBytes || 0), 0)
            const speedBps = items.reduce((sum, item) => sum + (item.speedBps || 0), 0)
            const etaSeconds = totalBytes > 0 && speedBps > 0 ? (totalBytes - receivedBytes) / speedBps : null
            const progress = totalBytes > 0 ? (receivedBytes / totalBytes) * 100 : 0
            const gameName = items[0]?.gameName || "Unknown"

            return (
              <Card key={`${items[0].appid}-${gameName}`} className="border-border/60">
                <CardContent className="p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold">{gameName}</h3>
                      <p className="text-xs text-muted-foreground">
                        {items.length} file(s) - {formatBytes(totalBytes)}
                      </p>
                    </div>
                    <div className="text-xs text-muted-foreground">ETA {formatEta(etaSeconds)}</div>
                  </div>
                  <Progress value={progress} />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {formatBytes(receivedBytes)} / {formatBytes(totalBytes)}
                    </span>
                    <span>{formatSpeed(speedBps)}</span>
                  </div>

                  <div className="space-y-3">
                    {items.map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-4 text-sm">
                        <div className="flex flex-col">
                          <span className="font-medium truncate max-w-[260px]">{item.filename}</span>
                          <span className="text-xs text-muted-foreground">{item.status}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {item.savePath && (
                            <Button size="sm" variant="ghost" onClick={() => showInFolder(item.savePath || "")}>
                              <FolderOpen className="h-4 w-4" />
                            </Button>
                          )}
                          {item.status === "downloading" && (
                            <Button size="sm" variant="ghost" onClick={() => cancelDownload(item.id)}>
                              <XCircle className="h-4 w-4" />
                            </Button>
                          )}
                          {item.status === "paused" && (
                            <Button size="sm" variant="ghost">
                              <PauseCircle className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
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

        <div className="grid gap-4">
          {completedGroups.map((items) => {
            const gameName = items[0]?.gameName || "Unknown"
            const finishedAt = items
              .map((item) => item.completedAt || 0)
              .sort((a, b) => b - a)[0]

            return (
              <Card key={`completed-${items[0].appid}-${gameName}`} className="border-border/60">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold">{gameName}</h3>
                      <p className="text-xs text-muted-foreground">
                        {items.length} file(s) - Finished {finishedAt ? new Date(finishedAt).toLocaleString() : ""}
                      </p>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {formatBytes(items.reduce((sum, item) => sum + (item.totalBytes || 0), 0))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    {items.map((item) => (
                      <div key={item.id} className="flex items-center justify-between text-sm">
                        <span className="truncate max-w-[280px]">{item.filename}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="rounded-full">
                            {item.status}
                          </Badge>
                          {item.savePath && (
                            <Button size="sm" variant="ghost" onClick={() => openPath(item.savePath || "")}>
                              Open
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          )}
        </div>
      </section>
    </div>
  )
}
