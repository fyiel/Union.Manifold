import { validateTheme } from "./validate"
import type { ThemeDef } from "./types"

const PREFIX = "ucth1:"

function b64encode(s: string): string {
  if (typeof btoa === "function") {
    return btoa(unescape(encodeURIComponent(s)))
  }
  // Node fallback (never hit in the Electron renderer, which always has btoa).
  return (globalThis as any).Buffer.from(s, "utf8").toString("base64")
}

function b64decode(s: string): string {
  if (typeof atob === "function") {
    return decodeURIComponent(escape(atob(s)))
  }
  // Node fallback (never hit in the Electron renderer, which always has atob).
  return (globalThis as any).Buffer.from(s, "base64").toString("utf8")
}

/** Serialize a theme to a portable copy/paste string. */
export function encodeTheme(theme: ThemeDef): string {
  return PREFIX + b64encode(JSON.stringify(theme))
}

export function decodeTheme(input: string): { ok: true; theme: ThemeDef } | { ok: false; error: string } {
  const trimmed = input.trim()
  if (!trimmed.startsWith(PREFIX)) return { ok: false, error: "Not a UC theme string" }
  let json: unknown
  try {
    json = JSON.parse(b64decode(trimmed.slice(PREFIX.length)))
  } catch {
    return { ok: false, error: "Corrupt theme string" }
  }
  return validateTheme(json)
}
