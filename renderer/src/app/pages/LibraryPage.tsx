import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { useNavigate, useSearchParams, Link } from "react-router-dom"
import { GameActionContextMenu, GameActionMenuPanel } from "@/components/GameActionMenu"
import { GameCard } from "@/components/GameCard"
import { PageAura } from "@/components/page-aura"
import { GameCardSkeleton } from "@/components/GameCardSkeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PaginationBar } from "@/components/PaginationBar"
import { useGamesData } from "@/hooks/use-games"
import type { Game } from "@/lib/types"
import { hasInstalledVersionUpdate, pickGameExecutable, cn, proxyImageUrl } from "@/lib/utils"
import { useDownloads, useDownloadsActions } from "@/context/downloads-context"
import { getCatalogCache, type CatalogGame } from "@/lib/catalog"
import { X } from "@/components/icons"
import { CheckSquare2, ArrowUpDown, Clock, RefreshCw, StickyNote } from "lucide-react"
import {
  Trash2,
  AlertTriangle,
  FolderOpen,
  ExternalLink,
  Unlink2,
  Terminal,
  Layers3,
  Search,
  Settings2,
  Loader2,
  Check,
  MoreHorizontal,
  Download,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  LayoutGrid,
  LayoutList,
} from "@/components/icons"
import { ExePickerModal } from "@/components/ExePickerModal"
import { EditGameMetadataModal } from "@/components/EditGameMetadataModal"
import { GameLinuxConfigModal } from "@/components/GameLinuxConfigModal"
import { LaunchOptionsModal } from "@/components/LaunchOptionsModal"
import { CollectionPill, NewCollectionInline } from "@/components/LibraryFilterChips"
import { useUserCollections } from "@/hooks/use-user-collections"
import { useAccountLists } from "@/hooks/use-account-lists"
import { EmptyState } from "@/components/EmptyState"
import { DiskUsageBreakdown } from "@/components/DiskUsageBreakdown"
import type { CollectionPickerEntry } from "@/components/GameActionMenu"
import { gameLogger } from "@/lib/logger"
import { useToast } from "@/context/toast-context"

type LibraryGameMeta = {
  collections?: string[]
  tags?: string[]
  lastPlayedAt?: number
  /** Per-game free-text notes — populated by GameNotesPanel on the detail
   *  page. Surfaced as a tooltip on Library tiles so the user can recall
   *  why-this-game without opening detail. */
  notes?: string
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
      image: "./fallbacks/game-card-3x4.svg",
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
  if (game.image && game.image !== "./fallbacks/game-card-3x4.svg") score += 1
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
  const { toast } = useToast()
  // Deferred-delete bookkeeping for the undo toast. When the user deletes a
  // library game we don't fire the IPC immediately — we hide the row, raise
  // a toast with an "Undo" button, and only run the real delete after the
  // toast expires. Map: appid → { commit, cancel }. `commit` is the actual
  // disk-removing IPC; `cancel` clears the timer and restores the row.
  const pendingUndoDeletesRef = useRef<Map<string, { timer: ReturnType<typeof setTimeout>; commit: () => Promise<void>; cancel: () => void }>>(new Map())
  // Commit any pending soft-deletes when the page unmounts — otherwise
  // navigating away mid-toast leaves the game hidden from the UI but still
  // present on disk forever.
  useEffect(() => {
    const map = pendingUndoDeletesRef.current
    return () => {
      for (const [, entry] of map) {
        clearTimeout(entry.timer)
        void entry.commit()
      }
      map.clear()
    }
  }, [])
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
  const [launchOptionsGame, setLaunchOptionsGame] = useState<LibraryGame | null>(null)
  const [linuxConfigGame, setLinuxConfigGame] = useState<LibraryGame | null>(null)
    const [batchDeleteConfirmOpen, setBatchDeleteConfirmOpen] = useState(false)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [librarySearch, setLibrarySearch] = useState("")
  // Focus target for the `/` keyboard shortcut. The shortcut handler in
  // use-keyboard-shortcuts dispatches `uc_library_focus_search`; we listen
  // for it below and pull focus to this Input. Scoped to /library so it
  // doesn't fight with the global "?" help dialog.
  const librarySearchInputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    const onFocusSearch = () => {
      try {
        librarySearchInputRef.current?.focus()
        librarySearchInputRef.current?.select()
      } catch { /* ignore */ }
    }
    window.addEventListener('uc_library_focus_search', onFocusSearch)
    return () => window.removeEventListener('uc_library_focus_search', onFocusSearch)
  }, [])
  const [selectedCollection, setSelectedCollection] = useState(() => searchParams.get("collection") || "all")

  // Cloud-aware user collections — also used to size chip counts and the
  // "X of Y installed" filter status by the selected collection's full size.
  const userCollections = useUserCollections()
  const accountLists = useAccountLists()

  // Per-game Discord RPC mute. Loaded once at page level (and kept in sync
  // via ucSettings.onChanged) so we can read it synchronously per-card
  // without breaking the rules-of-hooks while mapping over the grid.
  const [rpcMutedAppids, setRpcMutedAppids] = useState<Record<string, true>>({})
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const value = await window.ucSettings?.get?.("rpcMutedAppids")
        if (cancelled) return
        if (value && typeof value === "object" && !Array.isArray(value)) {
          setRpcMutedAppids(value as Record<string, true>)
        }
      } catch { /* ignore */ }
    })()
    const off = window.ucSettings?.onChanged?.((data: any) => {
      if (!data || cancelled) return
      if (data.key === "__CLEAR_ALL__") { setRpcMutedAppids({}); return }
      if (data.key !== "rpcMutedAppids") return
      if (data.value && typeof data.value === "object" && !Array.isArray(data.value)) {
        setRpcMutedAppids(data.value as Record<string, true>)
      } else {
        setRpcMutedAppids({})
      }
    })
    return () => {
      cancelled = true
      if (typeof off === "function") off()
    }
  }, [])
  const toggleRpcMute = useCallback(async (appid: string) => {
    if (!appid) return
    const next = { ...rpcMutedAppids }
    if (next[appid]) delete next[appid]
    else next[appid] = true
    setRpcMutedAppids(next)
    try { await window.ucSettings?.set?.("rpcMutedAppids", next) } catch { /* ignore */ }
  }, [rpcMutedAppids])

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
  // "Just played" quick-filter — narrows the grid to titles whose
  // `libraryMeta.lastPlayedAt` falls within the last 7 days. Persists
  // session-only because the user almost always wants to clear this when
  // they're done looking at recent activity.
  const [justPlayedOnly, setJustPlayedOnly] = useState(false)
  const JUST_PLAYED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
  // View mode (grid vs list). Persisted under settings.libraryViewMode so
  // the choice survives reloads. List view is denser — handy when the user
  // has hundreds of installed games to scan.
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const value = await window.ucSettings?.get?.('libraryViewMode')
        if (cancelled) return
        if (value === 'list' || value === 'grid') setViewMode(value)
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [])
  const handleSetViewMode = (next: 'grid' | 'list') => {
    setViewMode(next)
    try { void window.ucSettings?.set?.('libraryViewMode', next) } catch { /* ignore */ }
  }
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

  // ESC handling for these confirm dialogs now comes free from Radix Dialog.

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
    // Show every collection the user owns/contributes to even when none of its
    // games are installed yet — otherwise an empty collection vanishes from
    // the chip row until the first install. Merge with names derived from
    // local meta so legacy local-only collections still appear.
    const fromMeta = installedWithMeta.flatMap((game) => game.libraryMeta?.collections || [])
    const fromCloud = userCollections.collections.map((c) => c.name)
    return dedupeCaseInsensitive([...fromCloud, ...fromMeta])
  }, [installedWithMeta, userCollections.collections])

  const filteredInstalled = useMemo(() => {
    const normalizedSearch = debouncedSearch.trim().toLowerCase()
    const recentCutoff = Date.now() - JUST_PLAYED_WINDOW_MS
    const next = installedWithMeta.filter((game) => {
      if (selectedCollection !== "all" && !(game.libraryMeta?.collections || []).some((value) => value.toLowerCase() === selectedCollection.toLowerCase())) {
        return false
      }
      if (justPlayedOnly) {
        const last = Number(game.libraryMeta?.lastPlayedAt) || 0
        if (last <= 0 || last < recentCutoff) return false
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
  }, [installedWithMeta, debouncedSearch, selectedCollection, sortMode, justPlayedOnly, JUST_PLAYED_WINDOW_MS])

  // Pre-computed count of games played in the last 7 days. Used to show
  // the user *how many* games the "Just played" toggle would surface
  // before they click it, and to hide the toggle entirely when there's
  // nothing to filter to — keeps the toolbar from feeling like dead UI
  // for users who haven't played anything yet.
  const justPlayedCount = useMemo(() => {
    const recentCutoff = Date.now() - JUST_PLAYED_WINDOW_MS
    return installedWithMeta.reduce((count, game) => {
      const last = Number(game.libraryMeta?.lastPlayedAt) || 0
      return count + (last > 0 && last >= recentCutoff ? 1 : 0)
    }, 0)
  }, [installedWithMeta, JUST_PLAYED_WINDOW_MS])

  const catalogVersionByAppid = useMemo(() => {
    return new Map(games.map((game) => [game.appid, game.version || ""]))
  }, [games])

  // Installed games whose catalog version is newer than the local version.
  // Surfaced as a pinned strip at the top of the library so users see updates
  // before they have to scroll through the grid hunting for the orange dot.
  const gamesWithUpdates = useMemo(() => {
    return installedWithMeta.filter((game) => {
      const catalogVersion = catalogVersionByAppid.get(game.appid)
      if (!catalogVersion) return false
      const versions = [game.version].filter(Boolean) as string[]
      if (versions.length === 0) return false
      return hasInstalledVersionUpdate(catalogVersion, versions)
    })
  }, [installedWithMeta, catalogVersionByAppid])

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

  // Membership-only signature of the live downloads list (appids, not byte
  // progress). When a download is discarded — e.g. cancelled from the activity
  // page, which deletes its installing/ folder — its appid drops out of this
  // key, re-reading the disk so the "Downloading" shelf doesn't keep showing a
  // ghost tile for a game whose files are already gone.
  const downloadAppIdsKey = useMemo(() => {
    const ids = new Set<string>()
    for (const item of downloads) if (item.appid) ids.add(item.appid)
    return Array.from(ids).sort().join("|")
  }, [downloads])

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
  }, [refreshTick, cancelledKey, failedKey, downloadAppIdsKey])

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

  // Actually performs the destructive delete. Pulled out so both the
  // immediate path (legacy) and the deferred / undo-toast path can reuse it.
  const commitDeleteInstalled = async (game: Game) => {
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

  // Soft-delete: hide the tile, raise an undo toast, run the real delete
  // after the toast window expires. If the user hits Undo we cancel the
  // timer and bring the tile back. This mirrors the trash-with-undo pattern
  // users expect from email and modern OS file managers.
  const handleDeleteInstalled = async (game: Game) => {
    // If somehow there's already a pending undo for this appid, just commit
    // it immediately — we shouldn't keep two timers fighting.
    const existing = pendingUndoDeletesRef.current.get(game.appid)
    if (existing) {
      clearTimeout(existing.timer)
      pendingUndoDeletesRef.current.delete(game.appid)
      await existing.commit()
    }

    // Hide optimistically so the row disappears the instant the user clicks.
    setHiddenAppIds((prev) => {
      const next = new Set(prev)
      next.add(game.appid)
      return next
    })
    setInstalled((prev) => prev.filter((item) => item.appid !== game.appid))

    const UNDO_WINDOW_MS = 5000
    let committed = false

    const commit = async () => {
      if (committed) return
      committed = true
      pendingUndoDeletesRef.current.delete(game.appid)
      await commitDeleteInstalled(game)
    }

    const cancel = () => {
      if (committed) return
      const entry = pendingUndoDeletesRef.current.get(game.appid)
      if (entry) {
        clearTimeout(entry.timer)
        pendingUndoDeletesRef.current.delete(game.appid)
      }
      // Restore visibility — drop the appid from hiddenAppIds; the next
      // refresh tick will repopulate `installed` from useGamesData.
      setHiddenAppIds((prev) => {
        const next = new Set(prev)
        next.delete(game.appid)
        return next
      })
      setRefreshTick((tick) => tick + 1)
    }

    const timer = setTimeout(() => { void commit() }, UNDO_WINDOW_MS)
    pendingUndoDeletesRef.current.set(game.appid, { timer, commit, cancel })

    const label = game.isExternal ? `Unlinked “${game.name}”` : `Removed “${game.name}”`
    toast(label, "info", {
      duration: UNDO_WINDOW_MS,
      action: { label: "Undo", onClick: cancel },
    })
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

  // When viewing a specific collection, map each appid -> contributor that
  // added it. Owner-added games have no badge.
  const collectionAttribution = useMemo(() => {
    if (selectedCollection === "all") return null
    const collection = userCollections.collections.find(
      (c) => c.name.toLowerCase() === selectedCollection.toLowerCase()
    )
    if (!collection || !collection.cloud) return null
    const contributorById = new Map(collection.contributors.map((c) => [c.discordId, c]))
    const ownerId = collection.owner?.discordId
    const map = new Map<string, { discordId: string; username: string | null; displayName: string | null; avatarUrl: string | null } | null>()
    collection.appids.forEach((appid, idx) => {
      const addedBy = collection.addedBy[idx]
      if (!addedBy || addedBy === ownerId) {
        map.set(appid, null)
        return
      }
      const c = contributorById.get(addedBy)
      if (!c) {
        map.set(appid, { discordId: addedBy, username: null, displayName: null, avatarUrl: null })
        return
      }
      map.set(appid, {
        discordId: c.discordId,
        username: c.username,
        displayName: c.displayName,
        avatarUrl: c.avatarUrl,
      })
    })
    return map
  }, [selectedCollection, userCollections.collections])

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
  // Prefer the cloud collection's full size (matches the sidebar + the
  // Collections manage page); fall back to the count of installed games
  // tagged locally for collections that only exist in libraryGameMeta.
  const collectionCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const game of installedWithMeta) {
      for (const c of game.libraryMeta?.collections || []) {
        counts[c] = (counts[c] || 0) + 1
      }
    }
    for (const c of userCollections.collections) {
      counts[c.name] = c.appids.length
    }
    return counts
  }, [installedWithMeta, userCollections.collections])

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
    <div className="relative space-y-5">
      <PageAura />
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Library</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading ? "Loading…" : (
              <>
                <span className="font-medium text-foreground/90">{installedWithMeta.length}</span> installed
                {visibleInstalling.length > 0 && (
                  <> · <span className="font-medium text-foreground/90">{visibleInstalling.length}</span> downloading</>
                )}
              </>
            )}
          </p>
        </div>
      </header>

      {/* Toolbar (replaces the left sidebar) */}
      <div className="rounded-3xl border border-white/[.07] bg-card/40 backdrop-blur-md p-3 sm:p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={librarySearchInputRef}
              value={librarySearch}
              onChange={(event) => handleSearchChange(event.target.value)}
              onKeyDown={(event) => {
                // Esc clears + blurs — matches the muscle memory users have
                // from browser address bars and macOS finder search.
                if (event.key === "Escape" && librarySearch) {
                  event.preventDefault()
                  setLibrarySearch("")
                  setDebouncedSearch("")
                }
              }}
              placeholder="Search games or collections…  ( / )"
              className="rounded-2xl bg-white/[.03] border-white/[.07] pl-10 h-11"
            />
            {librarySearch && (
              <button
                type="button"
                onClick={() => { setLibrarySearch(""); setDebouncedSearch("") }}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
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
          {/* Grid / list toggle. Single segmented control so the active mode
              is unambiguous and one tap switches. */}
          <div className="inline-flex items-center rounded-2xl border border-white/[.07] bg-white/[.03] p-0.5 h-11">
            <button
              type="button"
              onClick={() => handleSetViewMode('grid')}
              className={cn(
                "inline-flex items-center justify-center px-2.5 h-9 rounded-xl transition-colors",
                viewMode === 'grid' ? "bg-white/[.08] text-white" : "text-muted-foreground hover:text-foreground/90"
              )}
              title="Grid view"
              aria-pressed={viewMode === 'grid'}
              aria-label="Grid view"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => handleSetViewMode('list')}
              className={cn(
                "inline-flex items-center justify-center px-2.5 h-9 rounded-xl transition-colors",
                viewMode === 'list' ? "bg-white/[.08] text-white" : "text-muted-foreground hover:text-foreground/90"
              )}
              title="List view"
              aria-pressed={viewMode === 'list'}
              aria-label="List view"
            >
              <LayoutList className="h-4 w-4" />
            </button>
          </div>
          {/* "Just played" quick-filter — narrows to titles played in the
              last 7 days. Anchored next to the sort/view controls because
              it's a temporary lens on the existing grid, not a permanent
              filter like collections. Hidden entirely when nothing has
              been played recently so the toolbar doesn't carry a button
              that would always return zero results. */}
          {(justPlayedCount > 0 || justPlayedOnly) && (
            <button
              type="button"
              onClick={() => setJustPlayedOnly((value) => !value)}
              aria-pressed={justPlayedOnly}
              title={`Show only games you've played in the last 7 days (${justPlayedCount})`}
              className={cn(
                "rounded-2xl h-11 inline-flex items-center gap-1.5 border px-3 text-sm font-medium transition-colors active:scale-95",
                justPlayedOnly
                  ? "border-emerald-500/40 bg-emerald-500/[.08] text-emerald-200 hover:bg-emerald-500/[.12]"
                  : "border-white/[.07] bg-white/[.03] text-foreground/80 hover:bg-white/[.07] hover:text-white"
              )}
            >
              <Clock className="h-3.5 w-3.5" />
              Just played
              <span
                className={cn(
                  "ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-mono tabular-nums",
                  justPlayedOnly
                    ? "bg-emerald-500/20 text-emerald-200"
                    : "bg-white/[.06] text-muted-foreground"
                )}
              >
                {justPlayedCount}
              </span>
            </button>
          )}
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
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Collections</span>
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
                className="inline-flex items-center gap-1 rounded-full border border-white/[.07] bg-white/[.03] px-2.5 py-1 text-[11px] font-medium text-foreground/80 hover:bg-white/[.07] hover:text-white transition-colors"
              >
                <Settings2 className="h-3 w-3" />
                Manage
              </Link>
            </div>
          </div>
          <CollectionFilterStrip
            availableCollections={availableCollections}
            collectionCounts={collectionCounts}
            allGamesCount={installedWithMeta.length}
            selectedCollection={selectedCollection}
            setSelectedCollection={setSelectedCollection}
            renameCollection={renameCollection}
            deleteCollection={deleteCollection}
            selectionMode={selectionMode}
            selectedCount={selectedAppIds.size}
            onRemoveFromSelected={handleBatchRemoveFromCollection}
          />
          {availableCollections.length === 0 && (
            <Link
              to="/collections"
              className="text-xs text-muted-foreground hover:text-foreground italic underline-offset-2 hover:underline"
            >
              No collections yet — create your first →
            </Link>
          )}
        </div>
      </div>

      {/* Selection batch toolbar (sticky while active) */}
      {selectionMode && (
        <div className="sticky top-2 z-30 rounded-2xl border border-white/[.07] bg-background/85 backdrop-blur-md p-3 space-y-2 shadow-[0_12px_40px_rgba(0,0,0,0.4)]">
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
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Processing {batchProgress.done} / {batchProgress.total}…</span>
              </div>
              <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-white/40 rounded-full transition-all duration-200" style={{ width: `${batchProgress.total > 0 ? (batchProgress.done / batchProgress.total) * 100 : 0}%` }} />
              </div>
            </div>
          )}
          {batchFeedback && !batchProgress && (
            <div className={cn("flex items-center gap-1.5 text-xs", batchFeedback.type === 'success' ? 'text-foreground/80' : 'text-destructive')}>
              {batchFeedback.type === 'success' ? <Check className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
              {batchFeedback.message}
            </div>
          )}
        </div>
      )}

      {/* Filter status + clear */}
      {(selectedCollection !== "all" || debouncedSearch || justPlayedOnly) && (() => {
        // Denominator depends on whether a collection is selected. With a
        // collection selected, the meaningful total is "this collection's
        // games", not the whole library. We prefer the cloud collection's
        // size; otherwise fall back to installed-with-this-tag + uninstalled
        // members so local-only collections still report a real number.
        const activeCloud = selectedCollection !== "all"
          ? userCollections.collections.find(
              (c) => c.name.toLowerCase() === selectedCollection.toLowerCase()
            )
          : null
        const denominator = selectedCollection === "all"
          ? installedWithMeta.length
          : activeCloud
            ? activeCloud.appids.length
            : filteredInstalled.length + uninstalledCollectionMembers.length
        const label = selectedCollection === "all" ? "games installed" : "in this collection installed"
        return (
        <div className="text-xs text-muted-foreground/80">
          {filteredInstalled.length} of {denominator} {label}
          {uninstalledCollectionMembers.length > 0 && (
            <span className="ml-1">· {uninstalledCollectionMembers.length} not installed</span>
          )}
          <button
            type="button"
            onClick={() => { setLibrarySearch(""); setDebouncedSearch(""); setSelectedCollection("all"); setJustPlayedOnly(false) }}
            className="ml-2 text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          >
            Clear filters
          </button>
        </div>
        )
      })()}

      {/* Updates available — pinned strip above the main grid. Each row
          links to the game's detail page with ?update=1 so the existing
          UpdateBackupWarningModal flow kicks in. Hidden when there are no
          updates, when the catalog hasn't loaded yet, or while the page is
          still loading the installed list. */}
      {!loading && !statsLoading && gamesWithUpdates.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-300 flex items-center gap-2">
              <RefreshCw className="h-3 w-3" />
              Updates available
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-200">
                {gamesWithUpdates.length}
              </span>
            </h2>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {gamesWithUpdates.slice(0, 6).map((game) => {
              const catalogVersion = catalogVersionByAppid.get(game.appid) || ""
              return (
                <Link
                  key={game.appid}
                  to={`/game/${encodeURIComponent(game.appid)}?update=1`}
                  className="group flex items-center gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/[.04] px-3 py-2.5 transition hover:border-amber-500/40 hover:bg-amber-500/[.07]"
                >
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-white/[.07] bg-card">
                    {game.image && (
                      <img
                        src={(game as any).localImage || game.image}
                        alt=""
                        data-uc-handled="1"
                        className="h-full w-full object-cover"
                        onError={(event) => { (event.target as HTMLImageElement).style.opacity = "0" }}
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-white truncate">{game.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      <span className="font-mono text-muted-foreground/80">{game.version || "installed"}</span>
                      <ArrowUpDown className="inline h-2.5 w-2.5 mx-1 rotate-90 text-muted-foreground/60" />
                      <span className="font-mono text-amber-200">{catalogVersion}</span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-xs border-amber-500/30 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20"
                    onClick={(event) => { event.preventDefault(); event.stopPropagation(); /* navigation happens via the Link */ }}
                    tabIndex={-1}
                  >
                    Update
                  </Button>
                </Link>
              )
            })}
          </div>
          {gamesWithUpdates.length > 6 && (
            <p className="text-[11px] text-muted-foreground/80">+{gamesWithUpdates.length - 6} more — keep an eye on the orange dot in the grid below.</p>
          )}
        </section>
      )}

      {/* Installed games grid */}
      <section className="space-y-4">
        {loading || statsLoading ? (
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 20 }).map((_, idx) => (<GameCardSkeleton key={idx} />))}
          </div>
        ) : filteredInstalled.length ? (
          <div className="space-y-4">
            <div className={cn(
              viewMode === 'list'
                ? "flex flex-col gap-1.5"
                : "grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
            )}>
              {viewMode === 'list' ? pagedInstalled.map((game) => {
                const collections = game.libraryMeta?.collections || []
                const lastPlayed = formatRelativeTimestamp(game.libraryMeta?.lastPlayedAt)
                const isSelected = selectedAppIds.has(game.appid)
                const updateAvailable = hasInstalledVersionUpdate(catalogVersionByAppid.get(game.appid), [game.version])
                const coverSrc = (game as any).localImage || game.image
                const notesPreview = (() => {
                  const raw = game.libraryMeta?.notes
                  if (!raw) return null
                  const firstLine = raw.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0)
                  if (!firstLine) return null
                  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}…` : firstLine
                })()
                return (
                  <div
                    key={game.appid}
                    title={notesPreview ?? undefined}
                    onContextMenuCapture={!selectionMode ? (event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      openGameActionContextMenu(game, { x: event.clientX, y: event.clientY })
                    } : undefined}
                    onClick={selectionMode ? (e) => { e.preventDefault(); e.stopPropagation(); toggleSelected(game.appid) } : undefined}
                    className={cn(
                      "group flex items-center gap-3 rounded-2xl border border-white/[.07] bg-white/[.02] px-3 py-2 transition hover:border-white/15 hover:bg-white/[.04]",
                      selectionMode ? "cursor-pointer" : "cursor-default",
                      isSelected ? "ring-2 ring-white ring-offset-2 ring-offset-zinc-950" : ""
                    )}
                  >
                    {selectionMode && (
                      <div className={cn(
                        "h-5 w-5 shrink-0 rounded-md border-2 flex items-center justify-center",
                        isSelected ? "border-white bg-primary text-primary-foreground" : "border-zinc-500"
                      )}>
                        {isSelected && <Check className="h-3 w-3" />}
                      </div>
                    )}
                    <Link
                      to={`/game/${encodeURIComponent(game.appid)}`}
                      className="flex flex-1 items-center gap-3 min-w-0"
                      onClick={(e) => { if (selectionMode) { e.preventDefault(); e.stopPropagation() } }}
                    >
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-white/[.07] bg-card">
                        {coverSrc && (
                          <img
                            src={coverSrc}
                            alt=""
                            data-uc-handled="1"
                            className="h-full w-full object-cover"
                            onError={(event) => { (event.target as HTMLImageElement).style.opacity = "0" }}
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="text-sm font-semibold text-white truncate">{game.name}</div>
                          {updateAvailable && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-200">
                              <RefreshCw className="h-2.5 w-2.5" />
                              Update
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground/80 truncate">
                          {[
                            lastPlayed ? `Last played ${lastPlayed}` : null,
                            game.size || null,
                            game.version ? `v${game.version}` : null,
                            collections.length > 0 ? `${collections.length} collection${collections.length === 1 ? "" : "s"}` : null,
                          ].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                    </Link>
                    {!selectionMode && (
                      <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={(event) => { event.stopPropagation(); event.preventDefault(); void handleOpenGameFiles(game) }}
                          className="h-8 w-8 rounded-full text-muted-foreground hover:bg-white/[.06] hover:text-white"
                          title="Open game files"
                        >
                          <FolderOpen className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={(event) => {
                            // The Popover that openGameActionPopover anchors to
                            // only renders in the grid layout. In list view we
                            // route through the right-click context menu so
                            // the click works in both modes — opens it at the
                            // pointer position so it doesn't fly off-screen.
                            event.stopPropagation()
                            event.preventDefault()
                            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
                            openGameActionContextMenu(game, { x: rect.right, y: rect.bottom + 4 })
                          }}
                          className="h-8 w-8 rounded-full text-muted-foreground hover:bg-white/[.06] hover:text-white"
                          title="More actions"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                )
              }) : pagedInstalled.map((game) => {
                const collections = game.libraryMeta?.collections || []
                const lastPlayed = formatRelativeTimestamp(game.libraryMeta?.lastPlayedAt)
                const isSelected = selectedAppIds.has(game.appid)
                // Notes preview — first non-empty line, trimmed to a sane
                // length so a long entry doesn't blow up the tooltip. Native
                // browser tooltip is good enough here; a custom popover would
                // fight the hover-only Aura on the card behind it.
                const notesPreview = (() => {
                  const raw = game.libraryMeta?.notes
                  if (!raw) return null
                  const firstLine = raw.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0)
                  if (!firstLine) return null
                  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}…` : firstLine
                })()
                return (
                  <div
                    key={game.appid}
                    className={cn(
                      "group/tile relative rounded-xl transition-all duration-200",
                      selectionMode ? "cursor-pointer" : "",
                      isSelected ? "ring-2 ring-white ring-offset-2 ring-offset-zinc-950" : ""
                    )}
                    title={notesPreview ?? undefined}
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
                    {(() => {
                      const addedBy = collectionAttribution?.get(game.appid)
                      if (!addedBy) return null
                      const nm = addedBy.displayName || addedBy.username || "Contributor"
                      return (
                        <div className="pointer-events-none absolute inset-x-0 top-0 aspect-[4/5] z-10">
                          <div
                            className="absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-violet-200 backdrop-blur-sm max-w-[calc(100%-1rem)]"
                            title={`Added by ${nm}`}
                          >
                            <span className="h-3.5 w-3.5 shrink-0 overflow-hidden rounded-full bg-secondary">
                              {addedBy.avatarUrl ? (
                                <img src={proxyImageUrl(addedBy.avatarUrl)} alt="" className="h-full w-full object-cover" />
                              ) : null}
                            </span>
                            <span className="truncate">{nm}</span>
                          </div>
                        </div>
                      )
                    })()}

                    {selectionMode && (
                      <div className={cn(
                        "absolute inset-0 z-20 rounded-xl transition-colors",
                        isSelected ? "bg-white/5" : "hover:bg-white/5"
                      )}>
                        <div className={cn(
                          "absolute top-2.5 right-2.5 h-6 w-6 rounded-md border-2 flex items-center justify-center transition-all",
                          isSelected ? "border-white bg-primary text-primary-foreground" : "border-zinc-500 bg-black/50"
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
                              onLaunchOptions={() => {
                                setSettingsPopupOpen(false)
                                setShortcutFeedback(null)
                                setLaunchOptionsGame(game)
                              }}
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
                              rpcMute={{
                                muted: rpcMutedAppids[game.appid] === true,
                                toggle: () => { void toggleRpcMute(game.appid) },
                              }}
                              collectionPicker={buildCollectionPicker(game)}
                            />
                          </PopoverContent>
                        </Popover>
                      </div>
                    )}

                    {/* Card meta footer (compact) */}
                    {(collections.length > 0 || lastPlayed || notesPreview) && (
                      <div className="mt-1 px-1 flex flex-wrap items-center gap-1">
                        {collections.slice(0, 2).map((c) => (
                          <span key={c} className="inline-flex items-center gap-0.5 text-[10px] rounded-md bg-white/[.04] text-foreground/80 border border-white/[.07] px-1.5 py-0.5 truncate max-w-[80px]">
                            <Layers3 className="h-2.5 w-2.5" /> {c}
                          </span>
                        ))}
                        {/* Small note pin — same hover surface as the tile
                            itself (the title is already on the wrapper), but
                            this gives a visible cue that there's a note
                            without forcing the user to hover-and-wait. */}
                        {notesPreview && (
                          <span
                            className="inline-flex items-center text-[10px] rounded-md bg-amber-500/[.08] text-amber-200 border border-amber-500/20 px-1 py-0.5"
                            title={notesPreview}
                          >
                            <StickyNote className="h-2.5 w-2.5" />
                          </span>
                        )}
                        {lastPlayed && (
                          <span className="ml-auto text-[10px] text-muted-foreground/80">{lastPlayed}</span>
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
        ) : installedWithMeta.length === 0 ? (
          <EmptyState
            icon={Download}
            title="No games installed yet"
            description="Once you install a game it'll appear here, sorted by name, install date, or last played."
            action={(
              <Button onClick={() => navigate("/")}>
                Browse games to install
              </Button>
            )}
            hint={(
              <>
                Already have games on disk? <Link to="/library?collection=all" className="underline-offset-2 hover:underline">Add an external game</Link> via the toolbar.
              </>
            )}
          />
        ) : (
          <EmptyState
            icon={Search}
            title="No installed titles match these filters"
            description="Try a different collection or clear the search."
            action={(debouncedSearch || selectedCollection !== "all") ? (
              <Button variant="outline" size="sm" onClick={() => { setLibrarySearch(""); setDebouncedSearch(""); setSelectedCollection("all"); setJustPlayedOnly(false) }}>
                Clear all filters
              </Button>
            ) : undefined}
          />
        )}
      </section>

      {/* Uninstalled collection members — shown when filtering by a specific collection */}
      {uninstalledCollectionMembers.length > 0 && !loading && !statsLoading && (
        <section className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80 flex items-center gap-1.5">
            <Download className="h-3 w-3" />
            Not installed ({uninstalledCollectionMembers.length})
          </p>
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {uninstalledCollectionMembers.map((game) => (
              <div key={game.appid} className="relative">
                <GameCard game={game} stats={stats[game.appid]} size="compact" />
                <NotInstalledOverlay
                  onInstall={async () => { await startGameDownload(game as any) }}
                />
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
        wishlist={accountLists.authed === false || !cardContextMenu ? undefined : {
          inList: accountLists.wishlist.has(cardContextMenu.game.appid),
          toggle: () => { void accountLists.toggleWishlist(cardContextMenu.game.appid, cardContextMenu.game.name) },
        }}
        favorites={accountLists.authed === false || !cardContextMenu ? undefined : {
          inList: accountLists.favorites.has(cardContextMenu.game.appid),
          toggle: () => { void accountLists.toggleFavorite(cardContextMenu.game.appid, cardContextMenu.game.name) },
        }}
        rpcMute={cardContextMenu ? {
          muted: rpcMutedAppids[cardContextMenu.game.appid] === true,
          toggle: () => { void toggleRpcMute(cardContextMenu.game.appid) },
        } : undefined}
        collectionPicker={cardContextMenu ? buildCollectionPicker(cardContextMenu.game) : undefined}
      />

      {/* Disk usage breakdown — quick "how much have I installed and where's
          it going?" answer without leaving the library. Hidden when nothing
          is installed (the component returns null in that case). */}
      {!loading && !statsLoading && installedWithMeta.length > 0 && (
        <DiskUsageBreakdown />
      )}

      {/* Downloading section */}
      {(loading || statsLoading || visibleInstalling.length > 0) && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground/80">Downloading</h2>
            {!loading && !statsLoading && visibleInstalling.length > 0 && (
              <span className="rounded-full border border-white/[.07] bg-white/[.04] px-2 py-0.5 text-[11px] text-muted-foreground">
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
                        // Centred at the top so it never collides with the
                        // corner badges GameCard paints (MP / Popular sit
                        // top-left, the Remove button sits top-right). z-30 to
                        // sit above GameCard's z-30 badge layer.
                        <div className="pointer-events-none absolute left-1/2 top-2 z-30 -translate-x-1/2">
                          <span className={cn(
                            "rounded-full border px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-sm whitespace-nowrap",
                            isFailed
                              ? "border-red-500/40 bg-black/80 text-red-400"
                              : "border-white/[.07] bg-black/80 text-muted-foreground"
                          )}>
                            {isFailed ? "Failed" : "Cancelled"}
                          </span>
                        </div>
                      )}
                      <div className={cn(
                        "absolute right-2 top-2 z-20 transition-opacity",
                        // Dead entries (cancelled/failed) are meant to be
                        // cleared, so keep their X always visible; live
                        // downloads only reveal it on hover.
                        (isCancelled || isFailed) ? "opacity-100" : "opacity-0 group-hover/tile:opacity-100"
                      )}>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            // A cancelled/failed download has nothing in flight
                            // to lose — remove it immediately instead of routing
                            // through the confirm dialog, which felt laggy when
                            // clearing a pile of dead entries.
                            if (isCancelled || isFailed) {
                              void handleDeleteInstalling(game)
                              return
                            }
                            setPendingDeleteGame(game)
                            setPendingDeleteAction("installing")
                          }}
                          // [&_svg…]:size-3 overrides the Button's base
                          // `[&_svg:not([class*='size-'])]:size-4` rule (same
                          // variant prefix → tailwind-merge keeps this one) so
                          // the inner <svg> matches the 12px wrapper instead of
                          // overflowing it and rendering off-centre.
                          className="h-7 w-7 rounded-full border border-white/[.08] bg-black/70 text-muted-foreground backdrop-blur-sm hover:bg-red-500/10 hover:text-red-400 [&_svg:not([class*='size-'])]:size-3"
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

      {/* ──── Modals ──── All use the shared Radix Dialog so overlay, surface,
          blur and animations stay in lockstep with the rest of the app. */}
      <Dialog open={batchDeleteConfirmOpen} onOpenChange={setBatchDeleteConfirmOpen}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              Delete {selectedInstalledGames.length} game{selectedInstalledGames.length !== 1 ? "s" : ""}
            </DialogTitle>
            <DialogDescription>
              This will permanently remove the installed files from disk.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setBatchDeleteConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={() => void executeBatchDelete()}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pendingDeleteGame)}
        onOpenChange={(next) => {
          if (!next) {
            setPendingDeleteGame(null)
            setPendingDeleteAction(null)
          }
        }}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          {pendingDeleteGame && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">
                  {pendingDeleteAction === "installing" ? "Remove download" : pendingDeleteGame.isExternal ? "Unlink game" : "Delete game"}
                </DialogTitle>
                <DialogDescription>
                  {pendingDeleteAction === "installing"
                    ? `Remove “${pendingDeleteGame.name}”? Any downloaded data will be deleted.`
                    : pendingDeleteGame.isExternal
                      ? `Unlink “${pendingDeleteGame.name}” from your library? Your files won’t be touched.`
                      : `Delete “${pendingDeleteGame.name}”? This removes the installed files from disk.`}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
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
                  {pendingDeleteAction === "installing" ? "Remove" : pendingDeleteGame.isExternal ? "Unlink" : "Delete"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
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
      {launchOptionsGame && (
        <LaunchOptionsModal
          open={Boolean(launchOptionsGame)}
          appid={launchOptionsGame.appid}
          gameName={launchOptionsGame.name}
          onClose={() => setLaunchOptionsGame(null)}
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

// ---- CollectionFilterStrip ---------------------------------------------------
// Horizontally scrollable chip row (Steam-style) with arrow-button overflow nav
// and a searchable popover that lists every collection. Keeps the strip tidy
// when the user accumulates many collections without hiding any of them.

function NotInstalledOverlay({ onInstall }: { onInstall: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="pointer-events-none absolute inset-0 z-30 rounded-2xl overflow-hidden">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[1px]" />
      <div className="absolute top-2 left-2">
        <span className="inline-flex items-center gap-1 rounded-full border border-white/[.12] bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-foreground/90 backdrop-blur-sm">
          Not installed
        </span>
      </div>
      <div className="absolute inset-x-2 bottom-2 flex justify-center pointer-events-auto">
        <Button
          size="sm"
          disabled={busy}
          onClick={async (e) => {
            e.preventDefault()
            e.stopPropagation()
            if (busy) return
            setBusy(true)
            try { await onInstall() } finally { setBusy(false) }
          }}
          className="h-8 gap-1.5 rounded-full bg-primary text-primary-foreground hover:brightness-110 text-xs font-semibold shadow-lg"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Install
        </Button>
      </div>
    </div>
  )
}

type CollectionFilterStripProps = {
  availableCollections: string[]
  collectionCounts: Record<string, number>
  allGamesCount: number
  selectedCollection: string
  setSelectedCollection: (value: string) => void
  renameCollection: (oldName: string, nextName: string) => Promise<void> | void
  deleteCollection: (name: string) => Promise<void> | void
  selectionMode: boolean
  selectedCount: number
  onRemoveFromSelected: (collection: string) => Promise<void> | void
}

function CollectionFilterStrip({
  availableCollections,
  collectionCounts,
  allGamesCount,
  selectedCollection,
  setSelectedCollection,
  renameCollection,
  deleteCollection,
  selectionMode,
  selectedCount,
  onRemoveFromSelected,
}: CollectionFilterStripProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState("")

  // Pin the selected chip and the top 6 most-populated collections in the
  // visible strip; everything else lives in the "All" popover. This keeps
  // the strip readable even with 30+ collections.
  const PIN_COUNT = 6
  const visibleCollections = useMemo(() => {
    if (availableCollections.length <= PIN_COUNT + 1) return availableCollections
    const sortedByCount = [...availableCollections].sort(
      (a, b) => (collectionCounts[b] || 0) - (collectionCounts[a] || 0)
    )
    const top = sortedByCount.slice(0, PIN_COUNT)
    if (
      selectedCollection !== "all" &&
      !top.some((c) => c.toLowerCase() === selectedCollection.toLowerCase())
    ) {
      const exact = availableCollections.find(
        (c) => c.toLowerCase() === selectedCollection.toLowerCase()
      )
      if (exact) top.unshift(exact)
    }
    return Array.from(new Set(top))
  }, [availableCollections, collectionCounts, selectedCollection])

  const overflowCollections = useMemo(() => {
    if (visibleCollections === availableCollections) return [] as string[]
    const visibleSet = new Set(visibleCollections.map((c) => c.toLowerCase()))
    return availableCollections.filter((c) => !visibleSet.has(c.toLowerCase()))
  }, [availableCollections, visibleCollections])

  const filteredPicker = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase()
    if (!q) return availableCollections
    return availableCollections.filter((c) => c.toLowerCase().includes(q))
  }, [availableCollections, pickerQuery])

  const updateArrowState = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 4)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    updateArrowState()
    const onScroll = () => updateArrowState()
    el.addEventListener("scroll", onScroll, { passive: true })
    const ro = new ResizeObserver(updateArrowState)
    ro.observe(el)
    return () => {
      el.removeEventListener("scroll", onScroll)
      ro.disconnect()
    }
  }, [updateArrowState, visibleCollections.length])

  const nudge = (direction: 1 | -1) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: direction * Math.max(200, el.clientWidth * 0.6), behavior: "smooth" })
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5">
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => nudge(-1)}
            aria-label="Scroll collections left"
            className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/[.07] bg-background/80 text-foreground/80 hover:bg-white/[.07] hover:text-white transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        )}
        <div
          ref={scrollRef}
          className="flex-1 min-w-0 overflow-x-auto uc-scrollbar-thin pb-1 -mb-1"
          style={{ scrollbarWidth: "none" }}
        >
          <div className="flex items-center gap-1.5 w-max">
            <CollectionPill
              label="All games"
              count={allGamesCount}
              active={selectedCollection === "all"}
              onClick={() => setSelectedCollection("all")}
            />
            {visibleCollections.map((collection) => (
              <CollectionPill
                key={collection}
                label={collection}
                count={collectionCounts[collection] || 0}
                active={selectedCollection.toLowerCase() === collection.toLowerCase()}
                onClick={() =>
                  setSelectedCollection(
                    selectedCollection.toLowerCase() === collection.toLowerCase()
                      ? "all"
                      : collection
                  )
                }
                onRename={(next) => void renameCollection(collection, next)}
                onDelete={() => void deleteCollection(collection)}
                onRemoveFromSelected={
                  selectionMode && selectedCount > 0
                    ? () => void onRemoveFromSelected(collection)
                    : undefined
                }
              />
            ))}
            {overflowCollections.length > 0 && (
              <Popover open={pickerOpen} onOpenChange={(open) => { setPickerOpen(open); if (!open) setPickerQuery("") }}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/[.07] bg-white/[.03] px-3 py-1 text-[12px] font-medium text-foreground/90 hover:bg-white/[.07] hover:text-white transition-colors whitespace-nowrap"
                  >
                    <Layers3 className="h-3 w-3" />
                    +{overflowCollections.length} more
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-72 p-0 bg-background/95 border border-white/[.08] rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl"
                >
                  <div className="p-2 border-b border-white/[.06]">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/80 pointer-events-none" />
                      <Input
                        autoFocus
                        value={pickerQuery}
                        onChange={(e) => setPickerQuery(e.target.value)}
                        placeholder={`Search ${availableCollections.length} collections…`}
                        className="pl-8 h-8 rounded-lg bg-white/[.03] border-white/[.07] text-xs"
                      />
                    </div>
                  </div>
                  <div className="max-h-72 overflow-y-auto uc-scrollbar py-1">
                    {filteredPicker.length === 0 ? (
                      <div className="px-3 py-4 text-center text-xs text-muted-foreground/80 italic">No match</div>
                    ) : (
                      filteredPicker.map((collection) => {
                        const isActive =
                          selectedCollection.toLowerCase() === collection.toLowerCase()
                        return (
                          <button
                            key={collection}
                            type="button"
                            onClick={() => {
                              setSelectedCollection(isActive ? "all" : collection)
                              setPickerOpen(false)
                              setPickerQuery("")
                            }}
                            className={cn(
                              "w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                              isActive
                                ? "bg-white/[.07] text-white"
                                : "text-foreground/80 hover:bg-white/[.05] hover:text-white"
                            )}
                          >
                            <Layers3 className={cn("h-3.5 w-3.5 shrink-0", isActive ? "text-foreground/90" : "text-muted-foreground/80")} />
                            <span className="flex-1 truncate">{collection}</span>
                            <span className="text-[10px] tabular-nums text-muted-foreground/80">
                              {collectionCounts[collection] || 0}
                            </span>
                          </button>
                        )
                      })
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
        {canScrollRight && (
          <button
            type="button"
            onClick={() => nudge(1)}
            aria-label="Scroll collections right"
            className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/[.07] bg-background/80 text-foreground/80 hover:bg-white/[.07] hover:text-white transition-colors"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}