"use client"

import React, { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { useDiscordAccount } from "@/hooks/use-discord-account"
import { apiFetch } from "@/lib/api"
import { CheckCircle2, AlertCircle, Pin, Monitor, LifeBuoy, MessageSquare } from "lucide-react"
import { Loader2, Send, Terminal } from "@/components/icons"
import { useNavigate } from "react-router-dom"

const WEB_BASE_URL = "https://union-crax.xyz"

const RATING_LABELS: Record<number, string> = {
  1: "Broken",
  2: "Barely runs",
  3: "Playable",
  4: "Works great",
  5: "Perfect",
}

const RATING_COLORS: Record<number, string> = {
  1: "text-red-500",
  2: "text-orange-500",
  3: "text-yellow-500",
  4: "text-emerald-500",
  5: "text-sky-500",
}

const RATING_PILLS: Record<number, string> = {
  1: "bg-red-500/10 text-red-300 border-red-500/25",
  2: "bg-orange-500/10 text-orange-300 border-orange-500/25",
  3: "bg-yellow-500/10 text-yellow-300 border-yellow-500/25",
  4: "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
  5: "bg-sky-500/10 text-sky-300 border-sky-500/25",
}

type Stats = {
  count: number
  average: number
  distribution: Record<number, number>
}

function openWeb(path: string) {
  try { window.ucSystem?.openExternal?.(`${WEB_BASE_URL}${path}`) } catch { /* ignore */ }
}

function StarRating({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const display = hovered ?? value ?? 0
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          type="button"
          key={n}
          onClick={() => onChange(n)}
          onMouseEnter={() => setHovered(n)}
          onMouseLeave={() => setHovered(null)}
          className={`transition-all text-2xl ${n <= display ? "text-yellow-500 scale-110" : "text-muted-foreground/20"} hover:scale-125`}
          aria-label={RATING_LABELS[n]}
        >
          ★
        </button>
      ))}
      {display > 0 && (
        <span className={`ml-2 text-sm font-medium ${RATING_COLORS[display]}`}>
          {RATING_LABELS[display]}
        </span>
      )}
    </div>
  )
}

function StaticStars({ value, size = "text-base" }: { value: number; size?: string }) {
  return (
    <div className={`inline-flex items-center ${size}`} aria-label={`${value.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = Math.max(0, Math.min(1, value - (n - 1)))
        return (
          <span key={n} className="relative inline-block leading-none text-muted-foreground/20">
            ★
            <span className="absolute inset-0 overflow-hidden text-yellow-500" style={{ width: `${fill * 100}%` }}>
              ★
            </span>
          </span>
        )
      })}
    </div>
  )
}

function ExperienceCard({ exp }: { exp: any }) {
  const rating = exp.rating as number
  const isPinned = exp.pinned === true
  const proton = exp.proton_version || exp.protonVersion
  const distro: string = exp.distro || ""
  const isWindows = distro.toLowerCase() === "windows"
  const date = exp.created_at
    ? new Date(exp.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : ""
  return (
    <div className={`group relative rounded-2xl border px-4 py-3.5 transition-colors ${isPinned
        ? "bg-sky-500/[.06] border-sky-500/25"
        : "bg-white/[.02] border-white/[.07] hover:bg-white/[.04]"
      }`}>
      <div className="flex items-start gap-3">
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${isWindows
            ? "bg-cyan-500/10 border-cyan-500/20 text-cyan-300"
            : "bg-sky-500/10 border-sky-500/20 text-sky-300"
          }`}>
          {isWindows ? <Monitor className="h-4 w-4" /> : <Terminal className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <span className="truncate text-sm font-semibold text-foreground">{distro || "Player report"}</span>
              {proton && (
                <span className="shrink-0 rounded-md bg-white/[.05] border border-white/[.07] px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {proton}
                </span>
              )}
              {isPinned && (
                <span className="shrink-0 inline-flex items-center gap-1 rounded-md bg-sky-500/15 border border-sky-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300">
                  <Pin className="h-2.5 w-2.5" /> Pinned
                </span>
              )}
            </div>
            <span className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${RATING_PILLS[rating] || "bg-white/5 border-white/10 text-muted-foreground"}`}>
              <span className="text-[10px]">★</span>
              {RATING_LABELS[rating] || `${rating}/5`}
            </span>
          </div>
          {exp.notes && (
            <p className="text-sm text-muted-foreground leading-relaxed">{exp.notes}</p>
          )}
          {date && <div className="text-[11px] text-muted-foreground/50">{date}</div>}
        </div>
      </div>
    </div>
  )
}

/**
 * Combined per-game rating + experience panel (launcher copy). Mirrors the
 * website's redesign so both surfaces read identically: members rate how well
 * the game runs (1–5 stars), optionally add Linux distro/Proton details, and a
 * low rating surfaces a "get help" callout that opens the forums / Discord in
 * the browser. `onLeaveComment` lets GameDetailPage jump to the comment box.
 */
export function GameExperience({
  appid,
  gameName,
  onLeaveComment,
}: {
  appid: string
  gameName?: string
  onLeaveComment?: () => void
}) {
  const navigate = useNavigate()
  const [experiences, setExperiences] = useState<any[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loadingExp, setLoadingExp] = useState(true)
  const [platform, setPlatform] = useState<"windows" | "linux">("windows")
  const [distro, setDistro] = useState("")
  const [protonVersion, setProtonVersion] = useState("")
  const [rating, setRating] = useState<number | null>(null)
  const [notes, setNotes] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [hasRated, setHasRated] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const { user, loading: authLoading } = useDiscordAccount()

  const fetchExperiences = () => {
    if (!appid) return
    setLoadingExp(true)
    apiFetch(`/api/experiences/${appid}`)
      .then((r) => r.json())
      .then((j) => {
        if (j?.success) {
          setExperiences(j.experiences || [])
          if (j.stats) setStats(j.stats as Stats)
          if (j.myRating) {
            setHasRated(true)
            setRating(j.myRating.rating)
            const d = (j.myRating.distro || "").toLowerCase()
            if (d === "windows") {
              setPlatform("windows")
              setDistro("")
            } else {
              setPlatform("linux")
              setDistro(j.myRating.distro || "")
            }
            setProtonVersion(j.myRating.proton_version || "")
            setNotes(j.myRating.notes || "")
          }
        }
      })
      .catch(() => { })
      .finally(() => setLoadingExp(false))
  }

  useEffect(() => { fetchExperiences() }, [appid])

  const aggregate = useMemo<Stats>(() => {
    if (stats) return stats
    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    let sum = 0
    for (const e of experiences) {
      const r = Number(e.rating)
      if (r >= 1 && r <= 5) { distribution[r] += 1; sum += r }
    }
    const count = experiences.length
    return { count, average: count ? sum / count : 0, distribution }
  }, [stats, experiences])

  const isBadRating = rating !== null && rating <= 2

  const submit = async () => {
    setSubmitError(null)
    if (!user) return
    const resolvedDistro = platform === "linux" ? distro.trim() : "Windows"
    if (rating === null) {
      setSubmitError("Please select a rating.")
      return
    }
    if (platform === "linux" && !resolvedDistro) {
      setSubmitError("Please enter your Linux distribution.")
      return
    }
    setSubmitting(true)
    try {
      const res = await apiFetch(`/api/experiences/${appid}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          distro: resolvedDistro,
          protonVersion: platform === "linux" ? protonVersion.trim() : "",
          rating,
          notes: notes.trim(),
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setSubmitError(json.error || "Failed to submit. Please try again.")
      } else {
        if (json.updated) setHasRated(true)
        setSubmitted(true)
        if (!json.updated && !hasRated) {
          setDistro("")
          setProtonVersion("")
          setRating(null)
          setNotes("")
        }
        fetchExperiences()
      }
    } catch {
      setSubmitError("Network error. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      id="game-experience"
      className="rounded-2xl bg-black/40 border border-white/10 backdrop-blur-md shadow-xl overflow-hidden scroll-mt-24"
    >
      {/* Header + aggregate rating — always visible so every game reads as
          having a rating, not a buried accordion. */}
      <div className="px-6 py-5 border-b border-white/10 bg-white/5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-yellow-500 text-lg leading-none">★</span>
          <h3 className="text-base font-bold text-foreground">Ratings &amp; Experiences</h3>
          <Badge className="ml-auto text-xs bg-white/10 border-white/10 text-foreground/80 border font-medium">
            {aggregate.count} {aggregate.count === 1 ? "rating" : "ratings"}
          </Badge>
        </div>

        {aggregate.count > 0 ? (
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-center gap-3 shrink-0">
              <div className="text-4xl font-black text-foreground tabular-nums leading-none">
                {aggregate.average.toFixed(1)}
              </div>
              <div className="space-y-1">
                <StaticStars value={aggregate.average} size="text-lg" />
                <div className="text-[11px] text-muted-foreground">
                  from {aggregate.count} {aggregate.count === 1 ? "player" : "players"}
                </div>
              </div>
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              {[5, 4, 3, 2, 1].map((n) => {
                const c = aggregate.distribution[n] || 0
                const pct = aggregate.count ? (c / aggregate.count) * 100 : 0
                return (
                  <div key={n} className="flex items-center gap-2">
                    <span className="w-3 text-[10px] text-muted-foreground/70 tabular-nums">{n}</span>
                    <span className="text-[10px] text-yellow-500/60 leading-none">★</span>
                    <div className="flex-1 h-1.5 rounded-full bg-white/[.06] overflow-hidden">
                      <div className="h-full rounded-full bg-yellow-500/70" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-5 text-right text-[10px] text-muted-foreground/60 tabular-nums">{c}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No ratings yet — be the first to say how {gameName ? <span className="font-semibold text-foreground/80">{gameName}</span> : "this game"} runs for you.
          </p>
        )}
      </div>

      <div className="p-6 space-y-5">
        {authLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : !user ? (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl bg-sky-500/10 border border-sky-500/20">
            <div className="flex-1 text-sm text-muted-foreground">
              Sign in to rate this game and share how it runs for you.
            </div>
            <Button size="sm" className="gap-2 shrink-0" onClick={() => navigate("/login")}>
              Sign In
            </Button>
          </div>
        ) : submitted ? (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <CheckCircle2 className="h-5 w-5 text-emerald-500 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-emerald-500">{hasRated ? "Thanks for updating your rating!" : "Thanks for the rating!"}</div>
              <div className="text-xs text-muted-foreground mt-1">Your report is now part of the average above.</div>
              <div className="flex flex-wrap items-center gap-3 mt-3">
                {onLeaveComment && (
                  <Button size="sm" variant="outline" className="gap-2" onClick={onLeaveComment}>
                    <MessageSquare className="h-4 w-4" />
                    Leave a detailed comment
                  </Button>
                )}
                <button onClick={() => setSubmitted(false)} className="text-xs text-muted-foreground underline hover:text-foreground">
                  {hasRated ? "Edit rating" : "Rate again"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm font-semibold text-foreground">{hasRated ? "Update your rating" : "How is it running for you?"}</div>

            <div className="space-y-1.5">
              <StarRating value={rating} onChange={setRating} />
            </div>

            {/* Platform toggle — Windows default; Linux reveals distro/Proton. */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Platform</Label>
              <div className="inline-flex rounded-xl border border-white/[.08] bg-white/[.03] p-1">
                {([
                  { key: "windows", label: "Windows", icon: <Monitor className="h-3.5 w-3.5" /> },
                  { key: "linux", label: "Linux", icon: <Terminal className="h-3.5 w-3.5" /> },
                ] as const).map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setPlatform(p.key)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${platform === p.key
                        ? "bg-white/[.10] text-white"
                        : "text-muted-foreground hover:text-foreground"
                      }`}
                  >
                    {p.icon}
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {platform === "linux" && (
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground font-medium">Distribution</Label>
                  <Input
                    value={distro}
                    onChange={(e) => setDistro(e.target.value)}
                    placeholder="e.g. Ubuntu 22.04, Arch Linux"
                    className="bg-white/5 border-white/10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground font-medium">Proton Version <span className="text-muted-foreground/50">(optional)</span></Label>
                  <Input
                    value={protonVersion}
                    onChange={(e) => setProtonVersion(e.target.value)}
                    placeholder="e.g. Proton 9.0, Proton-GE"
                    className="bg-white/5 border-white/10"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-medium">Notes <span className="text-muted-foreground/50">(optional)</span></Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything worth sharing — tweaks needed, issues hit, launch options used…"
                className="resize-none bg-white/5 border-white/10"
                rows={3}
              />
            </div>

            {/* Low-rating help — open the forums / Discord in the browser. */}
            {isBadRating && (
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/[.07] p-4">
                <div className="flex items-start gap-3">
                  <LifeBuoy className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-amber-200">Sorry it&apos;s giving you trouble.</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      You don&apos;t have to fight it alone — post the issue and someone can help you get it running.
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      <Button size="sm" variant="outline" className="gap-2 h-8" onClick={() => openWeb("/forums")}>
                        <MessageSquare className="h-3.5 w-3.5" />
                        Ask on the forums
                      </Button>
                      <Button size="sm" className="gap-2 h-8 bg-[#5865F2] hover:bg-[#4752c4] text-white border-0" onClick={() => openWeb("/socials")}>
                        <svg viewBox="0 0 127.14 96.36" className="h-3.5 w-3.5 fill-current">
                          <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z" />
                        </svg>
                        Join our Discord
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {submitError && (
              <div className="flex items-center gap-2 text-sm text-red-500">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {submitError}
              </div>
            )}
            <Button
              onClick={submit}
              disabled={submitting || rating === null || (platform === "linux" && !distro.trim())}
              className="gap-2"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {submitting ? "Submitting…" : hasRated ? "Update rating" : "Submit rating"}
            </Button>
          </div>
        )}

        <div className="space-y-3">
          {loadingExp ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading ratings…
            </div>
          ) : experiences.length === 0 ? (
            null
          ) : (
            <>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 pt-1">Recent reports</div>
              {experiences.map((exp, i) => <ExperienceCard key={exp.id ?? i} exp={exp} />)}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default GameExperience
