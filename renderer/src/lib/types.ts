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
  /** System requirements published by the storefront (Phase 4 backend). */
  minRequirements?: GameRequirements | null
  recommendedRequirements?: GameRequirements | null
}

export type GameStats = Record<string, { downloads: number; views: number }>
