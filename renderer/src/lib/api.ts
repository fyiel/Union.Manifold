const DEFAULT_BASE_URL = "https://union-crax.xyz"
const STORAGE_KEY = "uc_direct_base_url"

export function getApiBaseUrl(): string {
  if (typeof window === "undefined") return DEFAULT_BASE_URL
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored?.trim() || import.meta.env.VITE_UC_BASE_URL || DEFAULT_BASE_URL
}

export function setApiBaseUrl(value: string) {
  if (typeof window === "undefined") return
  const normalized = value.trim().replace(/\/+$/, "")
  if (normalized) {
    localStorage.setItem(STORAGE_KEY, normalized)
  } else {
    localStorage.removeItem(STORAGE_KEY)
  }
}

export function apiUrl(path: string): string {
  const base = getApiBaseUrl().replace(/\/+$/, "")
  const normalized = path.startsWith("/") ? path : `/${path}`
  return `${base}${normalized}`
}

export async function apiFetch(path: string, init?: RequestInit) {
  return fetch(apiUrl(path), init)
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
