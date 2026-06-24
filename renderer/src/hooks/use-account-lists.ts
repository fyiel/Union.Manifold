import { useCallback, useEffect, useRef, useState } from "react"
import {
  getLibrary,
  setLibraryStatus,
  removeFromLibrary,
  type LibraryStatus,
  type LibraryCounts,
} from "@/lib/account-lists"

type ListsState = {
  /** appid → library status (single source of truth). */
  statuses: Map<string, LibraryStatus>
  /** Derived: appids with status 'favorite'. Kept for existing consumers. */
  favorites: Set<string>
  /** Derived: appids with status 'plan'. Kept for existing consumers. */
  wishlist: Set<string>
  counts: LibraryCounts | null
  authed: boolean | null
  loading: boolean
}

let cached: ListsState | null = null
const listeners = new Set<(state: ListsState) => void>()

function emptyState(loading: boolean): ListsState {
  return {
    statuses: new Map(),
    favorites: new Set(),
    wishlist: new Set(),
    counts: null,
    authed: null,
    loading,
  }
}

function deriveSets(statuses: Map<string, LibraryStatus>) {
  const favorites = new Set<string>()
  const wishlist = new Set<string>()
  for (const [appid, status] of statuses) {
    if (status === "favorite") favorites.add(appid)
    else if (status === "plan") wishlist.add(appid)
  }
  return { favorites, wishlist }
}

function emit(next: ListsState) {
  cached = next
  for (const listener of listeners) listener(next)
}

/** Recompute derived sets + push a new state from a statuses map. */
function emitFromStatuses(statuses: Map<string, LibraryStatus>, patch: Partial<ListsState> = {}) {
  const { favorites, wishlist } = deriveSets(statuses)
  emit({
    ...(cached ?? emptyState(false)),
    statuses,
    favorites,
    wishlist,
    ...patch,
  })
}

async function refresh() {
  emit({ ...(cached ?? emptyState(true)), loading: true })
  const snapshot = await getLibrary()
  if (snapshot == null) {
    // Unauthenticated.
    emit({ ...emptyState(false), authed: false })
    return
  }
  const statuses = new Map<string, LibraryStatus>()
  for (const item of snapshot.items) statuses.set(item.appid, item.status)
  emitFromStatuses(statuses, { counts: snapshot.counts, authed: true, loading: false })
}

/**
 * Shared pub-sub store for the user's unified game library. Tracks each game's
 * single status (Playing / Plan to Play / Completed / On Hold / Dropped /
 * Favorite). Exposes derived favorites/wishlist sets so the existing context
 * menus keep working. Source of truth is the API; cached in memory for fast
 * O(1) lookups across many cards.
 */
export function useAccountLists() {
  const [state, setState] = useState<ListsState>(cached ?? emptyState(true))
  const refreshed = useRef(false)

  useEffect(() => {
    const listener = (next: ListsState) => setState(next)
    listeners.add(listener)
    if (!refreshed.current) {
      refreshed.current = true
      if (!cached || cached.loading) {
        void refresh()
      }
    }
    return () => {
      listeners.delete(listener)
    }
  }, [])

  /** Set or clear a game's library status, with optimistic update + revert. */
  const setStatus = useCallback(async (appid: string, status: LibraryStatus | null, name?: string) => {
    if (!appid) return
    const current = new Map(cached?.statuses ?? new Map<string, LibraryStatus>())
    const prev = current.get(appid) ?? null
    if (prev === status) return

    const optimistic = new Map(current)
    if (status === null) optimistic.delete(appid)
    else optimistic.set(appid, status)
    emitFromStatuses(optimistic)

    const ok =
      status === null ? await removeFromLibrary(appid) : await setLibraryStatus(appid, status, name)
    if (!ok) {
      // Revert.
      const reverted = new Map(optimistic)
      if (prev === null) reverted.delete(appid)
      else reverted.set(appid, prev)
      emitFromStatuses(reverted)
    } else {
      // Refresh counts in the background (cheap, keeps the Library tab honest).
      void refresh()
    }
  }, [])

  // Back-compat helpers used by the card context menus. With the single-status
  // model "Like" => favorite, "Wishlist" => plan; toggling off removes the game.
  const toggleFavorite = useCallback(
    async (appid: string, name?: string) => {
      const has = (cached?.favorites ?? new Set()).has(appid)
      await setStatus(appid, has ? null : "favorite", name)
    },
    [setStatus],
  )

  const toggleWishlist = useCallback(
    async (appid: string, name?: string) => {
      const has = (cached?.wishlist ?? new Set()).has(appid)
      await setStatus(appid, has ? null : "plan", name)
    },
    [setStatus],
  )

  return {
    statuses: state.statuses,
    favorites: state.favorites,
    wishlist: state.wishlist,
    counts: state.counts,
    authed: state.authed,
    loading: state.loading,
    statusFor: (appid: string): LibraryStatus | null => state.statuses.get(appid) ?? null,
    setStatus,
    toggleFavorite,
    toggleWishlist,
    refresh: () => void refresh(),
  }
}
