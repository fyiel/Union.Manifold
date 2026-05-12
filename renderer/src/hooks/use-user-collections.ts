import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  CloudCollection,
  createCloudCollection,
  deleteCloudCollection,
  listCloudCollections,
  shareCloudCollection,
  unshareCloudCollection,
  updateCloudCollection,
} from "@/lib/cloud-collections"

type LibraryGameMeta = {
  collections?: string[]
  tags?: string[]
  lastPlayedAt?: number
}

export type UserCollection = CloudCollection & {
  /** True when this collection has been pushed to the account database. */
  cloud: boolean
}

const MIGRATED_FLAG_KEY = "uc_collections_migrated_v1"

function dedupeCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const v = String(value || "").trim()
    if (!v) continue
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out.sort((a, b) => a.localeCompare(b))
}

function deriveLocalCollections(
  meta: Record<string, LibraryGameMeta>
): { name: string; appids: string[] }[] {
  const map = new Map<string, { display: string; appids: string[] }>()
  for (const [appid, m] of Object.entries(meta)) {
    for (const raw of m?.collections || []) {
      const name = String(raw).trim()
      if (!name) continue
      const key = name.toLowerCase()
      const existing = map.get(key)
      if (existing) existing.appids.push(appid)
      else map.set(key, { display: name, appids: [appid] })
    }
  }
  return Array.from(map.values())
    .map((c) => ({ name: c.display, appids: c.appids }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function localToUser(collection: { name: string; appids: string[] }, idx: number): UserCollection {
  return {
    id: `local-${idx}-${collection.name}`,
    name: collection.name,
    appids: collection.appids,
    shareToken: null,
    isPublic: false,
    createdAt: "",
    updatedAt: "",
    cloud: false,
  }
}

/**
 * Single source of truth for the user's collections in the launcher.
 *
 * - When the user is signed in, the cloud database (account-scoped) wins.
 *   Mutations call the API and update local state.
 * - When the user is offline / unauthed, falls back to the per-game
 *   `libraryGameMeta` blob in settings — same flow we've always had.
 * - On the first successful auth, any local-only collections are pushed to
 *   the cloud once, then we never look at the local meta again until the
 *   user signs out.
 */
export function useUserCollections() {
  const [meta, setMeta] = useState<Record<string, LibraryGameMeta> | null>(null)
  const [cloudCollections, setCloudCollections] = useState<CloudCollection[] | null>(null)
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const migrationRunRef = useRef(false)

  // ---- Local meta load ----
  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const value = await window.ucSettings?.get?.("libraryGameMeta")
        if (!mounted) return
        if (value && typeof value === "object" && !Array.isArray(value)) {
          setMeta(value as Record<string, LibraryGameMeta>)
        } else {
          setMeta({})
        }
      } catch {
        if (mounted) setMeta({})
      }
    }
    void load()
    const off = window.ucSettings?.onChanged?.((data: any) => {
      if (data?.key === "__CLEAR_ALL__") {
        setMeta({})
        return
      }
      if (data?.key === "libraryGameMeta") {
        if (data.value && typeof data.value === "object" && !Array.isArray(data.value)) {
          setMeta(data.value as Record<string, LibraryGameMeta>)
        } else {
          setMeta({})
        }
      }
    })
    return () => {
      mounted = false
      if (typeof off === "function") off()
    }
  }, [])

  // ---- Cloud load ----
  const refreshCloud = useCallback(async () => {
    try {
      const result = await listCloudCollections()
      if (result.authed === false) {
        setAuthed(false)
        setCloudCollections(null)
        return { authed: false as const }
      }
      setAuthed(true)
      setCloudCollections(result.collections)
      return { authed: true as const, collections: result.collections }
    } catch (err) {
      // Treat network errors as "not authed for now" so the UI degrades gracefully.
      setAuthed(false)
      setCloudCollections(null)
      return { authed: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  }, [])

  useEffect(() => {
    let mounted = true
    void (async () => {
      await refreshCloud()
      if (mounted) setLoading(false)
    })()
    return () => {
      mounted = false
    }
  }, [refreshCloud])

  // ---- One-shot migration: local → cloud on first auth ----
  useEffect(() => {
    if (migrationRunRef.current) return
    if (authed !== true) return
    if (cloudCollections == null || meta == null) return
    if (cloudCollections.length > 0) {
      // User already has cloud collections — assume they've migrated before.
      migrationRunRef.current = true
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const flag = await window.ucSettings?.get?.(MIGRATED_FLAG_KEY)
        if (flag) {
          migrationRunRef.current = true
          return
        }
        const local = deriveLocalCollections(meta)
        for (const c of local) {
          if (cancelled) return
          try {
            await createCloudCollection(c.name, c.appids)
          } catch {
            /* swallow per-collection errors so we don't block the rest */
          }
        }
        try {
          await window.ucSettings?.set?.(MIGRATED_FLAG_KEY, true)
        } catch {
          /* swallow */
        }
        migrationRunRef.current = true
        await refreshCloud()
      } catch {
        migrationRunRef.current = true
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authed, cloudCollections, meta, refreshCloud])

  const collections = useMemo<UserCollection[]>(() => {
    if (authed && cloudCollections) {
      return cloudCollections.map((c) => ({ ...c, cloud: true }))
    }
    if (meta) {
      return deriveLocalCollections(meta).map((c, idx) => localToUser(c, idx))
    }
    return []
  }, [authed, cloudCollections, meta])

  // ---- Mutations ----
  // We keep the local `libraryGameMeta` view in sync with cloud changes so
  // existing local-aware UI (LibraryPage chips, GameCard footers) keeps
  // working without changes.
  const writeLocalMeta = useCallback(async (next: Record<string, LibraryGameMeta>) => {
    setMeta(next)
    try {
      await window.ucSettings?.set?.("libraryGameMeta", next)
    } catch {
      /* swallow */
    }
  }, [])

  const reflectMembershipLocally = useCallback(
    async (name: string, appids: string[]) => {
      if (!meta) return
      const next: Record<string, LibraryGameMeta> = { ...meta }
      const lower = name.toLowerCase()
      const wanted = new Set(appids)
      const allAppids = new Set<string>([...Object.keys(next), ...appids])
      for (const appid of allAppids) {
        const current = next[appid] || {}
        const cols = current.collections || []
        const has = cols.some((c) => c.toLowerCase() === lower)
        if (wanted.has(appid) && !has) {
          next[appid] = { ...current, collections: dedupeCaseInsensitive([...cols, name]) }
        } else if (!wanted.has(appid) && has) {
          next[appid] = { ...current, collections: cols.filter((c) => c.toLowerCase() !== lower) }
        }
      }
      await writeLocalMeta(next)
    },
    [meta, writeLocalMeta]
  )

  const removeFromLocalMeta = useCallback(
    async (name: string) => {
      if (!meta) return
      const next: Record<string, LibraryGameMeta> = { ...meta }
      for (const [appid, m] of Object.entries(next)) {
        const cols = m.collections || []
        if (cols.some((c) => c.toLowerCase() === name.toLowerCase())) {
          next[appid] = { ...m, collections: cols.filter((c) => c.toLowerCase() !== name.toLowerCase()) }
        }
      }
      await writeLocalMeta(next)
    },
    [meta, writeLocalMeta]
  )

  const renameInLocalMeta = useCallback(
    async (oldName: string, nextName: string) => {
      if (!meta) return
      const next: Record<string, LibraryGameMeta> = { ...meta }
      for (const [appid, m] of Object.entries(next)) {
        const cols = m.collections || []
        if (cols.some((c) => c.toLowerCase() === oldName.toLowerCase())) {
          next[appid] = {
            ...m,
            collections: dedupeCaseInsensitive(
              cols.map((c) => (c.toLowerCase() === oldName.toLowerCase() ? nextName : c))
            ),
          }
        }
      }
      await writeLocalMeta(next)
    },
    [meta, writeLocalMeta]
  )

  const create = useCallback(
    async (name: string, appids: string[]): Promise<UserCollection | null> => {
      try {
        await reflectMembershipLocally(name, appids)
        if (authed) {
          const created = await createCloudCollection(name, appids)
          setCloudCollections((prev) => prev ? [...prev, created] : [created])
          return { ...created, cloud: true }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not create collection")
        return null
      }
      // unauthed: local only (already reflected)
      return {
        id: `local-${Date.now()}-${name}`,
        name,
        appids,
        shareToken: null,
        isPublic: false,
        createdAt: "",
        updatedAt: "",
        cloud: false,
      }
    },
    [authed, reflectMembershipLocally]
  )

  const setMembership = useCallback(
    async (collection: UserCollection, appids: string[]) => {
      try {
        await reflectMembershipLocally(collection.name, appids)
        if (authed && collection.cloud) {
          await updateCloudCollection(collection.id, { appids })
          setCloudCollections((prev) =>
            prev ? prev.map((c) => (c.id === collection.id ? { ...c, appids } : c)) : prev
          )
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not update collection")
      }
    },
    [authed, reflectMembershipLocally]
  )

  const rename = useCallback(
    async (collection: UserCollection, nextName: string) => {
      const target = nextName.trim()
      if (!target || target.toLowerCase() === collection.name.toLowerCase()) return
      try {
        await renameInLocalMeta(collection.name, target)
        if (authed && collection.cloud) {
          await updateCloudCollection(collection.id, { name: target })
          setCloudCollections((prev) =>
            prev ? prev.map((c) => (c.id === collection.id ? { ...c, name: target } : c)) : prev
          )
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not rename collection")
      }
    },
    [authed, renameInLocalMeta]
  )

  const remove = useCallback(
    async (collection: UserCollection) => {
      try {
        await removeFromLocalMeta(collection.name)
        if (authed && collection.cloud) {
          await deleteCloudCollection(collection.id)
          setCloudCollections((prev) =>
            prev ? prev.filter((c) => c.id !== collection.id) : prev
          )
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not delete collection")
      }
    },
    [authed, removeFromLocalMeta]
  )

  const share = useCallback(
    async (collection: UserCollection, makePublic: boolean): Promise<{ shareToken: string; isPublic: boolean } | null> => {
      if (!authed || !collection.cloud) {
        setError("Sign in to share collections.")
        return null
      }
      try {
        const result = await shareCloudCollection(collection.id, { public: makePublic })
        setCloudCollections((prev) =>
          prev
            ? prev.map((c) =>
                c.id === collection.id
                  ? { ...c, shareToken: result.shareToken, isPublic: result.isPublic }
                  : c
              )
            : prev
        )
        return result
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not share collection")
        return null
      }
    },
    [authed]
  )

  const unshare = useCallback(
    async (collection: UserCollection) => {
      if (!authed || !collection.cloud) return
      try {
        await unshareCloudCollection(collection.id)
        setCloudCollections((prev) =>
          prev
            ? prev.map((c) =>
                c.id === collection.id
                  ? { ...c, shareToken: null, isPublic: false }
                  : c
              )
            : prev
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not unshare collection")
      }
    },
    [authed]
  )

  return {
    collections,
    loading,
    authed,
    error,
    clearError: () => setError(null),
    refresh: refreshCloud,
    create,
    setMembership,
    rename,
    remove,
    share,
    unshare,
  }
}
