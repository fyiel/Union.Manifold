import { useEffect, useMemo, useState } from "react"

type LibraryGameMeta = {
  collections?: string[]
  tags?: string[]
  lastPlayedAt?: number
}

export type UserCollection = {
  name: string
  count: number
}

/**
 * Returns user-defined library collections derived from `libraryGameMeta` in
 * settings. Stays in sync with changes via `window.ucSettings.onChanged`.
 */
export function useLibraryCollections(): {
  collections: UserCollection[]
  loading: boolean
} {
  const [meta, setMeta] = useState<Record<string, LibraryGameMeta> | null>(null)

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
      if (!data?.key) return
      if (data.key === "__CLEAR_ALL__") {
        setMeta({})
        return
      }
      if (data.key === "libraryGameMeta") {
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

  const collections = useMemo<UserCollection[]>(() => {
    if (!meta) return []
    const counts = new Map<string, { display: string; count: number }>()
    for (const value of Object.values(meta)) {
      const cols = value?.collections
      if (!Array.isArray(cols)) continue
      for (const raw of cols) {
        const name = String(raw).trim()
        if (!name) continue
        const key = name.toLowerCase()
        const existing = counts.get(key)
        if (existing) {
          existing.count += 1
        } else {
          counts.set(key, { display: name, count: 1 })
        }
      }
    }
    return Array.from(counts.values())
      .map((c) => ({ name: c.display, count: c.count }))
      .sort((left, right) => left.name.localeCompare(right.name))
  }, [meta])

  return { collections, loading: meta === null }
}
