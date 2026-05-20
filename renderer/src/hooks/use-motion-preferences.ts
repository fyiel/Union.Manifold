import { useEffect, useMemo, useState } from "react"

/**
 * Local source of truth for the launcher's "color aura" and reduced-motion
 * toggles. Mirrors the web app's `useMotionPreferences()`
 * (union-crax.xyz/hooks/use-motion-preferences.ts) so the same gating logic
 * runs on both. State lives in ucSettings (electron-store) AND localStorage
 * for instant reads. Settings sync to the user's account via
 * `useAppPreferencesSync`.
 *
 * Naming note: the user-facing feature is now "Color aura" — it paints the
 * game-page background and (incoming) glows around game-card hovers from
 * the artwork's dominant colors. The underlying storage keys keep their
 * historical `*animatedBackgrounds*` / `uc_enable_bg` names for wire
 * compatibility with the web app's preference sync — only the JS surface
 * and labels were renamed.
 */

export const ENABLE_BG_KEY = "uc_enable_bg"
export const REDUCED_MOTION_KEY = "uc_reduced_motion"

export const COLOR_AURA_SETTING = "animatedBackgroundsEnabled"
export const REDUCED_MOTION_SETTING = "reducedMotionEnabled"

export const COLOR_AURA_EVENT = "uc_enable_bg_pref"
export const REDUCED_MOTION_EVENT = "uc_reduce_motion_pref"

/** @deprecated kept for callers that haven't migrated to COLOR_AURA_* yet. */
export const ANIMATED_BACKGROUNDS_SETTING = COLOR_AURA_SETTING
/** @deprecated kept for callers that haven't migrated to COLOR_AURA_* yet. */
export const ANIMATED_BACKGROUNDS_EVENT = COLOR_AURA_EVENT

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
  const [colorAuraEnabled, setColorAuraState] = useState(readEnableBg)
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
          window.ucSettings?.get?.(COLOR_AURA_SETTING),
          window.ucSettings?.get?.(REDUCED_MOTION_SETTING),
        ])
        if (cancelled) return
        if (typeof bgVal === "boolean") {
          try { localStorage.setItem(ENABLE_BG_KEY, bgVal ? "1" : "0") } catch {}
          setColorAuraState(bgVal)
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
      setColorAuraState(readEnableBg())
      setReducedMotionEnabled(readReducedMotion())
    }
    window.addEventListener("storage", sync)
    window.addEventListener(COLOR_AURA_EVENT, sync)
    window.addEventListener(REDUCED_MOTION_EVENT, sync)

    const offSettings = window.ucSettings?.onChanged?.((data: any) => {
      if (!data) return
      if (data.key === COLOR_AURA_SETTING && typeof data.value === "boolean") {
        try { localStorage.setItem(ENABLE_BG_KEY, data.value ? "1" : "0") } catch {}
        setColorAuraState(data.value)
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
      window.removeEventListener(COLOR_AURA_EVENT, sync)
      window.removeEventListener(REDUCED_MOTION_EVENT, sync)
      if (typeof offSettings === "function") offSettings()
      if (mql && mqlListener) mql.removeEventListener("change", mqlListener)
    }
  }, [])

  // Reduced motion is the broad, site-wide damper: it gates color aura,
  // sidebar icon animations, page transitions, etc. Driven by either the
  // in-app toggle or the OS `prefers-reduced-motion` media query.
  const reducedMotionEffective = reducedMotionEnabled || osReducedMotion

  // Color aura runs only when the user opted in AND has not asked for
  // reduced motion. This same gate covers the game-page background and
  // (incoming) the game-card hover glow.
  const colorAuraEffective = useMemo(
    () => colorAuraEnabled && !reducedMotionEffective,
    [colorAuraEnabled, reducedMotionEffective]
  )

  // Mirror the effective reduced-motion state to <html data-reduced-motion>
  // so any stylesheet can opt into damping its own animations via
  // `html[data-reduced-motion="1"] .my-anim { animation: none }`.
  useEffect(() => {
    if (typeof document === "undefined") return
    const root = document.documentElement
    if (reducedMotionEffective) root.setAttribute("data-reduced-motion", "1")
    else root.removeAttribute("data-reduced-motion")
  }, [reducedMotionEffective])

  return {
    colorAuraEnabled,
    reducedMotionEnabled,
    osReducedMotion,
    reducedMotionEffective,
    colorAuraEffective,
    /** @deprecated use `colorAuraEnabled` */
    animatedBackgroundsEnabled: colorAuraEnabled,
    /** @deprecated use `colorAuraEffective` */
    effectiveAnimatedBackgrounds: colorAuraEffective,
  }
}

/**
 * Setters that update electron-store, localStorage, dispatch the cross-tab
 * event, and (when the consumer wires it up) sync to the user's account via
 * useAppPreferencesSync. Use these from the Settings page.
 */
export async function setColorAuraEnabled(value: boolean) {
  try { localStorage.setItem(ENABLE_BG_KEY, value ? "1" : "0") } catch {}
  try { await window.ucSettings?.set?.(COLOR_AURA_SETTING, value) } catch {}
  try { window.dispatchEvent(new Event(COLOR_AURA_EVENT)) } catch {}
}

/** @deprecated use `setColorAuraEnabled` */
export const setAnimatedBackgroundsEnabled = setColorAuraEnabled

export async function setReducedMotionEnabled(value: boolean) {
  try { localStorage.setItem(REDUCED_MOTION_KEY, value ? "1" : "0") } catch {}
  try { await window.ucSettings?.set?.(REDUCED_MOTION_SETTING, value) } catch {}
  try { window.dispatchEvent(new Event(REDUCED_MOTION_EVENT)) } catch {}
}
