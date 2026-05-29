export type FontKey = string

export type FontEntry = {
  key: FontKey
  label: string
  stack: string
  kind: "sans" | "mono"
}

/* Each stack leads with `var(--font-<key>)` (resolves on the web where
   next/font sets it), then the literal CDN-loaded family name, then a
   distinctive system fallback so picks remain visually distinguishable
   even if Google Fonts didn't load (Electron offline, CSP, etc). */
const SANS_FONTS: FontEntry[] = [
  { key: "inter",          label: "Inter",          stack: 'var(--font-inter), "Inter", "Segoe UI", ui-sans-serif, sans-serif',           kind: "sans" },
  { key: "geist",          label: "Geist",          stack: 'var(--font-geist), "Geist", "Segoe UI", ui-sans-serif, sans-serif',            kind: "sans" },
  { key: "ibm-plex-sans",  label: "IBM Plex Sans",  stack: 'var(--font-ibm-plex-sans), "IBM Plex Sans", "Verdana", sans-serif',            kind: "sans" },
  { key: "space-grotesk",  label: "Space Grotesk",  stack: 'var(--font-space-grotesk), "Space Grotesk", "Trebuchet MS", sans-serif',       kind: "sans" },
  { key: "segoe",          label: "Segoe UI",       stack: '"Segoe UI", "Helvetica Neue", sans-serif',                                      kind: "sans" },
  { key: "georgia",        label: "Georgia (serif)", stack: 'Georgia, "Times New Roman", serif',                                            kind: "sans" },
  { key: "comic",          label: "Comic Sans",     stack: '"Comic Sans MS", "Chalkboard SE", cursive',                                     kind: "sans" },
  { key: "system",         label: "System UI",      stack: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',               kind: "sans" },
]

const MONO_FONTS: FontEntry[] = [
  { key: "geist-mono",     label: "Geist Mono",     stack: 'var(--font-geist-mono), "Geist Mono", "Cascadia Code", Consolas, monospace',    kind: "mono" },
  { key: "jetbrains-mono", label: "JetBrains Mono", stack: 'var(--font-jetbrains-mono), "JetBrains Mono", "Cascadia Code", Consolas, monospace', kind: "mono" },
  { key: "ibm-plex-mono",  label: "IBM Plex Mono",  stack: 'var(--font-ibm-plex-mono), "IBM Plex Mono", "Cascadia Code", Consolas, monospace',   kind: "mono" },
  { key: "fira-code",      label: "Fira Code",      stack: 'var(--font-fira-code), "Fira Code", "Cascadia Code", Consolas, monospace',           kind: "mono" },
  { key: "consolas",       label: "Consolas",       stack: 'Consolas, "Courier New", monospace',                                                  kind: "mono" },
  { key: "courier",        label: "Courier New",    stack: '"Courier New", Courier, monospace',                                                   kind: "mono" },
  { key: "system-mono",    label: "System Mono",    stack: 'ui-monospace, "SF Mono", Consolas, monospace',                                        kind: "mono" },
]

export const FONT_REGISTRY = {
  sans: SANS_FONTS,
  mono: MONO_FONTS,
}

const SANS_INDEX = new Map(SANS_FONTS.map((f) => [f.key, f]))
const MONO_INDEX = new Map(MONO_FONTS.map((f) => [f.key, f]))

export function resolveFontStack(key: FontKey, kind: "sans" | "mono"): string {
  const entry = (kind === "sans" ? SANS_INDEX : MONO_INDEX).get(key)
  if (entry) return entry.stack
  return kind === "sans" ? SANS_FONTS[0].stack : MONO_FONTS[0].stack
}

export const DEFAULT_FONT_SANS: FontKey = "inter"
export const DEFAULT_FONT_MONO: FontKey = "geist-mono"
