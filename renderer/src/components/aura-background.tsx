import { useEffect, useRef, useState } from "react"
import type { RGB } from "@/lib/extract-colors"

// iOS signature palette – shown while game colors are loading or as hard fallback.
const DEFAULT_PALETTE = ["#5856D6", "#007AFF", "#FF2D55", "#AF52DE"] as const
type Palette = [string, string, string, string]

function rgbToHex([r, g, b]: RGB): string {
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`
}

interface AuraBackgroundProps {
  /**
   * Dominant colors extracted from the game image (via useImageColors).
   * null = still extracting; the default iOS palette is shown in the meantime.
   */
  colors: RGB[] | null
  /**
   * Whether to show the animated color pools.
   * false = show a static blurred image instead (or nothing if no fallback is set).
   */
  show: boolean
  /**
   * Disables drift animation on the pools while still showing them.
   * Covers the in-app reduced-motion toggle and OS prefers-reduced-motion.
   * OS `prefers-reduced-motion` is also handled via a CSS media query in globals.css.
   */
  reducedMotion: boolean
  /**
   * Image URL shown as a static blur when show=false.
   * When undefined and show=false the component renders nothing.
   */
  fallbackImageSrc?: string
}

/**
 * Apple-style ambient background using four drifting color pools.
 * Extracts dominant colors from the game image via props and crossfades
 * between a pair of dual layers when the palette changes.
 */
export function AuraBackground({ colors, show, reducedMotion, fallbackImageSrc }: AuraBackgroundProps) {
  // Two layer slots — we GPU-crossfade between them when colors change.
  const [slots, setSlots] = useState<[Palette, Palette]>([
    [...DEFAULT_PALETTE] as Palette,
    [...DEFAULT_PALETTE] as Palette,
  ])
  const [activeSlot, setActiveSlot] = useState<0 | 1>(0)
  // Ref prevents stale-closure issues in the effect below.
  const activeSlotRef = useRef<0 | 1>(0)

  useEffect(() => {
    if (!colors || colors.length === 0) return

    let palette: Palette
    if (colors.length >= 4) {
      palette = [
        rgbToHex(colors[0]),
        rgbToHex(colors[1]),
        rgbToHex(colors[2]),
        rgbToHex(colors[3]),
      ]
    } else {
      // 3-color fallback: reuse first color for the 4th pool.
      palette = [
        rgbToHex(colors[0]),
        rgbToHex(colors[1]),
        rgbToHex(colors[2]),
        rgbToHex(colors[0]),
      ]
    }

    const nextSlot: 0 | 1 = activeSlotRef.current === 0 ? 1 : 0
    activeSlotRef.current = nextSlot

    // Paint the hidden layer first, then crossfade to it.
    setSlots((prev) => {
      const next: [Palette, Palette] = [prev[0], prev[1]]
      next[nextSlot] = palette
      return next
    })
    setActiveSlot(nextSlot)
  }, [colors])

  // Static blurred image mode (animated backgrounds disabled by user).
  if (!show) {
    if (!fallbackImageSrc) return null
    return (
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <img
          src={fallbackImageSrc}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover opacity-35 blur-[24px] scale-125"
          onError={(e) => {
            const target = e.currentTarget
            if (!target.src.endsWith("./fallbacks/game-hero-16x9.svg")) {
              target.src = "./fallbacks/game-hero-16x9.svg"
            }
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/65 to-[#09090b]" />
      </div>
    )
  }

  // Color-pool mode: oversized container so pools never show hard edges at the viewport boundary.
  return (
    <div
      className="pointer-events-none fixed z-0 overflow-hidden"
      style={{ top: "-15%", left: "-15%", width: "130%", height: "130%" }}
      aria-hidden="true"
    >
      {([0, 1] as const).map((slot) => (
        <div
          key={slot}
          className="absolute inset-0"
          style={{
            opacity: activeSlot === slot ? 1 : 0,
            transition: "opacity 3s cubic-bezier(0.25, 1, 0.5, 1)",
            willChange: "opacity",
          }}
        >
          {/* Pool 1 – top-left */}
          <div
            className="aura-pool absolute rounded-full"
            style={{
              top: "10%", left: "15%", width: "65vw", height: "65vh",
              backgroundColor: slots[slot][0],
              filter: "blur(140px)",
              opacity: 0.65,
              mixBlendMode: "screen",
              animation: reducedMotion ? "none" : "aura-drift-1 32s infinite alternate ease-in-out",
              willChange: "transform",
            }}
          />
          {/* Pool 2 – bottom-right */}
          <div
            className="aura-pool absolute rounded-full"
            style={{
              bottom: "10%", right: "15%", width: "70vw", height: "70vh",
              backgroundColor: slots[slot][1],
              filter: "blur(140px)",
              opacity: 0.65,
              mixBlendMode: "screen",
              animation: reducedMotion ? "none" : "aura-drift-2 36s infinite alternate-reverse ease-in-out",
              willChange: "transform",
            }}
          />
          {/* Pool 3 – bottom-left */}
          <div
            className="aura-pool absolute rounded-full"
            style={{
              bottom: "15%", left: "20%", width: "55vw", height: "55vh",
              backgroundColor: slots[slot][2],
              filter: "blur(140px)",
              opacity: 0.65,
              mixBlendMode: "screen",
              animation: reducedMotion ? "none" : "aura-drift-3 28s infinite alternate ease-in-out",
              willChange: "transform",
            }}
          />
          {/* Pool 4 – top-right */}
          <div
            className="aura-pool absolute rounded-full"
            style={{
              top: "15%", right: "20%", width: "60vw", height: "60vh",
              backgroundColor: slots[slot][3],
              filter: "blur(140px)",
              opacity: 0.65,
              mixBlendMode: "screen",
              animation: reducedMotion ? "none" : "aura-drift-4 40s infinite alternate-reverse ease-in-out",
              willChange: "transform",
            }}
          />
        </div>
      ))}

      {/* Radial highlight at top */}
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(circle at 50% 0%, rgba(255,255,255,0.06), transparent 40%)" }}
      />
      {/* Vignette depth */}
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(circle at center, rgba(8,8,10,0.1) 0%, rgba(8,8,10,0.65) 100%)" }}
      />
      {/* Fade content into page background */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/65 to-[#09090b]" />
    </div>
  )
}
