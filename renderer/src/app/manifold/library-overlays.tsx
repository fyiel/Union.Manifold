import { createPortal } from "react-dom"
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import {
  Play, Settings, FolderOpen, Terminal, SquareTerminal, Pencil, RefreshCw, Heart, Trash2,
  X, Check, ChevronDown, Image as ImageIcon,
} from "lucide-react"
import { MONO } from "@/app/manifold/ui"
import { proxyImageUrl } from "@/lib/utils"
import {
  LINUX_PRESETS, applyGameLinuxPreset,
  type LinuxDetectionOption, type LinuxGameConfig, type LinuxPresetId,
} from "@/lib/linux-presets"

// The Library card action menu + its three dialogs (Launch options, Edit details,
// Linux/VR config), Manifold-native and wired to the real IPC. Overwrites the old
// upstream modals for the fork. Every glyph is a lucide icon.

// the inset field "well" used across every dialog input
const WELL: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.16)",
  background: "#0e0e0e",
  boxShadow: "inset 0 1px 3px rgba(0,0,0,0.4)",
  borderRadius: 10,
  color: "var(--mf-t1)",
}
const COVER_LINES = "repeating-linear-gradient(135deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 9px), #131313"

export type MenuGame = {
  appid: string
  name: string
  image?: string
  sizeText?: string
  version?: string
  developer?: string
  description?: string
  genres?: string[]
  heroImage?: string
}

type MenuHandlers = {
  isLinux: boolean
  isFavorite: boolean
  onOpenFiles: () => void
  onSetExecutable: () => void
  onLinuxConfig: () => void
  onLaunchOptions: () => void
  onEditDetails: () => void
  onRefreshMetadata: () => void
  onToggleFavorite: () => void
  onDelete: () => void
}

const MENU_WIDTH = 250

// Card action menu. Opens to the right of the cog (left edges aligned), flips to
// right-aligned if it would overflow the viewport, clamped to a 10px margin, with
// the entrance growing from the matching corner.
export function GameMenu({ game, anchor, handlers, onClose }: { game: MenuGame; anchor: DOMRect; handlers: MenuHandlers; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null)

  useLayoutEffect(() => {
    const h = panelRef.current?.offsetHeight || 360
    const vw = window.innerWidth
    const vh = window.innerHeight
    const flip = anchor.left + MENU_WIDTH > vw - 10
    let left = flip ? anchor.right - MENU_WIDTH : anchor.left
    left = Math.max(10, Math.min(left, vw - MENU_WIDTH - 10))
    let top = anchor.bottom + 6
    if (top + h > vh - 10) top = Math.max(10, anchor.top - h - 6)
    setPos({ left, top, origin: flip ? "top right" : "top left" })
  }, [anchor])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const meta = [game.sizeText, game.version ? `v${game.version}` : ""].filter(Boolean).join(" · ")
  const run = (fn: () => void) => () => { onClose(); fn() }

  return createPortal(
    <div onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(0,0,0,0.42)", animation: "mfFade .14s ease both" }}>
      <div
        ref={panelRef}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ position: "fixed", left: pos?.left ?? anchor.left, top: pos?.top ?? anchor.bottom + 6, width: MENU_WIDTH, transformOrigin: pos?.origin ?? "top left", visibility: pos ? "visible" : "hidden", animation: "mfMenu .15s ease both", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(20,20,20,0.98)", padding: 5, boxShadow: "0 20px 50px rgba(0,0,0,0.55)" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "8px 9px 10px" }}>
          <div style={{ width: 34, height: 45, borderRadius: 5, flexShrink: 0, background: game.image ? `center/cover no-repeat url("${proxyImageUrl(game.image)}")` : COVER_LINES }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--mf-t0)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{game.name}</div>
            {meta ? <div style={{ fontFamily: MONO, fontSize: 10, color: "var(--mf-t4)", marginTop: 3 }}>{meta}</div> : null}
          </div>
        </div>
        <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "0 6px 5px" }} />

        <MenuRow icon={FolderOpen} label="Open files" onClick={run(handlers.onOpenFiles)} />
        <MenuRow icon={Settings} label="Set executable" onClick={run(handlers.onSetExecutable)} />
        {handlers.isLinux ? <MenuRow icon={Terminal} label="Linux / VR config" onClick={run(handlers.onLinuxConfig)} /> : null}
        <MenuRow icon={SquareTerminal} label="Launch options" onClick={run(handlers.onLaunchOptions)} />
        <MenuRow icon={Pencil} label="Edit details" onClick={run(handlers.onEditDetails)} />
        <MenuRow icon={RefreshCw} label="Refresh metadata" onClick={run(handlers.onRefreshMetadata)} />
        <MenuRow icon={Heart} label={handlers.isFavorite ? "Unfavorite" : "Favorite"} iconColor={handlers.isFavorite ? "#e06b8b" : undefined} onClick={run(handlers.onToggleFavorite)} />

        <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "5px 6px" }} />
        <MenuRow icon={Trash2} label="Delete game" danger onClick={run(handlers.onDelete)} />
      </div>
    </div>,
    document.body,
  )
}

function MenuRow({ icon: Icon, label, onClick, danger, iconColor }: { icon: typeof Play; label: string; onClick: () => void; danger?: boolean; iconColor?: string }) {
  return (
    <div onClick={onClick} className={danger ? "mfrow mfrow-danger" : "mfrow"} style={{ display: "flex", alignItems: "center", gap: 11, padding: "7px 10px", borderRadius: 8, fontSize: 13, color: danger ? "var(--destructive)" : "var(--mf-t2)", cursor: "pointer" }}>
      <Icon size={14} strokeWidth={2} color={danger ? "currentColor" : iconColor || "var(--mf-t4)"} style={{ flexShrink: 0 }} />
      <span>{label}</span>
    </div>
  )
}

// shared dialog shell, fade backdrop + scale-in panel, click-outside + Esc to close
function DialogShell({ width, onClose, children }: { width: number; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return createPortal(
    <div onMouseDown={onClose} style={{ position: "fixed", inset: 0, zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", padding: 28, background: "rgba(0,0,0,0.42)", animation: "mfFade .14s ease both" }}>
      <div className="mf-scroll" onMouseDown={(e) => e.stopPropagation()} style={{ width, maxHeight: "100%", overflowY: "auto", boxSizing: "border-box", borderRadius: 20, border: "1px solid var(--mf-line-2)", background: "rgba(21,21,21,0.99)", color: "var(--mf-t1)", boxShadow: "0 28px 80px rgba(0,0,0,0.6)", padding: 22, display: "flex", flexDirection: "column", gap: 15, animation: "mfDialog .18s cubic-bezier(.2,.8,.2,1) both" }}>
        {children}
      </div>
    </div>,
    document.body,
  )
}

const FIELD_LABEL: CSSProperties = { fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--mf-t5)" }
const PRIMARY_BTN: CSSProperties = { height: 38, padding: "0 18px", borderRadius: 8, border: "none", background: "var(--primary)", color: "var(--primary-foreground)", fontSize: 13, fontWeight: 600, cursor: "pointer" }
const CANCEL_BTN: CSSProperties = { height: 38, padding: "0 16px", borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t1)", fontSize: 13, fontWeight: 600, cursor: "pointer" }

// ── Launch options ──
// Persists per-game CLI args under ucSettings "gameLaunchArgs" (a map keyed by
// appid), matching what the launcher reads. Community options + publish were
// dropped per the overhaul.
// Quick options append to (or seed) the args field. Force Vulkan flips DXVK off
// and asks the engine for the native Vulkan renderer, handy when DX is flaky.
const OFFICIAL_LAUNCH_OPTIONS = [
  { label: "Force Vulkan", args: "-vulkan" },
  { label: "Borderless windowed", args: "--windowed -noborder" },
  { label: "Skip intro", args: "-skipintro" },
  { label: "Force DirectX 11", args: "-dx11" },
]

export function LaunchOptionsDialog({ appid, gameName, onClose }: { appid: string; gameName: string; onClose: () => void }) {
  const [args, setArgs] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const map = await window.ucSettings?.get?.("gameLaunchArgs")
        if (alive && map && typeof map === "object") setArgs(String((map as Record<string, string>)[appid] || ""))
      } catch { /* ignore */ }
    })()
    return () => { alive = false }
  }, [appid])

  const save = async () => {
    setSaving(true)
    try {
      const current = await window.ucSettings?.get?.("gameLaunchArgs")
      const next = current && typeof current === "object" ? { ...(current as Record<string, string>) } : {}
      const trimmed = args.trim()
      if (trimmed) next[appid] = trimmed
      else delete next[appid]
      await window.ucSettings?.set?.("gameLaunchArgs", next)
    } catch { /* ignore */ }
    setSaving(false)
    onClose()
  }

  return (
    <DialogShell width={440} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 15, fontWeight: 600, color: "var(--mf-t0)" }}>
          <SquareTerminal size={15} strokeWidth={1.8} color="var(--mf-t2)" />Launch options
        </div>
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--mf-t4)" }}>Extra arguments passed to <span style={{ color: "var(--mf-t2)" }}>{gameName}</span> at launch.</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <label style={FIELD_LABEL}>Arguments</label>
        <textarea
          value={args}
          onChange={(e) => setArgs(e.target.value)}
          placeholder="--skipintro -dx11"
          rows={2}
          style={{ ...WELL, borderRadius: 12, padding: "11px 13px", minHeight: 54, fontFamily: MONO, fontSize: 13, color: "var(--mf-t0)", resize: "vertical", outline: "none" }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <label style={FIELD_LABEL}>Official launch options</label>
        {OFFICIAL_LAUNCH_OPTIONS.map((o) => {
          const on = args.split(/\s+/).join(" ").includes(o.args)
          const toggle = () => setArgs((cur) => {
            const has = cur.split(/\s+/).join(" ").includes(o.args)
            if (has) return cur.replace(o.args, "").replace(/\s+/g, " ").trim()
            return `${cur.trim()} ${o.args}`.trim()
          })
          return (
            <button key={o.args} type="button" onClick={toggle} style={{ display: "flex", alignItems: "center", gap: 8, textAlign: "left", border: `1px solid ${on ? "var(--mf-line-2)" : "var(--mf-line)"}`, background: on ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.02)", borderRadius: 10, padding: "9px 12px", cursor: "pointer" }}>
              <span style={{ width: 15, flexShrink: 0, display: "inline-flex" }}>{on ? <Check size={14} strokeWidth={2.4} color="#f0f0f0" /> : null}</span>
              <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                <span style={{ fontFamily: MONO, fontSize: 12, color: on ? "var(--mf-t0)" : "var(--mf-t2)" }}>{o.label}</span>
                <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--mf-t4)" }}>{o.args}</span>
              </span>
            </button>
          )
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" onClick={onClose} style={{ ...CANCEL_BTN, border: "none", color: "var(--mf-t3)" }}>Cancel</button>
        <button type="button" disabled={saving} onClick={() => void save()} style={{ ...PRIMARY_BTN, opacity: saving ? 0.6 : 1 }}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </DialogShell>
  )
}

// ── Edit details ──
// Every field uses the inset-well treatment. Saves via the existing
// updateInstalledMetadata IPC. Image dropzones pick a local file via pickImage.
export function EditDetailsDialog({ game, onClose, onSaved }: { game: MenuGame; onClose: () => void; onSaved: (updates: Record<string, unknown>) => void }) {
  const [name, setName] = useState(game.name || "")
  const [developer, setDeveloper] = useState(game.developer || "")
  const [version, setVersion] = useState(game.version || "")
  const [size, setSize] = useState(game.sizeText || "")
  const [description, setDescription] = useState(game.description || "")
  const [genres, setGenres] = useState((game.genres || []).join(", "))
  const [cover, setCover] = useState(game.image || "")
  const [hero, setHero] = useState(game.heroImage || "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const pick = async (set: (v: string) => void) => {
    try {
      const path = await window.ucDownloads?.pickImage?.()
      if (path) set(path)
    } catch { /* ignore */ }
  }

  const save = async () => {
    setSaving(true)
    setError("")
    const updates: Record<string, unknown> = {
      name: name.trim(),
      developer: developer.trim(),
      version: version.trim(),
      size: size.trim(),
      description: description.trim(),
      genres: genres.split(",").map((g) => g.trim()).filter(Boolean),
      image: cover,
      hero_image: hero,
    }
    try {
      const result = await window.ucDownloads?.updateInstalledMetadata?.(game.appid, updates)
      if (result?.ok === false) { setError(result?.error || "Failed to save metadata"); setSaving(false); return }
      onSaved(updates)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save metadata")
      setSaving(false)
    }
  }

  return (
    <DialogShell width={480} onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.015em", color: "var(--mf-t0)" }}>Edit game details</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "108px 1fr", gap: 16 }}>
        <ImageWell label="Cover" value={cover} aspect="2/3" onPick={() => void pick(setCover)} onClear={() => setCover("")} />
        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          <Field label="Name" value={name} onChange={setName} />
          <Field label="Developer" value={developer} onChange={setDeveloper} />
        </div>
      </div>

      <ImageWell label="Hero banner" value={hero} aspect="16/6" onPick={() => void pick(setHero)} onClear={() => setHero("")} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 130px", gap: 11 }}>
        <Field label="Version" value={version} onChange={setVersion} />
        <Field label="Size" value={size} onChange={setSize} />
      </div>
      <Field label="Genres" value={genres} onChange={setGenres} placeholder="Action, RPG" />
      <Field label="Description" value={description} onChange={setDescription} multiline />

      {error ? <div style={{ fontSize: 12, color: "var(--destructive)" }}>{error}</div> : null}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" onClick={onClose} style={CANCEL_BTN}>Cancel</button>
        <button type="button" disabled={saving} onClick={() => void save()} style={{ ...PRIMARY_BTN, opacity: saving ? 0.6 : 1 }}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </DialogShell>
  )
}

function Field({ label, value, onChange, multiline, placeholder }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; placeholder?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 12.5, fontWeight: 500, color: "var(--mf-t3)" }}>{label}</label>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3} style={{ ...WELL, padding: "10px 12px", minHeight: 54, fontSize: 13, lineHeight: 1.5, resize: "vertical", outline: "none" }} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ ...WELL, height: 38, padding: "0 12px", fontSize: 13, outline: "none" }} />
      )}
    </div>
  )
}

function ImageWell({ label, value, aspect, onPick, onClear }: { label: string; value: string; aspect: string; onPick: () => void; onClear: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <label style={{ ...FIELD_LABEL, fontSize: 9.5, letterSpacing: "0.12em" }}>{label}</label>
      <button type="button" onClick={onPick} style={{ ...WELL, position: "relative", width: "100%", aspectRatio: aspect, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", cursor: "pointer", padding: 0 }}>
        {value ? <img src={proxyImageUrl(value)} alt={label} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <ImageIcon size={20} strokeWidth={1.5} color="var(--mf-t4)" />}
        {value ? <span onClick={(e) => { e.stopPropagation(); onClear() }} title="clear" style={{ position: "absolute", top: 4, right: 4, display: "flex", width: 18, height: 18, alignItems: "center", justifyContent: "center", borderRadius: 5, background: "rgba(0,0,0,0.6)", color: "var(--mf-t2)" }}><X size={11} /></span> : null}
      </button>
    </div>
  )
}

// ── Linux / VR config ──
// Reachable from the card menu. Detected runners are grouped by source (Steam
// Proton vs Community GE) with a "Newest" tag on the top version per group, fed
// by detectProton()'s `source` field. Writes config through setGameConfig.
const PRESET_LABELS: Record<LinuxPresetId, string> = { auto: "Auto detect", "proton-recommended": "Proton setup", "wine-recommended": "Wine setup", native: "Native only" }
const PRESET_ORDER: LinuxPresetId[] = ["auto", "proton-recommended", "wine-recommended", "native"]
const LAUNCH_MODE_LABELS: Record<string, string> = { inherit: "Inherit from global", auto: "Auto detect", native: "Native", wine: "Wine", proton: "Proton (Steam)", umu: "umu-launcher" }

export function LinuxConfigDialog({ appid, gameName, onClose }: { appid: string; gameName: string; onClose: () => void }) {
  const [config, setConfig] = useState<LinuxGameConfig>({})
  const [proton, setProton] = useState<LinuxDetectionOption[]>([])
  const [loading, setLoading] = useState(true)
  const [modeOpen, setModeOpen] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [cfg, protonDetect] = await Promise.all([
          window.ucLinux?.getGameConfig?.(appid),
          window.ucLinux?.detectProton?.(),
        ])
        if (!alive) return
        if (cfg?.ok) setConfig((cfg.config as LinuxGameConfig) || {})
        if (protonDetect?.ok && Array.isArray(protonDetect.versions)) setProton(protonDetect.versions as LinuxDetectionOption[])
      } catch { /* ignore */ }
      if (alive) setLoading(false)
    })()
    return () => { alive = false }
  }, [appid])

  const persist = (next: LinuxGameConfig) => {
    setConfig(next)
    void window.ucLinux?.setGameConfig?.(appid, next as never)
  }
  const update = (patch: Partial<LinuxGameConfig>) => persist({ ...config, ...patch })
  const applyPreset = (id: LinuxPresetId) => persist(applyGameLinuxPreset(id, config, [], proton))

  const pickProtonScript = async () => {
    const r = await window.ucLinux?.pickBinary?.()
    if (r?.ok && r.path) update({ protonPath: r.path })
  }
  const pickProtonPrefix = async () => {
    const r = await window.ucLinux?.pickPrefixDir?.()
    if (r?.ok && r.path) update({ protonPrefix: r.path })
  }

  // group detected proton by source, newest first inside each (detect already sorts)
  const groups = useMemo(() => {
    const steam = proton.filter((p) => p.source !== "community")
    const community = proton.filter((p) => p.source === "community")
    return [
      { key: "steam", label: "Steam Proton", items: steam },
      { key: "community", label: "Community · GE", items: community },
    ].filter((g) => g.items.length)
  }, [proton])

  const presetActive = (config.launchMode || "inherit")
  const activePreset: LinuxPresetId | null = presetActive === "native" ? "native" : presetActive === "wine" ? "wine-recommended" : presetActive === "proton" ? "proton-recommended" : presetActive === "auto" ? "auto" : null
  const vr = config.vrEnabled === undefined ? "auto" : config.vrEnabled ? "on" : "off"

  return (
    <DialogShell width={480} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 15, fontWeight: 600, color: "var(--mf-t0)" }}>
          <Terminal size={15} strokeWidth={1.8} color="var(--mf-t2)" />Linux / VR config
          <span style={{ marginLeft: "auto", border: "1px solid var(--mf-line)", background: "rgba(255,255,255,0.04)", padding: "2px 8px", borderRadius: 99, fontFamily: MONO, fontSize: 9, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--mf-t4)" }}>{gameName}</span>
        </div>
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--mf-t4)" }}>How this game launches on Linux. Runners are picked up from Steam and <span style={{ fontFamily: MONO, fontSize: 11.5, color: "var(--mf-t3)" }}>compatibilitytools.d</span>.</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={FIELD_LABEL}>Presets</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {PRESET_ORDER.map((id) => {
            const on = activePreset === id
            return (
              <button key={id} type="button" onClick={() => applyPreset(id)} style={{ borderRadius: 99, border: `1px solid ${on ? "var(--mf-line-2)" : "var(--mf-line)"}`, background: on ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.03)", padding: "6px 13px", fontSize: 12, fontWeight: on ? 600 : 500, color: on ? "#f0f0f0" : "var(--mf-t3)", cursor: "pointer" }}>{PRESET_LABELS[id] || (LINUX_PRESETS.find((p) => p.id === id)?.label ?? id)}</button>
            )
          })}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <label style={FIELD_LABEL}>Launch mode</label>
        <div style={{ position: "relative" }}>
          <button type="button" onClick={() => setModeOpen((o) => !o)} style={{ ...WELL, width: "100%", height: 40, display: "flex", alignItems: "center", gap: 10, padding: "0 12px", fontSize: 13, cursor: "pointer" }}>
            <span style={{ flex: 1, textAlign: "left" }}>{LAUNCH_MODE_LABELS[presetActive] || "Inherit from global"}</span>
            <ChevronDown size={14} color="var(--mf-t5)" />
          </button>
          {modeOpen ? (
            <div style={{ position: "absolute", top: 44, left: 0, right: 0, zIndex: 2, borderRadius: 10, border: "1px solid var(--mf-line-2)", background: "rgba(20,20,20,0.99)", padding: 4, boxShadow: "0 16px 40px rgba(0,0,0,0.5)" }}>
              {(["inherit", "auto", "proton", "wine", "umu", "native"] as const).map((m) => (
                <div key={m} className="mfrow" onClick={() => { update({ launchMode: m }); setModeOpen(false) }} style={{ display: "flex", alignItems: "center", padding: "7px 10px", borderRadius: 7, fontSize: 13, color: "var(--mf-t2)", cursor: "pointer" }}>
                  <span style={{ flex: 1 }}>{LAUNCH_MODE_LABELS[m]}</span>
                  {presetActive === m ? <Check size={14} color="var(--mf-t1)" /> : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={FIELD_LABEL}>Detected version</label>
          <span style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: MONO, fontSize: 10, color: "var(--mf-t4)" }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: proton.length ? "#7da87d" : "var(--mf-t6)" }} />{loading ? "scanning…" : `${proton.length} found`}
          </span>
        </div>
        {groups.length === 0 && !loading ? <div style={{ fontFamily: MONO, fontSize: 11, color: "var(--mf-t5)" }}>no Proton runners detected</div> : null}
        {groups.map((g) => (
          <div key={g.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--mf-t6)", paddingLeft: 2 }}>{g.label}</span>
            {g.items.map((p, i) => {
              const on = config.protonPath === p.path
              return (
                <button key={p.path} type="button" onClick={() => update({ launchMode: "proton", protonPath: p.path })} style={{ display: "flex", alignItems: "center", gap: 11, textAlign: "left", border: `1px solid ${on ? "var(--mf-line-2)" : "var(--mf-line)"}`, background: on ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.02)", borderRadius: 10, padding: "9px 12px", cursor: "pointer" }}>
                  <span style={{ width: 15, flexShrink: 0, display: "inline-flex" }}>{on ? <Check size={15} strokeWidth={2.4} color="#f0f0f0" /> : null}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ fontSize: 13, fontWeight: on ? 600 : 500, color: on ? "var(--mf-t0)" : "var(--mf-t2)" }}>{p.label}</span>
                      {i === 0 ? <span style={{ borderRadius: 99, border: "1px solid var(--mf-line)", padding: "1px 7px", fontFamily: MONO, fontSize: 8.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--mf-t4)" }}>Newest</span> : null}
                    </div>
                    <div style={{ fontFamily: MONO, fontSize: 10, color: "var(--mf-t5)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.path}</div>
                  </div>
                </button>
              )
            })}
          </div>
        ))}
      </div>

      <PathField label="Proton script" hint="overrides global" value={config.protonPath || ""} onBrowse={() => void pickProtonScript()} />
      <PathField label="Proton prefix" hint="STEAM_COMPAT_DATA_PATH" value={config.protonPrefix || ""} placeholder="Auto" onBrowse={() => void pickProtonPrefix()} />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, border: "1px solid var(--mf-line)", background: "rgba(255,255,255,0.02)", borderRadius: 10, padding: "10px 12px" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--mf-t2)" }}>VR support</div>
          <div style={{ fontSize: 10.5, color: "var(--mf-t5)", marginTop: 2 }}>{vr === "auto" ? "Inherit from global settings" : vr === "on" ? "Forced on for this game" : "Forced off for this game"}</div>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", border: "1px solid var(--mf-line)", background: "rgba(255,255,255,0.03)", borderRadius: 99, padding: 2, flexShrink: 0 }}>
          {(["auto", "on", "off"] as const).map((v) => {
            const on = vr === v
            return (
              <button key={v} type="button" onClick={() => update({ vrEnabled: v === "auto" ? undefined : v === "on" })} style={{ borderRadius: 99, border: "none", padding: "3px 10px", fontSize: 11, fontWeight: on ? 600 : 500, background: on ? "rgba(255,255,255,0.10)" : "transparent", color: on ? "#f0f0f0" : "var(--mf-t4)", cursor: "pointer", textTransform: "capitalize" }}>{v}</button>
            )
          })}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" onClick={onClose} style={PRIMARY_BTN}>Done</button>
      </div>
    </DialogShell>
  )
}

function PathField({ label, hint, value, placeholder, onBrowse }: { label: string; hint: string; value: string; placeholder?: string; onBrowse: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <label style={FIELD_LABEL}>{label} <span style={{ textTransform: "none", letterSpacing: 0, color: "var(--mf-t6)" }}>{hint}</span></label>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ ...WELL, flex: 1, minWidth: 0, height: 38, display: "flex", alignItems: "center", padding: "0 12px", fontFamily: MONO, fontSize: 12, color: value ? "var(--mf-t1)" : "var(--mf-t5)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value || placeholder || "Auto"}</div>
        <button type="button" onClick={onBrowse} title="Browse" style={{ width: 38, height: 38, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--mf-line-2)", background: "transparent", borderRadius: 10, color: "var(--mf-t3)", cursor: "pointer" }}><FolderOpen size={15} /></button>
      </div>
    </div>
  )
}
