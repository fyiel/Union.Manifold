export type AdvancedCache = {
  query: string
  enabled: Record<string, boolean>
  cats: string[]
  sizeMin: number
  sizeMax: number
  yearFrom: number
  yearTo: number
  directOnly: boolean
  sort: string
  games: UnifiedSourceGame[]
  total: number
  genreOptions: string[]
  offset: number
  paramsKey: string
}

let cache: AdvancedCache | null = null

export function getAdvancedCache(): AdvancedCache | null {
  return cache
}

export function setAdvancedCache(next: AdvancedCache): void {
  cache = next
}
