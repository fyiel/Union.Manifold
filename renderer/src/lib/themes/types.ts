export const THEME_SCHEMA_VERSION = 1 as const

export const COLOR_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "ring",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
] as const

export type ColorToken = (typeof COLOR_TOKENS)[number]

export type ThemeColors = Record<ColorToken, string>

export type ThemeSource = "preset" | "custom" | "community"

export type ThemeDef = {
  schemaVersion: typeof THEME_SCHEMA_VERSION
  id: string
  name: string
  source: ThemeSource
  authorDiscordId?: string
  colors: ThemeColors
  radius: string
  fontSans: string
  fontMono: string
}
