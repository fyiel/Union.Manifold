import { apiLogger } from "./logger"

const DEFAULT_BASE_URL = "https://union-crax.xyz"
const CUSTOM_API_BASE_URL_STORAGE_KEY = "uc_custom_api_base_url"
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

const EXPECTED_NOT_FOUND_PATTERNS: RegExp[] = [
  /^\/api\/games\/[^/]+$/,
  /^\/api\/account\/game-notes\?appid=/,
]

function isExpectedNotFound(status: number, path: string): boolean {
  if (status !== 404) return false
  return EXPECTED_NOT_FOUND_PATTERNS.some((pattern) => pattern.test(path))
}

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
  if (isExpectedUnauthed(event.status, event.path)) return
  if (isExpectedNotFound(event.status, event.path)) return
  const baseUrl = getApiBaseUrl()
  const snapshot = getApiConnectivitySnapshot()

  const isOutageHit = snapshot.serviceReachable === false || event.status === 0 || event.status === 502 || event.status === 503 || event.status === 504
  if (isOutageHit) {
    const key = `${event.method}:${event.path}`
    const now = Date.now()
    const last = outageLogTimestamps.get(key) || 0
    if (now - last < OUTAGE_LOG_WINDOW_MS) return
    outageLogTimestamps.set(key, now)
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
  }
  return true
}

function persistServiceReachability(value: boolean): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(API_REACHABILITY_STORAGE_KEY, value ? "1" : "0")
  } catch {
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

async function recheckApiReachability(): Promise<boolean> {
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

function normalizeApiBaseUrl(url: string): string {
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

export function getApiBaseUrl(): string {
  return readCustomApiBaseUrl() || readDetectedApiBaseUrl() || DEFAULT_BASE_URL
}

function setApiBaseUrl(url: string): void {
  if (typeof window === "undefined") return
  const normalized = normalizeApiBaseUrl(url)
  try {
    if (normalized) {
      window.localStorage.setItem(CUSTOM_API_BASE_URL_STORAGE_KEY, normalized)
    } else {
      window.localStorage.removeItem(CUSTOM_API_BASE_URL_STORAGE_KEY)
    }
  } catch {
  }
  resetApiReachability()
}

export function apiUrl(path: string): string {
  const base = getApiBaseUrl().replace(/\/+$/, "")
  const normalized = path.startsWith("/") ? path : `/${path}`
  return `${base}${normalized}`
}

function rejectOnAbort(signal: AbortSignal | null | undefined): Promise<never> | null {
  if (!signal) return null
  return new Promise<never>((_, reject) => {
    const abort = () => reject(new DOMException("The operation was aborted.", "AbortError"))
    if (signal.aborted) abort()
    else signal.addEventListener("abort", abort, { once: true })
  })
}

export async function apiFetch(path: string, init?: RequestInit) {
  const nextInit: RequestInit = { ...(init || {}) }
  if (!nextInit.credentials) {
    nextInit.credentials = "include"
  }

  const headers = new Headers(nextInit.headers || {})
  if (nextInit.body && !headers.has("content-type")) {
    if (typeof nextInit.body === "string" && nextInit.body.startsWith("{")) {
      headers.set("content-type", "application/json")
    }
  }

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
        signal: undefined,
      }

      const abortRejection = rejectOnAbort(finalInit.signal)
      const result = abortRejection
        ? await Promise.race([window.ucAuth!.fetch(getApiBaseUrl(), path, serializedInit), abortRejection])
        : await window.ucAuth!.fetch(getApiBaseUrl(), path, serializedInit)
      setServiceReachable(!(result.status === 0 || result.statusText === "fetch_failed"))
      const responseBody: BodyInit =
        typeof result.bodyText === "string"
          ? result.bodyText
          : result.body
            ? base64ToUint8Array(result.body)
            : new Uint8Array()
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
      return new Response(responseBody, {
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

function base64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  if (!base64) return new Uint8Array()
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
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
