import { useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  if (target.isContentEditable) return true
  if (target.closest("[contenteditable='true']")) return true
  return false
}

/**
 * Canonical list of keyboard shortcuts the launcher honours. Each entry has
 * a stable `id` we persist under, a default binding string ("Ctrl+K", "?"),
 * and what the action does. The handler + the on-screen help dialog +
 * the rebind UI all consume the same list so docs / behaviour / settings
 * stay in lockstep.
 */
export type ShortcutGroup = "Navigation" | "Search" | "Library" | "Help"

export type ShortcutAction =
  | { kind: "navigate"; to: string; skipIfHere?: boolean }
  | { kind: "event"; name: string }
  | { kind: "library-cycle-sort" }

export type ShortcutDefinition = {
  id: string
  defaultBinding: string
  /** Section heading in the help dialog. */
  group: ShortcutGroup
  /** What it does — shown in the help dialog. */
  label: string
  /** Pages where the shortcut should fire. When omitted, fires globally. */
  scopePathPrefix?: string
  /** What the shortcut should do when fired. */
  action: ShortcutAction
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  { id: "open-search",  defaultBinding: "Ctrl+K",       group: "Search",     label: "Open quick search", action: { kind: "event", name: "uc_open_search_popup" } },
  { id: "go-home",      defaultBinding: "Ctrl+1",       group: "Navigation", label: "Go to launcher (Home)",  action: { kind: "navigate", to: "/", skipIfHere: true } },
  { id: "go-library",   defaultBinding: "Ctrl+2",       group: "Navigation", label: "Go to library",          action: { kind: "navigate", to: "/library", skipIfHere: true } },
  { id: "go-downloads", defaultBinding: "Ctrl+3",       group: "Navigation", label: "Go to downloads",        action: { kind: "navigate", to: "/downloads", skipIfHere: true } },
  { id: "go-wishlist",  defaultBinding: "Ctrl+4",       group: "Navigation", label: "Go to wishlist",         action: { kind: "navigate", to: "/wishlist", skipIfHere: true } },
  { id: "go-settings",  defaultBinding: "Ctrl+,",       group: "Navigation", label: "Open settings",          action: { kind: "navigate", to: "/settings", skipIfHere: true } },
  { id: "library-sort",   defaultBinding: "Ctrl+Shift+S", group: "Library", label: "Cycle library sort (Library only)",         scopePathPrefix: "/library", action: { kind: "library-cycle-sort" } },
  { id: "library-search", defaultBinding: "/",            group: "Library", label: "Focus the library search box (Library only)", scopePathPrefix: "/library", action: { kind: "event", name: "uc_library_focus_search" } },
  { id: "help-dialog",    defaultBinding: "?",            group: "Help",    label: "Show this keyboard shortcuts dialog", action: { kind: "event", name: "uc_open_shortcuts_help" } },
]

const CUSTOM_BINDINGS_KEY = "customKeybindings"
const CUSTOM_BINDINGS_EVENT = "uc_custom_keybindings_changed"

/**
 * Encode a KeyboardEvent into a canonical binding string used to match
 * against persisted settings. Conventions:
 *   - Modifiers in fixed order: `Ctrl+Shift+Alt+Key`.
 *   - The key portion is `event.key` for printable characters (letters
 *     uppercased so "K" and "Ctrl+K" round-trip cleanly) or a named key
 *     ("Enter", "Escape", "F1" — unused right now but reserved).
 *   - Shift is omitted from the modifier set when the produced character
 *     is itself shifted (e.g. "?" from Shift+/) so the binding string
 *     stays readable.
 */
export function encodeShortcutBinding(event: KeyboardEvent): string {
  if (!event.key) return ""
  const key = event.key
  // Treat shift as "consumed by the key" when the produced character is
  // a single character AND differs from its lowercase form. That covers
  // "?" / "!" / "K" (capital from Shift) → the binding is just "?".
  const isCharShifted = key.length === 1 && key !== key.toLowerCase()
  const isSymbolShifted = key.length === 1 && /[?!@#$%^&*()_+~<>:"{}|]/.test(key)
  const omitShift = isCharShifted || isSymbolShifted

  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push("Ctrl")
  if (event.shiftKey && !omitShift) parts.push("Shift")
  if (event.altKey) parts.push("Alt")
  // Normalise the key portion. Letters → uppercase; "," stays as ",".
  let keyPart = key
  if (/^[a-z]$/.test(keyPart)) keyPart = keyPart.toUpperCase()
  parts.push(keyPart)
  return parts.join("+")
}

/** Compare two binding strings ignoring order / casing of modifiers. */
export function bindingsMatch(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const normalise = (value: string) => {
    const tokens = value.split("+").map((t) => t.trim()).filter(Boolean)
    if (tokens.length === 0) return ""
    const key = tokens.pop()!
    const mods = tokens.map((t) => t.toLowerCase()).sort()
    const normalKey = /^[a-z]$/.test(key) ? key.toUpperCase() : key
    return `${mods.join("+")}|${normalKey}`
  }
  return normalise(a) === normalise(b)
}

let customBindingsCache: Record<string, string> | null = null

async function loadCustomBindings(): Promise<Record<string, string>> {
  if (typeof window === "undefined") return {}
  if (customBindingsCache) return customBindingsCache
  try {
    const stored = await window.ucSettings?.get?.(CUSTOM_BINDINGS_KEY)
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      customBindingsCache = stored as Record<string, string>
    } else {
      customBindingsCache = {}
    }
  } catch {
    customBindingsCache = {}
  }
  return customBindingsCache
}

/**
 * Public helpers for the rebind UI to update / reset / look up the user's
 * custom bindings.
 */
export async function setCustomBinding(shortcutId: string, binding: string | null): Promise<void> {
  const current = { ...(await loadCustomBindings()) }
  if (!binding) delete current[shortcutId]
  else current[shortcutId] = binding
  customBindingsCache = current
  try { await window.ucSettings?.set?.(CUSTOM_BINDINGS_KEY, current) } catch { /* ignore */ }
  try { window.dispatchEvent(new Event(CUSTOM_BINDINGS_EVENT)) } catch { /* ignore */ }
}

export async function resetAllCustomBindings(): Promise<void> {
  customBindingsCache = {}
  try { await window.ucSettings?.set?.(CUSTOM_BINDINGS_KEY, {}) } catch { /* ignore */ }
  try { window.dispatchEvent(new Event(CUSTOM_BINDINGS_EVENT)) } catch { /* ignore */ }
}

/** Reactive accessor — emits new bindings whenever the user rebinds. */
export function useCustomBindings(): Record<string, string> {
  const [bindings, setBindings] = useState<Record<string, string>>({})
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const data = await loadCustomBindings()
      if (!cancelled) setBindings({ ...data })
    })()
    const onChange = async () => {
      customBindingsCache = null
      const data = await loadCustomBindings()
      if (!cancelled) setBindings({ ...data })
    }
    window.addEventListener(CUSTOM_BINDINGS_EVENT, onChange)
    return () => {
      cancelled = true
      window.removeEventListener(CUSTOM_BINDINGS_EVENT, onChange)
    }
  }, [])
  return bindings
}

export function useKeyboardShortcuts() {
  const navigate = useNavigate()
  const location = useLocation()
  const customBindings = useCustomBindings()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const editableTarget = isEditableTarget(event.target)

      const eventBinding = encodeShortcutBinding(event)
      if (!eventBinding) return

      for (const def of SHORTCUT_DEFINITIONS) {
        const binding = customBindings[def.id] || def.defaultBinding
        if (!bindingsMatch(binding, eventBinding)) continue
        if (def.scopePathPrefix && !location.pathname.startsWith(def.scopePathPrefix)) continue

        // Open-search is the one shortcut that should fire even from inside
        // an input — it's the equivalent of "command-K to focus the search
        // box". Everything else exits when the user is typing.
        if (editableTarget && def.id !== "open-search") continue

        event.preventDefault()
        if (def.action.kind === "event") {
          window.dispatchEvent(new Event(def.action.name))
        } else if (def.action.kind === "library-cycle-sort") {
          window.dispatchEvent(new Event("uc_library_cycle_sort"))
        } else if (def.action.kind === "navigate") {
          if (!def.action.skipIfHere || location.pathname !== def.action.to) {
            navigate(def.action.to)
          }
        }
        return
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [location.pathname, navigate, customBindings])
}
