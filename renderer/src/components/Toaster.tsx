import { useEffect, useState } from "react"
import { CheckCircle2, Info, X, XCircle } from "lucide-react"
import { type ToastItem, type ToastType, useToast } from "@/context/toast-context"

function ToastItemView({ item }: { item: ToastItem }) {
  const { dismiss } = useToast()
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    const exitTimer = setTimeout(() => setExiting(true), item.duration)
    return () => clearTimeout(exitTimer)
  }, [item.duration])

  const isError = item.type === "error"
  const isSuccess = item.type === "success"

  const Icon = isError ? XCircle : isSuccess ? CheckCircle2 : Info

  return (
    <div
      className={`
        flex items-center gap-3 px-5 py-3 rounded-full shadow-2xl border
        text-sm font-medium transition-all duration-500
        ${exiting ? "opacity-0 translate-y-2" : "opacity-100 translate-y-0 anim"}
        ${isError
          ? "bg-zinc-900 border-red-500/30 text-red-400"
          : "bg-zinc-900 border-zinc-700 text-zinc-200"
        }
      `}
    >
      <Icon className={`h-4 w-4 shrink-0 ${isError ? "text-red-400" : isSuccess ? "text-zinc-300" : "text-zinc-400"}`} />
      <span>{item.message}</span>
      <button
        onClick={() => dismiss(item.id)}
        className="ml-1 rounded-full p-0.5 text-zinc-500 hover:text-zinc-200 transition-colors active:scale-95"
        aria-label="Dismiss notification"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function Toaster() {
  const { toasts } = useToast()

  if (toasts.length === 0) return null

  return (
    <div
      className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[9999] flex flex-col-reverse items-center gap-2 pointer-events-none"
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
