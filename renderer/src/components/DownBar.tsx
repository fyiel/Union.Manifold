import { useMemo, useState, type MouseEvent } from "react"
import { useNavigate } from "react-router-dom"
import { useDownloads } from "@/context/downloads-context"
import { Progress } from "@/components/ui/progress"
import { PauseCircle, Play, Plus, Activity } from "lucide-react"
import { AddGameModal } from "@/components/AddGameModal"

const ACTIVE_STATUSES = ["downloading", "paused", "extracting", "installing", "verifying", "retrying"]

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
  const [addGameOpen, setAddGameOpen] = useState(false)

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
    const primary = activeGroups[0] || queuedGroups[0] || null
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
    const verifying = displayGroup.find((item) => item.status === "verifying")
    const retrying = displayGroup.find((item) => item.status === "retrying")
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
    const activeItem = downloading || verifying || retrying || extracting || installing || paused || completed || fallbackLatest || displayGroup[0]
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
        : verifying
          ? "Verifying integrity"
          : retrying
            ? retrying.error || "Verification failed - retrying"
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
    if (addGameOpen) return
    navigate("/downloads")
  }

  if (!displayGroup || !stats) {
    return (
      <>
        <div className="pointer-events-none fixed bottom-4 left-0 right-0 z-30 flex justify-center px-4 md:left-[17rem]">
          <div
            role="button"
            tabIndex={0}
            onClick={handleClick}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") handleClick()
            }}
            className="pointer-events-auto flex w-full max-w-xl cursor-pointer items-center justify-between gap-3 rounded-full border border-white/[.07] bg-zinc-900/90 px-4 py-2.5 text-sm text-zinc-200 shadow-[0_8px_40px_rgba(0,0,0,0.5)] backdrop-blur-2xl transition-all hover:bg-zinc-800/90"
          >
            <div className="flex items-center gap-2.5">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-800">
                <Activity className="h-3.5 w-3.5 text-zinc-400" />
              </div>
              <span className="font-medium text-zinc-300">Activity</span>
              <span className="text-xs text-zinc-500">No active downloads</span>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (e.nativeEvent) e.nativeEvent.stopImmediatePropagation()
                setAddGameOpen(true)
              }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/[.07] bg-zinc-800 text-zinc-300 transition-all hover:bg-zinc-700 hover:text-white active:scale-95"
              aria-label="Add external game"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <AddGameModal open={addGameOpen} onOpenChange={setAddGameOpen} />
      </>
    )
  }

  const isPaused = displayGroup.some((item) => item.status === "paused") &&
    !displayGroup.some((item) => ["downloading", "extracting", "installing", "verifying", "retrying"].includes(item.status))
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
      if (item.status === "downloading" && item.appid === displayGroup[0]?.appid) {
        void pauseDownload(item.id)
      }
    }
  }

  return (
    <>
      <div className="pointer-events-none fixed bottom-4 left-0 right-0 z-30 flex justify-center px-4 md:left-[17rem]">
        <div
          role="button"
          tabIndex={0}
          onClick={handleClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") handleClick()
          }}
          className="pointer-events-auto flex w-full max-w-xl cursor-pointer items-center gap-3 rounded-full border border-white/[.07] bg-zinc-900/90 px-4 py-2.5 text-sm text-zinc-200 shadow-[0_8px_40px_rgba(0,0,0,0.5)] backdrop-blur-2xl transition-all hover:bg-zinc-800/90"
        >
          <div className="min-w-0 flex-1 flex items-center gap-2.5">
            <span className="max-w-[160px] truncate text-sm font-medium text-zinc-200">{displayName}</span>
            <span className="shrink-0 text-xs text-zinc-500">
              {isPaused
                ? `Paused · ${queuedCount} queued`
                : isQueuedOnly
                  ? "Queued"
                  : stats.partInfo.total > 1
                    ? `${stats.phase} · part ${stats.partInfo.partNum}/${stats.partInfo.total}`
                    : stats.phase}
              {queuedCount > 0 && !isPaused && !isQueuedOnly ? ` · ${queuedCount} queued` : ""}
            </span>
            <div className="flex-1 min-w-[48px]">
              <Progress value={stats.progress} className="h-1 bg-white/[.07]" />
            </div>
            <span className="shrink-0 text-xs tabular-nums text-zinc-500">{formatPercent(stats.progress)}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={handleToggle}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-white/[.07] bg-zinc-800 text-zinc-300 transition-all hover:bg-zinc-700 hover:text-white active:scale-95"
              aria-label={isPaused ? "Resume downloads" : "Pause downloads"}
            >
              {isPaused ? <Play className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (e.nativeEvent) e.nativeEvent.stopImmediatePropagation()
                setAddGameOpen(true)
              }}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-white/[.07] bg-zinc-800 text-zinc-300 transition-all hover:bg-zinc-700 hover:text-white active:scale-95"
              aria-label="Add external game"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
      <AddGameModal open={addGameOpen} onOpenChange={setAddGameOpen} />
    </>
  )
}
