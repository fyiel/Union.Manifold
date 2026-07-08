import { useCallback, useEffect, useRef, useState } from "react"
import { Palette } from "lucide-react"
import { ThemeEditorBody } from "./ThemeEditor"
import { useActiveTheme } from "@/hooks/use-active-theme"
import { useCustomThemes } from "@/hooks/use-custom-themes"
import { useUcPlus } from "@/hooks/use-uc-plus"
import { PRESET_THEMES } from "@/lib/themes/presets"
import type { ThemeDef } from "@/lib/themes/types"
import { validateTheme } from "@/lib/themes/validate"
import { useToast } from "@/context/toast-context"

type Seed = { theme: ThemeDef; mode: "new" | "edit" | "duplicate" }

export default function ThemeEditorWindow() {
  const { setActiveThemeId } = useActiveTheme()
  const { active: isUcPlus } = useUcPlus()
  const { customThemes, maxCustomThemes, addCustomTheme, updateCustomTheme } = useCustomThemes({ isUcPlus })
  const { toast } = useToast()

  const [seed, setSeed] = useState<Seed | null>(null)
  const [saved, setSaved] = useState(false)
  const savedRef = useRef(false)

  useEffect(() => {
    const editor = window.ucThemeEditor
    if (!editor?.onSeed) {
      setSeed({ theme: { ...PRESET_THEMES[0], name: "My Theme" }, mode: "new" })
      return
    }
    const off = editor.onSeed((incoming) => {
      const res = validateTheme(incoming?.theme)
      const mode = incoming?.mode === "edit" || incoming?.mode === "duplicate" ? incoming.mode : "new"
      setSeed({ theme: res.ok ? res.theme : { ...PRESET_THEMES[0], name: "My Theme" }, mode })
    })
    return () => { try { off?.() } catch {} }
  }, [])

  useEffect(() => {
    const onUnload = () => {
      if (!savedRef.current) {
        try { window.ucThemeEditor?.endPreview?.() } catch {}
      }
    }
    window.addEventListener("beforeunload", onUnload)
    return () => window.removeEventListener("beforeunload", onUnload)
  }, [])

  const handleChange = useCallback((draft: ThemeDef) => {
    try { window.ucThemeEditor?.sendPreview?.(draft) } catch {}
  }, [])

  const closeWindow = useCallback(() => {
    const editor = window.ucThemeEditor
    if (editor?.close) { void editor.close() }
    else { try { window.close() } catch {} }
  }, [])

  const handleSave = useCallback((theme: ThemeDef) => {
    const existing = customThemes.some((t) => t.id === theme.id)
    if (existing) {
      if (!updateCustomTheme(theme.id, theme)) {
        toast("Could not save theme.", "error")
        return
      }
    } else if (!addCustomTheme(theme)) {
      toast(
        `Limit reached (${maxCustomThemes} custom themes).${isUcPlus ? "" : " UC+ supporters get 100 slots."}`,
        "error"
      )
      return
    }
    setActiveThemeId(theme.id)
    savedRef.current = true
    setSaved(true)
    try { window.ucThemeEditor?.endPreview?.() } catch {}
    setTimeout(closeWindow, 120)
  }, [customThemes, updateCustomTheme, addCustomTheme, maxCustomThemes, isUcPlus, setActiveThemeId, toast, closeWindow])

  const handleCancel = useCallback(() => {
    try { window.ucThemeEditor?.endPreview?.() } catch {}
    closeWindow()
  }, [closeWindow])

  if (!seed) {
    return <div className="min-h-screen bg-background" />
  }

  if (saved) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <div className="text-lg font-medium">Theme saved</div>
          <p className="text-sm text-muted-foreground">You can close this window.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="flex items-center gap-3 px-6 py-4 border-b border-white/[.07] shrink-0">
        <Palette className="h-5 w-5 text-foreground/80" />
        <h1 className="text-base font-medium tracking-tight">Theme editor</h1>
        <span className="text-xs text-muted-foreground ml-1">Edits preview live in the main window.</span>
      </header>
      <div className="flex-1 min-h-0 flex flex-col">
        <ThemeEditorBody
          initial={seed.theme}
          onChange={handleChange}
          onSave={handleSave}
          onCancel={handleCancel}
          saveLabel={seed.mode === "edit" ? "Save changes" : "Create theme"}
        />
      </div>
    </div>
  )
}
