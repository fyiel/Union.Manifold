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
    if (/^[A-Za-z]:\\/.test(imageUrl) || imageUrl.startsWith('\\')) {
      // normalize backslashes to forward slashes and ensure proper file:// prefix
      const normalized = imageUrl.replace(/\\/g, '/')
      return `file:///${encodeURI(normalized)}`
    }
  } catch {}

  try {
    const encodedUrl = encodeURIComponent(imageUrl)
    return apiUrl(`/api/images/${encodedUrl}`)
  } catch (error) {
    // Error encoding image URL - silently fail
    return imageUrl
    return imageUrl
  }
}

export type GameExecutable = { name: string; path: string; size?: number; depth?: number }

export function isHelperExecutableName(name: string) {
  const lower = name.toLowerCase()
  return [
    'crash',
    'report',
    'dump',
    'helper',
    'uninstall',
    'setup',
    'install',
    'redist',
    'updater',
    'patch'
  ].some((token) => lower.includes(token))
}

export function filterGameExecutables(exes: GameExecutable[]) {
  return exes
}

const normalizeToken = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "")

export function getExecutableRelativePath(fullPath: string, baseFolder?: string | null) {
  if (!baseFolder) return fullPath
  const normalizedBase = baseFolder.replace(/[\\/]+$/, "")
  if (!normalizedBase) return fullPath
  const lowerFull = fullPath.toLowerCase()
  const lowerBase = normalizedBase.toLowerCase()
  if (lowerFull.startsWith(lowerBase)) {
    const trimmed = fullPath.slice(normalizedBase.length).replace(/^[\\/]+/, "")
    return trimmed || fullPath
  }
  return fullPath
}

export function scoreGameExecutable(exe: GameExecutable, gameName: string, baseFolder?: string | null) {
  const nameLower = exe.name.toLowerCase()
  const pathLower = exe.path.toLowerCase()
  const gameToken = normalizeToken(gameName)
  const tokens = gameName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3)

  let score = 0
  const tags: string[] = []

  if (gameToken && (nameLower.includes(gameToken) || pathLower.includes(gameToken))) {
    score += 6
    tags.push("name match")
  }
  if (tokens.some((t) => nameLower.includes(t) || pathLower.includes(t))) {
    score += 3
  }
  if (nameLower.includes("game") || nameLower.includes("play")) {
    score += 2
  }
  if (nameLower.includes("launcher") || nameLower.includes("start")) {
    score -= 1
  }
  if (nameLower.includes("setup") || nameLower.includes("install") || nameLower.includes("uninstall") || nameLower.includes("redist")) {
    score -= 6
    tags.push("installer")
  }
  if (nameLower.includes("crash") || nameLower.includes("report") || nameLower.includes("dump") || nameLower.includes("helper")) {
    score -= 6
    tags.push("helper")
  }
  if (nameLower.includes("editor")) {
    score -= 4
    tags.push("editor")
  }

  if (typeof exe.depth === "number") {
    score += Math.max(0, 4 - exe.depth)
  } else if (baseFolder) {
    const relative = getExecutableRelativePath(exe.path, baseFolder)
    const depth = relative.split(/[\\/]/).length - 1
    score += Math.max(0, 4 - depth)
  }

  if (typeof exe.size === "number" && exe.size > 0) {
    if (exe.size >= 50 * 1024 * 1024) score += 2
    else if (exe.size >= 10 * 1024 * 1024) score += 1
  }

  const helper = isHelperExecutableName(exe.name)
  if (helper) score -= 2

  return { score, tags, ignored: false }
}

export function rankGameExecutables(exes: GameExecutable[], gameName: string, baseFolder?: string | null) {
  return [...exes]
    .map((exe) => {
      const scored = scoreGameExecutable(exe, gameName, baseFolder)
      return { ...exe, ...scored }
    })
    .sort((a, b) => {
      if (a.ignored !== b.ignored) return a.ignored ? 1 : -1
      if (a.score !== b.score) return b.score - a.score
      const depthA = typeof a.depth === "number" ? a.depth : 0
      const depthB = typeof b.depth === "number" ? b.depth : 0
      if (depthA !== depthB) return depthA - depthB
      return a.name.localeCompare(b.name)
    })
}

export function pickGameExecutable(exes: GameExecutable[], gameName: string, gameSource?: string, baseFolder?: string | null) {
  const candidates = filterGameExecutables(exes)
  if (!candidates.length) return { pick: null, confident: false }

  // If there's only 1 exe, assume it's the correct one
  if (candidates.length === 1) {
    return { pick: candidates[0], confident: true }
  }

  // Check if source contains uc-online or similar patterns
  const isUcOnlineSource = gameSource?.toLowerCase().includes("uc-online") ||
                           gameSource?.toLowerCase().includes("uconline") ||
                           gameSource?.toLowerCase().includes("uc online")

  if (isUcOnlineSource) {
    const ucOnlineExe = candidates.find((exe) => {
      const lower = exe.name.toLowerCase()
      return lower === "uc-online.exe" || lower === "uc-online64.exe"
    })
    if (ucOnlineExe) {
      return { pick: ucOnlineExe, confident: true }
    }
  }

  const ranked = rankGameExecutables(candidates, gameName, baseFolder)
  const top = ranked[0]
  const topScore = top?.score ?? 0
  const confident = topScore >= 6
  return { pick: top || null, confident }
}
