import { useMemo, useRef, useState, type CSSProperties } from "react"
import { Search, Loader2 } from "lucide-react"
import { proxyImageUrl } from "@/lib/utils"
import { fetchSteamArt } from "@/lib/sources"

// Shared Union.Manifold primitives, monochrome tokens plus a couple of inline
// SVG bits reused across pages.

export const MONO = "var(--mf-mono)"
export const COVER_LINES =
  "repeating-linear-gradient(135deg, rgba(255,255,255,0.045) 0 1px, transparent 1px 11px), #131313"

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

// Collect every distinct cover/hero a unified game offers, in preference order:
// the merged image, then each source's own image, then the hero, then the steam
// ladder. Lets a card fall back to another source's art when one URL won't load
// (e.g. a UnionCrax signed link to an unreachable CDN while the same game's
// AnkerGames poster loads fine).
export function gameImageCandidates(game: { image?: string; heroImage?: string; steamAppId?: number | null; sources?: Array<{ image?: string }> }): string[] {
  const raw = [
    game.image,
    ...(game.sources || []).map((s) => s.image),
    game.heroImage,
    ...steamArtLadder(game.steamAppId), // ensure old steam titles still resolve art
  ].filter(Boolean) as string[]
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of raw) { if (!seen.has(u)) { seen.add(u); out.push(proxyImageUrl(u)) } }
  return out
}

// An <img> that walks a list of candidate sources, advancing on error. When
// every candidate fails AND a steamAppId is given, it asks main for Steam's
// authoritative store art (one cached call) and tries that before giving up,
// which rescues titles like Rugrats Retro Rewind whose predictable
// library_*.jpg URLs all 404. onAllFailed fires only if that fails too.
export function SmartImage({ candidates, steamAppId, alt, onAllFailed, style, lazy }: { candidates: string[]; steamAppId?: number | null; alt?: string; onAllFailed?: () => void; style?: CSSProperties; lazy?: boolean }) {
  const [extra, setExtra] = useState<string[]>([])
  const [idx, setIdx] = useState(0)
  const steamTried = useRef(false)

  // Restart the walk when the candidate set actually changes (a detail page
  // hydrates thin to full and swaps in a different cover). Without this the stale
  // idx/extra/steamTried from the old game would show wrong art or a blank.
  const sig = candidates.join("|")
  const prevSig = useRef(sig)
  if (prevSig.current !== sig) {
    prevSig.current = sig
    setIdx(0)
    setExtra([])
    steamTried.current = false
  }

  const all = useMemo(() => [...candidates, ...extra], [candidates, extra])
  const src = all[idx]
  if (!src) return null
  return (
    <img
      src={src}
      alt={alt}
      loading={lazy ? "lazy" : undefined}
      onError={() => {
        if (idx + 1 < all.length) { setIdx(idx + 1); return }
        if (steamAppId && !steamTried.current) {
          steamTried.current = true
          const sigAtError = sig
          void fetchSteamArt(steamAppId).then((urls) => {
            // game swapped while the fetch was in flight, drop its stale art
            if (prevSig.current !== sigAtError) return
            const next = urls.map((u) => proxyImageUrl(u)).filter((u) => !all.includes(u))
            if (next.length) { setIdx(all.length); setExtra((p) => [...p, ...next]) }
            else onAllFailed?.()
          })
          return
        }
        onAllFailed?.()
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

export function SearchIcon({ size = 15, stroke = "#7d7d7d", style }: { size?: number; stroke?: string; style?: CSSProperties }) {
  return <Search size={size} color={stroke} strokeWidth={1.6} style={style} />
}

export function Spinner({ size = 14, stroke = "#9a9a9a", style }: { size?: number; stroke?: string; style?: CSSProperties }) {
  return <Loader2 className="uc-spin" size={size} color={stroke} strokeWidth={2} style={style} />
}

export function CenterState({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "120px 0", gap: 13 }}>{children}</div>
}
