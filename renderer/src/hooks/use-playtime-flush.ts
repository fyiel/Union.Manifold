import { useEffect, useRef } from "react"
import { useAuthContext } from "@/context/auth-context"
import { getApiBaseUrl } from "@/lib/api"

/**
 * Periodically flush pending playtime sessions to the UC backend. The main
 * process tracks sessions on game exit and queues them in playtime.json; this
 * hook just nudges the upload IPC when the user is signed in. We trigger:
 *
 *   • on auth state change (initial flush after sign-in)
 *   • whenever a fresh session lands (the main process broadcasts an event)
 *   • every 5 min as a safety net for users who keep UC.D open all day
 *
 * The IPC is best-effort and silent — failures stay logged in main only.
 */
export function usePlaytimeFlush() {
  const { isAuthenticated } = useAuthContext()
  const inFlightRef = useRef(false)

  useEffect(() => {
    const api = (window as any).ucPlaytime
    if (!api || typeof api.flush !== "function") return
    if (!isAuthenticated) return

    let cancelled = false
    const baseUrl = getApiBaseUrl()

    const flush = async () => {
      if (inFlightRef.current || cancelled) return
      inFlightRef.current = true
      try {
        await api.flush(baseUrl)
      } catch {
        // Surfaced via main-process logs — renderer stays quiet.
      } finally {
        inFlightRef.current = false
      }
    }

    // Initial flush, then a 5-minute heartbeat for long sessions.
    flush()
    const heartbeat = setInterval(flush, 5 * 60 * 1000)

    // Push-driven flush: as soon as the main process records a new session
    // we flush rather than waiting up to 5 min for the heartbeat.
    let unsubscribe: undefined | (() => void)
    try {
      unsubscribe = api.onSessionRecorded?.(() => { flush() })
    } catch { /* swallow */ }

    return () => {
      cancelled = true
      clearInterval(heartbeat)
      try { unsubscribe?.() } catch { /* swallow */ }
    }
  }, [isAuthenticated])
}
