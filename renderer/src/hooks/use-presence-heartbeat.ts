import { useEffect } from "react"
import { useAuthContext } from "@/context/auth-context"
import { getApiBaseUrl } from "@/lib/api"

const HEARTBEAT_INTERVAL_MS = 2.5 * 60 * 1000 // 2.5 minutes

/**
 * Sends a presence heartbeat to the UC backend every 2.5 minutes while the
 * user is signed in. The server uses a 3-minute TTL to determine who is
 * online; if the heartbeat also carries a `currentAppid`, the same row drives
 * the "Now playing" counter.
 *
 * Pushes an extra heartbeat immediately whenever main broadcasts a presence
 * change (game start / game exit) so the website's counter reflects state
 * transitions within seconds instead of up to 2.5 minutes later.
 *
 * Fires once immediately on auth, then on the interval. Clears on sign-out
 * or unmount. Failures are silent — the count just doesn't update.
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
        // The main process fills in currentAppid from its `runningGames` Map,
        // so we don't pass any opts here — the renderer doesn't track game
        // process state itself.
        await api.heartbeat(baseUrl)
      } catch {
        // Silent — main-process logs the error if needed
      }
    }

    // Immediate ping on sign-in / mount, then periodic
    ping()
    const timer = setInterval(ping, HEARTBEAT_INTERVAL_MS)

    // Push-driven extra pings whenever a game starts/exits so the counter
    // updates within seconds. Best-effort; if onChanged isn't available
    // (older preload), the timer still keeps things in sync within 2.5 min.
    let unsubscribe: undefined | (() => void)
    try {
      unsubscribe = api.onChanged?.(() => { ping() })
    } catch { /* swallow */ }

    return () => {
      cancelled = true
      clearInterval(timer)
      try { unsubscribe?.() } catch { /* swallow */ }
    }
  }, [isAuthenticated])
}
