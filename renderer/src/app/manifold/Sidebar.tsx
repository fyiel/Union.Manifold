import { useEffect, useState, type CSSProperties, type ReactNode } from "react"
import { NavLink } from "react-router-dom"
import { BRAND } from "@/lib/brand"
import { listSources, loadDisabledSources, saveDisabledSources, setSourceEnabled } from "@/lib/sources"

// The Union.Manifold sidebar, shared chrome on every page. Collapsible (228px to
// 64px) via the body.uc-nav-collapsed contract in manifold.css. Collapse state is
// persisted in localStorage so it survives re-renders and route changes.
// Inline-styled to match the handoff comps 1:1.

const NAV_KEY = "uc_nav_collapsed"

// Apply the persisted collapse state to <body> (called on mount + toggle).
function applyNavCollapsed() {
  let on = false
  try {
    on = localStorage.getItem(NAV_KEY) === "1"
  } catch {
    /* ignore */
  }
  document.body.classList.toggle("uc-nav-collapsed", on)
}

function toggleNavCollapsed() {
  let on = false
  try {
    on = localStorage.getItem(NAV_KEY) === "1"
  } catch {
    /* ignore */
  }
  on = !on
  try {
    localStorage.setItem(NAV_KEY, on ? "1" : "0")
  } catch {
    /* ignore */
  }
  applyNavCollapsed()
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
}

export function ManifoldGlyph({ size = 24, color = "#111" }: { size?: number; color?: string }) {
  // Converging strokes that meet at a node, the "manifold" mark.
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
      <path d="M3 6h5c3 0 3.5 6 7 6" />
      <path d="M3 12h12" />
      <path d="M3 18h5c3 0 3.5-6 7-6" />
      <path d="M15 12h6" />
      <circle cx="15" cy="12" r="1.7" fill={color} stroke="none" />
    </svg>
  )
}

const ICONS: Record<string, ReactNode> = {
  browse: (
    <svg viewBox="0 0 16 16" width="16" height="16" {...stroke}>
      <circle cx="7" cy="7" r="4.5" />
      <line x1="10.5" y1="10.5" x2="14" y2="14" />
    </svg>
  ),
  library: (
    <svg viewBox="0 0 16 16" width="16" height="16" {...stroke}>
      <rect x="2.5" y="3" width="11" height="4" rx="1" />
      <rect x="2.5" y="9" width="11" height="4" rx="1" />
    </svg>
  ),
  downloads: (
    <svg viewBox="0 0 16 16" width="16" height="16" {...stroke}>
      <line x1="8" y1="2.5" x2="8" y2="9.5" />
      <polyline points="5 7 8 10 11 7" />
      <line x1="3" y1="13.5" x2="13" y2="13.5" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 16 16" width="16" height="16" {...stroke}>
      <line x1="2.5" y1="5" x2="13.5" y2="5" />
      <line x1="2.5" y1="11" x2="13.5" y2="11" />
      <circle cx="6" cy="5" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="10" cy="11" r="1.8" fill="currentColor" stroke="none" />
    </svg>
  ),
}

const NAV = [
  { to: "/", label: "Browse", icon: "browse", end: true },
  { to: "/library", label: "Library", icon: "library", end: false },
  { to: "/downloads", label: "Downloads", icon: "downloads", end: false },
] as const

const collapseIcon = (
  <svg viewBox="0 0 16 16" width="15" height="15" {...stroke}>
    <rect x="2" y="3" width="12" height="10" rx="2" />
    <line x1="6.5" y1="3" x2="6.5" y2="13" />
  </svg>
)

const navBase: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "9px 12px",
  borderRadius: 8,
  fontSize: 13.5,
  textDecoration: "none",
  cursor: "pointer",
}

export function Sidebar() {
  const [sources, setSources] = useState<SourceInfo[]>([])

  useEffect(() => {
    applyNavCollapsed()
  }, [])

  useEffect(() => {
    let alive = true
    void (async () => {
      const [list, disabled] = await Promise.all([listSources(), loadDisabledSources()])
      if (!alive) return
      // The persisted disabled list is the source of truth here. The registry's
      // in-memory enabled set can still read all-on if this mounts before App
      // applies saved prefs at startup.
      setSources(list.map((s) => ({ ...s, enabled: !disabled.includes(s.id) })))
    })()
    return () => {
      alive = false
    }
  }, [])

  // Reflect source toggles made elsewhere (Settings) in real time, both write
  // the gv_source_disabled key so we just re-derive enabled from it.
  useEffect(() => {
    const off = window.ucSettings?.onChanged?.((d: { key: string; value: unknown }) => {
      if (d?.key !== "gv_source_disabled") return
      const disabled = Array.isArray(d.value) ? d.value.filter((x: unknown): x is string => typeof x === "string") : []
      setSources((prev) => prev.map((s) => ({ ...s, enabled: !disabled.includes(s.id) })))
    })
    return () => { off?.() }
  }, [])

  // Flip a source on/off, push it into the main registry, and persist the
  // disabled list. Optimistic, the registry just filters browse/search.
  const toggleSource = (id: string) => {
    setSources((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
      const target = next.find((s) => s.id === id)
      if (target) void setSourceEnabled(id, target.enabled)
      void saveDisabledSources(next.filter((s) => !s.enabled).map((s) => s.id))
      return next
    })
  }

  return (
    <aside
      className="uc-aside"
      style={{
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid var(--mf-line)",
        background: "var(--mf-aside)",
      }}
    >
      {/* logo lockup + collapse toggle (this row is also the window drag handle) */}
      <div data-tauri-drag-region style={{ display: "flex", alignItems: "center", gap: 11, padding: "20px 16px 18px", WebkitAppRegion: "drag" } as CSSProperties}>
        <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 9, background: "#e9e9e9", flexShrink: 0 }}>
          <ManifoldGlyph size={20} />
        </span>
        <div className="uc-navlabel" style={{ lineHeight: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--mf-t1)", letterSpacing: "-0.01em" }}>{BRAND.title}</div>
          <div style={{ fontFamily: "var(--mf-mono)", fontSize: 9, letterSpacing: "0.18em", color: "var(--mf-t5)", marginTop: 3 }}>{BRAND.suffix}</div>
        </div>
        <button
          type="button"
          title="Collapse sidebar"
          onClick={toggleNavCollapsed}
          className="uc-navlabel uc-collapse mf-iconcircle"
          style={{ marginLeft: "auto", display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 7, border: "none", background: "transparent", color: "var(--mf-t4)", cursor: "pointer", flexShrink: 0, WebkitAppRegion: "no-drag" } as CSSProperties}
        >
          {collapseIcon}
        </button>
      </div>

      {/* expand toggle (only visible while collapsed) */}
      <button
        type="button"
        title="Expand sidebar"
        onClick={toggleNavCollapsed}
        className="uc-expand mf-iconcircle"
        style={{ alignItems: "center", justifyContent: "center", width: 38, height: 32, margin: "0 auto 10px", borderRadius: 8, border: "none", background: "transparent", color: "var(--mf-t4)", cursor: "pointer" }}
      >
        {collapseIcon}
      </button>

      <div style={{ height: 1, background: "var(--mf-line)", margin: "0 16px 12px" }} />

      {/* primary nav */}
      <nav style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 12px" }}>
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => "mf-navitem" + (isActive ? " mf-navitem-active" : "")}
            style={({ isActive }) => ({
              ...navBase,
              fontWeight: isActive ? 600 : 500,
              color: isActive ? "var(--mf-t0)" : "var(--mf-t3)",
              background: isActive ? "rgba(255,255,255,0.07)" : "transparent",
            })}
          >
            {ICONS[item.icon]}
            <span className="uc-navlabel">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* source roster */}
      <div className="uc-navsection">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "22px 24px 8px" }}>
          <span style={{ fontFamily: "var(--mf-mono)", fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--mf-t6)" }}>Sources</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 12px" }}>
          {sources.map((s) => (
            <button
              key={s.id}
              type="button"
              role="switch"
              aria-checked={s.enabled}
              title={s.enabled ? `Disable ${s.name}` : `Enable ${s.name}`}
              onClick={() => toggleSource(s.id)}
              style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "7px 12px", fontFamily: "inherit", fontSize: 12.5, color: "var(--mf-t3)", background: "transparent", border: "none", borderRadius: 7, cursor: "pointer", textAlign: "left" }}
            >
              <span style={{ width: 6, height: 6, borderRadius: 99, background: s.enabled ? "#8a8a8a" : "var(--mf-t6)", flexShrink: 0 }} />
              <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: s.enabled ? "var(--mf-t2)" : "var(--mf-t5)" }}>{s.name}</span>
              {!s.enabled && <span style={{ fontFamily: "var(--mf-mono)", fontSize: 9.5, color: "var(--mf-t6)" }}>off</span>}
            </button>
          ))}
        </div>
      </div>

      {/* settings pinned bottom */}
      <div style={{ marginTop: "auto", padding: 12 }}>
        <NavLink
          to="/settings"
          className={({ isActive }) => "mf-navitem" + (isActive ? " mf-navitem-active" : "")}
          style={({ isActive }) => ({
            ...navBase,
            fontWeight: isActive ? 600 : 500,
            color: isActive ? "var(--mf-t0)" : "var(--mf-t3)",
            background: isActive ? "rgba(255,255,255,0.07)" : "transparent",
          })}
        >
          {ICONS.settings}
          <span className="uc-navlabel">Settings</span>
        </NavLink>
      </div>
    </aside>
  )
}
