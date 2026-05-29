import { apiFetch } from "@/lib/api"
import { downloadLogger } from "@/lib/logger"

export type DownloadHostEntry = { url: string; part: number | null }
export type DownloadHosts = Record<string, DownloadHostEntry[]>

export type DownloadLinksResult = {
  hosts: DownloadHosts
  redirectUrl?: string
}

// UC.Files is the only in-app download host. Vikingfile links exist in the
// catalog but aren't downloadable from within the app (web-only fallback).
export type PreferredDownloadHost = "ucfiles"

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
export const SUPPORTED_DOWNLOAD_HOSTS: PreferredDownloadHost[] = ["ucfiles"]
const PREFERRED_HOSTS: PreferredDownloadHost[] = ["ucfiles"]
const UCFILES_404_MESSAGE = "UC.Files returned 404. The link appears to be dead."
const UCFILES_IDENTIFIER_RE = /^[A-Za-z0-9_-]{1,64}$/

type UCFilesResolvePayload = {
  fileId?: string
  downloadUrl?: string
}

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
    cleaned[key] = value.map((entry) => {
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

export function selectHost(available: DownloadHosts, _preferredHost?: PreferredDownloadHost): { host: string; links: DownloadHostEntry[] } {
  const links = pickHostLinks(available, "ucfiles")
  if (links.length) return { host: "ucfiles", links }
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
    // /download/{token} is a share token URL, not a file id.
    const fMatch = parsed.pathname.match(/\/(?:f|file)\/([A-Za-z0-9_-]{1,64})(?:[/?#]|$)/)
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

function buildUCFilesDownloadUrl(token: string): string {
  return `https://files.union-crax.xyz/download/${encodeURIComponent(token)}`
}

function sanitizeUCFilesUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (!isUCFilesHostValue(parsed.hostname)) return url
    return parsed.toString()
  } catch {
    return url
  }
}

function getUCFilesResolvePayload(value: string): UCFilesResolvePayload | null {
  const trimmed = String(value || "").trim()
  if (!trimmed) return null

  const sanitized = sanitizeUCFilesUrl(trimmed)

  if (isUCFilesUrl(sanitized)) {
    return { downloadUrl: sanitized }
  }

  if (!UCFILES_IDENTIFIER_RE.test(sanitized)) {
    return null
  }

  if (/^\d+$/.test(sanitized)) {
    return { fileId: sanitized }
  }

  return { downloadUrl: buildUCFilesDownloadUrl(sanitized) }
}

function isUCFilesShareDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return isUCFilesHostValue(parsed.hostname) && /^\/(?:download|dl)\/[^/?#]+/.test(parsed.pathname)
  } catch {
    return false
  }
}

export async function resolveUCFilesDownload(url: string): Promise<ResolvedDownload> {
  if (!url) return { url, resolved: false }

  const sanitizedUrl = sanitizeUCFilesUrl(url)

  const fileId = extractUCFilesFileId(sanitizedUrl)
  const shareDownloadUrl = isUCFilesShareDownloadUrl(sanitizedUrl) ? sanitizedUrl : null
  const payload = fileId
    ? { fileId }
    : shareDownloadUrl
      ? { downloadUrl: shareDownloadUrl }
      : getUCFilesResolvePayload(sanitizedUrl)
  if (!payload) return { url: sanitizedUrl, resolved: false }

  try {
    const response = await apiFetch("/api/ucfiles/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    if (response.status === 404) {
      throw new Error(UCFILES_404_MESSAGE)
    }

    const data = await response.json().catch(() => null)
    if (!response.ok || !data?.success || !data?.data?.url) {
      downloadLogger.warn("UC.Files resolve failed", { data: { status: response.status, body: data } })
      return { url: sanitizedUrl, resolved: false }
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
    return { url: sanitizedUrl, resolved: false }
  }
}

export async function resolveDownloadUrl(_host: string, url: string): Promise<ResolvedDownload> {
  // Defensive guard for legacy persisted state where "url" may be an object
  const normalizedUrl =
    typeof url === "string"
      ? url
      : url && typeof (url as any).url === "string"
        ? String((url as any).url)
        : String(url ?? "")

  if (isUCFilesUrl(normalizedUrl) || Boolean(getUCFilesResolvePayload(normalizedUrl))) {
    return resolveUCFilesDownload(normalizedUrl)
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
