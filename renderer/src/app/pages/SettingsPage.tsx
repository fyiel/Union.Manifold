import { useEffect, useMemo, useState } from "react"
import { Terminal, FolderOpen, Palette, Library as LibraryIcon, Plus, X, Pencil, Puzzle, Eye, EyeOff } from "lucide-react"
import { PRESET_THEMES } from "@/lib/themes/presets"
import type { ThemeDef } from "@/lib/themes/types"
import { useActiveTheme } from "@/hooks/use-active-theme"
import { useCustomThemes } from "@/hooks/use-custom-themes"
import {
  listSources,
  loadDisabledSources,
  saveDisabledSources,
  setSourceEnabled,
  sourceCapabilities,
  sourceDirect,
  onSourcesChanged,
} from "@/lib/sources"
import { BRAND } from "@/lib/brand"
import { MONO } from "@/app/manifold/ui"
import type { LinuxDetectionOption } from "@/lib/linux-presets"

const IS_LINUX = typeof navigator !== "undefined" && /linux/i.test(navigator.userAgent)

type Section = "general" | "appearance" | "downloads" | "library" | "sources" | "mods" | "linux" | "about"
const SECTIONS: Array<{ id: Section; label: string; sub: string }> = [
  { id: "general", label: "General", sub: "app behavior, startup, notifications, and close behavior" },
  { id: "appearance", label: "Appearance", sub: "theme presets and the theme editor" },
  { id: "downloads", label: "Downloads", sub: "install location, concurrency, and bandwidth" },
  { id: "library", label: "Library", sub: "extra folders scanned for installed games" },
  { id: "sources", label: "Sources", sub: "which catalog sources are active" },
  { id: "mods", label: "Mods", sub: "NexusMods account and the Steam Workshop downloader" },
  ...(IS_LINUX ? [{ id: "linux" as const, label: "Linux", sub: "global Proton / Wine runner and launch options" }] : []),
  { id: "about", label: "About", sub: "version, stats, and links" },
]

export function SettingsPage() {
  const [section, setSection] = useState<Section>("general")
  const [closeBehavior, setCloseBehavior] = useState<"hide" | "quit">("hide")
  const [bwOn, setBwOn] = useState(false)
  const [bwMbps, setBwMbps] = useState(25)
  const [autoDelete, setAutoDelete] = useState(false)
  const [installPath, setInstallPath] = useState("")
  const [shortcut, setShortcut] = useState(false)
  const [pauseWhilePlaying, setPauseWhilePlaying] = useState(false)
  const [launchAtLogin, setLaunchAtLogin] = useState(false)
  const [startMinimized, setStartMinimized] = useState(false)
  const [autoCheckUpdates, setAutoCheckUpdates] = useState(true)
  const [notifyInstallDone, setNotifyInstallDone] = useState(true)
  const [notifyGameExit, setNotifyGameExit] = useState(false)
  const [maxConcurrent, setMaxConcurrent] = useState(3)
  const [connsPerDl, setConnsPerDl] = useState(8)
  const [diskMargin, setDiskMargin] = useState(2)
  const [startPage, setStartPage] = useState<"browse" | "library">("browse")
  const [closeOnLaunch, setCloseOnLaunch] = useState(false)
  const [achievementNotifications, setAchievementNotifications] = useState(true)
  const [achievementSystemNotifications, setAchievementSystemNotifications] = useState(true)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [cb, kbps, del, path, sc, pause, mini, upd, nid, nge, maxC, conns, margin, sp, auto, col, achievementPopups, achievementFallbacks] = await Promise.all([
          window.ucSettings?.get?.("closeBehavior"),
          window.ucSettings?.get?.("downloadBandwidthLimitKBps"),
          window.ucSettings?.get?.("autoDeleteArchives"),
          window.ucDownloads?.getDownloadPath?.(),
          window.ucSettings?.get?.("alwaysCreateDesktopShortcut"),
          window.ucSettings?.get?.("pauseDownloadsWhilePlaying"),
          window.ucSettings?.get?.("startMinimized"),
          window.ucSettings?.get?.("autoCheckUpdates"),
          window.ucSettings?.get?.("notifyInstallDone"),
          window.ucSettings?.get?.("notifyGameExit"),
          window.ucSettings?.get?.("maxConcurrentDownloads"),
          window.ucSettings?.get?.("aria2ConnectionsPerDownload"),
          window.ucSettings?.get?.("diskSpaceMarginGiB"),
          window.ucSettings?.get?.("startPage"),
          window.ucAutostart?.get?.(),
          window.ucSettings?.get?.("closeOnGameLaunch"),
          window.ucSettings?.get?.("achievementNotifications"),
          window.ucSettings?.get?.("achievementSystemNotifications"),
        ])
        if (!alive) return
        if (cb === "hide" || cb === "quit") setCloseBehavior(cb)
        const k = Number(kbps) || 0
        if (k > 0) { setBwOn(true); setBwMbps(Math.max(1, Math.round(k / 1024))) }
        setAutoDelete(del === true)
        const p = typeof path === "string" ? path : (path && typeof path === "object" ? (path as { path?: string }).path : "")
        if (p) setInstallPath(p)
        setShortcut(sc === true)
        setPauseWhilePlaying(pause === true)
        setStartMinimized(mini === true)
        setAutoCheckUpdates(upd !== false)
        setNotifyInstallDone(nid !== false)
        setNotifyGameExit(nge === true)
        if (Number(maxC) >= 1) setMaxConcurrent(Math.min(8, Number(maxC)))
        if (Number(conns) >= 1) setConnsPerDl(Math.min(16, Number(conns)))
        if (margin != null && Number(margin) >= 0) setDiskMargin(Math.min(64, Number(margin)))
        if (sp === "library") setStartPage("library")
        setLaunchAtLogin(Boolean(auto?.enabled))
        setCloseOnLaunch(col === true)
        setAchievementNotifications(achievementPopups !== false)
        setAchievementSystemNotifications(achievementFallbacks !== false)
      } catch {  }
    })()
    const off = window.ucSettings?.onChanged?.((d) => {
      if (!d || !alive) return
      if (d.key === "autoDeleteArchives") setAutoDelete(d.value === true)
      if (d.key === "alwaysCreateDesktopShortcut") setShortcut(d.value === true)
      if (d.key === "pauseDownloadsWhilePlaying") setPauseWhilePlaying(d.value === true)
      if (d.key === "achievementNotifications") setAchievementNotifications(d.value !== false)
      if (d.key === "achievementSystemNotifications") setAchievementSystemNotifications(d.value !== false)
    })
    return () => { alive = false; off?.() }
  }, [])

  const setBool = (key: string, value: boolean, apply: (v: boolean) => void) => {
    apply(value)
    try { void window.ucSettings?.set?.(key, value) } catch {  }
  }

  const changeCloseBehavior = (v: "hide" | "quit") => {
    setCloseBehavior(v)
    try { void window.ucSettings?.set?.("closeBehavior", v) } catch {  }
  }

  const persistBw = (on: boolean, mbps: number) => {
    const kbps = on ? Math.max(1, mbps) * 1024 : 0
    try { void window.ucSettings?.set?.("downloadBandwidthLimitKBps", kbps) } catch {  }
  }
  const toggleBw = () => { const on = !bwOn; setBwOn(on); persistBw(on, bwMbps) }
  const changeBw = (mbps: number) => { setBwMbps(mbps); persistBw(bwOn, mbps) }

  const toggleAutoDelete = () => {
    const v = !autoDelete
    setAutoDelete(v)
    try { void window.ucSettings?.set?.("autoDeleteArchives", v) } catch {  }
  }

  const pickInstallPath = async () => {
    try {
      const r = await window.ucDownloads?.pickDownloadPath?.()
      if (r?.ok && r.path) setInstallPath(r.path)
    } catch {  }
  }

  const sub = SECTIONS.find((s) => s.id === section)?.sub || ""

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <header style={{ flexShrink: 0, padding: "26px 36px 22px", borderBottom: "1px solid var(--mf-line)" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "var(--mf-t0)", letterSpacing: "-0.015em" }}>Settings</h1>
        <p style={{ margin: "6px 0 0", fontFamily: MONO, fontSize: 11.5, color: "var(--mf-t4)" }}>{sub}</p>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {}
        <nav style={{ width: 196, flexShrink: 0, borderRight: "1px solid var(--mf-line)", padding: "20px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
          {SECTIONS.map((s) => {
            const active = section === s.id
            return (
              <button key={s.id} type="button" onClick={() => setSection(s.id)} className="mf-navitem" style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 12px", borderRadius: 8, border: "none", fontSize: 13, fontWeight: active ? 600 : 500, color: active ? "var(--mf-t0)" : "var(--mf-t4)", background: active ? "color-mix(in srgb, var(--mf-t0) 7%, transparent)" : "transparent", cursor: "pointer", textAlign: "left" }}>
                {SECTION_ICON[s.id]}{s.label}
              </button>
            )
          })}
        </nav>

        {}
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
                <Row title="Startup page" desc="Which page the app opens on after launch">
                  <select className="uc-select" value={startPage} onChange={(e) => { const v = e.target.value === "library" ? "library" : "browse"; setStartPage(v); void window.ucSettings?.set?.("startPage", v) }} style={{ height: 36, minWidth: 150, padding: "0 32px 0 13px", borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", color: "var(--mf-t1)", fontSize: 12.5, cursor: "pointer", WebkitAppearance: "none", appearance: "none" }}>
                    <option value="browse">Browse</option>
                    <option value="library">Library</option>
                  </select>
                </Row>
                <ToggleRow title="Launch at login" desc="Start the app automatically when you log in" on={launchAtLogin} onToggle={() => { const v = !launchAtLogin; setLaunchAtLogin(v); void window.ucAutostart?.set?.(v) }} />
                <ToggleRow title="Start minimized to tray" desc="Keep the window hidden on startup until you open it from the tray" on={startMinimized} onToggle={() => setBool("startMinimized", !startMinimized, setStartMinimized)} />
                <ToggleRow title="Check for updates on startup" desc="Look for a new version shortly after launch and notify when one is ready" on={autoCheckUpdates} onToggle={() => setBool("autoCheckUpdates", !autoCheckUpdates, setAutoCheckUpdates)} />
                <ToggleRow title="Notify when a game is ready" desc="Desktop notification when a download finishes installing" on={notifyInstallDone} onToggle={() => setBool("notifyInstallDone", !notifyInstallDone, setNotifyInstallDone)} />
                <ToggleRow title="Notify when a game exits" desc="Desktop notification when a running game closes" on={notifyGameExit} onToggle={() => setBool("notifyGameExit", !notifyGameExit, setNotifyGameExit)} />
                <ToggleRow title="Show achievement popups in-game" desc="Display a Steam-style Manifold popup when a local achievement unlocks" on={achievementNotifications} onToggle={() => setBool("achievementNotifications", !achievementNotifications, setAchievementNotifications)} />
                <ToggleRow title="Achievement notification fallback" desc="Also send an operating-system notification when an achievement unlocks" on={achievementSystemNotifications} onToggle={() => setBool("achievementSystemNotifications", !achievementSystemNotifications, setAchievementSystemNotifications)} />
                <ToggleRow title="Hide or close the app when a game launches" desc="Hide Manifold while popups are enabled; otherwise quit a few seconds after the game starts" on={closeOnLaunch} onToggle={() => setBool("closeOnGameLaunch", !closeOnLaunch, setCloseOnLaunch)} />
                <ClearAssetsRow />
              </div>
            )}

            {section === "appearance" && <AppearanceTab />}

            {section === "downloads" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ padding: "16px 0", borderBottom: "1px solid color-mix(in srgb, var(--mf-t0) 5%, transparent)" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--mf-t1)", marginBottom: 10 }}>Install location</div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <div style={{ flex: 1, display: "flex", alignItems: "center", height: 38, padding: "0 13px", borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", fontFamily: MONO, fontSize: 12, color: "var(--mf-t2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{installPath || "default install folder"}</div>
                    <button type="button" onClick={() => void pickInstallPath()} className="mf-ghost" style={{ display: "flex", alignItems: "center", gap: 7, padding: "0 15px", height: 38, borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t1)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                      <FolderOpen size={14} strokeWidth={1.6} />Change
                    </button>
                  </div>
                </div>
                <div style={{ padding: "16px 0", borderBottom: "1px solid color-mix(in srgb, var(--mf-t0) 5%, transparent)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--mf-t1)" }}>Limit download speed</div>
                      <div style={{ fontFamily: MONO, fontSize: 11, color: "var(--mf-t4)", marginTop: 3 }}>Cap bandwidth so games stay playable, applied live</div>
                    </div>
                    <Toggle on={bwOn} onToggle={toggleBw} />
                  </div>
                  {bwOn && (
                    <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 16 }}>
                      <input type="range" className="uc-range" min={1} max={100} value={bwMbps} onChange={(e) => changeBw(Number(e.target.value))} style={{ flex: 1 }} />
                      <span style={{ fontFamily: MONO, fontSize: 12.5, color: "var(--mf-t0)", width: 78, textAlign: "right" }}>{bwMbps} MB/s</span>
                    </div>
                  )}
                </div>
                <ProxyRow />
                <Row title="Max parallel downloads" desc="How many downloads run at once, the rest wait in the queue">
                  <select className="uc-select" value={maxConcurrent} onChange={(e) => { const v = Number(e.target.value); setMaxConcurrent(v); try { void window.ucSettings?.set?.("maxConcurrentDownloads", v) } catch {  } }} style={{ height: 36, minWidth: 90, padding: "0 32px 0 13px", borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", color: "var(--mf-t1)", fontSize: 12.5, cursor: "pointer", WebkitAppearance: "none", appearance: "none" }}>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </Row>
                <Row title="Connections per download" desc="Parallel connections aria2 opens to the mirror, applies to newly started downloads">
                  <select className="uc-select" value={connsPerDl} onChange={(e) => { const v = Number(e.target.value); setConnsPerDl(v); try { void window.ucSettings?.set?.("aria2ConnectionsPerDownload", v) } catch {  } }} style={{ height: 36, minWidth: 90, padding: "0 32px 0 13px", borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", color: "var(--mf-t1)", fontSize: 12.5, cursor: "pointer", WebkitAppearance: "none", appearance: "none" }}>
                    {[1, 2, 4, 8, 16].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </Row>
                <Row title="Free space safety margin" desc="Extra headroom the pre-download disk check demands on top of the estimated install size">
                  <select className="uc-select" value={diskMargin} onChange={(e) => { const v = Number(e.target.value); setDiskMargin(v); try { void window.ucSettings?.set?.("diskSpaceMarginGiB", v) } catch {  } }} style={{ height: 36, minWidth: 110, padding: "0 32px 0 13px", borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", color: "var(--mf-t1)", fontSize: 12.5, cursor: "pointer", WebkitAppearance: "none", appearance: "none" }}>
                    {[0, 1, 2, 4, 8, 16].map((n) => <option key={n} value={n}>{n} GiB</option>)}
                  </select>
                </Row>
                <ToggleRow title="Pause downloads while playing" desc="Pause active downloads when a game launches, resume on exit" on={pauseWhilePlaying} onToggle={() => setBool("pauseDownloadsWhilePlaying", !pauseWhilePlaying, setPauseWhilePlaying)} />
                <ToggleRow title="Always create desktop shortcut" desc="Add a desktop shortcut for each game after it installs" on={shortcut} onToggle={() => setBool("alwaysCreateDesktopShortcut", !shortcut, setShortcut)} />
                <ToggleRow title="Delete archive after extract" desc="Reclaim disk space once unpacking succeeds" on={autoDelete} onToggle={toggleAutoDelete} last />
              </div>
            )}

            {section === "library" && <LibraryTab />}

            {section === "sources" && <SourcesTab />}

            {section === "mods" && <ModsTab onJumpToSources={() => setSection("sources")} />}

            {section === "linux" && <LinuxSettingsTab />}

            {section === "about" && <AboutTab />}
          </div>
        </div>
      </div>
    </div>
  )
}

function ThemeSwatch({ theme, active, onSelect }: { theme: ThemeDef; active: boolean; onSelect: () => void }) {
  const c = theme.colors
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{ display: "flex", flexDirection: "column", gap: 0, padding: 0, borderRadius: 10, overflow: "hidden", border: active ? "1px solid var(--mf-t1)" : "1px solid var(--mf-line-2)", background: "var(--mf-panel)", cursor: "pointer", textAlign: "left" }}
    >
      <span style={{ display: "flex", height: 44, background: c.background }}>
        <span style={{ flex: 1, margin: "10px 0 10px 10px", borderRadius: 5, background: c.card, border: `1px solid ${c.border}` }} />
        <span style={{ width: 26, margin: 10, borderRadius: 5, background: c.primary }} />
        <span style={{ width: 26, margin: "10px 10px 10px 0", borderRadius: 5, background: c.accent }} />
      </span>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderTop: "1px solid var(--mf-line)" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: active ? "var(--mf-t0)" : "var(--mf-t2)" }}>{theme.name}</span>
        {active && <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--mf-t4)" }}>active</span>}
      </span>
    </button>
  )
}

function AppearanceTab() {
  const { activeThemeId, activeTheme, setActiveThemeId } = useActiveTheme()
  const { customThemes, deleteCustomTheme } = useCustomThemes()

  const openEditor = (seed?: ThemeDef) => {
    void window.ucThemeEditor?.open?.({ theme: seed ?? activeTheme, mode: seed ? "edit" : "new" })
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--mf-t1)", marginBottom: 10 }}>Presets</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10 }}>
          {PRESET_THEMES.map((t) => (
            <ThemeSwatch key={t.id} theme={t} active={activeThemeId === t.id} onSelect={() => setActiveThemeId(t.id)} />
          ))}
        </div>
      </div>
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--mf-t1)" }}>Custom themes</div>
          <button type="button" className="mf-ghost" onClick={() => openEditor()} style={{ display: "flex", alignItems: "center", gap: 7, padding: "0 13px", height: 32, borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t1)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            <Plus size={13} strokeWidth={1.8} />New theme
          </button>
        </div>
        {customThemes.length === 0 ? (
          <p style={{ margin: 0, fontFamily: MONO, fontSize: 11, color: "var(--mf-t5)" }}>no custom themes yet — the editor opens in its own window and previews live</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10 }}>
            {customThemes.map((t) => (
              <div key={t.id} style={{ position: "relative" }}>
                <ThemeSwatch theme={t} active={activeThemeId === t.id} onSelect={() => setActiveThemeId(t.id)} />
                <div style={{ position: "absolute", top: 6, right: 6, display: "flex", gap: 4 }}>
                  <button type="button" title="Edit" onClick={() => openEditor(t)} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 6, border: "1px solid color-mix(in srgb, var(--mf-t0) 15%, transparent)", background: "rgba(0,0,0,0.55)", color: "var(--mf-t2)", cursor: "pointer" }}>
                    <Pencil size={11} strokeWidth={1.8} />
                  </button>
                  <button type="button" title="Delete" onClick={() => deleteCustomTheme(t.id)} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 6, border: "1px solid color-mix(in srgb, var(--mf-t0) 15%, transparent)", background: "rgba(0,0,0,0.55)", color: "var(--mf-t3)", cursor: "pointer" }}>
                    <X size={12} strokeWidth={1.8} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function LibraryTab() {
  const [roots, setRoots] = useState<string[]>([])

  useEffect(() => {
    let alive = true
    void window.ucSettings?.get?.("legacyLibraryPaths").then((v) => {
      if (!alive) return
      if (Array.isArray(v)) setRoots(v.filter((x): x is string => typeof x === "string"))
    })
    return () => { alive = false }
  }, [])

  const persist = (next: string[]) => {
    setRoots(next)
    try { void window.ucSettings?.set?.("legacyLibraryPaths", next) } catch {  }
  }

  const addRoot = async () => {
    try {
      const r = await window.ucDialogs?.pickFolder?.()
      if (r?.ok && r.path && !roots.includes(r.path)) persist([...roots, r.path])
    } catch {  }
  }

  return (
    <div>
      <p style={{ margin: "0 0 18px", fontFamily: MONO, fontSize: 11.5, lineHeight: 1.6, color: "var(--mf-t4)" }}>
        Folders scanned for installed games on top of the install location, e.g. an old UnionCrax.Direct install or a second drive. Each game folder needs its installed.json manifest.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {roots.map((root) => (
          <div key={root} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", border: "1px solid var(--mf-line)", borderRadius: 10, background: "var(--mf-panel-2)" }}>
            <FolderOpen size={14} strokeWidth={1.6} color="var(--mf-t4)" />
            <span style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 12, color: "var(--mf-t2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{root}</span>
            <button type="button" title="Remove" onClick={() => persist(roots.filter((r) => r !== root))} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 7, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t3)", cursor: "pointer" }}>
              <X size={13} strokeWidth={1.8} />
            </button>
          </div>
        ))}
        <button type="button" className="mf-ghost" onClick={() => void addRoot()} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 14px", borderRadius: 10, border: "1px dashed var(--mf-line-2)", background: "transparent", color: "var(--mf-t3)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
          <Plus size={14} strokeWidth={1.8} />Add folder
        </button>
      </div>
    </div>
  )
}

function ProxyRow() {
  const [url, setUrl] = useState("")
  useEffect(() => {
    let alive = true
    void (async () => {
      const v = await window.ucSettings?.get?.("proxyUrl")
      if (alive && typeof v === "string") setUrl(v)
    })()
    return () => { alive = false }
  }, [])
  const persist = (v: string) => { try { void window.ucSettings?.set?.("proxyUrl", v.trim() || null) } catch {  } }
  return (
    <div style={{ padding: "16px 0", borderBottom: "1px solid color-mix(in srgb, var(--mf-t0) 5%, transparent)" }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--mf-t1)", marginBottom: 4 }}>Proxy (all connections)</div>
      <div style={{ fontFamily: MONO, fontSize: 11, color: "var(--mf-t4)", marginBottom: 10 }}>Route all of Union.Manifold&apos;s traffic — catalogs, resolvers, images and downloads — through this proxy. Applied live; leave empty for a direct connection.</div>
      <input value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => persist(url)} placeholder="http://user:pass@host:port" autoComplete="off" spellCheck={false} style={{ width: "100%", height: 38, padding: "0 13px", borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", color: "var(--mf-t1)", fontFamily: MONO, fontSize: 12 }} />
    </div>
  )
}

function SourcesTab() {
  const [sources, setSources] = useState<SourceInfo[]>([])
  const [enabled, setEnabled] = useState<Record<string, boolean>>({})
  const [caps, setCaps] = useState<Record<string, SourceCapabilityFlags>>({})
  const [refreshing, setRefreshing] = useState(false)
  const [refreshRows, setRefreshRows] = useState<Array<{ id: string; name: string; state: "pending" | "fetching" | "done" | "failed"; games?: number; ms?: number }> | null>(null)
  const [refreshEta, setRefreshEta] = useState(0)
  const [slipgateUrl, setSlipgateUrl] = useState("")
  const [slipgateKey, setSlipgateKey] = useState("")
  const [slipgateTesting, setSlipgateTesting] = useState(false)
  const [slipgateStatus, setSlipgateStatus] = useState<{ ok: boolean; msg: string } | null>(null)
  const [managedSlipgate, setManagedSlipgate] = useState<ManagedSlipgateStatus | null>(null)
  const [managedSlipgateLoading, setManagedSlipgateLoading] = useState(true)
  const [managedSlipgateAction, setManagedSlipgateAction] = useState<"install" | "start" | "stop" | "update" | "uninstall" | null>(null)
  const [hideTorrent, setHideTorrent] = useState(false)

  const loadSources = async () => {
    const [list, disabled, report] = await Promise.all([listSources(), loadDisabledSources(), sourceCapabilities()])
    setSources(list)
    setEnabled(Object.fromEntries(list.map((s) => [s.id, !disabled.includes(s.id)])))
    const capMap: Record<string, SourceCapabilityFlags> = {}
    for (const p of report?.perSource || []) capMap[p.id] = p
    setCaps(capMap)
  }

  useEffect(() => {
    let alive = true
    void (async () => {
      const [sgu, sgk, sgt] = await Promise.all([
        window.ucSettings?.get?.("slipgateUrl"),
        window.ucSettings?.get?.("slipgateKey"),
        window.ucSettings?.get?.("hideTorrentSources"),
      ])
      if (!alive) return
      if (typeof sgu === "string") setSlipgateUrl(sgu)
      if (typeof sgk === "string") setSlipgateKey(sgk)
      if (typeof sgt === "boolean") setHideTorrent(sgt)
      await loadSources()
    })()
    return () => { alive = false }
  }, [])

  const refreshManagedSlipgate = async () => {
    setManagedSlipgateLoading(true)
    try {
      const result = await window.ucMods?.managedSlipgateStatus?.()
      if (result) setManagedSlipgate(result)
    } catch (error) {
      setManagedSlipgate((current) => current ? { ...current, error: String(error) } : current)
    } finally {
      setManagedSlipgateLoading(false)
    }
  }

  useEffect(() => {
    void refreshManagedSlipgate()
  }, [])

  useEffect(() => {
    return onSourcesChanged(() => { void loadSources() })
  }, [])

  const toggle = async (id: string) => {
    const next = !enabled[id]
    setEnabled((e) => ({ ...e, [id]: next }))
    await setSourceEnabled(id, next)
    const disabled = sources.filter((s) => (s.id === id ? !next : !{ ...enabled, [id]: next }[s.id])).map((s) => s.id)
    await saveDisabledSources(disabled)
  }

  const toggleHideTorrent = async () => {
    const next = !hideTorrent
    setHideTorrent(next)
    try { await window.ucSettings?.set?.("hideTorrentSources", next) } catch {  }
    await loadSources()
  }

  const refresh = async () => {
    setRefreshing(true)
    setRefreshRows([])
    setRefreshEta(0)
    const off = window.ucSources?.onRefreshProgress?.((p) => {
      if (p.state === "start") {
        setRefreshRows((p.sources || []).map((s) => ({ id: s.id, name: s.name, state: "pending" as const })))
      } else if (p.state === "fetching") {
        setRefreshEta(p.etaMs || 0)
        setRefreshRows((rows) => (rows || []).map((r) => (r.id === p.id ? { ...r, state: "fetching" } : r)))
      } else if (p.state === "done" || p.state === "failed") {
        const st = p.state
        const games = p.games ?? undefined
        setRefreshRows((rows) => (rows || []).map((r) => (r.id === p.id ? { ...r, state: st, games, ms: p.ms } : r)))
      }
    })
    try { await window.ucSources?.refresh?.() } catch {  }
    off?.()
    setRefreshEta(0)
    await loadSources()
    setRefreshing(false)
    window.setTimeout(() => setRefreshRows(null), 5000)
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

  const persistSlipgateUrl = async (value: string) => {
    try { await window.ucSettings?.set?.("slipgateUrl", value.trim() || null) } catch {  }
  }
  const persistSlipgateKey = async (value: string) => {
    try { await window.ucSettings?.set?.("slipgateKey", value.trim() || null) } catch {  }
  }
  const testSlipgate = async () => {
    setSlipgateTesting(true); setSlipgateStatus(null)
    try {
      await Promise.all([persistSlipgateUrl(slipgateUrl), persistSlipgateKey(slipgateKey)])
      const r = await window.ucMods?.slipgateCheck?.(slipgateUrl.trim(), slipgateKey.trim())
      if (r?.ok) setSlipgateStatus({ ok: true, msg: `reachable (v${r.version || "?"}), FlareSolverr ${r.flaresolverrOk ? "up" : "DOWN"}` })
      else setSlipgateStatus({ ok: false, msg: r?.error || "unreachable" })
    } catch (err) { setSlipgateStatus({ ok: false, msg: String(err) }) } finally { setSlipgateTesting(false) }
  }

  const runManagedSlipgateAction = async (action: "install" | "start" | "stop" | "update" | "uninstall") => {
    setManagedSlipgateAction(action)
    setManagedSlipgate((current) => current ? { ...current, error: null } : current)
    try {
      let result: ManagedSlipgateStatus | undefined
      if (action === "install") result = await window.ucMods?.managedSlipgateInstall?.()
      if (action === "start") result = await window.ucMods?.managedSlipgateStart?.()
      if (action === "stop") result = await window.ucMods?.managedSlipgateStop?.()
      if (action === "update") result = await window.ucMods?.managedSlipgateUpdate?.()
      if (action === "uninstall") result = await window.ucMods?.managedSlipgateUninstall?.()
      if (result) setManagedSlipgate(result)
      const [url, key] = await Promise.all([
        window.ucSettings?.get?.("slipgateUrl"),
        window.ucSettings?.get?.("slipgateKey"),
      ])
      setSlipgateUrl(typeof url === "string" ? url : "")
      setSlipgateKey(typeof key === "string" ? key : "")
      await loadSources()
    } catch (error) {
      setManagedSlipgate((current) => current ? { ...current, error: String(error) } : current)
    } finally {
      setManagedSlipgateAction(null)
    }
  }

  const managedSelected = Boolean(managedSlipgate?.url && managedSlipgate.url === slipgateUrl.trim())
  const managedStatusText = managedSlipgateLoading
    ? "Checking Docker…"
    : !managedSlipgate?.dockerAvailable
      ? "Docker is unavailable"
      : !managedSlipgate.composeAvailable
        ? "Docker Compose is unavailable"
        : !managedSlipgate.installed
          ? "Ready to install"
          : managedSlipgate.running && managedSlipgate.flaresolverrOk
            ? `Running${managedSlipgate.version ? ` · Slipgate v${managedSlipgate.version}` : ""} · FlareSolverr ready`
            : managedSlipgate.running
              ? "Slipgate is running, FlareSolverr is not ready"
              : "Installed and stopped"

  return (
    <>
      <p style={{ margin: "0 0 16px", fontFamily: MONO, fontSize: 11.5, lineHeight: 1.6, color: "var(--mf-t4)" }}>
        Enable the catalog sources you trust. Disabled sources are hidden from Browse and search.
      </p>

      <div style={{ padding: "14px 16px", border: "1px solid var(--mf-line)", borderRadius: 11, background: "var(--mf-panel-2)", marginBottom: 18 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--mf-t1)" }}>Slipgate resolver</div>
        <div style={{ fontFamily: MONO, fontSize: 11, color: "var(--mf-t4)", marginTop: 4, lineHeight: 1.5 }}>
          Run Slipgate and FlareSolverr locally through Docker, or connect to a remote instance. Slipgate unlocks dependent sources and resolves browser-gated file hosts and free NexusMods files.
        </div>

        <div style={{ marginTop: 14, padding: "12px 13px", borderRadius: 9, border: "1px solid var(--mf-line)", background: "var(--mf-panel)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--mf-t1)" }}>Managed local resolver</div>
              <div style={{ marginTop: 3, fontFamily: MONO, fontSize: 10.5, color: managedSlipgate?.running && managedSlipgate.flaresolverrOk ? "var(--mf-t2)" : "var(--mf-t4)" }}>
                {managedStatusText}
              </div>
            </div>
            <button type="button" className="mf-ghost" disabled={managedSlipgateLoading || managedSlipgateAction !== null} onClick={() => void refreshManagedSlipgate()} style={{ height: 32, padding: "0 11px", borderRadius: 7, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t3)", fontSize: 11, fontWeight: 600, cursor: managedSlipgateLoading || managedSlipgateAction !== null ? "default" : "pointer" }}>
              Refresh
            </button>
          </div>

          {managedSlipgate?.installed ? (
            <div style={{ marginTop: 8, fontFamily: MONO, fontSize: 9.5, lineHeight: 1.5, color: "var(--mf-t5)", wordBreak: "break-all" }}>
              {managedSlipgate.slipgateImage}<br />{managedSlipgate.flaresolverrImage}
            </div>
          ) : null}

          {managedSlipgate?.running && !managedSelected ? (
            <div style={{ marginTop: 8, fontFamily: MONO, fontSize: 10.5, color: "var(--mf-t4)" }}>The local resolver is running, but the remote URL below is selected.</div>
          ) : null}

          {managedSlipgate?.error ? (
            <div style={{ marginTop: 8, fontFamily: MONO, fontSize: 10.5, lineHeight: 1.5, color: "var(--mf-danger)" }}>{managedSlipgate.error}</div>
          ) : null}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 11 }}>
            {!managedSlipgateLoading && managedSlipgate && !managedSlipgate.dockerAvailable ? (
              <button type="button" className="mf-ghost" onClick={() => void window.ucSystem?.openExternal?.("https://docs.docker.com/get-docker/")} style={{ height: 32, padding: "0 12px", borderRadius: 7, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t1)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Get Docker</button>
            ) : null}
            {managedSlipgate?.dockerAvailable && managedSlipgate.composeAvailable && !managedSlipgate.installed ? (
              <button type="button" className="mf-ghost" disabled={managedSlipgateAction !== null} onClick={() => void runManagedSlipgateAction("install")} style={{ height: 32, padding: "0 12px", borderRadius: 7, border: "1px solid var(--mf-line-2)", background: "var(--mf-t1)", color: "var(--mf-bg)", fontSize: 11, fontWeight: 700, cursor: managedSlipgateAction ? "default" : "pointer", opacity: managedSlipgateAction ? 0.65 : 1 }}>
                {managedSlipgateAction === "install" ? "Installing…" : "Install with Docker"}
              </button>
            ) : null}
            {managedSlipgate?.installed && !managedSlipgate.running ? (
              <button type="button" className="mf-ghost" disabled={managedSlipgateAction !== null} onClick={() => void runManagedSlipgateAction("start")} style={{ height: 32, padding: "0 12px", borderRadius: 7, border: "1px solid var(--mf-line-2)", background: "var(--mf-t1)", color: "var(--mf-bg)", fontSize: 11, fontWeight: 700, cursor: managedSlipgateAction ? "default" : "pointer", opacity: managedSlipgateAction ? 0.65 : 1 }}>
                {managedSlipgateAction === "start" ? "Starting…" : "Start"}
              </button>
            ) : null}
            {managedSlipgate?.installed && managedSlipgate.running && !managedSelected ? (
              <button type="button" className="mf-ghost" disabled={managedSlipgateAction !== null} onClick={() => void runManagedSlipgateAction("start")} style={{ height: 32, padding: "0 12px", borderRadius: 7, border: "1px solid var(--mf-line-2)", background: "var(--mf-t1)", color: "var(--mf-bg)", fontSize: 11, fontWeight: 700, cursor: managedSlipgateAction ? "default" : "pointer", opacity: managedSlipgateAction ? 0.65 : 1 }}>Use local</button>
            ) : null}
            {managedSlipgate?.installed && managedSlipgate.running ? (
              <button type="button" className="mf-ghost" disabled={managedSlipgateAction !== null} onClick={() => void runManagedSlipgateAction("stop")} style={{ height: 32, padding: "0 12px", borderRadius: 7, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t1)", fontSize: 11, fontWeight: 600, cursor: managedSlipgateAction ? "default" : "pointer", opacity: managedSlipgateAction ? 0.65 : 1 }}>
                {managedSlipgateAction === "stop" ? "Stopping…" : "Stop"}
              </button>
            ) : null}
            {managedSlipgate?.installed ? (
              <>
                <button type="button" className="mf-ghost" disabled={managedSlipgateAction !== null} onClick={() => void runManagedSlipgateAction("update")} style={{ height: 32, padding: "0 12px", borderRadius: 7, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t1)", fontSize: 11, fontWeight: 600, cursor: managedSlipgateAction ? "default" : "pointer", opacity: managedSlipgateAction ? 0.65 : 1 }}>
                  {managedSlipgateAction === "update" ? "Updating…" : "Update"}
                </button>
                <button type="button" className="mf-ghost" disabled={managedSlipgateAction !== null} onClick={() => void runManagedSlipgateAction("uninstall")} style={{ height: 32, padding: "0 12px", borderRadius: 7, border: "1px solid color-mix(in srgb, var(--mf-danger) 45%, transparent)", background: "transparent", color: "var(--mf-danger)", fontSize: 11, fontWeight: 600, cursor: managedSlipgateAction ? "default" : "pointer", opacity: managedSlipgateAction ? 0.65 : 1 }}>
                  {managedSlipgateAction === "uninstall" ? "Removing…" : "Remove"}
                </button>
              </>
            ) : null}
          </div>
        </div>

        <div style={{ marginTop: 14, fontSize: 12.5, fontWeight: 600, color: "var(--mf-t1)" }}>Remote resolver</div>
        <div style={{ marginTop: 3, fontFamily: MONO, fontSize: 10.5, lineHeight: 1.5, color: "var(--mf-t5)" }}>Enter a remote Slipgate URL, or leave these fields untouched when using the managed local resolver.</div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <input
            value={slipgateUrl}
            onChange={(e) => setSlipgateUrl(e.target.value)}
            onBlur={() => void persistSlipgateUrl(slipgateUrl)}
            placeholder="https://slipgate.example.com"
            autoComplete="off"
            spellCheck={false}
            style={{ flex: 1, height: 38, padding: "0 13px", borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", color: "var(--mf-t1)", fontFamily: MONO, fontSize: 12, outline: "none" }}
          />
          <button type="button" className="mf-ghost" disabled={slipgateTesting || !slipgateUrl.trim()} onClick={() => void testSlipgate()} style={{ display: "flex", alignItems: "center", gap: 7, padding: "0 15px", height: 38, borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "transparent", color: !slipgateUrl.trim() ? "var(--mf-t4)" : "var(--mf-t1)", fontSize: 12, fontWeight: 600, cursor: slipgateTesting || !slipgateUrl.trim() ? "default" : "pointer", opacity: slipgateTesting ? 0.6 : 1, flexShrink: 0 }}>
            {slipgateTesting ? "Testing…" : "Test"}
          </button>
        </div>
        <input
          type="password"
          value={slipgateKey}
          onChange={(e) => setSlipgateKey(e.target.value)}
          onBlur={() => void persistSlipgateKey(slipgateKey)}
          placeholder="X-Slipgate-Key (optional)"
          autoComplete="off"
          spellCheck={false}
          style={{ width: "100%", height: 38, padding: "0 13px", marginTop: 10, borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", color: "var(--mf-t1)", fontFamily: MONO, fontSize: 12, outline: "none", boxSizing: "border-box" }}
        />
        {slipgateStatus ? (
          <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 11.5, color: slipgateStatus.ok ? "var(--mf-t2)" : "var(--mf-danger)" }}>Slipgate {slipgateStatus.msg}</div>
        ) : null}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", border: "1px solid var(--mf-line)", borderRadius: 11, background: "var(--mf-panel-2)", marginBottom: 18 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--mf-t1)" }}>Hide torrent and Online-Fix sources</div>
          <div style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--mf-t5)", marginTop: 3, lineHeight: 1.5 }}>Hide Online-Fix plus GOG, EMPRESS and KaOsKrew from Browse, search and the sidebar. The latter three only surface magnet or torrent links.</div>
        </div>
        <Toggle on={hideTorrent} onToggle={() => void toggleHideTorrent()} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {sources.map((s) => {
          const on = Boolean(enabled[s.id])
          const torrentHidden = hideTorrent && s.hiddenByTorrentFilter
          const gated = s.requiresSlipgate && !s.available && !torrentHidden
          const off = gated || torrentHidden
          return (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", border: "1px solid var(--mf-line)", borderRadius: 11, background: "var(--mf-panel-2)", opacity: off ? 0.65 : 1 }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: !off && on ? "var(--mf-t2)" : "var(--mf-t6)", flexShrink: 0 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 600, color: "var(--mf-t0)" }}>
                  {s.name}
                  {s.torrentOnly ? (
                    <span style={{ padding: "2px 8px", borderRadius: 999, border: "1px solid var(--mf-line-2)", fontFamily: MONO, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--mf-t4)" }}>torrent-only</span>
                  ) : null}
                  {s.requiresSlipgate ? (
                    <span style={{ padding: "2px 8px", borderRadius: 999, border: "1px solid var(--mf-line-2)", fontFamily: MONO, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--mf-t4)" }}>dependent on Slipgate</span>
                  ) : null}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--mf-t5)", marginTop: 2 }}>{torrentHidden ? "hidden by source filter" : gated ? "configure Slipgate above to enable" : on ? detailFor(s.id) : "disabled · hidden from browse"}</div>
              </div>
              {gated ? (
                <span style={{ fontFamily: MONO, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--mf-t5)" }}>locked</span>
              ) : torrentHidden ? (
                <span style={{ fontFamily: MONO, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--mf-t5)" }}>off</span>
              ) : (
                <Toggle on={on} onToggle={() => void toggle(s.id)} />
              )}
            </div>
          )
        })}
      </div>
      <button type="button" className="mf-ghost" disabled={refreshing} onClick={() => void refresh()} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 12, padding: "11px 14px", borderRadius: 10, border: "1px dashed var(--mf-line-2)", background: "transparent", color: "var(--mf-t3)", fontSize: 12.5, fontWeight: 600, cursor: refreshing ? "default" : "pointer", opacity: refreshing ? 0.6 : 1 }}>
        {refreshing ? `Refreshing… ${(refreshRows || []).filter((r) => r.state === "done" || r.state === "failed").length}/${(refreshRows || []).length}` : "Refresh catalogs now"}
      </button>
      {refreshRows && refreshRows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10, padding: "12px 14px", border: "1px solid var(--mf-line)", borderRadius: 10, background: "var(--mf-panel-2)" }}>
          {refreshing && refreshEta > 0 && (
            <div style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--mf-t4)" }}>~{Math.ceil(refreshEta / 1000)}s remaining</div>
          )}
          {refreshRows.map((r) => {
            const color = r.state === "done" ? "var(--mf-t2)" : r.state === "failed" ? "var(--mf-danger)" : r.state === "fetching" ? "var(--mf-t1)" : "var(--mf-t6)"
            const status = r.state === "pending" ? "waiting" : r.state === "fetching" ? "downloading…" : r.state === "failed" ? "failed" : `${r.games ?? 0} games · ${((r.ms ?? 0) / 1000).toFixed(1)}s`
            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: MONO, fontSize: 11 }}>
                <span style={{ width: 7, height: 7, borderRadius: 99, background: color, flexShrink: 0 }} />
                <span style={{ flex: 1, color: "var(--mf-t2)" }}>{r.name}</span>
                <span style={{ color: r.state === "fetching" ? "var(--mf-t2)" : "var(--mf-t5)" }}>{status}</span>
              </div>
            )
          })}
        </div>
      )}
      <p style={{ margin: "10px 0 0", fontFamily: MONO, fontSize: 10.5, lineHeight: 1.6, color: "var(--mf-t5)" }}>
        Forces a fresh catalog pull. Hydralinks-backed sources are cached for 7 days; this refetches them now (via Slipgate where required).
      </p>
    </>
  )
}

const LINUX_SELECT: React.CSSProperties = { height: 36, minWidth: 180, padding: "0 32px 0 13px", borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", color: "var(--mf-t1)", fontSize: 12.5, cursor: "pointer", WebkitAppearance: "none", appearance: "none" }

function LinuxSettingsTab() {
  const [launchMode, setLaunchMode] = useState("auto")
  const [protonPath, setProtonPath] = useState("")
  const [protonPrefix, setProtonPrefix] = useState("")
  const [extraEnv, setExtraEnv] = useState("")
  const [proton, setProton] = useState<LinuxDetectionOption[]>([])
  const [gamemode, setGamemode] = useState(false)
  const [mangohud, setMangohud] = useState(false)
  const [dllOverrides, setDllOverrides] = useState("")

  useEffect(() => {
    let alive = true
    void (async () => {
      const [lm, pp, ppfx, env, detect, gm, mh, dll] = await Promise.all([
        window.ucSettings?.get?.("linuxLaunchMode"),
        window.ucSettings?.get?.("linuxProtonPath"),
        window.ucSettings?.get?.("linuxProtonPrefix"),
        window.ucSettings?.get?.("linuxExtraEnv"),
        window.ucLinux?.detectProton?.(),
        window.ucSettings?.get?.("linuxGamemode"),
        window.ucSettings?.get?.("linuxMangohud"),
        window.ucSettings?.get?.("linuxDllOverrides"),
      ])
      if (!alive) return
      if (typeof lm === "string") setLaunchMode(lm)
      if (typeof pp === "string") setProtonPath(pp)
      if (typeof ppfx === "string") setProtonPrefix(ppfx)
      if (typeof env === "string") setExtraEnv(env)
      if (detect?.ok && Array.isArray(detect.versions)) setProton(detect.versions as LinuxDetectionOption[])
      setGamemode(gm === true)
      setMangohud(mh === true)
      if (typeof dll === "string") setDllOverrides(dll)
    })()
    return () => { alive = false }
  }, [])

  const persist = (key: string, value: string) => { try { void window.ucSettings?.set?.(key, value) } catch {  } }
  const persist2 = (key: string, value: boolean) => { try { void window.ucSettings?.set?.(key, value) } catch {  } }
  const pickPrefix = async () => {
    const r = await window.ucLinux?.pickPrefixDir?.()
    if (r?.ok && r.path) { setProtonPrefix(r.path); persist("linuxProtonPrefix", r.path) }
  }

  const steam = proton.filter((p) => !p.source || p.source === "steam")
  const protonplus = proton.filter((p) => p.source === "protonplus" || p.source === "community")

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

      <Row title="Proton version" desc={proton.length ? `${proton.length} runner${proton.length === 1 ? "" : "s"} detected (Steam + ProtonPlus)` : "no Proton runners detected"}>
        <select className="uc-select" value={protonPath} onChange={(e) => { setProtonPath(e.target.value); persist("linuxProtonPath", e.target.value) }} style={LINUX_SELECT}>
          <option value="">System default</option>
          {steam.length ? <optgroup label="Steam Proton">{steam.map((p) => <option key={p.path} value={p.path}>{p.label}</option>)}</optgroup> : null}
          {protonplus.length ? <optgroup label="ProtonPlus">{protonplus.map((p) => <option key={p.path} value={p.path}>{p.label}{p.newest ? " — newest" : ""}</option>)}</optgroup> : null}
        </select>
      </Row>

      <div style={{ padding: "16px 0", borderBottom: "1px solid color-mix(in srgb, var(--mf-t0) 5%, transparent)" }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--mf-t1)", marginBottom: 3 }}>Proton prefix</div>
        <div style={{ fontFamily: MONO, fontSize: 11, color: "var(--mf-t4)", marginBottom: 10 }}>STEAM_COMPAT_DATA_PATH, blank uses the per-game auto path</div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1, display: "flex", alignItems: "center", height: 38, padding: "0 13px", borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", fontFamily: MONO, fontSize: 12, color: protonPrefix ? "var(--mf-t2)" : "var(--mf-t5)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{protonPrefix || "Auto"}</div>
          <button type="button" onClick={() => void pickPrefix()} className="mf-ghost" style={{ display: "flex", alignItems: "center", gap: 7, padding: "0 15px", height: 38, borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t1)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            <FolderOpen size={14} strokeWidth={1.6} />Browse
          </button>
        </div>
      </div>

      <Row title="GameMode" desc="Wrap launches in gamemoderun for CPU governor and priority tweaks, skipped when not installed">
        <Toggle on={gamemode} onToggle={() => { const v = !gamemode; setGamemode(v); persist2("linuxGamemode", v) }} />
      </Row>
      <Row title="MangoHud" desc="Show the MangoHud performance overlay in game, skipped when not installed">
        <Toggle on={mangohud} onToggle={() => { const v = !mangohud; setMangohud(v); persist2("linuxMangohud", v) }} />
      </Row>

      <div style={{ padding: "16px 0", borderBottom: "1px solid color-mix(in srgb, var(--mf-t0) 5%, transparent)" }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--mf-t1)", marginBottom: 3 }}>Default WINEDLLOVERRIDES</div>
        <div style={{ fontFamily: MONO, fontSize: 11, color: "var(--mf-t4)", marginBottom: 10 }}>Used when neither the game folder (OnlineFix) nor per-game env set overrides, e.g. winmm=n,b;dinput8=n,b</div>
        <input
          value={dllOverrides}
          onChange={(e) => setDllOverrides(e.target.value)}
          onBlur={() => persist("linuxDllOverrides", dllOverrides)}
          placeholder="empty for none"
          style={{ width: "100%", boxSizing: "border-box", height: 38, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", borderRadius: 8, padding: "0 12px", fontFamily: MONO, fontSize: 12.5, color: "var(--mf-t1)", outline: "none" }}
        />
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

const FORK_VERSION = "1.0.0b"
const BASED_ON = "UnionCrax.Direct v2.7.3"

function AboutTab() {
  const [updMsg, setUpdMsg] = useState("up to date")
  const [checking, setChecking] = useState(false)
  const [installable, setInstallable] = useState(false)
  const [version, setVersion] = useState(FORK_VERSION)

  useEffect(() => {
    void window.ucUpdater?.getVersion?.().then((v) => { if (v) setVersion(v) }).catch(() => { })
  }, [])

  useEffect(() => {
    const off = window.ucUpdater?.onUpdateAvailable?.((data) => {
      setInstallable(true)
      setUpdMsg(`update available · ${data?.version || ""}`)
    })
    return () => { off?.() }
  }, [])

  const check = async () => {
    if (!window.ucUpdater?.checkForUpdates) return
    setChecking(true)
    try {
      const r = await window.ucUpdater.checkForUpdates()
      setInstallable(Boolean(r.available))
      setUpdMsg(r.available ? `update available · ${r.version || ""}` : r.state === "error" ? `check failed${r.error ? ` · ${r.error}` : ""}` : "up to date")
    } catch (err) {
      setUpdMsg(`check failed · ${String(err)}`)
    } finally {
      setChecking(false)
    }
  }

  const install = async () => {
    setChecking(true)
    setUpdMsg("downloading update…")
    const offProgress = window.ucUpdater?.onUpdateProgress?.((p) => {
      if (p.phase === "installing") setUpdMsg("installing update… (authentication may be required)")
      else if (p.total) setUpdMsg(`downloading update… ${Math.min(100, Math.round((p.received / p.total) * 100))}%`)
      else setUpdMsg(`downloading update… ${(p.received / 1e6).toFixed(0)} MB`)
    })
    try {
      const r = await window.ucUpdater?.installUpdate?.()
      if (r && r.ok === false) setUpdMsg(`update failed${r.error ? ` · ${r.error}` : ""}`)
    } catch (err) {
      setUpdMsg(`update failed · ${String(err)}`)
    } finally {
      offProgress?.()
      setChecking(false)
    }
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 16, paddingBottom: 22, borderBottom: "1px solid var(--mf-line)" }}>
        <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 54, height: 54, borderRadius: 14, background: "var(--mf-accent)", color: "var(--mf-accent-ink)" }}>
          <svg viewBox="0 0 24 24" style={{ width: "62%", height: "62%", display: "block" }} fill="none" stroke="var(--mf-accent-ink)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h5c3 0 3.5 6 7 6" /><path d="M3 12h12" /><path d="M3 18h5c3 0 3.5-6 7-6" /><path d="M15 12h6" /><circle cx="15" cy="12" r="1.7" fill="var(--mf-accent-ink)" stroke="none" /></svg>
        </span>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: "var(--mf-t0)" }}>{BRAND.name}</div>
          <div style={{ fontFamily: MONO, fontSize: 11.5, color: "var(--mf-t4)", marginTop: 3 }}>version {version} · {updMsg}</div>
          <div style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--mf-t5)", marginTop: 4 }}>based on {BASED_ON}</div>
        </div>
        <button type="button" onClick={() => void (installable ? install() : check())} disabled={checking} className="mf-ghost" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t1)", fontSize: 12.5, fontWeight: 600, cursor: checking ? "default" : "pointer", opacity: checking ? 0.7 : 1 }}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M2 8a6 6 0 0 1 10-4.5L14 5" /><polyline points="14 2 14 5 11 5" /><path d="M14 8a6 6 0 0 1-10 4.5L2 11" /><polyline points="2 14 2 11 5 11" /></svg>
          {checking ? "Working…" : installable ? "Install update" : "Check for updates"}
        </button>
      </div>
      <p style={{ margin: "22px 0 0", fontFamily: MONO, fontSize: 11, color: "var(--mf-t5)" }}>{BRAND.tagline}</p>
    </>
  )
}

function ModsTab({ onJumpToSources }: { onJumpToSources: () => void }) {
  const [apiKey, setApiKey] = useState("")
  const [reveal, setReveal] = useState(false)
  const [saved, setSaved] = useState(false)
  const [validating, setValidating] = useState(false)
  const [account, setAccount] = useState<{ name: string; premium: boolean } | null>(null)
  const [valError, setValError] = useState("")
  const [steamcmd, setSteamcmd] = useState<"absent" | "bootstrapping" | "ready" | null>(null)
  const [sessionCookie, setSessionCookie] = useState("")
  const [sessionRevealed, setSessionRevealed] = useState(false)
  const [sessionSaved, setSessionSaved] = useState(false)
  const [sessionUa, setSessionUa] = useState("")
  const [uaSaved, setUaSaved] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [k, sc, ua, ws] = await Promise.all([
          window.ucSettings?.get?.("nexusApiKey"),
          window.ucSettings?.get?.("nexusSessionCookie"),
          window.ucSettings?.get?.("nexusUserAgent"),
          window.ucMods?.workshopStatus?.(),
        ])
        if (!alive) return
        if (typeof k === "string") setApiKey(k)
        if (typeof sc === "string") setSessionCookie(sc)
        if (typeof ua === "string") setSessionUa(ua)
        setSteamcmd(ws?.ok && ws.steamcmd ? ws.steamcmd : "absent")
      } catch {  }
    })()
    return () => { alive = false }
  }, [])

  const persistKey = async (value: string) => {
    try {
      await window.ucSettings?.set?.("nexusApiKey", value.trim() || null)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1600)
    } catch {  }
  }

  const persistSession = async (value: string) => {
    try {
      await window.ucSettings?.set?.("nexusSessionCookie", value.trim() || null)
      setSessionSaved(true)
      window.setTimeout(() => setSessionSaved(false), 1600)
    } catch {  }
  }

  const persistUa = async (value: string) => {
    try {
      await window.ucSettings?.set?.("nexusUserAgent", value.trim() || null)
      setUaSaved(true)
      window.setTimeout(() => setUaSaved(false), 1600)
    } catch {  }
  }

  const validate = async () => {
    setValidating(true); setValError(""); setAccount(null)
    try {
      await window.ucSettings?.set?.("nexusApiKey", apiKey.trim() || null)
      const r = await window.ucMods?.nexusValidate?.()
      if (r?.ok && r.user) setAccount({ name: r.user.name, premium: r.user.premium })
      else setValError(r?.error || "key rejected")
    } catch (err) { setValError(String(err)) } finally { setValidating(false) }
  }

  const steamcmdLabel = steamcmd === "ready" ? "ready" : steamcmd === "bootstrapping" ? "installing…" : "not installed"

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ padding: "16px 0", borderBottom: "1px solid color-mix(in srgb, var(--mf-t0) 5%, transparent)" }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--mf-t1)" }}>NexusMods API key</div>
        <div style={{ fontFamily: MONO, fontSize: 11, color: "var(--mf-t4)", marginTop: 3 }}>personal key from nexusmods.com → account settings → API keys, stored locally{saved ? " — saved" : ""}</div>
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <input
            type={reveal ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onBlur={() => void persistKey(apiKey)}
            placeholder="paste your API key…"
            autoComplete="off"
            spellCheck={false}
            style={{ flex: 1, height: 38, padding: "0 13px", borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", color: "var(--mf-t1)", fontFamily: MONO, fontSize: 12, outline: "none" }}
          />
          <button type="button" className="mf-ghost" title={reveal ? "Hide key" : "Show key"} onClick={() => setReveal((v) => !v)} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t3)", cursor: "pointer", flexShrink: 0 }}>
            {reveal ? <EyeOff size={14} strokeWidth={1.6} /> : <Eye size={14} strokeWidth={1.6} />}
          </button>
          <button type="button" className="mf-ghost" disabled={validating || !apiKey.trim()} onClick={() => void validate()} style={{ display: "flex", alignItems: "center", gap: 7, padding: "0 15px", height: 38, borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "transparent", color: !apiKey.trim() ? "var(--mf-t4)" : "var(--mf-t1)", fontSize: 12, fontWeight: 600, cursor: validating || !apiKey.trim() ? "default" : "pointer", opacity: validating ? 0.6 : 1, flexShrink: 0 }}>
            {validating ? "Validating…" : "Validate"}
          </button>
        </div>
        {account ? (
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 10, fontFamily: MONO, fontSize: 11.5, color: "var(--mf-t2)" }}>
            <span>signed in as {account.name}</span>
            <span style={{ padding: "2px 9px", borderRadius: 999, border: "1px solid var(--mf-line-2)", fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.09em", color: account.premium ? "var(--mf-t0)" : "var(--mf-t3)" }}>{account.premium ? "Premium" : "Free"}</span>
          </div>
        ) : valError ? (
          <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 11.5, color: "var(--mf-danger)" }}>{valError}</div>
        ) : null}
        <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 10.5, color: "var(--mf-t5)" }}>
          nxm:// “Mod Manager Download” links from the Nexus site open in this app automatically. Free accounts install through those links; Premium accounts download directly.
        </div>
      </div>

      <div style={{ padding: "16px 0", borderBottom: "1px solid color-mix(in srgb, var(--mf-t0) 5%, transparent)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--mf-t1)" }}>Free in-app downloads (advanced, opt-in)</div>
          <span style={{ padding: "2px 8px", borderRadius: 999, border: "1px solid var(--mf-danger)", color: "var(--mf-danger)", fontFamily: MONO, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em" }}>ToS risk</span>
        </div>
        <div style={{ fontFamily: MONO, fontSize: 11, color: "var(--mf-danger)", marginTop: 6, lineHeight: 1.5 }}>
          Replaying your nexusmods.com session to auto-generate free download links is against NexusMods' Terms of Service and can get your account banned. Leave this blank to keep using the sanctioned nxm:// "Mod Manager Download" flow. Premium accounts never need it.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
          <button type="button" className="mf-ghost" onClick={onJumpToSources} style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 13px", height: 34, borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t1)", fontSize: 12, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>
            Configure Slipgate →
          </button>
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--mf-t4)", lineHeight: 1.4 }}>
            free NexusMods downloads clear Cloudflare through your Slipgate resolver — set it under Settings → Sources
          </span>
        </div>
        <div style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--mf-t4)", marginTop: 8, lineHeight: 1.5 }}>
          To enable: in your browser open devtools (F12) on nexusmods.com → Application → Cookies → https://www.nexusmods.com, copy the nexusmods_session value and paste it here as name=value (or paste the whole Cookie header). If downloads fail with a Cloudflare error, also include cf_clearance.{sessionSaved ? " (saved)" : ""}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <input
            type={sessionRevealed ? "text" : "password"}
            value={sessionCookie}
            onChange={(e) => setSessionCookie(e.target.value)}
            onBlur={() => void persistSession(sessionCookie)}
            placeholder="nexusmods_session=…"
            autoComplete="off"
            spellCheck={false}
            style={{ flex: 1, height: 38, padding: "0 13px", borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", color: "var(--mf-t1)", fontFamily: MONO, fontSize: 12, outline: "none" }}
          />
          <button type="button" className="mf-ghost" title={sessionRevealed ? "Hide cookie" : "Show cookie"} onClick={() => setSessionRevealed((v) => !v)} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t3)", cursor: "pointer", flexShrink: 0 }}>
            {sessionRevealed ? <EyeOff size={14} strokeWidth={1.6} /> : <Eye size={14} strokeWidth={1.6} />}
          </button>
        </div>
        <div style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--mf-t4)", marginTop: 12, lineHeight: 1.5 }}>
          Browser User-Agent (required when using cf_clearance): in the SAME browser's devtools console run <code>navigator.userAgent</code> and paste the result here. A cf_clearance cookie only validates against the exact User-Agent that created it.{uaSaved ? " (saved)" : ""}
        </div>
        <input
          value={sessionUa}
          onChange={(e) => setSessionUa(e.target.value)}
          onBlur={() => void persistUa(sessionUa)}
          placeholder="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 …"
          autoComplete="off"
          spellCheck={false}
          style={{ width: "100%", height: 38, padding: "0 13px", marginTop: 12, borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", color: "var(--mf-t1)", fontFamily: MONO, fontSize: 12, outline: "none", boxSizing: "border-box" }}
        />
      </div>

      <Row title="Workshop downloader" desc="steamcmd fetches Workshop items — it installs itself automatically on your first Workshop mod install" last>
        <span style={{ padding: "3px 10px", borderRadius: 999, border: "1px solid var(--mf-line-2)", fontFamily: MONO, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.09em", color: steamcmd === "ready" ? "var(--mf-t0)" : "var(--mf-t4)" }}>
          {steamcmd == null ? "…" : steamcmdLabel}
        </span>
      </Row>
    </div>
  )
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} style={{ position: "relative", width: 40, height: 23, borderRadius: 99, border: "none", cursor: "pointer", background: on ? "var(--mf-t1)" : "color-mix(in srgb, var(--mf-t0) 13%, transparent)", transition: "background .15s", flexShrink: 0 }}>
      <span style={{ position: "absolute", top: 3, left: on ? 20 : 3, width: 17, height: 17, borderRadius: 99, background: on ? "var(--mf-accent-ink)" : "var(--mf-t2)", transition: "left .15s" }} />
    </button>
  )
}

function Row({ title, desc, last, children }: { title: string; desc: string; last?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "16px 0", borderBottom: last ? "none" : "1px solid color-mix(in srgb, var(--mf-t0) 5%, transparent)" }}>
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
const ico = { fill: "none", stroke: "currentColor" as const, strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }
const SECTION_ICON: Record<Section, React.ReactNode> = {
  general: <svg viewBox="0 0 16 16" width="15" height="15" {...ico}><circle cx="8" cy="8" r="2" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" /></svg>,
  appearance: <Palette size={15} strokeWidth={1.6} />,
  library: <LibraryIcon size={15} strokeWidth={1.6} />,
  downloads: <svg viewBox="0 0 16 16" width="15" height="15" {...ico}><line x1="8" y1="2.5" x2="8" y2="9.5" /><polyline points="5 7 8 10 11 7" /><line x1="3" y1="13.5" x2="13" y2="13.5" /></svg>,
  sources: <svg viewBox="0 0 16 16" width="15" height="15" {...ico}><ellipse cx="8" cy="4" rx="5.5" ry="2" /><path d="M2.5 4v8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4" /><path d="M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" /></svg>,
  mods: <Puzzle size={15} strokeWidth={1.6} />,
  linux: <Terminal size={15} strokeWidth={1.6} />,
  about: <svg viewBox="0 0 16 16" width="15" height="15" {...ico}><circle cx="8" cy="8" r="6" /><line x1="8" y1="7.5" x2="8" y2="11.5" /><circle cx="8" cy="4.8" r="0.7" fill="currentColor" stroke="none" /></svg>,
}
