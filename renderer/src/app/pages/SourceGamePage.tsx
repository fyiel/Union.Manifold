import { useEffect, useMemo, useState } from "react"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import { Bookmark, BookmarkCheck, Maximize2, TriangleAlert, X } from "lucide-react"
import {
  SOURCE_PRIORITY,
  collectDownloadEntries,
  downloadAppidFor,
  getRememberedGame,
  rememberGames,
  rememberGameAs,
  getSourceDetail,
  resolveInstalledGame,
  loadSourcePriority,
  orderSourcesByPreference,
  pickPrimaryDownload,
  sourceName,
  sourceDirect,
  startSourceDownload,
  startBestDownload,
  type DownloadEntry,
} from "@/lib/sources"
import { isPlayLater, onPlayLaterChanged, togglePlayLater } from "@/lib/play-later"
import { useDownloadsSelector } from "@/context/downloads-context"
import { useGameLaunch } from "@/context/game-launch-context"
import { MONO, COVER_LINES, gbLabel, Spinner, SmartImage, gameImageCandidates } from "@/app/manifold/ui"
import { getInstalledVersionLabel, hasInstalledVersionUpdate } from "@/lib/utils"
import { WandTrainerModal } from "@/components/WandTrainerModal"


const LIVE_LABEL: Record<string, string> = {
  downloading: "Downloading", queued: "Queued", extracting: "Extracting", installing: "Installing",
  verifying: "Verifying", retrying: "Retrying", paused: "Paused", install_ready: "Ready to install",
  completed: "Installed", extracted: "Installed",
}
const LIVE_ORDER = ["downloading", "extracting", "installing", "verifying", "retrying", "paused", "install_ready", "queued", "completed", "extracted", "failed"]

type OptState = "idle" | "working" | "queued" | "opened" | "error"

const HERO_LINES = "repeating-linear-gradient(135deg, color-mix(in srgb, var(--mf-t0) 4%, transparent) 0 1px, transparent 1px 16px), var(--mf-panel-2)"

const PROTON_TIER_COLORS: Record<string, string> = {
  platinum: "#b9c7d6", gold: "#e2c15a", silver: "var(--mf-t3)", bronze: "#c08457", borked: "#d0625f",
}

const reqText = (html: string) =>
  html
    .replace(/^\s*<strong>[^<]*<\/strong>\s*(<br\s*\/?>)?\s*/i, "")
    .replace(/<br\s*\/?>|<\/li>|<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")

function relTime(ms?: number | null): string {
  if (!ms) return ""
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (s < 60) return "just now"
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`
}

const keyOf = (e: DownloadEntry) =>
  `${e.source.sourceId}:${e.source.sourceSlug}:${e.option.hostType}:${e.option.url || e.option.label}`

export function SourceGamePage() {
  const { key = "" } = useParams()
  const dedupKey = decodeURIComponent(key)
  const location = useLocation()
  const navigate = useNavigate()
  const { requestLaunch } = useGameLaunch()

  const navState = location.state as { game?: UnifiedSourceGame; installed?: boolean } | null
  const passed = navState?.game || null
  const remembered = getRememberedGame(dedupKey) || null
  const initial = remembered?.fullyResolved ? remembered : (passed || remembered)

  const [game, setGame] = useState<UnifiedSourceGame | null>(initial)
  const [loading, setLoading] = useState(!initial)
  const [optState, setOptState] = useState<Record<string, OptState>>({})
  const [optMsg, setOptMsg] = useState<Record<string, string>>({})
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [heroFailed, setHeroFailed] = useState(false)
  const [coverFailed, setCoverFailed] = useState(false)
  const [zoomedScreenshot, setZoomedScreenshot] = useState<string | null>(null)
  const [priority, setPriority] = useState<string[]>(SOURCE_PRIORITY)
  useEffect(() => { void loadSourcePriority().then(setPriority) }, [])
  useEffect(() => {
    if (!zoomedScreenshot) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoomedScreenshot(null)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [zoomedScreenshot])

  const dlAppid = downloadAppidFor(dedupKey)
  const liveStatus = useDownloadsSelector(
    (downloads): string | null => {
      const items = downloads.filter((d) => d.appid === dlAppid && d.status !== "cancelled")
      if (!items.length) return null
      for (const s of LIVE_ORDER) if (items.some((i) => i.status === s)) return s
      return items[0].status
    },
    (a, b) => a === b,
  )

  const [installed, setInstalled] = useState(Boolean(navState?.installed))
  const [installedVersion, setInstalledVersion] = useState<string | null>(null)
  const [savedForLater, setSavedForLater] = useState(() => isPlayLater(dedupKey))
  useEffect(() => {
    const sync = () => setSavedForLater(isPlayLater(dedupKey))
    sync()
    return onPlayLaterChanged(sync)
  }, [dedupKey])
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const list = (await window.ucDownloads?.listInstalledGlobal?.()) || (await window.ucDownloads?.listInstalled?.()) || []
        if (!alive) return
        const found = (list as Array<{ appid?: unknown; metadata?: { appid?: unknown } }>).find(
          (entry) => String(entry.appid || entry.metadata?.appid || "") === dlAppid,
        )
        setInstalled(Boolean(found))
        setInstalledVersion(getInstalledVersionLabel(found))
      } catch {  }
    })()
    return () => { alive = false }
  }, [dlAppid])

  useEffect(() => {
    if (game?.fullyResolved) return
    const stubs = (game?.sources || initial?.sources || []).map((s) => ({ sourceId: s.sourceId, sourceSlug: s.sourceSlug }))
    let alive = true
    setLoading(true)
    const title = game?.title || initial?.title || ""
    const knownSteam = game?.steamAppId ?? initial?.steamAppId ?? null
    const work = stubs.length ? getSourceDetail(stubs) : resolveInstalledGame(dedupKey, title, knownSteam)
    void work.then((full) => {
      if (!alive) return
      if (full) {
        setGame(full)
        rememberGames([full])
        rememberGameAs(dedupKey, full)
      }
      setLoading(false)
    }).catch(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [dedupKey])

  const [protonData, setProtonData] = useState<ProtonDbSummary | null>(null)
  const [steamMeta, setSteamMeta] = useState<SteamMeta | null>(null)
  const [protonHover, setProtonHover] = useState(false)
  useEffect(() => {
    const id = game?.steamAppId
    setProtonData(null)
    setSteamMeta(null)
    if (!id) return
    let alive = true
    void Promise.resolve(window.ucSources?.protondb?.(id))
      .then((res) => { if (alive && res?.ok) setProtonData(res.data) })
      .catch(() => undefined)
    void Promise.resolve(window.ucSources?.steamMeta?.(id))
      .then((res) => { if (alive && res?.ok) setSteamMeta(res.meta) })
      .catch(() => undefined)
    return () => { alive = false }
  }, [game?.steamAppId])

  const [wand, setWand] = useState<WandLookupResult | null>(null)
  const [wandOpen, setWandOpen] = useState(false)
  useEffect(() => {
    setWand(null)
    if (!game?.title) return
    let alive = true
    void window.ucWand?.lookup(game.title, game.steamAppId ?? undefined)
      .then((result) => { if (alive) setWand(result) })
      .catch(() => undefined)
    return () => { alive = false }
  }, [game?.title, game?.steamAppId])

  const ordered = useMemo(() => orderSourcesByPreference(game?.sources || [], priority), [game, priority])
  const entries = useMemo(() => collectDownloadEntries(ordered), [ordered])
  const primary = useMemo(() => pickPrimaryDownload(entries), [entries])
  const mirrors = entries.length
  const sourceCount = game?.sources?.length || 0
  const updateAvailable = installed && hasInstalledVersionUpdate(game?.version, [installedVersion])
  const downloadBusy = Boolean(liveStatus && liveStatus !== "completed" && liveStatus !== "extracted")

  const handleDownload = async (sourceId: string, option: SourceDownloadOption, optKey: string) => {
    if (!game || (installed && !updateAvailable) || downloadBusy) return
    setOptState((s) => ({ ...s, [optKey]: "working" }))
    setOptMsg((m) => ({ ...m, [optKey]: "" }))
    try {
      const res = await startSourceDownload(game, sourceId, option)
      if (res.ok) {
        setOptState((s) => ({ ...s, [optKey]: "queued" }))
      } else if (res.openUrl) {
        await window.ucSystem?.openExternal?.(res.openUrl)
        setOptState((s) => ({ ...s, [optKey]: "opened" }))
        setOptMsg((m) => ({ ...m, [optKey]: res.reason || "opened in browser" }))
      } else {
        setOptState((s) => ({ ...s, [optKey]: "error" }))
        setOptMsg((m) => ({ ...m, [optKey]: res.reason || "could not start" }))
      }
    } catch (err) {
      setOptState((s) => ({ ...s, [optKey]: "error" }))
      setOptMsg((m) => ({ ...m, [optKey]: String(err) }))
    }
  }

  const copyPrimary = async () => {
    const url = primary?.option.url || primary?.option.pageUrl
    if (!url) return
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1400) } catch {  }
  }

  const openSourcePage = (url?: string) => { if (url) void window.ucSystem?.openExternal?.(url) }

  if (!game && !loading) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 13 }}>
        <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--mf-t4)" }}>game not found in this session</span>
        <button type="button" onClick={() => navigate("/")} className="mf-textbtn" style={{ fontFamily: MONO, fontSize: 12, color: "var(--mf-t2)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>← back to browse</button>
      </div>
    )
  }

  const heroCandidates = game ? gameImageCandidates({ image: game.heroImage, heroImage: game.image, steamAppId: game.steamAppId, sources: game.sources }) : []
  const coverCandidates = game ? gameImageCandidates(game, { steamFirst: true }) : []
  const year = game?.releaseYear || game?.releaseDate?.match(/\d{4}/)?.[0]
  const size = game?.sizeText || gbLabel(game?.sizeBytes)
  const appid = game?.steamAppId
  const genres = game?.genres || []
  const protonTier = protonData?.tier && protonData.tier !== "pending" ? protonData.tier : ""
  const protonColor = PROTON_TIER_COLORS[protonTier] || "var(--mf-t3)"
  const pk = primary ? keyOf(primary) : ""
  const pst: OptState = optState[pk] || "idle"
  const updatedAny = relTime(game?.updatedAt)

  const handlePrimaryDownload = async () => {
    if (!game || (installed && !updateAvailable) || downloadBusy || !primary) return
    setOptState((s) => ({ ...s, [pk]: "working" }))
    setOptMsg((m) => ({ ...m, [pk]: "" }))
    try {
      const res = await startBestDownload(game, entries)
      if (res.ok) {
        setOptState((s) => ({ ...s, [pk]: "queued" }))
      } else if (res.openUrl) {
        await window.ucSystem?.openExternal?.(res.openUrl)
        setOptState((s) => ({ ...s, [pk]: "opened" }))
        setOptMsg((m) => ({ ...m, [pk]: res.reason || "opened in browser" }))
      } else {
        setOptState((s) => ({ ...s, [pk]: "error" }))
        setOptMsg((m) => ({ ...m, [pk]: res.reason || "could not start" }))
      }
    } catch (err) {
      setOptState((s) => ({ ...s, [pk]: "error" }))
      setOptMsg((m) => ({ ...m, [pk]: String(err) }))
    }
  }


  return (
    <div className="mf-scroll" style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
      {}
      <div style={{ position: "relative", height: 300, overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, background: heroFailed || !heroCandidates.length ? HERO_LINES : "#0f0f0f" }}>
          {!heroFailed && heroCandidates.length > 0 && (
            <SmartImage candidates={heroCandidates} steamAppId={game?.steamAppId} onAllFailed={() => setHeroFailed(true)} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.55 }} />
          )}
        </div>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, var(--mf-bg) 4%, rgba(21,21,21,0.55) 45%, rgba(21,21,21,0.25))" }} />
        <button type="button" onClick={() => navigate(-1)} className="mf-ghost" style={{ position: "absolute", top: 22, left: 36, display: "flex", alignItems: "center", gap: 7, padding: "7px 12px", borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "rgba(0,0,0,0.4)", color: "var(--mf-t2)", fontFamily: MONO, fontSize: 11, cursor: "pointer", backdropFilter: "blur(6px)" }}>
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 3 4 8 9 13" /><line x1="4" y1="8" x2="13" y2="8" /></svg>back
        </button>
      </div>

      {}
      <div style={{ position: "relative", maxWidth: 980, margin: "0 auto", padding: "0 40px" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 22, marginTop: -118 }}>
          <div style={{ width: 152, height: 202, flexShrink: 0, borderRadius: 10, background: coverFailed || !coverCandidates.length ? COVER_LINES : "#0f0f0f", border: "1px solid var(--mf-line-2)", boxShadow: "0 20px 50px rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-end", padding: 12, overflow: "hidden", position: "relative" }}>
            {!coverFailed && coverCandidates.length > 0
              ? <SmartImage candidates={coverCandidates} steamAppId={game?.steamAppId} alt={game?.title} onAllFailed={() => setCoverFailed(true)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
              : <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--mf-t2)" }}>{game?.title}</span>}
          </div>
          <div style={{ minWidth: 0, flex: 1, paddingBottom: 6 }}>
            <h1 style={{ margin: 0, fontSize: 34, fontWeight: 700, color: "var(--mf-t0)", letterSpacing: "-0.025em", lineHeight: 1.05 }}>{game?.title}</h1>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 18, marginTop: 12, fontFamily: MONO, fontSize: 12, color: "var(--mf-t4)" }}>
              {game?.developer && game.developer !== "Unknown" && <span>{game.developer}</span>}
              {year && <span>{year}</span>}
              {size && <span>{size}</span>}
              {appid && <span>appid {appid}</span>}
            </div>
            {genres.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 14 }}>
                {genres.slice(0, 5).map((g) => (
                  <span key={g} style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", fontFamily: MONO, fontSize: 10.5, color: "var(--mf-t3)" }}>{g}</span>
                ))}
              </div>
            )}
            {appid && (
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 9, marginTop: 18 }}>
                <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--mf-t5)", marginRight: 2 }}>View on</span>
                <ExtLink title="Steam" onClick={() => openSourcePage(`https://store.steampowered.com/app/${appid}`)}>
                  <SteamIcon />
                </ExtLink>
                <ExtLink title="SteamDB" onClick={() => openSourcePage(`https://steamdb.info/app/${appid}`)}>
                  <SteamDbIcon />
                </ExtLink>
                <span
                  style={{ position: "relative", display: "inline-flex" }}
                  onMouseEnter={() => setProtonHover(true)}
                  onMouseLeave={() => setProtonHover(false)}
                >
                  <ExtLink title="ProtonDB" onClick={() => openSourcePage(`https://www.protondb.com/app/${appid}`)}>
                    <ProtonDbIcon />
                  </ExtLink>
                  {protonHover && protonData && protonTier && (
                    <span style={{ position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: 999, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", fontFamily: MONO, fontSize: 10.5, color: protonColor, whiteSpace: "nowrap", zIndex: 5, boxShadow: "0 6px 18px rgba(0,0,0,0.4)", pointerEvents: "none" }}>
                      <span style={{ width: 6, height: 6, borderRadius: 99, background: protonColor, flexShrink: 0 }} />
                      {protonTier.charAt(0).toUpperCase() + protonTier.slice(1)}
                      {protonData.total > 0 && <span style={{ color: "var(--mf-t5)" }}>· {Math.round(protonData.score * 100)}% · {protonData.total} reports</span>}
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>

        {}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 26 }}>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 9, fontFamily: MONO, fontSize: 13, color: "var(--mf-t4)" }}>
              <Spinner size={16} /> loading links…
            </div>
          ) : installed ? (
            <>
              <button type="button" onClick={() => void requestLaunch({ appid: dlAppid, name: game!.title })} className="mf-ghost" style={{ display: "flex", alignItems: "center", gap: 9, padding: "12px 22px", borderRadius: 9, border: "none", background: "var(--mf-accent)", color: "var(--mf-accent-ink)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M5 3.5v9l8-4.5z" /></svg>Play
                <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 400, color: "rgba(17,17,17,0.6)" }}>installed</span>
              </button>
              {updateAvailable && primary && (
                <PrimaryButton
                  state={pst}
                  resolvable={primary.option.resolvable}
                  sourceLabel={sourceName(primary.source.sourceId)}
                  sizeText={primary.option.sizeText}
                  label="Update"
                  onClick={() => void handlePrimaryDownload()}
                />
              )}
            </>
          ) : liveStatus ? (
            <LiveButton status={liveStatus} onClick={() => navigate("/downloads")} />
          ) : primary ? (
            <PrimaryButton
              state={pst}
              resolvable={primary.option.resolvable}
              sourceLabel={sourceName(primary.source.sourceId)}
              sizeText={primary.option.sizeText}
              onClick={() => void handlePrimaryDownload()}
            />
          ) : (
            <span style={{ fontFamily: MONO, fontSize: 13, color: "var(--mf-t4)" }}>no download links found.</span>
          )}
          {primary && !liveStatus && !installed && (
            <button type="button" title={copied ? "copied" : "copy download link"} onClick={() => void copyPrimary()} className="mf-ghost" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, borderRadius: 9, border: "1px solid var(--mf-line-2)", background: "transparent", color: copied ? "#7fcf9b" : "var(--mf-t3)", cursor: "pointer" }}>
              {copied
                ? <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 8.5 6.5 12 13 4" /></svg>
                : <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="5" width="9" height="9" rx="1.5" /><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2H3.5A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" /></svg>}
            </button>
          )}
          {!installed && game && (
            <button type="button" onClick={() => setSavedForLater(togglePlayLater(game))} className="mf-ghost" title={savedForLater ? "Remove from Play later" : "Save to Play later"} style={{ display: "flex", alignItems: "center", gap: 8, height: 44, padding: "0 15px", borderRadius: 9, border: "1px solid var(--mf-line-2)", background: savedForLater ? "color-mix(in srgb, var(--mf-t0) 7%, transparent)" : "transparent", color: "var(--mf-t2)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              {savedForLater ? <BookmarkCheck size={15} strokeWidth={1.7} /> : <Bookmark size={15} strokeWidth={1.7} />}
              {savedForLater ? "Saved for later" : "Play later"}
            </button>
          )}
          {installed && wand?.supported && wand.game && (
            <button type="button" onClick={() => setWandOpen(true)} className="mf-ghost" title={`Open experimental ${wand.game.name} trainer controls`} style={{ display: "flex", alignItems: "center", gap: 8, height: 44, padding: "0 15px", borderRadius: 9, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t2)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              <TriangleAlert size={15} strokeWidth={1.7} color="#eab308" />
              Trainer
              <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 400, color: "#ca8a04" }}>experimental</span>
              <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 400, color: "var(--mf-t5)" }}>{wand.game.cheatCount} assists</span>
            </button>
          )}
          <span style={{ marginLeft: "auto", display: "flex", gap: 20, fontFamily: MONO, fontSize: 11, color: "var(--mf-t5)" }}>
            <span>{mirrors} {mirrors === 1 ? "mirror" : "mirrors"}</span>
            <span>{sourceCount} {sourceCount === 1 ? "source" : "sources"}</span>
          </span>
        </div>
        {optMsg[pk] && <p style={{ margin: "10px 0 0", fontFamily: MONO, fontSize: 11, color: "var(--mf-t4)" }}>{optMsg[pk]}</p>}

        {}
        {game?.description && (
          <p style={{ margin: "30px 0 0", fontSize: 14, lineHeight: 1.72, color: "var(--mf-t3)", maxWidth: 680, whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{game.description}</p>
        )}

        {steamMeta && steamMeta.screenshots.length > 0 && (
          <div className="mf-scroll" style={{ display: "flex", gap: 10, marginTop: 26, overflowX: "auto", paddingBottom: 8 }}>
            {steamMeta.screenshots.slice(0, 12).map((src, index) => (
              <button key={src} type="button" aria-label={`Open screenshot ${index + 1}`} title="Open screenshot" onClick={() => setZoomedScreenshot(src)} style={{ position: "relative", height: 150, width: "auto", flexShrink: 0, padding: 0, borderRadius: 8, border: "1px solid var(--mf-line-2)", overflow: "hidden", background: "var(--mf-panel-2)", cursor: "zoom-in" }}>
                <img src={src} alt={`${game?.title || "Game"} screenshot ${index + 1}`} loading="lazy" style={{ display: "block", height: "100%", width: "auto", objectFit: "cover" }} />
                <span aria-hidden="true" style={{ position: "absolute", top: 7, right: 7, display: "grid", placeItems: "center", width: 25, height: 25, borderRadius: 7, background: "rgba(8,8,8,0.72)", color: "rgba(255,255,255,0.82)", backdropFilter: "blur(6px)" }}><Maximize2 size={12} strokeWidth={1.8} /></span>
              </button>
            ))}
          </div>
        )}

        {steamMeta && (steamMeta.requirements.minimum || steamMeta.requirements.recommended) && (
          <div style={{ marginTop: 30 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--mf-t1)", letterSpacing: "-0.01em" }}>System requirements</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 12 }}>
              {steamMeta.requirements.minimum && (
                <div style={{ flex: "1 1 300px", minWidth: 0, padding: "14px 16px", borderRadius: 10, border: "1px solid var(--mf-line)", background: "var(--mf-panel-2)" }}>
                  <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--mf-t5)" }}>Minimum</div>
                  <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.6, color: "var(--mf-t3)", overflowWrap: "anywhere", whiteSpace: "pre-line" }}>{reqText(steamMeta.requirements.minimum)}</div>
                </div>
              )}
              {steamMeta.requirements.recommended && (
                <div style={{ flex: "1 1 300px", minWidth: 0, padding: "14px 16px", borderRadius: 10, border: "1px solid var(--mf-line)", background: "var(--mf-panel-2)" }}>
                  <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--mf-t5)" }}>Recommended</div>
                  <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.6, color: "var(--mf-t3)", overflowWrap: "anywhere", whiteSpace: "pre-line" }}>{reqText(steamMeta.requirements.recommended)}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {}
        {ordered.length > 0 && (
          <div style={{ marginTop: 24, paddingBottom: 56 }}>
            <button type="button" onClick={() => setSourcesOpen((v) => !v)} className="mf-ghost" style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", padding: "13px 16px", borderRadius: 10, border: "1px solid var(--mf-line)", background: "var(--mf-panel-2)", color: "var(--mf-t2)", cursor: "pointer", textAlign: "left" }}>
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ transition: "transform .15s", transform: sourcesOpen ? "rotate(90deg)" : "rotate(0deg)" }}><polyline points="6 4 11 8 6 12" /></svg>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--mf-t1)" }}>Other download sources</span>
              <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--mf-t4)" }}>{sourceCount} sources · {mirrors} mirrors</span>
              {updatedAny && <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10.5, color: "var(--mf-t5)" }}>updated {updatedAny}</span>}
            </button>

            {sourcesOpen && (
              <>
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                  {ordered.map((src) => {
                    const opts = [...(src.downloadOptions || [])].sort((a, b) => Number(Boolean(b.resolvable)) - Number(Boolean(a.resolvable)))
                    if (!opts.length) return null
                    const direct = sourceDirect(src.sourceId)
                    const upd = relTime(src.updatedAt)
                    return (
                      <div key={`${src.sourceId}:${src.sourceSlug}`} style={{ border: "1px solid var(--mf-line)", borderRadius: 11, background: "var(--mf-panel-2)", overflow: "hidden" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderBottom: "1px solid color-mix(in srgb, var(--mf-t0) 5%, transparent)" }}>
                          <span style={{ width: 7, height: 7, borderRadius: 99, background: direct ? "var(--mf-t2)" : "var(--mf-t3)" }} />
                          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--mf-t0)" }}>{sourceName(src.sourceId)}</span>
                          {upd && <span style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--mf-t5)" }}>{upd}</span>}
                          {src.sourceUrl && (
                            <button type="button" onClick={() => openSourcePage(src.sourceUrl)} className="mf-textbtn" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5, fontFamily: MONO, fontSize: 10.5, color: "var(--mf-t4)", background: "none", border: "none", cursor: "pointer" }}>
                              source page
                              <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M6 3.5H4a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 4 12.5h6a1.5 1.5 0 0 0 1.5-1.5V9" /><polyline points="9 2.5 13 2.5 13 6.5" /><line x1="7" y1="9" x2="13" y2="2.5" /></svg>
                            </button>
                          )}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          {opts.map((opt) => {
                            const k = keyOf({ source: src, option: opt })
                            const st: OptState = optState[k] || "idle"
                            return (
                              <div key={k} style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 16px" }}>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <div style={{ fontSize: 13, color: "var(--mf-t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{opt.label}</div>
                                  <div style={{ fontFamily: MONO, fontSize: 10, color: "var(--mf-t5)", marginTop: 2 }}>
                                    {(opt.resolvable ? "direct" : "browser only") + (opt.sizeText ? ` · ${opt.sizeText}` : opt.sizeBytes ? ` · ${gbLabel(opt.sizeBytes)}` : "")}
                                  </div>
                                </div>
                                <OptionButton state={st} resolvable={opt.resolvable} onClick={() => void handleDownload(src.sourceId, opt, k)} />
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <p style={{ margin: "16px 0 0", fontFamily: MONO, fontSize: 11, color: "var(--mf-t5)" }}>
                  queued downloads appear under <button type="button" onClick={() => navigate("/downloads")} style={{ color: "var(--mf-t2)", textDecoration: "underline", cursor: "pointer", background: "none", border: "none", font: "inherit", padding: 0 }}>downloads</button>.
                </p>
              </>
            )}
          </div>
        )}
      </div>
      {zoomedScreenshot && (
        <ScreenshotLightbox src={zoomedScreenshot} title={game?.title || "Game"} onClose={() => setZoomedScreenshot(null)} />
      )}
      
      {wandOpen && game && (
        <WandTrainerModal
          appid={dlAppid}
          title={game.title}
          steamAppid={game.steamAppId ?? undefined}
          onClose={() => setWandOpen(false)}
          onLaunch={() => requestLaunch({ appid: dlAppid, name: game.title })}
        />
      )}
    </div>
  )
}

function ScreenshotLightbox({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="screenshot-preview-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      style={{ position: "fixed", inset: 0, zIndex: 1000, display: "grid", placeItems: "center", padding: "clamp(16px, 4vw, 48px)", background: "rgba(5,5,5,0.9)", backdropFilter: "blur(12px)", cursor: "zoom-out" }}
    >
      <img src={src} alt={`${title} screenshot`} style={{ display: "block", width: "auto", height: "auto", maxWidth: "calc(100vw - 64px)", maxHeight: "calc(100vh - 118px)", objectFit: "contain", borderRadius: 8, boxShadow: "0 24px 80px rgba(0,0,0,0.55)", cursor: "default" }} />
      <button type="button" autoFocus aria-label="Close screenshot preview" title="Close" onClick={onClose} style={{ position: "fixed", top: 22, right: 22, display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, padding: 0, borderRadius: 9, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(16,16,16,0.78)", color: "rgba(255,255,255,0.9)", cursor: "pointer", backdropFilter: "blur(8px)" }}>
        <X size={17} strokeWidth={1.7} />
      </button>
      <div style={{ position: "fixed", left: 24, right: 24, bottom: 20, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, pointerEvents: "none", textAlign: "center" }}>
        <span id="screenshot-preview-title" style={{ maxWidth: 720, fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.92)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: "rgba(255,255,255,0.48)", letterSpacing: "0.04em", textTransform: "uppercase" }}>screenshot preview · Esc to close</span>
      </div>
    </div>
  )
}

function ExtLink({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={title} onClick={onClick} className="mf-ghost" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", color: "var(--mf-t2)", cursor: "pointer" }}>
      {children}
    </button>
  )
}

function SteamIcon() {
  return <svg viewBox="0 0 16 16" width="17" height="17" fill="currentColor"><path d="M8 1a7 7 0 0 0-6.96 6.2l3.4 1.4a2 2 0 0 1 1.16-.43l1.74-2.53v-.04a2.74 2.74 0 1 1 2.74 2.74h-.06l-2.49 1.78a2 2 0 0 1-3.95.48L.42 9.66A7 7 0 1 0 8 1zm-2.1 9.66.79.33a1.51 1.51 0 1 0 .6-2.06l.82.34a1.11 1.11 0 1 1-.86 2.04l-1.35-.65zm4.8-3.06a1.83 1.83 0 1 0 0-3.66 1.83 1.83 0 0 0 0 3.66zm0-.57a1.26 1.26 0 1 1 0-2.52 1.26 1.26 0 0 1 0 2.52z" /></svg>
}
function SteamDbIcon() {
  return <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round"><ellipse cx="8" cy="4" rx="5" ry="2" /><path d="M3 4v8c0 1.1 2.24 2 5 2s5-.9 5-2V4" /><path d="M3 8c0 1.1 2.24 2 5 2s5-.9 5-2" /></svg>
}
function ProtonDbIcon() {
  return <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.3}><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" /><ellipse cx="8" cy="8" rx="6.2" ry="2.6" /><ellipse cx="8" cy="8" rx="6.2" ry="2.6" transform="rotate(60 8 8)" /><ellipse cx="8" cy="8" rx="6.2" ry="2.6" transform="rotate(120 8 8)" /></svg>
}

function LiveButton({ status, onClick }: { status: string; onClick: () => void }) {
  const failed = status === "failed" || status === "extract_failed"
  const done = status === "completed" || status === "extracted"
  const label = LIVE_LABEL[status] || status
  return (
    <button type="button" onClick={onClick} className="mf-ghost" style={{ display: "flex", alignItems: "center", gap: 9, padding: "12px 22px", borderRadius: 9, border: `1px solid ${failed ? "rgba(221,138,138,0.45)" : "var(--mf-line-2)"}`, background: "transparent", color: failed ? "#dd8a8a" : done ? "#7fcf9b" : "var(--mf-t1)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
      {done
        ? <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 8.5 6.5 12 13 4" /></svg>
        : <Spinner size={15} />}
      {label}
      <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 400, color: "var(--mf-t5)" }}>view in downloads →</span>
    </button>
  )
}

function PrimaryButton({ state, resolvable, sourceLabel, sizeText, label, onClick }: { state: OptState; resolvable: boolean; sourceLabel: string; sizeText?: string; label?: string; onClick: () => void }) {
  const queued = state === "queued"
  const error = state === "error"
  const opened = state === "opened"
  const working = state === "working"
  const filled = !queued && !error
  const actionLabel = queued ? "Queued" : opened ? "Opened in browser" : error ? "Failed" : label || (resolvable ? "Download" : "Open download page")
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={working || queued}
      className="mf-ghost"
      style={{
        display: "flex", alignItems: "center", gap: 9, padding: "12px 22px", borderRadius: 9,
        border: queued ? "1px solid rgba(127,207,155,0.4)" : error ? "1px solid rgba(221,138,138,0.45)" : "none",
        background: filled ? "var(--mf-accent)" : "transparent",
        color: filled ? "var(--mf-accent-ink)" : queued ? "#7fcf9b" : "#dd8a8a",
        fontSize: 14, fontWeight: 600, cursor: working || queued ? "default" : "pointer",
      }}
    >
      {working ? <Spinner size={15} stroke="var(--mf-accent-ink)" />
        : queued ? <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 8.5 6.5 12 13 4" /></svg>
        : resolvable ? <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="2.5" x2="8" y2="10" /><polyline points="4.5 7 8 10.5 11.5 7" /><line x1="3" y1="13.5" x2="13" y2="13.5" /></svg>
        : <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M6 3.5H4a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 4 12.5h6a1.5 1.5 0 0 0 1.5-1.5V9" /><polyline points="9 2.5 13 2.5 13 6.5" /><line x1="7" y1="9" x2="13" y2="2.5" /></svg>}
      {actionLabel}
      <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 400, color: filled ? "rgba(17,17,17,0.6)" : "var(--mf-t5)" }}>
        via {sourceLabel}{sizeText ? ` · ${sizeText}` : ""}{!resolvable ? " · browser" : ""}
      </span>
    </button>
  )
}

function OptionButton({ state, resolvable, onClick }: { state: OptState; resolvable: boolean; onClick: () => void }) {
  const queued = state === "queued"
  const working = state === "working"
  const opened = state === "opened"
  const error = state === "error"
  const label = queued ? "queued" : working ? "…" : opened ? "opened" : error ? "failed" : resolvable ? "download" : "open"
  const color = queued ? "#7fcf9b" : error ? "#dd8a8a" : resolvable ? "var(--mf-t1)" : "var(--mf-t3)"
  const border = queued ? "rgba(127,207,155,0.4)" : error ? "rgba(221,138,138,0.4)" : resolvable ? "color-mix(in srgb, var(--mf-t0) 16%, transparent)" : "var(--mf-line-2)"
  return (
    <button type="button" onClick={onClick} disabled={working || queued} className="mf-ghost" style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 15px", borderRadius: 8, border: `1px solid ${border}`, background: "transparent", color, fontFamily: MONO, fontSize: 11, fontWeight: 500, cursor: working || queued ? "default" : "pointer", whiteSpace: "nowrap" }}>
      {queued ? <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 8.5 6.5 12 13 4" /></svg>
        : resolvable ? <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="2.5" x2="8" y2="10" /><polyline points="4.5 7 8 10.5 11.5 7" /><line x1="3" y1="13.5" x2="13" y2="13.5" /></svg>
        : <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M6 3.5H4a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 4 12.5h6a1.5 1.5 0 0 0 1.5-1.5V9" /><polyline points="9 2.5 13 2.5 13 6.5" /><line x1="7" y1="9" x2="13" y2="2.5" /></svg>}
      {label}
    </button>
  )
}
