import type { CSSProperties } from "react"
import { useEffect, useState } from "react"
import { Minus, Square, X } from "lucide-react"

declare global {
  interface Window {
    ucWindow?: {
      minimize: () => void
      maximize: () => void
      close: () => void
      isMaximized: () => Promise<boolean>
      onMaximizeChange: (cb: (isMaximized: boolean) => void) => () => void
    }
  }
}

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)
  const hasWindowControls = typeof window !== "undefined" && !!window.ucWindow

  useEffect(() => {
    if (!hasWindowControls) return

    window.ucWindow?.isMaximized().then(setIsMaximized)
    const unsub = window.ucWindow?.onMaximizeChange(setIsMaximized)
    return () => unsub?.()
  }, [hasWindowControls])

  if (!hasWindowControls) return null

  return (
    <div
      className="relative z-50 flex h-8 w-full flex-shrink-0 items-center border-b border-white/[0.05] bg-zinc-950/98 select-none"
      style={{ WebkitAppRegion: "drag" } as CSSProperties}
    >
      <div className="flex min-w-0 items-center gap-2 px-3">
        <img src="/icon.svg" alt="" className="h-3.5 w-3.5 opacity-70" draggable={false} />
        <span className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
          UnionCrax.Direct
        </span>
      </div>

      <div className="flex-1" />

      <div
        className="ml-auto flex h-full items-stretch"
        style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
      >
        <button
          type="button"
          aria-label="Minimize"
          onClick={() => window.ucWindow?.minimize()}
          className="flex h-full w-11 items-center justify-center text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
        >
          <Minus className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          aria-label={isMaximized ? "Restore" : "Maximize"}
          onClick={() => window.ucWindow?.maximize()}
          className="flex h-full w-11 items-center justify-center text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
        >
          {isMaximized ? (
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
              <rect x="8" y="8" width="11" height="11" rx="1" />
              <path d="M5 16V5h11" />
            </svg>
          ) : (
            <Square className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
        </button>
        <button
          type="button"
          aria-label="Close"
          onClick={() => window.ucWindow?.close()}
          className="flex h-full w-12 items-center justify-center text-zinc-500 transition-colors hover:bg-red-500 hover:text-white"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}
