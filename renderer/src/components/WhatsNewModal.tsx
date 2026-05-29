import { useEffect, useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Sparkles, Wrench, Brush, ChevronDown } from "lucide-react"
import { loadReleaseNotes, type ReleaseHighlight, type ReleaseNotes } from "@/lib/whats-new"

const LAST_SEEN_KEY = "lastSeenWhatsNewVersion"
const OPEN_EVENT = "uc_open_whats_new"

/** Loose semver compare. Returns 1 if a > b, -1 if a < b, 0 if equal. */
function compareVersions(a: string, b: string): number {
  const norm = (value: string) => value.replace(/^v/i, "").split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0)
  const left = norm(a)
  const right = norm(b)
  const len = Math.max(left.length, right.length)
  for (let i = 0; i < len; i += 1) {
    const l = left[i] ?? 0
    const r = right[i] ?? 0
    if (l > r) return 1
    if (l < r) return -1
  }
  return 0
}

function HighlightRow({ highlight }: { highlight: ReleaseHighlight }) {
  const Icon = highlight.kind === "feature" ? Sparkles : highlight.kind === "fix" ? Wrench : Brush
  const accent = highlight.kind === "feature"
    ? "text-emerald-300 bg-emerald-500/[.08] border-emerald-500/20"
    : highlight.kind === "fix"
      ? "text-amber-200 bg-amber-500/[.08] border-amber-500/20"
      : "text-sky-200 bg-sky-500/[.08] border-sky-500/20"
  return (
    <li className="flex items-start gap-3 py-2.5 border-b border-white/[.05] last:border-b-0">
      <span className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${accent}`}>
        <Icon className="h-3 w-3" />
      </span>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-white">{highlight.title}</div>
        {highlight.body && (
          <div className="text-xs text-muted-foreground leading-relaxed mt-0.5">{highlight.body}</div>
        )}
      </div>
    </li>
  )
}

function ReleaseSection({ release, isCurrent }: { release: ReleaseNotes; isCurrent?: boolean }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-mono font-semibold ${
          isCurrent
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
            : "border-white/[.07] bg-white/[.04] text-foreground/90"
        }`}>
          v{release.version}{isCurrent && " · just installed"}
        </span>
        {release.codename && (
          <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/80">{release.codename}</span>
        )}
        {release.date && (
          <span className="ml-auto text-[10px] text-muted-foreground/60">{release.date}</span>
        )}
      </div>
      {release.intro && (
        <p className="text-sm text-muted-foreground leading-relaxed">{release.intro}</p>
      )}
      {release.highlights.length > 0 ? (
        <ul className="divide-y divide-white/[.05]">
          {release.highlights.map((h, idx) => (
            <HighlightRow key={`${release.version}-${idx}`} highlight={h} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground/80 italic">No highlights captured for this release.</p>
      )}
    </section>
  )
}

/**
 * "What's new" modal.
 *
 *   - Auto-opens after an update: when the installed app version is greater
 *     than `lastSeenWhatsNewVersion`, the modal opens with ONLY the releases
 *     that bridge those two versions (so a user updating from v2.2.0 → v2.4.0
 *     sees both v2.3 and v2.4, not the entire repo history).
 *   - Manual open via `uc_open_whats_new` shows the full history with an
 *     expandable "older releases" section.
 *   - Closing the modal stamps `lastSeenWhatsNewVersion` to the running app
 *     version so we don't replay the same release on the next launch.
 */
export function WhatsNewModal() {
  const [open, setOpen] = useState(false)
  const [releases, setReleases] = useState<ReleaseNotes[]>([])
  const [loaded, setLoaded] = useState(false)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [prevSeenVersion, setPrevSeenVersion] = useState<string | null>(null)
  /** True when the open was triggered by a fresh-install detection (auto). */
  const [openedAfterUpdate, setOpenedAfterUpdate] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  // Subscribe to the manual open event.
  useEffect(() => {
    if (typeof window === "undefined") return
    const onOpen = () => {
      setOpenedAfterUpdate(false)
      setShowHistory(false)
      setOpen(true)
    }
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  }, [])

  // Load changelog + app version + previously-seen marker once on mount.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [list, version, lastSeen] = await Promise.all([
        loadReleaseNotes(),
        window.ucUpdater?.getVersion?.().catch(() => null),
        window.ucSettings?.get?.(LAST_SEEN_KEY).catch(() => null),
      ])
      if (cancelled) return
      setReleases(list)
      setAppVersion(typeof version === "string" ? version : null)
      setPrevSeenVersion(typeof lastSeen === "string" ? lastSeen : null)
      setLoaded(true)
    })()
    return () => { cancelled = true }
  }, [])

  // Decide whether to auto-open after an upgrade.
  useEffect(() => {
    if (!loaded || releases.length === 0 || !appVersion) return
    const latest = releases[0].version
    // Don't open if the source-of-truth changelog is ahead of the app —
    // that means we're rendering a yet-unreleased entry.
    if (compareVersions(latest, appVersion) > 0) return
    // If we have no prior marker (fresh install), don't surface the modal —
    // the onboarding flow already covers first run. Just stamp the current
    // version as seen so future updates land in the diff branch.
    if (!prevSeenVersion) {
      void window.ucSettings?.set?.(LAST_SEEN_KEY, appVersion)
      return
    }
    // Already seen this version or newer.
    if (compareVersions(latest, prevSeenVersion) <= 0) return
    setOpenedAfterUpdate(true)
    setShowHistory(false)
    setOpen(true)
  }, [loaded, releases, appVersion, prevSeenVersion])

  // Releases the user hasn't seen yet — only filled when we know what they
  // were on before. For manual opens this is empty so the full history shows.
  const newReleases = useMemo(() => {
    if (!openedAfterUpdate || !prevSeenVersion) return releases
    return releases.filter((release) => compareVersions(release.version, prevSeenVersion) > 0)
  }, [releases, openedAfterUpdate, prevSeenVersion])

  const olderReleases = useMemo(() => {
    if (!openedAfterUpdate || !prevSeenVersion) return [] as ReleaseNotes[]
    return releases.filter((release) => compareVersions(release.version, prevSeenVersion) <= 0)
  }, [releases, openedAfterUpdate, prevSeenVersion])

  const handleClose = async () => {
    setOpen(false)
    setShowHistory(false)
    try {
      // Stamp the running version, not the changelog's latest — the user
      // saw what's *installed*, not whatever was at the top of the file.
      const stamp = appVersion ?? releases[0]?.version
      if (stamp) await window.ucSettings?.set?.(LAST_SEEN_KEY, stamp)
    } catch { /* ignore */ }
  }

  const headline = openedAfterUpdate && prevSeenVersion && appVersion
    ? `Updated to v${appVersion}`
    : "What's new"

  const description = openedAfterUpdate && prevSeenVersion
    ? `Here's everything we shipped since v${prevSeenVersion}.`
    : "See what's been added, improved and fixed in recent updates."

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) void handleClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-300" />
            {headline}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-1">
          {!loaded && (
            <div className="space-y-2">
              <div className="udl-skeleton h-4 w-32 rounded" />
              <div className="udl-skeleton h-3 w-full rounded" />
              <div className="udl-skeleton h-3 w-3/4 rounded" />
            </div>
          )}
          {loaded && newReleases.length === 0 && olderReleases.length === 0 && (
            <p className="text-sm text-muted-foreground">No changelog available right now.</p>
          )}
          {newReleases.map((release) => (
            <ReleaseSection
              key={release.version}
              release={release}
              isCurrent={openedAfterUpdate && release.version === appVersion}
            />
          ))}
          {olderReleases.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowHistory((value) => !value)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-white transition-colors"
              >
                <ChevronDown className={`h-3 w-3 transition-transform ${showHistory ? "" : "-rotate-90"}`} />
                {showHistory ? "Hide older releases" : `Show older releases (${olderReleases.length})`}
              </button>
              {showHistory && (
                <div className="mt-4 space-y-6">
                  {olderReleases.map((release) => (
                    <ReleaseSection key={release.version} release={release} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end pt-1">
          <Button onClick={() => void handleClose()}>
            {openedAfterUpdate ? "Got it" : "Close"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
