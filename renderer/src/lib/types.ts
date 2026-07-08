export interface GameRequirements {
  raw?: string | null
  os?: string | string[] | null
  cpu?: string | null
  gpu?: string | string[] | null
  ramGb?: number | null
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
  localImage?: string
  localSplash?: string
  localHeroImage?: string
  localHeroLogo?: string
  localBackgroundImage?: string
  localScreenshots?: string[]
  release_date: string
  size: string
  sizeBytes?: number
  installedSizeBytes?: number
  version?: string
  developer: string
  source: string
  store: string
  comment?: string
  dlc: string[]
  posted_time?: string
  edited_time?: string
  update_time?: string
  release_time?: string
  addedAt?: number
  hasCoOp?: boolean
  hasHv?: boolean
  isExternal?: boolean
  externalPath?: string
  minRequirements?: GameRequirements | null
  recommendedRequirements?: GameRequirements | null
  linuxMinRequirements?: GameRequirements | null
  linuxRecommendedRequirements?: GameRequirements | null
  game_executable_path?: string | null
  game_executable_cwd?: string | null
  game_executable_args?: string | null
}

export type GameStats = Record<string, { downloads: number; views: number }>
