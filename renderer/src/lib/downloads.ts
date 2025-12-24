import { apiFetch, apiUrl } from "@/lib/api"

export type DownloadHosts = Record<string, string[]>

export type DownloadLinksResult = {
  hosts: DownloadHosts
  redirectUrl?: string
}

export type PreferredDownloadHost = "rootz" | "pixeldrain" | "vikingfile"

export type ResolvedDownload = {
  url: string
  filename?: string
  size?: number
  resolved: boolean
}

const ROOTZ_API_BASE_DEFAULT = "https://www.rootz.so/api"
const ROOTZ_API_BASE_STORAGE_KEY = "uc_direct_rootz_api_base"
const ROOTZ_API_KEY_STORAGE_KEY = "uc_direct_rootz_api_key"
const DOWNLOAD_HOST_STORAGE_KEY = "uc_direct_download_host"
const ROOTZ_SIGNED_HOST = "signed-url.cloudflare.com"
const SUPPORTED_DOWNLOAD_HOSTS: PreferredDownloadHost[] = ["rootz", "pixeldrain"]
const PREFERRED_HOSTS: PreferredDownloadHost[] = ["rootz", "pixeldrain", "vikingfile"]

function getRootzApiBase(): string {
  if (typeof window === "undefined") {
    return import.meta.env.VITE_ROOTZ_API_BASE || ROOTZ_API_BASE_DEFAULT
  }
  const stored = localStorage.getItem(ROOTZ_API_BASE_STORAGE_KEY)
  return stored?.trim() || import.meta.env.VITE_ROOTZ_API_BASE || ROOTZ_API_BASE_DEFAULT
}

function getRootzApiKey(): string {
  if (typeof window === "undefined") {
    return import.meta.env.VITE_ROOTZ_API_KEY || ""
  }
  const stored = localStorage.getItem(ROOTZ_API_KEY_STORAGE_KEY)
  return stored?.trim() || import.meta.env.VITE_ROOTZ_API_KEY || ""
}

function rootzApiUrl(path: string): string {
  const base = getRootzApiBase().replace(/\/+$/, "")
  const normalized = path.startsWith("/") ? path : `/${path}`
  return `${base}${normalized}`
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

async function fetchRootzPayload(path: string) {
  const apiKey = getRootzApiKey()
  const headers: Record<string, string> = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const response = await fetch(rootzApiUrl(path), { headers })
  const data = await response.json().catch(() => null)
  if (!response.ok) return null
  if (data && typeof data === "object" && "success" in data && (data as { success?: boolean }).success !== true) {
    return null
  }
  return pickRootzPayload(data)
}

async function fetchRootzDownload(fileId: string) {
  if (!fileId) return null
  const payload = await fetchRootzPayload(`/files/download/${encodeURIComponent(fileId)}`)
  return normalizeRootzPayload(payload)
}

async function fetchRootzByShortId(shortId: string) {
  if (!shortId) return null
  const payload = await fetchRootzPayload(`/files/short/${encodeURIComponent(shortId)}`)
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
    return { hosts: (data?.hosts as DownloadHosts) || {} }
  }

  return { hosts: {}, redirectUrl: response.url }
}

function pickHostLinks(available: DownloadHosts, host: PreferredDownloadHost) {
  if (host === "rootz") {
    return available.rootz || available["rootz.so"] || available["www.rootz.so"] || []
  }
  if (host === "pixeldrain") {
    return available.pixeldrain || available["pixeldrain.com"] || []
  }
  if (host === "vikingfile") {
    return available.vikingfile || []
  }
  return []
}

export async function getPreferredDownloadHost(): Promise<PreferredDownloadHost> {
  if (typeof window === "undefined") return "rootz"
  
  // Try to get from electron settings first (synchronized with Settings UI)
  if (window.ucSettings?.get) {
    try {
      const stored = await window.ucSettings.get('defaultMirrorHost')
      if (stored && PREFERRED_HOSTS.includes(stored as PreferredDownloadHost)) {
        return stored as PreferredDownloadHost
      }
    } catch (err) {
      console.warn('[UC] Failed to get defaultMirrorHost from settings:', err)
    }
  }
  
  // Fallback to localStorage for backwards compatibility
  const legacy = localStorage.getItem(DOWNLOAD_HOST_STORAGE_KEY)
  if (legacy && PREFERRED_HOSTS.includes(legacy as PreferredDownloadHost)) {
    return legacy as PreferredDownloadHost
  }
  
  return "rootz"
}

export function setPreferredDownloadHost(host: PreferredDownloadHost) {
  if (typeof window === "undefined") return
  if (!PREFERRED_HOSTS.includes(host)) return
  
  // Save to electron settings (synchronized with Settings UI)
  if (window.ucSettings?.set) {
    window.ucSettings.set('defaultMirrorHost', host).catch((err: any) => {
      console.warn('[UC] Failed to set defaultMirrorHost:', err)
    })
  }
  
  // Also keep localStorage for backwards compatibility
  localStorage.setItem(DOWNLOAD_HOST_STORAGE_KEY, host)
}

export function selectHost(available: DownloadHosts, preferredHost?: PreferredDownloadHost) {
  const preferred = preferredHost && PREFERRED_HOSTS.includes(preferredHost) ? preferredHost : "rootz"
  if (SUPPORTED_DOWNLOAD_HOSTS.includes(preferred)) {
    const preferredLinks = pickHostLinks(available, preferred)
    if (preferredLinks.length) {
      return { host: preferred, links: preferredLinks }
    }
  }
  const rootzLinks = pickHostLinks(available, "rootz")
  if (rootzLinks.length) {
    return { host: "rootz", links: rootzLinks }
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

export function extractRootzFileId(url: string): string | null {
  try {
    const parsed = new URL(url)
    const directMatch = parsed.pathname.match(/\/files\/download\/([0-9a-fA-F-]{36})/)
    if (directMatch?.[1]) return directMatch[1]
    const uuidMatch = parsed.pathname.match(/([0-9a-fA-F-]{36})/)
    if (uuidMatch?.[1]) return uuidMatch[1]
    const queryId = parsed.searchParams.get("fileId") || parsed.searchParams.get("id")
    if (queryId && /[0-9a-fA-F-]{36}/.test(queryId)) return queryId
  } catch {}
  return null
}

export function isRootzUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.hostname.includes("rootz.so") || parsed.hostname.includes(ROOTZ_SIGNED_HOST)
  } catch {
    return false
  }
}

export async function resolveRootzDownload(url: string): Promise<ResolvedDownload> {
  if (!url) return { url, resolved: false }
  if (isRootzSignedUrl(url)) return { url, resolved: true }

  const fileId = extractRootzFileId(url)
  if (fileId) {
    const direct = await fetchRootzDownload(fileId)
    if (direct?.url) {
      return {
        url: direct.url,
        filename: direct.fileName,
        size: direct.size,
        resolved: true,
      }
    }
  }

  const shortId = extractRootzShortId(url)
  if (shortId) {
    const meta = await fetchRootzByShortId(shortId)
    if (meta?.url) {
      return {
        url: meta.url,
        filename: meta.fileName,
        size: meta.size,
        resolved: true,
      }
    }

    if (meta?.id) {
      const resolved = await fetchRootzDownload(meta.id)
      if (resolved?.url) {
        return {
          url: resolved.url,
          filename: resolved.fileName,
          size: resolved.size,
          resolved: true,
        }
      }
    }

    const direct = await fetchRootzDownload(shortId)
    if (direct?.url) {
      return {
        url: direct.url,
        filename: direct.fileName,
        size: direct.size,
        resolved: true,
      }
    }
  }

  return { url, resolved: false }
}

export async function resolveDownloadUrl(host: string, url: string): Promise<ResolvedDownload> {
  if (host === "rootz") {
    return resolveRootzDownload(url)
  }
  if (host === "pixeldrain") {
    return resolvePixeldrainDownload(url)
  }
  return { url, resolved: true }
}

async function resolvePixeldrainDownload(url: string): Promise<ResolvedDownload> {
  if (!url) return { url, resolved: false }
  try {
    // Extract an ID from common pixeldrain URL forms like /u/<id> or /file/<id>
    const m = url.match(/(?:pixeldrain\.com\/(?:u|file)\/)([A-Za-z0-9]+)/)
    const id = m?.[1]
    if (!id) return { url, resolved: true }

    // Fetch metadata from Pixeldrain API
    const apiUrl = `https://pixeldrain.com/api/file/${encodeURIComponent(id)}`
    const resp = await fetch(apiUrl)
    if (!resp.ok) {
      // If API fails, fallback to a direct download endpoint
      return { url: `https://pixeldrain.com/api/file/${encodeURIComponent(id)}/download`, resolved: true }
    }
    const data = await resp.json().catch(() => null)
    if (data && typeof data === 'object') {
      const filename = (data as any).name || undefined
      const size = typeof (data as any).size === 'number' ? (data as any).size : undefined
      return {
        url: `https://pixeldrain.com/api/file/${encodeURIComponent(id)}/download`,
        filename,
        size,
        resolved: true,
      }
    }
  } catch (err) {
    // ignore and fallback
  }
  return { url, resolved: true }
}
