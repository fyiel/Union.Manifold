import { COLOR_TOKENS, THEME_SCHEMA_VERSION, type ColorToken, type ThemeColors, type ThemeDef } from "./types"

const OKLCH_PATTERN = /^oklch\(\s*[\d.]+\s+[\d.]+\s+[\d.]+\s*(\/\s*[\d.]+\s*)?\)$/i
const HEX_PATTERN = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const RGB_PATTERN = /^rgba?\(\s*[\d.]+\s*[ ,]\s*[\d.]+\s*[ ,]\s*[\d.]+\s*([ ,/]\s*[\d.]+%?\s*)?\)$/i
const HSL_PATTERN = /^hsla?\(\s*[\d.]+(?:deg|rad|grad|turn)?\s*[ ,]\s*[\d.]+%\s*[ ,]\s*[\d.]+%\s*([ ,/]\s*[\d.]+%?\s*)?\)$/i

function isValidColorString(value: unknown): value is string {
  if (typeof value !== "string") return false
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 80) return false
  return (
    OKLCH_PATTERN.test(trimmed) ||
    HEX_PATTERN.test(trimmed) ||
    RGB_PATTERN.test(trimmed) ||
    HSL_PATTERN.test(trimmed)
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export type ValidationResult =
  | { ok: true; theme: ThemeDef }
  | { ok: false; error: string }

export function validateTheme(input: unknown): ValidationResult {
  if (!isPlainObject(input)) return { ok: false, error: "Theme must be an object" }

  if (input.schemaVersion !== THEME_SCHEMA_VERSION) {
    return { ok: false, error: `Unsupported schemaVersion (expected ${THEME_SCHEMA_VERSION})` }
  }
  if (typeof input.id !== "string" || input.id.length === 0 || input.id.length > 120) {
    return { ok: false, error: "Invalid theme id" }
  }
  if (typeof input.name !== "string" || input.name.trim().length === 0 || input.name.length > 60) {
    return { ok: false, error: "Theme name must be 1-60 chars" }
  }
  if (input.source !== "preset" && input.source !== "custom" && input.source !== "community") {
    return { ok: false, error: "Invalid source" }
  }
  if (input.authorDiscordId !== undefined && (typeof input.authorDiscordId !== "string" || input.authorDiscordId.length > 64)) {
    return { ok: false, error: "Invalid authorDiscordId" }
  }
  if (typeof input.radius !== "string" || !/^[\d.]+(rem|px|em)$/.test(input.radius)) {
    return { ok: false, error: "Invalid radius" }
  }
  if (typeof input.fontSans !== "string" || input.fontSans.length > 40) {
    return { ok: false, error: "Invalid fontSans" }
  }
  if (typeof input.fontMono !== "string" || input.fontMono.length > 40) {
    return { ok: false, error: "Invalid fontMono" }
  }
  if (!isPlainObject(input.colors)) {
    return { ok: false, error: "Missing colors" }
  }

  const colors: Partial<ThemeColors> = {}
  for (const token of COLOR_TOKENS) {
    const v = (input.colors as Record<string, unknown>)[token]
    if (!isValidColorString(v)) {
      return { ok: false, error: `Invalid color token "${token}"` }
    }
    colors[token as ColorToken] = v
  }

  return {
    ok: true,
    theme: {
      schemaVersion: THEME_SCHEMA_VERSION,
      id: input.id,
      name: input.name.trim(),
      source: input.source,
      authorDiscordId: typeof input.authorDiscordId === "string" ? input.authorDiscordId : undefined,
      colors: colors as ThemeColors,
      radius: input.radius,
      fontSans: input.fontSans,
      fontMono: input.fontMono,
    },
  }
}

function parseOklchLightness(value: string): number | null {
  const m = value.trim().match(/^oklch\(\s*([\d.]+)\s+/i)
  if (!m) return null
  const l = parseFloat(m[1])
  return Number.isFinite(l) ? l : null
}

/** Reject themes where foreground/background contrast would be invisible.
 *  Cheap heuristic on OKLch lightness — full APCA contrast would be nicer. */
export function hasReadableContrast(theme: ThemeDef): boolean {
  const bg = parseOklchLightness(theme.colors.background)
  const fg = parseOklchLightness(theme.colors.foreground)
  if (bg === null || fg === null) return true
  return Math.abs(fg - bg) >= 0.35
}
