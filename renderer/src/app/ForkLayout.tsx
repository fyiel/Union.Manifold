import { Outlet, useLocation, useNavigate } from "react-router-dom"
import { lazy, Suspense, useEffect, useRef, type CSSProperties, type ReactNode } from "react"
import { Minus, Square, X } from "lucide-react"
import { Sidebar } from "@/app/manifold/Sidebar"
import { usePauseDownloadsWhilePlaying } from "@/hooks/use-pause-on-launch"
import { TabVisibleProvider } from "@/context/tab-visibility"
import { cn } from "@/lib/utils"

const importAdvanced = () => import("@/app/pages/AdvancedSearchPage")
const importLibrary = () => import("@/app/pages/LibraryPage")
const importPlayLater = () => import("@/app/pages/PlayLaterPage")
const importAchievements = () => import("@/app/pages/AchievementsPage")
const importDownloads = () => import("@/app/pages/DownloadsPage")
const importSettings = () => import("@/app/pages/SettingsPage")
const importDetail = () => import("@/app/pages/SourceGamePage")

const AdvancedSearchPage = lazy(() => importAdvanced().then((m) => ({ default: m.AdvancedSearchPage })))
const LibraryPage = lazy(() => importLibrary().then((m) => ({ default: m.LibraryPage })))
const PlayLaterPage = lazy(() => importPlayLater().then((m) => ({ default: m.PlayLaterPage })))
const AchievementsPage = lazy(() => importAchievements().then((m) => ({ default: m.AchievementsPage })))
const DownloadsPage = lazy(() => importDownloads().then((m) => ({ default: m.DownloadsPage })))
const SettingsPage = lazy(() => importSettings().then((m) => ({ default: m.SettingsPage })))
const BrowsePage = lazy(() => import("@/app/pages/BrowsePage").then((m) => ({ default: m.BrowsePage })))

function prefetchRoutes() {
  void importAdvanced()
  void importLibrary()
  void importPlayLater()
  void importAchievements()
  void importDownloads()
  void importSettings()
  void importDetail()
}

const drag = { WebkitAppRegion: "drag" } as CSSProperties
const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties

const TABS: Record<string, ReactNode> = {
  "/": <BrowsePage />,
  "/advanced": <AdvancedSearchPage />,
  "/library": <LibraryPage />,
  "/play-later": <PlayLaterPage />,
  "/achievements": <AchievementsPage />,
  "/downloads": <DownloadsPage />,
  "/settings": <SettingsPage />,
}

function TabHost({ path }: { path: string }) {
  const seen = useRef<Set<string>>(new Set())
  if (TABS[path]) seen.current.add(path)
  return (
    <>
      {Object.keys(TABS).filter((p) => seen.current.has(p)).map((p) => (
        <div key={p} style={{ display: p === path ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0, flexDirection: "column" }}>
          <TabVisibleProvider value={p === path}>{TABS[p]}</TabVisibleProvider>
        </div>
      ))}
    </>
  )
}

export function ForkLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const scrollRef = useRef<HTMLDivElement | null>(null)

  usePauseDownloadsWhilePlaying()

  useEffect(() => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback
    if (ric) {
      const id = ric(prefetchRoutes)
      return () => (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(id)
    }
    const t = setTimeout(prefetchRoutes, 200)
    return () => clearTimeout(t)
  }, [])

  const startupRouted = useRef(false)
  useEffect(() => {
    if (startupRouted.current) return
    startupRouted.current = true
    void (async () => {
      try {
        const sp = await window.ucSettings?.get?.("startPage")
        const route = window.location.hash.replace(/^#/, "").split("?")[0] || "/"
        if (sp === "library" && route === "/") {
          navigate("/library", { replace: true })
        }
      } catch {  }
    })()
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" })
  }, [location.pathname])

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
        {}
        <div data-tauri-drag-region style={{ position: "absolute", top: 0, left: 0, right: 0, height: 28, zIndex: 5, ...drag }} aria-hidden />

        {}
        <div style={{ position: "absolute", top: 6, right: 10, display: "flex", gap: 2, zIndex: 20, ...noDrag }}>
          <WindowButton onClick={() => window.ucWindow?.minimize()} label="Minimize"><Minus className="h-3.5 w-3.5" /></WindowButton>
          <WindowButton onClick={() => window.ucWindow?.maximize()} label="Maximize"><Square className="h-3 w-3" /></WindowButton>
          <WindowButton onClick={() => window.ucWindow?.close()} label="Close" danger><X className="h-3.5 w-3.5" /></WindowButton>
        </div>

        <div ref={scrollRef} style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflowX: "hidden" }}>
          <Suspense fallback={<div style={{ flex: 1 }} aria-hidden />}>
            <TabHost path={location.pathname} />
          </Suspense>
          {!TABS[location.pathname] && (
            <Suspense fallback={<div style={{ flex: 1 }} aria-hidden />}>
              <Outlet />
            </Suspense>
          )}
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
        "flex h-6 w-7 items-center justify-center rounded text-[var(--mf-t4)] transition-colors",
        danger ? "hover:bg-[#7a2a2a] hover:text-white" : "hover:bg-white/10 hover:text-[var(--mf-t1)]"
      )}
    >
      {children}
    </button>
  )
}
