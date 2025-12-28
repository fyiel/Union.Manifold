import { useState } from "react"
import { Outlet } from "react-router-dom"
import { Sidebar } from "@/components/Sidebar"
import { DownBar } from "@/components/DownBar"
import { TopBar } from "@/components/TopBar"
import ScrollProgress from "@/components/ScrollProgress"

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ScrollProgress />
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex flex-col md:pl-64">
        <TopBar onToggleSidebar={() => setMobileOpen(true)} />
        <main className="px-4 py-6 pb-20 md:px-8">
          <Outlet />
        </main>
        <DownBar />
      </div>
    </div>
  )
}
