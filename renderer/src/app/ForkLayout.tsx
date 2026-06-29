import { Outlet, useLocation, useNavigate } from "react-router-dom"
import { Suspense, useEffect, useRef, type CSSProperties } from "react"
import { Minus, Square, X } from "lucide-react"
import { Sidebar } from "@/app/manifold/Sidebar"
import { usePauseDownloadsWhilePlaying } from "@/hooks/use-pause-on-launch"
import { cn } from "@/lib/utils"

const drag = { WebkitAppRegion: "drag" } as CSSProperties
const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties

// Union.Manifold shell, a collapsible sidebar plus a single full-height main
// column (each page owns its own header + scroller, per the handoff comps). The
// window is frameless, so a thin drag strip spans the top and the min/max/close
// cluster floats in the top-right corner.
export function ForkLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // pause downloads while a game runs when the setting is on
  usePauseDownloadsWhilePlaying()

  // Pages that don't manage their own scroller get reset to top on navigation.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" })
  }, [location.pathname])

  // Tray menu + website deep links navigate through the main process (it sends
  // uc:navigation-action). The fork detail route is /g/:key, so rewrite the
  // tray's legacy /game/<id> path onto it.
  useEffect(() => {
    const off = window.ucApp?.onNavigationAction?.((data) => {
      if (!data) return
      const path = typeof (data as { path?: unknown }).path === "string" ? (data as { path: string }).path : ""
      if (!path.startsWith("/")) return
      navigate(path.startsWith("/game/") ? path.replace(/^\/game\//, "/g/") : path)
    })
    return () => { off?.() }
  }, [navigate])

  return (
    <div style={{ display: "flex", height: "100vh", width: "100%", background: "var(--mf-bg)", color: "var(--mf-t1)", overflow: "hidden" }}>
      <Sidebar />

      <div style={{ position: "relative", flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* top drag strip (frameless window) */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 28, zIndex: 5, ...drag }} aria-hidden />

        {/* window controls */}
        <div style={{ position: "absolute", top: 6, right: 10, display: "flex", gap: 2, zIndex: 20, ...noDrag }}>
          <WindowButton onClick={() => window.ucWindow?.minimize()} label="Minimize"><Minus className="h-3.5 w-3.5" /></WindowButton>
          <WindowButton onClick={() => window.ucWindow?.maximize()} label="Maximize"><Square className="h-3 w-3" /></WindowButton>
          <WindowButton onClick={() => window.ucWindow?.close()} label="Close" danger><X className="h-3.5 w-3.5" /></WindowButton>
        </div>

        <div ref={scrollRef} style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflowX: "hidden" }}>
          <Suspense fallback={<div style={{ flex: 1 }} aria-hidden />}>
            <Outlet />
          </Suspense>
        </div>
      </div>
    </div>
  )
}

function WindowButton({
  onClick,
  label,
  danger,
  children,
}: {
  onClick?: () => void
  label: string
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex h-6 w-7 items-center justify-center rounded text-[#7d7d7d] transition-colors",
        danger ? "hover:bg-[#7a2a2a] hover:text-white" : "hover:bg-white/10 hover:text-[#e6e6e6]"
      )}
    >
      {children}
    </button>
  )
}
