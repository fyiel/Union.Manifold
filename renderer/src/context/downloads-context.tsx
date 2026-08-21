import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"

import type { Game } from "@/lib/types"
import {
  fetchDownloadLinks,
  inferFilenameFromUrl,
  getPreferredDownloadHost,
  isUCFilesUrl,
  requestDownloadToken,
  resolveDownloadUrl,
  resolveDownloadSize,
  selectHost,
  SUPPORTED_DOWNLOAD_HOSTS,
  type DownloadConfig,
  type DownloadHostEntry,
  type PreferredDownloadHost,
} from "@/lib/downloads"
import { apiFetch } from "@/lib/api"
import { fmtBytes } from "@/lib/utils"
import { addDownloadedGameToHistory } from "@/lib/user-history"
import { downloadLogger } from "@/lib/logger"

export type DownloadStatus =
  | "queued"
  | "downloading"
  | "paused"
  | "extracting"
  | "installing"
  | "install_ready"
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
  update?: boolean
  installMetadata?: Record<string, unknown>
  status: DownloadStatus
  receivedBytes: number
  totalBytes: number
  speedBps: number
  etaSeconds: number | null
  extractProgress?: number | null
  savePath?: string
  startedAt: number
  error?: string | null
}

type DownloadUpdate = {
  downloadId: string
  status: DownloadStatus
  receivedBytes?: number
  totalBytes?: number
  speedBps?: number
  etaSeconds?: number | null
  extractProgress?: number | null
  filename?: string
  savePath?: string
  appid?: string | null
  gameName?: string | null
  url?: string
  error?: string | null
  partIndex?: number
  partTotal?: number
  update?: boolean
  installMetadata?: Record<string, unknown>
}

type ArchiveDeletionPrompt = {
  appid?: string | null
  gameName?: string | null
  archivePaths: string[]
  totalBytes: number
}

function normalizeArchivePathList(paths: unknown): string[] {
  if (!Array.isArray(paths)) return []
  const seen = new Set<string>()
  const next: string[] = []
  for (const entry of paths) {
    if (typeof entry !== "string") continue
    const trimmed = entry.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    next.push(trimmed)
  }
  return next
}

function basenameFromArchivePath(targetPath: string): string {
  const normalized = targetPath.replace(/\\/g, "/")
  const parts = normalized.split("/").filter(Boolean)
  return (parts[parts.length - 1] || normalized).toLowerCase()
}

function archivePromptIdentityKey(prompt: ArchiveDeletionPrompt): string {
  const appKey = String(prompt.appid || prompt.gameName || "unknown").toLowerCase()
  const fileSig = [...prompt.archivePaths]
    .map(basenameFromArchivePath)
    .sort()
    .join("|")
  return `${appKey}::${prompt.totalBytes || 0}::${fileSig}`
}

function normalizeArchivePromptPayload(payload: ArchiveDeletionPrompt): ArchiveDeletionPrompt | null {
  const archivePaths = normalizeArchivePathList(payload?.archivePaths)
  if (!archivePaths.length) return null
  return {
    appid: payload?.appid || null,
    gameName: payload?.gameName || payload?.appid || null,
    archivePaths,
    totalBytes: Number.isFinite(Number(payload?.totalBytes)) ? Number(payload.totalBytes) : 0,
  }
}

type DownloadsActionsValue = {
  startGameDownload: (game: Game, preferredHost?: PreferredDownloadHost, config?: DownloadConfig) => Promise<void>
  cancelGroup: (appid: string) => Promise<void>
  discardGroup: (appid: string) => Promise<void>
  pauseGroup: (appid: string) => Promise<void>
  pauseAll: () => Promise<void>
  resumeDownload: (downloadId: string) => Promise<void>
  resumeGroup: (appid: string) => Promise<void>
  resumeAll: () => Promise<void>
  upsertDownload: (download: DownloadItem) => void
  openPath: (path: string) => Promise<void>
  clearByAppid: (appid: string) => void
  clearCompleted: () => void
}

const DownloadsActionsContext = createContext<DownloadsActionsValue | null>(null)
type DownloadsStore = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => DownloadItem[]
}

const DownloadsStoreContext = createContext<DownloadsStore | null>(null)
const LEGACY_STORAGE_KEY = "uc_direct_downloads"
const PAUSABLE_STATUSES: DownloadStatus[] = ["downloading", "extracting", "installing"]

function compareQueuePosition(
  a: { startedAt: number; partIndex?: number },
  b: { startedAt: number; partIndex?: number }
): number {
  if (a.startedAt !== b.startedAt) {
    return a.startedAt - b.startedAt
  }
  return (a.partIndex ?? 0) - (b.partIndex ?? 0)
}

function coercePersistedDownloadUrl(url: unknown): string {
  if (typeof url === "string") return url
  if (url && typeof url === "object" && typeof (url as { url?: unknown }).url === "string") {
    return (url as { url: string }).url
  }
  return String(url ?? "")
}

function normalizePersistedDownloads(parsed: unknown, sourceLabel: string): DownloadItem[] {
  if (!Array.isArray(parsed)) return []

  const restored = parsed
    .filter((item): item is Partial<DownloadItem> => Boolean(item && typeof item === "object"))
    .filter((item) => !["completed", "extracted", "cancelled"].includes(String(item.status || "")))
    .map((item) => {
      const safeItem = typeof item.url !== "string"
        ? { ...item, url: coercePersistedDownloadUrl(item.url) }
        : item

      if (["downloading", "failed"].includes(String(safeItem.status || ""))) {
        return {
          ...(safeItem as DownloadItem),
          status: "paused" as DownloadStatus,
          error: safeItem.status === "failed"
            ? safeItem.error || "Download interrupted. Resume to continue."
            : "App restarted",
        }
      }

      // Statuses from pre-sweep builds (e.g. "verifying"/"retrying") are
      // never produced by the backend or the reducer; park them as paused
      // so the row stays visible and resumable instead of vanishing from
      // every UI section.
      const status = String(safeItem.status || "")
      const known = ["queued", "paused", "extracting", "installing", "install_ready", "completed", "extracted", "extract_failed", "cancelled"]
      if (!known.includes(status)) {
        return {
          ...(safeItem as DownloadItem),
          status: "paused" as DownloadStatus,
          error: "App restarted",
        }
      }

      return {
        ...(safeItem as DownloadItem),
      }
    })

  if (restored.length > 0) {
    downloadLogger.info(`Restored ${restored.length} download(s) from ${sourceLabel}`, {
      data: restored.map((item) => ({ id: item.id, appid: item.appid, gameName: item.gameName, status: item.status, host: item.host }))
    })
  }

  return restored
}

function mergeHydratedDownloads(current: DownloadItem[], restored: DownloadItem[]): DownloadItem[] {
  if (!current.length) return restored
  if (!restored.length) return current

  const knownIds = new Set(current.map((item) => item.id))
  const merged = [...current]
  for (const item of restored) {
    if (knownIds.has(item.id)) continue
    merged.push(item)
    knownIds.add(item.id)
  }
  return merged
}

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

function pickResumeLinkCandidate(target: DownloadItem, links: DownloadHostEntry[]) {
  if (!links.length) return null

  if (typeof target.partIndex === "number") {
    const exactPart = links.find((entry) => entry.part === target.partIndex)
    if (exactPart) return exactPart
  }

  const filenamePart = parsePartIndexFromFilename(target.filename)
  if (typeof filenamePart === "number") {
    const parsedPart = links.find((entry) => entry.part === filenamePart)
    if (parsedPart) return parsedPart
  }

  if (typeof target.partIndex === "number") {
    const ordered = [...links].sort((a, b) => (a.part ?? Number.MAX_SAFE_INTEGER) - (b.part ?? Number.MAX_SAFE_INTEGER))
    const indexed = ordered[target.partIndex - 1]
    if (indexed) return indexed
  }

  return links[0]
}

function createSyntheticDownloadFromUpdate(update: DownloadUpdate): DownloadItem | null {
  const appid = typeof update.appid === "string" && update.appid ? update.appid : null
  const downloadId = typeof update.downloadId === "string" && update.downloadId ? update.downloadId : null
  if (!appid || !downloadId) return null

  return {
    id: downloadId,
    appid,
    gameName: update.gameName || appid,
    host: "local",
    url: update.url || "",
    originalUrl: update.url || undefined,
    filename: update.filename || `${safeGameFilename(update.gameName || appid)}.archive`,
    status: update.status,
    receivedBytes: update.receivedBytes || 0,
    totalBytes: update.totalBytes || 0,
    speedBps: update.speedBps || 0,
    etaSeconds: update.etaSeconds ?? null,
    extractProgress: update.extractProgress ?? null,
    savePath: update.savePath,
    startedAt: Date.now(),
    error: update.error ?? null,
    partIndex: update.partIndex,
    partTotal: update.partTotal,
    update: update.update,
    installMetadata: update.installMetadata,
  }
}

function resolveArchiveFolderPath(archivePaths: string[]): string | null {
  const firstPath = Array.isArray(archivePaths) ? archivePaths.find((value) => typeof value === "string" && value.length > 0) : null
  if (!firstPath) return null
  const normalized = firstPath.replace(/[\\/]+$/, "")
  const separatorIndex = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"))
  if (separatorIndex <= 0) return null
  return normalized.slice(0, separatorIndex)
}

export function DownloadsProvider({ children }: { children: React.ReactNode }) {
  const [downloads, setDownloads] = useState<DownloadItem[]>([])
  const [persistenceReady, setPersistenceReady] = useState(false)

  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
  const resumeLocksRef = useRef(new Set<string>())
  const pendingProgressRef = useRef<Map<string, DownloadUpdate>>(new Map())
  const progressFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [archiveDeletionPrompts, setArchiveDeletionPrompts] = useState<ArchiveDeletionPrompt[]>([])
  const [archiveDontAskAgain, setArchiveDontAskAgain] = useState(false)
  const [archiveDeletionBusy, setArchiveDeletionBusy] = useState(false)
  const [archiveDeletionError, setArchiveDeletionError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") return
    let cancelled = false

    void (async () => {
      let restored: DownloadItem[] = []
      let usedLegacyMigration = false

      try {
        const result = await window.ucDownloads?.loadPersistedState?.()
        if (result?.ok) {
          restored = normalizePersistedDownloads(result.downloads, "LevelDB")
        } else if (result?.error) {
          downloadLogger.warn("Failed to load persisted downloads from LevelDB", { data: { error: result.error } })
        }
      } catch (error) {
        downloadLogger.warn("Failed to load persisted downloads from LevelDB", { data: { error: String(error) } })
      }

      try {
        const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY)
        if (!restored.length && legacyRaw) {
          restored = normalizePersistedDownloads(JSON.parse(legacyRaw), "legacy localStorage")
          usedLegacyMigration = restored.length > 0
        }
      } catch (error) {
        downloadLogger.warn("Failed to read legacy download snapshot", { data: { error: String(error) } })
      }

      if (cancelled) return

      if (restored.length > 0) {
        const next = mergeHydratedDownloads(downloadsRef.current, restored)
        downloadsRef.current = next
        setDownloads(next)
      }

      setPersistenceReady(true)

      if (usedLegacyMigration && window.ucDownloads?.savePersistedState) {
        try {
          const result = await window.ucDownloads.savePersistedState(restored)
          if (!result?.ok) throw new Error(result?.error || "migration_failed")
          localStorage.removeItem(LEGACY_STORAGE_KEY)
        } catch (error) {
          downloadLogger.warn("Failed to migrate legacy download snapshot to LevelDB", { data: { error: String(error) } })
        }
      } else if (restored.length > 0) {
        try {
          localStorage.removeItem(LEGACY_STORAGE_KEY)
        } catch { }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const flushPersist = useCallback(() => {
    if (typeof window === "undefined" || !persistenceReady) return
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current)
      persistTimerRef.current = null
    }
    const snapshot = downloadsRef.current.filter((item) => {
      if (item.host !== "local") return true
      if (item.url && item.savePath) return true
      return false
    })
    void (async () => {
      try {
        if (window.ucDownloads?.savePersistedState) {
          const result = await window.ucDownloads.savePersistedState(snapshot)
          if (!result?.ok) throw new Error(result?.error || "persist_failed")
          try { localStorage.removeItem(LEGACY_STORAGE_KEY) } catch { }
          return
        }
      } catch (error) {
        downloadLogger.warn("Failed to persist downloads to LevelDB", { data: { error: String(error) } })
      }

      try {
        localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(snapshot))
      } catch { }
    })()
  }, [persistenceReady])

  useEffect(() => {
    if (typeof window === "undefined" || !persistenceReady) return
    persistTimerRef.current = setTimeout(flushPersist, 1500)

    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current)
        persistTimerRef.current = null
      }
    }
  }, [downloads, persistenceReady, flushPersist])

  useEffect(() => {
    if (typeof window === "undefined") return
    const onBeforeUnload = () => flushPersist()
    window.addEventListener("beforeunload", onBeforeUnload)
    const offCloseRequest = window.ucApp?.onCloseRequest?.(() => flushPersist())
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload)
      offCloseRequest?.()
      flushPersist()
    }
  }, [flushPersist])

  const reconcileInstalledState = useCallback(
    async (appid?: string | null, installedAppids?: ReadonlySet<string>) => {
      if (!appid || (!installedAppids && !window.ucDownloads?.getInstalled)) return
      if (downloadsRef.current.some((item) =>
        item.appid === appid &&
        item.update &&
        !["extracted", "extract_failed", "failed", "cancelled"].includes(item.status)
      )) return
      if (reconcileLocksRef.current.has(appid)) return
      reconcileLocksRef.current.add(appid)
      try {
        const installed = installedAppids !== undefined
          ? installedAppids.has(appid)
          : await window.ucDownloads?.getInstalled?.(appid)
        if (!installed) return
        const prev = downloadsRef.current
        let mutated = false
        const next = prev.map((item) => {
          if (item.appid !== appid) return item
          if (["completed", "extracted"].includes(item.status)) return item

          if (["extracting", "installing"].includes(item.status)) {
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
          }

          if (["downloading", "paused"].includes(item.status)) {
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
        if (mutated) {
          downloadsRef.current = next
          setDownloads(next)
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("uc_game_installed", { detail: { appid } }))
          }
        }
        try {
          await window.ucDownloads?.deleteInstalling?.(appid)
        } catch { }
      } catch {
      } finally {
        reconcileLocksRef.current.delete(appid)
      }
    },
    []
  )

  const mountReconcileRanRef = useRef(false)
  useEffect(() => {
    if (!persistenceReady) return
    if (mountReconcileRanRef.current) return
    mountReconcileRanRef.current = true

    const needsReconcile = downloadsRef.current.filter((item) =>
      ["extracting", "installing"].includes(item.status)
    )
    if (!needsReconcile.length) return

    const appids = [...new Set(needsReconcile.map((item) => item.appid))]
    void (async () => {
      for (const appid of appids) {
        await reconcileInstalledState(appid)

        const stillExtracting = downloadsRef.current.some(
          (item) => item.appid === appid && ["extracting", "installing"].includes(item.status)
        )
        if (!stillExtracting) continue

        try {
          const status = await window.ucDownloads?.getActiveStatus?.(appid)
          if (status?.extracting || status?.downloading) {
            downloadLogger.info(`Post-mount: ${appid} still extracting/downloading in main process`)
            continue
          }
        } catch { }

        try {
          const manifest = await window.ucDownloads?.getInstalling?.(appid)
          if (manifest?.installStatus === "downloaded") {
            setDownloads((prev) =>
              prev.map((item) =>
                item.appid === appid && ["extracting", "installing"].includes(item.status)
                  ? {
                    ...item,
                    status: "install_ready" as DownloadStatus,
                    error: manifest.installError || null,
                    completedAt: Date.now(),
                    speedBps: 0,
                    etaSeconds: null,
                    receivedBytes: item.totalBytes || item.receivedBytes,
                  }
                  : item
              )
            )
            continue
          }
        } catch { }

        setDownloads((prev) =>
          prev.map((item) =>
            item.appid === appid && ["extracting", "installing"].includes(item.status)
              ? { ...item, status: "paused" as DownloadStatus, error: "Extraction interrupted - please resume" }
              : item
          )
        )
      }
    })()
  }, [persistenceReady, reconcileInstalledState])

  useEffect(() => {
    if (!persistenceReady) return
    if (!window.ucDownloads) return
    let cancelled = false
    let started = false
    let idleHandle: number | null = null
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null

    const isDownloadsRoute = () => window.location.hash.replace(/^#/, "").split("?")[0] === "/downloads"
    const clearScheduled = () => {
      if (idleHandle !== null && typeof cancelIdleCallback === "function") cancelIdleCallback(idleHandle)
      if (timeoutHandle !== null) clearTimeout(timeoutHandle)
      idleHandle = null
      timeoutHandle = null
    }
    const run = () => {
      if (started || cancelled) return
      started = true
      clearScheduled()
      window.removeEventListener("hashchange", onHashChange)
      void (async () => {
        try {
          const recovery = await import("@/context/downloads-recovery")
          const hydrated = await recovery.loadInstallingDownloads()
          if (cancelled) return
          const current = downloadsRef.current
          const next = recovery.mergeInstallingDownloads(current, hydrated)
          if (next === current) return
          downloadsRef.current = next
          setDownloads(next)
        } catch {}
      })()
    }
    const onHashChange = () => {
      if (isDownloadsRoute()) run()
    }

    if (downloadsRef.current.length > 0 || isDownloadsRoute()) {
      run()
    } else {
      window.addEventListener("hashchange", onHashChange)
      if (typeof requestIdleCallback === "function") {
        idleHandle = requestIdleCallback(run, { timeout: 1000 })
      } else {
        timeoutHandle = setTimeout(run, 0)
      }
    }

    return () => {
      cancelled = true
      clearScheduled()
      window.removeEventListener("hashchange", onHashChange)
    }
  }, [persistenceReady])

const resolveWithTimeout = useCallback(async (host: string, targetUrl: string) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12000)
    try {
      const resolved = await resolveDownloadUrl(targetUrl, controller.signal)
      clearTimeout(timeout)
      return resolved
    } catch (err) {
      clearTimeout(timeout)
      throw err
    }
  }, [])

  const resolveFreshResumeSource = useCallback(
    async (target: DownloadItem) => {
      if (!target.appid) return null
      const isSupported = SUPPORTED_DOWNLOAD_HOSTS.includes(target.host as PreferredDownloadHost)
      const isPlaceholderHost = target.host === "local" || !target.host
      if (!isSupported && !isPlaceholderHost) return null
      const effectiveHost: PreferredDownloadHost = isSupported ? (target.host as PreferredDownloadHost) : "ucfiles"

      try {
        const token = await requestDownloadToken(target.appid)
        const linksResult = await fetchDownloadLinks(target.appid, token)

        let links: DownloadHostEntry[] = []
        if (linksResult.redirectUrl) {
          links = [{ url: linksResult.redirectUrl, part: null }]
        } else {
          const selected = selectHost(linksResult.hosts)
          if (!selected.links.length) {
            return null
          }
          links = selected.links
        }

        const selectedLink = pickResumeLinkCandidate(target, links)
        if (!selectedLink?.url) return null

        return {
          host: effectiveHost,
          sourceUrl: selectedLink.url,
        }
      } catch (error) {
        downloadLogger.warn("Failed to fetch fresh source url for resume", {
          data: { appid: target.appid, host: target.host, error },
        })
        return null
      }
    },
    []
  )

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
                const size = await resolveDownloadSize(entry.url)
                if (size && size > 0) {
                  sizeMap.set(entry.id, size)
                }
              } catch {
              }
            })
          )
        }
        return sizeMap
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
        ["downloading"].includes(item.status)
      )
      if (hasActive) return

      const queued = downloadsRef.current
        .filter((item) => item.status === "queued" && item.host && item.host !== "local")
        .sort(compareQueuePosition)
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
          if (next.appid && !next.update) {
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
          if (next.appid && !next.update) {
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
          update: next.update,
          installMetadata: next.installMetadata,
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
        if (next.appid && !next.update) {
          await window.ucDownloads?.setInstallingStatus?.(next.appid, "failed", message)
        }
      } finally {
        sequenceLocksRef.current.delete(next.appid)
      }
    },
    [resolveWithTimeout]
  )

  const openPath = useCallback(async (path: string) => {
    if (window.ucDownloads?.openPath) await window.ucDownloads.openPath(path)
  }, [])

  useEffect(() => {
    if (!window.ucDownloads?.onUpdate) return
    const unsubscribe = window.ucDownloads.onUpdate((update: DownloadUpdate) => {
      const existingItem = downloadsRef.current.find((item) => item.id === update.downloadId)
      const updateInstall = update.update ?? existingItem?.update ?? false
      const installFinished = update.status === "extracted" || (update.status === "completed" && !updateInstall)
      if (existingItem?.status === "downloading" && update.status === "downloading") {
        pendingProgressRef.current.set(update.downloadId, update)
        if (!progressFlushTimerRef.current) {
          progressFlushTimerRef.current = setTimeout(() => {
            progressFlushTimerRef.current = null
            const batch = new Map(pendingProgressRef.current)
            pendingProgressRef.current.clear()
            setDownloads((prev) => {
              let next = prev
              for (const [, u] of batch) {
                const idx = next.findIndex((item) => item.id === u.downloadId)
                if (idx === -1) continue
                if (next === prev) next = [...prev]
                next[idx] = {
                  ...next[idx],
                  receivedBytes: u.receivedBytes ?? next[idx].receivedBytes,
                  totalBytes: u.totalBytes ?? next[idx].totalBytes,
                  speedBps: u.speedBps ?? next[idx].speedBps,
                  etaSeconds: u.etaSeconds ?? next[idx].etaSeconds,
                  savePath: u.savePath ?? next[idx].savePath,
                }
              }
              if (next !== prev) downloadsRef.current = next
              return next
            })
          }, 200)
        }
        return
      }
      pendingProgressRef.current.delete(update.downloadId)
      setDownloads((prev) => {
        const idx = prev.findIndex((item) => item.id === update.downloadId)
        if (idx === -1) {
          const created = createSyntheticDownloadFromUpdate(update)
          if (!created) return prev
          const clone = [created, ...prev]
          downloadsRef.current = clone
          return clone
        }
        const existing = prev[idx]

        const terminalStates = ["completed", "extracted", "extract_failed", "failed", "cancelled"]
        const isTerminal = terminalStates.includes(existing.status)
        const nextStatus = update.status || existing.status

        const regressiveStates = ["downloading", "queued", "paused"]
        const finalStatus = isTerminal && regressiveStates.includes(nextStatus) ? existing.status : nextStatus

        const isEnteringTerminal = terminalStates.includes(finalStatus)

        const next: DownloadItem = {
          ...existing,
          status: finalStatus as DownloadStatus,
          receivedBytes: update.receivedBytes ?? existing.receivedBytes,
          totalBytes: update.totalBytes ?? existing.totalBytes,
          speedBps: isEnteringTerminal ? 0 : (update.speedBps ?? existing.speedBps),
          etaSeconds: isEnteringTerminal ? null : (update.etaSeconds ?? existing.etaSeconds),
          extractProgress:
            finalStatus === "extracting" || finalStatus === "installing"
              ? (update.extractProgress ?? existing.extractProgress ?? null)
              : finalStatus === "completed" || finalStatus === "extracted"
                ? 100
                : null,
          filename: update.filename ?? existing.filename,
          savePath: update.savePath ?? existing.savePath,
          url: update.url ?? existing.url,
          error: update.error !== undefined ? update.error : (finalStatus === "downloading" ? null : existing.error),
          partIndex: update.partIndex ?? existing.partIndex,
          partTotal: update.partTotal ?? existing.partTotal,
          update: update.update ?? existing.update,
          installMetadata: update.installMetadata ?? existing.installMetadata,
        }
        const clone = [...prev]
        clone[idx] = next
        downloadsRef.current = clone
        return clone
      })

      if (update.status === "completed" || update.status === "extracted") {
        queueMicrotask(() => {
          void startNextQueuedPart()
        })
        if (installFinished) {
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("uc_game_installed", { detail: { appid: update.appid } }))
          }
        }
      }

      if (update.appid && installFinished) {
        queueMicrotask(() => {
          void reconcileInstalledState(update.appid)
        })
      }
    })
    return () => {
      if (typeof unsubscribe === "function") unsubscribe()
      if (progressFlushTimerRef.current) {
        clearTimeout(progressFlushTimerRef.current)
        progressFlushTimerRef.current = null
      }
      pendingProgressRef.current.clear()
    }
  }, [startNextQueuedPart])

  useEffect(() => {
    if (!window.ucDownloads?.onArchiveDeletePrompt) return
    return window.ucDownloads.onArchiveDeletePrompt(async (payload) => {
      const normalized = normalizeArchivePromptPayload(payload)
      if (!normalized) return

      try {
        const autoDelete = await window.ucSettings?.get?.('autoDeleteArchives')
        if (autoDelete === true) {
          const safe = normalizeArchivePathList(normalized.archivePaths)
          if (safe.length && window.ucDownloads?.deleteArchiveFiles) {
            await window.ucDownloads.deleteArchiveFiles({ archivePaths: safe })
          }
          return
        }
      } catch {
      }

      const signature = archivePromptIdentityKey(normalized)
      setArchiveDeletionPrompts((prev) => {
        if (prev.some((entry) => archivePromptIdentityKey(entry) === signature)) return prev
        return [...prev, normalized]
      })
    })
  }, [])

  useEffect(() => {
    if (!persistenceReady) return
    const hasActive = downloads.some((item) =>
      ["downloading"].includes(item.status)
    )
    if (hasActive) return
    const hasQueued = downloads.some((item) => item.status === "queued")
    if (!hasQueued) return

    queueMicrotask(() => {
      void startNextQueuedPart()
    })
  }, [downloads, persistenceReady, startNextQueuedPart])

  useEffect(() => {
    if (typeof window === "undefined") return
    let installedSnapshot: Promise<Set<string> | undefined> | null = null
    const getInstalledSnapshot = () => {
      if (installedSnapshot) return installedSnapshot
      installedSnapshot = (async () => {
        try {
          if (window.ucDownloads?.listInstalledAppids) {
            const appids = await window.ucDownloads.listInstalledAppids()
            return Array.isArray(appids) ? new Set(appids.filter(Boolean)) : undefined
          }
          const installed = await window.ucDownloads?.listInstalled?.()
          if (!Array.isArray(installed)) return undefined
          return new Set(installed.map((item) => String(item?.appid || item?.metadata?.appid || "")).filter(Boolean))
        } catch {
          return undefined
        }
      })().finally(() => { installedSnapshot = null })
      return installedSnapshot
    }
    const reconcile = async (statuses: DownloadStatus[]) => {
      const candidates = downloadsRef.current.filter((item) => statuses.includes(item.status))
      if (!candidates.length) return
      const appids = new Set(candidates.map((item) => item.appid).filter(Boolean) as string[])
      const installedAppids = await getInstalledSnapshot()
      for (const appid of appids) {
        void reconcileInstalledState(appid, installedAppids)
      }
    }
    const interval = setInterval(() => {
      if (document.hidden) return
      void reconcile(["extracting", "installing"])
    }, 3000)
    const onReturn = () => {
      if (document.hidden) return
      void reconcile(["extracting", "installing", "paused"])
    }
    document.addEventListener("visibilitychange", onReturn)
    window.addEventListener("focus", onReturn)
    return () => {
      clearInterval(interval)
      document.removeEventListener("visibilitychange", onReturn)
      window.removeEventListener("focus", onReturn)
    }
  }, [reconcileInstalledState])

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
      let metadataForInstall: Game = game
      try {
        const detailResponse = await apiFetch(`/api/games/${encodeURIComponent(game.appid)}`)
        if (detailResponse.ok) {
          const detailed = await detailResponse.json()
          metadataForInstall = {
            ...game,
            ...(detailed && typeof detailed === "object" ? detailed : {}),
          }
        }
      } catch {
      }

      try {
        if (window.ucDownloads?.saveInstalledMetadata) {
          const metadataWithVersion = {
            ...metadataForInstall,
            downloadedVersion: metadataForInstall.version || game.version || undefined,
          }
          await window.ucDownloads.saveInstalledMetadata(game.appid, metadataWithVersion)
        }
      } catch (err) {
      }

      const downloadToken = await requestDownloadToken(game.appid)
      addDownloadedGameToHistory(game.appid)

      const linksResult = await fetchDownloadLinks(game.appid, downloadToken)

      const preferredHost =
        SUPPORTED_DOWNLOAD_HOSTS.includes(preferredHostOverride as PreferredDownloadHost)
          ? (preferredHostOverride as PreferredDownloadHost)
          : await getPreferredDownloadHost()

      let links: DownloadHostEntry[] = []
      let selectedHost = preferredHost

      if (linksResult.redirectUrl) {
        const redirectUrl = linksResult.redirectUrl
        links = [{ url: redirectUrl, part: null }]
        if (isUCFilesUrl(redirectUrl)) {
          selectedHost = "ucfiles"
        } else {
          selectedHost = preferredHost
        }
      } else {
        const selected = selectHost(linksResult.hosts)

        if (!selected.links.length) {
          throw new Error(`No download links available for "${preferredHost}". This title may not be available on your selected host.`)
        }

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
      const queue = links.map((entry, index) => {
        const filenameFallback = inferFilenameFromUrl(
          entry.url,
          `${baseName}${links.length > 1 ? `-part${entry.part ?? index + 1}` : ""}`
        )
        const downloadId = `${game.appid}-${batchId}-${index}`
        const partIndex = entry.part ?? parsePartIndexFromFilename(filenameFallback)
        return { sourceUrl: entry.url, filenameFallback, downloadId, index, partIndex }
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

      const staleStatuses: DownloadStatus[] = ["cancelled", "failed", "extract_failed"]
      const cleared = downloadsRef.current.filter((item) => !(item.appid === game.appid && staleStatuses.includes(item.status)))
      const next = [...newItems, ...cleared]
      downloadsRef.current = next
      setDownloads(next)

      try {
        await window.ucDownloads?.setInstallingStatus?.(game.appid, "queued", null)
      } catch { }

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


  const cancelGroup = useCallback(async (appid: string) => {
    if (!appid) return
    const toCancel = downloadsRef.current.filter((d) => d.appid === appid).map((d) => d.id)
    const cancelResults = new Map<string, Awaited<ReturnType<NonNullable<typeof window.ucDownloads>['cancel']>>>()
    for (const id of toCancel) {
      try {
        if (window.ucDownloads?.cancel) {
          const result = await window.ucDownloads.cancel(id)
          cancelResults.set(id, result)
        }
      } catch (e) { }
    }

    const keepArchive =
      Array.from(cancelResults.values()).some((r) => r?.status === "install_ready") ||
      downloadsRef.current.some((d) => d.appid === appid && ["completed", "extracted", "install_ready"].includes(String(d.status)))
    if (!keepArchive) {
      const next = downloadsRef.current.filter((item) => item.appid !== appid)
      downloadsRef.current = next
      setDownloads(next)
      try { await window.ucDownloads?.deleteInstalling?.(appid) } catch { }
      return
    }

    setDownloads((prev) =>
      prev.map((item) =>
        item.appid === appid
          ? {
            ...item,
            status: cancelResults.get(item.id)?.status === "install_ready" ? "install_ready" : "cancelled",
            error: cancelResults.get(item.id)?.error || (cancelResults.get(item.id)?.status === "install_ready"
              ? "Installation stopped. Archive kept. Click Install to continue."
              : "Cancelled"),
          }
          : item
      )
    )
  }, [])

  const discardGroup = useCallback(async (appid: string) => {
    if (!appid) return
    const next = downloadsRef.current.filter((item) => item.appid !== appid)
    downloadsRef.current = next
    setDownloads(next)
    try { await window.ucDownloads?.deleteInstalling?.(appid) } catch {  }
  }, [])

  const pauseGroup = useCallback(
    async (appid: string) => {
      if (!appid) return
      const current = downloadsRef.current.filter((item) => item.appid === appid)
      if (!current.length) return

      const toPause = current.filter((item) => PAUSABLE_STATUSES.includes(item.status))
      for (const item of toPause) {
        try {
          if (window.ucDownloads?.pause) {
            await window.ucDownloads.pause(item.id)
          }
        } catch {
        }
      }

      setDownloads((prev) => {
        const next = prev.map((item) => {
          if (item.appid !== appid) return item
          if (item.status === "queued" || PAUSABLE_STATUSES.includes(item.status)) {
            return { ...item, status: "paused" as DownloadStatus, error: null }
          }
          return item
        })
        downloadsRef.current = next
        return next
      })
    },
    []
  )

  const resumeDownload = useCallback(
    async (downloadId: string) => {
      if (resumeLocksRef.current.has(downloadId)) {
        downloadLogger.info("Resume skipped: already in progress", { data: { downloadId } })
        return
      }
      resumeLocksRef.current.add(downloadId)
      try {
      const target = downloadsRef.current.find((item) => item.id === downloadId)
      if (!target) return

      downloadLogger.info("Resume attempt", { data: { downloadId, host: target.host, status: target.status } })

      if (target.appid && window.ucDownloads) {
        try {
          const installed = await window.ucDownloads.getInstalled?.(target.appid)
          if (installed) {
            downloadLogger.info("Resume skipped: game already installed", { data: { appid: target.appid } })
            setDownloads((prev) =>
              prev.map((item) =>
                item.appid === target.appid && !["completed", "extracted"].includes(item.status)
                  ? { ...item, status: "completed" as DownloadStatus, error: null, completedAt: Date.now(), speedBps: 0, etaSeconds: null, receivedBytes: item.totalBytes || item.receivedBytes }
                  : item
              )
            )
            return
          }
        } catch { }

        try {
          const activeStatus = await window.ucDownloads.getActiveStatus?.(target.appid)
          if (activeStatus?.extracting) {
            downloadLogger.info("Resume skipped: extraction still running in main process", { data: { appid: target.appid } })
            setDownloads((prev) =>
              prev.map((item) =>
                item.id === downloadId ? { ...item, status: "extracting" as DownloadStatus, error: null } : item
              )
            )
            return
          }
        } catch { }
      }

      let ok = false

      if (window.ucDownloads?.resume) {
        try {
          const res = await window.ucDownloads.resume(downloadId)
          ok = Boolean(res && typeof res === "object" && "ok" in res ? (res as { ok?: boolean }).ok : res)
          downloadLogger.info("Resume Level 1 (in-memory)", { data: { ok } })
        } catch {
          ok = false
        }
      }

      if (!ok && window.ucDownloads?.start) {
        if (target.appid) sequenceLocksRef.current.add(target.appid)
        try {
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

          const freshSource = await resolveFreshResumeSource(target)
          const resolveUrl = freshSource?.sourceUrl || target.originalUrl || target.url
          downloadLogger.info("Resume Level 2 (re-resolve)", {
            data: { host: freshSource?.host || target.host, resolveUrl, usedFreshSource: Boolean(freshSource?.sourceUrl) },
          })
          const resolved = await resolveWithTimeout(freshSource?.host || target.host, resolveUrl)
          downloadLogger.info("Resume Level 2 resolved", { data: { resolvedUrl: resolved?.url, resolvedOk: resolved?.resolved } })
          const freshUrl = resolved?.resolved ? resolved.url : target.url

          try {
            const res = await window.ucDownloads.start({
              downloadId,
              url: freshUrl,
              filename: resolved?.filename || target.filename,
              appid: target.appid,
              gameName: target.gameName,
              partIndex: target.partIndex,
              partTotal: target.partTotal,
              ...(target.savePath ? { savePath: target.savePath } : {}),
              totalBytes: resolved?.size || target.totalBytes,
              update: target.update,
              installMetadata: target.installMetadata,
            } as Parameters<typeof window.ucDownloads.start>[0])
            downloadLogger.info("Resume Level 2 start result", { data: res })
            ok = true
          } catch (e) {
            downloadLogger.warn("Resume Level 2 start failed", { data: e })
          }

          setDownloads((prev) =>
            prev.map((item) =>
              item.id === downloadId
                ? {
                  ...item,
                  originalUrl: freshSource?.sourceUrl || item.originalUrl || resolveUrl,
                  url: freshUrl,
                  host: freshSource?.host || (item.host && item.host !== "local" ? item.host : "ucfiles"),
                  status: "downloading",
                  totalBytes: resolved?.size || item.totalBytes,
                }
                : item
            )
          )
        } catch (err) {
          downloadLogger.warn("Resume Level 2 failed", { data: err })
          ok = false
        } finally {
          if (target.appid) sequenceLocksRef.current.delete(target.appid)
        }
      }

      if (!ok) {
        setDownloads((prev) =>
          prev.map((item) =>
            item.id === downloadId ? { ...item, status: "failed", error: "Resume failed. Please try again." } : item
          )
        )
        if (target.appid && !target.update) {
          await window.ucDownloads?.setInstallingStatus?.(target.appid, "failed", "Resume failed. Please try again.")
        }
      }
      } finally {
        resumeLocksRef.current.delete(downloadId)
      }
    },
    [resolveFreshResumeSource, resolveWithTimeout]
  )

  const resumeGroup = useCallback(
    async (appid: string) => {
      if (!appid) return
      const current = downloadsRef.current.filter((item) => item.appid === appid)
      const hasActive = current.some((item) =>
        ["downloading", "extracting", "installing"].includes(item.status)
      )
      if (hasActive) return
      const pausedWithProgress = current
        .filter((item) => item.status === "paused")
        .sort((a, b) => (b.receivedBytes || 0) - (a.receivedBytes || 0))
        .find((item) => item.receivedBytes > 0 || item.totalBytes > 0)
      if (pausedWithProgress) {
        await resumeDownload(pausedWithProgress.id)
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
        const failedSiblings = current.filter(
          (item) => item.id !== pausedWithProgress.id && (item.status === "failed" || item.status === "extract_failed")
        )
        for (const item of failedSiblings) {
          await resumeDownload(item.id)
        }
        return
      }

      const failed = current
        .filter((item) => item.status === "failed" || item.status === "extract_failed")
        .sort((a, b) => (a.partIndex || 0) - (b.partIndex || 0))
      if (failed.length > 0) {
        for (const item of failed) {
          await resumeDownload(item.id)
        }
        setDownloads((prev) => {
          const next = prev.map((item) => {
            if (item.appid === appid && item.status === "paused" && item.receivedBytes === 0) {
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

  const pauseAll = useCallback(async () => {
    const appids = [...new Set(
      downloadsRef.current
        .filter((item) => PAUSABLE_STATUSES.includes(item.status))
        .map((item) => item.appid)
        .filter(Boolean)
    )]
    for (const appid of appids) {
      await pauseGroup(appid)
    }
  }, [pauseGroup])

  const resumeAll = useCallback(async () => {
    const appids = [...new Set(
      downloadsRef.current
        .filter((item) => item.status === "paused")
        .map((item) => item.appid)
        .filter(Boolean)
    )]
    for (const appid of appids) {
      await resumeGroup(appid)
    }
  }, [resumeGroup])

  const upsertDownload = useCallback((download: DownloadItem) => {
    setDownloads((prev) => {
      const idx = prev.findIndex((item) => item.id === download.id)
      if (idx === -1) {
        const next = [download, ...prev]
        downloadsRef.current = next
        return next
      }
      const next = [...prev]
      next[idx] = {
        ...next[idx],
        ...download,
        startedAt: next[idx].startedAt || download.startedAt,
      }
      downloadsRef.current = next
      return next
    })
  }, [])


  const clearCompleted = useCallback(() => {
    setDownloads((prev) =>
      prev.filter(
        (item) =>
          !["completed", "extracted", "extract_failed", "failed", "cancelled"].includes(item.status)
      )
    )
    queueMicrotask(() => {
      void startNextQueuedPart()
    })
  }, [])

  const clearByAppid = useCallback((appid: string) => {
    if (!appid) return
    setDownloads((prev) => prev.filter((item) => item.appid !== appid))
  }, [])

  const dismissArchiveDeletionPrompt = useCallback(() => {
    setArchiveDeletionError(null)
    setArchiveDeletionPrompts((prev) => prev.slice(1))
  }, [])

  const currentArchiveDeletionPrompt = archiveDeletionPrompts[0] || null
  const currentArchiveFolderPath = currentArchiveDeletionPrompt
    ? resolveArchiveFolderPath(currentArchiveDeletionPrompt.archivePaths)
    : null

  useEffect(() => {
    if (!currentArchiveDeletionPrompt) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (archiveDeletionBusy) return
      event.preventDefault()
      dismissArchiveDeletionPrompt()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [archiveDeletionBusy, currentArchiveDeletionPrompt, dismissArchiveDeletionPrompt])

  const deletePromptArchives = useCallback(async () => {
    const currentPrompt = archiveDeletionPrompts[0]
    if (!currentPrompt || !window.ucDownloads?.deleteArchiveFiles) return
    const safeArchivePaths = normalizeArchivePathList(currentPrompt.archivePaths)
    if (!safeArchivePaths.length) {
      setArchiveDeletionPrompts((prev) => prev.slice(1))
      return
    }
    setArchiveDeletionBusy(true)
    setArchiveDeletionError(null)
    try {
      const result = await window.ucDownloads.deleteArchiveFiles({ archivePaths: safeArchivePaths })
      if (!result?.ok) {
        throw new Error(result?.error || "Failed to delete archive files")
      }
      if (archiveDontAskAgain) {
        try { await window.ucSettings?.set?.('autoDeleteArchives', true) } catch {}
        setArchiveDontAskAgain(false)
      }
      setArchiveDeletionPrompts((prev) => prev.slice(1))
    } catch (error) {
      setArchiveDeletionError(error instanceof Error ? error.message : "Failed to delete archive files")
    } finally {
      setArchiveDeletionBusy(false)
    }
  }, [archiveDeletionPrompts, archiveDontAskAgain])

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

  const actionsValue = useMemo<DownloadsActionsValue>(
    () => ({
      startGameDownload,
      cancelGroup,
      discardGroup,
      pauseGroup,
      pauseAll,
      resumeDownload,
      resumeGroup,
      resumeAll,
      upsertDownload,
      openPath,
      clearByAppid,
      clearCompleted,
    }),
    [startGameDownload, cancelGroup, discardGroup, pauseGroup, pauseAll, resumeDownload, resumeGroup, resumeAll, upsertDownload, openPath, clearByAppid, clearCompleted]
  )

  return (
    <DownloadsStoreContext.Provider value={store}>
      <DownloadsActionsContext.Provider value={actionsValue}>
        {children}
        {currentArchiveDeletionPrompt && (
            <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
              <div className="absolute inset-0 bg-black/72 backdrop-blur-md" onClick={() => !archiveDeletionBusy && dismissArchiveDeletionPrompt()} />
              <div className="relative w-full max-w-lg rounded-3xl border border-white/[.07] bg-background/88 backdrop-blur-2xl p-5 shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
                <div className="space-y-1">
                  <h3 className="text-lg font-semibold text-white">Delete installer archive?</h3>
                  <p className="text-sm text-muted-foreground">
                    {currentArchiveDeletionPrompt.gameName || "This game"} finished installing. You can keep the installer cache for reinstalling later, or delete it now to free up space.
                  </p>
                </div>

                <div className="mt-4 rounded-xl border border-white/[.08] bg-card/70 p-4 text-sm text-foreground/90">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Archive size</span>
                    <span className="font-mono">{fmtBytes(currentArchiveDeletionPrompt.totalBytes, "0 B")}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Archive files</span>
                    <span className="font-mono">{currentArchiveDeletionPrompt.archivePaths.length}</span>
                  </div>
                </div>

                {archiveDeletionError ? (
                  <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                    {archiveDeletionError}
                  </div>
                ) : null}

                <label className="mt-4 flex items-center gap-2 text-sm text-foreground/80 cursor-pointer select-none">
                  <Checkbox
                    checked={archiveDontAskAgain}
                    onCheckedChange={(checked) => setArchiveDontAskAgain(checked === true)}
                    disabled={archiveDeletionBusy}
                  />
                  <span>Don't ask again — auto-delete future archives</span>
                </label>
                <p className="mt-1 ml-6 text-xs text-muted-foreground/80">
                  You can turn the prompt back on in Settings → Downloads.
                </p>

                <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button variant="ghost" onClick={dismissArchiveDeletionPrompt} disabled={archiveDeletionBusy}>
                    Keep archive
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => currentArchiveFolderPath ? void openPath(currentArchiveFolderPath) : undefined}
                    disabled={archiveDeletionBusy || !currentArchiveFolderPath}
                    className="border-white/[.08] text-foreground/90"
                  >
                    Open archives folder
                  </Button>
                  <Button onClick={() => void deletePromptArchives()} disabled={archiveDeletionBusy} className="bg-primary text-primary-foreground hover:brightness-110">
                    {archiveDeletionBusy ? "Deleting..." : "Delete archive"}
                  </Button>
                </div>
              </div>
            </div>
        )}
      </DownloadsActionsContext.Provider>
    </DownloadsStoreContext.Provider>
  )
}


export function useDownloadsActions() {
  const actions = useContext(DownloadsActionsContext)
  if (!actions) {
    throw new Error("useDownloadsActions must be used within DownloadsProvider")
  }
  return actions
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
