"use client"

import { useState } from "react"
import { AlertTriangle, RefreshCw, WifiOff } from "lucide-react"
import { LoadingAnimated } from "@/components/brand/brand-assets"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useConnectivityStatus } from "@/hooks/use-online-status"

interface APIFallbackProps {
  onRetry?: () => void
  message?: string
  showOfflineMessage?: boolean
}

export function APIFallback({
  onRetry,
  message = "Failed to load content",
  showOfflineMessage = true,
}: APIFallbackProps) {
  const { browserOnline, isOnline } = useConnectivityStatus()
  const [retrying, setRetrying] = useState(false)

  const handleRetry = async () => {
    if (!onRetry) return

    setRetrying(true)
    try {
      await onRetry()
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="flex items-center justify-center p-8">
      <Card className="w-full max-w-md rounded-2xl">
        <CardHeader className="text-center p-8">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-zinc-700">
            {showOfflineMessage && !isOnline && !browserOnline ? (
              <WifiOff className="h-7 w-7 text-orange-500" />
            ) : (
              <AlertTriangle className="h-7 w-7 text-white" />
            )}
          </div>
          <CardTitle className="text-xl">{message}</CardTitle>
          <CardDescription className="text-base mt-2">
            {showOfflineMessage && !isOnline ? (
              browserOnline ? (
                <span className="text-orange-500">
                  Union Crax is unreachable right now
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2 text-orange-500">
                  <WifiOff className="h-5 w-5" />
                  You're currently offline
                </span>
              )
            ) : (
              "We're having trouble loading this content. Please try again."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-8 pt-0">
          {onRetry && (
            <Button
              onClick={handleRetry}
              disabled={retrying || (!browserOnline && showOfflineMessage)}
              className="w-full rounded-full h-12"
            >
              {retrying ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Retrying...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Try Again
                </>
              )}
            </Button>
          )}

          {showOfflineMessage && !isOnline && (
            <div className="text-center">
              <p className="text-sm text-zinc-400 leading-relaxed">
                {browserOnline
                  ? "Your internet connection is up, but the website or mirrors did not respond. Try again when the service is reachable."
                  : "Check your internet connection and try again when you're back online."}
              </p>
            </div>
          )}

          {isOnline && (
            <div className="text-center">
              <p className="text-sm text-zinc-400 leading-relaxed">
                If this problem persists, the service might be temporarily unavailable.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export function GamesGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-6">
      {Array.from({ length: count }).map((_, index) => (
        <Card key={index} className="overflow-hidden rounded-2xl border border-white/[.07] bg-zinc-900/60">
          <div className="udl-skeleton aspect-[3/4] rounded-none" />
          <CardContent className="p-5 space-y-3">
            <div className="udl-skeleton h-4 rounded-md" />
            <div className="udl-skeleton h-3 rounded-md w-3/4" />
            <div className="flex justify-between items-center">
              <div className="udl-skeleton h-3 rounded-md w-1/4" />
              <div className="udl-skeleton h-3 rounded-md w-1/3" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export function LoadingState({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-12 space-y-4">
      <div className="relative p-6 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-zinc-700">
        <LoadingAnimated className="h-10 w-10" />
      </div>
      <p className="text-zinc-400 text-base">{message}</p>
    </div>
  )
}

