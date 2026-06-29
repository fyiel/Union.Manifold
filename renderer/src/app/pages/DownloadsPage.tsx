import { useEffect, useMemo, useState } from "react"
import { useDownloads, type DownloadItem } from "@/context/downloads-context"
import { useGameLaunch } from "@/context/game-launch-context"
import { useToast } from "@/context/toast-context"
import { getDownloadArt, getRememberedGame, hydrateDownloadArt } from "@/lib/sources"
import { proxyImageUrl } from "@/lib/utils"
import { MONO, COVER_LINES, gbLabel, CenterState } from "@/app/manifold/ui"

// Downloads, the live aria2 queue grouped by game. One primary active card, an
// "also running" list, an "up next" queue, completed (install / play), and
// failed (retry). Reuses the real download-manager actions (pauseGroup /
// resumeGroup / cancelGroup / clearCompleted) and installDownloadedArchive.
// Known gaps vs the rich old page (see the "missing screens" handoff list):
// queue drag-reorder, the insufficient-space drive-switch prompt, and
// retry-with-host-reselection (retry here just resumes the group).

const ACTIVE: DownloadItem["status"][] = ["downloading", "extracting", "installing", "verifying", "retrying", "paused"]
const PAUSABLE: DownloadItem["status"][] = ["downloading", "extracting", "installing", "verifying", "retrying"]
const DONE: DownloadItem["status"][] = ["completed", "extracted"]

type Group = { appid: string; name: string; items: DownloadItem[] }

const has = (items: DownloadItem[], ...st: string[]) => items.some((i) => st.includes(i.status))
const every = (items: DownloadItem[], ...st: string[]) => items.every((i) => st.includes(i.status))

// Most-significant status for a group, in display-priority order.
function repStatus(items: DownloadItem[]): DownloadItem["status"] {
  for (const s of ["downloading", "extracting", "installing", "verifying", "retrying", "paused", "install_ready", "queued", "completed", "extracted", "failed", "extract_failed"] as const) {
    if (has(items, s)) return s
  }
  return items[0]?.status || "queued"
}

const STATUS_LABEL: Record<string, string> = {
  downloading: "Downloading", extracting: "Extracting", installing: "Installing", verifying: "Verifying",
  retrying: "Retrying", paused: "Paused", install_ready: "Ready", queued: "Queued", completed: "Completed",
  extracted: "Completed", failed: "Failed", extract_failed: "Failed",
}

function aggregate(items: DownloadItem[]) {
  const received = items.reduce((n, i) => n + (i.receivedBytes || 0), 0)
  const total = items.reduce((n, i) => n + (i.totalBytes || 0), 0)
  const speed = items.reduce((n, i) => n + (i.status === "downloading" ? i.speedBps || 0 : 0), 0)
  const rep = repStatus(items)
  let pct = total > 0 ? (received / total) * 100 : 0
  if (rep === "extracting") {
    const ex = items.find((i) => i.status === "extracting")?.extractProgress
    if (typeof ex === "number") pct = ex <= 1 ? ex * 100 : ex
  }
  const etaRaw = items.filter((i) => i.status === "downloading" && i.etaSeconds != null).map((i) => i.etaSeconds as number)
  const eta = etaRaw.length ? Math.max(...etaRaw) : speed > 0 ? ((total - received) / speed) : null
  return { received, total, speed, pct: Math.min(100, Math.max(0, pct)), rep, eta }
}

const fmtSpeed = (bps: number) => `${(bps / 1e6).toFixed(1)} MB/s`
function fmtEta(sec: number | null) {
  if (sec == null || !isFinite(sec) || sec <= 0) return "—"
  if (sec < 60) return `${Math.round(sec)}s`
  if (sec < 3600) return `${Math.round(sec / 60)}m`
  return `${(sec / 3600).toFixed(1)}h`
}

export function DownloadsPage() {
  const dl = useDownloads()
  const { downloads, pauseGroup, resumeGroup, cancelGroup, pauseAll, resumeAll, clearCompleted, clearByAppid } = dl
  const { requestLaunch } = useGameLaunch()
  const { toast } = useToast()
  const [copied, setCopied] = useState<string | null>(null)
  const [installing, setInstalling] = useState<Set<string>>(new Set())
  // Load persisted thumbnails so downloads restored after a relaunch (whose art
  // was never recorded this session) still show a cover instead of going blank.
  const [, setArtTick] = useState(0)
  useEffect(() => { void hydrateDownloadArt().then(() => setArtTick((t) => t + 1)) }, [])

  const groups = useMemo<Group[]>(() => {
    const m = new Map<string, DownloadItem[]>()
    for (const d of downloads) {
      if (d.status === "cancelled") continue
      const k = d.appid || d.id
      const arr = m.get(k) || []
      arr.push(d)
      m.set(k, arr)
    }
    return [...m.entries()].map(([appid, items]) => ({ appid, name: items[0]?.gameName || appid, items }))
  }, [downloads])

  // Bucket each group. Active wins over everything; then queued, ready, failed, done.
  const { active, queued, completed, failed } = useMemo(() => {
    const active: Group[] = [], queued: Group[] = [], completed: Group[] = [], failed: Group[] = []
    for (const g of groups) {
      if (has(g.items, ...ACTIVE)) active.push(g)
      else if (every(g.items, "queued")) queued.push(g)
      else if (has(g.items, "install_ready") || every(g.items, ...DONE)) completed.push(g)
      else if (has(g.items, "failed", "extract_failed")) failed.push(g)
    }
    // Most-active group first.
    const rank = (g: Group) => PAUSABLE.indexOf(repStatus(g.items) as any)
    active.sort((a, b) => {
      const ra = rank(a), rb = rank(b)
      return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb) || aggregate(b.items).total - aggregate(a.items).total
    })
    return { active, queued, completed, failed }
  }, [groups])

  const primary = active[0] || null
  const running = active.slice(1)

  const totalSpeed = useMemo(() => active.reduce((n, g) => n + aggregate(g.items).speed, 0), [active])
  const anyPausable = active.some((g) => has(g.items, ...PAUSABLE))
  const allPaused = active.length > 0 && active.every((g) => repStatus(g.items) === "paused")

  const copyLink = async (g: Group) => {
    const url = g.items[0]?.originalUrl || g.items[0]?.url
    if (!url) return
    try { await navigator.clipboard.writeText(url); setCopied(g.appid); setTimeout(() => setCopied((c) => (c === g.appid ? null : c)), 1600) } catch { /* ignore */ }
  }
  const togglePause = (g: Group) => { if (has(g.items, ...PAUSABLE)) void pauseGroup(g.appid); else void resumeGroup(g.appid) }
  const install = async (appid: string) => {
    if (!window.ucDownloads?.installDownloadedArchive) return
    setInstalling((s) => new Set(s).add(appid))
    try {
      clearByAppid(appid)
      const res = await window.ucDownloads.installDownloadedArchive(appid)
      if (res?.code === "INSUFFICIENT_SPACE" || res?.error === "insufficient_space") toast("Not enough disk space to install.", "error")
      else if (!res?.ok) toast(res?.error || "Failed to install.", "error")
    } catch (err) {
      toast(String(err), "error")
    } finally {
      setInstalling((s) => { const n = new Set(s); n.delete(appid); return n })
    }
  }

  const empty = !primary && !running.length && !queued.length && !completed.length && !failed.length

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* header */}
      <header style={{ flexShrink: 0, padding: "26px 36px 18px", borderBottom: "1px solid var(--mf-line)" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "#ededed", letterSpacing: "-0.015em" }}>Downloads</h1>
            <p style={{ margin: "6px 0 0", fontFamily: MONO, fontSize: 11.5, color: "var(--mf-t4)" }}>
              {active.length} active · {queued.length} queued · {totalSpeed > 0 ? fmtSpeed(totalSpeed) : "idle"}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {completed.length > 0 && (
              <button type="button" onClick={() => clearCompleted()} className="mf-textbtn" style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.09)", background: "transparent", color: "var(--mf-t3)", fontSize: 12, fontWeight: 500, cursor: "pointer" }}>Clear completed</button>
            )}
            {active.length > 0 && (
              <button type="button" onClick={() => (allPaused ? void resumeAll() : void pauseAll())} className="mf-ghost" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "#1d1d1d", color: "var(--mf-t1)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                {allPaused ? <PlayIcon /> : <PauseIcon />}
                {allPaused ? "Resume all" : "Pause all"}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* scroller */}
      <div className="mf-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "24px 36px 44px" }}>
        {empty ? (
          <CenterState>
            <svg viewBox="0 0 16 16" width="30" height="30" fill="none" stroke="#4a4a4a" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="2.5" x2="8" y2="9.5" /><polyline points="5 7 8 10 11 7" /><line x1="3" y1="13.5" x2="13" y2="13.5" /></svg>
            <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--mf-t5)" }}>nothing downloading — queue something from Browse</span>
          </CenterState>
        ) : (
          <>
            {/* primary active */}
            {primary && (() => {
              const a = aggregate(primary.items)
              const isCopied = copied === primary.appid
              const paused = a.rep === "paused"
              return (
                <div style={{ border: "1px solid var(--mf-line-2)", borderRadius: 14, background: "var(--mf-panel)", padding: "20px 22px", marginBottom: 28 }}>
                  <div style={{ display: "flex", gap: 18 }}>
                    <Cover appid={primary.appid} w={84} h={112} r={9} border />
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontSize: 18, fontWeight: 700, color: "#f4f4f4", letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{primary.name}</span>
                        <span style={{ padding: "4px 10px", borderRadius: 99, background: "rgba(255,255,255,0.08)", border: "1px solid var(--mf-line-2)", fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--mf-t2)", flexShrink: 0 }}>{STATUS_LABEL[a.rep]}</span>
                      </div>
                      <div style={{ marginTop: 18, height: 8, borderRadius: 99, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${a.pct}%`, background: "#e9e9e9", borderRadius: 99, transition: "width .5s linear" }} />
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 26, marginTop: 14, fontFamily: MONO, fontSize: 12, color: "var(--mf-t3)" }}>
                        <span style={{ color: "var(--mf-t1)", fontWeight: 500 }}>{Math.round(a.pct)}%</span>
                        {a.total > 0 && <span>{gbLabel(a.received)} / {gbLabel(a.total)}</span>}
                        <span>{paused ? "paused" : a.speed > 0 ? fmtSpeed(a.speed) : "—"}</span>
                        <span>ETA {paused ? "—" : fmtEta(a.eta)}</span>
                        <div style={{ marginLeft: "auto", display: "flex", gap: 9 }}>
                          <button type="button" onClick={() => void copyLink(primary)} className="mf-ghost" style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 8, border: `1px solid ${isCopied ? "rgba(127,207,155,0.4)" : "var(--mf-line-2)"}`, background: "transparent", color: isCopied ? "#7fcf9b" : "var(--mf-t2)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                            {isCopied ? <CheckIcon /> : <CopyIcon />}{isCopied ? "Copied" : "Copy link"}
                          </button>
                          <button type="button" onClick={() => togglePause(primary)} className="mf-ghost" style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 16px", borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t1)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                            {paused ? <PlayIcon /> : <PauseIcon />}{paused ? "Resume" : "Pause"}
                          </button>
                          <button type="button" title="cancel" onClick={() => void cancelGroup(primary.appid)} className="mf-iconcircle" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t4)", cursor: "pointer" }}><XIcon /></button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* also running */}
            {running.length > 0 && (
              <Section title="Also running">
                {running.map((g) => {
                  const a = aggregate(g.items)
                  const paused = a.rep === "paused"
                  const detail = paused
                    ? `paused${a.total > 0 ? ` · ${gbLabel(a.received)} / ${gbLabel(a.total)}` : ""}`
                    : a.rep === "extracting" ? `unpacking · ${Math.round(a.pct)}%`
                    : `${a.speed > 0 ? `${fmtSpeed(a.speed)} · ` : ""}${a.total > 0 ? `${gbLabel(a.received)} / ${gbLabel(a.total)}` : ""}`
                  return (
                    <div key={g.appid} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", border: "1px solid var(--mf-line)", borderRadius: 11, background: "var(--mf-panel-2)" }}>
                      <Cover appid={g.appid} w={34} h={44} r={6} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 600, color: "#ededed", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</span>
                          <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--mf-t4)" }}>{STATUS_LABEL[a.rep]}</span>
                          <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10.5, color: "var(--mf-t3)" }}>{detail}</span>
                        </div>
                        <div style={{ marginTop: 9, height: 4, borderRadius: 99, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${a.pct}%`, background: "#e9e9e9", borderRadius: 99, transition: "width .5s linear" }} />
                        </div>
                      </div>
                      <button type="button" title={paused ? "Resume" : "Pause"} onClick={() => togglePause(g)} className="mf-iconcircle" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t3)", cursor: "pointer", flexShrink: 0 }}>
                        {paused ? <PlayIcon /> : <PauseIcon />}
                      </button>
                    </div>
                  )
                })}
              </Section>
            )}

            {/* up next */}
            {queued.length > 0 && (
              <Section title={`Up next · ${queued.length}`}>
                {queued.map((g, i) => {
                  const total = g.items.reduce((n, it) => n + (it.totalBytes || 0), 0)
                  return (
                    <div key={g.appid} style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 14px", border: "1px solid var(--mf-line)", borderRadius: 10, background: "#171717" }}>
                      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--mf-t6)", flexShrink: 0 }}><GripIcon /></span>
                      <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--mf-t5)", width: 18 }}>{String(i + 1).padStart(2, "0")}</span>
                      <Cover appid={g.appid} w={30} h={40} r={5} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: "var(--mf-t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</span>
                      <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--mf-t4)" }}>{total > 0 ? gbLabel(total) : "—"}</span>
                      <button type="button" title="remove" onClick={() => void cancelGroup(g.appid)} className="mf-iconcircle" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 7, border: "none", background: "transparent", color: "var(--mf-t4)", cursor: "pointer", flexShrink: 0 }}><XIcon size={13} /></button>
                    </div>
                  )
                })}
              </Section>
            )}

            {/* completed */}
            {completed.length > 0 && (
              <Section title="Completed">
                {completed.map((g) => {
                  const total = g.items.reduce((n, it) => n + (it.totalBytes || 0), 0)
                  const ready = has(g.items, "install_ready")
                  const busy = installing.has(g.appid)
                  return (
                    <div key={g.appid} style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 16px", border: "1px solid var(--mf-line)", borderRadius: 10, background: "#171717" }}>
                      <Cover appid={g.appid} w={30} h={40} r={5} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--mf-t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</div>
                        <div style={{ fontFamily: MONO, fontSize: 10, color: "var(--mf-t5)", marginTop: 2 }}>{ready ? "ready to install" : "installed"}{total > 0 ? ` · ${gbLabel(total)}` : ""}</div>
                      </div>
                      {ready ? (
                        <button type="button" disabled={busy} onClick={() => void install(g.appid)} className="mf-ghost" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, height: 32, padding: "0 16px", borderRadius: 7, border: "none", background: "#e9e9e9", color: "#111", fontSize: 12, fontWeight: 600, cursor: busy ? "default" : "pointer", flexShrink: 0, opacity: busy ? 0.7 : 1 }}>
                          <DownIcon />{busy ? "Installing…" : "Install"}
                        </button>
                      ) : (
                        <button type="button" onClick={() => void requestLaunch({ appid: g.appid, name: g.name })} className="mf-ghost" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, height: 32, padding: "0 16px", borderRadius: 7, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t1)", fontSize: 12, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>
                          <PlayIcon />Play
                        </button>
                      )}
                    </div>
                  )
                })}
              </Section>
            )}

            {/* failed */}
            {failed.length > 0 && (
              <Section title="Failed">
                {failed.map((g) => {
                  const err = g.items.find((i) => i.error)?.error || "download failed"
                  return (
                    <div key={g.appid} style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 16px", border: "1px solid rgba(220,120,120,0.18)", borderRadius: 10, background: "#1b1717" }}>
                      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 40, flexShrink: 0, color: "#c98080" }}>
                        <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="6" /><line x1="8" y1="5" x2="8" y2="9" /><circle cx="8" cy="11.3" r="0.7" fill="currentColor" stroke="none" /></svg>
                      </span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--mf-t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</div>
                        <div style={{ fontFamily: MONO, fontSize: 10, color: "#b07a7a", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{err}</div>
                      </div>
                      <button type="button" onClick={() => void resumeGroup(g.appid)} className="mf-ghost" style={{ display: "flex", alignItems: "center", gap: 7, height: 32, padding: "0 15px", borderRadius: 7, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t1)", fontSize: 12, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>
                        <RetryIcon />Retry
                      </button>
                      <button type="button" title="cancel" onClick={() => void cancelGroup(g.appid)} className="mf-iconcircle" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 7, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t4)", cursor: "pointer", flexShrink: 0 }}><XIcon size={13} /></button>
                    </div>
                  )
                })}
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// Cover for a queued/active game, the art we stashed when enqueuing, else the
// striped placeholder.
function Cover({ appid, w, h, r, border }: { appid: string; w: number; h: number; r: number; border?: boolean }) {
  // Recorded enqueue art first, then any in-session resolved game for this appid.
  const img = getDownloadArt(appid)?.image || getRememberedGame(appid)?.image
  return (
    <div style={{ width: w, height: h, borderRadius: r, flexShrink: 0, overflow: "hidden", background: img ? "#0f0f0f" : COVER_LINES, border: border ? "1px solid var(--mf-line)" : undefined }}>
      {img && <img src={proxyImageUrl(img)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--mf-t5)", marginBottom: 11 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>{children}</div>
    </div>
  )
}

const PlayIcon = () => <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M5 3.5v9l8-4.5z" /></svg>
const PauseIcon = () => <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><rect x="4" y="3" width="3" height="10" rx="1" /><rect x="9" y="3" width="3" height="10" rx="1" /></svg>
const DownIcon = () => <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="2.5" x2="8" y2="10" /><polyline points="4.5 7 8 10.5 11.5 7" /><line x1="3" y1="13.5" x2="13" y2="13.5" /></svg>
const RetryIcon = () => <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M13 8a5 5 0 1 1-1.5-3.5" /><polyline points="13 2.5 13 5 10.5 5" /></svg>
const CheckIcon = () => <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 8.5 6.5 12 13 4" /></svg>
const CopyIcon = () => <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M3.5 10.5h-.5a1.5 1.5 0 0 1-1.5-1.5v-6A1.5 1.5 0 0 1 3 1.5h6A1.5 1.5 0 0 1 10.5 3v.5" /></svg>
const XIcon = ({ size = 14 }: { size?: number }) => <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round"><line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" /></svg>
const GripIcon = () => <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><circle cx="6" cy="4" r="1.1" /><circle cx="10" cy="4" r="1.1" /><circle cx="6" cy="8" r="1.1" /><circle cx="10" cy="8" r="1.1" /><circle cx="6" cy="12" r="1.1" /><circle cx="10" cy="12" r="1.1" /></svg>
