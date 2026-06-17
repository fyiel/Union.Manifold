"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Clock, MessageSquare } from "lucide-react"
import { X, Star } from "@/components/icons"
import { apiFetch } from "@/lib/api"

type ViewerState = {
  authenticated: boolean
  playtimeSeconds: number
  installed: boolean
}

// Local copy of the shared playtime formatter (kept inline to match the other
// launcher community components, which each define their own).
function formatPlaytime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const remMin = m % 60
  if (remMin === 0) return `${h}h`
  return `${h}h ${remMin}m`
}

function dismissKey(appid: string) {
  return `uc_exp_prompt_dismissed_${appid}`
}

/**
 * "You've played X for Y — mind leaving a review?" nudge (launcher copy).
 *
 * Renders only for signed-in members who have actually played the game. The
 * CTAs hand control back to GameDetailPage so it can switch to the Community
 * tab and scroll to the comment box or the rating panel. Dismissals are
 * remembered per-game.
 */
export function GameExperiencePrompt({
  appid,
  gameName,
  onLeaveComment,
  onRate,
}: {
  appid: string
  gameName: string
  onLeaveComment: () => void
  onRate?: () => void
}) {
  const [state, setState] = useState<ViewerState | null>(null)
  // Read the per-game dismissal flag up front via a lazy initializer (no
  // setState-in-effect). GameDetailPage renders this with key={appid}, so
  // navigating to another game remounts and re-reads the flag for that game.
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    try { return localStorage.getItem(dismissKey(appid)) === "1" } catch { return false }
  })

  useEffect(() => {
    if (!appid || dismissed) return
    let cancelled = false
    void (async () => {
      try {
        const res = await apiFetch(`/api/games/${encodeURIComponent(appid)}/viewer-state`)
        if (cancelled) return
        if (!res.ok) { setState(null); return }
        const data = (await res.json().catch(() => null)) as ViewerState | null
        if (!cancelled && data) setState(data)
      } catch {
        if (!cancelled) setState(null)
      }
    })()
    return () => { cancelled = true }
  }, [appid, dismissed])

  const dismiss = () => {
    setDismissed(true)
    try {
      if (typeof window !== "undefined") localStorage.setItem(dismissKey(appid), "1")
    } catch { /* storage may be unavailable; the in-memory flag still hides it */ }
  }

  if (dismissed) return null
  if (!state || !state.authenticated || state.playtimeSeconds <= 0) return null

  return (
    <div className="relative overflow-hidden rounded-3xl border border-cyan-400/20 bg-gradient-to-r from-cyan-500/[.08] via-card/60 to-card/60 backdrop-blur-md px-5 py-4 shadow-xl">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full text-muted-foreground/50 hover:bg-white/[.06] hover:text-foreground transition-colors"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 pr-8">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-cyan-500/10 border border-cyan-400/20 text-cyan-300">
          <Clock className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-foreground">
            You&apos;ve played {gameName} for {formatPlaytime(state.playtimeSeconds)}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {state.installed
              ? "Installed via UC.Direct — how's it running? Rate it or drop a comment for other players."
              : "Mind sharing how it went? Rate it or leave a comment for other players."}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {onRate && (
            <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={onRate}>
              <Star className="h-3.5 w-3.5" />
              Rate it
            </Button>
          )}
          <Button size="sm" className="gap-1.5 h-8" onClick={onLeaveComment}>
            <MessageSquare className="h-3.5 w-3.5" />
            Leave a comment
          </Button>
        </div>
      </div>
    </div>
  )
}

export default GameExperiencePrompt
