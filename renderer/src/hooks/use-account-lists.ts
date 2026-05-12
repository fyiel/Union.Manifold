import { useCallback, useEffect, useRef, useState } from "react"
import {
  addToFavorites,
  addToWishlist,
  listFavoriteAppids,
  listWishlistAppids,
  removeFromFavorites,
  removeFromWishlist,
} from "@/lib/account-lists"

type ListsState = {
  favorites: Set<string>
  wishlist: Set<string>
  authed: boolean | null
  loading: boolean
}

let cached: ListsState | null = null
const listeners = new Set<(state: ListsState) => void>()

function emit(next: ListsState) {
  cached = next
  for (const listener of listeners) listener(next)
}

async function refresh() {
  emit({ ...(cached ?? { favorites: new Set(), wishlist: new Set(), authed: null, loading: true }), loading: true })
  const [favorites, wishlist] = await Promise.all([
    listFavoriteAppids(),
    listWishlistAppids(),
  ])
  const authed = favorites != null && wishlist != null
  emit({
    favorites: favorites ?? new Set(),
    wishlist: wishlist ?? new Set(),
    authed,
    loading: false,
  })
}

/**
 * Tiny pub-sub store for the user's wishlist + favorites sets. Used by the
 * universal context menu so every GameCard knows whether the target is
 * already in either list. Sets are kept in memory only — the source of truth
 * is the API; we just cache for fast O(1) lookups across many cards.
 */
export function useAccountLists() {
  const [state, setState] = useState<ListsState>(
    cached ?? { favorites: new Set(), wishlist: new Set(), authed: null, loading: true }
  )
  const refreshed = useRef(false)

  useEffect(() => {
    const listener = (next: ListsState) => setState(next)
    listeners.add(listener)
    // Only one initial fetch globally — cache is shared across all consumers.
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

  const toggleFavorite = useCallback(async (appid: string, name?: string) => {
    if (!appid) return
    const current = cached?.favorites ?? new Set()
    const has = current.has(appid)
    // Optimistic update
    const optimistic = new Set(current)
    if (has) optimistic.delete(appid)
    else optimistic.add(appid)
    emit({ ...(cached ?? state), favorites: optimistic })
    const ok = has ? await removeFromFavorites(appid) : await addToFavorites(appid, name)
    if (!ok) {
      // Reverse on failure
      const reverted = new Set(optimistic)
      if (has) reverted.add(appid)
      else reverted.delete(appid)
      emit({ ...(cached ?? state), favorites: reverted })
    }
  }, [state])

  const toggleWishlist = useCallback(async (appid: string, name?: string) => {
    if (!appid) return
    const current = cached?.wishlist ?? new Set()
    const has = current.has(appid)
    const optimistic = new Set(current)
    if (has) optimistic.delete(appid)
    else optimistic.add(appid)
    emit({ ...(cached ?? state), wishlist: optimistic })
    const ok = has ? await removeFromWishlist(appid) : await addToWishlist(appid, name)
    if (!ok) {
      const reverted = new Set(optimistic)
      if (has) reverted.add(appid)
      else reverted.delete(appid)
      emit({ ...(cached ?? state), wishlist: reverted })
    }
  }, [state])

  return {
    favorites: state.favorites,
    wishlist: state.wishlist,
    authed: state.authed,
    loading: state.loading,
    toggleFavorite,
    toggleWishlist,
    refresh: () => void refresh(),
  }
}
