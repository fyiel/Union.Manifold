import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties, ReactNode } from "react"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import {
  ArrowDown, ArrowUp, Check, Download, FolderOpen, Globe, Package, Pencil, Puzzle, RefreshCw, Rocket, Trash2, Undo2, X,
} from "lucide-react"
import { CenterState, COVER_LINES, MONO, SearchIcon, Spinner, SELECT_BASE } from "@/app/manifold/ui"
import { formatNumber, proxyImageUrl } from "@/lib/utils"
import { useToast } from "@/context/toast-context"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type Tab = "installed" | "nexus" | "workshop" | "thunderstore"

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "installed", label: "Installed" },
  { id: "nexus", label: "Nexus" },
  { id: "workshop", label: "Workshop" },
  { id: "thunderstore", label: "Thunderstore" },
]

const NEXUS_SORTS = [
  { id: "downloads", label: "Most downloaded" },
  { id: "updated", label: "Recently updated" },
  { id: "published", label: "Recently published" },
  { id: "size", label: "File size" },
  { id: "endorsements", label: "Endorsements" },
  { id: "lastComment", label: "Last comment" },
] as const
type NexusSort = (typeof NEXUS_SORTS)[number]["id"]

const WORKSHOP_SORTS = [
  { id: "trend", label: "Popular" },
  { id: "mostrecent", label: "Most recent" },
  { id: "lastupdated", label: "Last updated" },
  { id: "subscribers", label: "Most subscribed" },
  { id: "toprated", label: "Top rated" },
] as const
type WorkshopSort = (typeof WORKSHOP_SORTS)[number]["id"]

const THUNDERSTORE_SORTS = [
  { id: "downloads", label: "Most downloaded" },
  { id: "updated", label: "Recently updated" },
  { id: "published", label: "Newest" },
  { id: "rating", label: "Top rated" },
] as const
type ThunderstoreSort = (typeof THUNDERSTORE_SORTS)[number]["id"]

const PERIODS = [
  { id: "all", label: "All time" },
  { id: "28", label: "Last 28 days" },
  { id: "7", label: "Last 7 days" },
] as const
type Period = (typeof PERIODS)[number]["id"]

const GHOST_BTN: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "0 13px", height: 34, borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t1)", fontSize: 12, fontWeight: 600, cursor: "pointer" }
const CHIP: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 11px", borderRadius: 999, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", fontFamily: MONO, fontSize: 10.5, color: "var(--mf-t3)" }
const CHIP_INPUT: CSSProperties = { background: "transparent", border: "none", outline: "none", color: "var(--mf-t1)", fontFamily: MONO, fontSize: 10.5, padding: 0 }
const SEARCH_INPUT: CSSProperties = { width: "100%", height: 36, padding: "0 12px 0 34px", borderRadius: 9, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", color: "var(--mf-t1)", fontFamily: MONO, fontSize: 12, outline: "none" }
const SELECT: CSSProperties = { ...SELECT_BASE, minWidth: 150, borderRadius: 9, fontSize: 12 }
const GRID: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 14, alignContent: "start" }

function fmtBytes(n?: number | null): string {
  if (!n || n <= 0) return ""
  const u = ["B", "KB", "MB", "GB"]
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`
}

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

type BrowsePage<T> = { ok: boolean; items?: T[]; hasMore?: boolean; error?: string }

type EndlessBrowse<T> = {
  items: T[]
  loading: boolean
  error: string
  hasMore: boolean
  sentinelRef: (el: HTMLDivElement | null) => void
}

function useEndlessBrowse<T>(config: {
  enabled: boolean
  resetKey: string
  keyOf: (item: T) => string
  fetchPage: (page: number) => Promise<BrowsePage<T>>
}): EndlessBrowse<T> {
  const { enabled, resetKey } = config
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState("")

  const cfgRef = useRef(config)
  cfgRef.current = config
  const pageRef = useRef(0)
  const genRef = useRef(0)
  const busyRef = useRef(false)
  const sentinelElRef = useRef<HTMLDivElement | null>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)

  const fetchNext = useCallback(async () => {
    const cfg = cfgRef.current
    if (!cfg.enabled || busyRef.current) return
    busyRef.current = true
    setLoading(true)
    setError("")
    const gen = genRef.current
    const page = pageRef.current
    try {
      const r = await cfg.fetchPage(page)
      if (gen !== genRef.current) return
      if (!r || !r.ok) { setError(r?.error || "browse failed"); setHasMore(false); return }
      pageRef.current = page + 1
      setItems((prev) => {
        const have = new Set(prev.map((p) => cfg.keyOf(p)))
        const next = prev.slice()
        for (const it of r.items || []) {
          const k = cfg.keyOf(it)
          if (have.has(k)) continue
          have.add(k)
          next.push(it)
        }
        return next
      })
      setHasMore(Boolean(r.hasMore))
    } catch (err) {
      if (gen !== genRef.current) return
      setError(String(err)); setHasMore(false)
    } finally {
      if (gen === genRef.current) { busyRef.current = false; setLoading(false) }
    }
  }, [])

  useEffect(() => {
    genRef.current += 1
    pageRef.current = 0
    busyRef.current = false
    setItems([]); setHasMore(false); setError(""); setLoading(false)
    if (enabled) void fetchNext()
  }, [enabled, resetKey, fetchNext])

  const sentinelRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    sentinelElRef.current = el
    if (!el) return
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !busyRef.current) void fetchNext()
    }, { rootMargin: "320px" })
    obs.observe(el)
    observerRef.current = obs
  }, [fetchNext])

  useEffect(() => () => observerRef.current?.disconnect(), [])

  useEffect(() => {
    if (!enabled || !hasMore || loading || busyRef.current) return
    const el = sentinelElRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const viewport = window.innerHeight || document.documentElement.clientHeight
    if (rect.top <= viewport + 320) void fetchNext()
  }, [enabled, hasMore, loading, items.length, fetchNext])

  return { items, loading, error, hasMore, sentinelRef }
}

function BrowseResults<T>({ browse, renderCard, emptyLabel, errorAction }: {
  browse: EndlessBrowse<T>
  renderCard: (item: T) => ReactNode
  emptyLabel: string
  errorAction?: { label: string; onClick: () => void }
}) {
  const { items, loading, error, hasMore, sentinelRef } = browse
  if (loading && items.length === 0) return <CenterState><Spinner size={18} /></CenterState>
  if (error && items.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderRadius: 10, border: "1px solid color-mix(in srgb, var(--mf-danger) 35%, transparent)", background: "color-mix(in srgb, var(--mf-danger) 7%, transparent)" }}>
        <span style={{ flex: 1, fontFamily: MONO, fontSize: 11.5, color: "var(--mf-t2)" }}>{error}</span>
        {errorAction ? <button type="button" className="mf-ghost" style={{ ...GHOST_BTN, height: 30, fontSize: 11.5 }} onClick={errorAction.onClick}>{errorAction.label}</button> : null}
      </div>
    )
  }
  if (items.length === 0) {
    return (
      <CenterState>
        <Package size={30} strokeWidth={1.4} color="var(--mf-t6)" />
        <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--mf-t5)" }}>{emptyLabel}</span>
      </CenterState>
    )
  }
  return (
    <>
      <div style={GRID}>{items.map(renderCard)}</div>
      {hasMore ? <div ref={sentinelRef} aria-hidden style={{ height: 1 }} /> : null}
      {loading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, padding: "18px 0 4px", fontFamily: MONO, fontSize: 11, color: "var(--mf-t4)" }}>
          <Spinner size={13} />loading more…
        </div>
      ) : !hasMore ? (
        <div style={{ textAlign: "center", padding: "18px 0 4px", fontFamily: MONO, fontSize: 10.5, color: "var(--mf-t6)" }}>no more results</div>
      ) : null}
      {error ? <div style={{ textAlign: "center", padding: "10px 0 0", fontFamily: MONO, fontSize: 10.5, color: "var(--mf-danger)" }}>{error}</div> : null}
    </>
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

  useEffect(() => window.ucMods?.onChanged?.((d) => { if (d?.appid === appid) void reload() }), [appid, reload])

  const [progress, setProgress] = useState<Map<string, ModInstallProgress>>(new Map())
  useEffect(() => {
    const offProgress = window.ucMods?.onInstallProgress?.((p) => {
      if (!p || p.appid !== appid) return
      if (p.phase === "done" || p.phase === "error") {
        setProgress((m) => { const next = new Map(m); next.delete(p.modId); return next })
        if (p.phase === "done") toast(`${p.name || "Mod"} installed`, "success")
        else toast(`${p.name || "Mod"}: ${p.error }`, "error", 7000)
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
  const enabledCount = useMemo(() => mods.filter((m) => m.enabled && !m.deployBlocked).length, [mods])
  const launchManaged = gs?.steamAppid === 686060
  const compatibleLoaders = useMemo(
    () => (gs?.loaderCompatibility || []).filter((loader) => loader.compatible),
    [gs],
  )
  const uncertainMods = useMemo(() => mods.filter((m) => m.deployConfidence === "low" && !m.deployBlocked), [mods])
  const blockedMods = useMemo(() => mods.filter((m) => m.deployBlocked), [mods])

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
  const saveTarget = async (value?: string) => {
    const v = (value ?? targetDraft).trim()
    setTargetDraft(v)
    try {
      const r = await window.ucMods?.gameSet?.(appid, { deployTarget: v })
      if (r && !r.ok) toast(r.error || "could not save the deploy target", "error")
      else toast("deploy target saved", "success")
    } catch (err) { toast(String(err), "error") }
    void reload()
  }
  const pickTarget = async () => {
    try {
      const r = await window.ucMods?.deployTargetPick?.(appid)
      if (!r || !r.ok) { if (r?.error) toast(r.error, "error"); return }
      await saveTarget(r.target || "")
    } catch (err) { toast(String(err), "error") }
  }

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
      if (r?.ok) toast(launchManaged
        ? `activated ${r.fileCount ?? 0} mod${(r.fileCount ?? 0) === 1 ? "" : "s"} for launch`
        : `deployed ${r.fileCount ?? 0} file${(r.fileCount ?? 0) === 1 ? "" : "s"}`, "success")
      else toast(r?.error || "deploy failed", "error", 6000)
    } catch (err) { toast(String(err), "error", 6000) } finally { setDeployBusy(null); void reload() }
  }
  const runUndeploy = async () => {
    setDeployBusy("undeploy")
    try {
      const r = await window.ucMods?.undeploy?.(appid)
      if (r?.ok) toast(launchManaged ? "mods deactivated for launch" : "all mod files removed from the game folder", "success")
      else toast(r?.error || "undeploy failed", "error", 6000)
    } catch (err) { toast(String(err), "error", 6000) } finally { setDeployBusy(null); void reload() }
  }

  const openModsFolder = async () => {
    try {
      const r = await window.ucMods?.openFolder?.(appid)
      if (r && !r.ok) toast(r.error || "could not open the mods folder", "error")
    } catch (err) { toast(String(err), "error") }
  }

  const nexusDomain = gs?.nexusDomain || null
  const [nxSort, setNxSort] = useState<NexusSort>("downloads")
  const [nxOrder, setNxOrder] = useState<"asc" | "desc">("desc")
  const [nxPeriod, setNxPeriod] = useState<Period>("all")
  const [nxQuery, setNxQuery] = useState("")
  const [nxSubmitted, setNxSubmitted] = useState("")
  const [nxActive, setNxActive] = useState(false)
  useEffect(() => { if (tab === "nexus") setNxActive(true) }, [tab])

  const nexusFetch = useCallback(async (page: number): Promise<BrowsePage<BrowseMod>> => {
    if (!nexusDomain) return { ok: false, error: "Nexus is not matched for this game" }
    const q = nxSubmitted.trim()
    const r = q
      ? await window.ucMods?.nexusSearch?.(nexusDomain, q, page + 1)
      : await window.ucMods?.nexusBrowse?.(nexusDomain, nxSort, nxOrder, nxPeriod, page * 24)
    if (!r) return { ok: false, error: "mods backend unavailable" }
    return { ok: !!r.ok, items: r.mods, hasMore: r.hasMore, error: r.error }
  }, [nexusDomain, nxSubmitted, nxSort, nxOrder, nxPeriod])

  const nexusBrowse = useEndlessBrowse<BrowseMod>({
    enabled: nxActive && !!nexusDomain,
    resetKey: `nexus|${nexusDomain || ""}|${nxSubmitted}|${nxSort}|${nxOrder}|${nxPeriod}`,
    keyOf: (m) => m.remoteId,
    fetchPage: nexusFetch,
  })

  const [filePick, setFilePick] = useState<BrowseMod | null>(null)
  const [files, setFiles] = useState<NexusModFile[] | null>(null)
  const [filesError, setFilesError] = useState("")
  const [installingFileId, setInstallingFileId] = useState<number | null>(null)

  const openFilePicker = async (mod: BrowseMod) => {
    if (!nexusDomain) return
    setFilePick(mod); setFiles(null); setFilesError("")
    try {
      const r = await window.ucMods?.nexusModFiles?.(nexusDomain, mod.remoteId)
      if (r?.ok) setFiles(r.files || [])
      else setFilesError(r?.error || "could not list the mod's files")
    } catch (err) { setFilesError(String(err)) }
  }

  const installNexus = async (mod: BrowseMod, fileId: number) => {
    if (!nexusDomain) return
    setInstallingFileId(fileId)
    try {
      const r = await window.ucMods?.nexusInstall?.(appid, nexusDomain, mod.remoteId, fileId)
      if (!r?.ok) { toast(r?.error || "install failed", "error", 7000); return }
      setFilePick(null)
      if (r.started) {
        toast(`Downloading ${mod.name}…`, "info")
      } else if (r.needsSession) {
        const openPage = r.modPageUrl
          ? { label: "Open mod page", onClick: () => void window.ucSystem?.openExternal?.(r.modPageUrl!) }
          : undefined
        const msg = r.sessionError
          ? `Nexus session problem: ${r.sessionError}. Re-copy your nexusmods.com cookies under Settings → Mods, or use “Mod Manager Download” in your browser.`
          : "Free in-app downloads need your Nexus session cookie (Settings → Mods, opt-in). Otherwise use “Mod Manager Download” on the mod page."
        toast(msg, r.sessionError ? "error" : "info", openPage ? { duration: 14000, action: openPage } : 14000)
      } else if (r.needsNxm) {
        if (r.modPageUrl) void window.ucSystem?.openExternal?.(r.modPageUrl)
        const base = r.slipgateError
          ? `Slipgate could not resolve this: ${r.slipgateError}. Falling back: click “Mod Manager Download” on the Nexus page.`
          : "Click “Mod Manager Download” on the Nexus page — the download will start here automatically"
        toast(base, r.slipgateError ? "error" : "info", r.slipgateError ? 14000 : 12000)
      }
    } catch (err) { toast(String(err), "error", 7000) } finally { setInstallingFileId(null) }
  }

  const steamAppid = gs?.steamAppid || null
  const workshopOk = Boolean(steamAppid && gs?.workshopSupported)
  const [wsSort, setWsSort] = useState<WorkshopSort>("trend")
  const [wsPeriod, setWsPeriod] = useState<Period>("all")
  const [wsQuery, setWsQuery] = useState("")
  const [wsSubmitted, setWsSubmitted] = useState("")
  const [wsActive, setWsActive] = useState(false)
  const [wsBusy, setWsBusy] = useState<string | null>(null)
  useEffect(() => { if (tab === "workshop") setWsActive(true) }, [tab])

  const workshopFetch = useCallback(async (page: number): Promise<BrowsePage<WorkshopBrowseItem>> => {
    if (!steamAppid) return { ok: false, error: "no Steam appid" }
    const r = await window.ucMods?.workshopBrowse?.(steamAppid, wsSort, wsPeriod, page + 1, wsSubmitted.trim())
    if (!r) return { ok: false, error: "mods backend unavailable" }
    return { ok: !!r.ok, items: r.items, hasMore: r.hasMore, error: r.error }
  }, [steamAppid, wsSort, wsPeriod, wsSubmitted])

  const workshopBrowse = useEndlessBrowse<WorkshopBrowseItem>({
    enabled: wsActive && workshopOk,
    resetKey: `ws|${steamAppid || ""}|${wsSort}|${wsPeriod}|${wsSubmitted}`,
    keyOf: (m) => m.remoteId,
    fetchPage: workshopFetch,
  })

  const installWorkshop = async (item: WorkshopBrowseItem) => {
    if (!steamAppid) return
    setWsBusy(item.remoteId)
    try {
      const r = await window.ucMods?.workshopInstall?.(appid, steamAppid, item.remoteId)
      if (r?.ok) toast(`Installing ${item.name}…`, "info")
      else toast(r?.error || "workshop install failed", "error", 8000)
    } catch (err) { toast(String(err), "error", 8000) } finally { setWsBusy(null) }
  }

  const tsCommunity = gs?.thunderstoreCommunity || null
  const tsSupported = Boolean(gs?.thunderstoreSupported && tsCommunity)
  const [tsSort, setTsSort] = useState<ThunderstoreSort>("downloads")
  const [tsPeriod, setTsPeriod] = useState<Period>("all")
  const [tsQuery, setTsQuery] = useState("")
  const [tsSubmitted, setTsSubmitted] = useState("")
  const [tsActive, setTsActive] = useState(false)
  useEffect(() => { if (tab === "thunderstore") setTsActive(true) }, [tab])

  const thunderstoreFetch = useCallback(async (page: number): Promise<BrowsePage<BrowseMod>> => {
    if (!tsCommunity) return { ok: false, error: "no Thunderstore community" }
    const r = await window.ucMods?.thunderstoreBrowse?.(tsCommunity, tsSort, tsPeriod, page + 1, tsSubmitted.trim())
    if (!r) return { ok: false, error: "mods backend unavailable" }
    return { ok: !!r.ok, items: r.mods, hasMore: r.hasMore, error: r.error }
  }, [tsCommunity, tsSort, tsPeriod, tsSubmitted])

  const thunderstoreBrowse = useEndlessBrowse<BrowseMod>({
    enabled: tsActive && tsSupported,
    resetKey: `ts|${tsCommunity || ""}|${tsSort}|${tsPeriod}|${tsSubmitted}`,
    keyOf: (m) => m.remoteId,
    fetchPage: thunderstoreFetch,
  })

  const [tsCommunities, setTsCommunities] = useState<ThunderstoreCommunity[] | null>(null)
  const [tsCommLoading, setTsCommLoading] = useState(false)
  const [tsCommError, setTsCommError] = useState("")
  const [tsCommPick, setTsCommPick] = useState("")
  const [tsSaving, setTsSaving] = useState(false)

  const loadCommunities = useCallback(async () => {
    setTsCommLoading(true); setTsCommError("")
    try {
      const r = await window.ucMods?.thunderstoreCommunities?.()
      if (r?.ok) setTsCommunities(r.communities || [])
      else { setTsCommunities([]); setTsCommError(r?.error || "could not load the community list") }
    } catch (err) { setTsCommunities([]); setTsCommError(String(err)) } finally { setTsCommLoading(false) }
  }, [])

  useEffect(() => {
    if (tab === "thunderstore" && !tsSupported && tsCommunities === null && !tsCommLoading) void loadCommunities()
  }, [tab, tsSupported, tsCommunities, tsCommLoading, loadCommunities])

  const saveCommunity = async (identifier: string) => {
    if (!identifier) return
    setTsSaving(true)
    try {
      const r = await window.ucMods?.gameSet?.(appid, { thunderstoreCommunity: identifier })
      if (r && !r.ok) toast(r.error || "failed", "error")
    } catch (err) { toast(String(err), "error") } finally { setTsSaving(false); void reload() }
  }

  const [tsVersionPick, setTsVersionPick] = useState<BrowseMod | null>(null)
  const [tsVersions, setTsVersions] = useState<ThunderstoreVersion[] | null>(null)
  const [tsVersionsError, setTsVersionsError] = useState("")
  const [tsInstalling, setTsInstalling] = useState<string | null>(null)

  const openTsVersions = async (mod: BrowseMod) => {
    if (!tsCommunity) return
    setTsVersionPick(mod); setTsVersions(null); setTsVersionsError("")
    try {
      const r = await window.ucMods?.thunderstoreVersions?.(tsCommunity, mod.remoteId)
      if (r?.ok) setTsVersions(r.versions || [])
      else setTsVersionsError(r?.error || "could not list the package versions")
    } catch (err) { setTsVersionsError(String(err)) }
  }

  const installThunderstore = async (mod: BrowseMod, version: string) => {
    if (!tsCommunity) return
    setTsInstalling(version)
    try {
      const r = await window.ucMods?.thunderstoreInstall?.(appid, tsCommunity, mod.remoteId, version)
      if (!r?.ok) { toast(r?.error || "install failed", "error", 7000); return }
      setTsVersionPick(null)
      toast(`Installing ${mod.name}… dependencies (including BepInEx) install automatically`, "info", 9000)
    } catch (err) { toast(String(err), "error", 7000) } finally { setTsInstalling(null) }
  }

  const deployTargetLabel = gs?.deployTarget ? gs.deployTarget : "automatic per mod"

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

            <span style={CHIP} title="Thunderstore community bound to this game (r2modman-style BepInEx mods). Set it from the Thunderstore tab.">
              <span style={{ color: "var(--mf-t5)" }}>thunderstore:</span>
              <span style={{ color: tsCommunity ? "var(--mf-t2)" : "var(--mf-t5)" }}>{tsCommunity || "not matched"}</span>
              {tsCommunity && gs.thunderstoreCommunityAuto ? <span style={{ color: "var(--mf-t6)" }}>auto</span> : null}
            </span>

            <span
              style={CHIP}
              title={(gs.loaderCompatibility || []).map((loader) => `${loader.name}: ${loader.reason}`).join("\n")}
            >
              <span style={{ color: "var(--mf-t5)" }}>loaders:</span>
              <span style={{ color: compatibleLoaders.length ? "var(--mf-t2)" : "var(--mf-t5)" }}>
                {compatibleLoaders.length ? compatibleLoaders.map((loader) => loader.name).join(" · ") : "none detected"}
              </span>
            </span>

            <span style={CHIP} title={launchManaged ? "Whether enabled mod folders will be passed to Mewgenics at launch" : "Whether enabled mod files are currently copied into the game folder"}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: gs.deployed ? "var(--mf-t1)" : "color-mix(in srgb, var(--mf-t0) 18%, transparent)", flexShrink: 0 }} />
              {gs.deployed ? (launchManaged ? "active on launch" : "deployed") : (launchManaged ? "inactive on launch" : "not deployed")}
            </span>

            <span style={CHIP} title="Optional manual base folder for every mod. Leave empty to infer each mod's destination from the game and archive layout.">
              <span style={{ color: "var(--mf-t5)" }}>target override:</span>
              <input
                value={targetDraft}
                onChange={(e) => setTargetDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && targetDirty) void saveTarget() }}
                placeholder="auto per mod"
                style={{ ...CHIP_INPUT, width: 130 }}
              />
              <button type="button" title="Pick a folder inside the game directory" onClick={() => void pickTarget()} style={{ display: "flex", background: "none", border: "none", padding: 0, color: "var(--mf-t4)", cursor: "pointer" }}><FolderOpen size={12} strokeWidth={2} /></button>
              {targetDirty ? (
                <button type="button" title="Save deploy target (undeploys from the old target first)" onClick={() => void saveTarget()} style={{ display: "flex", background: "none", border: "none", padding: 0, color: "var(--mf-t2)", cursor: "pointer" }}><Check size={12} strokeWidth={2} /></button>
              ) : null}
            </span>
          </div>
        )}

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

            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 9, marginBottom: 16 }}>
              <button type="button" className="mf-ghost" style={GHOST_BTN} onClick={() => void openModsFolder()}>
                <FolderOpen size={13} strokeWidth={1.7} />Open mods folder
              </button>
              <button type="button" className="mf-ghost" style={{ ...GHOST_BTN, opacity: deployBusy || mods.length === 0 ? 0.55 : 1 }} disabled={Boolean(deployBusy) || mods.length === 0} onClick={() => void runDeploy()}>
                {deployBusy === "deploy" ? <Spinner size={13} /> : <Rocket size={13} strokeWidth={1.7} />}{launchManaged ? "Activate" : "Deploy"}
              </button>
              <button type="button" className="mf-ghost" style={{ ...GHOST_BTN, opacity: deployBusy || !gs.deployed ? 0.55 : 1 }} disabled={Boolean(deployBusy) || !gs.deployed} onClick={() => void runUndeploy()}>
                {deployBusy === "undeploy" ? <Spinner size={13} /> : <Undo2 size={13} strokeWidth={1.7} />}{launchManaged ? "Deactivate" : "Undeploy"}
              </button>
              <span style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--mf-t5)" }}>
                {launchManaged
                  ? (gs.deployed ? "enabled mod folders load in this order at game launch" : "mods will not be passed to the game")
                  : (gs.deployed ? `deployed to ${deployTargetLabel}` : "changes deploy automatically on install / toggle / reorder")}
              </span>
            </div>

            {blockedMods.length > 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", marginBottom: 14, borderRadius: 9, border: "1px solid color-mix(in srgb, var(--mf-danger) 35%, transparent)", background: "color-mix(in srgb, var(--mf-danger) 6%, transparent)", color: "var(--mf-t3)" }}>
                <Puzzle size={14} strokeWidth={1.7} style={{ color: "var(--mf-danger)", flexShrink: 0 }} />
                <span style={{ fontFamily: MONO, fontSize: 10.5, lineHeight: 1.5 }}>
                  {blockedMods.length} {blockedMods.length === 1 ? "mod requires" : "mods require"} an interactive installer and cannot be deployed safely. Install through a FOMOD-capable manager.
                </span>
              </div>
            ) : null}

            {uncertainMods.length > 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", marginBottom: 14, borderRadius: 9, border: "1px solid color-mix(in srgb, var(--mf-danger) 35%, transparent)", background: "color-mix(in srgb, var(--mf-danger) 6%, transparent)", color: "var(--mf-t3)" }}>
                <FolderOpen size={14} strokeWidth={1.7} style={{ color: "var(--mf-danger)", flexShrink: 0 }} />
                <span style={{ fontFamily: MONO, fontSize: 10.5, lineHeight: 1.5 }}>
                  {uncertainMods.length} {uncertainMods.length === 1 ? "mod has" : "mods have"} no recognized deployment layout and use the game root. If a mod does not load, use the folder control above to choose a target.
                </span>
              </div>
            ) : null}

            {mods.length === 0 ? (
              <CenterState>
                <Package size={30} strokeWidth={1.4} color="var(--mf-t6)" />
                <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--mf-t5)" }}>no mods installed yet — grab some from the Nexus, Workshop or Thunderstore tabs</span>
              </CenterState>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {mods.map((m, i) => (
                  <div key={m.id} className="mf-listrow" style={{ display: "flex", alignItems: "center", gap: 13, padding: "10px 13px", borderRadius: 10, border: "1px solid var(--mf-line)", background: "var(--mf-panel)" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3, flexShrink: 0 }}>
                      <ArrowBtn dir="up" disabled={i === 0} onClick={() => void moveMod(i, -1)} />
                      <ArrowBtn dir="down" disabled={i === mods.length - 1} onClick={() => void moveMod(i, 1)} />
                    </div>
                    <Switch checked={m.enabled && !m.deployBlocked} disabled={m.deployBlocked} onCheckedChange={(v) => void toggleMod(m, v)} aria-label={`${m.enabled ? "Disable" : "Enable"} ${m.name}`} />
                    <div style={{ width: 34, height: 34, borderRadius: 6, flexShrink: 0, border: "1px solid var(--mf-line-2)", background: m.picture ? `center/cover no-repeat url("${proxyImageUrl(m.picture)}")` : COVER_LINES }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                        <span title={m.name} style={{ fontSize: 13, fontWeight: 600, color: m.enabled ? "var(--mf-t1)" : "var(--mf-t4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</span>
                        <span style={{ padding: "2px 8px", borderRadius: 999, border: "1px solid var(--mf-line-2)", fontFamily: MONO, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.09em", color: "var(--mf-t3)", flexShrink: 0 }}>{m.provider}</span>
                        <span title={m.deployReason || "No automatic deployment decision recorded"} style={{ padding: "2px 8px", borderRadius: 999, border: `1px solid ${m.deployConfidence === "low" || m.deployBlocked ? "color-mix(in srgb, var(--mf-danger) 45%, transparent)" : "var(--mf-line-2)"}`, fontFamily: MONO, fontSize: 9, letterSpacing: "0.04em", color: m.deployConfidence === "low" || m.deployBlocked ? "var(--mf-danger)" : "var(--mf-t4)", flexShrink: 0 }}>
                          {m.deployBlocked ? "installer required" : m.deployConfidence === "low" ? "check target" : launchManaged ? "auto: launch path" : `${m.deployConfidence === "manual" ? "manual" : "auto"}: ${m.deployPrefix || "game root"}`}
                        </span>
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
                <select className="uc-select" value={nxSort} onChange={(e) => setNxSort(e.target.value as NexusSort)} title="Sort order" style={SELECT}>
                  {NEXUS_SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <select className="uc-select" value={nxPeriod} onChange={(e) => setNxPeriod(e.target.value as Period)} title="Time window" style={SELECT}>
                  {PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <button type="button" className="mf-ghost" onClick={() => setNxOrder((o) => (o === "asc" ? "desc" : "asc"))} title={nxOrder === "asc" ? "Ascending (lowest first)" : "Descending (highest first)"} aria-label="Toggle sort direction" style={{ ...GHOST_BTN, width: 40, padding: 0 }}>
                  {nxOrder === "asc" ? <ArrowUp size={14} strokeWidth={1.9} /> : <ArrowDown size={14} strokeWidth={1.9} />}
                </button>
                <div style={{ position: "relative", flex: 1, minWidth: 220, maxWidth: 340, marginLeft: "auto" }}>
                  <SearchIcon size={13} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
                  <input
                    value={nxQuery}
                    onChange={(e) => setNxQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setNxSubmitted(nxQuery.trim())
                      if (e.key === "Escape") { setNxQuery(""); setNxSubmitted("") }
                    }}
                    placeholder={`search ${nexusDomain} mods… (Enter)`}
                    style={SEARCH_INPUT}
                  />
                </div>
              </div>

              <BrowseResults
                browse={nexusBrowse}
                emptyLabel={nxSubmitted ? `nothing found for “${nxSubmitted}”` : "nothing here"}
                errorAction={{ label: "Open Settings", onClick: () => navigate("/settings") }}
                renderCard={(mod) => (
                  <BrowseCard
                    key={mod.remoteId}
                    picture={mod.picture}
                    name={mod.name}
                    author={mod.author}
                    metaLine={`${formatNumber(mod.downloads || 0)} downloads · ${formatNumber(mod.endorsements || 0)} endorsements`}
                    installed={installedIds.has(`nexus-${mod.remoteId}`)}
                    busy={filePick?.remoteId === mod.remoteId}
                    onInstall={() => void openFilePicker(mod)}
                  />
                )}
              />
            </>
          )
        ) : tab === "workshop" ? (
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
                <select className="uc-select" value={wsSort} onChange={(e) => setWsSort(e.target.value as WorkshopSort)} title="Sort order" style={SELECT}>
                  {WORKSHOP_SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <select
                  className="uc-select"
                  value={wsPeriod}
                  onChange={(e) => setWsPeriod(e.target.value as Period)}
                  disabled={wsSort !== "trend"}
                  title={wsSort === "trend" ? "Time window" : "The time window applies only to the Popular sort"}
                  style={{ ...SELECT, opacity: wsSort === "trend" ? 1 : 0.45, cursor: wsSort === "trend" ? "pointer" : "not-allowed" }}
                >
                  {PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <div style={{ position: "relative", flex: 1, minWidth: 220, maxWidth: 340, marginLeft: "auto" }}>
                  <SearchIcon size={13} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
                  <input
                    value={wsQuery}
                    onChange={(e) => setWsQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setWsSubmitted(wsQuery.trim())
                      if (e.key === "Escape") { setWsQuery(""); setWsSubmitted("") }
                    }}
                    placeholder="search the workshop… (Enter)"
                    style={SEARCH_INPUT}
                  />
                </div>
              </div>

              <BrowseResults
                browse={workshopBrowse}
                emptyLabel={wsSubmitted ? `nothing found for “${wsSubmitted}”` : "nothing here"}
                renderCard={(item) => (
                  <BrowseCard
                    key={item.remoteId}
                    picture={item.picture}
                    name={item.name}
                    author={item.author}
                    installed={installedIds.has(`workshop-${item.remoteId}`)}
                    busy={wsBusy === item.remoteId}
                    onInstall={() => void installWorkshop(item)}
                  />
                )}
              />
            </>
          )
        ) : (
          !tsSupported ? (
            <CenterState>
              <Globe size={30} strokeWidth={1.4} color="var(--mf-t6)" />
              <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--mf-t5)", maxWidth: 520, textAlign: "center", lineHeight: 1.6 }}>
                No Thunderstore community was matched for this game. Thunderstore hosts BepInEx-style mods grouped per game community; pick this game's community to browse and install them (dependencies, including BepInEx, install automatically).
              </span>
              {tsCommError ? <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--mf-danger)" }}>{tsCommError}</span> : null}
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <select
                  className="uc-select"
                  value={tsCommPick}
                  disabled={tsCommLoading || tsSaving}
                  onChange={(e) => setTsCommPick(e.target.value)}
                  style={{ ...SELECT, minWidth: 240 }}
                >
                  <option value="">{tsCommLoading ? "loading communities…" : "select a community…"}</option>
                  {(tsCommunities || []).map((c) => <option key={c.identifier} value={c.identifier}>{c.name}</option>)}
                </select>
                <button type="button" className="mf-ghost" style={{ ...GHOST_BTN, opacity: !tsCommPick || tsSaving ? 0.55 : 1 }} disabled={!tsCommPick || tsSaving} onClick={() => void saveCommunity(tsCommPick)}>
                  {tsSaving ? <Spinner size={13} /> : <Check size={13} strokeWidth={1.8} />}Use community
                </button>
              </div>
            </CenterState>
          ) : (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <select className="uc-select" value={tsSort} onChange={(e) => setTsSort(e.target.value as ThunderstoreSort)} title="Sort order" style={SELECT}>
                  {THUNDERSTORE_SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <select className="uc-select" value={tsPeriod} onChange={(e) => setTsPeriod(e.target.value as Period)} title="Time window" style={SELECT}>
                  {PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <div style={{ position: "relative", flex: 1, minWidth: 220, maxWidth: 340, marginLeft: "auto" }}>
                  <SearchIcon size={13} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
                  <input
                    value={tsQuery}
                    onChange={(e) => setTsQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setTsSubmitted(tsQuery.trim())
                      if (e.key === "Escape") { setTsQuery(""); setTsSubmitted("") }
                    }}
                    placeholder="search Thunderstore… (Enter)"
                    style={SEARCH_INPUT}
                  />
                </div>
              </div>

              <BrowseResults
                browse={thunderstoreBrowse}
                emptyLabel={tsSubmitted ? `nothing found for “${tsSubmitted}”` : "nothing here"}
                renderCard={(mod) => (
                  <BrowseCard
                    key={mod.remoteId}
                    picture={mod.picture}
                    name={mod.name}
                    author={mod.author}
                    metaLine={`${formatNumber(mod.downloads || 0)} downloads · ${formatNumber(mod.endorsements || 0)} rating`}
                    installed={installedIds.has(`thunderstore-${mod.remoteId}`)}
                    busy={tsVersionPick?.remoteId === mod.remoteId}
                    onInstall={() => void openTsVersions(mod)}
                  />
                )}
              />
            </>
          )
        )}
      </div>

      <Dialog open={Boolean(confirmRm)} onOpenChange={(open) => { if (!open && !removing) setConfirmRm(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Uninstall {confirmRm?.name}?</DialogTitle>
            <DialogDescription>
              Removes the mod's staged files and redeploys the game folder without it. You can reinstall it from the {confirmRm?.provider === "workshop" ? "Workshop" : confirmRm?.provider === "thunderstore" ? "Thunderstore" : "Nexus"} tab later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={removing} onClick={() => setConfirmRm(null)}>Cancel</Button>
            <Button variant="destructive" disabled={removing} onClick={() => void runUninstall()}>{removing ? "Uninstalling…" : "Uninstall"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      <Dialog open={Boolean(tsVersionPick)} onOpenChange={(open) => { if (!open && tsInstalling == null) setTsVersionPick(null) }}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Install {tsVersionPick?.name}</DialogTitle>
            <DialogDescription>Pick a version. Dependencies (including BepInEx) are resolved and installed automatically.</DialogDescription>
          </DialogHeader>
          {tsVersions == null && !tsVersionsError ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "28px 0" }}><Spinner size={16} /></div>
          ) : tsVersionsError ? (
            <div style={{ fontFamily: MONO, fontSize: 11.5, color: "var(--mf-t3)", padding: "8px 0" }}>{tsVersionsError}</div>
          ) : tsVersions && tsVersions.length === 0 ? (
            <div style={{ fontFamily: MONO, fontSize: 11.5, color: "var(--mf-t4)", padding: "8px 0" }}>this package has no versions</div>
          ) : (
            <div className="mf-scroll" style={{ maxHeight: 380, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, margin: "4px 0" }}>
              {(tsVersions || []).map((v) => (
                <div key={v.version} className="mf-listrow" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--mf-line)", background: "var(--mf-panel)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--mf-t1)" }}>v{v.version}</div>
                    <div style={{ marginTop: 3, fontFamily: MONO, fontSize: 10, color: "var(--mf-t5)" }}>
                      {[fmtBytes(v.sizeBytes), `${v.dependencyCount ?? 0} ${(v.dependencyCount ?? 0) === 1 ? "dependency" : "dependencies"}`, fmtDate(v.uploadedAt)].filter(Boolean).join(" · ")}
                    </div>
                    {v.description ? <div style={{ marginTop: 4, fontSize: 11, color: "var(--mf-t4)", lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{v.description}</div> : null}
                  </div>
                  <button
                    type="button"
                    className="mf-ghost"
                    disabled={tsInstalling != null}
                    onClick={() => { if (tsVersionPick) void installThunderstore(tsVersionPick, v.version) }}
                    style={{ ...GHOST_BTN, height: 30, fontSize: 11.5, flexShrink: 0, opacity: tsInstalling != null && tsInstalling !== v.version ? 0.5 : 1 }}
                  >
                    {tsInstalling === v.version ? <Spinner size={12} /> : <Download size={12} strokeWidth={1.8} />}
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
