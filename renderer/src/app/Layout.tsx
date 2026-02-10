import { Outlet } from "react-router-dom"
import { DownBar } from "@/components/DownBar"
import { TopBar } from "@/components/TopBar"
import ScrollProgress from "@/components/ScrollProgress"
import { UpdateNotification } from "@/components/UpdateNotification"
import { useDiscordRpcPresence } from "@/hooks/use-discord-rpc"
import { useAppPreferencesSync } from "@/hooks/use-app-preferences-sync"

export function AppLayout() {
  useDiscordRpcPresence()
  useAppPreferencesSync()
  return (
    <div className="min-h-screen bg-background text-foreground">
      <ScrollProgress />
      <TopBar />
      <main className="px-4 py-6 pb-24 md:px-8">
        <Outlet />
      </main>
      <DownBar />
      <UpdateNotification />
    </div>
  )
}
