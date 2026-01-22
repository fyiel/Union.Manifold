import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import type { Game } from "@/lib/types"
import {
  fetchDownloadLinks,
  inferFilenameFromUrl,
  getPreferredDownloadHost,
  isPixeldrainUrl,
  isRootzUrl,
  requestDownloadToken,
  resolveDownloadUrl,
  resolveDownloadSize,
  selectHost,
} from "@/lib/downloads"
import { addDownloadedGameToHistory, hasCookieConsent } from "@/lib/user-history"
import { downloadLogger } from "@/lib/logger"

export type DownloadStatus =
  | "queued"
  | "downloading"
  | "paused"
  | "extracting"
  | "installing"
  | "completed"
  | "extracted"
  | "extract_failed"
  | "failed"
  | "cancelled"

export type DownloadItem = {
  id: string
  appid: string
  gameName: string
  host: string
  url: string
  filename: string
  partIndex?: number
  partTotal?: number
  status: DownloadStatus
  receivedBytes: number
  totalBytes: number
  speedBps: number
  etaSeconds: number | null
  savePath?: string
  resumeData?: {
    urlChain?: string[]
    mimeType?: string
    etag?: string
    lastModified?: string
    startTime?: number
    offset?: number
    totalBytes?: number
    savePath?: string
  }
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
  partIndex?: number
  partTotal?: number
  resumeData?: DownloadItem["resumeData"]
}

type DownloadsContextValue = {
  downloads: DownloadItem[]
  startGameDownload: (game: Game) => Promise<void>
  cancelDownload: (downloadId: string) => Promise<void>
  cancelGroup: (appid: string) => Promise<void>
  pauseDownload: (downloadId: string) => Promise<void>
  resumeDownload: (downloadId: string) => Promise<void>
  resumeGroup: (appid: string) => Promise<void>
  showInFolder: (path: string) => Promise<void>
  openPath: (path: string) => Promise<void>
  removeDownload: (downloadId: string) => void
  clearByAppid: (appid: string) => void
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

function parsePartIndexFromFilename(filename: string) {
  const lower = filename.toLowerCase()
  const partMatch = lower.match(/part\s*([0-9]{1,3})/)
  const extMatch = lower.match(/\.([0-9]{3})$/)
  if (partMatch?.[1]) return Number(partMatch[1])
  if (extMatch?.[1]) return Number(extMatch[1])
  return null
}

export function DownloadsProvider({ children }: { children: React.ReactNode }) {
  const [downloads, setDownloads] = useState<DownloadItem[]>(() => {
    if (typeof window === "undefined") return []
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw) as DownloadItem[]
        // Remove any stored mock/demo/sample entries that were added during development.
        // This will permanently purge them from `localStorage` on startup.
        const mockFilterRegex = /mock installed|mock|demo|example|placeholder|test-download|fake|sample/i
        const filtered = parsed.filter((item) => {
          const combined = `${item.appid || ''} ${item.url || ''} ${item.filename || ''} ${item.gameName || ''} ${item.host || ''}`
          return !mockFilterRegex.test(combined)
        })

        // If we removed items, persist the cleaned array back to localStorage to fully remove them.
        if (filtered.length !== parsed.length) {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered))
          } catch {}
        }

        return filtered.map((item) =>
          item.status === "downloading" || item.status === "extracting" || item.status === "installing"
            ? { ...item, status: "paused", error: "App restarted" }
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

  const downloadsRef = useRef(downloads)
  useEffect(() => {
    downloadsRef.current = downloads
  }, [downloads])
  const preparingRef = useRef(new Set<string>())
  const sequenceLocksRef = useRef(new Set<string>())

  // Installed metadata is stored by the main process as a file inside the installed folder.

  const resolveWithTimeout = useCallback(async (host: string, targetUrl: string) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12000)
    try {
      const resolved = await resolveDownloadUrl(host, targetUrl)
      clearTimeout(timeout)
      return resolved
    } catch (err) {
      clearTimeout(timeout)
      throw err
    }
  }, [])

  const prefetchPartSizes = useCallback(
    async (host: string, queue: Array<{ id: string; url: string }>) => {
      if (!queue.length) return
      const batchSize = 3
      const applySizes = (sizeMap: Map<string, number>) => {
        if (sizeMap.size === 0) return
        setDownloads((prev) =>
          prev.map((item) => {
            const nextSize = sizeMap.get(item.id)
            if (!nextSize) return item
            if (item.totalBytes && item.totalBytes > 0) return item
            return { ...item, totalBytes: nextSize }
          })
        )
      }
      const fetchSizes = async (items: Array<{ id: string; url: string }>) => {
        const sizeMap = new Map<string, number>()
        for (let i = 0; i < items.length; i += batchSize) {
          const batch = items.slice(i, i + batchSize)
          await Promise.all(
            batch.map(async (entry) => {
              try {
                const size = await resolveDownloadSize(host, entry.url)
                if (size && size > 0) {
                  sizeMap.set(entry.id, size)
                }
              } catch {
                // best effort only
              }
            })
          )
          if (host === "rootz") {
            await new Promise((resolve) => setTimeout(resolve, 500))
          }
        }
        return sizeMap
      }

      if (host === "rootz") {
        setTimeout(() => {
          void (async () => {
            const [first, ...rest] = queue
            if (first) {
              const firstMap = await fetchSizes([first])
              applySizes(firstMap)
            }
            if (rest.length) {
              const restMap = await fetchSizes(rest)
              applySizes(restMap)
            }
          })()
        }, 500)
        return
      }

      const sizeMap = await fetchSizes(queue)
      applySizes(sizeMap)
    },
    []
  )

  const startNextQueuedPart = useCallback(
    async () => {
      if (sequenceLocksRef.current.size > 0) return
      const hasActive = downloadsRef.current.some((item) =>
        ["downloading", "paused", "extracting", "installing"].includes(item.status)
      )
      if (hasActive) return

      const queued = downloadsRef.current
        .filter((item) => item.status === "queued")
        .sort((a, b) => {
          if (a.startedAt !== b.startedAt) return a.startedAt - b.startedAt
          const aKey = a.partIndex ?? 0
          const bKey = b.partIndex ?? 0
          return aKey - bKey
        })
      if (!queued.length) return
      const next = queued[0]
      sequenceLocksRef.current.add(next.appid)

      try {
        const resolved = await resolveWithTimeout(next.host, next.url)
        if (!resolved || !resolved.url || (next.host === "rootz" && !resolved.resolved)) {
          setDownloads((prev) =>
            prev.map((item) =>
              item.id === next.id
                ? { ...item, status: "failed", error: "Rootz link could not be resolved." }
                : item
            )
          )
          if (next.appid) {
            await window.ucDownloads?.setInstallingStatus?.(next.appid, "failed", "Rootz link could not be resolved.")
          }
          return
        }

        const filename = resolved.filename || next.filename
        setDownloads((prev) =>
          prev.map((item) =>
            item.id === next.id
              ? { ...item, url: resolved.url, filename, totalBytes: resolved.size || 0, error: null }
              : item
          )
        )

        if (!window.ucDownloads?.start) {
          setDownloads((prev) =>
            prev.map((item) =>
              item.id === next.id ? { ...item, status: "failed", error: "Downloads unavailable" } : item
            )
          )
          if (next.appid) {
            await window.ucDownloads?.setInstallingStatus?.(next.appid, "failed", "Downloads unavailable")
          }
          return
        }

        const res = await window.ucDownloads.start({
          downloadId: next.id,
          url: resolved.url,
          filename,
          appid: next.appid,
          gameName: next.gameName,
          partIndex: next.partIndex,
          partTotal: next.partTotal,
        })
        if (res && typeof res === "object" && "ok" in res && !res.ok) {
          throw new Error((res as { error?: string }).error || "Failed to start download")
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to start download"
        setDownloads((prev) =>
          prev.map((item) =>
            item.id === next.id ? { ...item, status: "failed", error: message } : item
          )
        )
        if (next.appid) {
          await window.ucDownloads?.setInstallingStatus?.(next.appid, "failed", message)
        }
      } finally {
        sequenceLocksRef.current.delete(next.appid)
      }
    },
    [resolveWithTimeout]
  )

  useEffect(() => {
    if (!window.ucDownloads?.onUpdate) return
    return window.ucDownloads.onUpdate((update: DownloadUpdate) => {
      let nextDownloads: DownloadItem[] | null = null
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
          partIndex: update.partIndex ?? existing.partIndex,
          partTotal: update.partTotal ?? existing.partTotal,
          resumeData: update.resumeData ?? existing.resumeData,
          completedAt:
            update.status === "completed" ||
            update.status === "failed" ||
            update.status === "cancelled" ||
            update.status === "extracted" ||
            update.status === "extract_failed"
              ? Date.now()
              : existing.completedAt,
        }
        const clone = [...prev]
        clone[idx] = next
        nextDownloads = clone
        downloadsRef.current = clone
        return clone
      })
      if (update.status === "completed" || update.status === "extracted") {
        queueMicrotask(() => {
          void startNextQueuedPart()
        })
        // Dispatch event so launcher page knows to refresh installed list
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("uc_game_installed", { detail: { appid: update.appid } }))
        }
      }
    })
  }, [startNextQueuedPart])

  // The main process writes installed manifests; renderer can call `window.ucDownloads.listInstalled()` when needed.

  const startGameDownload = useCallback(async (game: Game) => {
    if (preparingRef.current.has(game.appid)) {
      throw new Error("This game is already downloading.")
    }
    const existingActive = downloadsRef.current.filter(
      (item) =>
        item.appid === game.appid &&
        ["queued", "downloading", "paused", "extracting", "installing"].includes(item.status)
    )
    if (existingActive.length > 0) {
      throw new Error("This game is already downloading.")
    }
    preparingRef.current.add(game.appid)

    try {
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
        // Accept redirect URLs (may be signed Rootz URLs)
        const redirectUrl = linksResult.redirectUrl
        links = [redirectUrl]
        if (isPixeldrainUrl(redirectUrl)) {
          selectedHost = "pixeldrain"
        } else if (isRootzUrl(redirectUrl)) {
          selectedHost = "rootz"
        } else {
          selectedHost = await getPreferredDownloadHost()
        }
      } else {
        const preferredHost = await getPreferredDownloadHost()
        const selected = selectHost(linksResult.hosts, preferredHost)
        
        // If no links found at all
        if (!selected.links.length) {
          throw new Error(`No download links available for "${preferredHost}". This title may not be available on your selected host.`)
        }
        
        // If preferred host wasn't available, warn user (but use the fallback)
        if (selected.host !== preferredHost) {
          downloadLogger.warn(`Preferred host "${preferredHost}" not available, using "${selected.host}" instead`)
        }
        
        links = selected.links
        selectedHost = selected.host || "rootz"
      }

      if (!links.length) {
        throw new Error("No download links are available for this title. Please try again later or request the game to be uploaded to a supported host.")
      }

      const baseName = safeGameFilename(game.name)
      const host = selectedHost
      const batchId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
      const queue = links.map((sourceUrl, index) => {
        const filenameFallback = inferFilenameFromUrl(
          sourceUrl,
          `${baseName}${links.length > 1 ? `-part${index + 1}` : ""}`
        )
        const downloadId = `${game.appid}-${batchId}-${index}`
        const partIndex = parsePartIndexFromFilename(filenameFallback)
        return { sourceUrl, filenameFallback, downloadId, index, partIndex }
      })
      const inferredTotalParts = Math.max(1, queue.length)
      const parsedPartNumbers = queue
        .map((item) => item.partIndex)
        .filter((num): num is number => typeof num === "number" && Number.isFinite(num))
      const totalParts = parsedPartNumbers.length
        ? Math.max(...parsedPartNumbers, inferredTotalParts)
        : inferredTotalParts
      const newItems: DownloadItem[] = queue.map((item) => {
        const partTotal = totalParts > 1 ? totalParts : undefined
        const partIndex = partTotal ? item.partIndex ?? item.index + 1 : undefined
        return {
          id: item.downloadId,
          appid: game.appid,
          gameName: game.name,
          host,
          url: item.sourceUrl,
          filename: item.filenameFallback,
          partIndex,
          partTotal,
          status: "queued",
          receivedBytes: 0,
          totalBytes: 0,
          speedBps: 0,
          etaSeconds: null,
          startedAt: Date.now(),
        }
      })

      setDownloads((prev) => {
        const staleStatuses: DownloadStatus[] = ["cancelled", "failed", "extract_failed"]
        const cleared = prev.filter((item) => !(item.appid === game.appid && staleStatuses.includes(item.status)))
        const next = [...newItems, ...cleared]
        downloadsRef.current = next
        return next
      })

      void prefetchPartSizes(host, queue.map((item) => ({ id: item.downloadId, url: item.sourceUrl })))
      void startNextQueuedPart()
    } catch (err) {
      try {
        await window.ucDownloads?.deleteInstalling?.(game.appid)
      } catch {}
      throw err
    } finally {
      preparingRef.current.delete(game.appid)
    }
  }, [startNextQueuedPart])

  const cancelDownload = useCallback(async (downloadId: string) => {
    const download = downloads.find((d) => d.id === downloadId)
    if (window.ucDownloads?.cancel) {
      await window.ucDownloads.cancel(downloadId)
    }
    if (download?.appid && window.ucDownloads?.setInstallingStatus) {
      try {
        await window.ucDownloads.setInstallingStatus(download.appid, "cancelled", "Cancelled by user")
      } catch {}
    }
    setDownloads((prev) =>
      prev.map((item) =>
        item.id === downloadId ? { ...item, status: "cancelled", error: "Cancelled" } : item
      )
    )
  }, [downloads])

  const cancelGroup = useCallback(async (appid: string) => {
    if (!appid) return
    // cancel all downloads with matching appid
    const toCancel = downloads.filter((d) => d.appid === appid).map((d) => d.id)
    for (const id of toCancel) {
      try {
        if (window.ucDownloads?.cancel) await window.ucDownloads.cancel(id)
      } catch (e) {}
    }
    if (window.ucDownloads?.setInstallingStatus) {
      try {
        await window.ucDownloads.setInstallingStatus(appid, "cancelled", "Cancelled by user")
      } catch {}
    }
    setDownloads((prev) =>
      prev.map((item) =>
        item.appid === appid ? { ...item, status: "cancelled", error: "Cancelled" } : item
      )
    )
  }, [downloads])

  const pauseDownload = useCallback(async (downloadId: string) => {
    if (window.ucDownloads?.pause) {
      await window.ucDownloads.pause(downloadId)
    }
  }, [])

  const resumeDownload = useCallback(
    async (downloadId: string) => {
      const target = downloads.find((item) => item.id === downloadId)
      if (!target) return

      let ok = false
      if (window.ucDownloads?.resume) {
        try {
          const res = await window.ucDownloads.resume(downloadId)
          ok = Boolean(res && typeof res === "object" && "ok" in res ? (res as { ok?: boolean }).ok : res)
        } catch {
          ok = false
        }
      }

      if (!ok && window.ucDownloads?.resumeInterrupted && target.resumeData?.offset) {
        try {
          const res = await window.ucDownloads.resumeInterrupted({
            downloadId,
            url: target.url,
            filename: target.filename,
            appid: target.appid,
            gameName: target.gameName,
            partIndex: target.partIndex,
            partTotal: target.partTotal,
            savePath: target.savePath,
            resumeData: target.resumeData,
          })
          ok = Boolean(res && typeof res === "object" && "ok" in res ? (res as { ok?: boolean }).ok : res)
        } catch {
          ok = false
        }
        if (ok) {
          setDownloads((prev) =>
            prev.map((item) =>
              item.id === downloadId
                ? {
                    ...item,
                    status: "queued",
                    speedBps: 0,
                    etaSeconds: null,
                    error: null,
                    startedAt: Date.now(),
                  }
                : item
            )
          )
        }
      }

      if (!ok && window.ucDownloads?.start) {
        try {
          await window.ucDownloads.start({
            downloadId,
            url: target.url,
            filename: target.filename,
            appid: target.appid,
            gameName: target.gameName,
            partIndex: target.partIndex,
            partTotal: target.partTotal,
          })
          ok = true
          setDownloads((prev) =>
            prev.map((item) =>
              item.id === downloadId
                ? {
                    ...item,
                    status: "queued",
                    receivedBytes: 0,
                    totalBytes: item.totalBytes,
                    speedBps: 0,
                    etaSeconds: null,
                    error: null,
                    startedAt: Date.now(),
                  }
                : item
            )
          )
        } catch {
          ok = false
        }
      }

      if (!ok) {
        setDownloads((prev) =>
          prev.map((item) =>
            item.id === downloadId ? { ...item, status: "failed", error: "Resume failed. Please try again." } : item
          )
        )
        if (target.appid) {
          await window.ucDownloads?.setInstallingStatus?.(target.appid, "failed", "Resume failed. Please try again.")
        }
      }
    },
    [downloads]
  )

  const resumeGroup = useCallback(
    async (appid: string) => {
      if (!appid) return
      const current = downloadsRef.current.filter((item) => item.appid === appid)
      const hasActive = current.some((item) =>
        ["downloading", "extracting", "installing"].includes(item.status)
      )
      if (hasActive) return
      const pausedWithProgress = current.find(
        (item) => item.status === "paused" && (item.receivedBytes > 0 || item.totalBytes > 0)
      )
      if (pausedWithProgress) {
        setDownloads((prev) => {
          const next = prev.map((item) => {
            if (item.appid !== appid) return item
            if (item.id === pausedWithProgress.id) return item
            if (item.status === "paused" && item.receivedBytes === 0) {
              return { ...item, status: "queued" }
            }
            return item
          })
          downloadsRef.current = next
          return next
        })
        await resumeDownload(pausedWithProgress.id)
        return
      }

      setDownloads((prev) => {
        const next = prev.map((item) => {
          if (item.appid === appid && item.status === "paused") {
            return { ...item, status: "queued" }
          }
          return item
        })
        downloadsRef.current = next
        return next
      })
      queueMicrotask(() => {
        void startNextQueuedPart()
      })
    },
    [resumeDownload, startNextQueuedPart]
  )

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
      prev.filter(
        (item) =>
          !["completed", "extracted", "extract_failed", "failed", "cancelled"].includes(item.status)
      )
    )
  }, [])

  const clearByAppid = useCallback((appid: string) => {
    if (!appid) return
    setDownloads((prev) => prev.filter((item) => item.appid !== appid))
  }, [])

  const value = useMemo(
    () => ({
      downloads,
      startGameDownload,
      cancelDownload,
      cancelGroup,
      pauseDownload,
      resumeDownload,
      resumeGroup,
      showInFolder,
      openPath,
      removeDownload: (downloadId: string) =>
        setDownloads((prev) => prev.filter((item) => item.id !== downloadId)),
      clearByAppid,
      clearCompleted,
    }),
    [downloads, startGameDownload, cancelDownload, cancelGroup, pauseDownload, resumeDownload, resumeGroup, showInFolder, openPath, clearByAppid, clearCompleted]
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
