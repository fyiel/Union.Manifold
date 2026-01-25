import { useEffect, useMemo, useRef, useState } from "react"
import { useLocation } from "react-router-dom"
import { useDownloads } from "@/context/downloads-context"

const ACTIVE_STATUSES = new Set(["downloading", "extracting", "installing"])
const WEB_BASE_URL = "https://union-crax.xyz"
const DIRECT_URL = `${WEB_BASE_URL}/direct`

const DOWNLOAD_BUTTON = { label: "Download UC.D", url: DIRECT_URL }

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

function buildRouteActivity(pathname: string, downloads: Array<{ appid: string; gameName?: string | null }>, overrides: Map<string, string>) {
  if (pathname.startsWith("/search")) {
    return {
      details: "Browsing search",
      state: "Looking for games",
      buttons: buildButtons(getOpenOnWebUrl(pathname))
    }
  }
  if (pathname.startsWith("/library")) {
    return {
      details: "Viewing library",
      state: "Checking installed games",
      buttons: buildButtons(getOpenOnWebUrl(pathname))
    }
  }
  if (pathname.startsWith("/downloads")) {
    return {
      details: "Managing downloads",
      state: "Downloads",
      buttons: buildButtons(getOpenOnWebUrl(pathname))
    }
  }
  if (pathname.startsWith("/settings")) {
    return {
      details: "Adjusting settings",
      state: "Configuring app",
      buttons: buildButtons(getOpenOnWebUrl(pathname))
    }
  }
  if (pathname.startsWith("/game/")) {
    const appid = pathname.replace("/game/", "") || ""
    const name = overrides.get(appid) || getStoredGameName(appid) || getDownloadName(appid, downloads)
    const details = appid ? `Viewing ${name || appid}` : "Viewing game"
    return {
      details,
      state: "Game details",
      buttons: buildButtons(getOpenOnWebUrl(pathname))
    }
  }
  return {
    details: "On launcher",
    state: "Home",
    buttons: buildButtons(getOpenOnWebUrl(pathname))
  }
}

export function useDiscordRpcPresence() {
  const location = useLocation()
  const { downloads } = useDownloads()
  const [enabled, setEnabled] = useState(true)
  const [nameTick, setNameTick] = useState(0)
  const nameOverridesRef = useRef<Map<string, string>>(new Map())
  const lastActivityKeyRef = useRef<string>("")
  const startTimestampRef = useRef<number>(Math.floor(Date.now() / 1000))

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const nextEnabled = await window.ucSettings?.get?.("discordRpcEnabled")
        if (!mounted) return
        setEnabled(nextEnabled !== false)
      } catch {
        // ignore
      }
    }
    load()
    const off = window.ucSettings?.onChanged?.((data: any) => {
      if (!data) return
      if (data.key === "__CLEAR_ALL__") {
        setEnabled(true)
        return
      }
      if (data.key === "discordRpcEnabled") setEnabled(data.value !== false)
    })
    return () => {
      mounted = false
      if (typeof off === "function") off()
    }
  }, [])

  useEffect(() => {
    const handleName = (event: Event) => {
      const detail = (event as CustomEvent<{ appid?: string; name?: string }>).detail
      if (!detail?.appid || !detail?.name) return
      nameOverridesRef.current.set(detail.appid, detail.name)
      setNameTick((prev) => prev + 1)
    }
    window.addEventListener("uc_game_name", handleName)
    return () => window.removeEventListener("uc_game_name", handleName)
  }, [])

  const activity = useMemo(() => {
    const activeDownload = downloads.find((item) => ACTIVE_STATUSES.has(item.status))
    if (activeDownload) {
      const title = activeDownload.gameName || activeDownload.appid || "Game"
      const progress = activeDownload.totalBytes > 0
        ? Math.min(100, Math.max(0, Math.round((activeDownload.receivedBytes / activeDownload.totalBytes) * 100)))
        : null
      return {
        details: `${formatStatus(activeDownload.status)} ${title}`,
        state: activeDownload.status === "downloading" && activeDownload.etaSeconds
          ? `ETA ${Math.ceil(activeDownload.etaSeconds / 60)}m • ${progress ?? 0}%`
          : progress !== null ? `${progress}%` : formatStatus(activeDownload.status)
      }
    }
    const queuedCount = downloads.filter((item) => item.status === "queued").length
    if (queuedCount > 0) {
      return { details: "Queued downloads", state: `${queuedCount} queued` }
    }
    return buildRouteActivity(location.pathname, downloads, nameOverridesRef.current)
  }, [downloads, location.pathname, nameTick])

  useEffect(() => {
    if (!window.ucRpc?.setActivity) return
    if (!enabled) {
      window.ucRpc.clearActivity?.()
      return
    }

    const nextKey = `${activity.details || ""}|${activity.state || ""}`
    if (lastActivityKeyRef.current !== nextKey) {
      lastActivityKeyRef.current = nextKey
      startTimestampRef.current = Math.floor(Date.now() / 1000)
    }

    const defaultButtons = buildButtons(getOpenOnWebUrl(location.pathname))
    const customButtons = "buttons" in activity ? activity.buttons : undefined
    const buttons = customButtons && customButtons.length > 0 ? ensureDownloadButton(customButtons) : defaultButtons

    window.ucRpc.setActivity({
      details: activity.details,
      state: activity.state,
      startTimestamp: startTimestampRef.current,
      buttons
    })
  }, [activity, enabled])
}
