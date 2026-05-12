import { useEffect, useMemo, useState } from "react"

/**
 * Local source of truth for the launcher's animated-background and
 * reduced-motion toggles. Mirrors the web app's `useMotionPreferences()`
 * (union-crax.xyz/hooks/use-motion-preferences.ts) so the same gating logic
 * runs on both. State lives in ucSettings (electron-store) AND localStorage
 * for instant reads. Settings sync to the user's account via
 * `useAppPreferencesSync`.
 */

export const ENABLE_BG_KEY = "uc_enable_bg"
export const REDUCED_MOTION_KEY = "uc_reduced_motion"

export const ANIMATED_BACKGROUNDS_SETTING = "animatedBackgroundsEnabled"
export const REDUCED_MOTION_SETTING = "reducedMotionEnabled"

export const ANIMATED_BACKGROUNDS_EVENT = "uc_enable_bg_pref"
export const REDUCED_MOTION_EVENT = "uc_reduce_motion_pref"

function readEnableBg(): boolean {
  if (typeof window === "undefined") return true
  try {
    const raw = localStorage.getItem(ENABLE_BG_KEY)
    if (raw === "0") return false
    return true
  } catch {
    return true
  }
}

function readReducedMotion(): boolean {
  if (typeof window === "undefined") return false
  try {
    return localStorage.getItem(REDUCED_MOTION_KEY) === "1"
  } catch {
    return false
  }
}

function readOsReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
  } catch {
    return false
  }
}

export function useMotionPreferences() {
  const [animatedBackgroundsEnabled, setAnimatedBackgroundsEnabled] = useState(readEnableBg)
  const [reducedMotionEnabled, setReducedMotionEnabled] = useState(readReducedMotion)
  const [osReducedMotion, setOsReducedMotion] = useState(readOsReducedMotion)

  // Hydrate from electron-store (authoritative for persisted user choice),
  // then mirror to localStorage so the synchronous reads above stay correct.
  useEffect(() => {
    if (typeof window === "undefined" || !window.ucSettings?.get) return
    let cancelled = false
    void (async () => {
      try {
        const [bgVal, rmVal] = await Promise.all([
          window.ucSettings?.get?.(ANIMATED_BACKGROUNDS_SETTING),
          window.ucSettings?.get?.(REDUCED_MOTION_SETTING),
        ])
        if (cancelled) return
        if (typeof bgVal === "boolean") {
          try { localStorage.setItem(ENABLE_BG_KEY, bgVal ? "1" : "0") } catch {}
          setAnimatedBackgroundsEnabled(bgVal)
        }
        if (typeof rmVal === "boolean") {
          try { localStorage.setItem(REDUCED_MOTION_KEY, rmVal ? "1" : "0") } catch {}
          setReducedMotionEnabled(rmVal)
        }
      } catch {
        // ignore
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const sync = () => {
      setAnimatedBackgroundsEnabled(readEnableBg())
      setReducedMotionEnabled(readReducedMotion())
    }
    window.addEventListener("storage", sync)
    window.addEventListener(ANIMATED_BACKGROUNDS_EVENT, sync)
    window.addEventListener(REDUCED_MOTION_EVENT, sync)

    const offSettings = window.ucSettings?.onChanged?.((data: any) => {
      if (!data) return
      if (data.key === ANIMATED_BACKGROUNDS_SETTING && typeof data.value === "boolean") {
        try { localStorage.setItem(ENABLE_BG_KEY, data.value ? "1" : "0") } catch {}
        setAnimatedBackgroundsEnabled(data.value)
      }
      if (data.key === REDUCED_MOTION_SETTING && typeof data.value === "boolean") {
        try { localStorage.setItem(REDUCED_MOTION_KEY, data.value ? "1" : "0") } catch {}
        setReducedMotionEnabled(data.value)
      }
    })

    let mql: MediaQueryList | null = null
    let mqlListener: ((event: MediaQueryListEvent) => void) | null = null
    try {
      if (window.matchMedia) {
        mql = window.matchMedia("(prefers-reduced-motion: reduce)")
        mqlListener = (event) => setOsReducedMotion(event.matches)
        mql.addEventListener("change", mqlListener)
      }
    } catch {
      // ignore
    }

    return () => {
      window.removeEventListener("storage", sync)
      window.removeEventListener(ANIMATED_BACKGROUNDS_EVENT, sync)
      window.removeEventListener(REDUCED_MOTION_EVENT, sync)
      if (typeof offSettings === "function") offSettings()
      if (mql && mqlListener) mql.removeEventListener("change", mqlListener)
    }
  }, [])

  // Animations run only when the user has opted in AND has not asked for
  // reduced motion (in-app toggle or OS preference).
  const effectiveAnimatedBackgrounds = useMemo(
    () => animatedBackgroundsEnabled && !reducedMotionEnabled && !osReducedMotion,
    [animatedBackgroundsEnabled, reducedMotionEnabled, osReducedMotion]
  )

  return {
    animatedBackgroundsEnabled,
    reducedMotionEnabled,
    osReducedMotion,
    effectiveAnimatedBackgrounds,
  }
}

/**
 * Setters that update electron-store, localStorage, dispatch the cross-tab
 * event, and (when the consumer wires it up) sync to the user's account via
 * useAppPreferencesSync. Use these from the Settings page.
 */
export async function setAnimatedBackgroundsEnabled(value: boolean) {
  try { localStorage.setItem(ENABLE_BG_KEY, value ? "1" : "0") } catch {}
  try { await window.ucSettings?.set?.(ANIMATED_BACKGROUNDS_SETTING, value) } catch {}
  try { window.dispatchEvent(new Event(ANIMATED_BACKGROUNDS_EVENT)) } catch {}
}

export async function setReducedMotionEnabled(value: boolean) {
  try { localStorage.setItem(REDUCED_MOTION_KEY, value ? "1" : "0") } catch {}
  try { await window.ucSettings?.set?.(REDUCED_MOTION_SETTING, value) } catch {}
  try { window.dispatchEvent(new Event(REDUCED_MOTION_EVENT)) } catch {}
}
