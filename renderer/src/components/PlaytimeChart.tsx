import { useEffect, useMemo, useState } from "react"
import { Clock, Maximize2 } from "lucide-react"
import { apiFetch } from "@/lib/api"
import { useAuth } from "@/hooks/useAuth"
import { PlaytimeDetailModal } from "@/components/PlaytimeDetailModal"

type Bucket = { day: string; seconds: number; sessions: number }

const DEFAULT_DAYS = 30

function formatHoursShort(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.floor(seconds))}s`
  const minutes = seconds / 60
  if (minutes < 60) return `${minutes.toFixed(minutes < 10 ? 1 : 0)}m`
  const hours = minutes / 60
  return `${hours.toFixed(hours < 10 ? 1 : 0)}h`
}

function formatHumanRange(buckets: Bucket[]): string {
  if (buckets.length === 0) return ""
  const total = buckets.reduce((sum, b) => sum + b.seconds, 0)
  const sessions = buckets.reduce((sum, b) => sum + b.sessions, 0)
  if (total === 0) return "No play sessions in this window."
  return `${formatHoursShort(total)} across ${sessions} session${sessions === 1 ? "" : "s"}`
}

function formatDayLabel(day: string): string {
  const d = new Date(day + "T00:00:00Z")
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - d.getTime()) / (24 * 3600 * 1000))
  if (diff === 0) return "Today"
  if (diff === 1) return "Yesterday"
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

type Props = {
  appid: string
  className?: string
  days?: number
  gameName?: string | null
  gameImage?: string | null
}

/**
 * Per-game playtime sparkline. Fetches /api/playtime/chart for the signed-in
 * user, draws a 30-day daily-seconds bar chart with a hover tooltip and a
 * compact summary line ("4h 12m across 7 sessions"). Hidden entirely when
 * the user has no recorded sessions for this game.
 */
export function PlaytimeChart({ appid, className, days = DEFAULT_DAYS, gameName, gameImage }: Props) {
  const [auth] = useAuth()
  const [buckets, setBuckets] = useState<Bucket[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hovered, setHovered] = useState<Bucket | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  useEffect(() => {
    if (!appid || !auth.isAuthenticated) {
      setBuckets(null)
      setError(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await apiFetch(`/api/playtime/chart?appid=${encodeURIComponent(appid)}&days=${days}`)
        if (cancelled) return
        if (res.status === 401) {
          setBuckets(null)
          setError("auth")
          return
        }
        if (!res.ok) {
          setBuckets([])
          setError("server")
          return
        }
        const data = await res.json().catch(() => null)
        if (data?.ok && Array.isArray(data.buckets)) {
          setBuckets(data.buckets as Bucket[])
          setError(null)
        } else {
          setBuckets([])
          setError("server")
        }
      } catch {
        if (!cancelled) {
          setBuckets([])
          setError("network")
        }
      }
    })()
    return () => { cancelled = true }
  }, [appid, days, auth.isAuthenticated])

  const max = useMemo(() => {
    if (!buckets) return 0
    return buckets.reduce((m, b) => (b.seconds > m ? b.seconds : m), 0)
  }, [buckets])

  // Hide entirely when there's nothing meaningful to show:
  //   - not signed in (chart is per-user)
  //   - server / network error (we already have a presence heartbeat ribbon,
  //     no point adding another)
  //   - all buckets at zero
  if (!auth.isAuthenticated) return null
  if (buckets === null) {
    return (
      <div className={`px-3.5 py-2.5 rounded-2xl bg-card/60 border border-white/[.07] backdrop-blur-md space-y-2 shadow-md ${className ?? ""}`}>
        <div className="udl-skeleton h-3 w-24 rounded" />
        <div className="udl-skeleton h-12 w-full rounded" />
      </div>
    )
  }
  if (buckets.length === 0 || max === 0) return null

  const labelInterval = Math.max(1, Math.ceil(buckets.length / 6))

  return (
    <>
    <div
      className={`group relative cursor-pointer px-3.5 py-2.5 rounded-2xl bg-card/60 border border-white/[.07] backdrop-blur-md space-y-2 shadow-md transition-colors hover:border-white/[.14] ${className ?? ""}`}
      role="button"
      tabIndex={0}
      onClick={() => setDetailOpen(true)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetailOpen(true) } }}
      aria-label="Open playtime details"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground inline-flex items-center gap-1.5">
          <Clock className="h-3 w-3" />
          Playtime · {days}d
          <Maximize2 className="h-3 w-3 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100" />
        </h3>
        <span className="text-[10px] text-muted-foreground/80 tabular-nums">
          {formatHumanRange(buckets)}
        </span>
      </div>

      <div
        className="relative flex items-end gap-[2px] h-12"
        onMouseLeave={() => setHovered(null)}
      >
        {buckets.map((bucket) => {
          const pct = max > 0 ? (bucket.seconds / max) * 100 : 0
          const isHover = hovered?.day === bucket.day
          const isActive = bucket.seconds > 0
          return (
            <div
              key={bucket.day}
              onMouseEnter={() => setHovered(bucket)}
              className="flex-1 flex flex-col justify-end h-full min-w-0 cursor-default"
              title={`${formatDayLabel(bucket.day)} · ${formatHoursShort(bucket.seconds)}`}
            >
              <div
                className={`w-full rounded-sm transition-colors ${
                  isActive
                    ? (isHover ? "bg-emerald-300" : "bg-emerald-500/70")
                    : "bg-white/[.05]"
                }`}
                style={{ height: `${Math.max(isActive ? 8 : 2, pct)}%` }}
              />
            </div>
          )
        })}
      </div>

      {/* Axis labels (sparse so they don't crowd) + hovered-day callout. */}
      <div className="flex items-end justify-between text-[10px] text-muted-foreground/80">
        <div className="flex-1 flex justify-between">
          {buckets.map((bucket, idx) => (
            <span
              key={`${bucket.day}-label`}
              className={`tabular-nums ${idx % labelInterval === 0 ? "" : "opacity-0"}`}
            >
              {formatDayLabel(bucket.day).replace(/^(Today|Yesterday)$/, (m) => m === "Today" ? "Tdy" : "Ydy")}
            </span>
          ))}
        </div>
      </div>

      {/* Fixed-height hovered-day readout. Always rendered (only its content
          toggles) so hovering a bar fills it in place instead of inserting a
          row that shifts every card below it in and out. */}
      <div className="flex items-center h-4 text-[11px] tabular-nums whitespace-nowrap overflow-hidden">
        {hovered && hovered.seconds > 0 && (
          <span>
            <span className="text-white font-medium">{formatDayLabel(hovered.day)}</span>
            <span className="text-muted-foreground/80"> · {formatHoursShort(hovered.seconds)}</span>
            <span className="text-muted-foreground/80"> · {hovered.sessions} session{hovered.sessions === 1 ? "" : "s"}</span>
          </span>
        )}
      </div>
    </div>
    <PlaytimeDetailModal
      open={detailOpen}
      onClose={() => setDetailOpen(false)}
      mode="you"
      days={days}
      gameName={gameName}
      gameImage={gameImage}
      buckets={buckets}
    />
    </>
  )
}
