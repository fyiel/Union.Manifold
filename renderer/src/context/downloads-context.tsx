import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import type { Game } from "@/lib/types"
import {
  fetchDownloadLinks,
  inferFilenameFromUrl,
  getPreferredDownloadHost,
  isRootzUrl,
  requestDownloadToken,
  resolveDownloadUrl,
  selectHost,
} from "@/lib/downloads"
import { addDownloadedGameToHistory, hasCookieConsent } from "@/lib/user-history"

export type DownloadStatus = "queued" | "downloading" | "paused" | "completed" | "failed" | "cancelled"

export type DownloadItem = {
  id: string
  appid: string
  gameName: string
  host: string
  url: string
  filename: string
  status: DownloadStatus
  receivedBytes: number
  totalBytes: number
  speedBps: number
  etaSeconds: number | null
  savePath?: string
  startedAt: number
  completedAt?: number
  error?: string | null
}

type DownloadUpdate = {
  downloadId: string
  status: DownloadStatus
  receivedBytes?: number
  totalBytes?: number
  speedBps?: number
  etaSeconds?: number | null
  filename?: string
  savePath?: string
  appid?: string | null
  gameName?: string | null
  url?: string
  error?: string | null
}

type DownloadsContextValue = {
  downloads: DownloadItem[]
  startGameDownload: (game: Game) => Promise<void>
  cancelDownload: (downloadId: string) => Promise<void>
  showInFolder: (path: string) => Promise<void>
  openPath: (path: string) => Promise<void>
  clearCompleted: () => void
}

const DownloadsContext = createContext<DownloadsContextValue | null>(null)
const STORAGE_KEY = "uc_direct_downloads"

function safeGameFilename(name: string) {
  return (
    name
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "unioncrax-download"
  )
}

export function DownloadsProvider({ children }: { children: React.ReactNode }) {
  const [downloads, setDownloads] = useState<DownloadItem[]>(() => {
    if (typeof window === "undefined") return []
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw) as DownloadItem[]
      return parsed.map((item) =>
        item.status === "downloading" || item.status === "queued"
          ? { ...item, status: "failed", error: "App restarted" }
          : item
      )
    } catch {
      return []
    }
  })

  useEffect(() => {
    if (typeof window === "undefined") return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(downloads))
  }, [downloads])

  // Installed metadata is stored by the main process as a file inside the installed folder.

  useEffect(() => {
    if (!window.ucDownloads?.onUpdate) return
    return window.ucDownloads.onUpdate((update: DownloadUpdate) => {
      setDownloads((prev) => {
        const idx = prev.findIndex((item) => item.id === update.downloadId)
        if (idx === -1) return prev
        const existing = prev[idx]
        const next: DownloadItem = {
          ...existing,
          status: update.status || existing.status,
          receivedBytes: update.receivedBytes ?? existing.receivedBytes,
          totalBytes: update.totalBytes ?? existing.totalBytes,
          speedBps: update.speedBps ?? existing.speedBps,
          etaSeconds: update.etaSeconds ?? existing.etaSeconds,
          filename: update.filename ?? existing.filename,
          savePath: update.savePath ?? existing.savePath,
          url: update.url ?? existing.url,
          error: update.error ?? existing.error,
          completedAt:
            update.status === "completed" || update.status === "failed" || update.status === "cancelled"
              ? Date.now()
              : existing.completedAt,
        }
        const clone = [...prev]
        clone[idx] = next
        return clone
      })
    })
  }, [])

  // The main process writes installed manifests; renderer can call `window.ucDownloads.listInstalled()` when needed.

  const startGameDownload = useCallback(async (game: Game) => {
    // save initial metadata to installing folder so it's available offline even before completion
    try {
      if (window.ucDownloads?.saveInstalledMetadata) {
        // pass the full game object as metadata
        await window.ucDownloads.saveInstalledMetadata(game.appid, game)
      }
    } catch (err) {
      // ignore IPC failures
    }

    const downloadToken = await requestDownloadToken(game.appid)
    if (hasCookieConsent()) {
      addDownloadedGameToHistory(game.appid)
    }

    const linksResult = await fetchDownloadLinks(game.appid, downloadToken)

    let links: string[] = []
    let selectedHost = "rootz"

    if (linksResult.redirectUrl) {
      if (!isRootzUrl(linksResult.redirectUrl)) {
        throw new Error("This title does not have Rootz downloads yet.")
      }
      links = [linksResult.redirectUrl]
    } else {
      const preferredHost = await getPreferredDownloadHost()
      const selected = selectHost(linksResult.hosts, preferredHost)
      links = selected.links
      selectedHost = selected.host || "rootz"
    }

    if (!links.length) {
      throw new Error("No Rootz download links are available for this title.")
    }

    const baseName = safeGameFilename(game.name)
    const host = selectedHost
    const resolvedLinks = await Promise.all(links.map(async (link) => resolveDownloadUrl(host, link)))
    // If host is rootz we need all links to be resolved via the Rootz API; for other hosts
    // be more permissive and only skip entries that have no usable URL.
    const unresolved = resolvedLinks.find((entry) => !entry || !entry.url)
    if (unresolved && host === 'rootz') {
      throw new Error("Unable to resolve Rootz download links. Check your Rootz API settings.")
    }
    // Filter out any completely unusable entries (no `url`). Keep entries even if `resolved` is false.
    const usableLinks = resolvedLinks.filter((entry) => entry && entry.url).map((e) => e as any)
    if (!usableLinks.length) {
      throw new Error("No usable download links are available for this title.")
    }

    for (let index = 0; index < usableLinks.length; index++) {
      const resolved = usableLinks[index]
      const filename =
        resolved.filename ||
        inferFilenameFromUrl(
          resolved.url,
          `${baseName}${resolvedLinks.length > 1 ? `-part${index + 1}` : ""}`
        )
      const downloadId = `${game.appid}-${Date.now()}-${index}`

      const newItem: DownloadItem = {
        id: downloadId,
        appid: game.appid,
        gameName: game.name,
        host,
        url: resolved.url,
        filename,
        status: "queued",
        receivedBytes: 0,
        totalBytes: resolved.size || 0,
        speedBps: 0,
        etaSeconds: null,
        startedAt: Date.now(),
      }

      setDownloads((prev) => [newItem, ...prev])

      if (window.ucDownloads?.start) {
        try {
          await window.ucDownloads.start({
            downloadId,
            url: resolved.url,
            filename,
            appid: game.appid,
            gameName: game.name,
          })
        } catch (err) {
          setDownloads((prev) =>
            prev.map((item) =>
              item.id === downloadId ? { ...item, status: "failed", error: "Failed to start download" } : item
            )
          )
        }
      } else {
        setDownloads((prev) =>
          prev.map((item) =>
            item.id === downloadId ? { ...item, status: "failed", error: "Downloads unavailable" } : item
          )
        )
      }
    }
  }, [])

  const cancelDownload = useCallback(async (downloadId: string) => {
    if (window.ucDownloads?.cancel) {
      await window.ucDownloads.cancel(downloadId)
    }
  }, [])

  const showInFolder = useCallback(async (path: string) => {
    if (window.ucDownloads?.showInFolder) {
      await window.ucDownloads.showInFolder(path)
    }
  }, [])

  const openPath = useCallback(async (path: string) => {
    if (window.ucDownloads?.openPath) {
      await window.ucDownloads.openPath(path)
    }
  }, [])

  const clearCompleted = useCallback(() => {
    setDownloads((prev) =>
      prev.filter((item) => item.status !== "completed" && item.status !== "failed" && item.status !== "cancelled")
    )
  }, [])

  const value = useMemo(
    () => ({ downloads, startGameDownload, cancelDownload, showInFolder, openPath, clearCompleted }),
    [downloads, startGameDownload, cancelDownload, showInFolder, openPath, clearCompleted]
  )

  return <DownloadsContext.Provider value={value}>{children}</DownloadsContext.Provider>
}

export function useDownloads() {
  const context = useContext(DownloadsContext)
  if (!context) {
    throw new Error("useDownloads must be used within DownloadsProvider")
  }
  return context
}
