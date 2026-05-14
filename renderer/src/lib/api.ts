import { apiLogger } from "./logger"

const DEFAULT_BASE_URL = "https://union-crax.xyz"
const CUSTOM_API_BASE_URL_STORAGE_KEY = "uc_custom_api_base_url"
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

function logApiFailure(event: {
  stage: "auth-fetch" | "window-fetch"
  path: string
  method: string
  status: number
  statusText: string
  error?: string
}) {
  const baseUrl = getApiBaseUrl()
  const snapshot = getApiConnectivitySnapshot()
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

export function getApiBaseUrl(): string {
  return readCustomApiBaseUrl() || DEFAULT_BASE_URL
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
