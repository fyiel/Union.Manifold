import { useCallback, useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import { Check, ChevronDown, RefreshCw, Search, Sparkles, TriangleAlert, Trophy } from "lucide-react"
import { COVER_LINES, MONO, SmartImage, gameImageCandidates } from "@/app/manifold/ui"
import { proxyImageUrl } from "@/lib/utils"

const FILTERS = ["all", "progress", "complete"] as const
type Filter = (typeof FILTERS)[number]

function completion(game: LocalAchievementGame) {
  const total = game.achievements.length
  const unlocked = game.achievements.filter((achievement) => achievement.unlocked).length
  return { total, unlocked, percent: total ? Math.round((unlocked / total) * 100) : 0 }
}

function formatUnlockTime(value?: number | null) {
  if (!value) return "Unlocked"
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value))
}

export function AchievementsPage() {
  const [games, setGames] = useState<LocalAchievementGame[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  const load = useCallback(async () => {
    try {
      const result = await window.ucAchievements?.list?.()
      if (!result?.ok) throw new Error(result?.error || "Achievement service unavailable")
      setGames(result.games || [])
      setError("")
      setExpanded((current) => current || result.games?.[0]?.appid || null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load achievements")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const offUpdated = window.ucAchievements?.onUpdated?.(() => void load())
    const offUnlocked = window.ucAchievements?.onUnlocked?.(() => void load())
    return () => {
      offUpdated?.()
      offUnlocked?.()
    }
  }, [load])

  const totals = useMemo(() => {
    let achievements = 0
    let unlocked = 0
    let perfect = 0
    for (const game of games) {
      const progress = completion(game)
      achievements += progress.total
      unlocked += progress.unlocked
      if (progress.total > 0 && progress.unlocked === progress.total) perfect += 1
    }
    return {
      achievements,
      unlocked,
      perfect,
      percent: achievements ? Math.round((unlocked / achievements) * 100) : 0,
    }
  }, [games])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return games.filter((game) => {
      const progress = completion(game)
      if (filter === "complete" && (!progress.total || progress.unlocked !== progress.total)) return false
      if (filter === "progress" && progress.total && progress.unlocked === progress.total) return false
      if (!needle) return true
      return game.title.toLowerCase().includes(needle)
        || game.achievements.some((achievement) => achievement.displayName.toLowerCase().includes(needle))
    })
  }, [filter, games, query])

  const testNotification = async () => {
    setTesting(true)
    try {
      const result = await window.ucAchievements?.testNotification?.()
      if (!result?.ok) setError(result?.error || "Could not show the test notification")
    } finally {
      window.setTimeout(() => setTesting(false), 700)
    }
  }

  return (
    <div className="mf-scroll" style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto", padding: "44px 46px 64px" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 28, marginBottom: 30 }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.17em", textTransform: "uppercase", color: "var(--mf-t5)", marginBottom: 9 }}>Local game records</div>
            <h1 style={{ margin: 0, fontSize: 30, lineHeight: 1.05, fontWeight: 650, letterSpacing: "-0.035em", color: "var(--mf-t0)" }}>Achievements</h1>
            <p style={{ maxWidth: 590, margin: "11px 0 0", fontFamily: MONO, fontSize: 11.5, lineHeight: 1.65, color: "var(--mf-t4)" }}>
              Unlocks detected from each game&apos;s local Steam-compatible achievement data. Your progress stays on this device.
            </p>
          </div>
          <button
            type="button"
            className="mf-ghost"
            onClick={() => void testNotification()}
            disabled={testing}
            style={{ display: "flex", alignItems: "center", gap: 8, height: 36, padding: "0 14px", borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t2)", fontSize: 11.5, fontWeight: 600, cursor: testing ? "default" : "pointer", opacity: testing ? 0.6 : 1, whiteSpace: "nowrap" }}
          >
            <Sparkles size={13} strokeWidth={1.7} />{testing ? "Showing…" : "Test popup"}
          </button>
        </header>

        <div role="status" style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 20, padding: "10px 13px", borderRadius: 9, border: "1px solid rgba(239,68,68,0.28)", background: "rgba(239,68,68,0.08)", color: "#f87171" }}>
          <TriangleAlert size={15} strokeWidth={1.8} style={{ flexShrink: 0 }} />
          <span style={{ fontFamily: MONO, fontSize: 10.5, lineHeight: 1.5 }}>Experimental: some games may miss unlocks or show stale progress.</span>
        </div>

        <section style={{ display: "grid", gridTemplateColumns: "minmax(230px, 1.65fr) repeat(3, minmax(120px, 1fr))", border: "1px solid var(--mf-line)", borderRadius: 12, overflow: "hidden", background: "var(--mf-panel)", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "18px 20px", borderRight: "1px solid var(--mf-line)" }}>
            <ProgressRing percent={totals.percent} />
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 650, color: "var(--mf-t1)" }}>Overall completion</div>
              <div style={{ marginTop: 4, fontFamily: MONO, fontSize: 10.5, color: "var(--mf-t4)" }}>{totals.unlocked} of {totals.achievements} unlocked</div>
            </div>
          </div>
          <Stat value={games.length} label="games tracked" />
          <Stat value={totals.unlocked} label="unlocked" />
          <Stat value={totals.perfect} label="perfect games" last />
        </section>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <label style={{ position: "relative", flex: 1, maxWidth: 430 }}>
            <Search size={14} strokeWidth={1.6} color="var(--mf-t5)" style={{ position: "absolute", left: 13, top: 11 }} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search games or achievements"
              style={{ width: "100%", height: 36, padding: "0 13px 0 37px", borderRadius: 8, border: "1px solid var(--mf-line-2)", outline: "none", background: "var(--mf-panel)", color: "var(--mf-t1)", fontFamily: MONO, fontSize: 11 }}
            />
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 2, padding: 3, borderRadius: 8, border: "1px solid var(--mf-line)", background: "var(--mf-panel)" }}>
            {FILTERS.map((item) => (
              <button
                type="button"
                key={item}
                onClick={() => setFilter(item)}
                style={{ height: 28, padding: "0 11px", border: "none", borderRadius: 6, background: filter === item ? "color-mix(in srgb, var(--mf-t0) 9%, transparent)" : "transparent", color: filter === item ? "var(--mf-t1)" : "var(--mf-t5)", fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.04em", textTransform: "capitalize", cursor: "pointer" }}
              >
                {item === "progress" ? "In progress" : item}
              </button>
            ))}
          </div>
          <button type="button" title="Refresh" className="mf-iconcircle" onClick={() => void load()} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t4)", cursor: "pointer" }}>
            <RefreshCw size={13} strokeWidth={1.7} />
          </button>
        </div>

        {loading ? (
          <PageState icon={<Trophy size={22} strokeWidth={1.4} />} title="Reading local progress" body="Looking for achievement data from your installed games." />
        ) : error && games.length === 0 ? (
          <PageState icon={<Trophy size={22} strokeWidth={1.4} />} title="Achievements unavailable" body={error} />
        ) : games.length === 0 ? (
          <PageState icon={<Trophy size={22} strokeWidth={1.4} />} title="No local achievements yet" body="Launch a game that includes Goldberg, GSE, CODEX, SSE, or another Steam-compatible local achievement store. Manifold starts tracking as soon as the game runs." />
        ) : filtered.length === 0 ? (
          <PageState icon={<Search size={21} strokeWidth={1.4} />} title="No matching records" body="Try a different search or completion filter." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {error && <div style={{ padding: "9px 12px", borderRadius: 8, border: "1px solid var(--mf-line)", color: "var(--mf-t4)", fontFamily: MONO, fontSize: 10.5 }}>{error}</div>}
            {filtered.map((game) => (
              <GameRecord
                key={game.appid}
                game={game}
                expanded={expanded === game.appid}
                onToggle={() => setExpanded((current) => current === game.appid ? null : game.appid)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ value, label, last }: { value: number; label: string; last?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "17px 18px", borderRight: last ? "none" : "1px solid var(--mf-line)" }}>
      <span style={{ fontSize: 21, lineHeight: 1, fontWeight: 650, letterSpacing: "-0.025em", color: "var(--mf-t0)" }}>{value}</span>
      <span style={{ marginTop: 6, fontFamily: MONO, fontSize: 9.5, color: "var(--mf-t5)", letterSpacing: "0.04em" }}>{label}</span>
    </div>
  )
}

function ProgressRing({ percent }: { percent: number }) {
  const radius = 22
  const circumference = Math.PI * 2 * radius
  const offset = circumference - (circumference * percent) / 100
  return (
    <div style={{ position: "relative", width: 54, height: 54, flexShrink: 0 }}>
      <svg viewBox="0 0 54 54" width="54" height="54" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="27" cy="27" r={radius} fill="none" stroke="color-mix(in srgb, var(--mf-t0) 7%, transparent)" strokeWidth="3" />
        <circle cx="27" cy="27" r={radius} fill="none" stroke="var(--mf-t1)" strokeWidth="3" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} />
      </svg>
      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: 10, color: "var(--mf-t2)" }}>{percent}%</span>
    </div>
  )
}

function GameRecord({ game, expanded, onToggle }: { game: LocalAchievementGame; expanded: boolean; onToggle: () => void }) {
  const progress = completion(game)
  const awaitingData = progress.total === 0 && !game.catalogComplete
  const candidates = gameImageCandidates({ image: game.image || undefined, steamAppId: game.steamAppId }, { steamFirst: true })
  return (
    <article style={{ border: "1px solid var(--mf-line)", borderRadius: 12, overflow: "hidden", background: "var(--mf-panel)" }}>
      <button type="button" onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 16, width: "100%", minHeight: 88, padding: "11px 16px 11px 11px", border: "none", background: "transparent", color: "inherit", textAlign: "left", cursor: "pointer" }}>
        <div style={{ position: "relative", width: 48, height: 66, flexShrink: 0, borderRadius: 6, overflow: "hidden", background: COVER_LINES, border: "1px solid var(--mf-line)" }}>
          <SmartImage candidates={candidates} steamAppId={game.steamAppId} name={game.title} alt="" lazy style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: 14.5, fontWeight: 650, color: "var(--mf-t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{game.title}</span>
            {!game.catalogComplete && <span style={{ padding: "2px 6px", borderRadius: 4, border: "1px solid var(--mf-line-2)", fontFamily: MONO, fontSize: 8.5, color: "var(--mf-t5)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{awaitingData ? "awaiting data" : "unlocks only"}</span>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6, fontFamily: MONO, fontSize: 9.5, color: "var(--mf-t5)" }}>
            <span>{awaitingData ? "No achievement data yet" : `${progress.unlocked} / ${progress.total} unlocked`}</span>
            <span style={{ opacity: 0.45 }}>·</span>
            <span>{game.provider}</span>
          </div>
          <div style={{ width: "100%", maxWidth: 420, height: 3, marginTop: 11, borderRadius: 99, background: "color-mix(in srgb, var(--mf-t0) 7%, transparent)", overflow: "hidden" }}>
            <div style={{ width: `${progress.percent}%`, height: "100%", borderRadius: 99, background: "var(--mf-t1)", transition: "width 240ms ease" }} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
          <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--mf-t3)" }}>{progress.percent}%</span>
          <ChevronDown size={15} strokeWidth={1.6} color="var(--mf-t5)" style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 160ms ease" }} />
        </div>
      </button>
      {expanded && (
        <div style={{ padding: "3px 12px 14px", borderTop: "1px solid var(--mf-line)" }}>
          {!game.catalogComplete && (
            <div style={{ padding: "10px 4px 11px", fontFamily: MONO, fontSize: 9.5, lineHeight: 1.5, color: "var(--mf-t5)" }}>
              {awaitingData ? "No local achievement catalog or unlock state has been found yet. Manifold will update this record when the game writes one." : "This game exposes unlock state but no local achievement catalog. Only achievements already observed can be shown."}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))", gap: 8, paddingTop: game.catalogComplete ? 11 : 0 }}>
            {game.achievements.map((achievement) => <AchievementCard key={achievement.apiName} achievement={achievement} />)}
          </div>
        </div>
      )}
    </article>
  )
}

function AchievementCard({ achievement }: { achievement: LocalAchievement }) {
  const concealed = achievement.hidden && !achievement.unlocked
  const name = concealed ? "Hidden achievement" : achievement.displayName
  const description = concealed ? "Keep playing to discover this achievement." : achievement.description
  const icon = achievement.unlocked ? achievement.icon : achievement.iconLocked || achievement.icon
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 76, padding: 10, borderRadius: 9, border: "1px solid var(--mf-line)", background: achievement.unlocked ? "color-mix(in srgb, var(--mf-t0) 3.5%, var(--mf-panel-2))" : "var(--mf-panel-2)", opacity: achievement.unlocked ? 1 : 0.68 }}>
      <div style={{ position: "relative", width: 50, height: 50, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 7, overflow: "hidden", background: COVER_LINES, border: "1px solid var(--mf-line-2)" }}>
        {icon ? <SmartImage candidates={[proxyImageUrl(icon)]} alt="" lazy style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", filter: achievement.unlocked ? "none" : "grayscale(1)" }} /> : <Trophy size={18} strokeWidth={1.35} color="var(--mf-t5)" />}
        {achievement.unlocked && <span style={{ position: "absolute", right: 3, bottom: 3, display: "flex", alignItems: "center", justifyContent: "center", width: 15, height: 15, borderRadius: 99, background: "var(--mf-t0)", color: "var(--mf-bg)" }}><Check size={9} strokeWidth={2.5} /></span>}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 620, color: achievement.unlocked ? "var(--mf-t1)" : "var(--mf-t3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
        {description && <div style={{ marginTop: 4, fontFamily: MONO, fontSize: 9.5, lineHeight: 1.4, color: "var(--mf-t5)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{description}</div>}
        {achievement.unlocked && <div style={{ marginTop: 5, fontFamily: MONO, fontSize: 8.5, color: "var(--mf-t4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{formatUnlockTime(achievement.unlockedAt)}</div>}
      </div>
    </div>
  )
}

function PageState({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 310, padding: "48px 24px", border: "1px dashed var(--mf-line-2)", borderRadius: 12, textAlign: "center" }}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 48, height: 48, borderRadius: 12, border: "1px solid var(--mf-line)", color: "var(--mf-t4)", marginBottom: 15 }}>{icon}</span>
      <div style={{ fontSize: 14, fontWeight: 650, color: "var(--mf-t2)" }}>{title}</div>
      <p style={{ maxWidth: 520, margin: "8px 0 0", fontFamily: MONO, fontSize: 10.5, lineHeight: 1.65, color: "var(--mf-t5)" }}>{body}</p>
    </div>
  )
}
