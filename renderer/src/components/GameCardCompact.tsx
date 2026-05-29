"use client"

import { Link } from "react-router-dom"
import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { getCardImage, proxyImageUrl } from "@/lib/utils"
import { useNsfwReveal } from "@/hooks/use-nsfw-reveal"
import { GameActionContextMenu } from "@/components/GameActionMenu"
import { useUniversalGameMenuProps } from "@/hooks/use-universal-game-menu"
import { GameArtAura } from "@/components/game-art-aura"
import { MediaImage } from "@/components/ui/media-image"
import { forgetImageFailure, isImageKnownBad, markImageFailed } from "@/lib/image-failure-cache"

type CompactGame = {
  appid: string
  name: string
  image: string
  splash?: string
  hero_image?: string
  background_image?: string
  localImage?: string
  localSplash?: string
  localHeroImage?: string
  localBackgroundImage?: string
  genres: string[]
}

const FALLBACK_SRC = "./fallbacks/game-card-3x4.svg"

export const GameCardCompact = memo(function GameCardCompact({ game }: { game: CompactGame }) {
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageCandidateIndex, setImageCandidateIndex] = useState(0)
  const isNSFW = game.genres?.some((genre) => genre.toLowerCase() === "nsfw")
  const { revealed: nsfwRevealed, reveal: revealNsfw } = useNsfwReveal(game.appid)
  const nsfwGateUp = Boolean(isNSFW) && !nsfwRevealed

  // Candidate chain mirroring full GameCard. Recently-installed tiles were
  // failing because the launcher pre-resolved the cover URL to a localImage
  // disk path; when that file was missing (drive offline / game deleted /
  // partial cache) uc-local 404'd with no fallback. With the chain we try
  // localImage first, then walk through remote URLs, then the SVG fallback.
  const imageCandidates = useMemo(() => {
    const raw = [
      game.localImage,
      game.image,
      game.hero_image,
      game.background_image,
      game.splash,
      FALLBACK_SRC,
    ]
    const seen = new Set<string>()
    const out: string[] = []
    for (const candidate of raw) {
      const s = String(candidate || "").trim()
      if (!s) continue
      const resolved = proxyImageUrl(getCardImage(s)) || proxyImageUrl(s) || s
      if (!resolved || seen.has(resolved)) continue
      seen.add(resolved)
      out.push(resolved)
    }
    return out
  }, [game.localImage, game.image, game.hero_image, game.background_image, game.splash])

  // Skip past candidates we already know are dead this session.
  const resolvedCandidateIndex = useMemo(() => {
    let idx = imageCandidateIndex
    while (
      idx < imageCandidates.length - 1
      && imageCandidates[idx]
      && imageCandidates[idx] !== FALLBACK_SRC
      && isImageKnownBad(imageCandidates[idx])
    ) {
      idx += 1
    }
    return idx
  }, [imageCandidates, imageCandidateIndex])

  const cardImageSrc = imageCandidates[resolvedCandidateIndex] || FALLBACK_SRC

  // Universal right-click menu — same actions as the full GameCard so users
  // get the same surface regardless of which variant they hit.
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null)
  const closeContextMenu = useCallback(() => setContextMenuPos(null), [])
  const menuProps = useUniversalGameMenuProps({
    appid: game.appid,
    name: game.name,
  } as any)

  useEffect(() => {
    setImageLoaded(false)
  }, [cardImageSrc])

  useEffect(() => {
    setImageCandidateIndex(0)
  }, [game.localImage, game.image, game.hero_image, game.background_image, game.splash])

  return (
    <GameArtAura src={cardImageSrc} scopeKey={game.appid}>
    <div
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setContextMenuPos({ x: e.clientX, y: e.clientY })
      }}
    >
      <Link to={`/game/${game.appid}`} className="group block">
      <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/80 transition hover:border-border/50">
        <div className="relative aspect-[3/4]">
          {!imageLoaded && <div className="udl-skeleton absolute inset-0 z-0 rounded-none" />}

          <MediaImage
            unwrapped
            src={cardImageSrc}
            alt={game.name}
            loading="lazy"
            // No `fallbackSrc` here — MediaImage's fallback short-circuits the
            // candidate-chain advance below. Instead we let onError bump our
            // own index so we walk localImage → image → hero → splash → svg
            // in order. The SVG fallback is the last entry in `imageCandidates`.
            data-uc-handled="1"
            noRetry
            className={`h-full w-full object-cover transition duration-500 group-hover:scale-105 ${
              nsfwGateUp ? "blur-xl brightness-50" : ""
            }`}
            onLoad={() => {
              if (cardImageSrc) forgetImageFailure(cardImageSrc)
              setImageLoaded(true)
            }}
            onError={() => {
              if (cardImageSrc && cardImageSrc !== FALLBACK_SRC) markImageFailed(cardImageSrc)
              if (resolvedCandidateIndex < imageCandidates.length - 1) {
                setImageCandidateIndex(resolvedCandidateIndex + 1)
                return
              }
              setImageLoaded(true)
            }}
          />
          {/* NSFW overlay: show Reveal button when not revealed. Match the
              chrome used by the full-size GameCard so the reveal target looks
              and behaves identically on compact tiles. z-30 lifts it above the
              bottom title gradient (which previously could obscure the "Tap to
              reveal" hint) and any sibling overlays. */}
          {nsfwGateUp && (
            <div className="absolute inset-0 z-30 bg-black/50 flex flex-col items-center justify-center gap-2">
              <div className="bg-red-600 text-white px-3 py-1 rounded-full text-xs font-bold">18+</div>
              <button
                type="button"
                aria-label={`Reveal NSFW cover for ${game.name}`}
                className="mt-1 bg-secondary/80 hover:bg-primary hover:text-primary-foreground text-white text-xs font-semibold px-3 py-1.5 rounded-full border border-border transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  revealNsfw()
                }}
              >
                Reveal
              </button>
              <span className="text-white/50 text-[10px]">Tap to reveal</span>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 via-black/20 to-transparent px-4 py-3">
            <span className="sr-only">{game.name}</span>
            <p className="text-sm font-semibold text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
              {game.name}
            </p>
          </div>
        </div>
      </div>
      </Link>
      <GameActionContextMenu
        open={contextMenuPos != null}
        position={contextMenuPos}
        onClose={closeContextMenu}
        {...menuProps}
      />
    </div>
    </GameArtAura>
  )
})

