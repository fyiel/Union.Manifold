import { useEffect, useMemo, useState } from "react"
import { HashRouter, Route, Routes, Navigate } from "react-router-dom"
import { AppLayout } from "@/app/Layout"
import { LauncherPage } from "@/app/pages/LauncherPage"
import { SearchPage } from "@/app/pages/SearchPage"
import { GameDetailPage } from "@/app/pages/GameDetailPage"
import { LibraryPage } from "@/app/pages/LibraryPage"
import { DownloadsPage } from "@/app/pages/DownloadsPage"
import { SettingsPage } from "@/app/pages/SettingsPage"
import { WishlistPage } from "@/app/pages/WishlistPage"
import { LikedPage } from "@/app/pages/LikedPage"
import { AccountOverviewPage } from "@/app/pages/AccountOverviewPage"
import { ViewHistoryPage } from "@/app/pages/ViewHistoryPage"
import { SearchHistoryPage } from "@/app/pages/SearchHistoryPage"
import { ScreenshotsPage } from "@/app/pages/ScreenshotsPage"
import { LoginPage } from "@/app/pages/LoginPage"
import { VerifyEmailPage } from "@/app/pages/VerifyEmailPage"
import { ForgotPasswordPage } from "@/app/pages/ForgotPasswordPage"
import { ResetPasswordPage } from "@/app/pages/ResetPasswordPage"
import { DownloadsProvider, useDownloads } from "@/context/downloads-context"
import { ToastProvider } from "@/context/toast-context"
import { InGameOverlay } from "@/components/InGameOverlay"
import { Toaster } from "@/components/Toaster"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertTriangle } from "lucide-react"

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
      <DialogContent className="sm:max-w-md rounded-2xl border-white/[.07] bg-zinc-900/95 text-white shadow-2xl" showCloseButton={false}>
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
        <DownloadsProvider>
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
        </DownloadsProvider>
        <Toaster />
      </ToastProvider>
    </HashRouter>
  )
}
