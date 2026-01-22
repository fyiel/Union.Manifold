import { apiFetch, apiUrl } from "@/lib/api"

export type DownloadHosts = Record<string, string[]>

export type DownloadLinksResult = {
  hosts: DownloadHosts
  redirectUrl?: string
}

export type PreferredDownloadHost = "rootz" | "pixeldrain"

export type ResolvedDownload = {
  url: string
  filename?: string
  size?: number
  resolved: boolean
}

const DOWNLOAD_HOST_STORAGE_KEY = "uc_direct_download_host"
const ROOTZ_SIGNED_HOST = "signed-url.cloudflare.com"
// Supported download hosts
const SUPPORTED_DOWNLOAD_HOSTS: PreferredDownloadHost[] = ["rootz", "pixeldrain"]
const PREFERRED_HOSTS: PreferredDownloadHost[] = ["pixeldrain", "rootz"]

function sanitizeHosts(input: DownloadHosts | null | undefined): DownloadHosts {
  const hosts = input && typeof input === "object" ? input : {}
  const cleaned: DownloadHosts = {}
  for (const [key, value] of Object.entries(hosts)) {
    const lower = key.toLowerCase()
    if (lower.includes("vikingfile")) continue
    cleaned[key] = Array.isArray(value) ? value : []
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
  try {
    const response = await apiFetch("/api/rootz/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path,
        shortId: opts?.shortId || null,
        fileId: opts?.fileId || null,
      }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok || !data?.success) return null
    return pickRootzPayload(data.data)
  } catch {
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
    const hosts = sanitizeHosts((data?.hosts as DownloadHosts) || {})
    return { hosts }
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
  return []
}

export async function getPreferredDownloadHost(): Promise<PreferredDownloadHost> {
  if (typeof window === "undefined") return "pixeldrain"
  
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
  
  return "pixeldrain"
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

export function selectHost(available: DownloadHosts, preferredHost?: PreferredDownloadHost) {
  const preferred = preferredHost && PREFERRED_HOSTS.includes(preferredHost) ? preferredHost : "pixeldrain"
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

export function extractPixeldrainFileId(url: string): string | null {
  try {
    const parsed = new URL(url)
    // standard short link: /u/FILE_ID
    const uMatch = parsed.pathname.match(/\/u\/([^/?#]+)/)
    if (uMatch?.[1]) return uMatch[1]
    // sometimes the id is at the root like /FILE_ID
    const parts = parsed.pathname.split("/").filter(Boolean)
    if (parts.length === 1) return parts[0]
    return null
  } catch {
    return null
  }
}

export function isPixeldrainUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.hostname.includes("pixeldrain.com")
  } catch {
    return false
  }
}

async function resolvePixeldrainDownload(url: string): Promise<ResolvedDownload> {
  if (!url) return { url, resolved: false }
  const fileId = extractPixeldrainFileId(url)
  if (!fileId) return { url, resolved: false }

  const apiUrl = `https://pixeldrain.com/api/file/${encodeURIComponent(fileId)}`

  try {
    const res = await fetch(apiUrl, { method: "GET", redirect: "manual" })

    // extract filename from content-disposition if present
    const disposition = res.headers.get("content-disposition")
    let filename: string | undefined
    if (disposition) {
      const match = disposition.match(/filename=?"?([^";]+)"?/) 
      if (match?.[1]) filename = match[1]
    }

    const contentLength = res.headers.get("content-length")
    const size = contentLength ? Number(contentLength) : undefined

    const redirectLocation = res.headers.get("Location") || res.headers.get("location")
    const finalUrl = redirectLocation || res.url || apiUrl

    return { url: finalUrl, filename, size: Number.isFinite(size as number) ? size : undefined, resolved: true }
  } catch (err) {
    return { url, resolved: false }
  }
}

export async function downloadFromPixeldrain(fileId: string, outputDir: string): Promise<string> {
  if (!fileId) throw new Error("fileId required")
  const url = `https://pixeldrain.com/api/file/${encodeURIComponent(fileId)}`

  // Only perform file writes when Node fs is available (Electron main/preload)
  let fs: any = null
  let pathModule: any = null
  if (typeof (globalThis as any).require === "function") {
    try {
      fs = (globalThis as any).require("fs")
      pathModule = (globalThis as any).require("path")
    } catch (e) {
      // fall through
    }
  }
  if (!fs || !pathModule) {
    throw new Error("File system not available in this context. Run this from Electron main or a trusted preload.")
  }

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)

  // determine filename
  const disposition = res.headers.get("content-disposition")
  let filename = fileId
  if (disposition) {
    const match = disposition.match(/filename=?"?([^";]+)"?/)
    if (match?.[1]) filename = match[1]
  } else {
    try {
      const inferred = inferFilenameFromUrl(res.url || url, fileId)
      if (inferred) filename = inferred
    } catch {}
  }

  const filePath = pathModule.join(outputDir, filename)

  // prefer streaming to disk
  const body: any = (res as any).body
  if (body && typeof body.pipe === "function") {
    const stream = fs.createWriteStream(filePath)
    await new Promise<void>((resolve, reject) => {
      body.pipe(stream)
      stream.on("finish", () => resolve())
      stream.on("error", (err: any) => reject(err))
    })
    return filePath
  }

  // fallback: buffer then write using Uint8Array to avoid Buffer type
  const uint8 = new Uint8Array(await res.arrayBuffer())
  await fs.promises.writeFile(filePath, uint8)
  return filePath
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
  // Backend may return direct signed URLs (R2/Cloudflare) that are already downloadable.
  if (!isRootzUrl(url)) {
    return {
      url,
      filename: inferFilenameFromUrl(url, ""),
      resolved: true,
    }
  }

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
    if (meta?.url && (isRootzSignedUrl(meta.url) || !isRootzUrl(meta.url))) {
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
  // Other hosts are not supported; mark unresolved so upstream can handle fallback
  return { url, resolved: false }
}

async function fetchPixeldrainInfo(fileId: string): Promise<{ size?: number; name?: string } | null> {
  const infoUrl = `https://pixeldrain.com/api/file/${encodeURIComponent(fileId)}/info`
  try {
    const response = await fetch(infoUrl)
    if (!response.ok) return null
    const data = await response.json().catch(() => null)
    if (!data || typeof data !== "object") return null
    const size = toNumber((data as Record<string, any>).size)
    const name = firstString((data as Record<string, any>).name)
    return { size, name }
  } catch {
    return null
  }
}

export async function resolveDownloadSize(host: string, url: string): Promise<number | null> {
  if (host === "pixeldrain") {
    const fileId = extractPixeldrainFileId(url)
    if (!fileId) return null
    const info = await fetchPixeldrainInfo(fileId)
    return info?.size ?? null
  }
  if (host === "rootz") {
    const resolved = await resolveRootzDownload(url)
    return resolved?.size ?? null
  }
  return null
}
