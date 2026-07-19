const STORAGE_KEY = "uc_play_later"
const CHANGE_EVENT = "uc_play_later_changed"

export type PlayLaterEntry = {
  game: UnifiedSourceGame
  addedAt: number
}

export function getPlayLater(): PlayLaterEntry[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")
    if (!Array.isArray(value)) return []
    return value.filter((entry): entry is PlayLaterEntry => {
      if (!entry || typeof entry !== "object") return false
      const candidate = entry as Partial<PlayLaterEntry>
      return typeof candidate.addedAt === "number"
        && typeof candidate.game?.dedupKey === "string"
        && typeof candidate.game.title === "string"
        && Array.isArray(candidate.game.sources)
    })
  } catch {
    return []
  }
}

export function isPlayLater(dedupKey: string): boolean {
  return getPlayLater().some((entry) => entry.game.dedupKey === dedupKey)
}

export function togglePlayLater(game: UnifiedSourceGame): boolean {
  const entries = getPlayLater()
  const index = entries.findIndex((entry) => entry.game.dedupKey === game.dedupKey)
  const wasSaved = index >= 0

  if (wasSaved) {
    entries.splice(index, 1)
  } else {
    const { description: _description, fullyResolved: _fullyResolved, ...summary } = game
    entries.unshift({
      addedAt: Date.now(),
      game: {
        ...summary,
        sources: game.sources.map(({ description: _description, downloadOptions: _downloadOptions, ...source }) => source),
      },
    })
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
    window.dispatchEvent(new Event(CHANGE_EVENT))
    return !wasSaved
  } catch {
    return wasSaved
  }
}

export function onPlayLaterChanged(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener()
  }
  window.addEventListener(CHANGE_EVENT, listener)
  window.addEventListener("storage", onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener)
    window.removeEventListener("storage", onStorage)
  }
}
