import { Outlet } from "react-router-dom"
import { DownBar } from "@/components/DownBar"
import { TopBar } from "@/components/TopBar"
import ScrollProgress from "@/components/ScrollProgress"
import { UpdateNotification } from "@/components/UpdateNotification"
import { useDiscordRpcPresence } from "@/hooks/use-discord-rpc"
import { useAppPreferencesSync } from "@/hooks/use-app-preferences-sync"
import { ScrollArea } from "@/components/ui/scroll-area"

export function AppLayout() {
  useDiscordRpcPresence()
  useAppPreferencesSync()
  return (
    <div className="h-screen w-full flex flex-col bg-background text-foreground overflow-hidden">
      <div className="flex-none z-40">
        <TopBar />
      </div>
      <div className="flex-1 w-full overflow-y-auto min-h-0">
        <div className="relative min-h-full">
          <ScrollProgress />
          <main className="px-4 py-6 pb-40 md:px-8">
            <Outlet />
          </main>
        </div>
      </div>
      <DownBar />
      <UpdateNotification />
    </div>
  )
}
