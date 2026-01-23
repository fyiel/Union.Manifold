import { useMemo, type MouseEvent } from "react"
import { useNavigate } from "react-router-dom"
import { useDownloads } from "@/context/downloads-context"
import { Progress } from "@/components/ui/progress"
import { PauseCircle, Play } from "lucide-react"

const ACTIVE_STATUSES = ["downloading", "paused", "extracting", "installing"]

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

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "0%"
  return `${Math.round(value)}%`
}

function estimateGroupTotals(items: Array<{ totalBytes: number; receivedBytes: number; filename: string; partTotal?: number }>) {
  const receivedBytes = items.reduce((sum, item) => sum + (item.receivedBytes || 0), 0)
  const knownTotals = items.filter((item) => (item.totalBytes || 0) > 0)
  const knownTotalBytes = knownTotals.reduce((sum, item) => sum + (item.totalBytes || 0), 0)
  const totalParts = getTotalParts(items)
  let totalBytes = knownTotalBytes
  if (totalParts > 1 && knownTotals.length > 0) {
    const avgPartSize = knownTotalBytes / knownTotals.length
    totalBytes = Math.max(avgPartSize * totalParts, knownTotalBytes)
  }
  totalBytes = Math.max(totalBytes, receivedBytes)
  return { totalBytes, receivedBytes }
}

export function DownBar() {
  const { downloads, pauseDownload, resumeGroup } = useDownloads()
  const navigate = useNavigate()

  const { primaryGroup, queuedGroup, queuedCount } = useMemo(() => {
    // Filter out cancelled downloads
    const visible = downloads.filter((item) => item.status !== "cancelled")
    const grouped = visible.reduce<Record<string, typeof visible>>((acc, item) => {
      acc[item.appid] = acc[item.appid] || []
      acc[item.appid].push(item)
      return acc
    }, {})
    const byPriority = Object.values(grouped).sort((a, b) => {
      const priority = (items: typeof visible) => {
        if (items.some((i) => ACTIVE_STATUSES.includes(i.status))) return 0
        if (items.some((i) => i.status === "queued")) return 1
        if (items.some((i) => ["completed", "extracted"].includes(i.status))) return 2
        return 3
      }
      return priority(a) - priority(b)
    })
    const activeGroups = byPriority.filter((items) => items.some((item) => ACTIVE_STATUSES.includes(item.status)))
    const queuedGroups = byPriority.filter((items) => items.some((item) => item.status === "queued"))
    const completedGroups = byPriority.filter((items) => items.some((item) => ["completed", "extracted"].includes(item.status)))
    const primary = activeGroups[0] || queuedGroups[0] || completedGroups[0] || null
    return {
      primaryGroup: primary,
      queuedGroup: queuedGroups[0] || null,
      queuedCount: visible.filter((item) => item.status === "queued").length,
    }
  }, [downloads])

  const displayGroup = primaryGroup || queuedGroup

  const stats = useMemo(() => {
    if (!displayGroup) return null
    const { totalBytes, receivedBytes } = estimateGroupTotals(displayGroup)
    const rawProgress = totalBytes > 0 ? (receivedBytes / totalBytes) * 100 : 0
    const progress = Math.max(0, Math.min(100, rawProgress))
    const downloading = displayGroup.find((item) => item.status === "downloading")
    const extracting = displayGroup.find((item) => item.status === "extracting")
    const installing = displayGroup.find((item) => item.status === "installing")
    const paused = displayGroup.find((item) => item.status === "paused")
    const completed = displayGroup.find((item) => item.status === "completed" || item.status === "extracted")
    const fallbackLatest = displayGroup.reduce<typeof displayGroup[number] | null>((latest, item) => {
      if (!latest) return item
      const latestStarted = latest.startedAt || 0
      const itemStarted = item.startedAt || 0
      if (itemStarted > latestStarted) return item
      if (itemStarted === latestStarted) {
        const latestPart = latest.partIndex || 0
        const itemPart = item.partIndex || 0
        return itemPart > latestPart ? item : latest
      }
      return latest
    }, null)
    const activeItem = downloading || extracting || installing || paused || completed || fallbackLatest || displayGroup[0]
    const totalParts = getTotalParts(displayGroup)
    const partInfo = getPartIndex(
      activeItem?.filename || "",
      0,
      totalParts,
      activeItem?.partIndex
    )
    const phase = installing
      ? "Installing"
      : extracting
        ? "Installing"
        : downloading
          ? "Downloading"
          : completed
            ? "Completed"
          : paused
            ? "Paused"
            : "Queued"
    return {
      totalBytes,
      receivedBytes,
      progress,
      phase,
      partInfo,
    }
  }, [displayGroup])

  const handleClick = () => {
    navigate("/downloads")
  }

  if (!displayGroup || !stats) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleClick()
        }}
        className="fixed bottom-0 left-0 right-0 z-30 border-t border-border/60 bg-card/95 px-4 py-3 text-left text-sm text-foreground backdrop-blur-md transition hover:bg-card"
      >
        <div className="flex items-center justify-between">
          <span className="font-semibold">See activity</span>
          <span className="text-xs text-muted-foreground">No active downloads</span>
        </div>
      </div>
    )
  }

  const isPaused = displayGroup.some((item) => item.status === "paused") &&
    !displayGroup.some((item) => ["downloading", "extracting", "installing"].includes(item.status))
  const isQueuedOnly = displayGroup.every((item) => item.status === "queued")
  const displayName = displayGroup[0]?.gameName || "Download"
  const displayHost = displayGroup[0]?.host || "unknown"
  const handleToggle = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (isPaused) {
      const appid = displayGroup[0]?.appid
      if (appid) {
        void resumeGroup(appid)
      }
      return
    }
    for (const item of downloads) {
      if (item.status === "downloading") {
        void pauseDownload(item.id)
      }
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") handleClick()
      }}
      className="fixed bottom-0 left-0 right-0 z-30 border-t border-border/60 bg-card/95 px-4 py-3 text-left text-sm text-foreground backdrop-blur-md transition hover:bg-card"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{displayName}</span>
            <span className="text-xs text-muted-foreground">
              {isPaused
                ? `Downloads paused - ${queuedCount} queued`
                : isQueuedOnly
                  ? `Queued • ${displayName}`
                  : stats.partInfo.total > 1
                    ? `${stats.phase} part ${stats.partInfo.partNum} of ${stats.partInfo.total}`
                    : `${stats.phase} ${displayName}`}
              {queuedCount > 0 && !isPaused && !isQueuedOnly ? ` • ${queuedCount} queued` : ""}
              {displayHost ? ` • ${displayHost}` : ""}
            </span>
          </div>
          <div className="mt-2">
            <Progress value={stats.progress} className="h-1.5" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-muted-foreground">{formatPercent(stats.progress)}</div>
          <button
            type="button"
            onClick={handleToggle}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-card/60 text-foreground transition hover:bg-card"
            aria-label={isPaused ? "Resume downloads" : "Pause downloads"}
          >
            {isPaused ? <Play className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  )
}
