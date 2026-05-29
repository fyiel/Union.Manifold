/** Converts any CSS color string (oklch, hex, rgb, hsl) to a 6-digit hex via
 *  the browser's CSS engine. Alpha is dropped. Falls back to #000000 if the
 *  browser can't parse the input. */
export function cssColorToHex(value: string): string {
  if (typeof document === "undefined") return "#000000"
  const el = document.createElement("div")
  el.style.color = value
  document.body.appendChild(el)
  const computed = getComputedStyle(el).color
  document.body.removeChild(el)
  const rgbMatch = computed.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  if (!rgbMatch) return "#000000"
  const r = parseInt(rgbMatch[1], 10)
  const g = parseInt(rgbMatch[2], 10)
  const b = parseInt(rgbMatch[3], 10)
  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")
}

/** Crockford-ish ID generator — short, URL-safe, no external dep. */
export function generateThemeId(prefix = "ct"): string {
  const rand = Math.random().toString(36).slice(2, 10)
  const time = Date.now().toString(36)
  return `${prefix}-${time}-${rand}`
}

/** Lower-cased slug suitable for community gallery URLs. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "theme"
}
