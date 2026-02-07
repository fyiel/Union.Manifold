import { WifiOff, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

interface OfflineBannerProps {
  /** compact = small inline banner; full = large centered section */
  variant?: "compact" | "full"
  onRetry?: () => void
}

export function OfflineBanner({ variant = "full", onRetry }: OfflineBannerProps) {
  if (variant === "compact") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-orange-300/30 bg-gradient-to-r from-orange-400/10 via-orange-300/5 to-transparent px-4 py-3">
        <WifiOff className="h-4 w-4 shrink-0 text-orange-400" />
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-foreground">Using offline mode</span>
          <span className="ml-2 text-xs text-muted-foreground">
            Come back online to browse our collection.
          </span>
        </div>
        {onRetry && (
          <Button variant="ghost" size="sm" onClick={onRetry} className="shrink-0 text-xs">
            <RefreshCw className="mr-1.5 h-3 w-3" />
            Retry
          </Button>
        )}
      </div>
    )
  }

  return (
    <section className="py-20 sm:py-28 px-4 text-center">
      <div className="container mx-auto max-w-lg">
        <div className="flex justify-center mb-6">
          <div className="p-5 rounded-2xl bg-gradient-to-br from-orange-400/20 to-orange-300/5 border border-orange-300/30 shadow-lg shadow-orange-400/10">
            <WifiOff className="h-12 w-12 text-orange-400" />
          </div>
        </div>
        <h2 className="text-3xl sm:text-4xl font-black text-foreground font-montserrat mb-4">
          Using Offline Mode
        </h2>
        <p className="text-base sm:text-lg text-muted-foreground mb-6 max-w-md mx-auto leading-relaxed">
          You're currently offline. Come back online to browse our full collection of games.
        </p>
        <p className="text-sm text-muted-foreground/70 mb-8">
          Your installed games are still available in your Library.
        </p>
        {onRetry && (
          <Button
            onClick={onRetry}
            variant="outline"
            className="rounded-xl px-6 py-3 border-2 border-orange-300/30 hover:border-orange-400/50"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Try Again
          </Button>
        )}
      </div>
    </section>
  )
}
