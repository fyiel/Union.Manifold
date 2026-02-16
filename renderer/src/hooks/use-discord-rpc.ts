import { useEffect, useMemo, useRef, useState } from "react"
import { useLocation } from "react-router-dom"
import { useDownloads } from "@/context/downloads-context"

const ACTIVE_STATUSES = new Set(["downloading", "extracting", "installing"])
const WEB_BASE_URL = "https://union-crax.xyz"
const DIRECT_URL = `${WEB_BASE_URL}/direct`

const DOWNLOAD_BUTTON = { label: "Download UC.D", url: DIRECT_URL }

function isGameNSFW(genres: string[] | undefined): boolean {
  if (!Array.isArray(genres)) return false
  return genres.some((genre) => String(genre).toLowerCase() === "nsfw")
}

function getGameGenres(appid: string): string[] | null {
  if (!appid) return null
  try {
    const raw = localStorage.getItem(`uc_game_genres:${appid}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
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
  if (!appid) return null
  try {
    const raw = localStorage.getItem(`uc_game_name:${appid}`)
    return raw || null
  } catch {
    return null
  }
}

function getDownloadName(appid: string, downloads: Array<{ appid: string; gameName?: string | null }>) {
  if (!appid) return null
  const match = downloads.find((item) => item.appid === appid && item.gameName)
  return match?.gameName || null
}

function getOpenOnWebUrl(pathname: string) {
  if (pathname.startsWith("/search")) return `${WEB_BASE_URL}/search`
  if (pathname.startsWith("/library")) return `${WEB_BASE_URL}/`
  if (pathname.startsWith("/downloads")) return `${WEB_BASE_URL}/direct`
  if (pathname.startsWith("/settings")) return `${WEB_BASE_URL}/settings`
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
  if (pathname.startsWith("/search")) {
    return {
      details: showStatus ? "Browsing search" : "UnionCrax.Direct",
      state: showStatus ? "Looking for games" : undefined,
      buttons: buildButtons(getOpenOnWebUrl(pathname))
    }
  }
  if (pathname.startsWith("/library")) {
    return {
      details: showStatus ? "Viewing library" : "UnionCrax.Direct",
      state: showStatus ? "Checking installed games" : undefined,
      buttons: buildButtons(getOpenOnWebUrl(pathname))
    }
  }
  if (pathname.startsWith("/downloads")) {
    return {
      details: showStatus ? "Managing downloads" : "UnionCrax.Direct",
      state: showStatus ? "Downloads" : undefined,
      buttons: buildButtons(getOpenOnWebUrl(pathname))
    }
  }
  if (pathname.startsWith("/settings")) {
    return {
      details: showStatus ? "Adjusting settings" : "UnionCrax.Direct",
      state: showStatus ? "Configuring app" : undefined,
      buttons: buildButtons(getOpenOnWebUrl(pathname))
    }
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
      buttons: buildButtons(getOpenOnWebUrl(pathname))
    }
  }
  return {
    details: showStatus ? "On launcher" : "UnionCrax.Direct",
    state: showStatus ? "Home" : undefined,
    buttons: buildButtons(getOpenOnWebUrl(pathname))
  }
}

export function useDiscordRpcPresence() {
  const location = useLocation()
  const { downloads } = useDownloads()
  const [enabled, setEnabled] = useState(true)
  const [rpcHideNsfw, setRpcHideNsfw] = useState(true)
  const [rpcShowGameName, setRpcShowGameName] = useState(true)
  const [rpcShowStatus, setRpcShowStatus] = useState(true)
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
        const showStatus = await window.ucSettings?.get?.("rpcShowStatus")
        const showButtons = await window.ucSettings?.get?.("rpcShowButtons")
        if (!mounted) return
        setEnabled(nextEnabled !== false)
        setRpcHideNsfw(hideNsfw !== false)
        setRpcShowGameName(showGameName !== false)
        setRpcShowStatus(showStatus !== false)
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
        setRpcShowStatus(true)
        setRpcShowButtons(true)
        return
      }
      if (data.key === "discordRpcEnabled") setEnabled(data.value !== false)
      if (data.key === "rpcHideNsfw") setRpcHideNsfw(data.value !== false)
      if (data.key === "rpcShowGameName") setRpcShowGameName(data.value !== false)
      if (data.key === "rpcShowStatus") setRpcShowStatus(data.value !== false)
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
      nameOverridesRef.current.set(detail.appid, detail.name)
      // Store genres for NSFW detection
      if (detail.genres) {
        try {
          localStorage.setItem(`uc_game_genres:${detail.appid}`, JSON.stringify(detail.genres))
        } catch {}
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
      
      const details = rpcShowStatus 
        ? `${formatStatus(activeDownload.status)} ${title}`
        : title
      
      const state = rpcShowStatus
        ? (activeDownload.status === "downloading" && activeDownload.etaSeconds
          ? `ETA ${Math.ceil(activeDownload.etaSeconds / 60)}m • ${progress ?? 0}%`
          : progress !== null ? `${progress}%` : formatStatus(activeDownload.status))
        : (progress !== null ? `${progress}%` : undefined)
      
      return {
        details,
        state
      }
    }
    const queuedCount = downloads.filter((item) => item.status === "queued").length
    if (queuedCount > 0) {
      return { 
        details: rpcShowStatus ? "Queued downloads" : "Downloads", 
        state: rpcShowStatus ? `${queuedCount} queued` : undefined
      }
    }
    
    // Check if currently viewing an NSFW game
    if (rpcHideNsfw && location.pathname.startsWith("/game/")) {
      const appid = location.pathname.replace("/game/", "")
      const genres = getGameGenres(appid)
      if (isGameNSFW(genres || undefined)) {
        // Return masked activity for NSFW game
        return buildRouteActivity(location.pathname, downloads, nameOverridesRef.current, false, rpcShowStatus, true)
      }
    }
    
    return buildRouteActivity(location.pathname, downloads, nameOverridesRef.current, rpcShowGameName, rpcShowStatus, false)
  }, [downloads, location.pathname, nameTick, rpcShowGameName, rpcShowStatus, rpcHideNsfw])

  useEffect(() => {
    if (!window.ucRpc?.setActivity) return
    if (!enabled) {
      window.ucRpc.clearActivity?.()
      return
    }

    const nextKey = `${activity.details || ""}|${activity.state || ""}`
    if (lastActivityKeyRef.current !== nextKey) {
      lastActivityKeyRef.current = nextKey
    }

    const defaultButtons = buildButtons(getOpenOnWebUrl(location.pathname))
    const customButtons = "buttons" in activity ? activity.buttons : undefined
    const buttons = rpcShowButtons 
      ? (customButtons && customButtons.length > 0 ? ensureDownloadButton(customButtons) : defaultButtons)
      : undefined

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
