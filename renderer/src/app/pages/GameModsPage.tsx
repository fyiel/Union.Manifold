import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties } from "react"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import {
  ArrowDown, ArrowUp, Check, Download, FolderOpen, Package, Pencil, Puzzle, RefreshCw, Rocket, Trash2, Undo2, X,
} from "lucide-react"
import { CenterState, COVER_LINES, MONO, SearchIcon, Spinner } from "@/app/manifold/ui"
import { formatNumber, proxyImageUrl } from "@/lib/utils"
import { useToast } from "@/context/toast-context"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

// Per-game mod manager: Installed (order/toggle/deploy), Nexus (browse/search/
// install via API or nxm deep link), Workshop (browse/search/install via
// steamcmd). Backed 1:1 by window.ucMods; refreshes on the mods:changed event
// and renders live mods:install-progress rows at the top of the scroller.

type Tab = "installed" | "nexus" | "workshop"

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "installed", label: "Installed" },
  { id: "nexus", label: "Nexus" },
  { id: "workshop", label: "Workshop" },
]

const NEXUS_CATEGORIES = [
  { id: "trending", label: "Trending" },
  { id: "latest_added", label: "Latest" },
  { id: "latest_updated", label: "Updated" },
] as const
type NexusCategory = (typeof NEXUS_CATEGORIES)[number]["id"]

const WS_SORTS = [
  { id: "trend", label: "Trending" },
  { id: "mostrecent", label: "Most recent" },
  { id: "totaluniquesubscribers", label: "Most subscribed" },
] as const
type WorkshopSort = (typeof WS_SORTS)[number]["id"]

const GHOST_BTN: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "0 13px", height: 34, borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t1)", fontSize: 12, fontWeight: 600, cursor: "pointer" }
const CHIP: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 11px", borderRadius: 999, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", fontFamily: MONO, fontSize: 10.5, color: "var(--mf-t3)" }
const CHIP_INPUT: CSSProperties = { background: "transparent", border: "none", outline: "none", color: "var(--mf-t1)", fontFamily: MONO, fontSize: 10.5, padding: 0 }
const SEARCH_INPUT: CSSProperties = { width: "100%", height: 36, padding: "0 12px 0 34px", borderRadius: 9, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", color: "var(--mf-t1)", fontFamily: MONO, fontSize: 12, outline: "none" }
const GRID: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 14, alignContent: "start" }

function fmtBytes(n?: number | null): string {
  if (!n || n <= 0) return ""
  const u = ["B", "KB", "MB", "GB"]
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`
}

// Unix timestamps from both APIs are usually seconds; tolerate milliseconds.
function fmtDate(ts?: number | null): string {
  if (!ts) return ""
  try { return new Date(ts > 1e12 ? ts : ts * 1000).toLocaleDateString() } catch { return "" }
}

function ArrowBtn({ dir, disabled, onClick }: { dir: "up" | "down"; disabled: boolean; onClick: () => void }) {
  const Icon = dir === "up" ? ArrowUp : ArrowDown
  const label = dir === "up" ? "Move up (deploys earlier, loses conflicts)" : "Move down (deploys later, wins conflicts)"
  return (
    <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick} className="mf-ghost" style={{ width: 22, height: 17, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 5, border: "1px solid var(--mf-line-2)", background: "transparent", color: disabled ? "var(--mf-t6)" : "var(--mf-t3)", cursor: disabled ? "default" : "pointer", padding: 0 }}>
      <Icon size={11} strokeWidth={2} />
    </button>
  )
}

// One browse/search result card, shared shape for both providers.
function BrowseCard({ picture, name, author, metaLine, installed, busy, onInstall }: {
  picture?: string | null
  name: string
  author?: string
  metaLine?: string
  installed: boolean
  busy: boolean
  onInstall: () => void
}) {
  return (
    <div className="mf-card" style={{ borderRadius: 10, border: "1px solid var(--mf-line)", background: "var(--mf-panel)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {picture ? (
        <img src={proxyImageUrl(picture)} alt="" loading="lazy" style={{ width: "100%", height: 104, objectFit: "cover", display: "block", background: "#0f0f0f" }} />
      ) : (
        <div style={{ width: "100%", height: 104, background: COVER_LINES }} />
      )}
      <div style={{ padding: "10px 12px 12px", display: "flex", flexDirection: "column", gap: 5, flex: 1 }}>
        <div title={name} style={{ fontSize: 12.5, fontWeight: 600, color: "var(--mf-t1)", lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{name}</div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: "var(--mf-t4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{author || "unknown author"}</div>
        {metaLine ? <div style={{ fontFamily: MONO, fontSize: 10, color: "var(--mf-t5)" }}>{metaLine}</div> : null}
        <div style={{ marginTop: "auto", paddingTop: 7 }}>
          {installed ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: 10.5, color: "var(--mf-t3)" }}><Check size={12} strokeWidth={2} />installed</span>
          ) : (
            <button type="button" className="mf-ghost" disabled={busy} onClick={onInstall} style={{ ...GHOST_BTN, height: 30, fontSize: 11.5, opacity: busy ? 0.6 : 1, cursor: busy ? "default" : "pointer" }}>
              {busy ? <Spinner size={12} /> : <Download size={12} strokeWidth={1.8} />}
              Install
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function GameModsPage() {
  const { key = "" } = useParams()
  const appid = decodeURIComponent(key)
  const location = useLocation()
  const navigate = useNavigate()
  const { toast } = useToast()

  const navGame = (location.state as { game?: { name?: string; image?: string } } | null)?.game || null
  const gameName = navGame?.name || appid

  const [gs, setGs] = useState<ModGameState | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [tab, setTab] = useState<Tab>("installed")

  const reload = useCallback(async () => {
    try {
      const res = await window.ucMods?.gameGet?.(appid)
      if (res?.ok) { setGs(res); setLoadError("") }
      else setLoadError(res?.error || "mods backend unavailable")
    } catch (err) {
      setLoadError(String(err))
    } finally {
      setLoading(false)
    }
  }, [appid])

  useEffect(() => { void reload() }, [reload])

  // Any manifest/deploy mutation for this game (install finishing, nxm deep
  // link, toggle from elsewhere) re-syncs the whole state.
  useEffect(() => window.ucMods?.onChanged?.((d) => { if (d?.appid === appid) void reload() }), [appid, reload])

  // Live install progress rows + terminal toasts.
  const [progress, setProgress] = useState<Map<string, ModInstallProgress>>(new Map())
  useEffect(() => {
    const offProgress = window.ucMods?.onInstallProgress?.((p) => {
      if (!p || p.appid !== appid) return
      if (p.phase === "done" || p.phase === "error") {
        setProgress((m) => { const next = new Map(m); next.delete(p.modId); return next })
        if (p.phase === "done") toast(`${p.name || "Mod"} installed`, "success")
        else toast(`${p.name || "Mod"}: ${p.error || "install failed"}`, "error", 7000)
        return
      }
      setProgress((m) => new Map(m).set(p.modId, p))
    })
    const offNxm = window.ucMods?.onNxmUnmatched?.((d) => {
      toast(`nxm link for “${d?.domain || "?"}” (mod ${d?.modId || "?"}) didn't match any installed game`, "error", 7000)
    })
    return () => { offProgress?.(); offNxm?.() }
  }, [appid, toast])
  const activeProgress = useMemo(() => [...progress.values()].sort((a, b) => a.modId.localeCompare(b.modId)), [progress])

  const mods = useMemo(() => [...(gs?.mods || [])].sort((a, b) => a.order - b.order), [gs])
  const installedIds = useMemo(() => new Set(mods.map((m) => m.id)), [mods])
  const enabledCount = useMemo(() => mods.filter((m) => m.enabled).length, [mods])

  // ── header chips: nexus domain override + deploy target ──
  const [domainEdit, setDomainEdit] = useState(false)
  const [domainDraft, setDomainDraft] = useState("")
  const startDomainEdit = () => { setDomainDraft(gs?.nexusDomain || ""); setDomainEdit(true) }
  const saveDomain = async () => {
    setDomainEdit(false)
    try {
      const r = await window.ucMods?.gameSet?.(appid, { nexusDomain: domainDraft.trim() || null })
      if (r && !r.ok) toast(r.error || "could not save the Nexus domain", "error")
    } catch (err) { toast(String(err), "error") }
    void reload()
  }

  const [targetDraft, setTargetDraft] = useState("")
  const targetSeeded = useRef(false)
  useEffect(() => {
    if (gs && !targetSeeded.current) { targetSeeded.current = true; setTargetDraft(gs.deployTarget || "") }
  }, [gs])
  const targetDirty = gs != null && targetDraft.trim() !== (gs.deployTarget || "")
  const saveTarget = async () => {
    const v = targetDraft.trim()
    setTargetDraft(v)
    try {
      const r = await window.ucMods?.gameSet?.(appid, { deployTarget: v })
      if (r && !r.ok) toast(r.error || "could not save the deploy target", "error")
      else toast("deploy target saved", "success")
    } catch (err) { toast(String(err), "error") }
    void reload()
  }

  // ── installed tab actions ──
  const toggleMod = async (mod: ModEntry, enabled: boolean) => {
    setGs((s) => (s ? { ...s, mods: (s.mods || []).map((m) => (m.id === mod.id ? { ...m, enabled } : m)) } : s))
    try {
      const r = await window.ucMods?.toggle?.(appid, mod.id, enabled)
      if (r && !r.ok) { toast(r.error || "toggle failed", "error"); void reload() }
    } catch (err) { toast(String(err), "error"); void reload() }
  }

  const moveMod = async (index: number, dir: -1 | 1) => {
    const ids = mods.map((m) => m.id)
    const j = index + dir
    if (j < 0 || j >= ids.length) return
    const [id] = ids.splice(index, 1)
    ids.splice(j, 0, id)
    // Optimistic order so the row moves instantly; reorder() redeploys and the
    // mods:changed refresh confirms it.
    setGs((s) => (s ? { ...s, mods: (s.mods || []).map((m) => ({ ...m, order: ids.indexOf(m.id) })) } : s))
    try {
      const r = await window.ucMods?.reorder?.(appid, ids)
      if (r && !r.ok) { toast(r.error || "reorder failed", "error"); void reload() }
    } catch (err) { toast(String(err), "error"); void reload() }
  }

  const [confirmRm, setConfirmRm] = useState<ModEntry | null>(null)
  const [removing, setRemoving] = useState(false)
  const runUninstall = async () => {
    if (!confirmRm) return
    setRemoving(true)
    try {
      const r = await window.ucMods?.uninstall?.(appid, confirmRm.id)
      if (r && !r.ok) toast(r.error || "uninstall failed", "error", 6000)
      else toast(`${confirmRm.name} uninstalled`, "success")
    } catch (err) { toast(String(err), "error", 6000) } finally {
      setRemoving(false)
      setConfirmRm(null)
      void reload()
    }
  }

  const [deployBusy, setDeployBusy] = useState<"deploy" | "undeploy" | null>(null)
  const runDeploy = async () => {
    setDeployBusy("deploy")
    try {
      const r = await window.ucMods?.deploy?.(appid)
      if (r?.ok) toast(`deployed ${r.fileCount ?? 0} file${(r.fileCount ?? 0) === 1 ? "" : "s"}`, "success")
      else toast(r?.error || "deploy failed", "error", 6000)
    } catch (err) { toast(String(err), "error", 6000) } finally { setDeployBusy(null); void reload() }
  }
  const runUndeploy = async () => {
    setDeployBusy("undeploy")
    try {
      const r = await window.ucMods?.undeploy?.(appid)
      if (r?.ok) toast("all mod files removed from the game folder", "success")
      else toast(r?.error || "undeploy failed", "error", 6000)
    } catch (err) { toast(String(err), "error", 6000) } finally { setDeployBusy(null); void reload() }
  }

  const openModsFolder = async () => {
    try {
      const r = await window.ucMods?.openFolder?.(appid)
      if (r && !r.ok) toast(r.error || "could not open the mods folder", "error")
    } catch (err) { toast(String(err), "error") }
  }

  // ── nexus tab ──
  const nexusDomain = gs?.nexusDomain || null
  const [nxCat, setNxCat] = useState<NexusCategory>("trending")
  const [nxQuery, setNxQuery] = useState("")
  const [nxSubmitted, setNxSubmitted] = useState("")
  const [nxMode, setNxMode] = useState<"browse" | "search">("browse")
  const [nxMods, setNxMods] = useState<NexusBrowseMod[]>([])
  const [nxPage, setNxPage] = useState(1)
  const [nxHasMore, setNxHasMore] = useState(false)
  const [nxLoading, setNxLoading] = useState(false)
  const [nxError, setNxError] = useState("")

  const runNexusBrowse = useCallback(async (category: NexusCategory) => {
    if (!nexusDomain) return
    setNxMode("browse"); setNxCat(category); setNxLoading(true); setNxError(""); setNxHasMore(false)
    try {
      const r = await window.ucMods?.nexusBrowse?.(nexusDomain, category)
      if (r?.ok) setNxMods(r.mods || [])
      else { setNxMods([]); setNxError(r?.error || "browse failed") }
    } catch (err) { setNxMods([]); setNxError(String(err)) } finally { setNxLoading(false) }
  }, [nexusDomain])

  const runNexusSearch = useCallback(async (query: string, page: number, append: boolean) => {
    const q = query.trim()
    if (!nexusDomain || !q) return
    setNxMode("search"); setNxSubmitted(q); setNxLoading(true); setNxError("")
    try {
      const r = await window.ucMods?.nexusSearch?.(nexusDomain, q, page)
      if (r?.ok) {
        setNxMods((prev) => (append ? [...prev, ...(r.mods || [])] : r.mods || []))
        setNxHasMore(Boolean(r.hasMore))
        setNxPage(page)
      } else { if (!append) setNxMods([]); setNxError(r?.error || "search failed") }
    } catch (err) { if (!append) setNxMods([]); setNxError(String(err)) } finally { setNxLoading(false) }
  }, [nexusDomain])

  // Seed the browse list once per domain when the tab first opens (and again
  // after a domain override changes which game we're pointed at).
  const nxSeededFor = useRef("")
  useEffect(() => {
    if (tab === "nexus" && nexusDomain && nxSeededFor.current !== nexusDomain) {
      nxSeededFor.current = nexusDomain
      setNxQuery(""); setNxSubmitted("")
      void runNexusBrowse("trending")
    }
  }, [tab, nexusDomain, runNexusBrowse])

  // Nexus file picker → install.
  const [filePick, setFilePick] = useState<NexusBrowseMod | null>(null)
  const [files, setFiles] = useState<NexusModFile[] | null>(null)
  const [filesError, setFilesError] = useState("")
  const [installingFileId, setInstallingFileId] = useState<number | null>(null)

  const openFilePicker = async (mod: NexusBrowseMod) => {
    if (!nexusDomain) return
    setFilePick(mod); setFiles(null); setFilesError("")
    try {
      const r = await window.ucMods?.nexusModFiles?.(nexusDomain, mod.remoteId)
      if (r?.ok) setFiles(r.files || [])
      else setFilesError(r?.error || "could not list the mod's files")
    } catch (err) { setFilesError(String(err)) }
  }

  const installNexus = async (mod: NexusBrowseMod, fileId: number) => {
    if (!nexusDomain) return
    setInstallingFileId(fileId)
    try {
      const r = await window.ucMods?.nexusInstall?.(appid, nexusDomain, mod.remoteId, fileId)
      if (!r?.ok) { toast(r?.error || "install failed", "error", 7000); return }
      setFilePick(null)
      if (r.started) {
        toast(`Downloading ${mod.name}…`, "info")
      } else if (r.needsSession) {
        // Free account, native site-session path. No sessionError means no
        // cookie is configured yet (nudge toward Settings); a sessionError
        // means one was present but got rejected (say why). The sanctioned
        // nxm:// browser flow stays one click away via the toast action.
        const openPage = r.modPageUrl
          ? { label: "Open mod page", onClick: () => void window.ucSystem?.openExternal?.(r.modPageUrl!) }
          : undefined
        const msg = r.sessionError
          ? `Nexus session problem: ${r.sessionError}. Re-copy your nexusmods.com cookies under Settings → Mods, or use “Mod Manager Download” in your browser.`
          : "Free in-app downloads need your Nexus session cookie (Settings → Mods, opt-in). Otherwise use “Mod Manager Download” on the mod page."
        toast(msg, r.sessionError ? "error" : "info", openPage ? { duration: 14000, action: openPage } : 14000)
      } else if (r.needsNxm) {
        // Free account: downloads only start from the website. Open the mod
        // page; the nxm:// deep link routes back into the app.
        if (r.modPageUrl) void window.ucSystem?.openExternal?.(r.modPageUrl)
        toast("Click “Mod Manager Download” on the Nexus page — the download will start here automatically", "info", 12000)
      } else {
        toast(`Downloading ${mod.name}…`, "info")
      }
    } catch (err) { toast(String(err), "error", 7000) } finally { setInstallingFileId(null) }
  }

  // ── workshop tab ──
  const steamAppid = gs?.steamAppid || null
  const workshopOk = Boolean(steamAppid && gs?.workshopSupported)
  const [wsSort, setWsSort] = useState<WorkshopSort>("trend")
  const [wsQuery, setWsQuery] = useState("")
  const [wsSubmitted, setWsSubmitted] = useState("")
  const [wsItems, setWsItems] = useState<WorkshopBrowseItem[]>([])
  const [wsPage, setWsPage] = useState(1)
  const [wsHasMore, setWsHasMore] = useState(false)
  const [wsLoading, setWsLoading] = useState(false)
  const [wsError, setWsError] = useState("")
  const [wsBusy, setWsBusy] = useState<string | null>(null)

  const runWorkshop = useCallback(async (sort: WorkshopSort, query: string, page: number, append: boolean) => {
    if (!steamAppid) return
    setWsLoading(true); setWsError("")
    try {
      const r = await window.ucMods?.workshopBrowse?.(steamAppid, sort, page, query.trim())
      if (r?.ok) {
        setWsItems((prev) => (append ? [...prev, ...(r.items || [])] : r.items || []))
        setWsHasMore(Boolean(r.hasMore))
        setWsPage(page)
      } else { if (!append) setWsItems([]); setWsError(r?.error || "workshop browse failed") }
    } catch (err) { if (!append) setWsItems([]); setWsError(String(err)) } finally { setWsLoading(false) }
  }, [steamAppid])

  const wsSeededFor = useRef(0)
  useEffect(() => {
    if (tab === "workshop" && workshopOk && steamAppid && wsSeededFor.current !== steamAppid) {
      wsSeededFor.current = steamAppid
      void runWorkshop("trend", "", 1, false)
    }
  }, [tab, workshopOk, steamAppid, runWorkshop])

  const installWorkshop = async (item: WorkshopBrowseItem) => {
    if (!steamAppid) return
    setWsBusy(item.remoteId)
    try {
      const r = await window.ucMods?.workshopInstall?.(appid, steamAppid, item.remoteId)
      if (r?.ok) toast(`Installing ${item.name}…`, "info")
      else toast(r?.error || "workshop install failed", "error", 8000)
    } catch (err) { toast(String(err), "error", 8000) } finally { setWsBusy(null) }
  }

  // ── render ──
  const deployTargetLabel = gs?.deployTarget ? gs.deployTarget : "game root"

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <header style={{ flexShrink: 0, padding: "22px 36px 0" }}>
        <button type="button" onClick={() => navigate("/library")} className="mf-textbtn" style={{ display: "flex", alignItems: "center", gap: 7, padding: 0, border: "none", background: "none", color: "var(--mf-t4)", fontFamily: MONO, fontSize: 11, cursor: "pointer" }}>
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 3 4 8 9 13" /><line x1="4" y1="8" x2="13" y2="8" /></svg>
          library
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14 }}>
          <div style={{ width: 40, height: 53, borderRadius: 6, flexShrink: 0, border: "1px solid var(--mf-line-2)", background: navGame?.image ? `center/cover no-repeat url("${proxyImageUrl(navGame.image)}")` : COVER_LINES }} />
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "var(--mf-t0)", letterSpacing: "-0.015em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {gameName}
              <span style={{ marginLeft: 10, fontFamily: MONO, fontSize: 12, fontWeight: 400, color: "var(--mf-t4)", letterSpacing: 0 }}>mods</span>
            </h1>
            <p style={{ margin: "5px 0 0", fontFamily: MONO, fontSize: 11, color: "var(--mf-t4)" }}>
              {loading ? "loading…" : `${mods.length} installed · ${enabledCount} enabled`}
            </p>
          </div>
        </div>

        {/* detected sources + deploy config */}
        {gs && (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 9, marginTop: 14 }}>
            {domainEdit ? (
              <span style={CHIP}>
                <span style={{ color: "var(--mf-t5)" }}>nexus:</span>
                <input
                  autoFocus
                  value={domainDraft}
                  onChange={(e) => setDomainDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void saveDomain(); if (e.key === "Escape") setDomainEdit(false) }}
                  placeholder="e.g. cyberpunk2077"
                  style={{ ...CHIP_INPUT, width: 150 }}
                />
                <button type="button" title="Save" onClick={() => void saveDomain()} style={{ display: "flex", background: "none", border: "none", padding: 0, color: "var(--mf-t2)", cursor: "pointer" }}><Check size={12} strokeWidth={2} /></button>
                <button type="button" title="Cancel" onClick={() => setDomainEdit(false)} style={{ display: "flex", background: "none", border: "none", padding: 0, color: "var(--mf-t4)", cursor: "pointer" }}><X size={12} strokeWidth={2} /></button>
              </span>
            ) : (
              <span style={CHIP} title="NexusMods game domain (the slug in nexusmods.com/<domain>). Auto-detected from the title; override it when the match is wrong.">
                <span style={{ color: "var(--mf-t5)" }}>nexus:</span>
                <span style={{ color: gs.nexusDomain ? "var(--mf-t2)" : "var(--mf-t5)" }}>{gs.nexusDomain || "not matched"}</span>
                {gs.nexusDomain && gs.nexusDomainAuto ? <span style={{ color: "var(--mf-t6)" }}>auto</span> : null}
                <button type="button" title="Override the Nexus domain" onClick={startDomainEdit} style={{ display: "flex", background: "none", border: "none", padding: 0, color: "var(--mf-t4)", cursor: "pointer" }}><Pencil size={11} strokeWidth={1.8} /></button>
              </span>
            )}

            <span style={CHIP} title="Steam Workshop availability, detected from the matched Steam appid">
              <span style={{ color: "var(--mf-t5)" }}>workshop:</span>
              <span style={{ color: workshopOk ? "var(--mf-t2)" : "var(--mf-t5)" }}>{workshopOk ? `appid ${steamAppid}` : "unavailable"}</span>
            </span>

            <span style={CHIP} title="Whether enabled mod files are currently copied into the game folder">
              <span style={{ width: 6, height: 6, borderRadius: 99, background: gs.deployed ? "var(--mf-t1)" : "color-mix(in srgb, var(--mf-t0) 18%, transparent)", flexShrink: 0 }} />
              {gs.deployed ? "deployed" : "not deployed"}
            </span>

            <span style={CHIP} title="Subfolder inside the game files dir where enabled mods are copied. Leave empty to deploy into the game root.">
              <span style={{ color: "var(--mf-t5)" }}>deploy to:</span>
              <input
                value={targetDraft}
                onChange={(e) => setTargetDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && targetDirty) void saveTarget() }}
                placeholder="game root"
                style={{ ...CHIP_INPUT, width: 130 }}
              />
              {targetDirty ? (
                <button type="button" title="Save deploy target (undeploys from the old target first)" onClick={() => void saveTarget()} style={{ display: "flex", background: "none", border: "none", padding: 0, color: "var(--mf-t2)", cursor: "pointer" }}><Check size={12} strokeWidth={2} /></button>
              ) : null}
            </span>
          </div>
        )}

        {/* tab rail */}
        <div style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--mf-line)", marginTop: 18 }}>
          {TABS.map((t) => {
            const active = tab === t.id
            return (
              <button key={t.id} type="button" onClick={() => setTab(t.id)} style={{ padding: "10px 15px", background: "none", border: "none", borderBottom: `2px solid ${active ? "var(--mf-t0)" : "transparent"}`, marginBottom: -1, color: active ? "var(--mf-t0)" : "var(--mf-t4)", fontSize: 13, fontWeight: active ? 600 : 500, cursor: "pointer" }}>
                {t.label}
                {t.id === "installed" && mods.length > 0 ? <span style={{ marginLeft: 7, fontFamily: MONO, fontSize: 10, color: "var(--mf-t5)" }}>{mods.length}</span> : null}
              </button>
            )
          })}
        </div>
      </header>

      <div className="mf-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px 36px 48px" }}>
        {/* live install progress */}
        {activeProgress.map((p) => (
          <div key={p.modId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", marginBottom: 12 }}>
            <Spinner size={13} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontFamily: MONO, fontSize: 11, color: "var(--mf-t2)" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name || p.modId}</span>
                <span style={{ color: "var(--mf-t4)", flexShrink: 0 }}>{p.phase}{p.progress != null ? ` · ${Math.round(p.progress)}%` : ""}</span>
              </div>
              <div style={{ marginTop: 7, height: 3, borderRadius: 99, background: "color-mix(in srgb, var(--mf-t0) 10%, transparent)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${p.progress != null ? Math.max(2, Math.min(100, p.progress)) : 100}%`, background: "var(--mf-t1)", opacity: p.progress != null ? 1 : 0.35, transition: "width .3s ease" }} />
              </div>
            </div>
          </div>
        ))}

        {loading ? (
          <CenterState><Spinner size={18} /></CenterState>
        ) : loadError || !gs ? (
          <CenterState>
            <Puzzle size={30} strokeWidth={1.4} color="var(--mf-t6)" />
            <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--mf-t5)", maxWidth: 480, textAlign: "center" }}>{loadError || "could not load mod state"}</span>
            <button type="button" className="mf-ghost" style={GHOST_BTN} onClick={() => { setLoading(true); void reload() }}><RefreshCw size={13} strokeWidth={1.7} />Retry</button>
          </CenterState>
        ) : tab === "installed" ? (
          <>
            {/* actions */}
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 9, marginBottom: 16 }}>
              <button type="button" className="mf-ghost" style={GHOST_BTN} onClick={() => void openModsFolder()}>
                <FolderOpen size={13} strokeWidth={1.7} />Open mods folder
              </button>
              <button type="button" className="mf-ghost" style={{ ...GHOST_BTN, opacity: deployBusy || mods.length === 0 ? 0.55 : 1 }} disabled={Boolean(deployBusy) || mods.length === 0} onClick={() => void runDeploy()}>
                {deployBusy === "deploy" ? <Spinner size={13} /> : <Rocket size={13} strokeWidth={1.7} />}Deploy
              </button>
              <button type="button" className="mf-ghost" style={{ ...GHOST_BTN, opacity: deployBusy || !gs.deployed ? 0.55 : 1 }} disabled={Boolean(deployBusy) || !gs.deployed} onClick={() => void runUndeploy()}>
                {deployBusy === "undeploy" ? <Spinner size={13} /> : <Undo2 size={13} strokeWidth={1.7} />}Undeploy
              </button>
              <span style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--mf-t5)" }}>
                {gs.deployed ? `deployed to ${deployTargetLabel}` : "changes deploy automatically on install / toggle / reorder"}
              </span>
            </div>

            {mods.length === 0 ? (
              <CenterState>
                <Package size={30} strokeWidth={1.4} color="var(--mf-t6)" />
                <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--mf-t5)" }}>no mods installed yet — grab some from the Nexus or Workshop tabs</span>
              </CenterState>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {mods.map((m, i) => (
                  <div key={m.id} className="mf-listrow" style={{ display: "flex", alignItems: "center", gap: 13, padding: "10px 13px", borderRadius: 10, border: "1px solid var(--mf-line)", background: "var(--mf-panel)" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3, flexShrink: 0 }}>
                      <ArrowBtn dir="up" disabled={i === 0} onClick={() => void moveMod(i, -1)} />
                      <ArrowBtn dir="down" disabled={i === mods.length - 1} onClick={() => void moveMod(i, 1)} />
                    </div>
                    <Switch checked={m.enabled} onCheckedChange={(v) => void toggleMod(m, v)} aria-label={`${m.enabled ? "Disable" : "Enable"} ${m.name}`} />
                    <div style={{ width: 34, height: 34, borderRadius: 6, flexShrink: 0, border: "1px solid var(--mf-line-2)", background: m.picture ? `center/cover no-repeat url("${proxyImageUrl(m.picture)}")` : COVER_LINES }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                        <span title={m.name} style={{ fontSize: 13, fontWeight: 600, color: m.enabled ? "var(--mf-t1)" : "var(--mf-t4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</span>
                        <span style={{ padding: "2px 8px", borderRadius: 999, border: "1px solid var(--mf-line-2)", fontFamily: MONO, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.09em", color: "var(--mf-t3)", flexShrink: 0 }}>{m.provider}</span>
                      </div>
                      <div style={{ marginTop: 3, fontFamily: MONO, fontSize: 10, color: "var(--mf-t5)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {[m.version ? `v${m.version}` : "", m.author, fmtBytes(m.sizeBytes), fmtDate(m.installedAt)].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <button type="button" title={`Uninstall ${m.name}`} onClick={() => setConfirmRm(m)} className="mf-ghost" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t4)", cursor: "pointer", flexShrink: 0 }}>
                      <Trash2 size={13} strokeWidth={1.7} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : tab === "nexus" ? (
          !nexusDomain ? (
            <CenterState>
              <Puzzle size={30} strokeWidth={1.4} color="var(--mf-t6)" />
              <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--mf-t5)", maxWidth: 520, textAlign: "center", lineHeight: 1.6 }}>
                NexusMods isn't matched for this game. Add your API key under Settings → Mods, and if the title wasn't auto-matched set the game's Nexus domain (the slug in the mod page URL) with the chip above.
              </span>
              <div style={{ display: "flex", gap: 9 }}>
                <button type="button" className="mf-ghost" style={GHOST_BTN} onClick={() => navigate("/settings")}>Open Settings</button>
                <button type="button" className="mf-ghost" style={GHOST_BTN} onClick={startDomainEdit}><Pencil size={12} strokeWidth={1.7} />Set domain override</button>
              </div>
            </CenterState>
          ) : (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 16 }}>
                {NEXUS_CATEGORIES.map((c) => {
                  const active = nxMode === "browse" && nxCat === c.id
                  return (
                    <button key={c.id} type="button" onClick={() => void runNexusBrowse(c.id)} style={{ padding: "6px 13px", borderRadius: 999, fontSize: 11.5, fontWeight: 500, border: `1px solid ${active ? "var(--mf-line-2)" : "color-mix(in srgb, var(--mf-t0) 9%, transparent)"}`, background: active ? "color-mix(in srgb, var(--mf-t0) 10%, transparent)" : "transparent", color: active ? "var(--mf-t0)" : "var(--mf-t4)", cursor: "pointer", whiteSpace: "nowrap" }}>{c.label}</button>
                  )
                })}
                <div style={{ position: "relative", flex: 1, minWidth: 220, maxWidth: 340, marginLeft: "auto" }}>
                  <SearchIcon size={13} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
                  <input
                    value={nxQuery}
                    onChange={(e) => setNxQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void runNexusSearch(nxQuery, 1, false)
                      if (e.key === "Escape") setNxQuery("")
                    }}
                    placeholder={`search ${nexusDomain} mods… (Enter)`}
                    style={SEARCH_INPUT}
                  />
                </div>
              </div>

              {nxError ? (
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderRadius: 10, border: "1px solid color-mix(in srgb, var(--mf-danger) 35%, transparent)", background: "color-mix(in srgb, var(--mf-danger) 7%, transparent)", marginBottom: 14 }}>
                  <span style={{ flex: 1, fontFamily: MONO, fontSize: 11.5, color: "var(--mf-t2)" }}>{nxError}</span>
                  <button type="button" className="mf-ghost" style={{ ...GHOST_BTN, height: 30, fontSize: 11.5 }} onClick={() => navigate("/settings")}>Open Settings</button>
                </div>
              ) : null}

              {nxLoading && nxMods.length === 0 ? (
                <CenterState><Spinner size={18} /></CenterState>
              ) : nxMods.length === 0 && !nxError ? (
                <CenterState>
                  <Package size={30} strokeWidth={1.4} color="var(--mf-t6)" />
                  <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--mf-t5)" }}>{nxMode === "search" ? `nothing found for “${nxSubmitted}”` : "nothing here"}</span>
                </CenterState>
              ) : (
                <>
                  <div style={GRID}>
                    {nxMods.map((mod) => (
                      <BrowseCard
                        key={mod.remoteId}
                        picture={mod.picture}
                        name={mod.name}
                        author={mod.author}
                        metaLine={`${formatNumber(mod.downloads || 0)} downloads · ${formatNumber(mod.endorsements || 0)} endorsements`}
                        installed={mod.installed || installedIds.has(`nexus-${mod.remoteId}`)}
                        busy={filePick?.remoteId === mod.remoteId}
                        onInstall={() => void openFilePicker(mod)}
                      />
                    ))}
                  </div>
                  {nxMode === "search" && nxHasMore ? (
                    <div style={{ display: "flex", justifyContent: "center", marginTop: 18 }}>
                      <button type="button" className="mf-ghost" style={{ ...GHOST_BTN, opacity: nxLoading ? 0.6 : 1 }} disabled={nxLoading} onClick={() => void runNexusSearch(nxSubmitted, nxPage + 1, true)}>
                        {nxLoading ? <Spinner size={13} /> : null}Load more
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </>
          )
        ) : (
          /* workshop */
          !workshopOk ? (
            <CenterState>
              <Package size={30} strokeWidth={1.4} color="var(--mf-t6)" />
              <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--mf-t5)", maxWidth: 480, textAlign: "center", lineHeight: 1.6 }}>
                {steamAppid
                  ? "this game doesn't support the Steam Workshop"
                  : "no Steam appid could be matched for this game, so the Workshop is unavailable"}
              </span>
            </CenterState>
          ) : (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <select
                  className="uc-select"
                  value={wsSort}
                  onChange={(e) => { const v = e.target.value as WorkshopSort; setWsSort(v); void runWorkshop(v, wsSubmitted, 1, false) }}
                  style={{ height: 36, minWidth: 160, padding: "0 32px 0 13px", borderRadius: 9, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", color: "var(--mf-t1)", fontSize: 12, cursor: "pointer", WebkitAppearance: "none", appearance: "none" }}
                >
                  {WS_SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <div style={{ position: "relative", flex: 1, minWidth: 220, maxWidth: 340, marginLeft: "auto" }}>
                  <SearchIcon size={13} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
                  <input
                    value={wsQuery}
                    onChange={(e) => setWsQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { setWsSubmitted(wsQuery); void runWorkshop(wsSort, wsQuery, 1, false) }
                      if (e.key === "Escape") setWsQuery("")
                    }}
                    placeholder="search the workshop… (Enter)"
                    style={SEARCH_INPUT}
                  />
                </div>
              </div>

              {wsError ? (
                <div style={{ padding: "11px 14px", borderRadius: 10, border: "1px solid color-mix(in srgb, var(--mf-danger) 35%, transparent)", background: "color-mix(in srgb, var(--mf-danger) 7%, transparent)", marginBottom: 14, fontFamily: MONO, fontSize: 11.5, color: "var(--mf-t2)" }}>{wsError}</div>
              ) : null}

              {wsLoading && wsItems.length === 0 ? (
                <CenterState><Spinner size={18} /></CenterState>
              ) : wsItems.length === 0 && !wsError ? (
                <CenterState>
                  <Package size={30} strokeWidth={1.4} color="var(--mf-t6)" />
                  <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--mf-t5)" }}>{wsSubmitted ? `nothing found for “${wsSubmitted}”` : "nothing here"}</span>
                </CenterState>
              ) : (
                <>
                  <div style={GRID}>
                    {wsItems.map((item) => (
                      <BrowseCard
                        key={item.remoteId}
                        picture={item.picture}
                        name={item.name}
                        author={item.author}
                        installed={installedIds.has(`workshop-${item.remoteId}`)}
                        busy={wsBusy === item.remoteId}
                        onInstall={() => void installWorkshop(item)}
                      />
                    ))}
                  </div>
                  {wsHasMore ? (
                    <div style={{ display: "flex", justifyContent: "center", marginTop: 18 }}>
                      <button type="button" className="mf-ghost" style={{ ...GHOST_BTN, opacity: wsLoading ? 0.6 : 1 }} disabled={wsLoading} onClick={() => void runWorkshop(wsSort, wsSubmitted, wsPage + 1, true)}>
                        {wsLoading ? <Spinner size={13} /> : null}Load more
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </>
          )
        )}
      </div>

      {/* uninstall confirm */}
      <Dialog open={Boolean(confirmRm)} onOpenChange={(open) => { if (!open && !removing) setConfirmRm(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Uninstall {confirmRm?.name}?</DialogTitle>
            <DialogDescription>
              Removes the mod's staged files and redeploys the game folder without it. You can reinstall it from the {confirmRm?.provider === "workshop" ? "Workshop" : "Nexus"} tab later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={removing} onClick={() => setConfirmRm(null)}>Cancel</Button>
            <Button variant="destructive" disabled={removing} onClick={() => void runUninstall()}>{removing ? "Uninstalling…" : "Uninstall"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* nexus file picker */}
      <Dialog open={Boolean(filePick)} onOpenChange={(open) => { if (!open && installingFileId == null) setFilePick(null) }}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Install {filePick?.name}</DialogTitle>
            <DialogDescription>Pick which file to download and install.</DialogDescription>
          </DialogHeader>
          {files == null && !filesError ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "28px 0" }}><Spinner size={16} /></div>
          ) : filesError ? (
            <div style={{ fontFamily: MONO, fontSize: 11.5, color: "var(--mf-t3)", padding: "8px 0" }}>{filesError}</div>
          ) : files && files.length === 0 ? (
            <div style={{ fontFamily: MONO, fontSize: 11.5, color: "var(--mf-t4)", padding: "8px 0" }}>this mod has no downloadable files</div>
          ) : (
            <div className="mf-scroll" style={{ maxHeight: 380, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, margin: "4px 0" }}>
              {(files || []).map((f) => (
                <div key={f.fileId} className="mf-listrow" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--mf-line)", background: "var(--mf-panel)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <span title={f.name} style={{ fontSize: 12.5, fontWeight: 600, color: "var(--mf-t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.name}</span>
                      {f.category ? <span style={{ padding: "1px 7px", borderRadius: 999, border: "1px solid var(--mf-line-2)", fontFamily: MONO, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--mf-t4)", flexShrink: 0 }}>{f.category}</span> : null}
                    </div>
                    <div style={{ marginTop: 3, fontFamily: MONO, fontSize: 10, color: "var(--mf-t5)" }}>
                      {[f.version ? `v${f.version}` : "", fmtBytes(f.sizeBytes), fmtDate(f.uploadedAt)].filter(Boolean).join(" · ")}
                    </div>
                    {f.description ? <div style={{ marginTop: 4, fontSize: 11, color: "var(--mf-t4)", lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{f.description}</div> : null}
                  </div>
                  <button
                    type="button"
                    className="mf-ghost"
                    disabled={installingFileId != null}
                    onClick={() => { if (filePick) void installNexus(filePick, f.fileId) }}
                    style={{ ...GHOST_BTN, height: 30, fontSize: 11.5, flexShrink: 0, opacity: installingFileId != null && installingFileId !== f.fileId ? 0.5 : 1 }}
                  >
                    {installingFileId === f.fileId ? <Spinner size={12} /> : <Download size={12} strokeWidth={1.8} />}
                    Install
                  </button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
