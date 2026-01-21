const DEFAULT_BASE_URL = "https://union-crax.xyz"
const FALLBACK_BASE_URL = "http://unioncraxxyz-unioncraxfrontend-owcfti-9b02bb-104-152-210-106.traefik.me"

let currentBaseUrl = DEFAULT_BASE_URL

export function getApiBaseUrl(): string {
  return currentBaseUrl
}

export function setApiBaseUrl(url: string): void {
  currentBaseUrl = url
}

export function getFallbackBaseUrl(): string {
  return FALLBACK_BASE_URL
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

      try {
        const result = await window.ucAuth!.fetch(getApiBaseUrl(), path, serializedInit)
        const bytes = result.body ? base64ToUint8Array(result.body) : new Uint8Array()
        return new Response(bytes, {
          status: result.status || 0,
          statusText: result.statusText || "",
          headers: new Headers(result.headers || []),
        })
      } catch (error) {
        // Try fallback URL if main URL fails
        console.warn("[API] Main URL failed, trying fallback URL (HTTP - insecure)", error)
        try {
          const fallbackResult = await window.ucAuth!.fetch(getFallbackBaseUrl(), path, serializedInit)
          const bytes = fallbackResult.body ? base64ToUint8Array(fallbackResult.body) : new Uint8Array()
          // Switch to fallback URL for subsequent requests if it works
          setApiBaseUrl(getFallbackBaseUrl())
          return new Response(bytes, {
            status: fallbackResult.status || 0,
            statusText: fallbackResult.statusText || "",
            headers: new Headers(fallbackResult.headers || []),
          })
        } catch (fallbackError) {
          console.error("[API] Fallback URL also failed", fallbackError)
          throw fallbackError
        }
      }
    }
  }

  try {
    const response = await fetch(apiUrl(path), nextInit)
    return response
  } catch (error) {
    // Try fallback URL if main URL fails
    console.warn("[API] Main URL failed, trying fallback URL (HTTP - insecure)", error)
    const fallbackOrigin = getFallbackBaseUrl().replace(/\/+$/, "")
    const normalizedPath = path.startsWith("/") ? path : `/${path}`
    const fallbackUrl = `${fallbackOrigin}${normalizedPath}`
    try {
      const fallbackResponse = await fetch(fallbackUrl, nextInit)
      // Switch to fallback URL for subsequent requests if it works
      if (fallbackResponse.ok) {
        setApiBaseUrl(getFallbackBaseUrl())
      }
      return fallbackResponse
    } catch (fallbackError) {
      console.error("[API] Fallback URL also failed", fallbackError)
      throw fallbackError
    }
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
    } catch {}
    throw new Error(detail)
  }
  return response.json() as Promise<T>
}
