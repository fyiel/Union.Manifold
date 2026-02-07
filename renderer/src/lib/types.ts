export interface Game {
  appid: string
  name: string
  description: string
  genres: string[]
  image: string
  screenshots: string[]
  splash?: string
  release_date: string
  size: string
  version?: string
  developer: string
  source: string
  store: string
  comment?: string
  dlc: string[]
  update_time?: string
  hasCoOp?: boolean
  isExternal?: boolean
  externalPath?: string
}

export type GameStats = Record<string, { downloads: number; views: number }>
