import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  SHORTCUT_DEFINITIONS,
  useCustomBindings,
  type ShortcutDefinition,
  type ShortcutGroup,
} from "@/hooks/use-keyboard-shortcuts"

const OPEN_EVENT = "uc_open_shortcuts_help"

function KeyCap({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-md border border-white/[.08] bg-white/[.05] px-1.5 font-mono text-[11px] font-medium text-foreground/90 shadow-[inset_0_-1px_0_rgba(0,0,0,0.4)]">
      {children}
    </kbd>
  )
}

function renderBinding(binding: string): React.ReactNode {
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

function ShortcutRow({ shortcut, binding }: { shortcut: ShortcutDefinition; binding: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-white/[.03]">
      <span className="text-sm text-foreground/90">{shortcut.label}</span>
      {renderBinding(binding)}
    </div>
  )
}

/**
 * Global keyboard-shortcuts cheat sheet. Triggered by pressing `?` anywhere
 * outside a text field. Renders the user's current bindings (custom or
 * default) so this view never lies after a rebind.
 */
export function KeyboardShortcutsDialog() {
  const [open, setOpen] = useState(false)
  const customBindings = useCustomBindings()

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  }, [])

  const groups = useMemo(() => {
    const out = new Map<ShortcutGroup, ShortcutDefinition[]>()
    for (const shortcut of SHORTCUT_DEFINITIONS) {
      const list = out.get(shortcut.group) || []
      list.push(shortcut)
      out.set(shortcut.group, list)
    }
    return Array.from(out.entries())
  }, [])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Press <KeyCap>?</KeyCap> any time to bring this list back up.{" "}
            <Link to="/settings?section=advanced" className="underline-offset-2 hover:underline" onClick={() => setOpen(false)}>
              Rebind in settings
            </Link>
            .
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {groups.map(([group, shortcuts]) => (
            <div key={group}>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
                {group}
              </div>
              <div className="space-y-px">
                {shortcuts.map((shortcut) => (
                  <ShortcutRow
                    key={shortcut.id}
                    shortcut={shortcut}
                    binding={customBindings[shortcut.id] || shortcut.defaultBinding}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
