import { apiLogger } from "./logger"

const DEFAULT_BASE_URL = "https://union-crax.xyz"

export function getApiBaseUrl(): string {
  return DEFAULT_BASE_URL
}

export function setApiBaseUrl(url: string): void {
  // Custom base URL overrides were removed (they were too error-prone and caused
  // session/cookie issues when switching between origins).
  void url
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

  const canUseAuthFetch = typeof window !== "undefined" && Boolean(window.ucAuth?.fetch)
  if (canUseAuthFetch) {
    let body: string | null | undefined = nextInit.body as any
    let headers = new Headers(nextInit.headers || {})

    if (body instanceof URLSearchParams) {
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8")
      }
      body = body.toString()
    }

    const hasSerializableBody = body == null || typeof body === "string"
    if (hasSerializableBody) {
      const serializedInit = {
        ...nextInit,
        headers: Object.fromEntries(headers.entries()),
        body: body ?? null,
      }

      const result = await window.ucAuth!.fetch(getApiBaseUrl(), path, serializedInit)
      const bytes = result.body ? base64ToUint8Array(result.body) : new Uint8Array()
      // Response status must be in [200, 599]. A status of 0 means a network
      // error (DNS failure, server unreachable, CORS block, etc.).  Map it to
      // 503 so the Response object can be constructed and normal error handling
      // runs instead of throwing an uncaught RangeError.
      const rawStatus = result.status || 0
      const safeStatus = rawStatus >= 200 && rawStatus <= 599 ? rawStatus : 503
      return new Response(bytes, {
        status: safeStatus,
        statusText: result.statusText || (safeStatus !== rawStatus ? "Network Error" : ""),
        headers: new Headers(result.headers || []),
      })
    }
  }

  const response = await fetch(apiUrl(path), nextInit)
  return response
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
    } catch {}
    throw new Error(detail)
  }
  return response.json() as Promise<T>
}
