import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { Search, Loader2 } from "lucide-react"
import { proxyImageUrl } from "@/lib/utils"
import { fetchSteamArt } from "@/lib/sources"

export const MONO = "var(--mf-mono)"
export const COVER_LINES =
  "repeating-linear-gradient(135deg, color-mix(in srgb, var(--mf-t0) 4.5%, transparent) 0 1px, transparent 1px 11px), #131313"

export function steamArtLadder(appid?: number | null): string[] {
  if (!appid) return []
  const base = `https://shared.steamstatic.com/store_item_assets/steam/apps/${appid}`
  return [
    `${base}/library_600x900.jpg`,
    `${base}/library_hero.jpg`,
    `${base}/header.jpg`,
    `${base}/capsule_616x353.jpg`,
  ]
}

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

function nextAlive(list: string[], from: number): number {
  let i = from
  while (i < list.length && hasFailed(list[i])) i++
  return i
}

export function SmartImage({ candidates, steamAppId, name, alt, onAllFailed, style, lazy }: { candidates: string[]; steamAppId?: number | null; name?: string; alt?: string; onAllFailed?: () => void; style?: CSSProperties; lazy?: boolean }) {
  const [extra, setExtra] = useState<string[]>([])
  const [idx, setIdx] = useState(() => nextAlive(candidates, 0))
  const steamTried = useRef(false)
  const exhaustedFired = useRef(false)

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

  const exhausted = () => {
    if (steamAppId && !steamTried.current) {
      steamTried.current = true
      const sigAtError = sig
      void fetchSteamArt(steamAppId, name).then((urls) => {
        if (prevSig.current !== sigAtError) return
        const next = urls.map((u) => proxyImageUrl(u)).filter((u) => !all.includes(u) && !hasFailed(u))
        if (next.length) { setIdx(all.length); setExtra((p) => [...p, ...next]) }
        else onAllFailed?.()
      })
      return
    }
    onAllFailed?.()
  }

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

export function useGameImages(game: { image?: string; heroImage?: string; steamAppId?: number | null; sources?: Array<{ image?: string }> }): string[] {
  return useMemo(() => gameImageCandidates(game), [game])
}

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
