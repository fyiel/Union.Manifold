import { Outlet, useLocation } from "react-router-dom"
import { useEffect, useRef, useState } from "react"
import { DownBar } from "@/components/DownBar"
import { Sidebar } from "@/components/Sidebar"
import { TopBar } from "@/components/TopBar"
import { TitleBar } from "@/components/TitleBar"
import { ScrollArea } from "@/components/ui/scroll-area"
import ScrollProgress from "@/components/ScrollProgress"
import { UpdateNotification } from "@/components/UpdateNotification"
import { useDiscordRpcPresence } from "@/hooks/use-discord-rpc"
import { useAppPreferencesSync } from "@/hooks/use-app-preferences-sync"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { cn } from "@/lib/utils"

export function AppLayout() {
  useDiscordRpcPresence()
  useAppPreferencesSync()
  useKeyboardShortcuts()
  const location = useLocation()
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem("uc_sidebar_collapsed") === "true" } catch { return false }
  })

  useEffect(() => {
    if (location.hash) return
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "auto" })
  }, [location.pathname, location.hash])

  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])

  const handleToggleCollapse = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev
      try { localStorage.setItem("uc_sidebar_collapsed", String(next)) } catch {}
      return next
    })
  }

  return (
    <div className="relative h-screen w-full overflow-hidden bg-zinc-950 text-zinc-100 flex flex-col">
      <TitleBar />
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <Sidebar
          mobileOpen={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          collapsed={sidebarCollapsed}
          onToggleCollapse={handleToggleCollapse}
        />
        <div className={cn(
          "relative flex min-h-0 flex-1 min-w-0 flex-col transition-[padding] duration-300 ease-in-out",
          sidebarCollapsed ? "md:pl-[64px]" : "md:pl-[16rem]"
        )}>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-40">
            <TopBar onOpenMenu={() => setMobileNavOpen(true)} />
          </div>
          <ScrollArea ref={scrollContainerRef} className="flex-1 min-h-0 min-w-0 w-full bg-gradient-to-b from-zinc-950 to-zinc-950/95">
            <div className="relative min-h-full w-full">
              <ScrollProgress />
              <main className="mx-auto w-full max-w-7xl px-4 pt-24 pb-28 md:px-8 xl:px-10">
                <Outlet />
              </main>
            </div>
          </ScrollArea>
          <DownBar />
          <UpdateNotification />
        </div>
      </div>
    </div>
  )
}
