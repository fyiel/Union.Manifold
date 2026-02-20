"use client"

import React, { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { useDiscordAccount } from "@/hooks/use-discord-account"
import { apiFetch, apiUrl, getApiBaseUrl } from "@/lib/api"
import { Loader2, Send, Terminal, CheckCircle2, AlertCircle, ChevronDown, Pin } from "lucide-react"

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
          className={`transition-all text-xl ${n <= display ? "text-yellow-500 scale-110" : "text-muted-foreground/20"} hover:scale-125`}
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

function ExperienceCard({ exp }: { exp: any }) {
  const rating = exp.rating as number
  const isPinned = exp.pinned === true
  return (
    <div className={`p-4 rounded-xl border transition-colors space-y-2 ${
      isPinned
        ? "bg-sky-500/5 border-sky-500/30 shadow-[0_2px_12px_rgba(56,189,248,0.08)]"
        : "bg-white/5 border-white/10 hover:bg-white/10"
    }`}>
      {isPinned && (
        <div className="flex items-center gap-1 text-[10px] font-semibold text-sky-500 mb-1">
          <Pin className="h-3 w-3" />
          Pinned
        </div>
      )}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-sky-500 shrink-0" />
          <span className="text-sm font-semibold text-white">{exp.distro}</span>
          <span className="text-gray-500 text-xs">·</span>
          <span className="text-xs text-gray-400">{exp.proton_version || exp.protonVersion}</span>
        </div>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className={`text-sm ${n <= rating ? "text-yellow-500" : "text-gray-600"}`}>★</span>
          ))}
          <span className={`ml-1 text-xs font-medium ${RATING_COLORS[rating] || "text-gray-400"}`}>
            {RATING_LABELS[rating] || `${rating}/5`}
          </span>
        </div>
      </div>
      {exp.notes && (
        <p className="text-sm text-gray-400 leading-relaxed">{exp.notes}</p>
      )}
      <div className="text-xs text-gray-600">
        {exp.created_at ? new Date(exp.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : ""}
      </div>
    </div>
  )
}

export function LinuxExperiences({ appid }: { appid: string }) {
  const [experiences, setExperiences] = useState<any[]>([])
  const [loadingExp, setLoadingExp] = useState(true)
  const [distro, setDistro] = useState("")
  const [protonVersion, setProtonVersion] = useState("")
  const [rating, setRating] = useState<number | null>(null)
  const [notes, setNotes] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const { user, loading: authLoading } = useDiscordAccount()

  const fetchExperiences = () => {
    if (!appid) return
    setLoadingExp(true)
    apiFetch(`/api/experiences/${appid}`)
      .then((r) => r.json())
      .then((j) => { if (j?.success) setExperiences(j.experiences || []) })
      .catch(() => {})
      .finally(() => setLoadingExp(false))
  }

  useEffect(() => { fetchExperiences() }, [appid])

  const connectDiscord = async () => {
    if (window.ucAuth?.login) {
      await window.ucAuth.login(getApiBaseUrl())
      return
    }
    window.open(apiUrl(`/api/discord/connect?next=/game/${encodeURIComponent(appid)}`), "_blank")
  }

  const submit = async () => {
    setSubmitError(null)
    if (!user) return
    if (!distro.trim() || !protonVersion.trim() || rating === null) {
      setSubmitError("Please fill in all fields and select a rating.")
      return
    }
    setSubmitting(true)
    try {
      const res = await apiFetch(`/api/experiences/${appid}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ distro: distro.trim(), protonVersion: protonVersion.trim(), rating, notes: notes.trim() }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setSubmitError(json.error || "Failed to submit. Please try again.")
      } else {
        setSubmitted(true)
        setDistro("")
        setProtonVersion("")
        setRating(null)
        setNotes("")
        fetchExperiences()
      }
    } catch {
      setSubmitError("Network error. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-2xl bg-black/40 border border-white/10 backdrop-blur-md shadow-xl overflow-hidden">
      {/* Header — always visible, clickable to toggle */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-6 py-4 border-b border-white/10 bg-white/5 hover:bg-white/10 transition-colors cursor-pointer text-left"
      >
        <Terminal className="h-5 w-5 text-sky-500 shrink-0" />
        <h3 className="text-base font-bold text-white">Linux Experiences</h3>
        <span className="text-xs text-gray-400">community reports</span>
        <Badge className="ml-auto text-xs bg-sky-500/20 border-sky-500/30 text-sky-500 border font-medium">
          {experiences.length} {experiences.length === 1 ? "report" : "reports"}
        </Badge>
        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {/* Collapsible content */}
      {expanded && (
        <div className="p-6 space-y-5">
          {/* Auth gate / submit form */}
          {authLoading ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : !user ? (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl bg-sky-500/10 border border-sky-500/20">
              <div className="flex-1 text-sm text-gray-400">
                Sign in with Discord to share how this game runs on your Linux setup.
              </div>
              <Button size="sm" className="bg-[#5865F2] hover:bg-[#4752c4] text-white border-0 gap-2 shrink-0" onClick={connectDiscord}>
                <svg viewBox="0 0 127.14 96.36" className="h-4 w-4 fill-current">
                  <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z" />
                </svg>
                Sign in with Discord
              </Button>
            </div>
          ) : submitted ? (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle2 className="h-5 w-5 text-emerald-500 mt-0.5 shrink-0" />
              <div>
                <div className="text-sm font-semibold text-emerald-500">Experience posted!</div>
                <div className="text-xs text-gray-400 mt-1">Your report is now visible below. It may be reviewed by the community later.</div>
                <button onClick={() => setSubmitted(false)} className="text-xs text-gray-500 underline mt-2 hover:text-gray-300">Submit another</button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-sm font-semibold text-gray-300">Share your experience</div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-gray-400 font-medium">Distribution</Label>
                  <Input
                    value={distro}
                    onChange={(e) => setDistro(e.target.value)}
                    placeholder="e.g. Ubuntu 22.04, Arch Linux"
                    className="bg-white/5 border-white/10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-gray-400 font-medium">Proton Version</Label>
                  <Input
                    value={protonVersion}
                    onChange={(e) => setProtonVersion(e.target.value)}
                    placeholder="e.g. Proton 9.0, Proton-GE"
                    className="bg-white/5 border-white/10"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-400 font-medium">How well does it run?</Label>
                <StarRating value={rating} onChange={setRating} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-400 font-medium">Notes <span className="text-gray-600">(optional)</span></Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any tweaks needed, issues encountered, launch options used…"
                  className="resize-none bg-white/5 border-white/10"
                  rows={3}
                />
              </div>
              {submitError && (
                <div className="flex items-center gap-2 text-sm text-red-500">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {submitError}
                </div>
              )}
              <Button
                onClick={submit}
                disabled={submitting || !distro || !protonVersion || rating === null}
                className="gap-2"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {submitting ? "Submitting…" : "Submit Experience"}
              </Button>
            </div>
          )}

          {/* Experiences list */}
          <div className="space-y-3">
            {loadingExp ? (
              <div className="flex items-center gap-2 text-gray-500 text-sm py-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading experiences…
              </div>
            ) : experiences.length === 0 ? (
              <div className="py-6 text-center">
                <Terminal className="h-8 w-8 text-gray-700 mx-auto mb-2" />
                <div className="text-sm text-gray-400">No experiences yet.</div>
                <div className="text-xs text-gray-600 mt-1">Be the first to share how this game runs on Linux!</div>
              </div>
            ) : (
              experiences.map((exp, i) => <ExperienceCard key={exp.id ?? i} exp={exp} />)
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default LinuxExperiences
