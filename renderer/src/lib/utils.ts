import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { apiUrl, getApiBaseUrl } from "@/lib/api"

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

export function hasOnlineMode(hasCoOp?: boolean): boolean {
  return Boolean(hasCoOp)
}

function normalizeHostname(raw: string): string {
  return raw.toLowerCase().replace(/^www\./, "")
}

function isUcFilesHostname(host: string): boolean {
  const normalized = normalizeHostname(host)
  if (normalized === "ucfiles" || normalized === "uc.files" || normalized === "files.union-crax.xyz") {
    return true
  }
  if (normalized === "cdn.union-crax.xyz") return true
  return normalized.startsWith("files") && normalized.endsWith(".union-crax.xyz")
}

function isUcFilesAppUrl(host: string): boolean {
  const normalized = normalizeHostname(host)
  if (normalized === "ucfiles" || normalized === "uc.files" || normalized === "files.union-crax.xyz") {
    return true
  }
  return normalized.startsWith("files") && normalized.endsWith(".union-crax.xyz")
}

function isUcFilesUrl(url: string): boolean {
  try {
    const parsed = new URL(url.includes("://") ? url : `https://${url}`)
    return isUcFilesHostname(parsed.hostname)
  } catch {
    return false
  }
}

function normalizeRemoteMediaUrl(url: string): string {
  const trimmed = String(url || "").trim()
  if (!trimmed) return trimmed
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith("//")) return `https:${trimmed}`
  if (isUcFilesUrl(trimmed)) return `https://${trimmed.replace(/^https?:\/\//i, "")}`
  return trimmed
}

const PUBLIC_IMAGE_HOST_SUFFIXES = [
  "cdn.union-crax.xyz",
  "images.igdb.com",
  "steamgriddb.com",
  "cdn.steamgriddb.com",
  "akamai.steamstatic.com",
  "cloudflare.steamstatic.com",
  "steamcdn-a.akamaihd.net",
  "steamstatic.com",
  "steampowered.com",
  "discordapp.com",
  "discordapp.net",
  "discord.com",
  "googleusercontent.com",
  "githubusercontent.com",
  "scdn.co",
]

function isPublicImageHost(host: string): boolean {
  const normalized = normalizeHostname(host)
  return PUBLIC_IMAGE_HOST_SUFFIXES.some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`),
  )
}

const RENDERER_DIST_PREFIXES = ["/assets/", "/fallbacks/", "/icons/", "/images/", "/fonts/", "/static/"]

const UC_ASSET_BASE =
  typeof navigator !== "undefined" && navigator.userAgent.includes("Windows")
    ? "http://uc-asset.localhost"
    : "uc-asset://localhost"

function toUcLocalUrl(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, "/")
  return `${UC_ASSET_BASE}/img?p=${encodeURIComponent(normalized)}`
}

export function proxyMediaUrl(mediaUrl: string): string {
  if (!mediaUrl) return mediaUrl

  if (
    mediaUrl.startsWith("data:") ||
    mediaUrl.startsWith("blob:") ||
    mediaUrl.startsWith("uc-local://") ||
    mediaUrl.startsWith(`${UC_ASSET_BASE}/`)
  ) {
    return mediaUrl
  }
  if (mediaUrl.startsWith("uc-custom://")) {
    return `${UC_ASSET_BASE}/img?c=${encodeURIComponent(mediaUrl.slice("uc-custom://".length))}`
  }
  if (mediaUrl.startsWith("file://")) {
    try {
      const u = new URL(mediaUrl)
      let p = decodeURIComponent(u.pathname || "")
      if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1)
      return toUcLocalUrl(p)
    } catch {
      return mediaUrl
    }
  }

  if (mediaUrl.startsWith("/")) {
    if (mediaUrl.startsWith("//")) {
      return mediaUrl
    }
    const isRendererAsset = RENDERER_DIST_PREFIXES.some((prefix) => mediaUrl.startsWith(prefix))
    if (isRendererAsset) return mediaUrl
    return toUcLocalUrl(mediaUrl)
  }

  try {
    if (/^[A-Za-z]:\\/.test(mediaUrl) || mediaUrl.startsWith('\\')) {
      return toUcLocalUrl(mediaUrl)
    }
  } catch {}

  const normalizedRemoteUrl = normalizeRemoteMediaUrl(mediaUrl)
  if (normalizedRemoteUrl.startsWith("http://") || normalizedRemoteUrl.startsWith("https://")) {
    try {
      const parsed = new URL(normalizedRemoteUrl)
      if (!parsed.hostname || parsed.hostname === "undefined" || parsed.hostname === "null") {
        return ""
      }
      if (isUcFilesAppUrl(parsed.hostname)) {
        return apiUrl(`/api/ucfiles/media?url=${encodeURIComponent(normalizedRemoteUrl)}&raw=1`)
      }
      if (isPublicImageHost(parsed.hostname)) {
        return apiUrl(`/api/image-proxy?url=${encodeURIComponent(normalizedRemoteUrl)}&raw=1`)
      }
    } catch {}
    return normalizedRemoteUrl
  }

  return mediaUrl
}

export function proxyImageUrl(imageUrl: string): string {
  const u = proxyMediaUrl(imageUrl)
  if (u.startsWith(`${UC_ASSET_BASE}/`)) return u
  if (u.startsWith("http://") || u.startsWith("https://")) {
    return `${UC_ASSET_BASE}/img?u=${encodeURIComponent(u)}`
  }
  return u
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
    'patch',
    'notification',
    'easyanticheat',
    'battleye',
    'cefhelper',
    'webengine',
  ].some((token) => lower.includes(token))
}

export function filterGameExecutables(exes: GameExecutable[]) {
  const junkPatterns = [
    /^vc_?redist/i, /^dxsetup/i, /^dxwebsetup/i, /^dotnet/i,
    /^unins\d{3}/i, /^uninstall/i,
    /^crashreport/i, /^bugreport/i, /^senddump/i,
    /^ue4prereqsetup/i, /^UE4-preq/i,
    /^(?:directx|oalinst|physx)/i,
    /^UnityCrashHandler/i, /^UnityBugReporter/i,
    /^notification_helper/i, /^nacl_helper/i,
    /^(?:7z|winrar|WinRAR)\.exe$/i,
    /^(?:CEF|cef)Helper/i,
    /^(?:QtWeb|QtWebEngine)Process/i,
    /^(?:CrashReportClient|CrashSender)/i,
    /^(?:EasyAntiCheat_EOS|EasyAntiCheat_Setup|EasyAntiCheatSetup)/i,
    /^BEService/i, /^BELauncher/i,
    /^(?:ffmpeg|ffprobe)\.exe$/i,
    /^python\d*\.exe$/i,
    /^(?:steam_api|steamclient)/i,
  ]

  return exes.filter((exe) => {
    const lower = exe.name.toLowerCase()
    if (junkPatterns.some((p) => p.test(lower))) return false
    const pathLower = (exe.path || "").toLowerCase()
    if (/[\\/](?:_?redist|__support|_commonredist|directx|vcredist|__installer|bundledtools|easyanticheat)[\\/]/i.test(pathLower)) return false
    return true
  })
}

export function getUnambiguousExecutable(exes: GameExecutable[]): GameExecutable | null {
  const seen = new Set<string>()
  const unique: GameExecutable[] = []
  for (const exe of exes) {
    const key = (exe.path || "").toLowerCase().replace(/\//g, "\\")
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(exe)
  }
  const candidates = filterGameExecutables(unique)
  return candidates.length === 1 ? candidates[0] : null
}

export function slugify(value: string): string {
  return (value || "").toLowerCase().replace(/[^a-z0-9]+/g, "")
}

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

export function matchAdminExecutable(
  exes: GameExecutable[],
  adminRelPath: string | null | undefined,
  baseFolder?: string | null,
): GameExecutable | null {
  if (!adminRelPath || typeof adminRelPath !== "string") return null
  const wanted = adminRelPath.trim().toLowerCase().replace(/^[\\/]+/, "").replace(/\//g, "\\")
  if (!wanted) return null
  const wantedBase = wanted.split("\\").pop() || wanted

  const relOf = (exe: GameExecutable) =>
    getExecutableRelativePath(exe.path, baseFolder).toLowerCase().replace(/\//g, "\\")

  const exact = exes.find((exe) => relOf(exe) === wanted)
  if (exact) return exact

  const byName = exes.filter((exe) => exe.name.toLowerCase() === wantedBase)
  if (byName.length === 1) return byName[0]
  const suffix = byName.find((exe) => relOf(exe).endsWith(wanted))
  if (suffix) return suffix
  return byName[0] ?? null
}

function scoreGameExecutable(exe: GameExecutable, gameName: string, baseFolder?: string | null) {
  const nameLower = exe.name.toLowerCase()
  const pathLower = exe.path.toLowerCase()
  const gameToken = slugify(gameName)
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



export function getInstalledVersionLabel(manifest: any): string | null {
  const label = manifest?.metadata?.downloadedVersion || manifest?.metadata?.version || manifest?.version
  if (!label) return null
  const normalized = String(label).trim()
  return normalized || null
}

export function hasInstalledVersionUpdate(
  catalogVersion?: string | null,
  installedVersions: Array<string | null | undefined> = []
): boolean {
  const normalizedCatalog = String(catalogVersion || "").trim().toLowerCase()
  if (!normalizedCatalog) return false

  const normalizedInstalled = Array.from(
    new Set(
      installedVersions
        .map((label) => String(label || "").trim().toLowerCase())
        .filter(Boolean)
    )
  )

  return normalizedInstalled.length > 0 && !normalizedInstalled.includes(normalizedCatalog)
}



