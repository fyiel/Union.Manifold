import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { COLOR_TOKENS, type ColorToken, type ThemeDef } from "@/lib/themes/types"
import { FONT_REGISTRY, resolveFontStack } from "@/lib/themes/fonts"
import { cssColorToHex } from "@/lib/themes/colorUtil"
import { hasReadableContrast, validateTheme } from "@/lib/themes/validate"
import { useToast } from "@/context/toast-context"

const TOKEN_GROUPS: Array<{ label: string; tokens: ColorToken[] }> = [
  { label: "Surface",   tokens: ["background", "foreground", "card", "card-foreground", "popover", "popover-foreground"] },
  { label: "Accent",    tokens: ["primary", "primary-foreground", "accent", "accent-foreground", "ring"] },
  { label: "Neutral",   tokens: ["secondary", "secondary-foreground", "muted", "muted-foreground", "border", "input"] },
  { label: "Danger",    tokens: ["destructive", "destructive-foreground"] },
  { label: "Sidebar",   tokens: ["sidebar", "sidebar-foreground", "sidebar-primary", "sidebar-primary-foreground", "sidebar-accent", "sidebar-accent-foreground", "sidebar-border"] },
]

function tokenLabel(token: ColorToken): string {
  return token.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Single color row.
 *  - Memoised so the other 25 rows don't re-render on every onChange.
 *  - Holds the picker value in *local* state so drag updates don't round-trip
 *    through the parent (~60fps state cascade was the source of the lag).
 *  - Commits the value to the parent via requestAnimationFrame, coalescing
 *    consecutive picker emissions into a single parent update per frame and
 *    flushing the latest value on unmount/blur. */
const ColorRow = memo(function ColorRow({
  token,
  value,
  onChange,
}: {
  token: ColorToken
  value: string
  onChange: (token: ColorToken, hex: string) => void
}) {
  // Hex for the picker — derived from incoming value but kept in local state
  // so the picker can drive itself between rAF flushes without parent ping-pong.
  const initialHex = useMemo(() => {
    try {
      if (/^#[0-9a-f]{6}$/i.test(value.trim())) return value
      return cssColorToHex(value)
    } catch {
      return "#000000"
    }
  }, [value])

  const [localHex, setLocalHex] = useState(initialHex)
  const lastIncomingRef = useRef(initialHex)

  // If the parent drives the color externally (e.g. switching theme), pull
  // the new value into local state — but only when *that* changes, not on
  // every render.
  useEffect(() => {
    if (initialHex !== lastIncomingRef.current) {
      lastIncomingRef.current = initialHex
      setLocalHex(initialHex)
    }
  }, [initialHex])

  const pendingRef = useRef<string | null>(null)
  const rafRef = useRef<number | null>(null)

  const flush = useCallback(() => {
    rafRef.current = null
    const next = pendingRef.current
    pendingRef.current = null
    if (next !== null) {
      lastIncomingRef.current = next
      onChange(token, next)
    }
  }, [onChange, token])

  const handlePick = useCallback((hex: string) => {
    setLocalHex(hex)
    pendingRef.current = hex
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(flush)
    }
  }, [flush])

  useEffect(() => () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      if (pendingRef.current !== null) onChange(token, pendingRef.current)
    }
  }, [onChange, token])

  return (
    <label className="flex items-center gap-3 p-2 rounded-md hover:bg-secondary/50 cursor-pointer min-w-0">
      <input
        type="color"
        value={localHex}
        onChange={(e) => handlePick(e.target.value)}
        className="h-9 w-9 rounded-md border border-border bg-transparent cursor-pointer shrink-0"
        aria-label={tokenLabel(token)}
      />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium leading-tight truncate">{tokenLabel(token)}</div>
        <div className="text-[10px] text-muted-foreground font-mono truncate leading-tight">{localHex}</div>
      </div>
    </label>
  )
})

export function ThemeEditor({
  open,
  initial,
  onClose,
  onSave,
}: {
  open: boolean
  initial: ThemeDef
  onClose: () => void
  onSave: (theme: ThemeDef) => void
}) {
  const [draft, setDraft] = useState<ThemeDef>(initial)
  const { toast } = useToast()

  useEffect(() => {
    setDraft(initial)
  }, [initial, open])

  // Stable callback so memoised ColorRows don't see a new ref each draft tick.
  const setColor = useCallback((token: ColorToken, hex: string) => {
    setDraft((prev) => ({ ...prev, colors: { ...prev.colors, [token]: hex } }))
  }, [])

  const sansStack = useMemo(() => resolveFontStack(draft.fontSans, "sans"), [draft.fontSans])
  const monoStack = useMemo(() => resolveFontStack(draft.fontMono, "mono"), [draft.fontMono])

  const previewStyle = useMemo<React.CSSProperties>(() => ({
    background: draft.colors.background,
    color: draft.colors.foreground,
    borderRadius: draft.radius,
    fontFamily: sansStack,
  }), [draft.colors.background, draft.colors.foreground, draft.radius, sansStack])

  const handleSave = () => {
    if (!draft.name.trim()) {
      toast("Give your theme a name.", "error")
      return
    }
    const result = validateTheme(draft)
    if (!result.ok) {
      toast(`Theme invalid: ${result.error}`, "error")
      return
    }
    if (!hasReadableContrast(result.theme)) {
      toast("Background and foreground are too close — text will be hard to read.", "error")
      return
    }
    onSave(result.theme)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[min(1180px,96vw)] sm:max-w-[min(1180px,96vw)] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-white/[.07]">
          <DialogTitle>Theme editor</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] max-h-[74vh] overflow-hidden">
          {/* Left: form */}
          <div className="uc-themed-scroll overflow-y-auto overflow-x-hidden px-6 py-5 space-y-6 min-w-0 border-r border-white/[.05]">
            <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr] gap-4 items-end">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground block mb-1.5">Name</label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value.slice(0, 60) })}
                  placeholder="My theme"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground block mb-1.5">Sans font</label>
                <Select
                  value={draft.fontSans}
                  onValueChange={(v) => setDraft({ ...draft, fontSans: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FONT_REGISTRY.sans.map((f) => (
                      <SelectItem key={f.key} value={f.key}>
                        <span style={{ fontFamily: f.stack }}>{f.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground block mb-1.5">Mono font</label>
                <Select
                  value={draft.fontMono}
                  onValueChange={(v) => setDraft({ ...draft, fontMono: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FONT_REGISTRY.mono.map((f) => (
                      <SelectItem key={f.key} value={f.key}>
                        <span style={{ fontFamily: f.stack }}>{f.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground flex justify-between mb-1.5">
                <span>Corner radius</span>
                <span className="text-foreground tabular-nums normal-case font-mono tracking-normal text-[11px]">{draft.radius}</span>
              </label>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={parseFloat(draft.radius) || 0}
                onChange={(e) => setDraft({ ...draft, radius: `${parseFloat(e.target.value).toFixed(2)}rem` })}
                className="w-full accent-primary"
              />
            </div>

            {TOKEN_GROUPS.map((group) => (
              <div key={group.label}>
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2.5">{group.label}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {group.tokens.map((token) => (
                    <ColorRow
                      key={token}
                      token={token}
                      value={draft.colors[token]}
                      onChange={setColor}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Right: live preview, sticky inside its own column */}
          <div className="overflow-y-auto uc-themed-scroll">
            <div className="p-5 space-y-4">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Live preview</div>

              {/* The preview "page" — uses the draft tokens directly, ignoring
                  the global app theme so users see exactly what they're building.
                  `font: inherit` is forced on every nested control so the
                  Sans/Mono dropdowns actually drive what the preview renders. */}
              <div className="p-5 space-y-4 [&_button]:font-[inherit] [&_input]:font-[inherit] [&_span]:font-[inherit] [&_div]:font-[inherit]" style={previewStyle}>
                {/* Card */}
                <div
                  className="p-4 space-y-3"
                  style={{
                    background: draft.colors.card,
                    color: draft.colors["card-foreground"],
                    borderRadius: draft.radius,
                    border: `1px solid ${draft.colors.border}`,
                  }}
                >
                  <div className="text-sm font-semibold">The quick brown fox</div>
                  <div className="text-xs" style={{ color: draft.colors["muted-foreground"] }}>
                    Jumps over the lazy dog 0123456789 — preview every surface, accent, button, and chrome detail while you tinker.
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    <button type="button" className="px-3 py-1.5 text-xs font-medium"
                      style={{ background: draft.colors.primary, color: draft.colors["primary-foreground"], borderRadius: draft.radius }}>
                      Primary
                    </button>
                    <button type="button" className="px-3 py-1.5 text-xs font-medium"
                      style={{ background: draft.colors.secondary, color: draft.colors["secondary-foreground"], borderRadius: draft.radius }}>
                      Secondary
                    </button>
                    <button type="button" className="px-3 py-1.5 text-xs font-medium border bg-transparent"
                      style={{ borderColor: draft.colors.border, color: draft.colors.foreground, borderRadius: draft.radius }}>
                      Outline
                    </button>
                    <button type="button" className="px-3 py-1.5 text-xs font-medium"
                      style={{ background: draft.colors.destructive, color: draft.colors["destructive-foreground"], borderRadius: draft.radius }}>
                      Delete
                    </button>
                  </div>
                </div>

                {/* Input + Badge */}
                <div className="space-y-2">
                  <input
                    type="text"
                    readOnly
                    value="Input field"
                    className="w-full px-3 py-2 text-sm outline-none"
                    style={{
                      background: draft.colors.input,
                      color: draft.colors.foreground,
                      borderRadius: draft.radius,
                      border: `1px solid ${draft.colors.border}`,
                    }}
                  />
                  <div className="flex flex-wrap gap-1.5">
                    <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
                      style={{ background: draft.colors.accent, color: draft.colors["accent-foreground"], borderRadius: draft.radius }}>
                      Accent
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
                      style={{ background: draft.colors.muted, color: draft.colors["muted-foreground"], borderRadius: draft.radius }}>
                      Muted
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider border"
                      style={{ borderColor: draft.colors.ring, color: draft.colors.ring, borderRadius: draft.radius }}>
                      Ring
                    </span>
                  </div>
                </div>

                {/* Popover-style surface */}
                <div className="p-3 text-xs"
                  style={{
                    background: draft.colors.popover,
                    color: draft.colors["popover-foreground"],
                    borderRadius: draft.radius,
                    border: `1px solid ${draft.colors.border}`,
                  }}>
                  Popover surface (tooltips, menus, selects all use this)
                </div>

                {/* Mono sample — independent fontFamily so the Mono dropdown
                    has somewhere to show off. */}
                <div className="p-3 text-[11px] leading-relaxed"
                  style={{
                    background: draft.colors.card,
                    color: draft.colors["muted-foreground"],
                    borderRadius: draft.radius,
                    border: `1px solid ${draft.colors.border}`,
                    fontFamily: monoStack,
                  }}>
                  <span style={{ color: draft.colors.primary }}>{">"}</span> sudo make me a sandwich<br />
                  &nbsp;&nbsp;<span style={{ color: draft.colors.destructive }}>error:</span> permission denied<br />
                  <span style={{ color: draft.colors.primary }}>{">"}</span> please<br />
                  &nbsp;&nbsp;<span style={{ color: draft.colors.accent }}>okay.</span>
                </div>

                {/* Sidebar slice */}
                <div className="flex h-32"
                  style={{
                    background: draft.colors.sidebar,
                    color: draft.colors["sidebar-foreground"],
                    borderRadius: draft.radius,
                    border: `1px solid ${draft.colors["sidebar-border"]}`,
                    overflow: "hidden",
                  }}>
                  <div className="flex flex-col gap-1 p-2 w-full">
                    <div className="px-2.5 py-1.5 text-xs font-medium"
                      style={{
                        background: draft.colors["sidebar-primary"],
                        color: draft.colors["sidebar-primary-foreground"],
                        borderRadius: `calc(${draft.radius} - 2px)`,
                      }}>
                      Active item
                    </div>
                    <div className="px-2.5 py-1.5 text-xs"
                      style={{
                        background: draft.colors["sidebar-accent"],
                        color: draft.colors["sidebar-accent-foreground"],
                        borderRadius: `calc(${draft.radius} - 2px)`,
                      }}>
                      Hovered item
                    </div>
                    <div className="px-2.5 py-1.5 text-xs opacity-70">Inactive item</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-white/[.07]">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>Save theme</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
