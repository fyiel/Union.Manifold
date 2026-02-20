import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import type { Game } from "@/lib/types"
import {
  fetchDownloadLinks,
  fetchDownloadLinksForVersion,
  inferFilenameFromUrl,
  getPreferredDownloadHost,
  isPixeldrainUrl,
  isRootzUrl,
  requestDownloadToken,
  resolveDownloadUrl,
  resolveDownloadSize,
  selectHost,
  SUPPORTED_DOWNLOAD_HOSTS,
  type DownloadConfig,
  type PreferredDownloadHost,
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
  originalUrl?: string
  filename: string
  partIndex?: number
  partTotal?: number
  versionLabel?: string
  authHeader?: string
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
  startGameDownload: (game: Game, preferredHost?: PreferredDownloadHost, config?: DownloadConfig) => Promise<void>
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
type DownloadsStore = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => DownloadItem[]
}

const DownloadsStoreContext = createContext<DownloadsStore | null>(null)
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

      const restored = parsed.map((item) =>
        item.status === "downloading" || item.status === "extracting" || item.status === "installing"
          ? { ...item, status: "paused" as DownloadStatus, error: "App restarted" }
          : item
      )

      // Log restored downloads so they're visible in app logs
      if (restored.length > 0) {
        downloadLogger.info(`Restored ${restored.length} download(s) from localStorage`, {
          data: restored.map((item) => ({ id: item.id, appid: item.appid, gameName: item.gameName, status: item.status, host: item.host }))
        })
      }

      return restored
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
  const listenersRef = useRef(new Set<() => void>())
  useEffect(() => {
    listenersRef.current.forEach((listener) => listener())
  }, [downloads])
  const preparingRef = useRef(new Set<string>())
  const sequenceLocksRef = useRef(new Set<string>())
  const reconcileLocksRef = useRef(new Set<string>())

  const reconcileInstalledState = useCallback(
    async (appid?: string | null) => {
      if (!appid || !window.ucDownloads?.getInstalled) return
      if (reconcileLocksRef.current.has(appid)) return
      reconcileLocksRef.current.add(appid)
      try {
        const installed = await window.ucDownloads.getInstalled(appid)
        if (!installed) return
        setDownloads((prev) => {
          let mutated = false
          const next = prev.map((item) => {
            if (item.appid !== appid) return item
            if (["completed", "extracted"].includes(item.status)) return item

            // Allow force-completing items that are at 100% even if in active states.
            // This fixes the "stuck at 100%" UI bug where the main process finishes 
            // but the renderer doesn't receive/process the completion event.
            if (["extracting", "installing", "downloading"].includes(item.status)) {
              const isFinished = item.totalBytes > 0 && item.receivedBytes >= item.totalBytes
              if (!isFinished) return item
            }

            mutated = true
            return {
              ...item,
              status: "completed" as DownloadStatus,
              error: null,
              completedAt: Date.now(),
              speedBps: 0,
              etaSeconds: null,
              receivedBytes: item.totalBytes || item.receivedBytes,
            }
          })
          if (mutated) downloadsRef.current = next
          return next
        })
        try {
          await window.ucDownloads.deleteInstalling?.(appid)
        } catch { }
      } catch {
        // ignore
      } finally {
        reconcileLocksRef.current.delete(appid)
      }
    },
    []
  )

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
      if (sequenceLocksRef.current.size > 0) {
        return
      }
      const hasActive = downloadsRef.current.some((item) =>
        ["downloading", "extracting", "installing"].includes(item.status)
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
        if (!resolved || !resolved.url || !resolved.resolved) {
          const hostLabel = next.host.charAt(0).toUpperCase() + next.host.slice(1)
          setDownloads((prev) =>
            prev.map((item) =>
              item.id === next.id
                ? { ...item, status: "failed", error: `${hostLabel} link could not be resolved.` }
                : item
            )
          )
          if (next.appid) {
            await window.ucDownloads?.setInstallingStatus?.(next.appid, "failed", `${hostLabel} link could not be resolved.`)
          }
          return
        }

        const filename = resolved.filename || next.filename
        setDownloads((prev) =>
          prev.map((item) =>
            item.id === next.id
              ? {
                ...item,
                url: resolved.url,
                originalUrl: item.originalUrl || next.url,
                filename,
                totalBytes: resolved.size || 0,
                authHeader: resolved.authHeader,
                error: null,
              }
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
          authHeader: resolved.authHeader,
          versionLabel: next.versionLabel || undefined,
        })
        if (res && typeof res === "object" && "ok" in res && !res.ok) {
          throw new Error((res as { error?: string }).error || "Failed to start download")
        }
        // If main process says this download was queued or already exists,
        // mark the renderer item as "downloading" to break the retry loop.
        // The main process will send real status updates (via onUpdate) once it begins processing.
        const resObj = res as Record<string, unknown> | undefined
        if (resObj && (resObj.already || resObj.queued)) {
          setDownloads((prev) =>
            prev.map((item) =>
              item.id === next.id && item.status === "queued"
                ? { ...item, status: "downloading" as DownloadStatus }
                : item
            )
          )
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

        // Terminal states: once an item reaches one of these, don't let it regress
        // to "downloading" or "queued". However, we MUST allow state transitions
        // that the main process explicitly sends (e.g. extracting → extracted → completed).
        const terminalStates = ["completed", "extract_failed", "failed", "cancelled"]
        const isTerminal = terminalStates.includes(existing.status)
        const nextStatus = update.status || existing.status

        // Only truly block if item is in a hard-terminal state (completed/failed/cancelled)
        // AND the incoming status is a step backwards (downloading/queued/paused)
        const regressiveStates = ["downloading", "queued", "paused"]
        const finalStatus = isTerminal && regressiveStates.includes(nextStatus) ? existing.status : nextStatus

        // When entering a terminal or idle state, always zero out speed
        const isEnteringTerminal = terminalStates.includes(finalStatus) || finalStatus === "extracted"

        const next: DownloadItem = {
          ...existing,
          status: finalStatus as DownloadStatus,
          receivedBytes: update.receivedBytes ?? existing.receivedBytes,
          totalBytes: update.totalBytes ?? existing.totalBytes,
          speedBps: isEnteringTerminal ? 0 : (update.speedBps ?? existing.speedBps),
          etaSeconds: isEnteringTerminal ? null : (update.etaSeconds ?? existing.etaSeconds),
          filename: update.filename ?? existing.filename,
          savePath: update.savePath ?? existing.savePath,
          url: update.url ?? existing.url,
          error: update.error ?? existing.error,
          partIndex: update.partIndex ?? existing.partIndex,
          partTotal: update.partTotal ?? existing.partTotal,
          resumeData: update.resumeData ?? existing.resumeData,
          completedAt:
            finalStatus === "completed" ||
              finalStatus === "failed" ||
              finalStatus === "cancelled" ||
              finalStatus === "extracted" ||
              finalStatus === "extract_failed"
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

      // Only reconcile installed state AFTER extraction/install is fully done.
      // Do NOT reconcile while extracting/installing — the installed manifest may already
      // exist on disk before extraction finishes, which causes premature "completed" status.
      if (update.appid && (update.status === "completed" || update.status === "extracted")) {
        queueMicrotask(() => {
          void reconcileInstalledState(update.appid)
        })
      }
    })
  }, [startNextQueuedPart])

  useEffect(() => {
    const hasActive = downloads.some((item) =>
      ["downloading", "extracting", "installing"].includes(item.status)
    )
    if (hasActive) return
    const hasQueued = downloads.some((item) => item.status === "queued")
    if (!hasQueued) return

    // Don't auto-start ANY queued item when the user has paused downloads.
    // A paused download anywhere means the user wants everything held.
    const hasPausedDownload = downloads.some(
      (item) => item.status === "paused"
    )
    if (hasPausedDownload) return

    queueMicrotask(() => {
      void startNextQueuedPart()
    })
  }, [downloads, startNextQueuedPart])

  useEffect(() => {
    if (typeof window === "undefined") return
    const interval = setInterval(() => {
      const appids = new Set(
        downloadsRef.current
          .filter((item) => ["extracting", "installing", "paused"].includes(item.status))
          .map((item) => item.appid)
          .filter(Boolean) as string[]
      )
      for (const appid of appids) {
        void reconcileInstalledState(appid)
      }
    }, 8000)
    return () => clearInterval(interval)
  }, [reconcileInstalledState])

  // The main process writes installed manifests; renderer can call `window.ucDownloads.listInstalled()` when needed.

  const startGameDownload = useCallback(async (game: Game, preferredHostOverride?: PreferredDownloadHost, config?: DownloadConfig) => {
    if (preparingRef.current.has(game.appid)) {
      downloadLogger.warn(`startGameDownload skipped: already preparing ${game.appid}`)
      return
    }
    const existingActive = downloadsRef.current.filter(
      (item) =>
        item.appid === game.appid &&
        ["queued", "downloading", "paused", "extracting", "installing"].includes(item.status)
    )
    if (existingActive.length > 0) {
      downloadLogger.warn(`startGameDownload skipped: active items exist for ${game.appid}`)
      return
    }
    preparingRef.current.add(game.appid)

    try {
      // save initial metadata to installing folder so it's available offline even before completion
      try {
        if (window.ucDownloads?.saveInstalledMetadata) {
          // pass the full game object as metadata, with downloadedVersion from config
          const metadataWithVersion = {
            ...game,
            downloadedVersion: config?.versionLabel || game.version || undefined,
          }
          await window.ucDownloads.saveInstalledMetadata(game.appid, metadataWithVersion)
        }
      } catch (err) {
        // ignore IPC failures
      }

      const downloadToken = await requestDownloadToken(game.appid)
      if (hasCookieConsent()) {
        addDownloadedGameToHistory(game.appid)
      }

      // Use version-specific fetch if a versionId was provided via config
      const versionId = config?.versionId
      const linksResult = versionId
        ? await fetchDownloadLinksForVersion(game.appid, downloadToken, versionId)
        : await fetchDownloadLinks(game.appid, downloadToken)

      const preferredHost =
        SUPPORTED_DOWNLOAD_HOSTS.includes(preferredHostOverride as PreferredDownloadHost)
          ? (preferredHostOverride as PreferredDownloadHost)
          : await getPreferredDownloadHost()

      let links: string[] = []
      let selectedHost = preferredHost

      if (linksResult.redirectUrl) {
        // Accept redirect URLs (may be signed Rootz URLs)
        const redirectUrl = linksResult.redirectUrl
        links = [redirectUrl]
        if (isPixeldrainUrl(redirectUrl)) {
          selectedHost = "pixeldrain"
        } else if (isRootzUrl(redirectUrl)) {
          selectedHost = "rootz"
        } else {
          selectedHost = preferredHost
        }
      } else {
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
        selectedHost = (selected.host || preferredHost) as PreferredDownloadHost
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
          versionLabel: config?.versionLabel || game.version,
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
      } catch { }
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
      } catch { }
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
      } catch (e) { }
    }
    if (window.ucDownloads?.setInstallingStatus) {
      try {
        await window.ucDownloads.setInstallingStatus(appid, "cancelled", "Cancelled by user")
      } catch { }
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
    // Also pause any queued siblings in the same appid group so the queue
    // doesn't auto-start the next part while the user has paused.
    const target = downloadsRef.current.find((item) => item.id === downloadId)
    if (target?.appid) {
      setDownloads((prev) =>
        prev.map((item) =>
          item.appid === target.appid && item.id !== downloadId && item.status === "queued"
            ? { ...item, status: "paused" as DownloadStatus, error: null }
            : item
        )
      )
    }
  }, [])

  const resumeDownload = useCallback(
    async (downloadId: string) => {
      const target = downloads.find((item) => item.id === downloadId)
      if (!target) return

      downloadLogger.info("Resume attempt", { data: { downloadId, host: target.host, status: target.status, hasResumeData: Boolean(target.resumeData?.offset) } })

      let ok = false

      // Level 1: Try Electron's in-memory DownloadItem.resume()
      if (window.ucDownloads?.resume) {
        try {
          const res = await window.ucDownloads.resume(downloadId)
          ok = Boolean(res && typeof res === "object" && "ok" in res ? (res as { ok?: boolean }).ok : res)
          downloadLogger.info("Resume Level 1 (in-memory)", { data: { ok } })
        } catch {
          ok = false
        }
      }

      // Level 2: Try resuming from interrupted state (createInterruptedDownload)
      if (!ok && window.ucDownloads?.resumeInterrupted && target.resumeData?.offset) {
        try {
          downloadLogger.info("Resume Level 2 (interrupted)", { data: { offset: target.resumeData.offset, savePath: target.savePath } })
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
            authHeader: target.authHeader,
          })
          ok = Boolean(res && typeof res === "object" && "ok" in res ? (res as { ok?: boolean }).ok : res)
          // The main process returns the actual file-size-based offset which may differ
          // from the stale stored resumeData.offset (localStorage updates lag behind disk writes).
          const actualOffset = (res as { actualOffset?: number })?.actualOffset
          downloadLogger.info("Resume Level 2 result", { data: { ok, actualOffset, storedOffset: target.resumeData.offset } })
        } catch {
          ok = false
        }
        if (ok) {
          // createInterruptedDownload triggers will-download which sends status updates.
          // Set to "downloading" (not "queued") to prevent auto-start from re-processing this item.
          setDownloads((prev) =>
            prev.map((item) =>
              item.id === downloadId
                ? {
                  ...item,
                  status: "downloading" as DownloadStatus,
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

      // Level 3: Re-resolve the URL and resume from the partial file on disk.
      // Instead of restarting from byte 0, we use createInterruptedDownload with the
      // fresh URL + actual file offset so the download continues where it left off.
      if (!ok && window.ucDownloads?.start) {
        try {
          // Set to "downloading" so onUpdate callbacks from the main process are not blocked
          // by terminal state protection. Preserve receivedBytes to avoid clearing the UI progress.
          setDownloads((prev) =>
            prev.map((item) =>
              item.id === downloadId
                ? {
                  ...item,
                  status: "downloading" as DownloadStatus,
                  speedBps: 0,
                  etaSeconds: null,
                  error: null,
                  startedAt: Date.now(),
                }
                : item
            )
          )

          // Re-resolve using the original (pre-resolve) URL to get a fresh download URL.
          // CDN URLs (e.g. FileQ signed links) expire, so we need a fresh one.
          const resolveUrl = target.originalUrl || target.url
          downloadLogger.info("Resume Level 3 (re-resolve)", { data: { host: target.host, resolveUrl } })
          const resolved = await resolveDownloadUrl(target.host, resolveUrl)
          downloadLogger.info("Resume Level 3 resolved", { data: { resolvedUrl: resolved?.url, resolvedOk: resolved?.resolved, hasAuth: Boolean(resolved?.authHeader) } })
          const freshUrl = resolved?.resolved ? resolved.url : target.url
          const freshAuth = resolved?.authHeader || target.authHeader

          // Try resuming from the partial file on disk using the fresh URL.
          // This sends a Range request so we don't re-download bytes we already have.
          let resumedFromDisk = false
          if (window.ucDownloads.resumeWithFreshUrl && target.savePath) {
            try {
              const resumeRes = await window.ucDownloads.resumeWithFreshUrl({
                downloadId,
                url: freshUrl,
                filename: resolved?.filename || target.filename,
                appid: target.appid,
                gameName: target.gameName,
                partIndex: target.partIndex,
                partTotal: target.partTotal,
                savePath: target.savePath,
                totalBytes: resolved?.size || target.totalBytes,
                authHeader: freshAuth,
              })
              downloadLogger.info("Resume Level 3 resumeWithFreshUrl result", { data: resumeRes })
              if (resumeRes && typeof resumeRes === "object" && resumeRes.ok) {
                resumedFromDisk = true
                ok = true
              }
            } catch (e) {
              downloadLogger.warn("Resume Level 3 resumeWithFreshUrl failed, falling back to fresh start", { data: e })
            }
          }

          // Fallback: if no partial file exists or resumeWithFreshUrl failed, start fresh
          if (!resumedFromDisk) {
            const res = await window.ucDownloads.start({
              downloadId,
              url: freshUrl,
              filename: resolved?.filename || target.filename,
              appid: target.appid,
              gameName: target.gameName,
              partIndex: target.partIndex,
              partTotal: target.partTotal,
              authHeader: freshAuth,
              savePath: target.savePath,
            } as Parameters<typeof window.ucDownloads.start>[0])
            downloadLogger.info("Resume Level 3 start result", { data: res })
            ok = true
          }

          setDownloads((prev) =>
            prev.map((item) =>
              item.id === downloadId
                ? {
                  ...item,
                  url: freshUrl,
                  authHeader: freshAuth,
                  status: "downloading",
                  totalBytes: resolved?.size || item.totalBytes,
                }
                : item
            )
          )
        } catch (err) {
          downloadLogger.warn("Resume Level 3 failed", { data: err })
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
      // Prefer resuming the part that actually has downloaded bytes, not just pre-fetched totalBytes
      const pausedWithProgress = current
        .filter((item) => item.status === "paused")
        .sort((a, b) => (b.receivedBytes || 0) - (a.receivedBytes || 0))
        .find((item) => item.receivedBytes > 0 || item.totalBytes > 0)
      if (pausedWithProgress) {
        // Resume the part with progress first. Do NOT re-queue siblings yet —
        // wait until the resumed download is actually running to avoid the
        // auto-start effect picking them up during the async resolve gap.
        await resumeDownload(pausedWithProgress.id)
        // Now that the resumed download is active (or failed), re-queue remaining paused siblings
        setDownloads((prev) => {
          const next = prev.map((item) => {
            if (item.appid !== appid) return item
            if (item.id === pausedWithProgress.id) return item
            if (item.status === "paused" && item.receivedBytes === 0) {
              return { ...item, status: "queued" as DownloadStatus }
            }
            return item
          })
          downloadsRef.current = next
          return next
        })
        return
      }

      setDownloads((prev) => {
        const next = prev.map((item) => {
          if (item.appid === appid && item.status === "paused") {
            return { ...item, status: "queued" as DownloadStatus }
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
    // Call startNextQueuedPart to start the next part after clearing completed
    queueMicrotask(() => {
      void startNextQueuedPart()
    })
  }, [])

  const clearByAppid = useCallback((appid: string) => {
    if (!appid) return
    setDownloads((prev) => prev.filter((item) => item.appid !== appid))
  }, [])

  const store = useMemo<DownloadsStore>(
    () => ({
      subscribe: (listener: () => void) => {
        listenersRef.current.add(listener)
        return () => listenersRef.current.delete(listener)
      },
      getSnapshot: () => downloadsRef.current,
    }),
    []
  )

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

  return (
    <DownloadsStoreContext.Provider value={store}>
      <DownloadsContext.Provider value={value}>{children}</DownloadsContext.Provider>
    </DownloadsStoreContext.Provider>
  )
}

export function useDownloads() {
  const context = useContext(DownloadsContext)
  if (!context) {
    throw new Error("useDownloads must be used within DownloadsProvider")
  }
  return context
}

export function useDownloadsSelector<T>(
  selector: (downloads: DownloadItem[]) => T,
  equalityFn: (prev: T, next: T) => boolean = Object.is
) {
  const store = useContext(DownloadsStoreContext)
  if (!store) {
    throw new Error("useDownloadsSelector must be used within DownloadsProvider")
  }

  const selectionRef = useRef<{ hasValue: boolean; value: T }>({ hasValue: false, value: undefined as T })

  const getSnapshot = useCallback(() => {
    const next = selector(store.getSnapshot())
    if (selectionRef.current.hasValue && equalityFn(selectionRef.current.value, next)) {
      return selectionRef.current.value
    }
    selectionRef.current = { hasValue: true, value: next }
    return next
  }, [store, selector, equalityFn])

  return useSyncExternalStore(store.subscribe, getSnapshot, () => selector([]))
}
