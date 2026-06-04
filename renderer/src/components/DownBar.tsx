import { useEffect, useRef, useState, type MouseEvent } from "react"
import { useNavigate } from "react-router-dom"
import { useDownloadsSelector, useDownloadsActions, type DownloadItem } from "@/context/downloads-context"
import { Progress } from "@/components/ui/progress"
import { PauseCircle, HardDrive } from "lucide-react"
import { Play, Plus, Activity, Download } from "@/components/icons"
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

type DownBarData = {
  hasDisplay: boolean
  displayName: string
  phase: string
  progress: number
  etaSeconds: number | null
  partNum: number
  partTotal: number
  isPaused: boolean
  isQueuedOnly: boolean
  queuedCount: number
  primaryAppid: string | null
  firstDownloadingId: string | null
  secondaryActivityLabel: string | null
  secondaryActivityDetail: string | null
  secondaryActivityName: string | null
  secondaryActivityPhase: string | null
  canToggle: boolean
}

function selectDownBarData(downloads: DownloadItem[]): DownBarData {
  const visible = downloads.filter((item) => item.status !== "cancelled")
  const grouped = visible.reduce<Record<string, DownloadItem[]>>((acc, item) => {
    acc[item.appid] = acc[item.appid] || []
    acc[item.appid].push(item)
    return acc
  }, {})
  const byPriority = Object.values(grouped).sort((a, b) => {
    const priority = (items: DownloadItem[]) => {
      if (items.some((i) => ["downloading", "verifying", "retrying"].includes(i.status))) return 0
      if (items.some((i) => ["extracting", "installing"].includes(i.status))) return 1
      if (items.some((i) => i.status === "paused")) return 2
      if (items.some((i) => i.status === "queued")) return 3
      if (items.some((i) => ["completed", "extracted"].includes(i.status))) return 4
      return 5
    }
    return priority(a) - priority(b)
  })
  const activeGroups = byPriority.filter((items) => items.some((item) => ACTIVE_STATUSES.includes(item.status)))
  const queuedGroups = byPriority.filter((items) => items.some((item) => item.status === "queued"))
  const displayGroup = activeGroups[0] || queuedGroups[0] || null
  const queuedCount = visible.filter((item) => item.status === "queued").length

  if (!displayGroup) {
    return { hasDisplay: false, displayName: "", phase: "", progress: 0, etaSeconds: null, partNum: 1, partTotal: 1, isPaused: false, isQueuedOnly: false, queuedCount: 0, primaryAppid: null, firstDownloadingId: null, secondaryActivityLabel: null, secondaryActivityDetail: null, secondaryActivityName: null, secondaryActivityPhase: null, canToggle: false }
  }

  const { totalBytes, receivedBytes } = estimateGroupTotals(displayGroup)
  const progress = Math.max(0, Math.min(100, totalBytes > 0 ? (receivedBytes / totalBytes) * 100 : 0))
  const downloading = displayGroup.find((item) => item.status === "downloading")
  const extracting = displayGroup.find((item) => item.status === "extracting")
  const installing = displayGroup.find((item) => item.status === "installing")
  const verifying = displayGroup.find((item) => item.status === "verifying")
  const retrying = displayGroup.find((item) => item.status === "retrying")
  const paused = displayGroup.find((item) => item.status === "paused")
  const completed = displayGroup.find((item) => item.status === "completed" || item.status === "extracted")
  const fallbackLatest = displayGroup.reduce<DownloadItem | null>((latest, item) => {
    if (!latest) return item
    const itemStarted = item.startedAt || 0
    const latestStarted = latest.startedAt || 0
    if (itemStarted > latestStarted) return item
    if (itemStarted === latestStarted) return (item.partIndex || 0) > (latest.partIndex || 0) ? item : latest
    return latest
  }, null)
  const activeItem = downloading || verifying || retrying || extracting || installing || paused || completed || fallbackLatest || displayGroup[0]
  const etaSeconds = downloading?.etaSeconds ?? verifying?.etaSeconds ?? retrying?.etaSeconds ?? null
  const totalParts = getTotalParts(displayGroup)
  const partInfo = getPartIndex(activeItem?.filename || "", 0, totalParts, activeItem?.partIndex)
  const phase = installing ? "Installing"
    : extracting ? "Installing"
    : verifying ? "Verifying integrity"
    : retrying ? (retrying.error || "Verification failed - retrying")
    : downloading ? "Downloading"
    : completed ? "Completed"
    : paused ? "Paused"
    : "Queued"
  const isPaused = Boolean(paused) && !Boolean(downloading || extracting || installing || verifying || retrying)
  const backgroundExtractingCount = activeGroups.filter(
    (group) => group !== displayGroup && group.some((item) => ["extracting", "installing"].includes(item.status))
  ).length
  const backgroundDownloadCount = activeGroups.filter(
    (group) => group !== displayGroup && group.some((item) => ["downloading", "verifying", "retrying"].includes(item.status))
  ).length
  const backgroundExtractingGroup = activeGroups.find(
    (group) => group !== displayGroup && group.some((item) => ["extracting", "installing"].includes(item.status))
  )
  const backgroundDownloadingGroup = activeGroups.find(
    (group) => group !== displayGroup && group.some((item) => ["downloading", "verifying", "retrying"].includes(item.status))
  )

  let secondaryActivityLabel: string | null = null
  let secondaryActivityDetail: string | null = null
  let secondaryActivityName: string | null = null
  let secondaryActivityPhase: string | null = null
  if (backgroundExtractingCount > 0) {
    secondaryActivityLabel = `+${backgroundExtractingCount} extracting`
    const name = backgroundExtractingGroup?.[0]?.gameName || "Another game"
    secondaryActivityName = name
    secondaryActivityPhase = "Extracting"
    secondaryActivityDetail = backgroundExtractingCount > 1 ? `Extracting ${name} +${backgroundExtractingCount - 1} more` : `Extracting ${name}`
  } else if (backgroundDownloadCount > 0) {
    secondaryActivityLabel = `+${backgroundDownloadCount} downloading`
    const name = backgroundDownloadingGroup?.[0]?.gameName || "Another game"
    secondaryActivityName = name
    secondaryActivityPhase = "Downloading"
    secondaryActivityDetail = backgroundDownloadCount > 1 ? `Downloading ${name} +${backgroundDownloadCount - 1} more` : `Downloading ${name}`
  }

  return {
    hasDisplay: true,
    displayName: displayGroup[0]?.gameName || "Download",
    phase,
    progress,
    etaSeconds,
    partNum: partInfo.partNum,
    partTotal: partInfo.total,
    isPaused,
    isQueuedOnly: displayGroup.every((item) => item.status === "queued"),
    queuedCount,
    primaryAppid: displayGroup[0]?.appid || null,
    firstDownloadingId: downloading?.id || null,
    secondaryActivityLabel,
    secondaryActivityDetail,
    secondaryActivityName,
    secondaryActivityPhase,
    canToggle: Boolean(downloading || isPaused),
  }
}

function downBarEq(a: DownBarData, b: DownBarData): boolean {
  return (
    a.hasDisplay === b.hasDisplay &&
    a.displayName === b.displayName &&
    a.phase === b.phase &&
    Math.abs(a.progress - b.progress) < 0.5 &&
    a.etaSeconds === b.etaSeconds &&
    a.partNum === b.partNum &&
    a.partTotal === b.partTotal &&
    a.isPaused === b.isPaused &&
    a.isQueuedOnly === b.isQueuedOnly &&
    a.queuedCount === b.queuedCount &&
    a.primaryAppid === b.primaryAppid &&
    a.firstDownloadingId === b.firstDownloadingId &&
    a.secondaryActivityLabel === b.secondaryActivityLabel &&
    a.secondaryActivityDetail === b.secondaryActivityDetail &&
    a.secondaryActivityName === b.secondaryActivityName &&
    a.secondaryActivityPhase === b.secondaryActivityPhase &&
    a.canToggle === b.canToggle
  )
}

export function DownBar() {
  const downBarData = useDownloadsSelector(selectDownBarData, downBarEq)
  const { pauseDownload, resumeGroup } = useDownloadsActions()
  const navigate = useNavigate()
  const [addGameOpen, setAddGameOpen] = useState(false)
  const [addGameInitialSource, setAddGameInitialSource] = useState<"folder" | "archive" | null>(null)
  const barRef = useRef<HTMLDivElement | null>(null)

  // Publish the bar's live height to a CSS variable so the Toaster can sit
  // exactly above it. The bar grows taller when a second download is running
  // (the secondary-activity panel), and at a fixed offset toasts ended up
  // overlapping / reading as tucked behind it. A ResizeObserver keeps the
  // variable in lockstep with whatever the bar's current height is.
  useEffect(() => {
    const node = barRef.current
    const setVar = () => {
      const h = node?.offsetHeight || 0
      document.documentElement.style.setProperty("--uc-downbar-height", `${h}px`)
    }
    setVar()
    if (!node || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(setVar)
    ro.observe(node)
    return () => ro.disconnect()
  }, [downBarData.hasDisplay, downBarData.secondaryActivityDetail])

  // Clear the variable when the bar unmounts (e.g. on auth routes that don't
  // render it) so toasts fall back to their default offset.
  useEffect(() => () => {
    document.documentElement.style.removeProperty("--uc-downbar-height")
  }, [])

  // Listen for global "open Add Game modal" events — dispatched by the
  // ArchiveDropZone when the user drags an archive file onto the window, and
  // potentially by other surfaces in the future (e.g. a tray menu entry).
  useEffect(() => {
    if (typeof window === "undefined") return
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ source?: "folder" | "archive" }>).detail
      setAddGameInitialSource(detail?.source ?? null)
      setAddGameOpen(true)
    }
    window.addEventListener("uc_open_add_game", onOpen)
    return () => window.removeEventListener("uc_open_add_game", onOpen)
  }, [])

  const handleClick = () => {
    if (addGameOpen) return
    navigate("/downloads")
  }

  if (!downBarData.hasDisplay) {
    return (
      <>
        <div ref={barRef} className="pointer-events-none fixed bottom-4 left-0 right-0 z-30 flex justify-center px-4 md:left-[17rem]">
          <div
            role="button"
            tabIndex={0}
            onClick={handleClick}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") handleClick()
            }}
            className="glass pointer-events-auto flex w-full max-w-xl cursor-pointer items-center justify-between gap-3 rounded-full px-4 py-3 text-sm text-foreground/90 shadow-[0_8px_30px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.04)] transition-all hover:border-primary/30 hover:brightness-110 backdrop-blur-2xl"
          >
            <div className="flex items-center gap-3">
               <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary/80 ring-1 ring-border/70">
                <Activity className="h-4 w-4 text-muted-foreground/80" />
              </div>
              <div>
                <span className="font-medium text-foreground/80">Activity</span>
                <p className="text-[11px] text-muted-foreground">No active downloads</p>
              </div>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (e.nativeEvent) e.nativeEvent.stopImmediatePropagation()
                setAddGameOpen(true)
              }}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-secondary text-muted-foreground transition-all hover:border-border hover:brightness-125 hover:text-foreground active:scale-95"
              aria-label="Add external game"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
        <AddGameModal
          open={addGameOpen}
          onOpenChange={(open) => { setAddGameOpen(open); if (!open) setAddGameInitialSource(null) }}
          initialSource={addGameInitialSource ?? undefined}
        />
      </>
    )
  }

  const { displayName, phase, progress, etaSeconds, partNum, partTotal, isPaused, isQueuedOnly, queuedCount, primaryAppid, firstDownloadingId, secondaryActivityLabel, secondaryActivityDetail, secondaryActivityName, secondaryActivityPhase, canToggle } = downBarData

  const formatEta = (seconds: number | null) => {
    if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null
    if (seconds < 60) return `${Math.round(seconds)}s left`
    if (seconds < 3600) return `${Math.round(seconds / 60)}m left`
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.round((seconds % 3600) / 60)
    return minutes > 0 ? `${hours}h ${minutes}m left` : `${hours}h left`
  }

  const etaLabel = formatEta(etaSeconds)

  const handleToggle = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (isPaused) {
      if (primaryAppid) void resumeGroup(primaryAppid)
      return
    }
    if (firstDownloadingId) void pauseDownload(firstDownloadingId)
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
          className="glass pointer-events-auto flex w-full max-w-xl cursor-pointer items-center gap-4 rounded-full px-4 py-3 text-sm text-foreground/90 shadow-[0_8px_30px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.04)] transition-all hover:border-primary/30 hover:brightness-110 backdrop-blur-2xl"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-4">
              <div className="min-w-0 flex flex-1 items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 ring-1 ring-border/70">
                  <Activity className="h-4 w-4 text-foreground" />
                </div>
                <div className="min-w-0">
                  <span className="block max-w-[140px] truncate text-sm font-bold text-foreground">{displayName}</span>
                  <span className="block text-[11px] text-muted-foreground/80">
                    {isPaused
                      ? `Paused${queuedCount > 0 ? ` · ${queuedCount} queued` : ""}`
                      : isQueuedOnly
                        ? "Queued"
                        : partTotal > 1
                          ? `${phase} · ${partNum}/${partTotal}${secondaryActivityLabel ? ` · ${secondaryActivityLabel}` : ""}`
                          : `${phase}${secondaryActivityLabel ? ` · ${secondaryActivityLabel}` : ""}`}
                  </span>
                  {etaLabel ? <span className="block text-[10px] text-muted-foreground/60">ETA {etaLabel}</span> : null}
                </div>
              </div>

              <div className="flex min-w-[100px] flex-1 items-center gap-3">
                <div className="flex-1">
                  <Progress value={progress} className="h-1.5 bg-secondary [&_[data-slot=progress-indicator]]:bg-primary" />
                </div>
                <span className="shrink-0 text-xs font-mono font-bold tabular-nums text-muted-foreground">{formatPercent(progress)}</span>
              </div>
            </div>

            {secondaryActivityDetail && secondaryActivityName && secondaryActivityPhase ? (
              <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-secondary/40 px-3 py-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary ring-1 ring-white/[.06]">
                  {secondaryActivityPhase === "Extracting" ? (
                    <HardDrive className="h-3.5 w-3.5 text-foreground/80" />
                  ) : (
                    <Download className="h-3.5 w-3.5 text-foreground/80" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-medium text-foreground/90">{secondaryActivityName}</span>
                  <span className="block truncate text-[10px] text-muted-foreground/80">{secondaryActivityDetail}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground/80">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/35 opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary/70" />
                  </span>
                  <span>{secondaryActivityPhase}</span>
                </div>
              </div>
            ) : null}
          </div>

          {/* Actions */}
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleToggle}
              disabled={!canToggle}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border/70 bg-secondary text-muted-foreground transition-all hover:border-border hover:brightness-125 hover:text-foreground active:scale-95"
              aria-label={isPaused ? "Resume downloads" : "Pause downloads"}
            >
              {isPaused ? <Play className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (e.nativeEvent) e.nativeEvent.stopImmediatePropagation()
                setAddGameOpen(true)
              }}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border/70 bg-secondary text-muted-foreground transition-all hover:border-border hover:brightness-125 hover:text-foreground active:scale-95"
              aria-label="Add external game"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      <AddGameModal open={addGameOpen} onOpenChange={setAddGameOpen} />
    </>
  )
}
