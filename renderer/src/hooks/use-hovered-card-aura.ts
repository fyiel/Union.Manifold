import { useEffect, useRef, useState } from "react"
import { useImageColors } from "@/hooks/use-image-colors"

/**
 * Listens to the `uc_card_hover_aura` window event (dispatched by `GameArtAura`)
 * and produces an `opacity` value plus the dominant colors of the currently
 * hovered card. Drop the result into a wrapped `<AuraBackground />` to get a
 * full-page glow that follows the cursor between game cards.
 */
export function useHoveredCardAura(hideDelayMs = 250) {
  const [hoveredSrc, setHoveredSrc] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const colors = useImageColors(hoveredSrc)
  const [firstColorsReady, setFirstColorsReady] = useState(false)

  useEffect(() => {
    if (colors !== null) setFirstColorsReady(true)
  }, [colors])

  useEffect(() => {
    const handler = (e: Event) => {
      const { src } = (e as CustomEvent<{ src: string | null }>).detail
      if (src) {
        if (hideTimer.current) clearTimeout(hideTimer.current)
        setHoveredSrc(src)
        setVisible(true)
      } else {
        hideTimer.current = setTimeout(() => setVisible(false), hideDelayMs)
      }
    }
    window.addEventListener("uc_card_hover_aura", handler)
    return () => {
      window.removeEventListener("uc_card_hover_aura", handler)
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [hideDelayMs])

  const opacity = visible && (firstColorsReady || colors !== null) ? 1 : 0
  return { opacity, colors, isHovering: visible }
}
