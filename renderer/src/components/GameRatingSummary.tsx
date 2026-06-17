"use client"

import { useEffect, useState } from "react"
import { Monitor } from "lucide-react"
import { Terminal, Star } from "@/components/icons"
import { apiFetch } from "@/lib/api"

type Stats = {
  count: number
  average: number
  distribution: Record<number, number>
  platforms?: { windows: number; linux: number }
}

function Stars({ value }: { value: number }) {
  return (
    <div className="inline-flex items-center text-base leading-none" aria-label={`${value.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = Math.max(0, Math.min(1, value - (n - 1)))
        return (
          <span key={n} className="relative inline-block text-muted-foreground/25">
            ★
            <span className="absolute inset-0 overflow-hidden text-yellow-500" style={{ width: `${fill * 100}%` }}>★</span>
          </span>
        )
      })}
    </div>
  )
}

/**
 * Compact "rating quick-view" for the game page's right column (launcher copy):
 * average stars, how many ratings, and the Windows/Linux split — so the rating
 * reads at a glance without opening the Community tab. Clicking opens the full
 * rating panel via `onOpen`.
 */
export function GameRatingSummary({ appid, onOpen }: { appid: string; onOpen?: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!appid) return
    let cancelled = false
    apiFetch(`/api/experiences/${appid}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return
        if (j?.success && j.stats) setStats(j.stats as Stats)
      })
      .catch(() => { })
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [appid])

  if (!loaded) {
    return (
      <div className="rounded-3xl bg-background/60 border border-white/[.07] backdrop-blur-md shadow-xl p-5">
        <div className="h-3 w-20 rounded bg-white/5 animate-pulse mb-3" />
        <div className="h-8 w-32 rounded bg-white/5 animate-pulse" />
      </div>
    )
  }

  const count = stats?.count ?? 0
  const average = stats?.average ?? 0
  const windows = stats?.platforms?.windows ?? 0
  const linux = stats?.platforms?.linux ?? 0
  const osTotal = windows + linux
  const winPct = osTotal ? Math.round((windows / osTotal) * 100) : 0
  const linPct = osTotal ? 100 - winPct : 0

  const Wrapper: any = onOpen ? "button" : "div"

  if (count === 0) {
    return (
      <Wrapper
        {...(onOpen ? { type: "button", onClick: onOpen } : {})}
        className="w-full text-left rounded-3xl bg-background/60 border border-white/[.07] backdrop-blur-md shadow-xl p-5 transition-colors hover:bg-background/80"
      >
        <div className="flex items-center gap-2 text-yellow-500/80 mb-1">
          <Star className="h-4 w-4" />
          <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Rating</span>
        </div>
        <div className="text-sm font-semibold text-foreground/90">No ratings yet</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {onOpen ? "Be the first to rate this game →" : "Be the first to rate this game"}
        </div>
      </Wrapper>
    )
  }

  return (
    <Wrapper
      {...(onOpen ? { type: "button", onClick: onOpen } : {})}
      className="w-full text-left rounded-3xl bg-background/60 border border-white/[.07] backdrop-blur-md shadow-xl p-5 transition-colors hover:bg-background/80"
    >
      <div className="flex items-center gap-2 mb-3">
        <Star className="h-4 w-4 text-yellow-500" />
        <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Rating</span>
        {onOpen && <span className="ml-auto text-[11px] text-muted-foreground/60">Quick view →</span>}
      </div>

      <div className="flex items-center gap-3">
        <div className="text-3xl font-black text-foreground tabular-nums leading-none">{average.toFixed(1)}</div>
        <div className="space-y-1">
          <Stars value={average} />
          <div className="text-[11px] text-muted-foreground tabular-nums">
            {count} {count === 1 ? "rating" : "ratings"}
          </div>
        </div>
      </div>

      {osTotal > 0 && (
        <div className="mt-4 space-y-1.5">
          <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-white/[.06]">
            <div className="h-full bg-cyan-400/70" style={{ width: `${winPct}%` }} />
            <div className="h-full bg-sky-500/70" style={{ width: `${linPct}%` }} />
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
            <span className="inline-flex items-center gap-1">
              <Monitor className="h-3 w-3 text-cyan-300" /> Windows {winPct}%
            </span>
            <span className="inline-flex items-center gap-1">
              <Terminal className="h-3 w-3 text-sky-300" /> Linux {linPct}%
            </span>
          </div>
        </div>
      )}
    </Wrapper>
  )
}

export default GameRatingSummary
