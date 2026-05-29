import { useEffect, useMemo, useState } from "react"
import { applyTheme } from "@/lib/themes/applyTheme"
import { DEFAULT_THEME_ID, PRESET_THEMES, getPresetById } from "@/lib/themes/presets"
import type { ThemeDef } from "@/lib/themes/types"
import { validateTheme } from "@/lib/themes/validate"

const LS_KEY = "uc_active_theme"
const EVENT_NAME = "uc_theme_pref"
const CUSTOM_LS_KEY = "uc_custom_themes"
const INSTALLED_LS_KEY = "uc_installed_community_themes"

function readInitialThemeId(): string {
  try {
    const v = localStorage.getItem(LS_KEY)
    if (typeof v === "string" && v.length > 0) return v
  } catch {}
  return DEFAULT_THEME_ID
}

function readThemesFromStorage(key: string): ThemeDef[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const out: ThemeDef[] = []
    for (const t of parsed) {
      const res = validateTheme(t)
      if (res.ok) out.push(res.theme)
    }
    return out
  } catch {
    return []
  }
}

function resolveTheme(id: string, custom: ThemeDef[], installed: ThemeDef[]): ThemeDef {
  return (
    getPresetById(id) ??
    custom.find((t) => t.id === id) ??
    installed.find((t) => t.id === id) ??
    PRESET_THEMES[0]
  )
}

export function useActiveTheme(): {
  activeThemeId: string
  activeTheme: ThemeDef
  setActiveThemeId: (id: string) => void
} {
  const [activeThemeId, setActiveThemeIdState] = useState<string>(() => readInitialThemeId())
  const [customThemes, setCustomThemes] = useState<ThemeDef[]>(() => readThemesFromStorage(CUSTOM_LS_KEY))
  const [installedThemes, setInstalledThemes] = useState<ThemeDef[]>(() => readThemesFromStorage(INSTALLED_LS_KEY))

  const activeTheme = useMemo(
    () => resolveTheme(activeThemeId, customThemes, installedThemes),
    [activeThemeId, customThemes, installedThemes],
  )

  useEffect(() => {
    applyTheme(activeTheme)
  }, [activeTheme])

  useEffect(() => {
    const refresh = () => {
      const next = readInitialThemeId()
      setActiveThemeIdState((prev) => (prev === next ? prev : next))
      setCustomThemes(readThemesFromStorage(CUSTOM_LS_KEY))
      setInstalledThemes(readThemesFromStorage(INSTALLED_LS_KEY))
    }
    window.addEventListener(EVENT_NAME, refresh)
    window.addEventListener("uc_custom_themes_pref", refresh)
    window.addEventListener("uc_installed_themes_pref", refresh)
    window.addEventListener("storage", refresh)

    let off: undefined | (() => void)
    if (typeof window !== "undefined" && window.ucSettings?.onChanged) {
      off = window.ucSettings.onChanged((data: { key?: string; value?: unknown }) => {
        if (data?.key === "activeThemeId" && typeof data.value === "string" && data.value.length > 0) {
          try { localStorage.setItem(LS_KEY, data.value) } catch {}
          setActiveThemeIdState(data.value)
        } else if (data?.key === "customThemes" && Array.isArray(data.value)) {
          try { localStorage.setItem(CUSTOM_LS_KEY, JSON.stringify(data.value)) } catch {}
          setCustomThemes(readThemesFromStorage(CUSTOM_LS_KEY))
        }
      })
    }

    void (async () => {
      try {
        const stored = await window.ucSettings?.get?.("activeThemeId")
        if (typeof stored === "string" && stored.length > 0) {
          try { localStorage.setItem(LS_KEY, stored) } catch {}
          setActiveThemeIdState((prev) => (prev === stored ? prev : stored))
        }
      } catch {}
      try {
        const stored = await window.ucSettings?.get?.("customThemes")
        if (Array.isArray(stored)) {
          try { localStorage.setItem(CUSTOM_LS_KEY, JSON.stringify(stored)) } catch {}
          setCustomThemes(readThemesFromStorage(CUSTOM_LS_KEY))
        }
      } catch {}
    })()

    return () => {
      window.removeEventListener(EVENT_NAME, refresh)
      window.removeEventListener("uc_custom_themes_pref", refresh)
      window.removeEventListener("uc_installed_themes_pref", refresh)
      window.removeEventListener("storage", refresh)
      if (typeof off === "function") off()
    }
  }, [])

  const setActiveThemeId = (id: string) => {
    try { localStorage.setItem(LS_KEY, id) } catch {}
    setActiveThemeIdState(id)
    try { window.dispatchEvent(new Event(EVENT_NAME)) } catch {}
    void window.ucSettings?.set?.("activeThemeId", id)
  }

  return {
    activeThemeId,
    activeTheme,
    setActiveThemeId,
  }
}
