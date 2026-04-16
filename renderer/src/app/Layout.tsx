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
import { logger } from "@/lib/logger"
import { cn } from "@/lib/utils"
import { LogSharingConsentModal } from "@/components/LogSharingConsentModal"
import { getApiBaseUrl } from "@/lib/api"

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
  const [logConsentOpen, setLogConsentOpen] = useState(false)
  const autoShareEnabledRef = useRef<boolean>(false)
  const lastLogShareRef = useRef<number>(0)

  // Check if the user has been asked about error log sharing yet
  useEffect(() => {
    let mounted = true
    const check = async () => {
      try {
        const val = await window.ucSettings?.get?.('autoShareErrorLogs')
        if (!mounted) return
        if (val === true) {
          autoShareEnabledRef.current = true
        } else if (val === false) {
          autoShareEnabledRef.current = false
        } else {
          // Not yet decided — show the consent dialog
          setLogConsentOpen(true)
        }
      } catch {
        // ignore — don't block app load
      }
    }
    check()
    // Keep ref in sync with any setting changes (e.g. from SettingsPage toggle)
    const off = window.ucSettings?.onChanged?.((data: any) => {
      if (data?.key === 'autoShareErrorLogs') {
        autoShareEnabledRef.current = data.value === true
      }
    })
    return () => {
      mounted = false
      if (typeof off === 'function') off()
    }
  }, [])

  const triggerAutoShareLogs = () => {
    if (!autoShareEnabledRef.current) return
    const now = Date.now()
    // Throttle: at most once per 10 minutes
    if (now - lastLogShareRef.current < 10 * 60 * 1000) return
    lastLogShareRef.current = now
    try {
      window.ucLogs?.shareLogs?.({ baseUrl: getApiBaseUrl() }).catch(() => {})
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (location.hash) return
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "auto" })
  }, [location.pathname, location.hash])

  useEffect(() => {
    const handleWindowError = (event: ErrorEvent) => {
      logger.error("Unhandled renderer error", {
        context: "Window",
        data: {
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          stack: event.error?.stack,
        },
      })
      triggerAutoShareLogs()
    }

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      logger.error("Unhandled promise rejection", {
        context: "Window",
        data: {
          reason: event.reason instanceof Error
            ? { message: event.reason.message, stack: event.reason.stack }
            : event.reason,
        },
      })
      triggerAutoShareLogs()
    }

    window.addEventListener("error", handleWindowError)
    window.addEventListener("unhandledrejection", handleUnhandledRejection)
    return () => {
      window.removeEventListener("error", handleWindowError)
      window.removeEventListener("unhandledrejection", handleUnhandledRejection)
    }
  }, [])

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
      <LogSharingConsentModal
        open={logConsentOpen}
        onAccept={async () => {
          setLogConsentOpen(false)
          autoShareEnabledRef.current = true
          try { await window.ucSettings?.set?.('autoShareErrorLogs', true) } catch {}
        }}
        onDecline={async () => {
          setLogConsentOpen(false)
          autoShareEnabledRef.current = false
          try { await window.ucSettings?.set?.('autoShareErrorLogs', false) } catch {}
        }}
      />
    </div>
  )
}
