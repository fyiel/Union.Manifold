import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { useSearchParams, Link } from "react-router-dom"
import { GameActionContextMenu, GameActionMenuPanel } from "@/components/GameActionMenu"
import { GameCard } from "@/components/GameCard"
import { GameCardSkeleton } from "@/components/GameCardSkeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PaginationBar } from "@/components/PaginationBar"
import { useGamesData } from "@/hooks/use-games"
import type { Game } from "@/lib/types"
import { hasInstalledVersionUpdate, pickGameExecutable, cn } from "@/lib/utils"
import { useDownloads, useDownloadsActions } from "@/context/downloads-context"
import { getCatalogCache, type CatalogGame } from "@/lib/catalog"
import {
  Trash2, AlertTriangle, FolderOpen, ExternalLink, Unlink2,
  Terminal, CheckSquare2, Layers3, Search, ArrowUpDown, Settings2,
  X, Loader2, Check, MoreHorizontal, Download,
} from "lucide-react"
import { ExePickerModal } from "@/components/ExePickerModal"
import { EditGameMetadataModal } from "@/components/EditGameMetadataModal"
import { GameLinuxConfigModal } from "@/components/GameLinuxConfigModal"
import { CollectionPill, NewCollectionInline } from "@/components/LibraryFilterChips"
import { useUserCollections } from "@/hooks/use-user-collections"
import type { CollectionPickerEntry } from "@/components/GameActionMenu"
import { gameLogger } from "@/lib/logger"

type LibraryGameMeta = {
  collections?: string[]
  tags?: string[]
  lastPlayedAt?: number
}

type LibraryGame = Game & {
  installedAt?: number
  libraryMeta?: LibraryGameMeta
}

type LibraryEntry = {
  appid: string
  name?: string
  metadata?: Game & { installedAt?: number }
  installStatus?: string
  installError?: string
  installedAt?: number
}

type BatchActionResult = {
  ok: number
  failed: number
}

function normalizeLibraryToken(value: string) {
  return value.trim().replace(/\s+/g, " ")
}

function dedupeCaseInsensitive(values: string[]) {
  const seen = new Set<string>()
  const next: string[] = []
  for (const value of values) {
    const normalized = normalizeLibraryToken(value)
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    next.push(normalized)
  }
  return next.sort((left, right) => left.localeCompare(right))
}

function manifestToGame(entry: LibraryEntry): LibraryGame | null {
  const meta = entry && (entry.metadata as (Game & { installedAt?: number }) | undefined)
  const installedAt = typeof entry?.installedAt === "number"
    ? entry.installedAt
    : typeof meta?.installedAt === "number"
      ? meta.installedAt
      : undefined

  if (meta && meta.appid) {
    const isExternal = Boolean((entry as any).isExternal || meta.isExternal)
    const externalPath = (entry as any).externalPath || meta.externalPath || undefined
    return { ...meta, isExternal, externalPath, installedAt }
  }
  if (entry && entry.appid) {
    return {
      appid: entry.appid,
      name: entry.name || entry.appid,
      description: "",
      genres: [],
      image: "./banner.png",
      release_date: "",
      size: "",
      source: "local",
      screenshots: [],
      developer: "",
      store: "",
      dlc: [],
      isExternal: Boolean((entry as any).isExternal),
      externalPath: (entry as any).externalPath || undefined,
      installedAt,
    }
  }
  return null
}

function scoreLibraryGame(game: Game): number {
  let score = 0
  if (game.source && game.source !== "local") score += 3
  if (game.name && game.name !== game.appid) score += 1
  if (game.description) score += 1
  if (game.image && game.image !== "./banner.png") score += 1
  if (game.release_date) score += 1
  if (game.size) score += 1
  if (game.genres && game.genres.length > 0) score += 1
  if (game.screenshots && game.screenshots.length > 0) score += 1
  if (game.developer) score += 1
  if (game.store) score += 1
  return score
}

function dedupeLibraryGames(games: LibraryGame[]): LibraryGame[] {
  const map = new Map<string, LibraryGame>()
  for (const game of games) {
    if (!game?.appid) continue
    const existing = map.get(game.appid)
    if (!existing) {
      map.set(game.appid, game)
      continue
    }
    const existingScore = scoreLibraryGame(existing)
    const nextScore = scoreLibraryGame(game)
    if (nextScore > existingScore) {
      map.set(game.appid, game)
      continue
    }
    if (nextScore === existingScore && (game.installedAt || 0) > (existing.installedAt || 0)) {
      map.set(game.appid, game)
    }
  }
  return Array.from(map.values())
}

function formatRelativeTimestamp(timestamp?: number) {
  if (!timestamp) return null
  const deltaMs = Date.now() - timestamp
  if (deltaMs < 60_000) return "just now"
  const deltaMinutes = Math.round(deltaMs / 60_000)
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`
  const deltaHours = Math.round(deltaMinutes / 60)
  if (deltaHours < 48) return `${deltaHours}h ago`
  const deltaDays = Math.round(deltaHours / 24)
  return `${deltaDays}d ago`
}

export function LibraryPage() {
  const { games, stats, loading: statsLoading } = useGamesData()
  const { downloads, clearByAppid } = useDownloads()
  const [loading, setLoading] = useState(true)
  const [installed, setInstalled] = useState<LibraryGame[]>([])
  const [installing, setInstalling] = useState<LibraryGame[]>([])
  const [installingMeta, setInstallingMeta] = useState<Record<string, { status?: string; error?: string }>>({})
  const [libraryGameMeta, setLibraryGameMeta] = useState<Record<string, LibraryGameMeta>>({})
  const [refreshTick, setRefreshTick] = useState(0)
  const [hiddenAppIds, setHiddenAppIds] = useState<Set<string>>(new Set())
  const [pendingDeleteGame, setPendingDeleteGame] = useState<Game | null>(null)
  const [pendingDeleteAction, setPendingDeleteAction] = useState<"installed" | "installing" | null>(null)
  const [exePickerOpen, setExePickerOpen] = useState(false)
  const [exePickerTitle, setExePickerTitle] = useState("")
  const [exePickerMessage, setExePickerMessage] = useState("")
  const [exePickerAppId, setExePickerAppId] = useState<string | null>(null)
  const [exePickerExes, setExePickerExes] = useState<Array<{ name: string; path: string; size?: number; depth?: number }>>([])
  const [exePickerCurrentPath, setExePickerCurrentPath] = useState<string | null>(null)
  const [exePickerFolder, setExePickerFolder] = useState<string | null>(null)
  const [settingsPopupOpen, setSettingsPopupOpen] = useState(false)
  const [settingsPopupGame, setSettingsPopupGame] = useState<LibraryGame | null>(null)
  const [shortcutFeedback, setShortcutFeedback] = useState<{ appid: string; type: 'success' | 'error'; message: string } | null>(null)
  const [cardContextMenu, setCardContextMenu] = useState<{ game: LibraryGame; position: { x: number; y: number } } | null>(null)
  const [editMetadataOpen, setEditMetadataOpen] = useState(false)
  const [linuxConfigOpen, setLinuxConfigOpen] = useState(false)
  const [linuxConfigGame, setLinuxConfigGame] = useState<LibraryGame | null>(null)
    const [batchDeleteConfirmOpen, setBatchDeleteConfirmOpen] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const [librarySearch, setLibrarySearch] = useState("")
  const [selectedCollection, setSelectedCollection] = useState(() => searchParams.get("collection") || "all")

  // Keep URL in sync so external links (e.g. sidebar Collections) and back/forward work.
  useEffect(() => {
    const urlCollection = searchParams.get("collection") || "all"
    if (urlCollection !== selectedCollection) setSelectedCollection(urlCollection)
    // Only react to URL changes, not internal state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    if (selectedCollection === "all") next.delete("collection")
    else next.set("collection", selectedCollection)
    // Drop legacy tag param if it exists.
    next.delete("tag")
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCollection])
  const [sortMode, setSortMode] = useState<'name' | 'recent-install' | 'recent-play'>('name')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedAppIds, setSelectedAppIds] = useState<Set<string>>(new Set())
  const [collectionDraft, setCollectionDraft] = useState("")
  const [batchFeedback, setBatchFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [batchWorking, setBatchWorking] = useState(false)
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null)
  const isLinux = typeof navigator !== 'undefined' && /linux/i.test(navigator.userAgent)
  const itemsPerPage = 24
  const [installedPage, setInstalledPage] = useState(1)
  const [installingPage, setInstallingPage] = useState(1)
  const hasLoadedRef = useRef(false)

  // Debounced search: only apply the search filter after 250ms of no typing
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleSearchChange = useCallback((value: string) => {
    setLibrarySearch(value)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => setDebouncedSearch(value), 250)
  }, [])
  useEffect(() => {
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [])

  useEffect(() => {
    const onCycleSort = () => {
      setSortMode((prev) => {
        if (prev === 'name') return 'recent-install'
        if (prev === 'recent-install') return 'recent-play'
        return 'name'
      })
    }

    window.addEventListener('uc_library_cycle_sort', onCycleSort)
    return () => window.removeEventListener('uc_library_cycle_sort', onCycleSort)
  }, [])

  useEffect(() => {
    if (!batchDeleteConfirmOpen && !pendingDeleteGame) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (batchDeleteConfirmOpen) {
        setBatchDeleteConfirmOpen(false)
      }
      if (pendingDeleteGame) {
        setPendingDeleteGame(null)
        setPendingDeleteAction(null)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [batchDeleteConfirmOpen, pendingDeleteGame])

  useEffect(() => {
    if (!selectionMode) return
    setSettingsPopupOpen(false)
    setCardContextMenu(null)
    setShortcutFeedback(null)
  }, [selectionMode])

  const persistLibraryGameMeta = async (nextMeta: Record<string, LibraryGameMeta>) => {
    setLibraryGameMeta(nextMeta)
    try {
      await window.ucSettings?.set?.('libraryGameMeta', nextMeta)
    } catch { }
  }

  const updateLibraryGameMeta = async (appids: string[], mutate: (current: LibraryGameMeta) => LibraryGameMeta) => {
    const nextMeta = { ...libraryGameMeta }
    for (const appid of appids) {
      nextMeta[appid] = mutate(nextMeta[appid] || {})
    }
    await persistLibraryGameMeta(nextMeta)
  }

  const cancelledAppIds = useMemo(() => {
    const ids = new Set<string>()
    for (const item of downloads) {
      if (item.status === "cancelled" && item.appid) ids.add(item.appid)
    }
    return ids
  }, [downloads])

  const installedWithMeta = useMemo(() => {
    return installed
      .filter((game) => !hiddenAppIds.has(game.appid))
      .map((game) => ({
        ...game,
        libraryMeta: libraryGameMeta[game.appid] || {},
      }))
  }, [installed, hiddenAppIds, libraryGameMeta])

  const availableCollections = useMemo(() => {
    return dedupeCaseInsensitive(installedWithMeta.flatMap((game) => game.libraryMeta?.collections || []))
  }, [installedWithMeta])

  const filteredInstalled = useMemo(() => {
    const normalizedSearch = debouncedSearch.trim().toLowerCase()
    const next = installedWithMeta.filter((game) => {
      if (selectedCollection !== "all" && !(game.libraryMeta?.collections || []).some((value) => value.toLowerCase() === selectedCollection.toLowerCase())) {
        return false
      }
      if (!normalizedSearch) return true
      const haystack = [
        game.name,
        game.appid,
        game.developer,
        game.store,
        ...(game.libraryMeta?.collections || []),
      ].join(" ").toLowerCase()
      return haystack.includes(normalizedSearch)
    })

    next.sort((left, right) => {
      if (sortMode === 'recent-install') {
        return (right.installedAt || 0) - (left.installedAt || 0) || left.name.localeCompare(right.name)
      }
      if (sortMode === 'recent-play') {
        return (right.libraryMeta?.lastPlayedAt || 0) - (left.libraryMeta?.lastPlayedAt || 0) || left.name.localeCompare(right.name)
      }
      return left.name.localeCompare(right.name)
    })
    return next
  }, [installedWithMeta, debouncedSearch, selectedCollection, sortMode])

  const catalogVersionByAppid = useMemo(() => {
    return new Map(games.map((game) => [game.appid, game.version || ""]))
  }, [games])

  const visibleInstalling = useMemo(() => {
    return installing.filter((game) => {
      if (hiddenAppIds.has(game.appid)) return false
      if (cancelledAppIds.has(game.appid)) return false
      return true
    })
  }, [installing, hiddenAppIds, cancelledAppIds])

  const installedTotalPages = Math.max(1, Math.ceil(filteredInstalled.length / itemsPerPage))
  const installingTotalPages = Math.max(1, Math.ceil(visibleInstalling.length / itemsPerPage))

  const pagedInstalled = useMemo(() => {
    const start = (installedPage - 1) * itemsPerPage
    return filteredInstalled.slice(start, start + itemsPerPage)
  }, [filteredInstalled, installedPage, itemsPerPage])

  const pagedInstalling = useMemo(() => {
    const start = (installingPage - 1) * itemsPerPage
    return visibleInstalling.slice(start, start + itemsPerPage)
  }, [visibleInstalling, installingPage, itemsPerPage])

  const selectedInstalledGames = useMemo(() => {
    return filteredInstalled.filter((game) => selectedAppIds.has(game.appid))
  }, [filteredInstalled, selectedAppIds])

  const cancelledKey = useMemo(() => {
    if (!cancelledAppIds.size) return ""
    return Array.from(cancelledAppIds).sort().join("|")
  }, [cancelledAppIds])

  const failedAppIds = useMemo(() => {
    const ids = new Set<string>()
    const activeOrQueuedAppIds = new Set<string>()

    for (const item of downloads) {
      if (!item.appid) continue
      if (["queued", "downloading", "paused", "extracting", "installing", "verifying", "retrying"].includes(item.status)) {
        activeOrQueuedAppIds.add(item.appid)
      }
    }

    for (const item of downloads) {
      if ((item.status === "failed" || item.status === "extract_failed") && item.appid && !activeOrQueuedAppIds.has(item.appid)) {
        ids.add(item.appid)
      }
    }
    for (const [appid, meta] of Object.entries(installingMeta)) {
      if (meta?.status === "failed" && !activeOrQueuedAppIds.has(appid)) ids.add(appid)
    }
    return ids
  }, [downloads, installingMeta])

  const failedKey = useMemo(() => {
    if (!failedAppIds.size) return ""
    return Array.from(failedAppIds).sort().join("|")
  }, [failedAppIds])

  useEffect(() => {
    let mounted = true
    const loadLibrary = async () => {
      if (!hasLoadedRef.current) setLoading(true)
      try {
        const [installedList, installingList] = await Promise.all([
          window.ucDownloads?.listInstalledGlobal?.() || window.ucDownloads?.listInstalled?.() || [],
          window.ucDownloads?.listInstallingGlobal?.() || window.ucDownloads?.listInstalling?.() || [],
        ])
        if (!mounted) return
        const installedGames = dedupeLibraryGames(
          installedList
            .map((entry: LibraryEntry) => manifestToGame(entry))
            .filter(Boolean) as LibraryGame[]
        )
        const installingMetaMap: Record<string, { status?: string; error?: string }> = {}
        const installingGames = dedupeLibraryGames(
          installingList
            .map((entry: LibraryEntry) => manifestToGame(entry))
            .filter(Boolean) as LibraryGame[]
        )
        for (const entry of installingList as LibraryEntry[]) {
          if (!entry?.appid) continue
          installingMetaMap[entry.appid] = { status: entry.installStatus, error: entry.installError }
        }
        setInstalled(installedGames)
        setInstalling(installingGames)
        setInstallingMeta(installingMetaMap)
      } finally {
        if (mounted) {
          setLoading(false)
          hasLoadedRef.current = true
        }
      }
    }
    void loadLibrary()
    return () => {
      mounted = false
    }
  }, [refreshTick, cancelledKey, failedKey])

  useEffect(() => {
    let mounted = true
    const loadLibraryMeta = async () => {
      try {
        const value = await window.ucSettings?.get?.('libraryGameMeta')
        if (!mounted) return
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          setLibraryGameMeta(value as Record<string, LibraryGameMeta>)
        } else {
          setLibraryGameMeta({})
        }
      } catch {
        if (mounted) setLibraryGameMeta({})
      }
    }
    void loadLibraryMeta()
    const off = window.ucSettings?.onChanged?.((data: any) => {
      if (!data?.key) return
      if (data.key === '__CLEAR_ALL__') {
        setLibraryGameMeta({})
        return
      }
      if (data.key === 'libraryGameMeta') {
        if (data.value && typeof data.value === 'object' && !Array.isArray(data.value)) {
          setLibraryGameMeta(data.value as Record<string, LibraryGameMeta>)
        } else {
          setLibraryGameMeta({})
        }
      }
    })
    return () => {
      mounted = false
      if (typeof off === 'function') off()
    }
  }, [])

  useEffect(() => {
    setInstalledPage((page) => Math.min(page, installedTotalPages))
  }, [installedTotalPages])

  useEffect(() => {
    setInstallingPage((page) => Math.min(page, installingTotalPages))
  }, [installingTotalPages])

  useEffect(() => {
    setSelectedAppIds((prev) => {
      const next = new Set<string>()
      for (const appid of prev) {
        if (filteredInstalled.some((game) => game.appid === appid)) next.add(appid)
      }
      return next
    })
  }, [filteredInstalled])

  const showBatchFeedback = (type: 'success' | 'error', message: string) => {
    setBatchFeedback({ type, message })
    setTimeout(() => setBatchFeedback(null), 3000)
  }

  const handleDeleteInstalled = async (game: Game) => {
    setHiddenAppIds((prev) => {
      const next = new Set(prev)
      next.add(game.appid)
      return next
    })
    setInstalled((prev) => prev.filter((item) => item.appid !== game.appid))
    try {
      await window.ucDownloads?.deleteInstalled?.(game.appid)
      await window.ucDownloads?.deleteDesktopShortcut?.(game.name)
      clearByAppid(game.appid)
    } finally {
      setRefreshTick((tick) => tick + 1)
      setSelectedAppIds((prev) => {
        const next = new Set(prev)
        next.delete(game.appid)
        return next
      })
      setHiddenAppIds((prev) => {
        const next = new Set(prev)
        next.delete(game.appid)
        return next
      })
    }
  }

  const handleDeleteInstalling = async (game: Game) => {
    // Optimistically hide and remove from local state immediately
    setHiddenAppIds((prev) => {
      const next = new Set(prev)
      next.add(game.appid)
      return next
    })
    setInstalling((prev) => prev.filter((item) => item.appid !== game.appid))
    setInstallingMeta((prev) => {
      const next = { ...prev }
      delete next[game.appid]
      return next
    })
    try {
      await window.ucDownloads?.deleteInstalling?.(game.appid)
      clearByAppid(game.appid)
    } finally {
      // Trigger a reload — but do NOT remove from hiddenAppIds here.
      // If the backend is slow, the next list response may still return
      // this game; keeping it in hiddenAppIds ensures it stays invisible.
      setRefreshTick((tick) => tick + 1)
    }
  }

  const getSavedExe = async (appid: string) => {
    if (!window.ucSettings?.get) return null
    try {
      return await window.ucSettings.get(`gameExe:${appid}`) || null
    } catch {
      return null
    }
  }

  const setSavedExe = async (appid: string, path: string | null) => {
    if (!window.ucSettings?.set) return
    try {
      await window.ucSettings.set(`gameExe:${appid}`, path || null)
    } catch { }
  }

  const dirname = (targetPath: string | null | undefined) => {
    if (!targetPath) return null
    const parts = targetPath.split(/[/\\]+/).filter(Boolean)
    parts.pop()
    return parts.length ? parts.join("\\") : null
  }

  const openExecutablePicker = async (game: Game) => {
    if (!window.ucDownloads?.listGameExecutables) return
    try {
      const [result, savedExe] = await Promise.all([
        window.ucDownloads.listGameExecutables(game.appid),
        getSavedExe(game.appid),
      ])
      const exes = result?.exes || []
      const folder = result?.folder || null
      setExePickerTitle("Set launch executable")
      setExePickerMessage(`Select the exe to launch for "${game.name}".`)
      setExePickerAppId(game.appid)
      setExePickerExes(exes)
      setExePickerCurrentPath(savedExe)
      setExePickerFolder(folder)
      setExePickerOpen(true)
    } catch {
      setExePickerTitle("Set launch executable")
      setExePickerMessage(`Unable to list executables for "${game.name}".`)
      setExePickerAppId(null)
      setExePickerExes([])
      setExePickerCurrentPath(null)
      setExePickerFolder(null)
      setExePickerOpen(true)
    }
  }

  const handleOpenGameFiles = async (game: Game) => {
    try {
      let folder: string | null = null
      let discoveredExePath: string | null = null
      if (window.ucDownloads?.listGameExecutables) {
        const result = await window.ucDownloads.listGameExecutables(game.appid)
        folder = result?.folder || null
        if (result?.exes?.[0]?.path) {
          discoveredExePath = result.exes[0].path
        }
      }

      const preferredExePath = discoveredExePath
      const exeDir = preferredExePath ? dirname(preferredExePath) : null
      const candidate = exeDir || null
      if (folder && candidate && candidate.toLowerCase().startsWith(folder.toLowerCase())) {
        folder = candidate
      } else if (!folder && candidate) {
        folder = candidate
      } else if (folder && window.ucDownloads?.findGameSubfolder) {
        const subfolder = await window.ucDownloads.findGameSubfolder(folder)
        if (subfolder) {
          folder = subfolder
        }
      }

      if (folder && window.ucDownloads?.openPath) {
        await window.ucDownloads.openPath(folder)
      }
    } catch (err) {
      console.error("[UC] Failed to open game files", err)
    }
  }

  const handleCreateShortcutForGame = async (game: LibraryGame) => {
    setShortcutFeedback(null)

    try {
      const exePath = await getSavedExe(game.appid)
      const result = await window.ucDownloads?.createDesktopShortcut?.(game.name, game.appid, exePath || undefined)
      if (result?.ok) {
        gameLogger.info('Desktop shortcut created manually', { appid: game.appid })
        setShortcutFeedback({ appid: game.appid, type: 'success', message: 'Desktop shortcut created.' })
      } else {
        setShortcutFeedback({ appid: game.appid, type: 'error', message: 'Failed to create desktop shortcut.' })
      }
    } catch {
      setShortcutFeedback({ appid: game.appid, type: 'error', message: 'Failed to create desktop shortcut.' })
    }

    window.setTimeout(() => {
      setShortcutFeedback((current) => current?.appid === game.appid ? null : current)
    }, 3000)
  }

  const handleExePicked = async (path: string) => {
    if (!exePickerAppId) return
    await setSavedExe(exePickerAppId, path)
    setExePickerCurrentPath(path)
  }

  const openGameActionPopover = (game: LibraryGame) => {
    setCardContextMenu(null)
    setShortcutFeedback(null)
    setSettingsPopupGame(game)
    setSettingsPopupOpen(true)
  }

  const closeGameActionMenus = () => {
    setSettingsPopupOpen(false)
    setCardContextMenu(null)
    setShortcutFeedback(null)
  }

  const openGameActionContextMenu = (game: LibraryGame, position: { x: number; y: number }) => {
    setSettingsPopupOpen(false)
    setShortcutFeedback(null)
    setSettingsPopupGame(game)
    setCardContextMenu({ game, position })
  }

  const toggleSelected = (appid: string) => {
    setSelectedAppIds((prev) => {
      const next = new Set(prev)
      if (next.has(appid)) next.delete(appid)
      else next.add(appid)
      return next
    })
  }

  const runBatchShortcutCreation = async (onProgress?: (done: number, total: number) => void): Promise<BatchActionResult> => {
    let ok = 0
    let failed = 0
    const total = selectedInstalledGames.length
    for (let i = 0; i < total; i++) {
      const game = selectedInstalledGames[i]
      onProgress?.(i, total)

      try {
        const exePath = await getSavedExe(game.appid)
        const result = await window.ucDownloads?.createDesktopShortcut?.(game.name, game.appid, exePath || undefined)
        if (result?.ok) ok += 1
        else failed += 1
      } catch {
        failed += 1
      }
    }
    onProgress?.(total, total)
    return { ok, failed }
  }

  const handleBatchAssignCollection = async () => {
    const value = normalizeLibraryToken(collectionDraft)
    if (!value || selectedAppIds.size === 0) return
    setBatchWorking(true)
    try {
      await updateLibraryGameMeta(Array.from(selectedAppIds), (current) => ({
        ...current,
        collections: dedupeCaseInsensitive([...(current.collections || []), value]),
      }))
      setCollectionDraft("")
      showBatchFeedback('success', `Added collection "${value}" to ${selectedAppIds.size} games.`)
    } finally {
      setBatchWorking(false)
    }
  }

  const handleBatchDelete = async () => {
    if (selectedInstalledGames.length === 0) return
    setBatchDeleteConfirmOpen(true)
  }

  const executeBatchDelete = async () => {
    setBatchDeleteConfirmOpen(false)
    setBatchWorking(true)
    try {
      for (const game of selectedInstalledGames) {
        await handleDeleteInstalled(game)
      }
      setSelectedAppIds(new Set())
      showBatchFeedback('success', `Processed ${selectedInstalledGames.length} games.`)
    } finally {
      setBatchWorking(false)
    }
  }

  const handleBatchCreateShortcuts = async () => {
    if (selectedInstalledGames.length === 0) return
    setBatchWorking(true)
    setBatchProgress({ done: 0, total: selectedInstalledGames.length })
    try {
      const result = await runBatchShortcutCreation((done, total) => setBatchProgress({ done, total }))
      if (result.failed === 0) {
        showBatchFeedback('success', `Created ${result.ok} desktop shortcuts.`)
      } else {
        showBatchFeedback('error', `Created ${result.ok} shortcuts, ${result.failed} failed.`)
      }
    } finally {
      setBatchWorking(false)
      setBatchProgress(null)
    }
  }

  const handleBatchDeleteShortcuts = async () => {
    if (selectedInstalledGames.length === 0) return
    setBatchWorking(true)
    setBatchProgress({ done: 0, total: selectedInstalledGames.length })
    let ok = 0
    let failed = 0
    try {
      for (let i = 0; i < selectedInstalledGames.length; i++) {
        const game = selectedInstalledGames[i]
        setBatchProgress({ done: i, total: selectedInstalledGames.length })
        try {
          await window.ucDownloads?.deleteDesktopShortcut?.(game.name)
          ok += 1
        } catch {
          failed += 1
        }
      }
      setBatchProgress({ done: selectedInstalledGames.length, total: selectedInstalledGames.length })
      if (failed === 0) {
        showBatchFeedback('success', `Deleted ${ok} desktop shortcuts.`)
      } else {
        showBatchFeedback('error', `Deleted ${ok} shortcuts, ${failed} failed.`)
      }
    } finally {
      setBatchWorking(false)
      setBatchProgress(null)
    }
  }

  const isAllPageSelected = pagedInstalled.length > 0 && pagedInstalled.every((game) => selectedAppIds.has(game.appid))
  const isAllVisibleSelected = filteredInstalled.length > 0 && filteredInstalled.every((game) => selectedAppIds.has(game.appid))

  // Cloud-aware user collections — same hook the Collections page uses, so
  // adding a game from the right-click menu writes through to the account
  // database when signed in (and the local store either way).
  const userCollections = useUserCollections()
  const { startGameDownload } = useDownloadsActions()

  // When a collection filter is active, find members that are NOT installed so
  // we can show them below the installed grid with a download button.
  const uninstalledCollectionMembers = useMemo(() => {
    if (selectedCollection === "all") return [] as CatalogGame[]
    const collection = userCollections.collections.find(
      (c) => c.name.toLowerCase() === selectedCollection.toLowerCase()
    )
    if (!collection) return [] as CatalogGame[]
    const installedSet = new Set(installedWithMeta.map((g) => g.appid))
    const missingAppids = collection.appids.filter((id) => !installedSet.has(id))
    if (missingAppids.length === 0) return [] as CatalogGame[]
    const catalogSource = games.length > 0 ? games : getCatalogCache().games
    const catalogMap = new Map(catalogSource.map((g) => [g.appid, g]))
    return missingAppids.map((id) => catalogMap.get(id)).filter(Boolean) as CatalogGame[]
  }, [selectedCollection, userCollections.collections, installedWithMeta, games])

  const buildCollectionPicker = useCallback(
    (game: LibraryGame) => {
      const picker = {
        collections: userCollections.collections.map<CollectionPickerEntry>((c) => ({
          id: c.id,
          name: c.name,
          included: c.appids.includes(game.appid),
        })),
        onAddToCollection: async (collectionId: string) => {
          const target = userCollections.collections.find((c) => c.id === collectionId)
          if (!target) return
          if (!target.appids.includes(game.appid)) {
            await userCollections.setMembership(target, [...target.appids, game.appid])
          }
        },
        onRemoveFromCollection: async (collectionId: string) => {
          const target = userCollections.collections.find((c) => c.id === collectionId)
          if (!target) return
          await userCollections.setMembership(
            target,
            target.appids.filter((id) => id !== game.appid)
          )
        },
        onCreateCollection: async (name: string) => {
          await userCollections.create(name, [game.appid])
        },
      }
      return picker
    },
    [userCollections]
  )

  // Counts so collection/tag chips show how many games are in each.
  const collectionCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const game of installedWithMeta) {
      for (const c of game.libraryMeta?.collections || []) {
        const key = c
        counts[key] = (counts[key] || 0) + 1
      }
    }
    return counts
  }, [installedWithMeta])

  const renameCollection = async (oldName: string, nextName: string) => {
    const target = normalizeLibraryToken(nextName)
    if (!target || target.toLowerCase() === oldName.toLowerCase()) return
    const next = { ...libraryGameMeta }
    for (const [appid, meta] of Object.entries(next)) {
      const cols = meta.collections || []
      if (cols.some((c) => c.toLowerCase() === oldName.toLowerCase())) {
        next[appid] = {
          ...meta,
          collections: dedupeCaseInsensitive(cols.map((c) => c.toLowerCase() === oldName.toLowerCase() ? target : c)),
        }
      }
    }
    await persistLibraryGameMeta(next)
    if (selectedCollection.toLowerCase() === oldName.toLowerCase()) setSelectedCollection(target)
  }

  const deleteCollection = async (name: string) => {
    const next = { ...libraryGameMeta }
    for (const [appid, meta] of Object.entries(next)) {
      const cols = meta.collections || []
      if (cols.some((c) => c.toLowerCase() === name.toLowerCase())) {
        next[appid] = { ...meta, collections: cols.filter((c) => c.toLowerCase() !== name.toLowerCase()) }
      }
    }
    await persistLibraryGameMeta(next)
    if (selectedCollection.toLowerCase() === name.toLowerCase()) setSelectedCollection("all")
  }

  const handleBatchRemoveFromCollection = async (name: string) => {
    if (selectedAppIds.size === 0) return
    setBatchWorking(true)
    try {
      await updateLibraryGameMeta(Array.from(selectedAppIds), (current) => ({
        ...current,
        collections: (current.collections || []).filter((c) => c.toLowerCase() !== name.toLowerCase()),
      }))
      showBatchFeedback('success', `Removed "${name}" from ${selectedAppIds.size} games.`)
    } finally {
      setBatchWorking(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Library</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {loading ? "Loading…" : (
              <>
                <span className="font-medium text-zinc-200">{installedWithMeta.length}</span> installed
                {visibleInstalling.length > 0 && (
                  <> · <span className="font-medium text-zinc-200">{visibleInstalling.length}</span> downloading</>
                )}
              </>
            )}
          </p>
        </div>
      </header>

      {/* Toolbar (replaces the left sidebar) */}
      <div className="rounded-3xl border border-white/[.07] bg-zinc-900/40 backdrop-blur-md p-3 sm:p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <Input
              value={librarySearch}
              onChange={(event) => handleSearchChange(event.target.value)}
              placeholder="Search games or collections…"
              className="rounded-2xl bg-white/[.03] border-white/[.07] pl-10 h-11"
            />
            {librarySearch && (
              <button
                type="button"
                onClick={() => { setLibrarySearch(""); setDebouncedSearch("") }}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-100 transition-colors"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Select value={sortMode} onValueChange={(v) => setSortMode(v as 'name' | 'recent-install' | 'recent-play')}>
            <SelectTrigger className="rounded-2xl bg-white/[.03] border-white/[.07] h-11 w-full sm:w-48">
              <ArrowUpDown className="h-3.5 w-3.5 mr-1.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="recent-install">Recently installed</SelectItem>
              <SelectItem value="recent-play">Recently played</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant={selectionMode ? "default" : "outline"}
            className="rounded-2xl h-11 gap-2"
            onClick={() => {
              const next = !selectionMode
              setSelectionMode(next)
              if (!next) setSelectedAppIds(new Set())
            }}
          >
            <CheckSquare2 className="h-4 w-4" />
            {selectionMode ? `${selectedAppIds.size} selected` : 'Select'}
          </Button>
        </div>

        {/* Collections strip */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">Collections</span>
            <div className="flex items-center gap-2">
              {selectionMode && selectedAppIds.size > 0 && (
                <NewCollectionInline
                  placeholder={`Add a collection to ${selectedAppIds.size} game${selectedAppIds.size !== 1 ? "s" : ""}`}
                  onCreate={async (name) => {
                    setCollectionDraft(name)
                    // updateLibraryGameMeta runs against the current selectedAppIds.
                    await updateLibraryGameMeta(Array.from(selectedAppIds), (current) => ({
                      ...current,
                      collections: dedupeCaseInsensitive([...(current.collections || []), name]),
                    }))
                    showBatchFeedback('success', `Added "${name}" to ${selectedAppIds.size} games.`)
                  }}
                />
              )}
              <Link
                to="/collections"
                className="inline-flex items-center gap-1 rounded-full border border-white/[.07] bg-white/[.03] px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:bg-white/[.07] hover:text-white transition-colors"
              >
                <Settings2 className="h-3 w-3" />
                Manage
              </Link>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <CollectionPill
              label="All games"
              count={installedWithMeta.length}
              active={selectedCollection === "all"}
              onClick={() => setSelectedCollection("all")}
            />
            {availableCollections.map((collection) => (
              <CollectionPill
                key={collection}
                label={collection}
                count={collectionCounts[collection] || 0}
                active={selectedCollection.toLowerCase() === collection.toLowerCase()}
                onClick={() => setSelectedCollection(selectedCollection.toLowerCase() === collection.toLowerCase() ? "all" : collection)}
                onRename={(next) => void renameCollection(collection, next)}
                onDelete={() => void deleteCollection(collection)}
                onRemoveFromSelected={selectionMode && selectedAppIds.size > 0 ? () => void handleBatchRemoveFromCollection(collection) : undefined}
              />
            ))}
            {availableCollections.length === 0 && (
              <Link
                to="/collections"
                className="text-xs text-zinc-400 hover:text-zinc-100 italic underline-offset-2 hover:underline"
              >
                No collections yet — create your first →
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Selection batch toolbar (sticky while active) */}
      {selectionMode && (
        <div className="sticky top-2 z-30 rounded-2xl border border-white/[.07] bg-zinc-950/85 backdrop-blur-md p-3 space-y-2 shadow-[0_12px_40px_rgba(0,0,0,0.4)]">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => {
              if (isAllPageSelected) setSelectedAppIds((prev) => { const next = new Set(prev); pagedInstalled.forEach((g) => next.delete(g.appid)); return next })
              else setSelectedAppIds((prev) => new Set([...prev, ...pagedInstalled.map((g) => g.appid)]))
            }}>
              {isAllPageSelected ? 'Deselect page' : 'Select page'}
            </Button>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => {
              if (isAllVisibleSelected) setSelectedAppIds(new Set())
              else setSelectedAppIds(new Set(filteredInstalled.map((game) => game.appid)))
            }}>
              {isAllVisibleSelected ? 'Clear all' : 'Select all'}
            </Button>
            <div className="h-4 w-px bg-white/10" />
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => void handleBatchCreateShortcuts()} disabled={batchWorking || selectedAppIds.size === 0}>
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Create Shortcuts
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => void handleBatchDeleteShortcuts()} disabled={batchWorking || selectedAppIds.size === 0}>
              <X className="h-3.5 w-3.5 mr-1.5" /> Delete Shortcuts
            </Button>
            <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={() => { void handleBatchDelete() }} disabled={batchWorking || selectedAppIds.size === 0}>
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
            </Button>
          </div>
          {batchProgress && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Processing {batchProgress.done} / {batchProgress.total}…</span>
              </div>
              <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-white/40 rounded-full transition-all duration-200" style={{ width: `${batchProgress.total > 0 ? (batchProgress.done / batchProgress.total) * 100 : 0}%` }} />
              </div>
            </div>
          )}
          {batchFeedback && !batchProgress && (
            <div className={cn("flex items-center gap-1.5 text-xs", batchFeedback.type === 'success' ? 'text-zinc-300' : 'text-destructive')}>
              {batchFeedback.type === 'success' ? <Check className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
              {batchFeedback.message}
            </div>
          )}
        </div>
      )}

      {/* Filter status + clear */}
      {(selectedCollection !== "all" || debouncedSearch) && (
        <div className="text-xs text-zinc-500">
          {filteredInstalled.length} of {installedWithMeta.length} games installed
          {uninstalledCollectionMembers.length > 0 && (
            <span className="ml-1">· {uninstalledCollectionMembers.length} not installed</span>
          )}
          <button
            type="button"
            onClick={() => { setLibrarySearch(""); setDebouncedSearch(""); setSelectedCollection("all") }}
            className="ml-2 text-zinc-400 hover:text-zinc-100 underline-offset-2 hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Installed games grid */}
      <section className="space-y-4">
        {loading || statsLoading ? (
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 20 }).map((_, idx) => (<GameCardSkeleton key={idx} />))}
          </div>
        ) : filteredInstalled.length ? (
          <div className="space-y-4">
            <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {pagedInstalled.map((game) => {
                const collections = game.libraryMeta?.collections || []
                const lastPlayed = formatRelativeTimestamp(game.libraryMeta?.lastPlayedAt)
                const isSelected = selectedAppIds.has(game.appid)
                return (
                  <div
                    key={game.appid}
                    className={cn(
                      "group/tile relative rounded-xl transition-all duration-200",
                      selectionMode ? "cursor-pointer" : "",
                      isSelected ? "ring-2 ring-white ring-offset-2 ring-offset-zinc-950" : ""
                    )}
                    onContextMenuCapture={!selectionMode ? (event) => {
                      // Capture-phase: prevent the GameCard's built-in universal menu
                      // from firing — the Library has its own richer menu (with delete,
                      // executable picker, edit details, etc.).
                      event.preventDefault()
                      event.stopPropagation()
                      openGameActionContextMenu(game, { x: event.clientX, y: event.clientY })
                    } : undefined}
                    onClick={selectionMode ? (e) => { e.preventDefault(); e.stopPropagation(); toggleSelected(game.appid) } : undefined}
                  >
                    <div className={selectionMode ? "pointer-events-none" : ""}>
                      <GameCard
                        game={game}
                        stats={stats[game.appid]}
                        size="compact"
                        updateAvailable={hasInstalledVersionUpdate(catalogVersionByAppid.get(game.appid), [game.version])}
                        updateLabel={catalogVersionByAppid.get(game.appid) ? `Update available - ${catalogVersionByAppid.get(game.appid)}` : "Update available"}
                      />
                    </div>

                    {selectionMode && (
                      <div className={cn(
                        "absolute inset-0 z-20 rounded-xl transition-colors",
                        isSelected ? "bg-white/5" : "hover:bg-white/5"
                      )}>
                        <div className={cn(
                          "absolute top-2.5 right-2.5 h-6 w-6 rounded-md border-2 flex items-center justify-center transition-all",
                          isSelected ? "border-white bg-white text-black" : "border-zinc-500 bg-black/50"
                        )}>
                          {isSelected && <Check className="h-4 w-4" />}
                        </div>
                      </div>
                    )}

                    {!selectionMode && (
                      <div className="absolute inset-x-2 top-2 z-20 flex items-center justify-end gap-2 opacity-0 transition-all duration-200 group-hover/tile:opacity-100">
                        <Popover
                          open={settingsPopupOpen && settingsPopupGame?.appid === game.appid}
                          onOpenChange={(open) => {
                            if (open) openGameActionPopover(game)
                            else closeGameActionMenus()
                          }}
                        >
                          <div className="flex items-center gap-1.5">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={(event) => {
                                event.stopPropagation()
                                closeGameActionMenus()
                                void handleOpenGameFiles(game)
                              }}
                              className="h-8 w-8 rounded-full border border-white/[.08] bg-black/70 text-white hover:bg-white/20 backdrop-blur-md"
                              title="Open game files"
                              aria-label="Open game files"
                            >
                              <FolderOpen className="h-3.5 w-3.5" />
                            </Button>
                            <PopoverTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={(event) => { event.stopPropagation() }}
                                className="h-8 w-8 rounded-full border border-white/[.08] bg-black/70 text-white hover:bg-white/20 backdrop-blur-md"
                                title="More game actions"
                                aria-label="Open game actions"
                              >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </Button>
                            </PopoverTrigger>
                          </div>
                          <PopoverContent align="start" sideOffset={8} className="w-auto border-none bg-transparent p-0 shadow-none">
                            <GameActionMenuPanel
                              gameName={game.name}
                              gameSource={game.source}
                              isExternal={game.isExternal}
                              isLinux={isLinux}
                              shortcutFeedback={shortcutFeedback?.appid === game.appid ? { type: shortcutFeedback.type, message: shortcutFeedback.message } : null}
                              onSetExecutable={() => { setSettingsPopupOpen(false); void openExecutablePicker(game) }}
                              onOpenFiles={() => { setSettingsPopupOpen(false); void handleOpenGameFiles(game) }}
                              onCreateShortcut={() => { void handleCreateShortcutForGame(game) }}
                              onEditDetails={game.isExternal ? () => {
                                setSettingsPopupOpen(false)
                                setShortcutFeedback(null)
                                setSettingsPopupGame(game)
                                setEditMetadataOpen(true)
                              } : undefined}
                              onLinuxConfig={isLinux ? () => {
                                setSettingsPopupOpen(false)
                                setShortcutFeedback(null)
                                setLinuxConfigGame(game)
                                setLinuxConfigOpen(true)
                              } : undefined}
                              onDelete={() => {
                                setSettingsPopupOpen(false)
                                setShortcutFeedback(null)
                                setPendingDeleteGame(game)
                                setPendingDeleteAction("installed")
                              }}
                              collectionPicker={buildCollectionPicker(game)}
                            />
                          </PopoverContent>
                        </Popover>
                      </div>
                    )}

                    {/* Card meta footer (compact) */}
                    {(collections.length > 0 || lastPlayed) && (
                      <div className="mt-1 px-1 flex flex-wrap items-center gap-1">
                        {collections.slice(0, 2).map((c) => (
                          <span key={c} className="inline-flex items-center gap-0.5 text-[10px] rounded-md bg-white/[.04] text-zinc-300 border border-white/[.07] px-1.5 py-0.5 truncate max-w-[80px]">
                            <Layers3 className="h-2.5 w-2.5" /> {c}
                          </span>
                        ))}
                        {lastPlayed && (
                          <span className="ml-auto text-[10px] text-zinc-500">{lastPlayed}</span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <PaginationBar
              currentPage={installedPage}
              totalPages={installedTotalPages}
              onPageChange={setInstalledPage}
              wrapperClassName="mt-6"
            />
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-white/[.07] bg-white/[.02] p-10 text-center space-y-3">
            <div className="mx-auto h-12 w-12 rounded-full bg-white/[.04] border border-white/[.07] flex items-center justify-center">
              <Search className="h-5 w-5 text-zinc-500" />
            </div>
            <p className="text-sm text-zinc-400">
              {installedWithMeta.length === 0 ? "No games installed yet." : "No installed titles match these filters."}
            </p>
            {(debouncedSearch || selectedCollection !== "all") && (
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => { setLibrarySearch(""); setDebouncedSearch(""); setSelectedCollection("all") }}>
                Clear all filters
              </Button>
            )}
          </div>
        )}
      </section>

      {/* Uninstalled collection members — shown when filtering by a specific collection */}
      {uninstalledCollectionMembers.length > 0 && !loading && !statsLoading && (
        <section className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
            <Download className="h-3 w-3" />
            Not installed ({uninstalledCollectionMembers.length})
          </p>
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {uninstalledCollectionMembers.map((game) => (
              <div key={game.appid} className="group/tile relative rounded-xl opacity-60 hover:opacity-100 transition-opacity duration-200">
                <GameCard game={game} size="compact" />
                <div className="absolute inset-x-2 top-2 z-20 flex items-center justify-end opacity-0 transition-all duration-200 group-hover/tile:opacity-100">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); void startGameDownload(game as any) }}
                    className="h-8 w-8 rounded-full border border-white/[.08] bg-black/70 text-white hover:bg-white/20 backdrop-blur-md"
                    title="Download game"
                    aria-label="Download game"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <GameActionContextMenu
        open={Boolean(cardContextMenu)}
        position={cardContextMenu?.position || null}
        onClose={() => setCardContextMenu(null)}
        gameName={cardContextMenu?.game.name || "Game"}
        gameSource={cardContextMenu?.game.source}
        isExternal={Boolean(cardContextMenu?.game.isExternal)}
        isLinux={isLinux}
        shortcutFeedback={cardContextMenu && shortcutFeedback?.appid === cardContextMenu.game.appid ? { type: shortcutFeedback.type, message: shortcutFeedback.message } : null}
        onSetExecutable={() => {
          if (!cardContextMenu) return
          setCardContextMenu(null)
          void openExecutablePicker(cardContextMenu.game)
        }}
        onOpenFiles={() => {
          if (!cardContextMenu) return
          setCardContextMenu(null)
          void handleOpenGameFiles(cardContextMenu.game)
        }}
        onCreateShortcut={() => {
          if (!cardContextMenu) return
          const { game } = cardContextMenu
          setCardContextMenu(null)
          void handleCreateShortcutForGame(game)
        }}
        onEditDetails={cardContextMenu?.game.isExternal ? () => {
          if (!cardContextMenu) return
          setSettingsPopupGame(cardContextMenu.game)
          setCardContextMenu(null)
          setEditMetadataOpen(true)
        } : undefined}
        onLinuxConfig={isLinux ? () => {
          if (!cardContextMenu) return
          setLinuxConfigGame(cardContextMenu.game)
          setCardContextMenu(null)
          setLinuxConfigOpen(true)
        } : undefined}
        onDelete={() => {
          if (!cardContextMenu) return
          setPendingDeleteGame(cardContextMenu.game)
          setPendingDeleteAction("installed")
          setCardContextMenu(null)
        }}
        collectionPicker={cardContextMenu ? buildCollectionPicker(cardContextMenu.game) : undefined}
      />

      {/* Downloading section */}
      {(loading || statsLoading || visibleInstalling.length > 0) && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-zinc-300">Downloading</h2>
            {!loading && !statsLoading && visibleInstalling.length > 0 && (
              <span className="rounded-full border border-white/[.07] bg-white/[.04] px-2 py-0.5 text-[11px] text-zinc-400">
                {visibleInstalling.length}
              </span>
            )}
          </div>
          {loading || statsLoading ? (
            <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 4 }).map((_, idx) => (<GameCardSkeleton key={idx} />))}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {pagedInstalling.map((game) => {
                  const isFailed = failedAppIds.has(game.appid)
                  const isCancelled = cancelledAppIds.has(game.appid)
                  return (
                    <div
                      key={game.appid}
                      className="group/tile relative"
                      onContextMenuCapture={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        openGameActionContextMenu(game, { x: event.clientX, y: event.clientY })
                      }}
                    >
                      <GameCard
                        game={game}
                        stats={stats[game.appid]}
                        size="compact"
                        updateAvailable={hasInstalledVersionUpdate(catalogVersionByAppid.get(game.appid), [game.version])}
                        updateLabel={catalogVersionByAppid.get(game.appid) ? `Update available - ${catalogVersionByAppid.get(game.appid)}` : "Update available"}
                      />
                      {(isCancelled || isFailed) && (
                        <div className="pointer-events-none absolute left-2 top-2 z-20">
                          <span className={cn(
                            "rounded-full border px-2 py-0.5 text-[11px] font-medium backdrop-blur-sm",
                            isFailed
                              ? "border-red-500/30 bg-black/70 text-red-400"
                              : "border-white/[.07] bg-black/70 text-zinc-400"
                          )}>
                            {isFailed ? "Failed" : "Cancelled"}
                          </span>
                        </div>
                      )}
                      <div className="absolute right-2 top-2 z-20 opacity-0 transition-opacity group-hover/tile:opacity-100">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setPendingDeleteGame(game)
                            setPendingDeleteAction("installing")
                          }}
                          className="h-7 w-7 rounded-full border border-white/[.08] bg-black/70 text-zinc-400 backdrop-blur-sm hover:bg-red-500/10 hover:text-red-400"
                          title="Remove"
                          aria-label="Remove download"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
              {installingTotalPages > 1 && (
                <PaginationBar
                  currentPage={installingPage}
                  totalPages={installingTotalPages}
                  onPageChange={setInstallingPage}
                  wrapperClassName="mt-6"
                />
              )}
            </div>
          )}
        </section>
      )}

      {/* ──── Modals ──── */}
            {batchDeleteConfirmOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
                <div className="absolute inset-0 bg-black/70" onClick={() => setBatchDeleteConfirmOpen(false)} />
                <div className="relative w-full max-w-md rounded-2xl border border-white/[.07] bg-zinc-900 p-5 text-white shadow-2xl">
                  <div className="flex items-center gap-2 text-base font-semibold">
                    <AlertTriangle className="h-4 w-4 text-red-400" />
                    Delete {selectedInstalledGames.length} game{selectedInstalledGames.length !== 1 ? "s" : ""}
                  </div>
                  <p className="mt-2 text-sm text-zinc-400">
                    This will permanently remove the installed files from disk.
                  </p>
                  <div className="mt-4 flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setBatchDeleteConfirmOpen(false)}>Cancel</Button>
                    <Button variant="destructive" size="sm" onClick={() => void executeBatchDelete()}>Delete</Button>
                  </div>
                </div>
              </div>
            )}

      {pendingDeleteGame && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => { setPendingDeleteGame(null); setPendingDeleteAction(null) }} />
          <div className="relative w-full max-w-md rounded-2xl border border-white/[.07] bg-zinc-900 p-5 text-white shadow-2xl">
            <div className="text-base font-semibold">
              {pendingDeleteAction === "installing" ? "Remove download" : pendingDeleteGame.isExternal ? "Unlink game" : "Delete game"}
            </div>
            <p className="mt-2 text-sm text-zinc-400">
              {pendingDeleteAction === "installing"
                ? `Remove “${pendingDeleteGame.name}”? Any downloaded data will be deleted.`
                : pendingDeleteGame.isExternal
                  ? `Unlink “${pendingDeleteGame.name}” from your library? Your files won’t be touched.`
                  : `Delete “${pendingDeleteGame.name}”? This removes the installed files from disk.`}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setPendingDeleteGame(null); setPendingDeleteAction(null) }}>Cancel</Button>
              <Button variant="destructive" size="sm" onClick={() => {
                const target = pendingDeleteGame
                const action = pendingDeleteAction
                setPendingDeleteGame(null)
                setPendingDeleteAction(null)
                if (!target) return
                setTimeout(() => {
                  if (action === "installing") void handleDeleteInstalling(target)
                  else void handleDeleteInstalled(target)
                }, 0)
              }}>
                {pendingDeleteAction === "installing" ? "Remove" : pendingDeleteGame?.isExternal ? "Unlink" : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}
      <ExePickerModal
        open={exePickerOpen}
        title={exePickerTitle}
        message={exePickerMessage}
        exes={exePickerExes}
        currentExePath={exePickerCurrentPath}
        actionLabel="Set"
        gameName={settingsPopupGame?.name}
        baseFolder={exePickerFolder}
        onSelect={handleExePicked}
        onClose={() => setExePickerOpen(false)}
      />
      {settingsPopupGame && (
        <EditGameMetadataModal
          open={editMetadataOpen}
          onOpenChange={setEditMetadataOpen}
          game={settingsPopupGame}
          onSaved={(updates) => {
            setInstalled((prev) => prev.map((g) => g.appid === settingsPopupGame.appid ? { ...g, ...updates } : g))
          }}
        />
      )}
      {linuxConfigGame && (
        <GameLinuxConfigModal
          open={linuxConfigOpen}
          appid={linuxConfigGame.appid}
          gameName={linuxConfigGame.name}
          onClose={() => { setLinuxConfigOpen(false); setLinuxConfigGame(null) }}
        />
      )}
    </div>
  )
}