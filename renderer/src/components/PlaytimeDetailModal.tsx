import { useState } from "react"
import { Clock, Users, Gamepad2, CalendarDays, Flame, Activity } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { proxyImageUrl } from "@/lib/utils"

export type DetailBucket = { day: string; seconds: number; sessions: number; players?: number }

type Props = {
  open: boolean
  onClose: () => void
  /** "you" = the viewer's own per-game chart, "community" = aggregated. */
  mode: "you" | "community"
  days: number
  gameName?: string | null
  gameImage?: string | null
  buckets: DetailBucket[]
  /** Distinct players over the window — community mode only. */
  players?: number
}

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`
}

function formatHoursShort(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.floor(seconds))}s`
  const minutes = seconds / 60
  if (minutes < 60) return `${minutes.toFixed(minutes < 10 ? 1 : 0)}m`
  const hours = minutes / 60
  return `${hours.toFixed(hours < 10 ? 1 : 0)}h`
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

function formatFullDate(day: string): string {
  return new Date(day + "T00:00:00Z").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/[.07] bg-card/40 px-3 py-2.5">
      <div className="text-lg font-black tabular-nums text-foreground leading-none">{value}</div>
      <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">{label}</div>
    </div>
  )
}

function BreakdownRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-white/[.05] last:border-b-0">
      <span className="text-xs font-medium text-muted-foreground/80">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-foreground text-right">{value}</span>
    </div>
  )
}

/**
 * Detailed playtime popup shown when a user clicks either the "You" or the
 * "Community" playtime chart on a game page. Surfaces game art, headline
 * stats, a larger interactive bar chart, and a derived breakdown (busiest
 * day, averages, players). Kept 1:1 with the web's playtime-detail-modal.
 */
export function PlaytimeDetailModal({ open, onClose, mode, days, gameName, gameImage, buckets, players = 0 }: Props) {
  const [hovered, setHovered] = useState<DetailBucket | null>(null)

  const total = buckets.reduce((s, b) => s + b.seconds, 0)
  const sessions = buckets.reduce((s, b) => s + b.sessions, 0)
  const activeBuckets = buckets.filter((b) => b.seconds > 0)
  const activeDays = activeBuckets.length
  const busiest = activeBuckets.reduce<DetailBucket | null>(
    (best, b) => (!best || b.seconds > best.seconds ? b : best),
    null,
  )
  const avgPerActiveDay = activeDays ? total / activeDays : 0
  const avgPerSession = sessions ? total / sessions : 0
  const avgPerPlayer = players > 0 ? total / players : 0
  const max = buckets.reduce((m, b) => (b.seconds > m ? b.seconds : m), 0)
  const labelInterval = Math.max(1, Math.ceil(buckets.length / 8))

  const isCommunity = mode === "community"
  const title = gameName || "This game"
  const subtitle = isCommunity ? "Community playtime" : "Your playtime"
  const art = gameImage ? (proxyImageUrl(gameImage) || null) : null

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-4 pr-8">
            {art ? (
              <img
                src={art}
                alt=""
                className="h-16 w-28 shrink-0 rounded-xl object-cover border border-white/[.08] shadow-md"
                loading="lazy"
              />
            ) : (
              <div className="h-16 w-28 shrink-0 rounded-xl border border-white/[.08] bg-secondary/50 flex items-center justify-center">
                <Gamepad2 className="h-6 w-6 text-muted-foreground/50" />
              </div>
            )}
            <div className="min-w-0">
              <DialogTitle className="truncate text-left">{title}</DialogTitle>
              <DialogDescription className="flex items-center gap-1.5 text-left">
                {isCommunity ? <Users className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                {subtitle} · last {days} days
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Headline stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <StatTile label="Total" value={formatDuration(total)} />
          <StatTile label="Sessions" value={sessions.toLocaleString()} />
          <StatTile label="Active days" value={activeDays.toLocaleString()} />
          {isCommunity ? (
            <StatTile label="Players" value={players.toLocaleString()} />
          ) : (
            <StatTile label="Avg / session" value={sessions ? formatDuration(avgPerSession) : "—"} />
          )}
        </div>

        {/* Larger interactive chart */}
        <div className="rounded-2xl border border-white/[.07] bg-card/40 px-4 py-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground inline-flex items-center gap-1.5">
              <Activity className="h-3 w-3" />
              Daily breakdown
            </h3>
            <span className="text-[10px] text-muted-foreground/80 tabular-nums">
              {formatHoursShort(total)} · {sessions} session{sessions === 1 ? "" : "s"}
            </span>
          </div>
          <div className="relative flex items-end gap-[2px] h-32" onMouseLeave={() => setHovered(null)}>
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
                      isActive ? (isHover ? "bg-emerald-300" : "bg-emerald-500/70") : "bg-white/[.05]"
                    }`}
                    style={{ height: `${Math.max(isActive ? 6 : 2, pct)}%` }}
                  />
                </div>
              )
            })}
          </div>
          <div className="flex items-end justify-between text-[10px] text-muted-foreground/80">
            <div className="flex-1 flex justify-between">
              {buckets.map((bucket, idx) => (
                <span
                  key={`${bucket.day}-label`}
                  className={`tabular-nums ${idx % labelInterval === 0 ? "" : "opacity-0"}`}
                >
                  {formatDayLabel(bucket.day).replace(/^(Today|Yesterday)$/, (m) => (m === "Today" ? "Tdy" : "Ydy"))}
                </span>
              ))}
            </div>
          </div>
          {/* Fixed-height readout so hovering doesn't resize the modal. */}
          <div className="flex items-center h-4 text-[11px] tabular-nums whitespace-nowrap overflow-hidden">
            {hovered && hovered.seconds > 0 && (
              <span>
                <span className="text-white font-medium">{formatDayLabel(hovered.day)}</span>
                <span className="text-muted-foreground/80"> · {formatHoursShort(hovered.seconds)}</span>
                <span className="text-muted-foreground/80"> · {hovered.sessions} session{hovered.sessions === 1 ? "" : "s"}</span>
                {isCommunity && hovered.players != null && hovered.players > 0 && (
                  <span className="text-muted-foreground/80"> · {hovered.players} player{hovered.players === 1 ? "" : "s"}</span>
                )}
              </span>
            )}
          </div>
        </div>

        {/* Derived breakdown */}
        <div className="rounded-2xl border border-white/[.07] bg-card/40 px-4 py-1">
          <BreakdownRow
            label="Busiest day"
            value={busiest ? `${formatFullDate(busiest.day)} · ${formatDuration(busiest.seconds)}` : "—"}
          />
          <BreakdownRow label="Avg / active day" value={activeDays ? formatDuration(avgPerActiveDay) : "—"} />
          <BreakdownRow label="Avg session length" value={sessions ? formatDuration(avgPerSession) : "—"} />
          {isCommunity && <BreakdownRow label="Avg / player" value={players > 0 ? formatDuration(avgPerPlayer) : "—"} />}
        </div>

        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
          <CalendarDays className="h-3 w-3" />
          {activeDays > 0 ? (
            <>
              {isCommunity ? "Community sessions" : "Sessions"} from {formatFullDate(activeBuckets[0].day)} to{" "}
              {formatFullDate(activeBuckets[activeBuckets.length - 1].day)}
            </>
          ) : (
            <>No sessions recorded in the last {days} days.</>
          )}
          {busiest && <Flame className="h-3 w-3 ml-1 text-amber-400/80" />}
        </p>
      </DialogContent>
    </Dialog>
  )
}
