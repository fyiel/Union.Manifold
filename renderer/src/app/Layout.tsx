import { Outlet, useLocation, useNavigate, useNavigationType } from "react-router-dom"
import type { CSSProperties } from "react"
import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { DownBar } from "@/components/DownBar"
import { Sidebar } from "@/components/Sidebar"
import { TopBar } from "@/components/TopBar"
import { CustomTooltipManager } from "@/components/CustomTooltipManager"
import { ScrollArea } from "@/components/ui/scroll-area"
import ScrollProgress from "@/components/ScrollProgress"
import { useDiscordRpcPresence } from "@/hooks/use-discord-rpc"
import { useAppPreferencesSync } from "@/hooks/use-app-preferences-sync"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { usePauseDownloadsWhilePlaying } from "@/hooks/use-pause-on-launch"
import { usePlaytimeFlush } from "@/hooks/use-playtime-flush"
import { usePresenceHeartbeat } from "@/hooks/use-presence-heartbeat"
import { useInstalledGamesSync } from "@/hooks/use-installed-games-sync"
import { logger } from "@/lib/logger"
import { cn } from "@/lib/utils"
import { getApiBaseUrl } from "@/lib/api"
import { useAuth } from "@/hooks/useAuth"
import { useHasRunningGames } from "@/hooks/use-running-games"

const UpdateNotification = lazy(() => import("@/components/UpdateNotification").then((m) => ({ default: m.UpdateNotification })))
const KeyboardShortcutsDialog = lazy(() => import("@/components/KeyboardShortcutsDialog").then((m) => ({ default: m.KeyboardShortcutsDialog })))
const ArchiveDropZone = lazy(() => import("@/components/ArchiveDropZone").then((m) => ({ default: m.ArchiveDropZone })))
const WhatsNewModal = lazy(() => import("@/components/WhatsNewModal").then((m) => ({ default: m.WhatsNewModal })))
const OnboardingModal = lazy(() => import("@/components/OnboardingModal").then((m) => ({ default: m.OnboardingModal })))
const LogSharingConsentModal = lazy(() => import("@/components/LogSharingConsentModal").then((m) => ({ default: m.LogSharingConsentModal })))
const WindowsDefenderPromptModal = lazy(() => import("@/components/WindowsDefenderPromptModal").then((m) => ({ default: m.WindowsDefenderPromptModal })))
const LoginPromptModal = lazy(() => import("@/components/LoginPromptModal").then((m) => ({ default: m.LoginPromptModal })))

export function AppLayout() {
  useDiscordRpcPresence()
  useAppPreferencesSync()
  useKeyboardShortcuts()
  usePauseDownloadsWhilePlaying()
  usePlaytimeFlush()
  usePresenceHeartbeat()
  useInstalledGamesSync()
  const location = useLocation()
  const navigationType = useNavigationType()
  const navigate = useNavigate()

  // Listen for one-shot deep-link navigation actions delivered by the
  // main process (e.g. `unioncrax://scan` from the website's "Scan in
  // UC.Direct" buttons). Currently the only action is 'open-system-profile'
  // which routes to /settings with the System Profile section preselected.
  useEffect(() => {
    const off = window.ucApp?.onNavigationAction?.((data) => {
      if (!data) return
      // Existing deep link from the website "Scan in UC.D" CTA.
      if (data.action === "open-system-profile") {
        const params = new URLSearchParams()
        params.set("section", "system")
        if (data.autoScan) params.set("autoScan", "1")
        navigate(`/settings?${params.toString()}`)
        return
      }
      // Generic path navigation — used by the tray menu's "Open downloads"
      // / "Open game in launcher" actions so the renderer doesn't have to
      // know which features the tray exposes.
      if (typeof (data as any).path === "string" && (data as any).path.startsWith("/")) {
        navigate((data as any).path)
      }
    })
    return () => { off?.() }
  }, [navigate])
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem("uc_sidebar_collapsed") === "true" } catch { return false }
  })
  const hasRunningGames = useHasRunningGames()
  // When a game is running, force the sidebar open so the Now Playing panel
  // and quick-quit button are always accessible without extra clicks.
  const effectiveSidebarCollapsed = sidebarCollapsed && !hasRunningGames
  const [logConsentOpen, setLogConsentOpen] = useState(false)
  const [defenderPromptOpen, setDefenderPromptOpen] = useState(false)
  const [defenderPromptPath, setDefenderPromptPath] = useState("")
  const [loginPromptOpen, setLoginPromptOpen] = useState(false)
  const [loginPromptSigningIn, setLoginPromptSigningIn] = useState(false)
  const [{ isAuthenticated, isLoading: authLoading }, { signInWithWebsite }] = useAuth()
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

  useEffect(() => {
    if (typeof navigator === "undefined" || !/windows/i.test(navigator.userAgent)) return

    let mounted = true
    const checkDefenderPrompt = async () => {
      try {
        const seen = await window.ucSettings?.get?.('windowsDefenderPromptSeen')
        if (!mounted || seen) return

        const pathResult = await window.ucDownloads?.getDownloadPath?.()
        if (!mounted) return

        const resolvedPath = pathResult?.path || ""
        setDefenderPromptPath(resolvedPath)
        setDefenderPromptOpen(true)
      } catch {
        // ignore
      }
    }

    void checkDefenderPrompt()

    return () => {
      mounted = false
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

  // Scroll restoration:
  //   - On forward / new navigation (PUSH / REPLACE) scroll to top.
  //   - On back navigation (POP) restore the scroll position we saved when
  //     the user last left this pathname. The cache lives in a ref keyed by
  //     pathname — sessionStorage would persist across reloads but the user
  //     expectation is "restore within this session" only.
  //   - On every pathname change, remember the previous pathname's scroll
  //     position before scrolling.
  const scrollPositionsRef = useRef(new Map<string, number>())
  const previousPathnameRef = useRef<string>(location.pathname)
  useEffect(() => {
    const container = scrollContainerRef.current as unknown as { scrollTop: number; scrollTo: (opts: ScrollToOptions) => void } | null
    if (!container) {
      previousPathnameRef.current = location.pathname
      return
    }
    const prevPath = previousPathnameRef.current
    if (prevPath && prevPath !== location.pathname) {
      // Save where we were before leaving — even a hash-only change can
      // happen here; we only persist when the pathname actually changed.
      try { scrollPositionsRef.current.set(prevPath, container.scrollTop) } catch { /* ignore */ }
    }
    previousPathnameRef.current = location.pathname

    if (location.hash) return

    if (navigationType === "POP") {
      const saved = scrollPositionsRef.current.get(location.pathname)
      if (typeof saved === "number") {
        // Wait one frame so the new page has rendered enough to be
        // tall enough to scroll into; otherwise we land at the top
        // because the scroll target doesn't exist yet.
        requestAnimationFrame(() => container.scrollTo({ top: saved, behavior: "auto" }))
        return
      }
    }
    container.scrollTo({ top: 0, behavior: "auto" })
  }, [location.pathname, location.hash, navigationType])

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

      // Defensive recovery for stale runtime bundles that can throw
      // "ReferenceError: games is not defined" during route render.
      // Reload only once per session to avoid loops.
      if (event.message?.includes("games is not defined")) {
        try {
          const key = "uc_recovered_games_referror"
          const recovered = sessionStorage.getItem(key) === "1"
          if (!recovered) {
            sessionStorage.setItem(key, "1")
            window.location.reload()
            return
          }
        } catch {
          // ignore
        }
      }

      triggerAutoShareLogs()
    }

    const handleResourceError = (event: Event) => {
      const target = event.target as (HTMLImageElement | HTMLSourceElement | null)
      if (!target) return
      const tagName = (target as Element).tagName?.toLowerCase?.() || "unknown"
      const src = (target as HTMLImageElement).currentSrc || (target as HTMLImageElement).src || ""
      if (!src) return

      // Skip <img> errors that the rendering component already handles
      // gracefully (MediaImage / GameCard's candidate chain mark themselves
      // with data-uc-handled="1"). They retry, fall back to a placeholder,
      // and cache the failure already — logging them globally produces noise
      // proportional to the size of the user's grid and triggers
      // auto-share-logs prompts for completely expected misses.
      if (tagName === "img") {
        try {
          if ((target as HTMLElement).getAttribute("data-uc-handled") === "1") {
            return
          }
        } catch { /* ignore — fall through to logging */ }
      }

      logger.warn("Resource load failed", {
        context: "Window",
        data: {
          tagName,
          src,
          page: window.location.pathname,
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
    window.addEventListener("error", handleResourceError, true)
    window.addEventListener("unhandledrejection", handleUnhandledRejection)
    return () => {
      window.removeEventListener("error", handleWindowError)
      window.removeEventListener("error", handleResourceError, true)
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

  const dismissDefenderPrompt = async () => {
    setDefenderPromptOpen(false)
    try { await window.ucSettings?.set?.('windowsDefenderPromptSeen', true) } catch {}
  }

  // First-launch sign-in prompt. Only fires once: gated by `loginPromptSeen`
  // in settings, and skipped if the user is already signed in. The auth
  // refresh on mount can take a moment, so we wait until isLoading is false
  // before deciding whether to show it.
  useEffect(() => {
    if (authLoading) return
    if (isAuthenticated) return
    let mounted = true
    void (async () => {
      try {
        const seen = await window.ucSettings?.get?.('loginPromptSeen')
        if (!mounted || seen) return
        setLoginPromptOpen(true)
      } catch {
        // ignore — best-effort
      }
    })()
    return () => { mounted = false }
  }, [authLoading, isAuthenticated])

  const dismissLoginPrompt = async () => {
    setLoginPromptOpen(false)
    try { await window.ucSettings?.set?.('loginPromptSeen', true) } catch {}
  }

  const handleLoginPromptSignIn = async () => {
    if (loginPromptSigningIn) return
    setLoginPromptSigningIn(true)
    try {
      const result = await signInWithWebsite()
      if (result.ok) {
        await dismissLoginPrompt()
      }
    } finally {
      setLoginPromptSigningIn(false)
    }
  }

  return (
    <div className="relative h-screen w-full overflow-hidden bg-background text-foreground flex flex-col">
      {/* Top-edge drag strip — gives the user a reliable place to grab and
          drag the window from above the sidebar (the integrated nav pill
          only covers part of the top row). Invisible, sits above the
          sidebar visually but underneath any positioned UI. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-30 h-2"
        style={{ WebkitAppRegion: "drag" } as CSSProperties}
        aria-hidden="true"
      />
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <Sidebar
          mobileOpen={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          collapsed={effectiveSidebarCollapsed}
          onToggleCollapse={handleToggleCollapse}
        />
        <div className={cn(
          "relative flex min-h-0 flex-1 min-w-0 flex-col transition-[padding] duration-300 ease-in-out",
          effectiveSidebarCollapsed ? "md:pl-[64px]" : "md:pl-[16rem]"
        )}>
          <div
            className={cn(
              "pointer-events-none absolute top-0 z-40 right-0",
              effectiveSidebarCollapsed ? "left-[64px]" : "left-[16rem]"
            )}
          >
            <TopBar onOpenMenu={() => setMobileNavOpen(true)} />
          </div>
          <ScrollArea ref={scrollContainerRef} className="flex-1 min-h-0 min-w-0 w-full bg-background">
            <div className="relative min-h-full w-full">
              <ScrollProgress />
              <main className="mx-auto w-full max-w-7xl px-4 pt-24 pb-28 md:px-8 xl:px-10">
                {/* `key={pathname}` remounts on every route change so the
                    entering page replays the uc-page-transition fade-up.
                    The wrapper claims `min-height: 100%` so React can't
                    collapse the layout to 0 between mounts, which kills
                    the blank-flash + scroll-jump combo. */}
                <div key={location.pathname} className="uc-page-transition">
                  {/* Inner Suspense boundary keeps the sidebar/topbar mounted
                      while a lazy route chunk loads. Without this the root
                      Suspense in App.tsx unmounts the entire layout (and
                      sidebar), so the user can't navigate elsewhere until the
                      current page finishes loading. The fallback intentionally
                      reserves no specific layout — pages animate in via
                      uc-page-transition once they're ready. */}
                  <Suspense fallback={<div className="min-h-[60vh]" aria-hidden="true" />}>
                    <Outlet />
                  </Suspense>
                </div>
              </main>
            </div>
          </ScrollArea>
          <DownBar />
          <Suspense fallback={null}>
            <UpdateNotification />
          </Suspense>
        </div>
      </div>
      <Suspense fallback={null}>
        <KeyboardShortcutsDialog />
        <ArchiveDropZone />
        <WhatsNewModal />
        <OnboardingModal />
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
        <WindowsDefenderPromptModal
          open={defenderPromptOpen}
          downloadPath={defenderPromptPath}
          onOpenSecurity={() => {
            void (async () => {
              const primary = await window.ucSystem?.openExternal?.('windowsdefender://threatsettings/')
              if (!primary?.ok) {
                await window.ucSystem?.openExternal?.('ms-settings:windowsdefender')
              }
            })()
          }}
          onDismiss={() => {
            void dismissDefenderPrompt()
          }}
          onOpenFolder={() => {
            void (async () => {
              if (defenderPromptPath) {
                try { await window.ucDownloads?.openPath?.(defenderPromptPath) } catch {}
              }
              await dismissDefenderPrompt()
            })()
          }}
        />
        <LoginPromptModal
          open={loginPromptOpen}
          signingIn={loginPromptSigningIn}
          onSignIn={() => { void handleLoginPromptSignIn() }}
          onSkip={() => { void dismissLoginPrompt() }}
        />
      </Suspense>
      <CustomTooltipManager />
    </div>
  )
}
