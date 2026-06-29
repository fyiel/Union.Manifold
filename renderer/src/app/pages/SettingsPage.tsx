import { useEffect, useMemo, useState } from "react"
import { Terminal, FolderOpen } from "lucide-react"
import {
  listSources,
  loadDisabledSources,
  saveDisabledSources,
  setSourceEnabled,
  sourceCapabilities,
  sourceDirect,
} from "@/lib/sources"
import { BRAND } from "@/lib/brand"
import { MONO } from "@/app/manifold/ui"
import type { LinuxDetectionOption } from "@/lib/linux-presets"

const IS_LINUX = typeof navigator !== "undefined" && /linux/i.test(navigator.userAgent)

// Settings, General / Downloads / Sources / Appearance / About. Only the Sources
// tab is wired to real behavior (the source registry, enable/disable persists
// via saveDisabledSources + setSourceEnabled and takes effect immediately in
// Browse/Advanced). About reads the real app version and can check for updates.
// General / Downloads / Appearance render the controls and remember their values
// (persisted under manifoldUiPrefs) but aren't yet honored by the main process /
// theme engine (see the "missing screens" handoff list).

type Section = "general" | "downloads" | "sources" | "linux" | "about"
const SECTIONS: Array<{ id: Section; label: string; sub: string }> = [
  { id: "general", label: "General", sub: "app behavior, notifications, and close behavior" },
  { id: "downloads", label: "Downloads", sub: "install location, concurrency, and bandwidth" },
  { id: "sources", label: "Sources", sub: "which catalog sources are active" },
  // Linux runner config only matters on Linux, filtered out of the rail elsewhere.
  ...(IS_LINUX ? [{ id: "linux" as const, label: "Linux", sub: "global Proton / Wine runner and launch options" }] : []),
  { id: "about", label: "About", sub: "version, stats, and links" },
]

type Prefs = {
  tray: boolean; notify: boolean; quit: boolean
  capOn: boolean; cap: number; extract: boolean; deleteArchive: boolean
  concurrency: number; installPath: string
}
const DEFAULT_PREFS: Prefs = {
  tray: true, notify: true, quit: true,
  capOn: false, cap: 25, extract: true, deleteArchive: false,
  concurrency: 3, installPath: "",
}
const PREFS_KEY = "manifoldUiPrefs"

export function SettingsPage() {
  const [section, setSection] = useState<Section>("general")
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS)
  // closeBehavior is a TOP-LEVEL settings.json key the main process reads on
  // window close (and on Hyprland killactive), not part of the UI prefs blob.
  const [closeBehavior, setCloseBehavior] = useState<"hide" | "quit">("hide")

  // Load persisted UI prefs once.
  useEffect(() => {
    let alive = true
    void window.ucSettings?.get?.(PREFS_KEY).then((v: unknown) => {
      if (alive && v && typeof v === "object" && !Array.isArray(v)) setPrefs((p) => ({ ...p, ...(v as Partial<Prefs>) }))
    })
    void window.ucSettings?.get?.("closeBehavior").then((v: unknown) => {
      if (alive && (v === "hide" || v === "quit")) setCloseBehavior(v)
    })
    return () => { alive = false }
  }, [])

  const changeCloseBehavior = (v: "hide" | "quit") => {
    setCloseBehavior(v)
    try { void window.ucSettings?.set?.("closeBehavior", v) } catch { /* ignore */ }
  }

  // Open the native folder picker. pickDownloadPath persists the backend download
  // root itself and returns the chosen path, which we mirror into the displayed prefs.
  const pickInstallPath = async () => {
    try {
      const r = await window.ucDownloads?.pickDownloadPath?.()
      if (r?.ok && r.path) setPref("installPath", r.path)
    } catch { /* ignore */ }
  }

  const setPref = <K extends keyof Prefs>(key: K, val: Prefs[K]) => {
    setPrefs((p) => {
      const next = { ...p, [key]: val }
      try { void window.ucSettings?.set?.(PREFS_KEY, next) } catch { /* ignore */ }
      return next
    })
  }

  const sub = SECTIONS.find((s) => s.id === section)?.sub || ""

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <header style={{ flexShrink: 0, padding: "26px 36px 22px", borderBottom: "1px solid var(--mf-line)" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "#ededed", letterSpacing: "-0.015em" }}>Settings</h1>
        <p style={{ margin: "6px 0 0", fontFamily: MONO, fontSize: 11.5, color: "var(--mf-t4)" }}>{sub}</p>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {/* section rail */}
        <nav style={{ width: 196, flexShrink: 0, borderRight: "1px solid var(--mf-line)", padding: "20px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
          {SECTIONS.map((s) => {
            const active = section === s.id
            return (
              <button key={s.id} type="button" onClick={() => setSection(s.id)} className="mf-navitem" style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 12px", borderRadius: 8, border: "none", fontSize: 13, fontWeight: active ? 600 : 500, color: active ? "#f0f0f0" : "var(--mf-t4)", background: active ? "rgba(255,255,255,0.07)" : "transparent", cursor: "pointer", textAlign: "left" }}>
                {SECTION_ICON[s.id]}{s.label}
              </button>
            )
          })}
        </nav>

        {/* content */}
        <div className="mf-scroll" style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "28px 40px 56px" }}>
          <div style={{ maxWidth: 620 }}>
            {section === "general" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <Row title="When closing the window" desc="What the titlebar X and window-manager close (e.g. Hyprland killactive) do">
                  <select className="uc-select" value={closeBehavior} onChange={(e) => changeCloseBehavior(e.target.value as "hide" | "quit")} style={{ height: 36, minWidth: 150, padding: "0 32px 0 13px", borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", color: "var(--mf-t1)", fontSize: 12.5, cursor: "pointer", WebkitAppearance: "none", appearance: "none" }}>
                    <option value="hide">Hide to tray</option>
                    <option value="quit">Quit entirely</option>
                  </select>
                </Row>
                <ToggleRow title="Desktop notifications" desc="Notify when downloads finish or fail" on={prefs.notify} onToggle={() => setPref("notify", !prefs.notify)} />
                <ToggleRow title="Confirm before quitting" desc="Ask for confirmation if downloads are active" on={prefs.quit} onToggle={() => setPref("quit", !prefs.quit)} />
                <ClearAssetsRow />
              </div>
            )}

            {section === "downloads" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ padding: "16px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--mf-t1)", marginBottom: 10 }}>Install location</div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <div style={{ flex: 1, display: "flex", alignItems: "center", height: 38, padding: "0 13px", borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", fontFamily: MONO, fontSize: 12, color: "var(--mf-t2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{prefs.installPath || "default install folder"}</div>
                    <button type="button" onClick={() => void pickInstallPath()} className="mf-ghost" style={{ display: "flex", alignItems: "center", gap: 7, padding: "0 15px", height: 38, borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t1)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                      <FolderOpen size={14} strokeWidth={1.6} />Change
                    </button>
                  </div>
                </div>
                <Row title="Max concurrent downloads" desc="How many games download at once">
                  <div style={{ display: "flex", alignItems: "center", gap: 2, border: "1px solid var(--mf-line-2)", borderRadius: 8, background: "var(--mf-panel)", overflow: "hidden" }}>
                    <Stepper onClick={() => setPref("concurrency", Math.max(1, prefs.concurrency - 1))}>−</Stepper>
                    <span style={{ width: 36, textAlign: "center", fontFamily: MONO, fontSize: 14, fontWeight: 600, color: "#ededed" }}>{prefs.concurrency}</span>
                    <Stepper onClick={() => setPref("concurrency", Math.min(8, prefs.concurrency + 1))}>+</Stepper>
                  </div>
                </Row>
                <div style={{ padding: "16px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--mf-t1)" }}>Limit download speed</div>
                      <div style={{ fontFamily: MONO, fontSize: 11, color: "var(--mf-t4)", marginTop: 3 }}>Cap bandwidth so games stay playable</div>
                    </div>
                    <Toggle on={prefs.capOn} onToggle={() => setPref("capOn", !prefs.capOn)} />
                  </div>
                  {prefs.capOn && (
                    <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 16 }}>
                      <input type="range" className="uc-range" min={1} max={100} value={prefs.cap} onChange={(e) => setPref("cap", Number(e.target.value))} style={{ flex: 1 }} />
                      <span style={{ fontFamily: MONO, fontSize: 12.5, color: "#ededed", width: 78, textAlign: "right" }}>{prefs.cap >= 100 ? "unlimited" : `${prefs.cap} MB/s`}</span>
                    </div>
                  )}
                </div>
                <ToggleRow title="Auto-extract after download" desc="Unpack archives automatically when complete" on={prefs.extract} onToggle={() => setPref("extract", !prefs.extract)} />
                <ToggleRow title="Delete archive after extract" desc="Reclaim disk space once unpacking succeeds" on={prefs.deleteArchive} onToggle={() => setPref("deleteArchive", !prefs.deleteArchive)} last />
              </div>
            )}

            {section === "sources" && <SourcesTab />}

            {section === "linux" && <LinuxSettingsTab />}

            {section === "about" && <AboutTab />}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Sources tab, the one wired to real behavior ──
function SourcesTab() {
  const [sources, setSources] = useState<SourceInfo[]>([])
  const [enabled, setEnabled] = useState<Record<string, boolean>>({})
  const [caps, setCaps] = useState<Record<string, SourceCapabilityFlags>>({})

  useEffect(() => {
    let alive = true
    void (async () => {
      const [list, disabled, report] = await Promise.all([listSources(), loadDisabledSources(), sourceCapabilities()])
      if (!alive) return
      setSources(list)
      setEnabled(Object.fromEntries(list.map((s) => [s.id, !disabled.includes(s.id)])))
      const capMap: Record<string, SourceCapabilityFlags> = {}
      for (const p of report?.perSource || []) capMap[p.id] = p
      setCaps(capMap)
    })()
    return () => { alive = false }
  }, [])

  // Stay in lockstep with the sidebar's source toggles (both persist the same
  // gv_source_disabled key), so flipping a source either place updates both live.
  useEffect(() => {
    const off = window.ucSettings?.onChanged?.((d) => {
      if (d?.key !== "gv_source_disabled") return
      const disabled = Array.isArray(d.value) ? d.value.filter((x: unknown): x is string => typeof x === "string") : []
      setEnabled((prev) => Object.fromEntries(Object.keys(prev).map((id) => [id, !disabled.includes(id)])))
    })
    return () => { off?.() }
  }, [])

  const toggle = async (id: string) => {
    const next = !enabled[id]
    setEnabled((e) => ({ ...e, [id]: next }))
    await setSourceEnabled(id, next)
    const disabled = sources.filter((s) => (s.id === id ? !next : !{ ...enabled, [id]: next }[s.id])).map((s) => s.id)
    await saveDisabledSources(disabled)
  }

  const detailFor = (id: string): string => {
    const c = caps[id]
    const bits = [
      sourceDirect(id) ? "direct mirrors" : "browser resolve only",
      c?.tags ? "tags" : null,
      c?.sort?.length ? `sort: ${c.sort.join(", ")}` : null,
    ].filter(Boolean)
    return bits.join(" · ")
  }

  return (
    <>
      <p style={{ margin: "0 0 18px", fontFamily: MONO, fontSize: 11.5, lineHeight: 1.6, color: "var(--mf-t4)" }}>
        Enable the catalog sources you trust. Disabled sources are hidden from Browse and search.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {sources.map((s) => {
          const on = Boolean(enabled[s.id])
          return (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", border: "1px solid var(--mf-line)", borderRadius: 11, background: "var(--mf-panel-2)" }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: on ? "#cfcfcf" : "#444", flexShrink: 0 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: "#ededed" }}>{s.name}</div>
                <div style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--mf-t5)", marginTop: 2 }}>{on ? detailFor(s.id) : "disabled · hidden from browse"}</div>
              </div>
              <Toggle on={on} onToggle={() => void toggle(s.id)} />
            </div>
          )
        })}
      </div>
    </>
  )
}

// ── Linux tab, global Proton/Wine runner + launch options ──
// Reads/writes the same top-level settings.json keys the main process consumes
// at launch (linuxLaunchMode / linuxProtonPath / linuxProtonPrefix / linuxExtraEnv).
const LINUX_SELECT: React.CSSProperties = { height: 36, minWidth: 180, padding: "0 32px 0 13px", borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", color: "var(--mf-t1)", fontSize: 12.5, cursor: "pointer", WebkitAppearance: "none", appearance: "none" }

function LinuxSettingsTab() {
  const [launchMode, setLaunchMode] = useState("auto")
  const [protonPath, setProtonPath] = useState("")
  const [protonPrefix, setProtonPrefix] = useState("")
  const [extraEnv, setExtraEnv] = useState("")
  const [proton, setProton] = useState<LinuxDetectionOption[]>([])

  useEffect(() => {
    let alive = true
    void (async () => {
      const [lm, pp, ppfx, env, detect] = await Promise.all([
        window.ucSettings?.get?.("linuxLaunchMode"),
        window.ucSettings?.get?.("linuxProtonPath"),
        window.ucSettings?.get?.("linuxProtonPrefix"),
        window.ucSettings?.get?.("linuxExtraEnv"),
        window.ucLinux?.detectProton?.(),
      ])
      if (!alive) return
      if (typeof lm === "string") setLaunchMode(lm)
      if (typeof pp === "string") setProtonPath(pp)
      if (typeof ppfx === "string") setProtonPrefix(ppfx)
      if (typeof env === "string") setExtraEnv(env)
      if (detect?.ok && Array.isArray(detect.versions)) setProton(detect.versions as LinuxDetectionOption[])
    })()
    return () => { alive = false }
  }, [])

  const persist = (key: string, value: string) => { try { void window.ucSettings?.set?.(key, value) } catch { /* ignore */ } }
  const pickPrefix = async () => {
    const r = await window.ucLinux?.pickPrefixDir?.()
    if (r?.ok && r.path) { setProtonPrefix(r.path); persist("linuxProtonPrefix", r.path) }
  }

  const steam = proton.filter((p) => p.source !== "community")
  const community = proton.filter((p) => p.source === "community")

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Row title="Launch mode" desc="How games launch on Linux when not overridden per-game">
        <select className="uc-select" value={launchMode} onChange={(e) => { setLaunchMode(e.target.value); persist("linuxLaunchMode", e.target.value) }} style={LINUX_SELECT}>
          <option value="auto">Auto detect</option>
          <option value="proton">Proton</option>
          <option value="wine">Wine</option>
          <option value="umu">umu-launcher</option>
          <option value="native">Native only</option>
        </select>
      </Row>

      <Row title="Proton version" desc={proton.length ? `${proton.length} runner${proton.length === 1 ? "" : "s"} detected (Steam + compatibilitytools.d)` : "no Proton runners detected"}>
        <select className="uc-select" value={protonPath} onChange={(e) => { setProtonPath(e.target.value); persist("linuxProtonPath", e.target.value) }} style={LINUX_SELECT}>
          <option value="">System default</option>
          {steam.length ? <optgroup label="Steam Proton">{steam.map((p) => <option key={p.path} value={p.path}>{p.label}</option>)}</optgroup> : null}
          {community.length ? <optgroup label="Community · GE">{community.map((p) => <option key={p.path} value={p.path}>{p.label}</option>)}</optgroup> : null}
        </select>
      </Row>

      <div style={{ padding: "16px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--mf-t1)", marginBottom: 3 }}>Proton prefix</div>
        <div style={{ fontFamily: MONO, fontSize: 11, color: "var(--mf-t4)", marginBottom: 10 }}>STEAM_COMPAT_DATA_PATH, blank uses the per-game auto path</div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1, display: "flex", alignItems: "center", height: 38, padding: "0 13px", borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", fontFamily: MONO, fontSize: 12, color: protonPrefix ? "var(--mf-t2)" : "var(--mf-t5)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{protonPrefix || "Auto"}</div>
          <button type="button" onClick={() => void pickPrefix()} className="mf-ghost" style={{ display: "flex", alignItems: "center", gap: 7, padding: "0 15px", height: 38, borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t1)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            <FolderOpen size={14} strokeWidth={1.6} />Browse
          </button>
        </div>
      </div>

      <div style={{ padding: "16px 0" }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--mf-t1)", marginBottom: 3 }}>Extra environment variables</div>
        <div style={{ fontFamily: MONO, fontSize: 11, color: "var(--mf-t4)", marginBottom: 10 }}>Applied to every launch, newline-separated KEY=VALUE (e.g. DXVK_HUD=fps)</div>
        <textarea
          value={extraEnv}
          onChange={(e) => setExtraEnv(e.target.value)}
          onBlur={() => persist("linuxExtraEnv", extraEnv)}
          rows={3}
          placeholder="PROTON_USE_WINED3D=1"
          style={{ width: "100%", boxSizing: "border-box", border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", borderRadius: 8, padding: "10px 12px", fontFamily: MONO, fontSize: 12.5, color: "var(--mf-t1)", resize: "vertical", outline: "none" }}
        />
      </div>
    </div>
  )
}

// ── About tab (fork version + update check) ──
// The fork resets to version 1, but it's a derivative so we credit the upstream
// release it forked from.
const FORK_VERSION = "1.0.0b"
const BASED_ON = "UnionCrax.Direct v2.7.3"

function AboutTab() {
  const [updMsg, setUpdMsg] = useState("up to date")
  const [checking, setChecking] = useState(false)

  const check = async () => {
    if (!window.ucUpdater?.checkForUpdates) return
    setChecking(true)
    try {
      const r = await window.ucUpdater.checkForUpdates()
      setUpdMsg(r.available ? `update available · ${r.version || ""}` : r.state === "error" ? `check failed${r.error ? ` · ${r.error}` : ""}` : "up to date")
    } catch (err) {
      setUpdMsg(`check failed · ${String(err)}`)
    } finally {
      setChecking(false)
    }
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 16, paddingBottom: 22, borderBottom: "1px solid var(--mf-line)" }}>
        <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 54, height: 54, borderRadius: 14, background: "#e9e9e9", color: "#111" }}>
          <svg viewBox="0 0 24 24" style={{ width: "62%", height: "62%", display: "block" }} fill="none" stroke="#111" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h5c3 0 3.5 6 7 6" /><path d="M3 12h12" /><path d="M3 18h5c3 0 3.5-6 7-6" /><path d="M15 12h6" /><circle cx="15" cy="12" r="1.7" fill="#111" stroke="none" /></svg>
        </span>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#f4f4f4" }}>{BRAND.name}</div>
          <div style={{ fontFamily: MONO, fontSize: 11.5, color: "var(--mf-t4)", marginTop: 3 }}>version {FORK_VERSION} · {updMsg}</div>
          <div style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--mf-t5)", marginTop: 4 }}>based on {BASED_ON}</div>
        </div>
        <button type="button" onClick={() => void check()} disabled={checking} className="mf-ghost" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t1)", fontSize: 12.5, fontWeight: 600, cursor: checking ? "default" : "pointer", opacity: checking ? 0.7 : 1 }}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M2 8a6 6 0 0 1 10-4.5L14 5" /><polyline points="14 2 14 5 11 5" /><path d="M14 8a6 6 0 0 1-10 4.5L2 11" /><polyline points="2 14 2 11 5 11" /></svg>
          {checking ? "Checking…" : "Check for updates"}
        </button>
      </div>
      <p style={{ margin: "22px 0 0", fontFamily: MONO, fontSize: 11, color: "var(--mf-t5)" }}>{BRAND.tagline}</p>
    </>
  )
}

// ── shared bits ──
function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} style={{ position: "relative", width: 40, height: 23, borderRadius: 99, border: "none", cursor: "pointer", background: on ? "#e6e6e6" : "rgba(255,255,255,0.13)", transition: "background .15s", flexShrink: 0 }}>
      <span style={{ position: "absolute", top: 3, left: on ? 20 : 3, width: 17, height: 17, borderRadius: 99, background: on ? "#111" : "#cfcfcf", transition: "left .15s" }} />
    </button>
  )
}

function Row({ title, desc, last, children }: { title: string; desc: string; last?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "16px 0", borderBottom: last ? "none" : "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--mf-t1)" }}>{title}</div>
        <div style={{ fontFamily: MONO, fontSize: 11, color: "var(--mf-t4)", marginTop: 3 }}>{desc}</div>
      </div>
      {children}
    </div>
  )
}

function ToggleRow({ title, desc, on, onToggle, last }: { title: string; desc: string; on: boolean; onToggle: () => void; last?: boolean }) {
  return <Row title={title} desc={desc} last={last}><Toggle on={on} onToggle={onToggle} /></Row>
}

function fmtBytes(n: number): string {
  if (!n) return "0 B"
  const u = ["B", "KB", "MB", "GB"]
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`
}

// Clears the infinite on-disk thumbnail/art cache (uc-asset://).
function ClearAssetsRow() {
  const [bytes, setBytes] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = () => { void window.ucAssets?.size?.().then((r) => setBytes(r?.ok ? r.bytes : 0)) }
  useEffect(() => { refresh() }, [])
  const onClear = async () => {
    setBusy(true)
    try { await window.ucAssets?.clear?.() } finally { setBusy(false); refresh() }
  }
  const desc = bytes == null ? "cached thumbnails & artwork" : `cached thumbnails & artwork — ${fmtBytes(bytes)} stored`
  return (
    <Row title="Clear cached assets" desc={desc} last>
      <button
        type="button"
        className="mf-ghost"
        onClick={onClear}
        disabled={busy || bytes === 0}
        style={{ display: "flex", alignItems: "center", gap: 7, padding: "0 15px", height: 38, borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "transparent", color: bytes === 0 ? "var(--mf-t4)" : "var(--mf-t1)", fontSize: 12, fontWeight: 600, cursor: busy || bytes === 0 ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 4h11M6 4V2.5h4V4M5 4l.5 9a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1L11 4" /></svg>
        {busy ? "Clearing…" : "Clear"}
      </button>
    </Row>
  )
}

function Stepper({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="mf-iconbtn" style={{ width: 34, height: 34, border: "none", background: "transparent", color: "var(--mf-t2)", fontSize: 18, cursor: "pointer" }}>{children}</button>
  )
}

const ico = { fill: "none", stroke: "currentColor" as const, strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }
const SECTION_ICON: Record<Section, React.ReactNode> = {
  general: <svg viewBox="0 0 16 16" width="15" height="15" {...ico}><circle cx="8" cy="8" r="2" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" /></svg>,
  downloads: <svg viewBox="0 0 16 16" width="15" height="15" {...ico}><line x1="8" y1="2.5" x2="8" y2="9.5" /><polyline points="5 7 8 10 11 7" /><line x1="3" y1="13.5" x2="13" y2="13.5" /></svg>,
  sources: <svg viewBox="0 0 16 16" width="15" height="15" {...ico}><ellipse cx="8" cy="4" rx="5.5" ry="2" /><path d="M2.5 4v8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4" /><path d="M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" /></svg>,
  linux: <Terminal size={15} strokeWidth={1.6} />,
  about: <svg viewBox="0 0 16 16" width="15" height="15" {...ico}><circle cx="8" cy="8" r="6" /><line x1="8" y1="7.5" x2="8" y2="11.5" /><circle cx="8" cy="4.8" r="0.7" fill="currentColor" stroke="none" /></svg>,
}
