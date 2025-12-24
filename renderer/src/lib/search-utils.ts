export function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .trim()
}

export function createSearchIndex(games: any[]) {
  return games.map((game) => ({
    ...game,
    searchText: normalizeString(`${game.name} ${game.description} ${game.genres.join(" ")}`),
  }))
}

export function parseSize(sizeStr: string): number {
  const match = sizeStr.match(/(\d+(?:\.\d+)?)\s*(GB|MB|KB)/i)
  if (!match) return 0

  const value = Number.parseFloat(match[1])
  const unit = match[2].toUpperCase()

  switch (unit) {
    case "GB":
      return value * 1024 * 1024 * 1024
    case "MB":
      return value * 1024 * 1024
    case "KB":
      return value * 1024
    default:
      return value
  }
}
