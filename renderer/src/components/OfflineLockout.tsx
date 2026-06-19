import { useState } from "react"
import { RefreshCw, ExternalLink, Library } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { WifiOff } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { recheckApiReachability } from "@/lib/api"
import { useConnectivityStatus } from "@/hooks/use-online-status"

const STATUS_PAGE_URL = "https://status.union-crax.xyz"

/**
 * Full-page lockout shown when an online-only page is opened while offline.
 * Replaces the old behaviour where every page tried to load and collapsed into
 * a generic error. The Layout route guard renders this instead of the page when
 * `!isOnline` and the route isn't in the offline allowlist (library, activity,
 * collections, screenshots, settings).
 */
export function OfflineLockout() {
  const navigate = useNavigate()
  const { browserOnline } = useConnectivityStatus()
  const [retrying, setRetrying] = useState(false)

  // Distinguish "this machine has no internet" from "the internet is fine but
  // Union Crax itself isn't answering" — the fix is different for each.
  const deviceOffline = !browserOnline

  const handleRetry = async () => {
    if (retrying) return
    setRetrying(true)
    try {
      await recheckApiReachability()
      // If we're back online, the connectivity store flips and Layout swaps
      // this lockout out for the real page automatically — nothing else to do.
    } finally {
      setRetrying(false)
    }
  }

  const openStatusPage = () => {
    try {
      window.ucSystem?.openExternal?.(STATUS_PAGE_URL)
    } catch {
      // best-effort; nothing actionable if the shell bridge is missing
    }
  }

  return (
    <section className="flex min-h-[60vh] items-center justify-center px-4 py-16 text-center">
      <div className="mx-auto max-w-lg">
        <div className="mb-6 flex justify-center">
          <div className="rounded-2xl border border-orange-300/30 bg-gradient-to-br from-orange-400/20 to-orange-300/5 p-5 shadow-lg shadow-orange-400/10">
            <WifiOff className="h-12 w-12 text-orange-400" />
          </div>
        </div>

        <h2 className="mb-4 text-3xl font-black text-foreground sm:text-4xl">
          {deviceOffline ? "Your device is offline" : "Union Crax isn’t reachable"}
        </h2>

        <p className="mx-auto mb-3 max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg">
          {deviceOffline
            ? "This page needs an internet connection, and your device doesn’t have one right now. Reconnect and try again."
            : "This page needs to reach Union Crax, but we couldn’t connect. The service may be down or briefly unreachable from your network."}
        </p>

        <p className="mx-auto mb-8 max-w-md text-sm text-muted-foreground/70">
          Your <span className="font-semibold text-foreground/80">Library</span>, downloads, and
          collections still work offline — installed games launch as normal.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            onClick={handleRetry}
            disabled={retrying}
            variant="outline"
            className="rounded-xl border-2 border-orange-300/30 px-6 py-3 hover:border-orange-400/50"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${retrying ? "animate-spin" : ""}`} />
            {retrying ? "Checking…" : "Try again"}
          </Button>
          <Button
            onClick={() => navigate("/library")}
            className="rounded-xl px-6 py-3"
          >
            <Library className="mr-2 h-4 w-4" />
            Go to Library
          </Button>
        </div>

        {!deviceOffline && (
          <button
            type="button"
            onClick={openStatusPage}
            className="mt-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground/70 underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            Check the Union Crax status page
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </section>
  )
}
