import { COLOR_TOKENS, type ThemeDef } from "./types"
import { resolveFontStack } from "./fonts"

export function applyTheme(def: ThemeDef): void {
  if (typeof document === "undefined") return
  const root = document.documentElement
  for (const token of COLOR_TOKENS) {
    const value = def.colors[token]
    if (typeof value === "string" && value.length > 0) {
      root.style.setProperty(`--${token}`, value)
    }
  }
  root.style.setProperty("--radius", def.radius)
  // The Tailwind v4 `@theme inline` block redirects `--font-sans` → these
  // runtime variables, so updating them re-flows every `.font-sans` /
  // `.font-mono` utility class across the app, not just elements that read
  // the var directly.
  root.style.setProperty("--font-sans-active", resolveFontStack(def.fontSans, "sans"))
  root.style.setProperty("--font-mono-active", resolveFontStack(def.fontMono, "mono"))
  root.dataset.themeId = def.id
}

export function clearAppliedTheme(): void {
  if (typeof document === "undefined") return
  const root = document.documentElement
  for (const token of COLOR_TOKENS) {
    root.style.removeProperty(`--${token}`)
  }
  root.style.removeProperty("--radius")
  root.style.removeProperty("--font-sans-active")
  root.style.removeProperty("--font-mono-active")
  delete root.dataset.themeId
}
