import { lazy, Suspense, useEffect, useMemo, useState } from "react"
import { HashRouter, Route, Routes, Navigate, useLocation } from "react-router-dom"
import { ForkLayout } from "@/app/ForkLayout"
import { DownloadsProvider, useDownloadsSelector } from "@/context/downloads-context"
import { DownloadFlowProvider } from "@/context/download-flow-context"
import { GameLaunchProvider } from "@/context/game-launch-context"
import { ToastProvider } from "@/context/toast-context"
import { Toaster } from "@/components/Toaster"
import { ControllerNavigation } from "@/components/ControllerNavigation"
import { ThemeBoundary } from "@/components/ThemeBoundary"
import { loadGameModsPage, loadSourceGamePage } from "@/app/route-loaders"
import { applySavedSourceSettings } from "@/lib/sources"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertTriangle } from "@/components/icons"
import { mark, noteDom } from "@/lib/perf"

const SourceGameRoute = lazy(() => loadSourceGamePage().then((m) => ({ default: m.SourceGameRoute })))
const GameModsPage = lazy(() => loadGameModsPage().then((m) => ({ default: m.GameModsPage })))
const AchievementToastWindow = lazy(() => import("@/app/pages/AchievementToastWindow"))

const ThemeEditorWindow = lazy(() => import("@/app/pages/settings/ThemeEditorWindow"))

function RouteFallback() {
  return <div className="min-h-screen bg-background" />
}

const EXTRACTION_GUARD_EXTRACTING = ["extracting", "installing"]
const EXTRACTION_GUARD_DOWNLOADING = ["downloading", "verifying", "retrying"]

function ExtractionCloseGuard() {
  const activeItems = useDownloadsSelector(
    (downloads) =>
      downloads
        .filter(
          (item) =>
            EXTRACTION_GUARD_EXTRACTING.includes(item.status) ||
            EXTRACTION_GUARD_DOWNLOADING.includes(item.status),
        )
        .map((item) => ({ id: item.id, status: item.status, gameName: item.gameName ?? null })),
    (a, b) =>
      a.length === b.length &&
      a.every((x, i) => x.id === b[i].id && x.status === b[i].status && x.gameName === b[i].gameName),
  )
  const [request, setRequest] = useState<{ mode: "quit" | "hide"; extractionCount?: number; downloadCount?: number; appids?: string[] } | null>(null)

  useEffect(() => {
    if (!window.ucApp?.onCloseRequest) return
    return window.ucApp.onCloseRequest((nextRequest) => {
      setRequest(nextRequest)
    })
  }, [])

  const activeExtractions = useMemo(() => {
    return activeItems.filter((item) => EXTRACTION_GUARD_EXTRACTING.includes(item.status))
  }, [activeItems])

  const activeDownloads = useMemo(() => {
    return activeItems.filter((item) => EXTRACTION_GUARD_DOWNLOADING.includes(item.status))
  }, [activeItems])

  const affectedNames = useMemo(() => {
    return [...new Set([...activeDownloads, ...activeExtractions].map((item) => item.gameName).filter(Boolean))].slice(0, 3)
  }, [activeDownloads, activeExtractions])

  const isExtractionRequest = (request?.extractionCount || 0) > 0 || activeExtractions.length > 0

  const handleResponse = async (shouldProceed: boolean) => {
    setRequest(null)
    await window.ucApp?.respondToCloseRequest?.(shouldProceed)
  }

  return (
    <Dialog open={Boolean(request)} onOpenChange={(open) => { if (!open) void handleResponse(false) }}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            {isExtractionRequest ? "Download or extraction still running" : "Download still running"}
          </DialogTitle>
          <DialogDescription className="text-left pt-2 text-foreground/80">
            {isExtractionRequest
              ? "Closing now will stop the current work. Downloads will be resumable when you reopen the app, and finished archives can still be installed later."
              : "Closing now will pause the current download. You can resume it when you reopen the app."}
          </DialogDescription>
        </DialogHeader>
        {affectedNames.length > 0 ? (
          <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-foreground/90">
            {affectedNames.join(", ")}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => void handleResponse(false)}>
            Keep running
          </Button>
          <Button className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void handleResponse(true)}>
            Close anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DownloadBlockedGuard() {
  const [blocked, setBlocked] = useState<{ host: string; gameName: string | null } | null>(null)

  useEffect(() => {
    if (!window.ucDownloads?.onBlocked) return
    return window.ucDownloads.onBlocked((data) => {
      setBlocked({ host: data?.host || "our download server", gameName: data?.gameName ?? null })
    })
  }, [])

  return (
    <Dialog open={Boolean(blocked)} onOpenChange={(open) => { if (!open) setBlocked(null) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            Your network is blocking downloads
          </DialogTitle>
          <DialogDescription className="text-left pt-2 text-foreground/80">
            {blocked?.gameName ? <><span className="font-medium text-foreground">{blocked.gameName}</span> couldn't download because your </> : "Your "}
            network is refusing the secure connection to our download server
            {blocked?.host ? <> (<span className="font-mono text-xs">{blocked.host}</span>)</> : null} — the TLS
            handshake is being blocked. This is almost always a school, workplace,
            or ISP firewall, not a problem with your PC or the file.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-foreground/90 space-y-2">
          <div className="font-medium text-foreground">What works:</div>
          <ul className="list-disc pl-5 space-y-1 text-foreground/80">
            <li>Connect through a VPN, then retry the download.</li>
            <li>Try a different network (e.g. a phone hotspot).</li>
            <li>Browsing and the catalog keep working — only large downloads are blocked.</li>
          </ul>
        </div>
        <DialogFooter>
          <Button onClick={() => setBlocked(null)}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AppWithDownloads() {
  const location = useLocation()
  useEffect(() => {
    void applySavedSourceSettings()
  }, [])

  // Dev-only perf marks: route change -> post-commit -> DOM settled.
  useEffect(() => {
    const path = location.pathname
    mark(`route:${path}`)
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        noteDom(`route:${path}`)
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [location.pathname])

  return (
    <>
      <ExtractionCloseGuard />
      <DownloadBlockedGuard />
      <ControllerNavigation />
      <ForkLayout />
    </>
  )
}

export default function App() {
  return (
    <HashRouter>
      <ToastProvider>
        <DownloadsProvider>
        <DownloadFlowProvider>
        <GameLaunchProvider>
        <ThemeBoundary>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/theme-editor" element={<ThemeEditorWindow />} />
              <Route path="/achievement-toast" element={<AchievementToastWindow />} />

              {}
              <Route element={<AppWithDownloads />}>
                <Route path="/g/:key" element={<SourceGameRoute />} />
                <Route path="/g/:key/mods" element={<GameModsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </Suspense>
        </ThemeBoundary>
        </GameLaunchProvider>
        </DownloadFlowProvider>
        </DownloadsProvider>
        <Toaster />
      </ToastProvider>
    </HashRouter>
  )
}
