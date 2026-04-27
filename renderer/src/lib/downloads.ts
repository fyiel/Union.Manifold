import { apiFetch } from "@/lib/api"
import { downloadLogger } from "@/lib/logger"

export type DownloadHostEntry = { url: string; part: number | null }
export type DownloadHosts = Record<string, DownloadHostEntry[]>

export type DownloadLinksResult = {
  hosts: DownloadHosts
  redirectUrl?: string
}

export type PreferredDownloadHost = "ucfiles" | "pixeldrain"

export type ResolvedDownload = {
  url: string
  filename?: string
  size?: number
  resolved: boolean
  authHeader?: string
}

// ── Link availability check types ──

export type PartStatus = {
  part: number
  status: "alive" | "dead" | "error"
}

export type HostAvailability = {
  parts: PartStatus[]
  allAlive: boolean
  totalParts: number
  aliveParts: number
}

export type AlternativeInfo = {
  deadOn: string[]
  aliveOn: string[]
}

export type AvailabilityResult = {
  appid: string
  hosts: Record<string, HostAvailability>
  alternatives: Record<string, AlternativeInfo>
  gameAvailable: boolean
  fullyDeadParts: number[]
  webOnlyHosts?: Record<string, { totalParts: number; aliveParts: number }>
}

export type DownloadConfig = {
  host: PreferredDownloadHost
  partOverrides?: Record<number, { host: string; url: string }>
}

const DOWNLOAD_HOST_STORAGE_KEY = "uc_direct_download_host"
export const SUPPORTED_DOWNLOAD_HOSTS: PreferredDownloadHost[] = ["ucfiles", "pixeldrain"]
const PREFERRED_HOSTS: PreferredDownloadHost[] = ["ucfiles", "pixeldrain"]
const PIXELDRAIN_404_MESSAGE = "Pixeldrain returned 404. The link appears to be dead."
const UCFILES_404_MESSAGE = "UC.Files returned 404. The link appears to be dead."

function normalizeUCFilesHostValue(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split(",")[0]
    .trim()
}

function isUCFilesHostValue(value: string): boolean {
  const normalized = normalizeUCFilesHostValue(value)
  if (!normalized) return false
  if (normalized === "ucfiles" || normalized === "uc.files" || normalized === "uc files" || normalized === "uc-files") {
    return true
  }
  if (normalized === "files.union-crax.xyz") {
    return true
  }
  return normalized.startsWith("files") && normalized.endsWith(".union-crax.xyz")
}

/**
 * Normalise host entries from API - handles both legacy string[] and new {url,part}[] shapes.
 */
function sanitizeHosts(input: Record<string, any[]> | null | undefined): DownloadHosts {
  const hosts = input && typeof input === "object" ? input : {}
  const cleaned: DownloadHosts = {}
  for (const [key, value] of Object.entries(hosts)) {
    if (!Array.isArray(value)) { cleaned[key] = []; continue }
    cleaned[key] = value.map((entry, i) => {
      if (typeof entry === "string") return { url: entry, part: null }
      if (entry && typeof entry === "object" && typeof entry.url === "string")
        return { url: entry.url, part: typeof entry.part === "number" ? entry.part : null }
      return { url: String(entry), part: null }
    })
  }
  return cleaned
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value
  }
  return undefined
}

function toNumber(value: unknown): number | undefined {
  const numberValue = typeof value === "number" ? value : Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

export async function requestDownloadToken(appid: string) {
  const response = await apiFetch(`/api/downloads/${encodeURIComponent(appid)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-UC-Client": "unioncrax-direct",
    },
    body: JSON.stringify({}),
  })

  if (!response.ok) {
    let errorMsg = `Failed to start download: ${response.status}`
    try {
      const data = await response.json()
      if (data && data.error) errorMsg = data.error
    } catch {}
    throw new Error(errorMsg)
  }

  const data = await response.json()
  if (!data?.success || !data?.downloadToken) {
    throw new Error("Download token missing from response")
  }
  return data.downloadToken as string
}

export async function checkAvailability(
  appid: string,
  downloadToken: string
): Promise<AvailabilityResult> {
  const body: Record<string, string> = { appid, downloadToken }

  const response = await apiFetch("/api/downloads/check-availability", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-UC-Client": "unioncrax-direct",
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => null)
    throw new Error(err?.error || `Availability check failed: ${response.status}`)
  }

  return response.json()
}

export async function fetchDownloadLinks(appid: string, downloadToken: string): Promise<DownloadLinksResult> {
  const response = await apiFetch(
    `/api/downloads/${encodeURIComponent(appid)}?fetchLinks=true&downloadToken=${encodeURIComponent(downloadToken)}`,
    {
    redirect: "manual",
    headers: {
      "X-UC-Client": "unioncrax-direct",
    },
    }
  )
  const contentType = response.headers.get("content-type") || ""

  if (!response.ok && contentType.includes("application/json")) {
    const errorPayload = await response.json().catch(() => null)
    if (errorPayload?.error) {
      throw new Error(errorPayload.error)
    }
  }

  if (response.status >= 300 && response.status < 400) {
    const redirectUrl = response.headers.get("Location") || response.headers.get("location") || response.url
    return { hosts: {}, redirectUrl: redirectUrl || undefined }
  }

  if (contentType.includes("application/json")) {
    const data = await response.json()
    const hosts = sanitizeHosts(data?.hosts || {})
    return { hosts }
  }

  return { hosts: {}, redirectUrl: response.url }
}

function pickHostLinks(available: DownloadHosts, host: PreferredDownloadHost) {
  if (host === "ucfiles") {
    return Object.entries(available)
      .filter(([key]) => isUCFilesHostValue(key))
      .flatMap(([, entries]) => entries)
  }
  if (host === "pixeldrain") {
    return available.pixeldrain || available["pixeldrain.com"] || available["Pixeldrain"]  || []
  }
  if (host === "vikingfile") {
    return available.vikingfile || available["vikingfile.com"] || available["VikingFile"] ||  []
  }
  return []
}

export async function getPreferredDownloadHost(): Promise<PreferredDownloadHost> {
  if (typeof window === "undefined") return "ucfiles"
  
  // Try to get from electron settings first (synchronized with Settings UI)
  if (window.ucSettings?.get) {
    try {
      const stored = await window.ucSettings.get('defaultMirrorHost')
      if (stored && PREFERRED_HOSTS.includes(stored as PreferredDownloadHost)) {
        return stored as PreferredDownloadHost
      }
    } catch (err) {
      downloadLogger.warn('Failed to get defaultMirrorHost from settings', { data: err })
    }
  }
  
  // Fallback to localStorage for backwards compatibility
  const legacy = localStorage.getItem(DOWNLOAD_HOST_STORAGE_KEY)
  if (legacy && PREFERRED_HOSTS.includes(legacy as PreferredDownloadHost)) {
    return legacy as PreferredDownloadHost
  }
  
  return "ucfiles"
}

export function setPreferredDownloadHost(host: PreferredDownloadHost) {
  if (typeof window === "undefined") return
  if (!PREFERRED_HOSTS.includes(host)) return
  
  // Save to electron settings (synchronized with Settings UI)
  if (window.ucSettings?.set) {
    window.ucSettings.set('defaultMirrorHost', host).catch((err: any) => {
      downloadLogger.warn('Failed to set defaultMirrorHost', { data: err })
    })
  }
  
  // Also keep localStorage for backwards compatibility
  localStorage.setItem(DOWNLOAD_HOST_STORAGE_KEY, host)
}

export function selectHost(available: DownloadHosts, preferredHost?: PreferredDownloadHost): { host: string; links: DownloadHostEntry[] } {
  const preferred = preferredHost && PREFERRED_HOSTS.includes(preferredHost) ? preferredHost : "ucfiles"
  if (SUPPORTED_DOWNLOAD_HOSTS.includes(preferred)) {
    const preferredLinks = pickHostLinks(available, preferred)
    if (preferredLinks.length) {
      return { host: preferred, links: preferredLinks }
    }
  }
  // Pixeldrain fallback: if pixeldrain has no links, try UC.Files
  if (preferred === "pixeldrain") {
    const ucLinks = pickHostLinks(available, "ucfiles")
    if (ucLinks.length) return { host: "ucfiles", links: ucLinks }
  }
  return { host: "", links: [] }
}

export function inferFilenameFromUrl(url: string, fallback: string) {
  try {
    const parsed = new URL(url)
    const name = parsed.pathname.split("/").pop() || ""
    const clean = decodeURIComponent(name)
    return clean || fallback
  } catch {
    return fallback
  }
}

// ── UC.Files download resolution ──

export function extractUCFilesFileId(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (!isUCFilesHostValue(parsed.hostname)) return null
    const fMatch = parsed.pathname.match(/\/(?:f|file|download)\/([A-Za-z0-9_-]{1,64})(?:[/?#]|$)/)
    if (fMatch?.[1]) return fMatch[1]
    // Matches /dl/{token} - already a direct download URL, no fileId to extract
    const dlMatch = parsed.pathname.match(/\/dl\/([A-Za-z0-9_-]{1,64})(?:[/?#]|$)/)
    if (dlMatch?.[1]) return null // token, not a file ID
    return null
  } catch {
    return null
  }
}

export function isUCFilesUrl(url: string): boolean {
  try {
    return isUCFilesHostValue(new URL(url).hostname)
  } catch {
    return false
  }
}

/**
 * Returns true if the UC.Files URL is already a signed /dl/ token URL
 * (i.e. it was already resolved and doesn't need re-resolution).
 */
function isUCFilesDlTokenUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return isUCFilesHostValue(parsed.hostname) && /^\/dl\//.test(parsed.pathname)
  } catch {
    return false
  }
}

function isUCFilesShareDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return isUCFilesHostValue(parsed.hostname) && /^\/download\/[^/?#]+/.test(parsed.pathname)
  } catch {
    return false
  }
}

export async function resolveUCFilesDownload(url: string): Promise<ResolvedDownload> {
  if (!url) return { url, resolved: false }

  // If the URL is already a signed /dl/ token, it's already resolved - pass it through
  if (isUCFilesDlTokenUrl(url)) {
    return {
      url,
      filename: inferFilenameFromUrl(url, ""),
      resolved: true,
    }
  }

  const fileId = extractUCFilesFileId(url)
  const shareDownloadUrl = isUCFilesShareDownloadUrl(url) ? url : null
  if (!fileId && !shareDownloadUrl) return { url, resolved: false }

  try {
    const response = await apiFetch("/api/ucfiles/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fileId ? { fileId } : { downloadUrl: shareDownloadUrl }),
    })

    if (response.status === 404) {
      throw new Error(UCFILES_404_MESSAGE)
    }

    const data = await response.json().catch(() => null)
    if (!response.ok || !data?.success || !data?.data?.url) {
      downloadLogger.warn("UC.Files resolve failed", { data: { status: response.status, body: data } })
      return { url, resolved: false }
    }

    const result = data.data as Record<string, any>
    return {
      url: result.url,
      filename: firstString(result.filename),
      size: toNumber(result.size),
      resolved: true,
    }
  } catch (err) {
    if (err instanceof Error && err.message === UCFILES_404_MESSAGE) throw err
    downloadLogger.warn("UC.Files resolve error", { data: err })
    return { url, resolved: false }
  }
}

// Pixeldrain URL detection and resolution

/**
 * Checks if a URL is a Pixeldrain URL (user-facing format)
 */
export function isPixeldrainUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.hostname.includes("pixeldrain.com") || parsed.hostname.includes("pixeldrain")
  } catch {
    return false
  }
}

/**
 * Extracts the file ID from a Pixeldrain URL.
 * Supports formats:
 * - https://pixeldrain.com/u/{file_id}
 * - https://pixeldrain.com/file/{file_id}
 * - https://pixeldrain.com/api/file/{file_id}
 */
function extractPixeldrainFileId(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (!parsed.hostname.includes("pixeldrain")) return null
    
    // Match /u/{file_id} or /file/{file_id} or /api/file/{file_id}
    const pathMatch = parsed.pathname.match(/\/(?:u|file|api\/file)\/([a-zA-Z0-9_-]+)/)
    if (pathMatch?.[1]) return pathMatch[1]
    return null
  } catch {
    return null
  }
}

/**
 * Resolves a Pixeldrain URL to the API download format.
 * User-facing URLs need to be converted to API format for actual file download.
 */
async function resolvePixeldrainDownload(url: string): Promise<ResolvedDownload> {
  if (!url) return { url, resolved: false }
  
  // If URL is already in API format with ?download, pass it through
  try {
    const parsed = new URL(url)
    if (parsed.pathname.startsWith("/api/file/") && parsed.searchParams.has("download")) {
      return {
        url,
        filename: inferFilenameFromUrl(url, ""),
        resolved: true,
      }
    }
  } catch {
    // Invalid URL, will be handled below
  }
  
  const fileId = extractPixeldrainFileId(url)
  if (!fileId) {
    // Not a recognizable pixeldrain URL format
    return { url, resolved: false }
  }
  
  // Convert to API download URL
  const apiUrl = `https://pixeldrain.com/api/file/${fileId}?download`
  
  // Try to get file info to extract filename and size
  try {
    const infoResponse = await fetch(`https://pixeldrain.com/api/file/${fileId}/info`, {
      headers: {
        "X-UC-Client": "unioncrax-direct",
      },
    })
    
    if (infoResponse.ok) {
      const info = await infoResponse.json()
      if (info?.success && info?.name) {
        return {
          url: apiUrl,
          filename: info.name,
          size: info.size,
          resolved: true,
        }
      }
    }
  } catch {
    // Best effort - just return the converted URL
  }
  
  return {
    url: apiUrl,
    filename: inferFilenameFromUrl(url, ""),
    resolved: true,
  }
}

// Aliases for backwards compatibility

export async function resolveDownloadUrl(host: string, url: string): Promise<ResolvedDownload> {
  // Defensive guard for legacy persisted state where "url" may be an object
  const normalizedUrl =
    typeof url === "string"
      ? url
      : url && typeof (url as any).url === "string"
        ? String((url as any).url)
        : String(url ?? "")

  if (host === "ucfiles" || isUCFilesUrl(normalizedUrl)) {
    return resolveUCFilesDownload(normalizedUrl)
  }
  if (host === "pixeldrain" || isPixeldrainUrl(normalizedUrl)) {
    // Pixeldrain URLs need to be resolved from user-facing format to API download format
    return resolvePixeldrainDownload(normalizedUrl)
  }
  return { url: normalizedUrl, resolved: false }
}

export async function resolveDownloadSize(url: string): Promise<number | undefined> {
  try {
    const resolved = await resolveDownloadUrl("", url)
    return resolved.size
  } catch {
    return undefined
  }
}

