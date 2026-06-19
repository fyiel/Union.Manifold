import { apiLogger } from "./logger"

const DEFAULT_BASE_URL = "https://union-crax.xyz"
// The user's explicit override, set from Settings. Empty unless the user picks one.
const CUSTOM_API_BASE_URL_STORAGE_KEY = "uc_custom_api_base_url"
// The reachable host picked by the splash probe (detectBestBaseUrl in main.cjs).
// Refreshed on every launch. Kept separate from the user override so a stale
// auto-detected value can never masquerade as a manual choice — and so the
// splash result always wins over the hardcoded default.
const DETECTED_API_BASE_URL_STORAGE_KEY = "uc_detected_api_base_url"
const API_REACHABILITY_STORAGE_KEY = "uc_api_service_reachable"

type ApiConnectivitySnapshot = {
  browserOnline: boolean
  serviceReachable: boolean
  isOnline: boolean
}

const connectivityListeners = new Set<() => void>()
let serviceReachable = readPersistedServiceReachability()
let cachedConnectivitySnapshot: ApiConnectivitySnapshot | null = null

function classifyApiPath(path: string): string {
  if (!path) return "unknown"
  if (path.startsWith("/api/games/")) return "games-detail"
  if (path.startsWith("/api/games")) return "games-list"
  if (path.startsWith("/api/ucfiles/media")) return "media-proxy"
  if (path.startsWith("/api/health")) return "health"
  return "other"
}

// Endpoints that legitimately return 401 when the user isn't signed in.
// Logging those as warnings spams the diagnostic feed without surfacing
// anything actionable — the renderer already handles unauthed state via
// useAuth/React Query.
const EXPECTED_UNAUTHED_PREFIXES = [
  "/api/auth/me",
  "/api/account/",
  "/api/search-history",
  "/api/notifications",
]

function isExpectedUnauthed(status: number, path: string): boolean {
  if (status !== 401) return false
  return EXPECTED_UNAUTHED_PREFIXES.some((prefix) => path.startsWith(prefix))
}

// Endpoints where a 404 is a legitimate "this id isn't in the catalog"
// answer and not an infrastructure failure. The renderer presents these as
// friendly "not found" UIs already; logging them as warnings creates noise
// every time someone follows a deleted/stale link.
const EXPECTED_NOT_FOUND_PATTERNS: RegExp[] = [
  /^\/api\/games\/[^/]+$/,
  /^\/api\/account\/game-notes\?appid=/,
]

function isExpectedNotFound(status: number, path: string): boolean {
  if (status !== 404) return false
  return EXPECTED_NOT_FOUND_PATTERNS.some((pattern) => pattern.test(path))
}

// When the API is briefly down (Cloudflare 5xx, DNS hiccup) every page that
// fans out fetches produces a fresh log line. This throttles to one log per
// path per OUTAGE_LOG_WINDOW_MS so the diagnostic file stays readable.
const OUTAGE_LOG_WINDOW_MS = 60_000
const outageLogTimestamps = new Map<string, number>()

function logApiFailure(event: {
  stage: "auth-fetch" | "window-fetch" | "auth-upload"
  path: string
  method: string
  status: number
  statusText: string
  error?: string
}) {
  // Silently swallow expected 401s on auth-required endpoints. They fire on
  // every page load for signed-out users and drown the log file.
  if (isExpectedUnauthed(event.status, event.path)) return
  // Same treatment for 404s on per-id catalog/game-notes lookups — the
  // renderer already handles these gracefully with a not-found UI.
  if (isExpectedNotFound(event.status, event.path)) return
  const baseUrl = getApiBaseUrl()
  const snapshot = getApiConnectivitySnapshot()

  // During a known outage (serviceReachable=false from our heartbeat, or a
  // network-level fetch failure with status=0), log the FIRST hit per path
  // per minute and drop the rest. The full failure detail is still on the
  // first line so debugging an outage doesn't lose anything.
  const isOutageHit = snapshot.serviceReachable === false || event.status === 0 || event.status === 502 || event.status === 503 || event.status === 504
  if (isOutageHit) {
    const key = `${event.method}:${event.path}`
    const now = Date.now()
    const last = outageLogTimestamps.get(key) || 0
    if (now - last < OUTAGE_LOG_WINDOW_MS) return
    outageLogTimestamps.set(key, now)
    // Bound the map so a long session can't grow it without limit.
    if (outageLogTimestamps.size > 256) {
      const oldestKey = outageLogTimestamps.keys().next().value
      if (oldestKey) outageLogTimestamps.delete(oldestKey)
    }
  }

  apiLogger.warn("apiFetch request failed", {
    context: "API",
    data: {
      stage: event.stage,
      class: classifyApiPath(event.path),
      path: event.path,
      method: event.method,
      status: event.status,
      statusText: event.statusText,
      error: event.error,
      baseUrl,
      browserOnline: snapshot.browserOnline,
      serviceReachable: snapshot.serviceReachable,
      isOnline: snapshot.isOnline,
      ts: new Date().toISOString(),
    },
  })
}

function readPersistedServiceReachability(): boolean {
  if (typeof window === "undefined") return true
  try {
    const stored = window.localStorage.getItem(API_REACHABILITY_STORAGE_KEY)
    if (stored === "0") return false
    if (stored === "1") return true
  } catch {
    // ignore storage errors
  }
  return true
}

function persistServiceReachability(value: boolean): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(API_REACHABILITY_STORAGE_KEY, value ? "1" : "0")
  } catch {
    // ignore storage errors
  }
}

function readBrowserOnline(): boolean {
  return typeof navigator !== "undefined" ? navigator.onLine : true
}

function emitConnectivityChange(): void {
  for (const listener of connectivityListeners) {
    listener()
  }
}

function setServiceReachable(nextValue: boolean): void {
  if (serviceReachable === nextValue) return
  serviceReachable = nextValue
  persistServiceReachability(nextValue)
  emitConnectivityChange()
}

export function resetApiReachability(): void {
  setServiceReachable(true)
}

/**
 * Actively re-probe the API and update the connectivity flag from the result.
 * Used by the offline UI's "Retry" button so a click gives a real answer
 * instead of optimistically flipping to online and bouncing back on the next
 * failed fetch. Resolves to the new reachability.
 */
export async function recheckApiReachability(): Promise<boolean> {
  try {
    const response = await fetch(apiUrl("/api/health"), {
      method: "GET",
      cache: "no-store",
      credentials: "include",
    })
    const ok = response.ok
    setServiceReachable(ok)
    return ok
  } catch {
    setServiceReachable(false)
    return false
  }
}

export function subscribeApiConnectivity(callback: () => void): () => void {
  connectivityListeners.add(callback)
  return () => {
    connectivityListeners.delete(callback)
  }
}

export function getApiConnectivitySnapshot(): ApiConnectivitySnapshot {
  const browserOnline = readBrowserOnline()
  const nextSnapshot = {
    browserOnline,
    serviceReachable,
    isOnline: browserOnline && serviceReachable,
  }

  if (
    cachedConnectivitySnapshot &&
    cachedConnectivitySnapshot.browserOnline === nextSnapshot.browserOnline &&
    cachedConnectivitySnapshot.serviceReachable === nextSnapshot.serviceReachable &&
    cachedConnectivitySnapshot.isOnline === nextSnapshot.isOnline
  ) {
    return cachedConnectivitySnapshot
  }

  cachedConnectivitySnapshot = nextSnapshot
  return cachedConnectivitySnapshot
}

export function normalizeApiBaseUrl(url: string): string {
  const trimmed = String(url || "").trim()
  if (!trimmed) return ""

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  try {
    const parsed = new URL(withProtocol)
    return parsed.toString().replace(/\/+$/, "")
  } catch {
    return ""
  }
}

function readCustomApiBaseUrl(): string {
  if (typeof window === "undefined") return ""
  try {
    return normalizeApiBaseUrl(window.localStorage.getItem(CUSTOM_API_BASE_URL_STORAGE_KEY) || "")
  } catch {
    return ""
  }
}

function readDetectedApiBaseUrl(): string {
  if (typeof window === "undefined") return ""
  try {
    return normalizeApiBaseUrl(window.localStorage.getItem(DETECTED_API_BASE_URL_STORAGE_KEY) || "")
  } catch {
    return ""
  }
}

// Precedence: an explicit user override always wins; otherwise use the host the
// splash probe found reachable this launch; fall back to the primary only when
// neither is available.
export function getApiBaseUrl(): string {
  return readCustomApiBaseUrl() || readDetectedApiBaseUrl() || DEFAULT_BASE_URL
}

export function setApiBaseUrl(url: string): void {
  if (typeof window === "undefined") return
  const normalized = normalizeApiBaseUrl(url)
  try {
    if (normalized) {
      window.localStorage.setItem(CUSTOM_API_BASE_URL_STORAGE_KEY, normalized)
    } else {
      window.localStorage.removeItem(CUSTOM_API_BASE_URL_STORAGE_KEY)
    }
  } catch {
    // ignore storage errors
  }
  resetApiReachability()
}

export function apiUrl(path: string): string {
  const base = getApiBaseUrl().replace(/\/+$/, "")
  const normalized = path.startsWith("/") ? path : `/${path}`
  return `${base}${normalized}`
}

export async function apiFetch(path: string, init?: RequestInit) {
  const nextInit: RequestInit = { ...(init || {}) }
  if (!nextInit.credentials) {
    nextInit.credentials = "include"
  }

  // Ensure proper content-type for JSON requests
  const headers = new Headers(nextInit.headers || {})
  if (nextInit.body && !headers.has("content-type")) {
    // Detect if body is JSON
    if (typeof nextInit.body === "string" && nextInit.body.startsWith("{")) {
      headers.set("content-type", "application/json")
    }
  }
  
  // Add user-agent header
  if (!headers.has("user-agent")) {
    headers.set("User-Agent", "UnionCrax.Direct/Electron")
  }

  // Create new init with updated headers
  const finalInit: RequestInit = { ...nextInit, headers }

  const canUseAuthFetch = typeof window !== "undefined" && Boolean(window.ucAuth?.fetch)
  const method = String(finalInit.method || "GET").toUpperCase()
  if (canUseAuthFetch) {
    let body: any = finalInit.body
    let authHeaders = new Headers(finalInit.headers || {})

    if (body instanceof URLSearchParams) {
      if (!authHeaders.has("content-type")) {
        authHeaders.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8")
      }
      body = body.toString()
    }

    const hasSerializableBody = body == null || typeof body === "string"
    if (hasSerializableBody) {
      const serializedInit = {
        ...finalInit,
        headers: Object.fromEntries(authHeaders.entries()),
        body: body ?? null,
      }

      const result = await window.ucAuth!.fetch(getApiBaseUrl(), path, serializedInit)
      setServiceReachable(!(result.status === 0 || result.statusText === "fetch_failed"))
      const bytes = result.body ? base64ToUint8Array(result.body) : new Uint8Array()
      // Response status must be in [200, 599]. A status of 0 means a network
      // error (DNS failure, server unreachable, CORS block, etc.).  Map it to
      // 503 so the Response object can be constructed and normal error handling
      // runs instead of throwing an uncaught RangeError.
      const rawStatus = result.status || 0
      const safeStatus = rawStatus >= 200 && rawStatus <= 599 ? rawStatus : 503
      if (rawStatus === 0 || String(result.statusText || "").toLowerCase() === "fetch_failed") {
        logApiFailure({
          stage: "auth-fetch",
          path,
          method,
          status: 0,
          statusText: "fetch_failed",
          error: "ipc_auth_fetch_failed",
        })
      } else if (safeStatus >= 400) {
        logApiFailure({
          stage: "auth-fetch",
          path,
          method,
          status: safeStatus,
          statusText: result.statusText || "",
        })
      }
      return new Response(bytes as any, {
        status: safeStatus,
        statusText: result.statusText || (safeStatus !== rawStatus ? "Network Error" : ""),
        headers: new Headers(result.headers || []),
      })
    }
  }

  try {
    const response = await fetch(apiUrl(path), finalInit)
    setServiceReachable(true)
    if (!response.ok) {
      logApiFailure({
        stage: "window-fetch",
        path,
        method,
        status: response.status,
        statusText: response.statusText || "",
      })
    }
    return response
  } catch (error) {
    setServiceReachable(false)
    logApiFailure({
      stage: "window-fetch",
      path,
      method,
      status: 0,
      statusText: "fetch_error",
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

function base64ToUint8Array(base64: string): Uint8Array {
  if (!base64) return new Uint8Array()
  const binary = atob(base64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init)
  if (!response.ok) {
    let detail = `${response.status}`
    try {
      const body = await response.json()
      if (body && typeof body === "object" && "error" in body) {
        detail = String((body as { error?: string }).error || detail)
      }
    } catch { }
    throw new Error(detail)
  }
  return response.json() as Promise<T>
}

/**
 * Authenticated multipart upload that works in both the launcher and a
 * browser context. In Electron we route the upload through the
 * `uc:auth-upload` IPC so the BrowserWindow's session cookies are
 * applied; otherwise we fall back to a plain `fetch` with
 * `credentials: include`. Both paths end up POSTing the same multipart
 * payload — only the cookie source differs.
 *
 * Use this whenever you need to send a file to an endpoint guarded by
 * the user session (avatar, banner, screenshot uploads, etc.). A plain
 * `fetch(apiUrl(...), {credentials:'include'})` will appear to work in a
 * browser but returns 401 in the launcher because the cookies live in a
 * different session.
 */
export async function apiUpload(
  path: string,
  options: {
    file?: File | Blob | null
    fileName?: string
    fileField?: string
    fields?: Record<string, string>
    method?: string
  }
): Promise<Response> {
  const fields = options.fields || {}
  const method = options.method || "POST"
  const file = options.file ?? null
  const fileName = options.fileName || (file && 'name' in (file as any) ? (file as File).name : "upload.bin")
  const fileField = options.fileField || "file"

  const canUseAuthUpload = typeof window !== "undefined" && Boolean(window.ucAuth?.upload)
  if (canUseAuthUpload) {
    let filePayload: { field: string; name: string; type: string; base64: string } | undefined
    if (file) {
      const buffer = await file.arrayBuffer()
      const bytes = new Uint8Array(buffer)
      let binary = ""
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      const base64 = typeof btoa === "function" ? btoa(binary) : ""
      filePayload = {
        field: fileField,
        name: fileName,
        type: (file as Blob).type || "application/octet-stream",
        base64,
      }
    }
    const result = await window.ucAuth!.upload(getApiBaseUrl(), path, {
      method,
      fields,
      file: filePayload,
    })
    setServiceReachable(!(result.status === 0 || result.statusText === "upload_failed"))
    const bytes = result.body ? base64ToUint8Array(result.body) : new Uint8Array()
    const rawStatus = result.status || 0
    const safeStatus = rawStatus >= 200 && rawStatus <= 599 ? rawStatus : 503
    if (safeStatus >= 400) {
      logApiFailure({
        stage: "auth-upload",
        path,
        method,
        status: safeStatus,
        statusText: result.statusText || "",
      })
    }
    return new Response(bytes as any, {
      status: safeStatus,
      statusText: result.statusText || (safeStatus !== rawStatus ? "Network Error" : ""),
      headers: new Headers(result.headers || []),
    })
  }

  // Browser / fallback path — relies on cross-site cookies being available.
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (value == null) continue
    form.append(key, String(value))
  }
  if (file) form.append(fileField, file, fileName)
  return await fetch(apiUrl(path), {
    method,
    body: form,
    credentials: "include",
  })
}
