import { useEffect, useRef, useState } from "react"
import { extractDominantColors, type RGB } from "@/lib/extract-colors"

/**
 * Extract dominant colours from an image URL.
 * Returns `null` until extraction completes, then an array of 3 RGB tuples.
 * Re-runs when `src` changes.  Skips work on SSR.
 */
export function useImageColors(src: string | undefined | null): RGB[] | null {
  const [colors, setColors] = useState<RGB[] | null>(null)
  const prevSrc = useRef<string | null>(null)

  useEffect(() => {
    if (!src) { setColors(null); return }
    if (src === prevSrc.current) return
    prevSrc.current = src

    let active = true
    extractDominantColors(src, 3).then((result) => {
      if (active) setColors(result)
    })
    return () => { active = false }
  }, [src])

  return colors
}
