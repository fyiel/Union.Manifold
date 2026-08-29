const HISTORY_COOKIE_NAME = "union_manifold_history"
const LEGACY_HISTORY_COOKIE_NAME = "unioncrax_history"
const MAX_HISTORY_ITEMS = 50
const COOKIE_EXPIRY_DAYS = 365

interface UserHistory {
  downloadedGames: string[]
  lastUpdated: number
}

function getDefaultHistory(): UserHistory {
  return { downloadedGames: [], lastUpdated: 0 }
}

function readHistoryCookie(name: string): string | undefined {
  return document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`))
    ?.split("=")[1]
}

function parseUserHistory(cookieValue: string | undefined): UserHistory {
  if (!cookieValue) return getDefaultHistory()
  try {
    const parsed: Partial<UserHistory> = JSON.parse(decodeURIComponent(cookieValue))
    return {
      downloadedGames: Array.isArray(parsed.downloadedGames)
        ? parsed.downloadedGames.filter((id): id is string => typeof id === "string")
        : [],
      lastUpdated: typeof parsed.lastUpdated === "number" ? parsed.lastUpdated : 0,
    }
  } catch {
    return getDefaultHistory()
  }
}

function getUserHistory(): UserHistory {
  if (typeof window === "undefined") return getDefaultHistory()

  try {
    const history = parseUserHistory(readHistoryCookie(HISTORY_COOKIE_NAME))
    if (history.downloadedGames.length > 0 || history.lastUpdated > 0) return history

    const legacy = parseUserHistory(readHistoryCookie(LEGACY_HISTORY_COOKIE_NAME))
    if (legacy.downloadedGames.length > 0) {
      saveUserHistory(legacy)
      document.cookie = `${LEGACY_HISTORY_COOKIE_NAME}=; max-age=0; path=/`
      return legacy
    }
    return history
  } catch {
    return getDefaultHistory()
  }
}

function saveUserHistory(history: UserHistory): void {
  if (typeof window === "undefined") return
  try {
    document.cookie = `${HISTORY_COOKIE_NAME}=${encodeURIComponent(JSON.stringify(history))}; max-age=${COOKIE_EXPIRY_DAYS * 86400}; path=/`
  } catch {
  }
}

export function addDownloadedGameToHistory(appid: string): void {
  if (!appid) return

  const history = getUserHistory()

  const filtered = history.downloadedGames.filter((id) => id !== appid)
  filtered.push(appid)

  history.downloadedGames = filtered.slice(-MAX_HISTORY_ITEMS)
  saveUserHistory(history)
}
