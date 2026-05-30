import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  SHORTCUT_DEFINITIONS,
  bindingsMatch,
  encodeShortcutBinding,
  resetAllCustomBindings,
  setCustomBinding,
  useCustomBindings,
  type ShortcutDefinition,
} from "@/hooks/use-keyboard-shortcuts"
import { emitToast } from "@/lib/clipboard"
import { X } from "@/components/icons"
import { RotateCcw } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

function KeyCap({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-md border border-white/[.08] bg-white/[.05] px-1.5 font-mono text-[11px] font-medium text-foreground/90 shadow-[inset_0_-1px_0_rgba(0,0,0,0.4)]">
      {children}
    </kbd>
  )
}

function renderBinding(binding: string) {
  const parts = binding.split("+").map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return <KeyCap>?</KeyCap>
  return (
    <span className="flex items-center gap-1">
      {parts.map((part, idx) => (
        <span key={`${part}-${idx}`} className="flex items-center gap-1">
          {idx > 0 && <span className="text-[10px] text-muted-foreground/80">+</span>}
          <KeyCap>{part}</KeyCap>
        </span>
      ))}
    </span>
  )
}

type CapturingState = {
  shortcutId: string
} | null

function ShortcutRow({
  shortcut,
  currentBinding,
  isCustom,
  isCapturing,
  onStartCapture,
  onCancelCapture,
  onReset,
  conflict,
}: {
  shortcut: ShortcutDefinition
  currentBinding: string
  isCustom: boolean
  isCapturing: boolean
  onStartCapture: () => void
  onCancelCapture: () => void
  onReset: () => void
  conflict: { otherLabel: string } | null
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl border border-white/[.07] bg-white/[.02] px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-white">{shortcut.label}</div>
        <div className="text-[11px] text-muted-foreground/80 mt-0.5">
          {isCapturing
            ? "Press the new combo… (Esc to cancel)"
            : isCustom
              ? `Custom — default was ${shortcut.defaultBinding}`
              : shortcut.scopePathPrefix
                ? `Default · only on ${shortcut.scopePathPrefix}`
                : "Default"}
        </div>
        {conflict && (
          <div className="text-[11px] text-amber-300 mt-1">
            Conflicts with “{conflict.otherLabel}”.
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {isCapturing ? (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onCancelCapture}>
            <X className="h-3.5 w-3.5 mr-1" /> Cancel
          </Button>
        ) : (
          <>
            <button
              type="button"
              onClick={onStartCapture}
              className="inline-flex items-center hover:opacity-80 transition-opacity"
              title="Click to rebind"
            >
              {renderBinding(currentBinding)}
            </button>
            {isCustom && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-white"
                onClick={onReset}
                title="Reset to default"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Per-shortcut rebind UI. The user clicks a shortcut's current binding,
 * we capture the next keystroke (excluding bare modifier presses), encode
 * it via the shared helper, and persist via setCustomBinding. Conflicts
 * are detected and surfaced inline — the user has to resolve them by
 * picking a different combo or resetting the conflicting binding.
 */
export function KeybindingsPanel() {
  const customBindings = useCustomBindings()
  const [capturing, setCapturing] = useState<CapturingState>(null)
  const capturingRef = useRef<CapturingState>(null)
  useEffect(() => { capturingRef.current = capturing }, [capturing])

  // Snapshot of "current binding" per shortcut so the conflict-check below
  // doesn't have to recompute from the live state on every render.
  const resolvedBindings = useMemo(() => {
    return SHORTCUT_DEFINITIONS.map((def) => ({
      id: def.id,
      def,
      binding: customBindings[def.id] || def.defaultBinding,
      isCustom: Boolean(customBindings[def.id]),
    }))
  }, [customBindings])

  // Quick lookup: binding string -> shortcut label, for conflict detection.
  const bindingOwners = useMemo(() => {
    const map = new Map<string, { id: string; label: string }>()
    for (const { def, binding } of resolvedBindings) {
      // First-write wins so the "other label" is deterministic.
      if (!map.has(binding)) map.set(binding, { id: def.id, label: def.label })
    }
    return map
  }, [resolvedBindings])

  // Capture the next keydown when the user is rebinding.
  useEffect(() => {
    if (!capturing) return
    const onKeyDown = async (event: KeyboardEvent) => {
      // Plain modifier presses (Ctrl alone, Shift alone) → ignore. Wait for a
      // real key. Escape cancels the capture.
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        setCapturing(null)
        return
      }
      const isModifierOnly = ["Control", "Shift", "Alt", "Meta", "OS"].includes(event.key)
      if (isModifierOnly) return
      event.preventDefault()
      event.stopPropagation()
      const encoded = encodeShortcutBinding(event)
      if (!encoded) return
      const target = capturingRef.current
      setCapturing(null)
      if (!target) return
      // Conflict check — if the user's new combo matches some OTHER shortcut's
      // current binding, surface an inline warning by storing it then nudging
      // them. We persist regardless because trying to silently refuse is
      // confusing — the warning + manual fix is clearer.
      const owner = bindingOwners.get(encoded)
      const conflictsWithAnother = owner && owner.id !== target.shortcutId
      try {
        await setCustomBinding(target.shortcutId, encoded)
        if (conflictsWithAnother) {
          emitToast(`Note: ${encoded} also fires “${owner!.label}”.`, "info", 4000)
        } else {
          emitToast("Shortcut updated", "success", 2000)
        }
      } catch {
        emitToast("Couldn't save shortcut", "error")
      }
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [capturing, bindingOwners])

  const hasAnyCustom = useMemo(() => Object.keys(customBindings).length > 0, [customBindings])
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)

  const handleResetAll = useCallback(() => {
    setResetConfirmOpen(true)
  }, [])

  const confirmResetAll = useCallback(async () => {
    setResetConfirmOpen(false)
    try {
      await resetAllCustomBindings()
      emitToast("Shortcuts reset to defaults", "success", 2000)
    } catch {
      emitToast("Couldn't reset shortcuts", "error")
    }
  }, [])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-white">Shortcuts</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Click any shortcut's current combo, then press the new keys you want. Esc to cancel.
          </p>
        </div>
        {hasAnyCustom && (
          <Button variant="outline" size="sm" onClick={handleResetAll}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            Reset all
          </Button>
        )}
      </div>
      <div className="space-y-1.5">
        {resolvedBindings.map(({ id, def, binding, isCustom }) => {
          const owner = bindingOwners.get(binding)
          const conflict = owner && owner.id !== id ? { otherLabel: owner.label } : null
          return (
            <ShortcutRow
              key={id}
              shortcut={def}
              currentBinding={binding}
              isCustom={isCustom}
              isCapturing={capturing?.shortcutId === id}
              conflict={conflict}
              onStartCapture={() => setCapturing({ shortcutId: id })}
              onCancelCapture={() => setCapturing(null)}
              onReset={() => { void setCustomBinding(id, null) }}
            />
          )
        })}
      </div>

      <Dialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Reset all shortcuts?</DialogTitle>
            <DialogDescription>
              Every custom shortcut will go back to its default. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setResetConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={() => void confirmResetAll()}>Reset all</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
