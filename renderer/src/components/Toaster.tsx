import { useEffect, useState } from "react"
import { X } from "@/components/icons"
import { CheckCircle2, XCircle } from "lucide-react"
import { Info } from "@/components/icons"
import { type ToastItem, type ToastType, useToast } from "@/context/toast-context"

function ToastItemView({ item }: { item: ToastItem }) {
  const { dismiss } = useToast()
  const [exiting, setExiting] = useState(false)
  // Tick a 1-second clock for the action countdown. Only ticks while the
  // toast has an action and a duration > 1s, so it costs nothing for
  // ordinary fire-and-forget toasts.
  const [secondsLeft, setSecondsLeft] = useState<number>(() => Math.ceil(item.duration / 1000))

  useEffect(() => {
    const exitTimer = setTimeout(() => setExiting(true), item.duration)
    return () => clearTimeout(exitTimer)
  }, [item.duration])

  useEffect(() => {
    if (!item.action || item.duration < 1500) return
    const start = Date.now()
    const interval = setInterval(() => {
      const elapsed = Date.now() - start
      const remaining = Math.max(0, Math.ceil((item.duration - elapsed) / 1000))
      setSecondsLeft(remaining)
      if (remaining <= 0) clearInterval(interval)
    }, 250)
    return () => clearInterval(interval)
  }, [item.action, item.duration])

  const isError = item.type === "error"
  const isSuccess = item.type === "success"

  const Icon = isError ? XCircle : isSuccess ? CheckCircle2 : Info

  return (
    <div
      className={`
        relative overflow-hidden flex items-center gap-3 px-5 py-3 rounded-full shadow-2xl border
        text-sm font-medium transition-all duration-500
        ${exiting ? "opacity-0 translate-y-2" : "opacity-100 translate-y-0 anim"}
        ${isError
          ? "bg-card border-red-500/30 text-red-400"
          : "bg-card border-border text-foreground/90"
        }
      `}
    >
      <Icon className={`h-4 w-4 shrink-0 ${isError ? "text-red-400" : isSuccess ? "text-foreground/80" : "text-muted-foreground"}`} />
      <span>{item.message}</span>
      {item.action && (
        <button
          onClick={() => {
            try { item.action?.onClick() } catch { /* ignore */ }
            dismiss(item.id)
          }}
          className="ml-1 rounded-full bg-white/[.05] hover:bg-white/[.12] px-2.5 py-0.5 text-xs font-semibold text-emerald-300 transition-colors active:scale-95 inline-flex items-center gap-1"
        >
          <span>{item.action.label}</span>
          {item.duration >= 1500 && secondsLeft > 0 && (
            <span className="text-emerald-400/70 font-mono tabular-nums">{secondsLeft}s</span>
          )}
        </button>
      )}
      <button
        onClick={() => dismiss(item.id)}
        className="ml-1 rounded-full p-0.5 text-muted-foreground/80 hover:text-foreground/90 transition-colors active:scale-95"
        aria-label="Dismiss notification"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      {/* Progress bar for action-bearing toasts — gives the user a visual
          cue of how long the undo window is. Animates from 100% → 0% over
          the toast's duration. */}
      {item.action && item.duration >= 1500 && !exiting && (
        <span
          className="absolute left-0 bottom-0 h-[2px] bg-emerald-400/40"
          style={{
            animation: `uc-toast-countdown ${item.duration}ms linear forwards`,
          }}
        />
      )}
    </div>
  )
}

export function Toaster() {
  const { toasts } = useToast()

  if (toasts.length === 0) return null

  // Anchored above the always-present DownBar "Activity" pill (fixed at
  // bottom-4). The bar's live height is published as `--uc-downbar-height` by
  // DownBar, so toasts clear it even when it grows for a second concurrent
  // download — a fixed offset left them overlapping / tucked behind it. The
  // fallback (3.5rem ≈ a single-row pill) covers routes where the bar isn't
  // mounted. `1rem` is the bar's own bottom offset, plus a `1rem` gap.
  return (
    <div
      style={{ bottom: "calc(var(--uc-downbar-height, 3.5rem) + 2rem)" }}
      className="fixed left-1/2 -translate-x-1/2 z-[9999] flex flex-col-reverse items-center gap-2 pointer-events-none"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((item) => (
        <div key={item.id} className="pointer-events-auto">
          <ToastItemView item={item} />
        </div>
      ))}
    </div>
  )
}

// Re-export for convenience if callers want to import type without the full context
export type { ToastType }
