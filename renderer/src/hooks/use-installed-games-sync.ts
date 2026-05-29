import { useEffect, useRef } from "react"
import { useAuthContext } from "@/context/auth-context"
import { apiFetch } from "@/lib/api"
import { logger } from "@/lib/logger"

const SYNC_DEBOUNCE_MS = 5_000
const SAFETY_INTERVAL_MS = 60 * 60 * 1000 // 1h heartbeat as a backstop
const INSTALLS_PATH = "/api/internal/uc-direct/installs"

/**
 * Push the current set of locally-installed games to the UC backend so the
 * website's game pages can render the "Installed" badge for this user.
 *
 * Strategy:
 *   • Run once on sign-in (snapshot mode) so the server's view matches what
 *     we have locally  -  this also reconciles anything that changed while
 *     UC.D was closed.
 *   • Re-snapshot whenever `window.ucDownloads.onUpdate` fires with a status
 *     that implies an install/uninstall transition.
 *   • Debounce coalescing rapid bursts (e.g. extracting a multi-part archive
 *     emits many progress events).
 *
 * Authentication piggybacks on `apiFetch`, which goes through
 * `window.ucAuth.fetch` when available  -  so the server identifies the
 * current user from the session and we don't need any client-side secret.
 */
export function useInstalledGamesSync() {
  const { isAuthenticated } = useAuthContext()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef(false)
  const lastFingerprintRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isAuthenticated) {
      lastFingerprintRef.current = null
      return
    }
    if (typeof window === "undefined") return
    const downloads = window.ucDownloads
    if (!downloads || typeof downloads.listInstalledGlobal !== "function") return

    let cancelled = false

    const collectInstalled = async (): Promise<Array<{ appid: string }>> => {
      try {
        const list =
          (await downloads.listInstalledGlobal?.()) ??
          (await downloads.listInstalled?.()) ??
          []
        const seen = new Set<string>()
        const out: Array<{ appid: string }> = []
        for (const entry of list as Array<{ appid?: unknown }>) {
          const raw = entry?.appid
          if (typeof raw !== "string") continue
          const appid = raw.trim()
          if (!appid || seen.has(appid)) continue
          seen.add(appid)
          out.push({ appid })
        }
        // Stable order so the fingerprint compares correctly.
        out.sort((a, b) => a.appid.localeCompare(b.appid))
        return out
      } catch (err) {
        logger.warn("installed-games-sync: collect failed", { data: { err: String(err) } })
        return []
      }
    }

    const push = async () => {
      if (cancelled || inFlightRef.current) return
      inFlightRef.current = true
      try {
        const installed = await collectInstalled()
        const fingerprint = installed.map((g) => g.appid).join("|")
        if (fingerprint === lastFingerprintRef.current) {
          // Nothing changed since the last successful push.
          return
        }
        const res = await apiFetch(INSTALLS_PATH, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "snapshot", installed }),
        })
        if (res.ok) {
          lastFingerprintRef.current = fingerprint
        } else {
          // Don't poison the fingerprint cache on a transient failure  -  the
          // next push will re-attempt the same set.
          logger.warn("installed-games-sync: push failed", { data: { status: res.status } })
        }
      } catch (err) {
        logger.warn("installed-games-sync: push errored", { data: { err: String(err) } })
      } finally {
        inFlightRef.current = false
      }
    }

    const schedulePush = () => {
      if (cancelled) return
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null
        void push()
      }, SYNC_DEBOUNCE_MS)
    }

    // Initial push  -  fire immediately (no debounce) so the badge appears on
    // first visit to a game page after launching UC.D.
    void push()

    // Hourly safety net for users who keep UC.D open across deletes that
    // somehow don't trigger an onUpdate (renames, manual folder cleanup).
    const safetyTimer = setInterval(schedulePush, SAFETY_INTERVAL_MS)

    // Re-snapshot on download lifecycle events that imply an install/uninstall.
    // We don't try to be clever about which transition  -  the server-side
    // snapshot mode will reconcile any drift.
    let unsubscribeUpdate: undefined | (() => void)
    try {
      unsubscribeUpdate = downloads.onUpdate?.((update) => {
        const status = (update as { status?: string })?.status
        if (
          status === "completed" ||
          status === "done" ||
          status === "extracted" ||
          status === "extract_complete" ||
          status === "installed" ||
          status === "removed" ||
          status === "deleted" ||
          status === "uninstalled"
        ) {
          schedulePush()
        }
      })
    } catch (err) {
      logger.warn("installed-games-sync: onUpdate subscribe failed", { data: { err: String(err) } })
    }

    return () => {
      cancelled = true
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      clearInterval(safetyTimer)
      try { unsubscribeUpdate?.() } catch { /* swallow */ }
    }
  }, [isAuthenticated])
}
