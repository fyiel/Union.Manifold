import { apiFetch, getApiBaseUrl } from "@/lib/api"

export type CollectionPermissions = {
  canAdd: boolean
  canRemove: boolean
  canRename: boolean
}

export type CloudCollectionOwner = {
  discordId: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
}

export type CloudContributor = {
  discordId: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  canAdd: boolean
  canRemove: boolean
  canRename: boolean
  invitedAt: string
}

export type CloudCollection = {
  id: string
  name: string
  appids: string[]
  /** Parallel to appids — addedBy[i] is the discord_id (or null) of the user who added that game. */
  addedBy: Array<string | null>
  shareToken: string | null
  isPublic: boolean
  createdAt: string
  updatedAt: string
  role: "owner" | "contributor"
  permissions: CollectionPermissions
  owner: CloudCollectionOwner | null
  contributors: CloudContributor[]
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
  added_by?: Array<string | null>
  addedBy?: Array<string | null>
  role?: "owner" | "contributor"
  permissions?: CollectionPermissions
  owner_discord_id?: string | null
  owner_username?: string | null
  owner_display_name?: string | null
  owner_avatar_url?: string | null
  contributorsPreview?: Array<{
    discordId: string
    username: string | null
    displayName: string | null
    avatarUrl: string | null
  }>
}

function normalize(raw: RawCollection): CloudCollection {
  const role: "owner" | "contributor" = raw.role === "contributor" ? "contributor" : "owner"
  return {
    id: String(raw.id),
    name: String(raw.name || ""),
    appids: Array.isArray(raw.appids) ? raw.appids.map(String) : [],
    addedBy: Array.isArray(raw.added_by ?? raw.addedBy)
      ? (raw.added_by ?? raw.addedBy ?? []).map((v) => (v == null ? null : String(v)))
      : [],
    shareToken: (raw.share_token ?? raw.shareToken) || null,
    isPublic: Boolean(raw.is_public ?? raw.isPublic),
    createdAt: String(raw.created_at ?? raw.createdAt ?? ""),
    updatedAt: String(raw.updated_at ?? raw.updatedAt ?? ""),
    role,
    permissions:
      raw.permissions ??
      (role === "owner"
        ? { canAdd: true, canRemove: true, canRename: true }
        : { canAdd: false, canRemove: false, canRename: false }),
    owner: raw.owner_discord_id
      ? {
          discordId: String(raw.owner_discord_id),
          username: raw.owner_username ?? null,
          displayName: raw.owner_display_name ?? null,
          avatarUrl: raw.owner_avatar_url ?? null,
        }
      : null,
    contributors: (raw.contributorsPreview || []).map((c) => ({
      discordId: c.discordId,
      username: c.username,
      displayName: c.displayName,
      avatarUrl: c.avatarUrl,
      // Preview entries don't include perms; defaults are fine for display.
      canAdd: true,
      canRemove: false,
      canRename: false,
      invitedAt: "",
    })),
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

// ---- Contributor management ----

export async function listCloudContributors(id: string): Promise<CloudContributor[]> {
  const res = await apiFetch(`/api/account/collections/${encodeURIComponent(id)}/contributors`)
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || `listCloudContributors failed: ${res.status}`)
  return Array.isArray(data?.contributors) ? data.contributors : []
}

export async function inviteCloudContributor(
  id: string,
  payload: { username: string; canAdd?: boolean; canRemove?: boolean; canRename?: boolean }
): Promise<CloudContributor[]> {
  const res = await apiFetch(`/api/account/collections/${encodeURIComponent(id)}/contributors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || `inviteCloudContributor failed: ${res.status}`)
  return Array.isArray(data?.contributors) ? data.contributors : []
}

export async function updateCloudContributorPermissions(
  id: string,
  discordId: string,
  perms: Partial<{ canAdd: boolean; canRemove: boolean; canRename: boolean }>
): Promise<CloudContributor[]> {
  const res = await apiFetch(
    `/api/account/collections/${encodeURIComponent(id)}/contributors/${encodeURIComponent(discordId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(perms),
    }
  )
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || `updateCloudContributorPermissions failed: ${res.status}`)
  return Array.isArray(data?.contributors) ? data.contributors : []
}

export async function removeCloudContributor(id: string, discordId: string): Promise<void> {
  const res = await apiFetch(
    `/api/account/collections/${encodeURIComponent(id)}/contributors/${encodeURIComponent(discordId)}`,
    { method: "DELETE" }
  )
  if (!res.ok && res.status !== 404) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.error || `removeCloudContributor failed: ${res.status}`)
  }
}

export type CloudUserSearchResult = {
  discordId: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
}

export async function searchCloudUsers(q: string): Promise<CloudUserSearchResult[]> {
  const res = await apiFetch(`/api/account/users/search?q=${encodeURIComponent(q)}`)
  if (!res.ok) return []
  const data = await res.json().catch(() => null)
  return Array.isArray(data?.users) ? data.users : []
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

/**
 * Remove a single appid from the cloud play history (the "Not on this PC"
 * carousel on the launcher). Used when the user no longer wants to see a
 * previously-installed game in their cloud library.
 */
export async function removePlayHistoryEntry(appid: string): Promise<boolean> {
  try {
    const res = await apiFetch("/api/account/play-history", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appid }),
    })
    return res.ok
  } catch {
    return false
  }
}
