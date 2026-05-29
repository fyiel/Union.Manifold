import { useCallback, useEffect, useState } from "react"
import type { ThemeDef } from "@/lib/themes/types"
import { validateTheme } from "@/lib/themes/validate"

const LS_KEY = "uc_custom_themes"
const EVENT_NAME = "uc_custom_themes_pref"
export const MAX_CUSTOM_THEMES = 10

function readInitial(): ThemeDef[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(LS_KEY)
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

function persist(themes: ThemeDef[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(themes))
  } catch {}
  try { window.dispatchEvent(new Event(EVENT_NAME)) } catch {}
  void window.ucSettings?.set?.("customThemes", themes)
}

export function useCustomThemes(): {
  customThemes: ThemeDef[]
  addCustomTheme: (theme: ThemeDef) => boolean
  updateCustomTheme: (id: string, patch: Partial<ThemeDef>) => boolean
  deleteCustomTheme: (id: string) => void
  replaceAll: (themes: ThemeDef[]) => void
} {
  const [customThemes, setCustomThemes] = useState<ThemeDef[]>(() => readInitial())

  useEffect(() => {
    const onPref = () => setCustomThemes(readInitial())
    window.addEventListener(EVENT_NAME, onPref)
    window.addEventListener("storage", onPref)

    let off: undefined | (() => void)
    if (typeof window !== "undefined" && window.ucSettings?.onChanged) {
      off = window.ucSettings.onChanged((data: { key?: string; value?: unknown }) => {
        if (data?.key === "customThemes" && Array.isArray(data.value)) {
          try { localStorage.setItem(LS_KEY, JSON.stringify(data.value)) } catch {}
          setCustomThemes(readInitial())
        }
      })
    }

    void (async () => {
      try {
        const stored = await window.ucSettings?.get?.("customThemes")
        if (Array.isArray(stored)) {
          try { localStorage.setItem(LS_KEY, JSON.stringify(stored)) } catch {}
          setCustomThemes(readInitial())
        }
      } catch {}
    })()

    return () => {
      window.removeEventListener(EVENT_NAME, onPref)
      window.removeEventListener("storage", onPref)
      if (typeof off === "function") off()
    }
  }, [])

  const addCustomTheme = useCallback((theme: ThemeDef): boolean => {
    if (customThemes.length >= MAX_CUSTOM_THEMES) return false
    if (customThemes.some((t) => t.id === theme.id)) return false
    const next = [...customThemes, theme]
    setCustomThemes(next)
    persist(next)
    return true
  }, [customThemes])

  const updateCustomTheme = useCallback((id: string, patch: Partial<ThemeDef>): boolean => {
    const idx = customThemes.findIndex((t) => t.id === id)
    if (idx < 0) return false
    const next = customThemes.slice()
    next[idx] = { ...next[idx], ...patch, id, source: "custom" }
    setCustomThemes(next)
    persist(next)
    return true
  }, [customThemes])

  const deleteCustomTheme = useCallback((id: string) => {
    const next = customThemes.filter((t) => t.id !== id)
    setCustomThemes(next)
    persist(next)
  }, [customThemes])

  const replaceAll = useCallback((themes: ThemeDef[]) => {
    const sliced = themes.slice(0, MAX_CUSTOM_THEMES)
    setCustomThemes(sliced)
    persist(sliced)
  }, [])

  return { customThemes, addCustomTheme, updateCustomTheme, deleteCustomTheme, replaceAll }
}
