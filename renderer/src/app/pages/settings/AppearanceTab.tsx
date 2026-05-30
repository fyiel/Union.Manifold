import { useMemo, useRef, useState } from "react"
import { Check, Globe, Plus } from "@/components/icons"
import { Copy, MoreVertical, Share2, Trash2, Upload } from "@/components/icons"
import { Pencil } from "lucide-react"
import { apiFetch } from "@/lib/api"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useActiveTheme } from "@/hooks/use-active-theme"
import { useCustomThemes, MAX_CUSTOM_THEMES } from "@/hooks/use-custom-themes"
import { PRESET_THEMES } from "@/lib/themes/presets"
import type { ThemeDef } from "@/lib/themes/types"
import { decodeTheme, encodeTheme } from "@/lib/themes/encode"
import { generateThemeId } from "@/lib/themes/colorUtil"
import { cn } from "@/lib/utils"
import { useToast } from "@/context/toast-context"
import {
  CollectionActionContextMenu,
  type CollectionMenuPoint,
  type CollectionMenuSection,
} from "@/components/CollectionActionMenu"
import { ThemeEditor } from "./ThemeEditor"
import { CommunityBrowser } from "./CommunityBrowser"

function ThemeSwatchRow({ theme }: { theme: ThemeDef }) {
  const tokens: Array<keyof ThemeDef["colors"]> = ["background", "card", "primary", "accent", "destructive"]
  const swatchRadius = `calc(${theme.radius} * 0.5)`
  return (
    <div className="flex items-center gap-1">
      {tokens.map((token) => (
        <span
          key={token}
          className="h-5 w-5 border border-white/10"
          style={{ background: theme.colors[token], borderRadius: swatchRadius }}
        />
      ))}
    </div>
  )
}

function ThemeCard({
  theme,
  active,
  onSelect,
  menuSections,
  publishingPulse,
}: {
  theme: ThemeDef
  active: boolean
  onSelect: () => void
  menuSections: CollectionMenuSection[]
  publishingPulse?: boolean
}) {
  const [menuPoint, setMenuPoint] = useState<CollectionMenuPoint | null>(null)
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null)

  const hasActions = menuSections.some((s) => s.items.length > 0)

  const openFromTrigger = () => {
    const rect = menuTriggerRef.current?.getBoundingClientRect()
    if (!rect) return
    // Drop the menu just below the 3-dots button, right-aligned to it; the
    // ContextMenu itself clamps to viewport so we don't need to be precise.
    setMenuPoint({ x: rect.right - 224, y: rect.bottom + 6 })
  }

  const openFromContextMenu = (e: React.MouseEvent) => {
    if (!hasActions) return
    e.preventDefault()
    setMenuPoint({ x: e.clientX, y: e.clientY })
  }

  return (
    <div
      onContextMenu={openFromContextMenu}
      className={cn(
        "group relative flex flex-col gap-3 rounded-xl border p-4 text-left transition-all",
        active
          ? "border-primary/50 bg-primary/[.08]"
          : "border-border bg-card/40 hover:border-primary/30 hover:bg-card/70",
      )}
    >
      {/* Full-card activation button sits BEHIND the menu trigger via z-index. */}
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        className="absolute inset-0 rounded-xl"
        aria-label={`Activate ${theme.name}`}
      />

      {/* 3-dots menu trigger, floats top-right and stays above the activation
          overlay. Only rendered when the theme actually has actions. */}
      {hasActions && (
        <button
          ref={menuTriggerRef}
          type="button"
          onClick={(e) => { e.stopPropagation(); openFromTrigger() }}
          aria-label={`Actions for ${theme.name}`}
          className={cn(
            "absolute top-2 right-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-transparent text-muted-foreground transition-all",
            "hover:border-border hover:bg-secondary hover:text-foreground",
            "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
            menuPoint && "opacity-100",
            publishingPulse && "opacity-100 animate-pulse",
          )}
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      )}

      <div className="relative pointer-events-none">
        <div
          className="h-20 w-full rounded-lg border border-white/5 overflow-hidden relative"
          style={{ background: theme.colors.background }}
        >
          <div
            className="absolute left-3 top-3 h-9 w-2/3 rounded-md"
            style={{ background: theme.colors.card, borderRadius: theme.radius }}
          />
          <div
            className="absolute left-3 bottom-3 h-5 w-16 rounded-md flex items-center justify-center text-[10px] font-medium"
            style={{
              background: theme.colors.primary,
              color: theme.colors["primary-foreground"],
              borderRadius: theme.radius,
            }}
          >
            Aa
          </div>
        </div>
      </div>
      <div className="relative flex items-center justify-between gap-2 pointer-events-none">
        <div className="min-w-0">
          <div className="text-sm font-medium leading-tight truncate">{theme.name}</div>
          <div className="text-[11px] text-muted-foreground leading-tight mt-0.5 capitalize">{theme.source}</div>
        </div>
        {active && (
          <span className="shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-3 w-3" />
          </span>
        )}
      </div>
      <div className="relative pointer-events-none">
        <ThemeSwatchRow theme={theme} />
      </div>

      <CollectionActionContextMenu
        open={menuPoint !== null}
        position={menuPoint}
        onClose={() => setMenuPoint(null)}
        title={theme.name}
        subtitle={theme.source === "preset" ? "Built-in theme" : theme.source === "community" ? "Community theme" : "Custom theme"}
        sections={menuSections}
      />
    </div>
  )
}

function makeDuplicate(base: ThemeDef, namePrefix = "Copy of"): ThemeDef {
  return {
    ...base,
    id: generateThemeId(),
    name: `${namePrefix} ${base.name}`.slice(0, 60),
    source: "custom",
  }
}

export function AppearanceTab() {
  const { activeThemeId, setActiveThemeId } = useActiveTheme()
  const { customThemes, addCustomTheme, updateCustomTheme, deleteCustomTheme } = useCustomThemes()
  const { toast } = useToast()

  const [editorOpen, setEditorOpen] = useState(false)
  const [editingTheme, setEditingTheme] = useState<ThemeDef | null>(null)
  const [communityOpen, setCommunityOpen] = useState(false)
  const [importValue, setImportValue] = useState("")
  const [publishingId, setPublishingId] = useState<string | null>(null)

  // Open the editor in its own window so the main window previews the draft
  // theme live while you edit. Falls back to the in-place dialog if the
  // Electron bridge isn't available (e.g. running the renderer in a browser).
  const openInWindow = (theme: ThemeDef, mode: "new" | "edit" | "duplicate") => {
    const editor = window.ucThemeEditor
    if (editor?.open) {
      void editor.open({ theme, mode })
      return
    }
    setEditingTheme(theme)
    setEditorOpen(true)
  }

  const openNew = () => openInWindow({ ...makeDuplicate(PRESET_THEMES[0], "My"), name: "My Theme" }, "new")
  const openEdit = (theme: ThemeDef) => openInWindow(theme, "edit")
  const openDuplicate = (theme: ThemeDef) => openInWindow(makeDuplicate(theme), "duplicate")

  const handleSave = (theme: ThemeDef) => {
    const existing = customThemes.some((t) => t.id === theme.id)
    if (existing) {
      const ok = updateCustomTheme(theme.id, theme)
      if (!ok) {
        toast("Could not save theme.", "error")
        return
      }
      toast(`Saved "${theme.name}".`, "success")
    } else {
      const ok = addCustomTheme(theme)
      if (!ok) {
        toast(`Limit reached (${MAX_CUSTOM_THEMES} custom themes).`, "error")
        return
      }
      toast(`Created "${theme.name}".`, "success")
    }
    setEditorOpen(false)
    setEditingTheme(null)
    setActiveThemeId(theme.id)
  }

  const handleDelete = (theme: ThemeDef) => {
    deleteCustomTheme(theme.id)
    if (activeThemeId === theme.id) setActiveThemeId(PRESET_THEMES[0].id)
    toast(`Deleted "${theme.name}".`, "info")
  }

  const handleExport = async (theme: ThemeDef) => {
    const code = encodeTheme(theme)
    try {
      await navigator.clipboard.writeText(code)
      toast("Theme code copied to clipboard.", "success")
    } catch {
      toast("Could not copy to clipboard.", "error")
    }
  }

  const handlePublish = async (theme: ThemeDef) => {
    setPublishingId(theme.id)
    try {
      const res = await apiFetch("/api/themes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast(`Publish failed: ${data?.error || res.statusText}`, "error")
        return
      }
      toast(
        data?.updated
          ? `Updated "${theme.name}" in the gallery.`
          : `Published "${theme.name}" to the gallery.`,
        "success",
      )
    } catch {
      toast("Publish failed.", "error")
    } finally {
      setPublishingId(null)
    }
  }

  const handleImport = () => {
    const trimmed = importValue.trim()
    if (!trimmed) return
    const res = decodeTheme(trimmed)
    if (!res.ok) {
      toast(`Import failed: ${res.error}`, "error")
      return
    }
    const imported: ThemeDef = { ...res.theme, id: generateThemeId(), source: "custom" }
    const ok = addCustomTheme(imported)
    if (!ok) {
      toast(`Limit reached (${MAX_CUSTOM_THEMES} custom themes).`, "error")
      return
    }
    setImportValue("")
    setActiveThemeId(imported.id)
    toast(`Imported "${imported.name}".`, "success")
  }

  // Action builders — keep menu definitions next to the handlers so the
  // shape can't drift. `useMemo` so the section identity is stable across
  // re-renders (the menu's portal compares by reference for close-on-select).
  const presetSections = (theme: ThemeDef): CollectionMenuSection[] => [
    {
      id: "manage",
      items: [
        { id: "duplicate", icon: Copy, label: "Duplicate", onSelect: () => openDuplicate(theme) },
        { id: "export",    icon: Share2, label: "Copy theme code", onSelect: () => handleExport(theme) },
      ],
    },
  ]

  const customSections = (theme: ThemeDef): CollectionMenuSection[] => [
    {
      id: "manage",
      items: [
        { id: "edit",      icon: Pencil, label: "Edit",       onSelect: () => openEdit(theme) },
        { id: "duplicate", icon: Copy,   label: "Duplicate",  onSelect: () => openDuplicate(theme) },
      ],
    },
    {
      id: "share",
      label: "Share",
      items: [
        { id: "export",  icon: Share2, label: "Copy theme code", onSelect: () => handleExport(theme) },
        { id: "publish", icon: Upload, label: publishingId === theme.id ? "Publishing…" : "Publish to gallery", disabled: publishingId === theme.id, onSelect: () => handlePublish(theme) },
      ],
    },
    {
      id: "danger",
      items: [
        { id: "delete", icon: Trash2, label: "Delete theme", destructive: true, onSelect: () => handleDelete(theme) },
      ],
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium">Appearance</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Pick a theme, build your own, or browse what the community has made. Right-click any card or use the ⋮ button for actions. Active theme syncs to your account.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => setCommunityOpen(true)}>
            <Globe className="h-4 w-4" />
            Browse community
          </Button>
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4" />
            New theme
          </Button>
        </div>
      </div>

      <Card className="border-white/[.07]">
        <CardContent className="p-5 space-y-5">
          <div>
            <div className="section-label mb-2">Built-in themes</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {PRESET_THEMES.map((theme) => (
                <ThemeCard
                  key={theme.id}
                  theme={theme}
                  active={theme.id === activeThemeId}
                  onSelect={() => setActiveThemeId(theme.id)}
                  menuSections={presetSections(theme)}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="section-label mb-2 flex items-center justify-between">
              <span>Your themes</span>
              <span className="text-muted-foreground text-[10px] normal-case tracking-normal font-normal">
                {customThemes.length} / {MAX_CUSTOM_THEMES}
              </span>
            </div>
            {customThemes.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
                No custom themes yet. Click <span className="text-foreground">New theme</span> or duplicate a preset to get started.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {customThemes.map((theme) => (
                  <ThemeCard
                    key={theme.id}
                    theme={theme}
                    active={theme.id === activeThemeId}
                    onSelect={() => setActiveThemeId(theme.id)}
                    menuSections={customSections(theme)}
                    publishingPulse={publishingId === theme.id}
                  />
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="section-label mb-2">Import a theme</div>
            <div className="flex gap-2">
              <Input
                value={importValue}
                onChange={(e) => setImportValue(e.target.value)}
                placeholder="Paste a ucth1:… theme code"
                className="font-mono text-xs"
              />
              <Button onClick={handleImport} disabled={!importValue.trim()}>
                Import
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {editingTheme && (
        <ThemeEditor
          open={editorOpen}
          initial={editingTheme}
          onClose={() => { setEditorOpen(false); setEditingTheme(null) }}
          onSave={handleSave}
        />
      )}

      <CommunityBrowser
        open={communityOpen}
        onClose={() => setCommunityOpen(false)}
        onInstalled={(theme) => setActiveThemeId(theme.id)}
        currentlyActiveId={activeThemeId}
      />
    </div>
  )
}
