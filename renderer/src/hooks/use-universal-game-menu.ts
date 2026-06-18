import { useCallback, useMemo } from "react"
import type { Game } from "@/lib/types"
import { useAccountLists } from "@/hooks/use-account-lists"
import { useRpcGameMute } from "@/hooks/use-rpc-game-mute"
import { useDownloads } from "@/context/downloads-context"
import { useDownloadFlow } from "@/context/download-flow-context"
import { useUserCollections } from "@/hooks/use-user-collections"
import type { CollectionPickerEntry } from "@/components/GameActionMenu"

/**
 * Page-specific overrides — anything the consuming surface uniquely knows
 * about and wants to plug into the otherwise-universal menu. Library
 * supplies the delete handler that hits the IPC; GameCard leaves it null
 * because right-clicking from the catalog should never wipe install files.
 */
export type UniversalMenuOverrides = {
  /** Open the game's install folder. Surfaces that aren't installed-aware
   *  should leave this out and the menu will hide the row. */
  onOpenFiles?: (() => void | Promise<void>) | null
  /** Open the executable picker for the installed game. */
  onSetExecutable?: (() => void | Promise<void>) | null
  /** Create a desktop shortcut for the installed game. */
  onCreateShortcut?: (() => void | Promise<void>) | null
  /** Open the Edit Details modal (external-only games). */
  onEditDetails?: () => void | Promise<void>
  /** Open the Linux / VR config modal. */
  onLinuxConfig?: () => void | Promise<void>
  /** Delete / Unlink the installed game. */
  onDelete?: (() => void | Promise<void>) | null
  /** Surface this is rendered on. Drives small details like whether to expose
   *  the "Download" entry at all (e.g. SearchSuggestions doesn't have access
   *  to enough context to start a download cleanly — pass `false`). */
  downloadable?: boolean
}

/**
 * One hook to rule them all — every surface that renders the universal
 * context menu (GameCard, GameCardCompact, LibraryPage, GameDetailPage,
 * etc.) feeds its `Game` through this and gets back a complete set of
 * props for `<GameActionMenuPanel />` / `<GameActionContextMenu />`. This
 * way the menu always offers the same actions in the same order, and we
 * can add a new action by editing exactly one file.
 *
 * The hook also gates each action on whether it's actually doable for the
 * target game (e.g. "Open Files" only when installed; "Download" only when
 * not installed and not already downloading; "Hide from Discord" only when
 * we have an appid to write the setting against). Page-specific actions
 * like Delete come in via `overrides`.
 */
export function useUniversalGameMenuProps(
  game: Pick<Game, "appid" | "name" | "source" | "isExternal"> | null | undefined,
  overrides: UniversalMenuOverrides = {}
) {
  const appid = game?.appid || ""
  const accountLists = useAccountLists()
  const rpcMute = useRpcGameMute(appid || null)
  const userCollections = useUserCollections()
  const { downloads } = useDownloads()
  const { requestDownload } = useDownloadFlow()

  // Treat any in-flight, paused, or queued download for this appid as
  // "already downloading" — the menu offers "Add to queue" in that case
  // so a duplicate-start doesn't accidentally cancel/restart the existing
  // job. Failed / completed states aren't here; the action card / detail
  // page handles retry separately.
  const activeAppidDownloads = useMemo(() => {
    // Every non-terminal state — anything that means "a download/install for
    // this game is already in flight". Keep this list in sync with the
    // DownloadStatus union; missing one here caused the menu to show
    // "Download" (or the old "Add to queue") mid-download.
    return downloads.filter((item) => item.appid === appid && [
      "queued", "downloading", "paused", "extracting", "installing", "verifying", "retrying", "install_ready"
    ].includes(item.status))
  }, [downloads, appid])

  const hasActiveDownload = activeAppidDownloads.length > 0

  const downloadAction = useMemo(() => {
    if (!appid || overrides.downloadable === false) return undefined
    // Only offer the row when we have a real catalog Game object — external
    // / locally-added games can't be re-downloaded from the catalog.
    if (game?.isExternal) return undefined
    return {
      // While a download is in flight the row is disabled ("Downloading…")
      // rather than offering a no-op "Add to queue" / "Download".
      mode: hasActiveDownload ? "active" as const : "download" as const,
      onClick: () => {
        if (hasActiveDownload) return
        // Start the download in place via the app-wide flow: it queues
        // immediately when the user's downloadCheckMode is "skip" (true
        // one-click add-to-queue) or pops the check modal as an overlay for
        // "auto" / "always". No navigation — right-clicking a card and hitting
        // Download no longer yanks the user onto the game page.
        void requestDownload(game as Game)
      },
    }
  }, [appid, game, hasActiveDownload, overrides.downloadable, requestDownload])

  const wishlist = useMemo(() => {
    if (accountLists.authed === false || !appid) return undefined
    return {
      inList: accountLists.wishlist.has(appid),
      toggle: () => { void accountLists.toggleWishlist(appid, game?.name) },
    }
  }, [accountLists, appid, game?.name])

  const favorites = useMemo(() => {
    if (accountLists.authed === false || !appid) return undefined
    return {
      inList: accountLists.favorites.has(appid),
      toggle: () => { void accountLists.toggleFavorite(appid, game?.name) },
    }
  }, [accountLists, appid, game?.name])

  const rpcMuteProp = useMemo(() => {
    if (!appid) return undefined
    return {
      muted: rpcMute.muted,
      toggle: () => { void rpcMute.toggle() },
    }
  }, [appid, rpcMute])

  const collectionPicker = useMemo(() => {
    if (!appid) return undefined
    return {
      collections: userCollections.collections.map<CollectionPickerEntry>((c) => ({
        id: c.id,
        name: c.name,
        included: c.appids.includes(appid),
      })),
      onAddToCollection: async (collectionId: string) => {
        const target = userCollections.collections.find((c) => c.id === collectionId)
        if (!target || target.appids.includes(appid)) return
        await userCollections.setMembership(target, [...target.appids, appid])
      },
      onRemoveFromCollection: async (collectionId: string) => {
        const target = userCollections.collections.find((c) => c.id === collectionId)
        if (!target) return
        await userCollections.setMembership(target, target.appids.filter((id) => id !== appid))
      },
      onCreateCollection: async (name: string) => {
        await userCollections.create(name, [appid])
      },
    }
  }, [appid, userCollections])

  return {
    gameName: game?.name || "Game",
    gameSource: game?.source,
    isExternal: Boolean(game?.isExternal),
    download: downloadAction,
    onOpenFiles: overrides.onOpenFiles ?? null,
    onSetExecutable: overrides.onSetExecutable ?? null,
    onCreateShortcut: overrides.onCreateShortcut ?? null,
    onEditDetails: overrides.onEditDetails,
    onLinuxConfig: overrides.onLinuxConfig,
    onDelete: overrides.onDelete ?? null,
    wishlist,
    favorites,
    rpcMute: rpcMuteProp,
    collectionPicker,
  }
}

/**
 * Convenience: stable callback for closing the menu after a click on any
 * action. Surfaces that need to dismiss popovers / context menus can wrap
 * their handler with this.
 */
export function useDismissingHandler(
  dismiss: () => void
): <T extends (...args: any[]) => any>(handler: T) => T {
  return useCallback(<T extends (...args: any[]) => any>(handler: T) => {
    return ((...args: any[]) => {
      try { dismiss() } catch { /* ignore */ }
      return handler(...args)
    }) as T
  }, [dismiss])
}
