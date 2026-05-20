const CANONICAL_GENRE_LABELS: Record<string, string> = {
  ar: "AR",
  mr: "MR",
  nsfw: "NSFW",
  vr: "VR",
}

export function normalizeGenreLabel(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ")
  if (!trimmed) return ""

  const canonical = CANONICAL_GENRE_LABELS[trimmed.toLowerCase()]
  return canonical ?? trimmed
}

export function normalizeGenreList(value: unknown): string[] {
  let rawGenres: string[] = []

  if (Array.isArray(value)) {
    rawGenres = value.filter((genre): genre is string => typeof genre === "string")
  } else if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) {
        rawGenres = parsed.filter((genre): genre is string => typeof genre === "string")
      } else {
        rawGenres = value.split(",")
      }
    } catch {
      rawGenres = value.split(",")
    }
  } else {
    return []
  }

  const seen = new Set<string>()
  const normalizedGenres: string[] = []

  for (const rawGenre of rawGenres) {
    const genre = normalizeGenreLabel(rawGenre)
    if (!genre) continue

    const key = genre.toLowerCase()
    if (seen.has(key)) continue

    seen.add(key)
    normalizedGenres.push(genre)
  }

  return normalizedGenres
}

export function normalizeGenreKey(value: string): string {
  return normalizeGenreLabel(value).toLowerCase()
}

export function buildGenreWeights(items: Array<{ genres?: unknown }>): Record<string, number> {
  const weights: Record<string, number> = {}

  for (const item of items) {
    const uniqueGenres = new Set(
      normalizeGenreList(item?.genres).map((genre) => normalizeGenreKey(genre)).filter(Boolean),
    )

    for (const genre of uniqueGenres) {
      weights[genre] = (weights[genre] || 0) + 1
    }
  }

  return weights
}

export function getGenreRecommendationScore(genres: unknown, weights: Record<string, number>): number {
  if (Object.keys(weights).length === 0) {
    return 0
  }

  const uniqueGenres = new Set(normalizeGenreList(genres).map((genre) => normalizeGenreKey(genre)).filter(Boolean))
  let score = 0

  for (const genre of uniqueGenres) {
    score += weights[genre] || 0
  }

  return score
}
