export interface GameRequirements {
  /** Free-text from the game's storefront. Always shown to the user. */
  raw?: string | null
  os?: string | string[] | null
  cpu?: string | null
  /** Minimum GPU name. May be a list of accepted models. */
  gpu?: string | string[] | null
  /** GB of system RAM. */
  ramGb?: number | null
  /** GB of free storage required. */
  storageGb?: number | null
  directx?: string | null
  vulkan?: string | null
  notes?: string | null
}

export interface Game {
  appid: string
  name: string
  description: string
  genres: string[]
  image: string
  screenshots: string[]
  splash?: string
  hero_image?: string
  hero_animated?: string
  hero_logo?: string
  release_date: string
  size: string
  /** Best-effort numeric size of the downloadable archive(s), in bytes. */
  sizeBytes?: number
  /** Best-effort numeric size of the extracted/installed game, in bytes. */
  installedSizeBytes?: number
  version?: string
  developer: string
  source: string
  store: string
  comment?: string
  dlc: string[]
  update_time?: string
  release_time?: string
  addedAt?: number
  hasCoOp?: boolean
  hasHv?: boolean
  isExternal?: boolean
  externalPath?: string
  /** System requirements published by the storefront (Phase 4 backend).
   *  Windows. */
  minRequirements?: GameRequirements | null
  recommendedRequirements?: GameRequirements | null
  /** Linux peers (Steam's linux_requirements block).
   *  Null when the storefront doesn't publish Linux specs — a Windows-only
   *  title. UC.D on Linux should fall back to the Windows comparator in
   *  that case (the user might run via Proton). */
  linuxMinRequirements?: GameRequirements | null
  linuxRecommendedRequirements?: GameRequirements | null
  /** Launcher metadata chosen by staff in the website admin panel. The
   *  executable path is relative to the install folder (e.g. "bin/Game.exe").
   *  When present, UC.D prefers this over its heuristic exe detection so our
   *  release's correct binary (which can differ from Steam's by emulator/
   *  repack) is launched without prompting. Empty when not configured. */
  game_executable_path?: string | null
  game_executable_cwd?: string | null
  game_executable_args?: string | null
}

export type GameStats = Record<string, { downloads: number; views: number }>
