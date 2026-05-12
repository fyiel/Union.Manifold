import { apiFetch, getApiBaseUrl } from "@/lib/api"

export type CloudCollection = {
  id: string
  name: string
  appids: string[]
  shareToken: string | null
  isPublic: boolean
  createdAt: string
  updatedAt: string
}

type RawCollection = {
  id: string | number
  name: string
  share_token?: string | null
  shareToken?: string | null
  is_public?: boolean
  isPublic?: boolean
  created_at?: string
  updated_at?: string
  createdAt?: string
  updatedAt?: string
  appids?: string[]
}

function normalize(raw: RawCollection): CloudCollection {
  return {
    id: String(raw.id),
    name: String(raw.name || ""),
    appids: Array.isArray(raw.appids) ? raw.appids.map(String) : [],
    shareToken: (raw.share_token ?? raw.shareToken) || null,
    isPublic: Boolean(raw.is_public ?? raw.isPublic),
    createdAt: String(raw.created_at ?? raw.createdAt ?? ""),
    updatedAt: String(raw.updated_at ?? raw.updatedAt ?? ""),
  }
}

/**
 * Returns:
 *  - { authed: true, collections } when the call succeeds
 *  - { authed: false } when the user is not signed in (401)
 *  - throws on network/server errors
 */
export async function listCloudCollections(): Promise<
  { authed: true; collections: CloudCollection[] } | { authed: false }
> {
  const res = await apiFetch("/api/account/collections")
  if (res.status === 401) return { authed: false }
  if (!res.ok) throw new Error(`listCloudCollections failed: ${res.status}`)
  const data = await res.json()
  const list = Array.isArray(data?.collections) ? data.collections : []
  return { authed: true, collections: list.map(normalize) }
}

export async function forkCloudCollection(shareToken: string, name?: string): Promise<CloudCollection> {
  const res = await apiFetch("/api/account/collections/fork", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shareToken, ...(name ? { name } : {}) }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(data?.error || `forkCloudCollection failed: ${res.status}`)
  }
  return normalize(data?.collection)
}

export async function createCloudCollection(
  name: string,
  appids: string[]
): Promise<CloudCollection> {
  const res = await apiFetch("/api/account/collections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, appids }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(data?.error || `createCloudCollection failed: ${res.status}`)
  }
  return normalize(data?.collection)
}

export async function updateCloudCollection(
  id: string,
  changes: { name?: string; appids?: string[]; isPublic?: boolean }
): Promise<void> {
  const res = await apiFetch(`/api/account/collections/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || `updateCloudCollection failed: ${res.status}`)
}

export async function deleteCloudCollection(id: string): Promise<void> {
  const res = await apiFetch(`/api/account/collections/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
  if (!res.ok && res.status !== 404) {
    throw new Error(`deleteCloudCollection failed: ${res.status}`)
  }
}

export async function shareCloudCollection(
  id: string,
  options: { public?: boolean } = {}
): Promise<{ shareToken: string; isPublic: boolean }> {
  const res = await apiFetch(`/api/account/collections/${encodeURIComponent(id)}/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || `shareCloudCollection failed: ${res.status}`)
  return { shareToken: String(data?.shareToken || ""), isPublic: Boolean(data?.isPublic) }
}

export async function unshareCloudCollection(id: string): Promise<void> {
  const res = await apiFetch(`/api/account/collections/${encodeURIComponent(id)}/share`, {
    method: "DELETE",
  })
  if (!res.ok && res.status !== 404) {
    throw new Error(`unshareCloudCollection failed: ${res.status}`)
  }
}

/**
 * Build the public share URL pointed at the website. Used by the Share dialog
 * for "Copy link" — keeps the URL portable across devices.
 */
export function shareUrlFor(token: string): string {
  // Production: hard-code the canonical share URL on union-crax.xyz so the link
  // always works regardless of which API base the launcher is talking to.
  // Falls back to whatever base we're hitting only when api base looks like
  // the prod website (otherwise we'd hand out a link to a dev backend).
  const base = (() => {
    try {
      const apiBase = getApiBaseUrl()
      const url = new URL(apiBase)
      if (/(^|\.)union-crax\.xyz$/i.test(url.hostname)) return "https://union-crax.xyz"
    } catch { /* swallow */ }
    return "https://union-crax.xyz"
  })()
  return `${base}/collection/${encodeURIComponent(token)}`
}

/**
 * Lightweight play history reporter. Best-effort: failures are silent so we
 * never block a launch.
 */
export async function reportPlayEvent(appid: string, type: "play" | "install"): Promise<void> {
  try {
    await apiFetch("/api/account/play-history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appid, type }),
    })
  } catch {
    /* silent */
  }
}
