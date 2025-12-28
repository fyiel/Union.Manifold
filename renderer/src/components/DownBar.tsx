import { useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { useDownloads } from "@/context/downloads-context"
import { Progress } from "@/components/ui/progress"

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

export function DownBar() {
  const { downloads } = useDownloads()
  const navigate = useNavigate()

  const { primaryGroup, queuedGroup, queuedCount } = useMemo(() => {
    const grouped = downloads.reduce<Record<string, typeof downloads>>((acc, item) => {
      acc[item.appid] = acc[item.appid] || []
      acc[item.appid].push(item)
      return acc
    }, {})
    const activeGroups = Object.values(grouped).filter((items) =>
      items.some((item) => ACTIVE_STATUSES.includes(item.status))
    )
    const queuedGroups = Object.values(grouped).filter((items) =>
      items.every((item) => item.status === "queued")
    )
    return {
      primaryGroup: activeGroups[0] || null,
      queuedGroup: queuedGroups[0] || null,
      queuedCount: downloads.filter((item) => item.status === "queued").length,
    }
  }, [downloads])

  const displayGroup = primaryGroup || queuedGroup

  const stats = useMemo(() => {
    if (!displayGroup) return null
    const totalBytes = displayGroup.reduce((sum, item) => sum + (item.totalBytes || 0), 0)
    const receivedBytes = displayGroup.reduce((sum, item) => sum + (item.receivedBytes || 0), 0)
    const rawProgress = totalBytes > 0 ? (receivedBytes / totalBytes) * 100 : 0
    const progress = Math.max(0, Math.min(100, rawProgress))
    const downloading = displayGroup.find((item) => item.status === "downloading")
    const extracting = displayGroup.find((item) => item.status === "extracting")
    const installing = displayGroup.find((item) => item.status === "installing")
    const paused = displayGroup.find((item) => item.status === "paused")
    const activeItem = downloading || extracting || installing || paused || displayGroup[0]
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
      <button
        className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-slate-950/80 px-4 py-3 text-left text-sm text-slate-200 backdrop-blur-md transition hover:bg-slate-950/90"
        onClick={handleClick}
        type="button"
      >
        <div className="flex items-center justify-between">
          <span className="font-semibold">See activity</span>
          <span className="text-xs text-slate-400">No active downloads</span>
        </div>
      </button>
    )
  }

  const isPaused = displayGroup.some((item) => item.status === "paused") &&
    !displayGroup.some((item) => ["downloading", "extracting", "installing"].includes(item.status))
  const isQueuedOnly = displayGroup.every((item) => item.status === "queued")
  const displayName = displayGroup[0]?.gameName || "Download"

  return (
    <button
      className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-slate-950/80 px-4 py-3 text-left text-sm text-slate-100 backdrop-blur-md transition hover:bg-slate-950/90"
      onClick={handleClick}
      type="button"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{displayName}</span>
            <span className="text-xs text-slate-400">
              {isPaused
                ? `Downloads paused - ${queuedCount} queued`
                : isQueuedOnly
                  ? `Queued • ${displayName}`
                  : `${stats.phase} part ${stats.partInfo.partNum} of ${stats.partInfo.total}`}
              {queuedCount > 0 && !isPaused && !isQueuedOnly ? ` • ${queuedCount} queued` : ""}
            </span>
          </div>
          <div className="mt-2">
            <Progress value={stats.progress} className="h-1.5" />
          </div>
        </div>
        <div className="text-xs text-slate-400">{formatPercent(stats.progress)}</div>
      </div>
    </button>
  )
}
