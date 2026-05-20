import { useState, type ReactNode, type CSSProperties } from "react"
import { useImageColors } from "@/hooks/use-image-colors"
import { DEFAULT_AURA_RGB } from "@/lib/aura-palette"

interface GameArtAuraProps {
  src: string | null | undefined
  scopeKey?: string | number
  dispatchPageAura?: boolean
  inset?: string
  borderRadius?: string
  className?: string
  style?: CSSProperties
  children: ReactNode
}

/**
 * Wraps a piece of game-related art (cover, hero, recommendation tile, etc.)
 * with a hover-triggered colored glow that mirrors the dominant colors of the
 * image. Also broadcasts the hovered image URL via the `uc_card_hover_aura`
 * window event so a page-level aura can react.
 *
 * Pools mount with a default iOS palette before extraction completes, so the
 * opacity fade fires the instant the card is hovered instead of popping in
 * once colors arrive (which read as a flash). When real colors arrive, the
 * pool backgroundColor transitions smoothly to them.
 */
export function GameArtAura({
  src,
  scopeKey,
  dispatchPageAura = true,
  inset = "-8px",
  borderRadius = "1rem",
  className,
  style,
  children,
}: GameArtAuraProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [shouldExtract, setShouldExtract] = useState(false)
  const safeSrc = src && !src.includes("/fallbacks/") ? src : null
  const auraSrc = shouldExtract ? safeSrc : null
  const extracted = useImageColors(auraSrc, scopeKey)
  const colors = extracted ?? DEFAULT_AURA_RGB

  const onEnter = () => {
    setShouldExtract(true)
    setIsHovered(true)
    if (dispatchPageAura && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("uc_card_hover_aura", { detail: { src: safeSrc } })
      )
    }
  }
  const onLeave = () => {
    setIsHovered(false)
    if (dispatchPageAura && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("uc_card_hover_aura", { detail: { src: null } })
      )
    }
  }

  return (
    <div
      className={`relative ${className ?? ""}`}
      style={style}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div
        className="absolute overflow-hidden pointer-events-none"
        aria-hidden="true"
        style={{
          inset,
          borderRadius,
          opacity: isHovered ? 1 : 0,
          transition: "opacity 1100ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        <div
          className="aura-pool absolute rounded-full"
          style={{
            top: "-5%", left: "-5%", width: "70%", height: "70%",
            backgroundColor: `rgb(${colors[0][0]},${colors[0][1]},${colors[0][2]})`,
            filter: "blur(28px)",
            opacity: 0.38,
            mixBlendMode: "screen",
            transition: "background-color 1200ms cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        />
        <div
          className="aura-pool absolute rounded-full"
          style={{
            bottom: "-5%", right: "-5%", width: "70%", height: "70%",
            backgroundColor: `rgb(${(colors[1] ?? colors[0])[0]},${(colors[1] ?? colors[0])[1]},${(colors[1] ?? colors[0])[2]})`,
            filter: "blur(28px)",
            opacity: 0.32,
            mixBlendMode: "screen",
            transition: "background-color 1200ms cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        />
        {colors[2] && (
          <div
            className="aura-pool absolute rounded-full"
            style={{
              top: "25%", left: "15%", width: "60%", height: "55%",
              backgroundColor: `rgb(${colors[2][0]},${colors[2][1]},${colors[2][2]})`,
              filter: "blur(34px)",
              opacity: 0.24,
              mixBlendMode: "screen",
              transition: "background-color 1200ms cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          />
        )}
      </div>
      {children}
    </div>
  )
}
