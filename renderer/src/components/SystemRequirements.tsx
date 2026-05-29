import { useEffect, useMemo, useState } from "react"
import { apiFetch } from "@/lib/api"

type Platform = "windows" | "linux"
type ReqBlock = { minimum?: string; recommended?: string }

interface SystemRequirementsProps {
  appid: string
}

function stripLabel(html: string, label: string): string {
  return html.replace(new RegExp(`<strong>${label}:<\\/strong><br\\s*\\/?>`, "i"), "")
}

function cleanRequirements(html: string | undefined, label: string): string {
  if (!html) return ""
  let cleaned = stripLabel(html, label).trim()
  cleaned = cleaned.replace(/^(<br\s*\/?>)+/i, "")
  cleaned = cleaned.replace(/(<br\s*\/?>)+$/i, "")
  return cleaned
}

function hasMeaningfulHtml(html: string | undefined, label: string): boolean {
  const cleaned = cleanRequirements(html, label)
  const text = cleaned.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").trim()
  return text.length > 0
}

function hasMeaningfulContent(r: ReqBlock | null | undefined): r is ReqBlock {
  if (!r) return false
  const hasMin = hasMeaningfulHtml(r.minimum, "Minimum")
  const hasRec = hasMeaningfulHtml(r.recommended, "Recommended")
  return hasMin || hasRec
}

/** Read the scanned profile's OS once. Fall back to renderer-side process.platform
 *  when the cache is empty (very first launch). Windows is the conservative default
 *  — matches what Steam's store page does for an anonymous visitor. */
async function detectUserPlatform(): Promise<Platform> {
  try {
    const res = await window.ucSystemProfile?.getCached?.()
    const p = String(res?.profile?.spec?.os?.platform || "").toLowerCase()
    if (p === "linux") return "linux"
    if (p === "win32" || p === "darwin") return "windows"
  } catch { /* fall through */ }
  try {
    const w = window as unknown as { process?: { platform?: string } }
    if (w.process?.platform === "linux") return "linux"
  } catch { /* not Electron */ }
  return "windows"
}

export function SystemRequirements({ appid }: SystemRequirementsProps) {
  const [reqs, setReqs] = useState<ReqBlock | null>(null)
  const [linuxReqs, setLinuxReqs] = useState<ReqBlock | null>(null)
  const [defaultPlatform, setDefaultPlatform] = useState<Platform>("windows")
  /** User's manual override; null = use the OS-detected default. */
  const [overridePlatform, setOverridePlatform] = useState<Platform | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    // Kick off the platform detection in parallel with the requirements
    // fetch — neither depends on the other and the API call is the slow
    // one (it can hit Steam for an uncached game).
    void detectUserPlatform().then((p) => { if (mounted) setDefaultPlatform(p) })

    apiFetch(`/api/steam-details/${appid}`)
      .then(r => r.json())
      .then(json => {
        if (!mounted) return
        const win = json?.data?.requirements as ReqBlock | null
        const lin = json?.data?.linuxRequirements as ReqBlock | null
        if (hasMeaningfulContent(win)) setReqs(win)
        if (hasMeaningfulContent(lin)) setLinuxReqs(lin)
      })
      .catch(() => {})
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [appid])

  const hasWindows = Boolean(reqs)
  const hasLinux = Boolean(linuxReqs)

  /** Effective platform shown in the card body. Cross-platform fallback:
   *  if the user's preferred platform isn't published, show the other one
   *  instead — better than rendering an empty card. */
  const selectedPlatform: Platform = useMemo(() => {
    const requested = overridePlatform ?? defaultPlatform
    if (requested === "linux" && !hasLinux && hasWindows) return "windows"
    if (requested === "windows" && !hasWindows && hasLinux) return "linux"
    return requested
  }, [overridePlatform, defaultPlatform, hasWindows, hasLinux])

  if (loading) {
    return (
      <div className="p-8 rounded-3xl bg-card/60 border border-white/[.07] backdrop-blur-md shadow-xl space-y-4">
        <div className="udl-skeleton h-3 w-36 rounded" />
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-2xl bg-secondary/50 border border-white/[.07] p-5 space-y-2">
            <div className="udl-skeleton h-2.5 w-16 rounded mb-3" />
            <div className="udl-skeleton h-2.5 w-full rounded" />
            <div className="udl-skeleton h-2.5 w-5/6 rounded" />
            <div className="udl-skeleton h-2.5 w-4/6 rounded" />
            <div className="udl-skeleton h-2.5 w-full rounded" />
            <div className="udl-skeleton h-2.5 w-3/4 rounded" />
          </div>
          <div className="rounded-2xl bg-secondary/50 border border-white/[.07] p-5 space-y-2">
            <div className="udl-skeleton h-2.5 w-20 rounded mb-3" />
            <div className="udl-skeleton h-2.5 w-full rounded" />
            <div className="udl-skeleton h-2.5 w-5/6 rounded" />
            <div className="udl-skeleton h-2.5 w-4/6 rounded" />
            <div className="udl-skeleton h-2.5 w-full rounded" />
            <div className="udl-skeleton h-2.5 w-3/4 rounded" />
          </div>
        </div>
      </div>
    )
  }

  if (!hasWindows && !hasLinux) return null

  // The block we're actually rendering. `selectedPlatform` already accounts
  // for cross-platform fallback, so this is never null when at least one
  // platform's specs are published.
  const active: ReqBlock = (selectedPlatform === "linux" ? linuxReqs : reqs) ?? (linuxReqs ?? reqs)!
  const minHtml = cleanRequirements(active.minimum, "Minimum")
  const recHtml = cleanRequirements(active.recommended, "Recommended")

  if (!hasMeaningfulHtml(active.minimum, "Minimum") && !hasMeaningfulHtml(active.recommended, "Recommended")) {
    return null
  }

  return (
    <div className="p-8 rounded-3xl bg-card/60 border border-white/[.07] backdrop-blur-md shadow-xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-bold text-white uppercase tracking-widest">System Requirements</h3>
        {/* Pill only renders when both platforms are published. With a single
            platform we collapse to a static label so it's still clear which
            OS the visible numbers describe — Steam does the same thing. */}
        {hasWindows && hasLinux ? (
          <div className="inline-flex items-center gap-0.5 rounded-full border border-white/[.07] bg-card/60 p-0.5 text-[10px]">
            <button
              type="button"
              onClick={() => setOverridePlatform("windows")}
              className={`px-2.5 py-1 rounded-full transition ${selectedPlatform === "windows" ? "bg-zinc-700 text-white" : "text-muted-foreground hover:text-foreground/90"}`}
              title="Show Windows requirements"
            >Windows</button>
            <button
              type="button"
              onClick={() => setOverridePlatform("linux")}
              className={`px-2.5 py-1 rounded-full transition ${selectedPlatform === "linux" ? "bg-zinc-700 text-white" : "text-muted-foreground hover:text-foreground/90"}`}
              title="Show Linux requirements"
            >Linux</button>
          </div>
        ) : (
          <span className="rounded-full border border-white/10 bg-white/[.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {selectedPlatform === "linux" ? "Linux" : "Windows"}
          </span>
        )}
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {hasMeaningfulHtml(active.minimum, "Minimum") && (
          <div className="rounded-2xl bg-secondary/50 border border-white/[.07] p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80 mb-3">Minimum</p>
            <div
              className="text-xs text-muted-foreground leading-relaxed [&_strong]:text-foreground/90 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:mt-1 [&_li]:mt-1"
              dangerouslySetInnerHTML={{ __html: minHtml }}
            />
          </div>
        )}
        {hasMeaningfulHtml(active.recommended, "Recommended") && (
          <div className="rounded-2xl bg-secondary/50 border border-white/[.07] p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80 mb-3">Recommended</p>
            <div
              className="text-xs text-muted-foreground leading-relaxed [&_strong]:text-foreground/90 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:mt-1 [&_li]:mt-1"
              dangerouslySetInnerHTML={{ __html: recHtml }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
