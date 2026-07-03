import { useEffect, useRef } from "react"
import { useDownloadsActions, useDownloadsSelector } from "@/context/downloads-context"

const SETTING_KEY = "pauseDownloadsWhilePlaying"
const ACTIVE = ["downloading", "extracting", "installing", "verifying", "retrying", "queued"]

// When "pause downloads while playing" is on, pause everything the moment a game
// starts and resume on exit. We only resume if we were the ones who paused, so a
// download the user paused by hand stays paused. Mounted once in ForkLayout so it
// applies wherever a game launches. Restored from the upstream hook, adapted to
// the fork's group level pauseAll/resumeAll.
export function usePauseDownloadsWhilePlaying() {
  const { pauseAll, resumeAll } = useDownloadsActions()
  const enabledRef = useRef(false)
  const autoPausedRef = useRef(false)
  // keep the latest downloads off a ref so the presence listener stays stable
  const hasActive = useDownloadsSelector((dls) => dls.some((x) => ACTIVE.includes(x.status)), (a, b) => a === b)
  const hasActiveRef = useRef(hasActive)
  hasActiveRef.current = hasActive

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const v = await window.ucSettings?.get?.(SETTING_KEY)
        if (!cancelled) enabledRef.current = Boolean(v)
      } catch { /* ignore */ }
    })()
    const off = window.ucSettings?.onChanged?.((d) => {
      if (!d) return
      if (d.key === "__CLEAR_ALL__") { enabledRef.current = false; return }
      if (d.key === SETTING_KEY) enabledRef.current = Boolean(d.value)
    })
    return () => { cancelled = true; off?.() }
  }, [])

  useEffect(() => {
    const off = window.ucPresence?.onChanged?.((detail) => {
      if (!detail || !enabledRef.current) return
      if (detail.reason === "game-started") {
        if (!hasActiveRef.current) return
        autoPausedRef.current = true
        void pauseAll()
      } else if (detail.reason === "game-exited") {
        if (!autoPausedRef.current) return
        autoPausedRef.current = false
        void resumeAll()
      }
    })
    return () => { off?.() }
  }, [pauseAll, resumeAll])
}
