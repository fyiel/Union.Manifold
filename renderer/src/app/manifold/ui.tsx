import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { Search, Loader2 } from "lucide-react"
import { proxyImageUrl } from "@/lib/utils"
import { fetchSteamArt } from "@/lib/sources"

// Shared Union.Manifold primitives, monochrome tokens plus a couple of inline
// SVG bits reused across pages.

export const MONO = "var(--mf-mono)"
export const COVER_LINES =
  "repeating-linear-gradient(135deg, color-mix(in srgb, var(--mf-t0) 4.5%, transparent) 0 1px, transparent 1px 11px), #131313"

// Steam art fallback ladder for a known appid. Older titles (e.g. Hylics 397740)
// have NO modern library_600x900 / library_hero (those 404), but the legacy
// header.jpg / capsule_616x353 always exist, so a steamrip-only old game that
// would otherwise be blank falls back to its capsule.
export function steamArtLadder(appid?: number | null): string[] {
  if (!appid) return []
  const base = `https://shared.steamstatic.com/store_item_assets/steam/apps/${appid}`
  return [
    `${base}/library_600x900.jpg`, // 3:4 portrait (best for cards)
    `${base}/library_hero.jpg`,    // wide hero
    `${base}/header.jpg`,          // 460x215 capsule (always present)
    `${base}/capsule_616x353.jpg`,
  ]
}

// Collect every distinct cover/hero a unified game offers. A user-set custom
// cover (uc-custom://) always leads. With `steamFirst` (card/detail covers)
// and a known appid, Steam's official portrait capsule leads and the source
// art — which is often a wrong or watermarked scrape — falls back behind it;
// the wide hero call leaves ordering alone so it doesn't lead with a portrait.
// SmartImage walks the list so a 404 capsule still yields to the source art.
export function gameImageCandidates(
  game: { image?: string; heroImage?: string; steamAppId?: number | null; sources?: Array<{ image?: string }> },
  opts?: { steamFirst?: boolean },
): string[] {
  const steam = steamArtLadder(game.steamAppId)
  const sourceImgs = [game.image, ...(game.sources || []).map((s) => s.image), game.heroImage]
  const custom = game.image && game.image.startsWith("uc-custom://") ? game.image : undefined
  const raw = custom
    ? [custom, ...steam, ...sourceImgs]
    : opts?.steamFirst && game.steamAppId
      ? [steam[0], ...sourceImgs, ...steam.slice(1)]
      : [...sourceImgs, ...steam]
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of raw.filter(Boolean) as string[]) { if (!seen.has(u)) { seen.add(u); out.push(proxyImageUrl(u)) } }
  return out
}

// Candidate URLs that failed to load recently. Detail imagery remounts on
// every Browse → detail → Browse trip, and every retry of a known-dead
// candidate is a real network request. Module-level like GameCard's
// `prefetched` set, but capped: at the cap the whole map is dropped wholesale
// (no recency bookkeeping) so it can't grow unbounded. Entries expire after a
// few minutes because a failure is often the machine's moment, not the URL's:
// a launch before the network is up (boot autostart, installer relaunch)
// fails every cover at once, and a session-permanent set kept them blank
// until the next restart even after connectivity returned.
const failedSrcs = new Map<string, number>()
const FAILED_SRCS_CAP = 500
const FAILED_TTL_MS = 5 * 60_000

function rememberFailed(url: string) {
  if (failedSrcs.size >= FAILED_SRCS_CAP) failedSrcs.clear()
  failedSrcs.set(url, Date.now() + FAILED_TTL_MS)
}

function hasFailed(url: string): boolean {
  const until = failedSrcs.get(url)
  if (until === undefined) return false
  if (Date.now() < until) return true
  failedSrcs.delete(url)
  return false
}

// First index at or after `from` whose URL isn't a known recent failure.
function nextAlive(list: string[], from: number): number {
  let i = from
  while (i < list.length && hasFailed(list[i])) i++
  return i
}

// An <img> that walks a list of candidate sources, advancing on error (and
// skipping candidates that already failed this session). When every candidate
// fails AND a steamAppId is given, it asks main for Steam's authoritative
// store art (one cached call) and tries that before giving up, which rescues
// titles like Rugrats Retro Rewind whose predictable library_*.jpg URLs all
// 404. onAllFailed fires only if that fails too.
export function SmartImage({ candidates, steamAppId, alt, onAllFailed, style, lazy }: { candidates: string[]; steamAppId?: number | null; alt?: string; onAllFailed?: () => void; style?: CSSProperties; lazy?: boolean }) {
  const [extra, setExtra] = useState<string[]>([])
  const [idx, setIdx] = useState(() => nextAlive(candidates, 0))
  const steamTried = useRef(false)
  const exhaustedFired = useRef(false)

  // Restart the walk when the candidate set actually changes (a detail page
  // hydrates thin to full and swaps in a different cover). Without this the stale
  // idx/extra/steamTried from the old game would show wrong art or a blank.
  const sig = candidates.join("|")
  const prevSig = useRef(sig)
  if (prevSig.current !== sig) {
    prevSig.current = sig
    setIdx(nextAlive(candidates, 0))
    setExtra([])
    steamTried.current = false
    exhaustedFired.current = false
  }

  const all = useMemo(() => [...candidates, ...extra], [candidates, extra])
  const src: string | undefined = all[idx]

  // Every candidate is dead: one (cached) steam-art lookup, then onAllFailed.
  // Shared by the onError walk and the all-cached-failures mount path below.
  const exhausted = () => {
    if (steamAppId && !steamTried.current) {
      steamTried.current = true
      const sigAtError = sig
      void fetchSteamArt(steamAppId).then((urls) => {
        // game swapped while the fetch was in flight, drop its stale art
        if (prevSig.current !== sigAtError) return
        const next = urls.map((u) => proxyImageUrl(u)).filter((u) => !all.includes(u) && !hasFailed(u))
        if (next.length) { setIdx(all.length); setExtra((p) => [...p, ...next]) }
        else onAllFailed?.()
      })
      return
    }
    onAllFailed?.()
  }

  // A remount can find every candidate already in the failed cache, so no
  // <img> mounts to drive the onError walk — kick the steam/onAllFailed tail
  // directly. The ref guard keeps StrictMode's double effect run to one kick.
  useEffect(() => {
    if (src !== undefined || all.length === 0 || exhaustedFired.current) return
    exhaustedFired.current = true
    exhausted()
  })

  if (!src) return null
  return (
    <img
      src={src}
      alt={alt}
      loading={lazy ? "lazy" : undefined}
      decoding="async"
      onError={() => {
        rememberFailed(src)
        const next = nextAlive(all, idx + 1)
        if (next < all.length) { setIdx(next); return }
        exhausted()
      }}
      style={style}
    />
  )
}

// Candidates memoized off a unified game.
export function useGameImages(game: { image?: string; heroImage?: string; steamAppId?: number | null; sources?: Array<{ image?: string }> }): string[] {
  return useMemo(() => gameImageCandidates(game), [game])
}

// Bytes to a compact "x.x GB" / "xx GB" label (empty when unknown).
export function gbLabel(bytes?: number): string {
  if (!bytes) return ""
  const gb = bytes / 1e9
  return (gb >= 10 ? Math.round(gb) : gb.toFixed(1)) + " GB"
}

export function SearchIcon({ size = 15, stroke = "var(--mf-t4)", style }: { size?: number; stroke?: string; style?: CSSProperties }) {
  return <Search size={size} color={stroke} strokeWidth={1.6} style={style} />
}

export function Spinner({ size = 14, stroke = "var(--mf-t3)", style }: { size?: number; stroke?: string; style?: CSSProperties }) {
  return <Loader2 className="uc-spin" size={size} color={stroke} strokeWidth={2} style={style} />
}

export function CenterState({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "120px 0", gap: 13 }}>{children}</div>
}
