import { useEffect, useRef } from "react"
import { apiFetch } from "@/lib/api"
import { useDiscordAccount } from "@/hooks/use-discord-account"
import { useDownloadsActions } from "@/context/downloads-context"
import { useToast } from "@/context/toast-context"
import { downloadLogger } from "@/lib/logger"
import type { Game } from "@/lib/types"

type QueueEntry = {
  appid: string
  name?: string
  queueSource?: string
  /** When set, the website pinned this download to a specific PC's system-
   *  profile fingerprint. Only that device should start it; other devices
   *  leave it in the queue. Null/absent means "any device" (legacy behaviour). */
  deviceFingerprint?: string | null
} & Partial<Game>

/**
 * Continuously drains the user's cross-device download queue
 * (`/api/account/download-queue`). Games added from the website are
 * auto-started here — each surfaced with a "via uc.xyz" note — then removed
 * from the server so they don't re-trigger.
 *
 * This polls on an interval (and on window focus) rather than running once at
 * launch, so a download triggered from the user's phone starts on an
 * already-open app without needing a restart. Because each entry is deleted
 * from the server as soon as it's started, a subsequent poll won't re-process
 * it. `startGameDownload` is also idempotent (no-ops when an active download
 * already exists for the appid), and a `runningRef` prevents overlapping
 * drains.
 */
const POLL_INTERVAL_MS = 25_000

async function getLocalFingerprint(): Promise<string | null> {
  try {
    const res = await window.ucSystemProfile?.getCached?.()
    if (res?.ok && res.profile?.fingerprint) return res.profile.fingerprint
  } catch {
    // fall through to summary
  }
  try {
    const s = await window.ucSystemProfile?.summary?.()
    if (s?.ok && s.fingerprint) return s.fingerprint
  } catch {
    // best-effort
  }
  return null
}

async function removeFromServerQueue(appid: string) {
  try {
    await apiFetch("/api/account/download-queue", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appid }),
    })
  } catch {
    // Best-effort — if the delete fails the entry gets retried on the next
    // poll, which is harmless (startGameDownload de-dupes active jobs).
  }
}

export function WebDownloadQueueConsumer() {
  const { user, loading } = useDiscordAccount()
  const { startGameDownload } = useDownloadsActions()
  const { toast } = useToast()
  const runningRef = useRef(false)
  // This device's own system-profile fingerprint, resolved lazily and cached.
  // Used to decide whether a device-targeted queue entry belongs to us.
  const fingerprintRef = useRef<string | null>(null)
  // Keep the latest startGameDownload in a ref so the polling effect doesn't
  // tear down / restart its interval whenever the actions object identity
  // changes.
  const startRef = useRef(startGameDownload)
  startRef.current = startGameDownload
  const toastRef = useRef(toast)
  toastRef.current = toast

  useEffect(() => {
    if (loading || !user) return

    let cancelled = false

    const drain = async () => {
      if (cancelled || runningRef.current) return
      runningRef.current = true
      try {
        const res = await apiFetch("/api/account/download-queue")
        if (!res.ok) return
        const items = (await res.json()) as QueueEntry[]
        if (!Array.isArray(items) || items.length === 0) return
        if (cancelled) return

        // Resolve our own fingerprint once we need it, so we can tell which
        // device-targeted entries belong to this PC. Retried on later drains
        // if it isn't available yet (e.g. the system profile hasn't scanned).
        if (fingerprintRef.current == null) {
          fingerprintRef.current = await getLocalFingerprint()
        }
        const myFingerprint = fingerprintRef.current

        const startedNames: string[] = []
        for (const item of items) {
          if (cancelled) break
          const appid = String(item?.appid || "")
          if (!appid) continue
          // Device-targeted entry for a different PC — leave it in the queue
          // (don't start it, don't delete it) so the intended device drains it.
          const target = item?.deviceFingerprint ? String(item.deviceFingerprint) : null
          if (target && target !== myFingerprint) continue
          try {
            const game = { source: "web", ...item, appid } as unknown as Game
            await startRef.current(game)
            startedNames.push(item.name || appid)
          } catch (err) {
            downloadLogger.warn(`Failed to start uc.xyz-queued download for ${appid}`, {
              context: "DOWNLOAD",
              data: { error: err instanceof Error ? err.message : String(err) },
            })
          } finally {
            // Clear the entry regardless — a failed start shouldn't keep the
            // game stuck in the queue forever.
            await removeFromServerQueue(appid)
          }
        }

        if (!cancelled && startedNames.length > 0) {
          const note =
            startedNames.length === 1
              ? `Started “${startedNames[0]}” — queued via uc.xyz`
              : `Started ${startedNames.length} downloads queued via uc.xyz`
          toastRef.current(note, "info", 6000)
        }
      } catch {
        // Network failure — leave the queue intact and let the next poll retry.
      } finally {
        runningRef.current = false
      }
    }

    // Drain immediately on sign-in / mount, then poll.
    void drain()
    const interval = window.setInterval(() => void drain(), POLL_INTERVAL_MS)

    // Also drain as soon as the window regains focus / becomes visible, so a
    // download queued from a phone shows up near-instantly when the user
    // returns to the app.
    const onFocus = () => void drain()
    const onVisible = () => {
      if (document.visibilityState === "visible") void drain()
    }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisible)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [user, loading])

  return null
}
