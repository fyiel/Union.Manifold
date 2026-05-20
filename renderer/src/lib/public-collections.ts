import { apiFetch } from "@/lib/api"

export type PublicCollectionContributor = {
  discordId: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
}

export type PublicCollection = {
  id: string
  name: string
  shareToken: string
  followerCount: number
  forkCount: number
  gameCount: number
  previewAppids: string[]
  previewCoverUrls: Array<string | null>
  owner: {
    discordId: string
    username: string | null
    displayName: string | null
    avatarUrl: string | null
  }
  contributorsPreview: PublicCollectionContributor[]
}

/**
 * Mirrors the website's /collections/browse list — popular public collections,
 * optionally filtered by free-text search across name, owner, and games.
 */
export async function listPublicCollections(params: {
  q?: string
  limit?: number
  offset?: number
} = {}): Promise<{ items: PublicCollection[]; total: number }> {
  const usp = new URLSearchParams()
  usp.set("limit", String(Math.min(50, Math.max(1, params.limit ?? 24))))
  usp.set("offset", String(Math.max(0, params.offset ?? 0)))
  const q = params.q?.trim()
  if (q) usp.set("q", q)
  const res = await apiFetch(`/api/collections/public?${usp.toString()}`)
  if (!res.ok) throw new Error(`listPublicCollections failed: ${res.status}`)
  const data = await res.json()
  const items: PublicCollection[] = Array.isArray(data?.items)
    ? data.items.map((raw: any) => ({
        id: String(raw.id),
        name: String(raw.name || ""),
        shareToken: String(raw.shareToken || ""),
        followerCount: Number(raw.followerCount) || 0,
        forkCount: Number(raw.forkCount) || 0,
        gameCount: Number(raw.gameCount) || 0,
        previewAppids: Array.isArray(raw.previewAppids) ? raw.previewAppids.map(String) : [],
        previewCoverUrls: Array.isArray(raw.previewCoverUrls)
          ? raw.previewCoverUrls.map((v: any) => (v == null ? null : String(v)))
          : [],
        owner: {
          discordId: String(raw?.owner?.discordId || ""),
          username: raw?.owner?.username ?? null,
          displayName: raw?.owner?.displayName ?? null,
          avatarUrl: raw?.owner?.avatarUrl ?? null,
        },
        contributorsPreview: Array.isArray(raw?.contributorsPreview)
          ? raw.contributorsPreview.map((c: any) => ({
              discordId: String(c?.discordId || ""),
              username: c?.username ?? null,
              displayName: c?.displayName ?? null,
              avatarUrl: c?.avatarUrl ?? null,
            }))
          : [],
      }))
    : []
  return { items, total: Number(data?.total) || items.length }
}

/**
 * Follow a public collection by its share token. Requires sign-in; the API
 * returns 401 otherwise and the caller should surface that as a sign-in
 * prompt.
 */
export async function followPublicCollection(shareToken: string): Promise<{ ok: boolean; status: number }> {
  const res = await apiFetch(`/api/collections/share/${encodeURIComponent(shareToken)}/follow`, {
    method: "POST",
  })
  return { ok: res.ok, status: res.status }
}
