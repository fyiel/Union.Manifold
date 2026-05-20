import type { RGB } from "./extract-colors"

// iOS signature palette — shown while extracted colors are still loading.
// Mirrors the hex defaults in components/aura-background.tsx so the per-card
// glow and the full-page aura share one source of truth.
export const DEFAULT_AURA_RGB: RGB[] = [
  [88, 86, 214],   // #5856D6
  [0, 122, 255],   // #007AFF
  [255, 45, 85],   // #FF2D55
  [175, 82, 222],  // #AF52DE
]
