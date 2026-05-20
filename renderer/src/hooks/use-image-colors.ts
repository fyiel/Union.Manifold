import { useEffect, useState } from "react"
import { extractDominantColors, type RGB } from "@/lib/extract-colors"

/**
 * Extract dominant colours from an image URL.
 * Returns `null` while extracting, then an array of 4 RGB tuples.
 * Re-runs whenever `src` or `scopeKey` changes (pass the game appid as scopeKey
 * to force re-extraction when the game changes, even if the URL is the same).
 *
 * NOTE: no prevSrc ref is used for deduplication. React's deps array already
 * handles that. The ref pattern was breaking React 18 Strict Mode: cleanup sets
 * `active = false`, then the second invocation sees prevSrc already set and
 * returns early — leaving `colors` as null permanently.
 */
export function useImageColors(src: string | undefined | null, scopeKey?: string | number): RGB[] | null {
  const [colors, setColors] = useState<RGB[] | null>(null)

  useEffect(() => {
    if (!src) {
      setColors(null)
      return
    }
    // Clear stale palette immediately so the previous game's colors don't
    // persist while the new extraction is in-flight.
    setColors(null)

    let active = true
    extractDominantColors(src, 4).then((result) => {
      if (active) setColors(result)
    })
    return () => { active = false }
  }, [src, scopeKey])

  return colors
}
