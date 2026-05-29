import { useEffect, useMemo, useRef, useState } from "react"
import { useLocation } from "react-router-dom"
import { useDownloads } from "@/context/downloads-context"
import {
  recallGameGenres,
  recallGameName,
  rememberGameGenres,
} from "@/lib/rpc-game-cache"

const ACTIVE_STATUSES = new Set(["downloading", "extracting", "installing", "verifying", "retrying"])
const WEB_BASE_URL = "https://union-crax.xyz"
const DIRECT_URL = `${WEB_BASE_URL}/direct`

const DOWNLOAD_BUTTON = { label: "Download UC.D", url: DIRECT_URL }

function isGameNSFW(genres: string[] | undefined): boolean {
  if (!Array.isArray(genres)) return false
  return genres.some((genre) => String(genre).toLowerCase() === "nsfw")
}

function getGameGenres(appid: string): string[] | null {
  // Reads through the bounded LRU cache (lib/rpc-game-cache.ts) — previously
  // this hit a `uc_game_genres:<appid>` key per game which grew unbounded.
  return recallGameGenres(appid)
}

function formatStatus(status: string) {
  switch (status) {
    case "downloading":
      return "Downloading"
    case "extracting":
      return "Extracting"
    case "installing":
      return "Installing"
    case "paused":
      return "Paused"
    default:
      return "Working"
  }
}

function getStoredGameName(appid: string) {
  return recallGameName(appid)
}

function getDownloadName(appid: string, downloads: Array<{ appid: string; gameName?: string | null }>) {
  if (!appid) return null
  const match = downloads.find((item) => item.appid === appid && item.gameName)
  return match?.gameName || null
}

function getOpenOnWebUrl(pathname: string) {
  if (pathname.startsWith("/search-history")) return `${WEB_BASE_URL}/search`
  if (pathname.startsWith("/search")) return `${WEB_BASE_URL}/search`
  if (pathname.startsWith("/library")) return `${WEB_BASE_URL}/`
  if (pathname.startsWith("/downloads")) return `${WEB_BASE_URL}/direct`
  if (pathname.startsWith("/settings")) return `${WEB_BASE_URL}/settings`
  if (pathname.startsWith("/collections/view/")) {
    const id = pathname.replace("/collections/view/", "") || ""
    return id ? `${WEB_BASE_URL}/collection/${encodeURIComponent(id)}` : `${WEB_BASE_URL}/collections`
  }
  if (pathname.startsWith("/collections/browse")) return `${WEB_BASE_URL}/collections`
  if (pathname.startsWith("/collections")) return `${WEB_BASE_URL}/collections`
  if (pathname.startsWith("/wishlist")) return `${WEB_BASE_URL}/wishlist`
  if (pathname.startsWith("/liked")) return `${WEB_BASE_URL}/liked`
  if (pathname.startsWith("/account")) return `${WEB_BASE_URL}/account`
  if (pathname.startsWith("/view-history")) return `${WEB_BASE_URL}/view-history`
  if (pathname.startsWith("/screenshots")) return `${WEB_BASE_URL}/screenshots`
  if (pathname.startsWith("/game/")) {
    const appid = pathname.replace("/game/", "") || ""
    return appid ? `${WEB_BASE_URL}/game/${appid}` : `${WEB_BASE_URL}/`
  }
  return `${WEB_BASE_URL}/`
}

function buildButtons(openUrl: string) {
  return [{ label: "Open on web", url: openUrl }, DOWNLOAD_BUTTON]
}

function ensureDownloadButton(buttons: Array<{ label: string; url: string }>) {
  if (buttons.some((button) => button.label === DOWNLOAD_BUTTON.label)) return buttons
  return [...buttons, DOWNLOAD_BUTTON]
}

function buildRouteActivity(
  pathname: string,
  downloads: Array<{ appid: string; gameName?: string | null }>,
  overrides: Map<string, string>,
  showGameName: boolean = true,
  showStatus: boolean = true,
  maskGameName: boolean = false
) {
  const openOnWeb = getOpenOnWebUrl(pathname)
  const buttons = buildButtons(openOnWeb)
  const present = (details: string, state?: string) => ({
    details: showStatus ? details : "UnionCrax.Direct",
    state: showStatus ? state : undefined,
    buttons,
  })

  if (pathname.startsWith("/search-history")) {
    return present("Search history", "Looking through past searches")
  }
  if (pathname.startsWith("/search")) {
    return present("Browsing search", "Looking for games")
  }
  if (pathname.startsWith("/library")) {
    return present("Viewing library", "Checking installed games")
  }
  if (pathname.startsWith("/downloads")) {
    return present("Activity", "Managing downloads")
  }
  if (pathname.startsWith("/settings")) {
    return present("Adjusting settings", "Configuring UC.Direct")
  }
  if (pathname.startsWith("/collections/view/")) {
    return present("Browsing a collection", "Looking through games")
  }
  if (pathname.startsWith("/collections/browse")) {
    return present("Discovering collections", "Browsing community picks")
  }
  if (pathname.startsWith("/collections")) {
    return present("Viewing collections", "Their curated bundles")
  }
  if (pathname.startsWith("/wishlist")) {
    return present("Browsing wishlist", "Games saved for later")
  }
  if (pathname.startsWith("/liked")) {
    return present("Browsing liked games", "Their hand-picked favourites")
  }
  if (pathname.startsWith("/view-history")) {
    return present("View history", "Revisiting earlier games")
  }
  if (pathname.startsWith("/screenshots")) {
    return present("Browsing screenshots", "Looking at captures")
  }
  if (pathname.startsWith("/account")) {
    return present("On their account", "Profile and stats")
  }
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/verify-email") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password")
  ) {
    // Auth screens — keep the presence vague so we don't leak login state.
    return present("Signing in", undefined)
  }
  if (pathname.startsWith("/game/")) {
    const appid = pathname.replace("/game/", "") || ""
    let name = showGameName ? (overrides.get(appid) || getStoredGameName(appid) || getDownloadName(appid, downloads)) : null
    if (maskGameName) {
      name = "****"
    }
    const details = showStatus
      ? (appid ? `Viewing ${name || "A game"}` : "Viewing game")
      : (name || "UnionCrax.Direct")
    return {
      details,
      state: showStatus ? "Game details" : undefined,
      buttons,
    }
  }
  // /launcher and / both land here.
  return present("On the launcher", "Browsing the catalogue")
}

export function useDiscordRpcPresence() {
  const location = useLocation()
  const { downloads } = useDownloads()
  const [enabled, setEnabled] = useState(true)
  const [rpcHideNsfw, setRpcHideNsfw] = useState(true)
  const [rpcShowGameName, setRpcShowGameName] = useState(true)
  const [rpcShowDownloadStatus, setRpcShowDownloadStatus] = useState(true)
  const [rpcShowBrowseStatus, setRpcShowBrowseStatus] = useState(true)
  const [rpcShowButtons, setRpcShowButtons] = useState(true)
  const [nameTick, setNameTick] = useState(0)
  const nameOverridesRef = useRef<Map<string, string>>(new Map())
  const lastActivityKeyRef = useRef<string>("")

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const nextEnabled = await window.ucSettings?.get?.("discordRpcEnabled")
        const hideNsfw = await window.ucSettings?.get?.("rpcHideNsfw")
        const showGameName = await window.ucSettings?.get?.("rpcShowGameName")
        const showDownloadStatus = await window.ucSettings?.get?.("rpcShowDownloadStatus")
        const showBrowseStatus = await window.ucSettings?.get?.("rpcShowBrowseStatus")
        // Legacy fallback: if the new keys are unset, read the old rpcShowStatus key
        const legacyShowStatus = await window.ucSettings?.get?.("rpcShowStatus")
        const showButtons = await window.ucSettings?.get?.("rpcShowButtons")
        if (!mounted) return
        setEnabled(nextEnabled !== false)
        setRpcHideNsfw(hideNsfw !== false)
        setRpcShowGameName(showGameName !== false)
        // Use new keys if set, otherwise fall back to legacy rpcShowStatus
        setRpcShowDownloadStatus(showDownloadStatus !== undefined ? showDownloadStatus !== false : legacyShowStatus !== false)
        setRpcShowBrowseStatus(showBrowseStatus !== undefined ? showBrowseStatus !== false : legacyShowStatus !== false)
        setRpcShowButtons(showButtons !== false)
      } catch {
        // ignore
      }
    }
    load()
    const off = window.ucSettings?.onChanged?.((data: any) => {
      if (!data) return
      if (data.key === "__CLEAR_ALL__") {
        setEnabled(true)
        setRpcHideNsfw(true)
        setRpcShowGameName(true)
        setRpcShowDownloadStatus(true)
        setRpcShowBrowseStatus(true)
        setRpcShowButtons(true)
        return
      }
      if (data.key === "discordRpcEnabled") setEnabled(data.value !== false)
      if (data.key === "rpcHideNsfw") setRpcHideNsfw(data.value !== false)
      if (data.key === "rpcShowGameName") setRpcShowGameName(data.value !== false)
      if (data.key === "rpcShowDownloadStatus") setRpcShowDownloadStatus(data.value !== false)
      if (data.key === "rpcShowBrowseStatus") setRpcShowBrowseStatus(data.value !== false)
      // Legacy key: sync both new keys when old key changes (e.g. from API preference sync)
      if (data.key === "rpcShowStatus") {
        setRpcShowDownloadStatus(data.value !== false)
        setRpcShowBrowseStatus(data.value !== false)
      }
      if (data.key === "rpcShowButtons") setRpcShowButtons(data.value !== false)
    })
    return () => {
      mounted = false
      if (typeof off === "function") off()
    }
  }, [])

  useEffect(() => {
    const handleName = (event: Event) => {
      const detail = (event as CustomEvent<{ appid?: string; name?: string; genres?: string[] }>).detail
      if (!detail?.appid || !detail?.name) return
      // Bound the in-memory override map (separate from the LRU-capped
      // localStorage cache below) so it can't grow forever during a long
      // browsing session — particularly when navigating /game/:appid many
      // times. ~500 entries is plenty for what the RPC actually consults.
      const map = nameOverridesRef.current
      map.set(detail.appid, detail.name)
      if (map.size > 500) {
        const first = map.keys().next().value
        if (first) map.delete(first)
      }
      // Store genres for NSFW detection (LRU-capped, see rpc-game-cache).
      if (detail.genres) {
        rememberGameGenres(detail.appid, detail.genres)
      }
      setNameTick((prev) => prev + 1)
    }
    window.addEventListener("uc_game_name", handleName)
    return () => window.removeEventListener("uc_game_name", handleName)
  }, [])

  const activity = useMemo(() => {
    const activeDownload = downloads.find((item) => ACTIVE_STATUSES.has(item.status))
    if (activeDownload) {
      // Check if the downloading game is NSFW
      let title = rpcShowGameName ? (activeDownload.gameName || activeDownload.appid || "A game") : "A game"
      if (rpcHideNsfw && activeDownload.appid) {
        const genres = getGameGenres(activeDownload.appid)
        if (isGameNSFW(genres || undefined)) {
          title = "****" // Mask NSFW game name
        }
      }
      
      const progress = activeDownload.totalBytes > 0
        ? Math.min(100, Math.max(0, Math.round((activeDownload.receivedBytes / activeDownload.totalBytes) * 100)))
        : null
      
      const details = rpcShowDownloadStatus
        ? `${formatStatus(activeDownload.status)} ${title}`
        : title
      
      // Only show progress/ETA when download status is enabled
      const state = rpcShowDownloadStatus
        ? (activeDownload.status === "downloading" && activeDownload.etaSeconds
          ? `ETA ${Math.ceil(activeDownload.etaSeconds / 60)}m • ${progress ?? 0}%`
          : progress !== null ? `${progress}%` : formatStatus(activeDownload.status))
        : undefined
      
      return {
        details,
        state
      }
    }
    const queuedCount = downloads.filter((item) => item.status === "queued").length
    if (queuedCount > 0) {
      return {
        details: rpcShowDownloadStatus ? "Queued downloads" : "Downloads",
        state: rpcShowDownloadStatus ? `${queuedCount} queued` : undefined
      }
    }
    
    // Check if currently viewing an NSFW game
    if (rpcHideNsfw && location.pathname.startsWith("/game/")) {
      const appid = location.pathname.replace("/game/", "")
      const genres = getGameGenres(appid)
      if (isGameNSFW(genres || undefined)) {
        // Return masked activity for NSFW game
        return buildRouteActivity(location.pathname, downloads, nameOverridesRef.current, false, rpcShowBrowseStatus, true)
      }
    }
    
    return buildRouteActivity(location.pathname, downloads, nameOverridesRef.current, rpcShowGameName, rpcShowBrowseStatus, false)
  }, [downloads, location.pathname, nameTick, rpcShowGameName, rpcShowDownloadStatus, rpcShowBrowseStatus, rpcHideNsfw])

  useEffect(() => {
    if (!window.ucRpc?.setActivity) return
    if (!enabled) {
      window.ucRpc.clearActivity?.()
      lastActivityKeyRef.current = ""
      return
    }

    const defaultButtons = buildButtons(getOpenOnWebUrl(location.pathname))
    const customButtons = "buttons" in activity ? activity.buttons : undefined
    const buttons = rpcShowButtons
      ? (customButtons && customButtons.length > 0 ? ensureDownloadButton(customButtons) : defaultButtons)
      : undefined

    // Skip the IPC round-trip + Discord call when nothing user-visible has
    // changed. The activity memo can churn (downloads array re-renders,
    // nameTick bump, etc.) without changing what would actually appear on
    // screen, so we compare the serialised payload before pushing.
    const nextKey = JSON.stringify({
      d: activity.details ?? null,
      s: activity.state ?? null,
      b: buttons ? buttons.map((button) => `${button.label}|${button.url}`) : null,
    })
    if (lastActivityKeyRef.current === nextKey) return
    lastActivityKeyRef.current = nextKey

    const payload: any = {
      details: activity.details,
      state: activity.state
    }

    if (buttons) {
      payload.buttons = buttons
    }

    window.ucRpc.setActivity(payload)
  }, [activity, enabled, rpcShowButtons, location.pathname])
}
