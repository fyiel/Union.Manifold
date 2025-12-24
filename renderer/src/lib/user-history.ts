interface UserHistory {
  searches: string[]
  viewedGames: string[]
  downloadedGames: string[]
  lastUpdated: number
}

const HISTORY_COOKIE_NAME = "unioncrax_history"
const MAX_HISTORY_ITEMS = 50
const COOKIE_EXPIRY_DAYS = 365

export function getUserHistory(): UserHistory {
  if (typeof window === "undefined") return getDefaultHistory()

  try {
    const cookieValue = document.cookie
      .split("; ")
      .find((row) => row.startsWith(`${HISTORY_COOKIE_NAME}=`))
      ?.split("=")[1]

    if (!cookieValue) return getDefaultHistory()

    const decoded = decodeURIComponent(cookieValue)
    const history = JSON.parse(decoded)

    if (!history || typeof history !== "object") return getDefaultHistory()

    return {
      searches: Array.isArray(history.searches) ? history.searches : [],
      viewedGames: Array.isArray(history.viewedGames) ? history.viewedGames : [],
      downloadedGames: Array.isArray(history.downloadedGames) ? history.downloadedGames : [],
      lastUpdated: typeof history.lastUpdated === "number" ? history.lastUpdated : Date.now(),
    }
  } catch (error) {
    console.error("[UC] Error parsing user history:", error)
    return getDefaultHistory()
  }
}

export function saveUserHistory(history: UserHistory): void {
  if (typeof window === "undefined") return

  try {
    const limitedHistory = {
      searches: history.searches.slice(-MAX_HISTORY_ITEMS),
      viewedGames: history.viewedGames.slice(-MAX_HISTORY_ITEMS),
      downloadedGames: history.downloadedGames.slice(-MAX_HISTORY_ITEMS),
      lastUpdated: Date.now(),
    }

    const encoded = encodeURIComponent(JSON.stringify(limitedHistory))
    const expiryDate = new Date()
    expiryDate.setDate(expiryDate.getDate() + COOKIE_EXPIRY_DAYS)

    document.cookie = `${HISTORY_COOKIE_NAME}=${encoded}; expires=${expiryDate.toUTCString()}; path=/; SameSite=Lax`
  } catch (error) {
    console.error("[UC] Error saving user history:", error)
  }
}

export function addSearchToHistory(searchTerm: string): void {
  if (!searchTerm.trim()) return

  const history = getUserHistory()
  const normalizedTerm = searchTerm.trim().toLowerCase()

  const filtered = history.searches.filter((term) => term.toLowerCase() !== normalizedTerm)
  filtered.push(searchTerm.trim())

  history.searches = filtered
  saveUserHistory(history)
}

export function addViewedGameToHistory(appid: string): void {
  if (!appid) return

  const history = getUserHistory()

  const filtered = history.viewedGames.filter((id) => id !== appid)
  filtered.push(appid)

  history.viewedGames = filtered
  saveUserHistory(history)
}

export function addDownloadedGameToHistory(appid: string): void {
  if (!appid) return

  const history = getUserHistory()

  const filtered = history.downloadedGames.filter((id) => id !== appid)
  filtered.push(appid)

  history.downloadedGames = filtered
  saveUserHistory(history)
}

export function getRecentSearches(limit: number = 10): string[] {
  const history = getUserHistory()
  return history.searches.slice(-limit).reverse()
}

export function getRecentlyViewedGames(limit: number = 20): string[] {
  const history = getUserHistory()
  return history.viewedGames.slice(-limit).reverse()
}

export function getRecentlyDownloadedGames(limit: number = 20): string[] {
  const history = getUserHistory()
  return history.downloadedGames.slice(-limit).reverse()
}

export function hasCookieConsent(): boolean {
  if (typeof window === "undefined") return true

  const consent = localStorage.getItem("cookie-consent")
  if (consent === "accepted") return true
  if (consent === "declined") return false

  localStorage.setItem("cookie-consent", "accepted")
  return true
}

export function clearUserHistory(): void {
  if (typeof window === "undefined") return

  document.cookie = `${HISTORY_COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`
  localStorage.removeItem("cookie-consent")
}

function getDefaultHistory(): UserHistory {
  return {
    searches: [],
    viewedGames: [],
    downloadedGames: [],
    lastUpdated: Date.now(),
  }
}
