// Module-scoped cache for the Advanced Search page, same idea as browse-cache.
// Kept outside the component so it survives navigating away and back (open a
// game from the results, return, restore the exact filtered view + scroll depth
// instead of re-querying). Lives in its own module so editing the page doesn't
// wipe it under Fast Refresh.
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
  // Serialized backend params that produced `games`, restore without a refetch
  // only when the live params still match this.
  paramsKey: string
}

let cache: AdvancedCache | null = null

export function getAdvancedCache(): AdvancedCache | null {
  return cache
}

export function setAdvancedCache(next: AdvancedCache): void {
  cache = next
}
