import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { apiUrl } from "@/lib/api"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M"
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K"
  }
  return num.toString()
}

export function triggerHapticFeedback(intensity: "light" | "medium" | "heavy" = "medium") {
  if (typeof window !== "undefined" && "navigator" in window && "vibrate" in navigator) {
    const patterns = {
      light: 50,
      medium: 100,
      heavy: 200,
    }
    navigator.vibrate(patterns[intensity])
  }
}

export function levenshteinDistance(a: string, b: string): number {
  const matrix = Array(b.length + 1)
    .fill(null)
    .map(() => Array(a.length + 1).fill(null))

  for (let i = 0; i <= a.length; i++) matrix[0][i] = i
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j

  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + indicator
      )
    }
  }

  return matrix[b.length][a.length]
}

export function getSimilarSuggestions(
  searchTerm: string,
  candidates: string[],
  maxDistance: number = 2,
  limit: number = 3
): string[] {
  const suggestions = candidates
    .map((candidate) => ({
      term: candidate,
      distance: levenshteinDistance(searchTerm.toLowerCase(), candidate.toLowerCase()),
    }))
    .filter((item) => item.distance <= maxDistance && item.distance > 0)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map((item) => item.term)

  return suggestions
}

// Online badge is now driven by the explicit co-op flag (set via admin)
export function hasOnlineMode(hasCoOp?: boolean): boolean {
  return Boolean(hasCoOp)
}

export function generateErrorCode(errorType: string, context?: string): string {
  const timestamp = Date.now().toString().slice(-6)
  const errorPrefix = errorType.slice(0, 3).toUpperCase()
  const contextHash = context
    ? context
        .split("")
        .reduce((acc, char) => acc + char.charCodeAt(0), 0) % 1000
    : Math.floor(Math.random() * 1000)

  return `${errorPrefix}-${contextHash}-${timestamp}`
}

export const ErrorTypes = {
  GAME_FETCH: "GAME",
  SEARCH_FETCH: "SRCH",
  STATS_FETCH: "STAT",
  DOWNLOADS_FETCH: "DOWN",
  VIEWS_FETCH: "VIEW",
  RELATED_FETCH: "REL",
}

export function proxyImageUrl(imageUrl: string): string {
  if (!imageUrl) return imageUrl
  // already a relative path or data/blob URL served by the app
  if (imageUrl.startsWith("/") || imageUrl.startsWith("data:") || imageUrl.startsWith("blob:") || imageUrl.startsWith("file://")) {
    return imageUrl
  }

  // detect absolute Windows paths like C:\ or UNC paths starting with \\ and convert to file:// URL
  try {
    if (/^[A-Za-z]:\\\\/.test(imageUrl) || imageUrl.startsWith('\\\\')) {
      // normalize backslashes to forward slashes and ensure proper file:// prefix
      const normalized = imageUrl.replace(/\\\\/g, '/').replace(/\\/g, '/')
      return `file://${encodeURI(normalized)}`
    }
  } catch {}

  try {
    const encodedUrl = encodeURIComponent(imageUrl)
    return apiUrl(`/api/images/${encodedUrl}`)
  } catch (error) {
    console.error("Error encoding image URL for proxy:", error)
    return imageUrl
  }
}

type GameExecutable = { name: string; path: string }

const ignoredEngineExePatterns = [
  /^unitycrashhandler(64|32)?\.exe$/,
  /^crashreportclient\.exe$/,
  /^unrealcefsubprocess\.exe$/,
  /^ue4prereqsetup(_x64|_x86)?\.exe$/,
  /^ueprereqsetup(_x64|_x86)?\.exe$/,
  /^ue5prereqsetup(_x64|_x86)?\.exe$/,
  /^ue4editor\.exe$/,
  /^ue5editor\.exe$/,
  /^ue4game\.exe$/,
  /^ue5game\.exe$/,
]

export function isIgnoredEngineExecutableName(name: string) {
  const lower = name.toLowerCase()
  return ignoredEngineExePatterns.some((pattern) => pattern.test(lower))
}

export function filterGameExecutables(exes: GameExecutable[]) {
  return exes.filter((exe) => !isIgnoredEngineExecutableName(exe.name))
}

export function pickGameExecutable(exes: GameExecutable[], gameName: string, gameSource?: string) {
  const candidates = filterGameExecutables(exes)
  if (!candidates.length) return { pick: null, confident: false }

  // Check if source contains uc-online or similar patterns
  const isUcOnlineSource = gameSource?.toLowerCase().includes("uc-online") || 
                           gameSource?.toLowerCase().includes("uconline") ||
                           gameSource?.toLowerCase().includes("uc online")

  // If uc-online source, prioritize uc-online.exe or uc-online64.exe
  if (isUcOnlineSource) {
    const ucOnlineExe = candidates.find((exe) => {
      const lower = exe.name.toLowerCase()
      return lower === "uc-online.exe" || lower === "uc-online64.exe"
    })
    if (ucOnlineExe) {
      return { pick: ucOnlineExe, confident: true }
    }
  }

  const nameToken = gameName.toLowerCase().replace(/[^a-z0-9]+/g, "")
  const scored = candidates.map((exe) => {
    const lower = exe.name.toLowerCase()
    const pathLower = exe.path.toLowerCase()
    let score = 0
    if (nameToken && (lower.includes(nameToken) || pathLower.includes(nameToken))) score += 5
    if (lower.includes("launcher")) score += 3
    if (lower.includes("game")) score += 2
    if (lower.includes("setup") || lower.includes("uninstall")) score -= 3
    return { exe, score }
  })
  scored.sort((a, b) => b.score - a.score)

  const top = scored[0]
  const topScore = top?.score ?? 0
  const confident = topScore >= 4 || (candidates.length === 1 && topScore >= 1)
  return { pick: top ? top.exe : null, confident }
}
