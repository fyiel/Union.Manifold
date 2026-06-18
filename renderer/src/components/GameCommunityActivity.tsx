import { useCallback, useEffect, useState, type ReactNode } from "react"
import { Clock, HardDrive, Heart, Bookmark, Activity } from "lucide-react"
import { apiFetch } from "@/lib/api"
import { proxyImageUrl } from "@/lib/utils"

/**
 * Desktop counterparts of the web's GameTopPlayers / GameCommunityActivity
 * (see union-crax.xyz components/game-viewer-state.tsx). They hit the same
 * `/api/games/:appid/top-players` and `/community-activity` endpoints via
 * `apiFetch`, so the launcher's game page shows the same social context the
 * website does. Both self-hide when there's nothing to show.
 */

function formatPlaytime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const remMin = m % 60
  return remMin === 0 ? `${h}h` : `${h}h ${remMin}m`
}

function timeAgoShort(iso: string | null): string {
  if (!iso) return ""
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return "just now"
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}

const TONE_CLASSES = {
  cyan: "border-cyan-400/20 bg-cyan-500/10 text-cyan-200",
  emerald: "border-emerald-400/20 bg-emerald-500/10 text-emerald-200",
  amber: "border-amber-400/20 bg-amber-500/10 text-amber-200",
  rose: "border-rose-400/20 bg-rose-500/10 text-rose-200",
} as const
type Tone = keyof typeof TONE_CLASSES

function Avatar({ url, name, size = "h-8 w-8" }: { url: string | null; name?: string | null; size?: string }) {
  if (url) {
    return (
      <img
        src={proxyImageUrl(url)}
        alt=""
        className={`${size} rounded-full object-cover border border-white/[.07] shrink-0`}
        loading="lazy"
      />
    )
  }
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?"
  return (
    <div
      className={`${size} rounded-full bg-secondary/60 border border-white/[.07] shrink-0 flex items-center justify-center`}
      style={{ containerType: "inline-size" }}
    >
      <span aria-hidden className="font-semibold uppercase leading-none text-muted-foreground/80" style={{ fontSize: "45cqw" }}>
        {initial}
      </span>
    </div>
  )
}

function UcPlus() {
  return (
    <span className="shrink-0 rounded-md bg-cyan-500/15 border border-cyan-400/30 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-200">
      UC+
    </span>
  )
}

type NowPlayingPlayer = {
  userId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  sessionStartedAt: string | null
}

/**
 * Live "N playing now" indicator — desktop counterpart of the web's
 * GameNowPlaying (components/game-viewer-state.tsx). Hits the shared
 * `/api/games/:appid/now-playing` endpoint and shows an anonymous in-game count
 * plus an avatar stack of players who share their activity. Self-hides when
 * nobody is currently in the game. Meant to sit inline near the game title.
 */
export function GameNowPlaying({ appid, className = "" }: { appid: string; className?: string }) {
  const [count, setCount] = useState(0)
  const [players, setPlayers] = useState<NowPlayingPlayer[]>([])

  useEffect(() => {
    if (!appid) return
    let cancelled = false
    const load = async () => {
      try {
        const res = await apiFetch(`/api/games/${encodeURIComponent(appid)}/now-playing?limit=8`)
        if (cancelled || !res.ok) return
        const data = await res.json().catch(() => null)
        if (cancelled || !data) return
        setCount(Number(data.count || 0))
        setPlayers(Array.isArray(data.players) ? data.players : [])
      } catch {
        /* keep last good value */
      }
    }
    void load()
    // Presence TTL is 3 min — a slow poll keeps the count fresh without churn.
    const interval = window.setInterval(load, 45_000)
    const onFocus = () => void load()
    window.addEventListener("focus", onFocus)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener("focus", onFocus)
    }
  }, [appid])

  if (count <= 0) return null

  const shown = players.slice(0, 5)
  const extra = count - shown.length

  return (
    <div
      className={`inline-flex items-center gap-2.5 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1.5 ${className}`}
      title={`${count} ${count === 1 ? "person is" : "people are"} playing right now`}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
      </span>
      {shown.length > 0 && (
        <div className="flex -space-x-2">
          {shown.map((p) => (
            <div key={p.userId} className="ring-1 ring-emerald-400/20 rounded-full">
              <Avatar url={p.avatarUrl} name={p.displayName || p.username} size="h-6 w-6" />
            </div>
          ))}
        </div>
      )}
      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-200">
        {count} in game now
        {extra > 0 && shown.length > 0 ? <span className="text-emerald-200/70"> +{extra}</span> : null}
      </span>
    </div>
  )
}

type TopPlayer = {
  rank: number
  userId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  totalSeconds: number
  ucPlus: boolean
}

export function GameTopPlayers({ appid, limit = 5 }: { appid: string; limit?: number }) {
  const [players, setPlayers] = useState<TopPlayer[] | null>(null)

  useEffect(() => {
    if (!appid) return
    let cancelled = false
    void (async () => {
      try {
        const res = await apiFetch(`/api/games/${encodeURIComponent(appid)}/top-players?limit=${limit}`)
        if (cancelled) return
        if (!res.ok) { setPlayers([]); return }
        const data = await res.json().catch(() => null)
        if (!cancelled) setPlayers(Array.isArray(data?.players) ? data.players : [])
      } catch {
        if (!cancelled) setPlayers([])
      }
    })()
    return () => { cancelled = true }
  }, [appid, limit])

  if (!players || players.length === 0) return null

  return (
    <div className="p-5 rounded-2xl bg-card/60 border border-white/[.07] backdrop-blur-md shadow-md">
      <h3 className="font-black text-white tracking-tight mb-4">Top players for this game</h3>
      <ol className="space-y-3">
        {players.map((player) => (
          <li key={player.userId} className="flex items-center gap-3">
            <span className="w-5 text-center text-[11px] font-bold text-muted-foreground tabular-nums">{player.rank}</span>
            <Avatar url={player.avatarUrl} name={player.displayName || player.username} />
            <div className="min-w-0 flex-1 flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-white">{player.displayName || player.username}</span>
              {player.ucPlus && <UcPlus />}
            </div>
            <span className="text-[11px] font-bold uppercase tracking-wider tabular-nums text-cyan-200/80 shrink-0">
              {formatPlaytime(player.totalSeconds)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

type ActivityType = "wishlisted" | "liked" | "installed" | "played"
type ActivityEvent = {
  type: ActivityType
  userId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  timestamp: string | null
  playtimeSeconds: number | null
  ucPlus: boolean
}

const ACTIVITY_META: Record<ActivityType, { label: (e: ActivityEvent) => string; icon: ReactNode; tone: Tone }> = {
  wishlisted: { label: () => "added to wishlist", icon: <Bookmark className="h-3 w-3 shrink-0" />, tone: "amber" },
  liked: { label: () => "liked this game", icon: <Heart className="h-3 w-3 shrink-0" />, tone: "rose" },
  installed: { label: () => "installed via UC.Direct", icon: <HardDrive className="h-3 w-3 shrink-0" />, tone: "emerald" },
  played: {
    label: (e) => (e.playtimeSeconds != null && e.playtimeSeconds > 0 ? `played for ${formatPlaytime(e.playtimeSeconds)}` : "played this game"),
    icon: <Clock className="h-3 w-3 shrink-0" />,
    tone: "cyan",
  },
}

export function GameCommunityActivity({ appid, pageSize = 10 }: { appid: string; pageSize?: number }) {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  // Reset + load the first page whenever the game changes.
  useEffect(() => {
    if (!appid) return
    let cancelled = false
    setEvents(null)
    setHasMore(false)
    void (async () => {
      try {
        const res = await apiFetch(`/api/games/${encodeURIComponent(appid)}/community-activity?limit=${pageSize}&offset=0`)
        if (cancelled) return
        if (!res.ok) { setEvents([]); return }
        const data = await res.json().catch(() => null)
        const list = Array.isArray(data?.events) ? (data.events as ActivityEvent[]) : []
        if (!cancelled) {
          setEvents(list)
          setHasMore(list.length === pageSize)
        }
      } catch {
        if (!cancelled) setEvents([])
      }
    })()
    return () => { cancelled = true }
  }, [appid, pageSize])

  // Append the next page (offset = however many we already hold).
  const loadMore = useCallback(async () => {
    if (loadingMore || !events) return
    setLoadingMore(true)
    try {
      const res = await apiFetch(`/api/games/${encodeURIComponent(appid)}/community-activity?limit=${pageSize}&offset=${events.length}`)
      if (!res.ok) { setHasMore(false); return }
      const data = await res.json().catch(() => null)
      const list = Array.isArray(data?.events) ? (data.events as ActivityEvent[]) : []
      setEvents((prev) => [...(prev ?? []), ...list])
      setHasMore(list.length === pageSize)
    } catch {
      setHasMore(false)
    } finally {
      setLoadingMore(false)
    }
  }, [appid, events, pageSize, loadingMore])

  if (!events || events.length === 0) return null

  return (
    <div className="p-5 rounded-2xl bg-card/60 border border-white/[.07] backdrop-blur-md shadow-md">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="h-4 w-4 text-muted-foreground/70 shrink-0" />
        <h3 className="font-black text-white tracking-tight">Community Activity</h3>
      </div>
      <ul className="space-y-3 max-h-[420px] overflow-y-auto pr-1 -mr-1">
        {events.map((event, i) => {
          const meta = ACTIVITY_META[event.type]
          if (!meta) return null
          return (
            <li key={`${event.userId}-${event.type}-${i}`} className="flex items-center gap-3 min-w-0">
              <Avatar url={event.avatarUrl} name={event.displayName || event.username} size="h-7 w-7" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                  <span className="truncate text-sm font-semibold text-white">{event.displayName || event.username}</span>
                  {event.ucPlus && <UcPlus />}
                  <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${TONE_CLASSES[meta.tone]} rounded-full border px-2 py-0.5 shrink-0`}>
                    {meta.icon}
                    {meta.label(event)}
                  </span>
                </div>
              </div>
              {event.timestamp && (
                <span className="text-[10px] font-medium text-muted-foreground/60 shrink-0 tabular-nums">
                  {timeAgoShort(event.timestamp)}
                </span>
              )}
            </li>
          )
        })}
      </ul>
      {hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-full border border-white/[.1] bg-white/[.03] px-4 py-1.5 text-[12px] font-semibold text-foreground/80 hover:bg-white/[.07] hover:text-white transition-colors disabled:opacity-60"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  )
}
