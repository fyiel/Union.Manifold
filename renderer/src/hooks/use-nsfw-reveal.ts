import { useCallback, useEffect, useState } from "react"
import { nsfwRevealedAppids } from "@/lib/nsfw-session"

const PREF_KEY = "uc_show_nsfw"
const PREF_EVENT = "uc_nsfw_pref"
const SESSION_EVENT = "uc_nsfw_session_changed"

function readPreference() {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(PREF_KEY) === "1"
  } catch {
    return false
  }
}

/**
 * Subscribe to the global "show NSFW" preference.
 *
 * Reads localStorage["uc_show_nsfw"] === "1", and re-fires when the user
 * flips the toggle (uc_nsfw_pref) or another tab changes localStorage.
 *
 * Previously this logic was hand-rolled in GameCard, GameCardCompact, and
 * SearchSuggestions — three drift-prone copies that disagreed on whether to
 * default to `false` vs leaving state untouched on error.
 */
export function useNsfwPreference(): boolean {
  const [allow, setAllow] = useState<boolean>(() => readPreference())

  useEffect(() => {
    if (typeof window === "undefined") return
    const sync = () => setAllow(readPreference())
    const onStorage = (event: StorageEvent) => {
      if (event.key === PREF_KEY) sync()
    }
    window.addEventListener(PREF_EVENT, sync)
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener(PREF_EVENT, sync)
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  return allow
}

/**
 * Per-card "reveal NSFW art" state, combining:
 *  - global preference (above), and
 *  - the session-scope set of appids the user explicitly clicked Reveal on.
 *
 * `revealed` is true when either is true. `reveal()` records the appid in
 * the session set (and broadcasts so sibling cards re-render). The session
 * set is in-memory and resets on page reload — see `lib/nsfw-session.ts`.
 */
export function useNsfwReveal(appid: string): { revealed: boolean; reveal: () => void } {
  const allowGlobal = useNsfwPreference()
  const [sessionRevealed, setSessionRevealed] = useState<boolean>(
    () => nsfwRevealedAppids.has(appid)
  )

  useEffect(() => {
    if (typeof window === "undefined") return
    const check = () => setSessionRevealed(nsfwRevealedAppids.has(appid))
    check()
    window.addEventListener(SESSION_EVENT, check)
    return () => window.removeEventListener(SESSION_EVENT, check)
  }, [appid])

  const reveal = useCallback(() => {
    nsfwRevealedAppids.add(appid)
    setSessionRevealed(true)
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(SESSION_EVENT))
    }
  }, [appid])

  return { revealed: sessionRevealed || allowGlobal, reveal }
}
