import { apiFetch, apiUrl } from "@/lib/api"
import { downloadLogger } from "@/lib/logger"

export type DownloadHostEntry = { url: string; part: number | null }
export type DownloadHosts = Record<string, DownloadHostEntry[]>

export type DownloadLinksResult = {
  hosts: DownloadHosts
  redirectUrl?: string
}

export type PreferredDownloadHost = "ucfiles" | "vikingfile"

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
const ROOTZ_SIGNED_HOST = "signed-url.cloudflare.com"
export const SUPPORTED_DOWNLOAD_HOSTS: PreferredDownloadHost[] = ["ucfiles", "vikingfile"]
const PREFERRED_HOSTS: PreferredDownloadHost[] = ["ucfiles", "vikingfile"]
const PIXELDRAIN_404_MESSAGE = "Pixeldrain returned 404. The link appears to be dead."
const ROOTZ_404_MESSAGE = "Rootz returned 404. The link appears to be dead."
const FILEQ_404_MESSAGE = "FileQ returned 404. The link appears to be dead."
const UCFILES_404_MESSAGE = "UC.Files returned 404. The link appears to be dead."

/**
 * Normalise host entries from API — handles both legacy string[] and new {url,part}[] shapes.
 */
function sanitizeHosts(input: Record<string, any[]> | null | undefined): DownloadHosts {
  const hosts = input && typeof input === "object" ? input : {}
  const cleaned: DownloadHosts = {}
  for (const [key, value] of Object.entries(hosts)) {
    const lower = key.toLowerCase()
    if (lower.includes("vikingfile")) continue
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

function pickRootzPayload(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, any>
  return (record.data as Record<string, any>) || (record.file as Record<string, any>) || record
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

function normalizeRootzPayload(payload: Record<string, any> | null) {
  if (!payload) return null
  return {
    url: firstString(payload.url, payload.downloadUrl, payload.signedUrl),
    fileName: firstString(payload.fileName, payload.filename, payload.name),
    size: toNumber(payload.size),
    id: firstString(payload.id, payload.fileId),
  }
}

async function fetchRootzPayload(path: string, opts?: { shortId?: string; fileId?: string }) {
  // Ask the UnionCrax backend to resolve Rootz URLs server-side.
  let response: Response
  try {
    response = await apiFetch("/api/rootz/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path,
        shortId: opts?.shortId || null,
        fileId: opts?.fileId || null,
      }),
    })
  } catch {
    return null
  }

  if (response.status === 404) {
    throw new Error(ROOTZ_404_MESSAGE)
  }

  try {
    const data = await response.json().catch(() => null)
    if (!response.ok || !data?.success) return null
    return pickRootzPayload(data.data)
  } catch (err) {
    if (err instanceof Error && err.message === ROOTZ_404_MESSAGE) throw err
    return null
  }
}

async function fetchRootzDownload(fileId: string) {
  if (!fileId) return null
  const payload = await fetchRootzPayload(`/files/download/${encodeURIComponent(fileId)}`, { fileId })
  return normalizeRootzPayload(payload)
}

async function fetchRootzByShortId(shortId: string) {
  if (!shortId) return null
  const payload = await fetchRootzPayload(`/files/short/${encodeURIComponent(shortId)}`, { shortId })
  return normalizeRootzPayload(payload)
}

function extractRootzShortId(url: string): string | null {
  try {
    const parsed = new URL(url)
    const directMatch = parsed.pathname.match(/\/d\/([^/?#]+)/)
    if (directMatch?.[1]) return directMatch[1]
    const queryId = parsed.searchParams.get("shortId") || parsed.searchParams.get("shortid")
    if (queryId) return queryId
  } catch {}
  return null
}

function isRootzSignedUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.hostname.includes(ROOTZ_SIGNED_HOST)
  } catch {
    return false
  }
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
  const url = apiUrl(
    `/api/downloads/${encodeURIComponent(appid)}?fetchLinks=true&downloadToken=${encodeURIComponent(downloadToken)}`
  )
  const response = await fetch(url, {
    redirect: "manual",
    headers: {
      "X-UC-Client": "unioncrax-direct",
    },
  })
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
    return available.ucfiles || available["files.union-crax.xyz"] || available["UC.Files"] || []
  }
  if (host === "vikingfile") {
    return available.vikingfile || available["vikingfile.com"] || available["VikingFile"] || []
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
    if (!parsed.hostname.includes("files.union-crax.xyz")) return null
    // Matches /f/{fileId} (16-char nanoid landing page)
    const fMatch = parsed.pathname.match(/\/f\/([A-Za-z0-9_-]{1,64})/)
    if (fMatch?.[1]) return fMatch[1]
    // Matches /dl/{token} — already a direct download URL, no fileId to extract
    const dlMatch = parsed.pathname.match(/\/dl\/([A-Za-z0-9_-]{1,64})/)
    if (dlMatch?.[1]) return null // token, not a file ID
    return null
  } catch {
    return null
  }
}

export function isUCFilesUrl(url: string): boolean {
  try {
    return new URL(url).hostname.includes("files.union-crax.xyz")
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
    return parsed.hostname.includes("files.union-crax.xyz") && /^\/dl\//.test(parsed.pathname)
  } catch {
    return false
  }
}

export async function resolveUCFilesDownload(url: string): Promise<ResolvedDownload> {
  if (!url) return { url, resolved: false }

  // If the URL is already a signed /dl/ token, it's already resolved — pass it through
  if (isUCFilesDlTokenUrl(url)) {
    return {
      url,
      filename: inferFilenameFromUrl(url, ""),
      resolved: true,
    }
  }

  const fileId = extractUCFilesFileId(url)
  if (!fileId) return { url, resolved: false }

  try {
    const response = await apiFetch("/api/ucfiles/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId }),
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

// ── Vikingfile download resolution ──

export function isVikingFileUrl(url: string): boolean {
  try {
    return new URL(url).hostname.includes("vikingfile.com")
  } catch {
    return false
  }
}

// Aliases for backwards compatibility
export const isPixeldrainUrl = isUCFilesUrl
export const isRootzUrl = isVikingFileUrl

export async function resolveDownloadUrl(host: string, url: string): Promise<ResolvedDownload> {
  if (host === "ucfiles" || isUCFilesUrl(url)) {
    return resolveUCFilesDownload(url)
  }
  if (host === "vikingfile" || isVikingFileUrl(url)) {
    return resolveVikingFileDownload(url)
  }
  return { url, resolved: false }
}

export async function resolveDownloadSize(url: string): Promise<number | undefined> {
  try {
    const resolved = await resolveDownloadUrl("", url)
    return resolved.size
  } catch {
    return undefined
  }
}

function extractVikingFileId(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (!parsed.hostname.includes("vikingfile.com")) return null
    const fMatch = parsed.pathname.match(/\/file\/([A-Za-z0-9_-]{1,64})/)
    if (fMatch?.[1]) return fMatch[1]
    const dlMatch = parsed.pathname.match(/\/dl\/([A-Za-z0-9_-]{1,64})/)
    if (dlMatch?.[1]) return null // token, not a file ID
    return null
  } catch {
    return null
  }
}

export function isVikingFileDirectUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.hostname.includes("vikingfile.com")
  } catch {
    return false
  }
}

function isVikingFileDlTokenUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.hostname.includes("vikingfile.com") && /^\/dl\//.test(parsed.pathname)
  } catch {
    return false
  }
}

export async function resolveVikingFileDownload(url: string): Promise<ResolvedDownload> {
  if (!url) return { url, resolved: false }

  // If the URL is already a signed /dl/ token, it's already resolved — pass it through
  if (isVikingFileDlTokenUrl(url)) {
    return {
      url,
      filename: inferFilenameFromUrl(url, ""),
      resolved: true,
    }
  }

  const fileId = extractVikingFileId(url)
  if (!fileId) return { url, resolved: false }

  try {
    const response = await apiFetch("/api/vikingfile/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId }),
    })

    if (response.status === 404) {
      throw new Error("VikingFile returned 404. The link appears to be dead.")
    }

    const data = await response.json().catch(() => null)
    if (!response.ok || !data?.success || !data?.data?.url) {
      downloadLogger.warn("VikingFile resolve failed", { data: { status: response.status, body: data } })
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
    if (err instanceof Error && err.message.includes("404")) throw err
    downloadLogger.warn("VikingFile resolve error", { data: err })
    return { url, resolved: false }
  }
}