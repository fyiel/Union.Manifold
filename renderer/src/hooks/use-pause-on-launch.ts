import { useEffect, useRef } from "react"
import { useDownloads, useDownloadsActions } from "@/context/downloads-context"

const SETTING_KEY = "pauseDownloadsWhilePlaying"

/**
 * When the "Pause downloads while playing" setting is on, listen for
 * `ucPresence.onChanged` and call pauseAll() the moment a game starts.
 * On game-exited we resume only the downloads we paused — so anything the
 * user paused by hand stays paused.
 *
 * Mounted once at Layout level so the behaviour applies anywhere the user
 * launches a game (sidebar Quit, GameCard play, detail page, deep-link).
 */
export function usePauseDownloadsWhilePlaying() {
  const { downloads, pauseDownload, resumeDownload } = useDownloads() as any
  const { pauseAll: actionPauseAll, resumeAll: actionResumeAll } = useDownloadsActions() as any
  const enabledRef = useRef(false)
  // Set of downloadIds we auto-paused — used so we don't accidentally resume
  // a download the user paused by hand.
  const autoPausedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const value = await window.ucSettings?.get?.(SETTING_KEY)
        if (!cancelled) enabledRef.current = Boolean(value)
      } catch { /* ignore */ }
    })()
    const off = window.ucSettings?.onChanged?.((data: any) => {
      if (!data) return
      if (data.key === "__CLEAR_ALL__") { enabledRef.current = false; return }
      if (data.key === SETTING_KEY) enabledRef.current = Boolean(data.value)
    })
    return () => {
      cancelled = true
      if (typeof off === "function") off()
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    const off = window.ucPresence?.onChanged?.(async (detail) => {
      if (!detail || !enabledRef.current) return
      if (detail.reason === "game-started") {
        // Snapshot the currently-active downloads, pause each, remember which
        // ones we touched so we can resume only those later.
        const activeIds: string[] = []
        for (const item of downloads) {
          if (["downloading", "extracting", "installing", "verifying", "retrying", "queued"].includes(item.status)) {
            activeIds.push(item.downloadId)
          }
        }
        if (activeIds.length === 0) return
        try {
          if (typeof actionPauseAll === "function") {
            await actionPauseAll()
          } else {
            for (const id of activeIds) {
              try { await pauseDownload?.(id) } catch { /* ignore */ }
            }
          }
          for (const id of activeIds) autoPausedRef.current.add(id)
        } catch { /* ignore */ }
      } else if (detail.reason === "game-exited") {
        // Only resume if at least one auto-paused download remains. If the
        // user has cleared / completed them all, nothing to do.
        const idsToResume = Array.from(autoPausedRef.current)
        autoPausedRef.current.clear()
        if (idsToResume.length === 0) return
        try {
          if (typeof actionResumeAll === "function") {
            await actionResumeAll()
          } else {
            for (const id of idsToResume) {
              try { await resumeDownload?.(id) } catch { /* ignore */ }
            }
          }
        } catch { /* ignore */ }
      }
    })
    return () => { if (typeof off === "function") off() }
  }, [downloads, pauseDownload, resumeDownload, actionPauseAll, actionResumeAll])
}

export const PAUSE_DOWNLOADS_WHILE_PLAYING_SETTING = SETTING_KEY
