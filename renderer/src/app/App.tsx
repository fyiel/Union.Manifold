import { lazy, Suspense, useEffect, useMemo, useState } from "react"
import { HashRouter, Route, Routes, Navigate } from "react-router-dom"
import { AppLayout } from "@/app/Layout"
import { DownloadsProvider, useDownloads } from "@/context/downloads-context"
import { ToastProvider } from "@/context/toast-context"
import { AuthProvider } from "@/context/auth-context"
import { Toaster } from "@/components/Toaster"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertTriangle } from "lucide-react"

const LauncherPage = lazy(() => import("@/app/pages/LauncherPage").then((m) => ({ default: m.LauncherPage })))
const SearchPage = lazy(() => import("@/app/pages/SearchPage").then((m) => ({ default: m.SearchPage })))
const GameDetailPage = lazy(() => import("@/app/pages/GameDetailPage").then((m) => ({ default: m.GameDetailPage })))
const LibraryPage = lazy(() => import("@/app/pages/LibraryPage").then((m) => ({ default: m.LibraryPage })))
const CollectionsPage = lazy(() => import("@/app/pages/CollectionsPage").then((m) => ({ default: m.CollectionsPage })))
const DownloadsPage = lazy(() => import("@/app/pages/DownloadsPage").then((m) => ({ default: m.DownloadsPage })))
const SettingsPage = lazy(() => import("@/app/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })))
const WishlistPage = lazy(() => import("@/app/pages/WishlistPage").then((m) => ({ default: m.WishlistPage })))
const LikedPage = lazy(() => import("@/app/pages/LikedPage").then((m) => ({ default: m.LikedPage })))
const AccountOverviewPage = lazy(() => import("@/app/pages/AccountOverviewPage").then((m) => ({ default: m.AccountOverviewPage })))
const ViewHistoryPage = lazy(() => import("@/app/pages/ViewHistoryPage").then((m) => ({ default: m.ViewHistoryPage })))
const SearchHistoryPage = lazy(() => import("@/app/pages/SearchHistoryPage").then((m) => ({ default: m.SearchHistoryPage })))
const ScreenshotsPage = lazy(() => import("@/app/pages/ScreenshotsPage").then((m) => ({ default: m.ScreenshotsPage })))
const LoginPage = lazy(() => import("@/app/pages/LoginPage").then((m) => ({ default: m.LoginPage })))
const VerifyEmailPage = lazy(() => import("@/app/pages/VerifyEmailPage").then((m) => ({ default: m.VerifyEmailPage })))
const ForgotPasswordPage = lazy(() => import("@/app/pages/ForgotPasswordPage").then((m) => ({ default: m.ForgotPasswordPage })))
const ResetPasswordPage = lazy(() => import("@/app/pages/ResetPasswordPage").then((m) => ({ default: m.ResetPasswordPage })))
const InGameOverlay = lazy(() => import("@/components/InGameOverlay").then((m) => ({ default: m.InGameOverlay })))

function RouteFallback() {
  return <div className="min-h-screen bg-[#09090b]" />
}

function ExtractionCloseGuard() {
  const { downloads } = useDownloads()
  const [request, setRequest] = useState<{ mode: "quit" | "hide"; extractionCount?: number; downloadCount?: number; appids?: string[] } | null>(null)

  useEffect(() => {
    if (!window.ucApp?.onCloseRequest) return
    return window.ucApp.onCloseRequest((nextRequest) => {
      setRequest(nextRequest)
    })
  }, [])

  const activeExtractions = useMemo(() => {
    return downloads.filter((item) => ["extracting", "installing"].includes(item.status))
  }, [downloads])

  const activeDownloads = useMemo(() => {
    return downloads.filter((item) => ["downloading", "verifying", "retrying"].includes(item.status))
  }, [downloads])

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
          <DialogDescription className="text-left pt-2 text-zinc-300">
            {isExtractionRequest
              ? "Closing now will stop the current work. Downloads will be resumable when you reopen the app, and finished archives can still be installed later."
              : "Closing now will pause the current download. You can resume it when you reopen the app."}
          </DialogDescription>
        </DialogHeader>
        {affectedNames.length > 0 ? (
          <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-zinc-200">
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

function AppWithDownloads() {
  return (
    <>
      <ExtractionCloseGuard />
      <AppLayout />
    </>
  )
}

export default function App() {
  return (
    <HashRouter>
      <ToastProvider>
        <AuthProvider>
        <DownloadsProvider>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/overlay" element={<InGameOverlay />} />

              {/* Auth pages (inside app layout) */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/verify-email" element={<VerifyEmailPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />

              {/* App routes - no login required */}
              <Route element={<AppWithDownloads />}>
                <Route path="/" element={<LauncherPage />} />
                <Route path="/launcher" element={<LauncherPage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/game/:id" element={<GameDetailPage />} />
                <Route path="/library" element={<LibraryPage />} />
                <Route path="/collections" element={<CollectionsPage />} />
                <Route path="/downloads" element={<DownloadsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/wishlist" element={<WishlistPage />} />
                <Route path="/liked" element={<LikedPage />} />
                <Route path="/account" element={<AccountOverviewPage />} />
                <Route path="/view-history" element={<ViewHistoryPage />} />
                <Route path="/search-history" element={<SearchHistoryPage />} />
                <Route path="/screenshots" element={<ScreenshotsPage />} />
              </Route>

              {/* Fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </DownloadsProvider>
        </AuthProvider>
        <Toaster />
      </ToastProvider>
    </HashRouter>
  )
}
