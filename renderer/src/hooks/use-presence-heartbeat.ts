import { useEffect } from "react"
import { useAuthContext } from "@/context/auth-context"
import { getApiBaseUrl } from "@/lib/api"

const HEARTBEAT_INTERVAL_MS = 2.5 * 60 * 1000 // 2.5 minutes

/**
 * Sends a presence heartbeat to the UC backend every 2.5 minutes while the
 * user is signed in.  The server uses a 3-minute TTL to determine who is
 * "online now", and the site-stats bar shows this count in real time.
 *
 * Fires once immediately on auth, then on the interval.  Clears on sign-out
 * or unmount.  Failures are silent — the count just doesn't update.
 */
export function usePresenceHeartbeat() {
  const { isAuthenticated } = useAuthContext()

  useEffect(() => {
    const api = (window as any).ucPresence
    if (!api || typeof api.heartbeat !== "function") return
    if (!isAuthenticated) return

    const baseUrl = getApiBaseUrl()
    let cancelled = false

    const ping = async () => {
      if (cancelled) return
      try {
        await api.heartbeat(baseUrl)
      } catch {
        // Silent — main-process logs the error if needed
      }
    }

    // Immediate ping on sign-in / mount, then periodic
    ping()
    const timer = setInterval(ping, HEARTBEAT_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [isAuthenticated])
}
