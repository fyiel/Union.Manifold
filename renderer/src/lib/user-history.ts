const HISTORY_COOKIE_NAME = "unioncrax_history"
const MAX_HISTORY_ITEMS = 50
const COOKIE_EXPIRY_DAYS = 365

interface UserHistory {
  downloadedGames: string[]
  lastUpdated: number
}

function getDefaultHistory(): UserHistory {
  return { downloadedGames: [], lastUpdated: 0 }
}

function getUserHistory(): UserHistory {
  if (typeof window === "undefined") return getDefaultHistory()

  try {
    const cookieValue = document.cookie
      .split("; ")
      .find((row) => row.startsWith(`${HISTORY_COOKIE_NAME}=`))
      ?.split("=")[1]

    if (!cookieValue) return getDefaultHistory()

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
