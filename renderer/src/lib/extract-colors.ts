/**
 * extract-colors.ts — Lightweight dominant-color extraction from an image URL.
 *
 * Draws the image to a tiny off-screen canvas (50×50), samples all pixels,
 * then runs a quick k-means (k=3, 8 iterations) to find the three most
 * representative colours. Results are lightly boosted in saturation so they
 * pop against the dark UI background.
 *
 * Used by the ambient game-page background to create colour-aware animated
 * glow blobs instead of a generic white conic gradient.
 */

export type RGB = [number, number, number]

/* ------------------------------------------------------------------ */
/*  Colour-space helpers                                              */
/* ------------------------------------------------------------------ */

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h, s, l]
}

function hslToRgb(h: number, s: number, l: number): RGB {
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ]
}

function colorDist(a: RGB, b: RGB): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/** Fallback muted palette when extraction fails or the image is too plain. */
const FALLBACK: RGB[] = [[100, 80, 130], [80, 110, 140], [130, 90, 80]]

/**
 * Extract `count` dominant colours from `src`.
 * Resolves quickly (< 20 ms for a typical image) because the canvas is tiny.
 */
export function extractDominantColors(
  src: string,
  count = 3,
): Promise<RGB[]> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve(FALLBACK)
      return
    }

    const img = new Image()
    img.crossOrigin = "anonymous"

    img.onload = () => {
      try {
        const size = 50
        const canvas = document.createElement("canvas")
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext("2d", { willReadFrequently: true })
        if (!ctx) { resolve(FALLBACK); return }

        ctx.drawImage(img, 0, 0, size, size)
        const { data } = ctx.getImageData(0, 0, size, size)

        // Collect all non-boring pixels
        const pixels: RGB[] = []
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
          if (a < 128) continue
          const [, s, l] = rgbToHsl(r, g, b)
          // Skip very dark, very bright, or near-grey pixels
          if (l < 0.07 || l > 0.93 || s < 0.04) continue
          pixels.push([r, g, b])
        }

        if (pixels.length < 10) {
          resolve(FALLBACK)
          return
        }

        // --- k-means (k = count, 8 iterations) ---
        // Seed centroids with k-means++ style: maximise distance from existing centroids
        const centroids: RGB[] = [pixels[Math.floor(Math.random() * pixels.length)]]
        for (let i = 1; i < count; i++) {
          let bestDist = -1
          let bestPixel = pixels[0]
          for (const p of pixels) {
            const nearest = Math.min(...centroids.map((c) => colorDist(p, c)))
            if (nearest > bestDist) {
              bestDist = nearest
              bestPixel = p
            }
          }
          centroids.push([...bestPixel])
        }

        for (let iter = 0; iter < 8; iter++) {
          const clusters: RGB[][] = Array.from({ length: count }, () => [])
          for (const p of pixels) {
            let minD = Infinity
            let ci = 0
            for (let j = 0; j < centroids.length; j++) {
              const d = colorDist(p, centroids[j])
              if (d < minD) { minD = d; ci = j }
            }
            clusters[ci].push(p)
          }
          for (let j = 0; j < count; j++) {
            const cl = clusters[j]
            if (cl.length === 0) continue
            let sr = 0, sg = 0, sb = 0
            for (const p of cl) { sr += p[0]; sg += p[1]; sb += p[2] }
            centroids[j] = [
              Math.round(sr / cl.length),
              Math.round(sg / cl.length),
              Math.round(sb / cl.length),
            ]
          }
        }

        // Boost saturation & clamp lightness so colours pop on dark backgrounds
        const boosted = centroids.map(([r, g, b]) => {
          const [h, s, l] = rgbToHsl(r, g, b)
          return hslToRgb(h, Math.min(1, s * 1.4), Math.min(0.6, Math.max(0.3, l)))
        })

        resolve(boosted)
      } catch {
        resolve(FALLBACK)
      }
    }

    img.onerror = () => resolve(FALLBACK)
    img.src = src
  })
}
