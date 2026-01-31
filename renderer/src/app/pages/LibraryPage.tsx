import { useEffect, useMemo, useRef, useState } from "react"
import { GameCard } from "@/components/GameCard"
import { GameCardSkeleton } from "@/components/GameCardSkeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { useGamesData } from "@/hooks/use-games"
import type { Game } from "@/lib/types"
import { useDownloads } from "@/context/downloads-context"
import { Settings, Trash2, AlertTriangle, FolderOpen, ExternalLink } from "lucide-react"
import { ExePickerModal } from "@/components/ExePickerModal"
import { gameLogger } from "@/lib/logger"

type LibraryEntry = {
  appid: string
  name?: string
  metadata?: Game
  installStatus?: string
  installError?: string
}

function manifestToGame(entry: LibraryEntry): Game | null {
  const meta = entry && (entry.metadata as Game | undefined)
  if (meta && meta.appid) return meta
  if (entry && entry.appid) {
    return {
      appid: entry.appid,
      name: entry.name || entry.appid,
      description: "",
      genres: [],
      image: "/banner.png",
      release_date: "",
      size: "",
      source: "local",
      screenshots: [],
      developer: "",
      store: "",
      dlc: [],
    }
  }
  return null
}

export function LibraryPage() {
  const { stats, loading: statsLoading } = useGamesData()
  const { downloads, clearByAppid } = useDownloads()
  const [loading, setLoading] = useState(true)
  const [installed, setInstalled] = useState<Game[]>([])
  const [installing, setInstalling] = useState<Game[]>([])
  const [installingMeta, setInstallingMeta] = useState<Record<string, { status?: string; error?: string }>>({})
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
  const [settingsPopupGame, setSettingsPopupGame] = useState<Game | null>(null)
  const [shortcutFeedback, setShortcutFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const itemsPerPage = 8
  const [installedPage, setInstalledPage] = useState(1)
  const [installingPage, setInstallingPage] = useState(1)
  const hasLoadedRef = useRef(false)

  const cancelledAppIds = useMemo(() => {
    const ids = new Set<string>()
    for (const item of downloads) {
      if (item.status === "cancelled" && item.appid) ids.add(item.appid)
    }
    return ids
  }, [downloads])

  const visibleInstalled = useMemo(() => installed.filter((game) => !hiddenAppIds.has(game.appid)), [installed, hiddenAppIds])
  const visibleInstalling = useMemo(() => {
    return installing.filter((game) => {
      if (hiddenAppIds.has(game.appid)) return false
      // Filter out cancelled downloads
      if (cancelledAppIds.has(game.appid)) return false
      return true
    })
  }, [installing, hiddenAppIds, cancelledAppIds])

  const installedTotalPages = Math.max(1, Math.ceil(visibleInstalled.length / itemsPerPage))
  const installingTotalPages = Math.max(1, Math.ceil(visibleInstalling.length / itemsPerPage))

  const pagedInstalled = useMemo(() => {
    const start = (installedPage - 1) * itemsPerPage
    return visibleInstalled.slice(start, start + itemsPerPage)
  }, [visibleInstalled, installedPage, itemsPerPage])

  const pagedInstalling = useMemo(() => {
    const start = (installingPage - 1) * itemsPerPage
    return visibleInstalling.slice(start, start + itemsPerPage)
  }, [visibleInstalling, installingPage, itemsPerPage])

  const cancelledKey = useMemo(() => {
    if (!cancelledAppIds.size) return ""
    return Array.from(cancelledAppIds).sort().join("|")
  }, [cancelledAppIds])

  const failedAppIds = useMemo(() => {
    const ids = new Set<string>()
    for (const item of downloads) {
      if ((item.status === "failed" || item.status === "extract_failed") && item.appid) ids.add(item.appid)
    }
    for (const [appid, meta] of Object.entries(installingMeta)) {
      if (meta?.status === "failed") ids.add(appid)
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
        const installedGames = installedList
          .map((entry: LibraryEntry) => manifestToGame(entry))
          .filter(Boolean) as Game[]
        const installingMetaMap: Record<string, { status?: string; error?: string }> = {}
        const installingGames = installingList
          .map((entry: LibraryEntry) => manifestToGame(entry))
          .filter(Boolean) as Game[]
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

  const handleDeleteInstalled = async (game: Game) => {
    setHiddenAppIds((prev) => {
      const next = new Set(prev)
      next.add(game.appid)
      return next
    })
    setInstalled((prev) => prev.filter((item) => item.appid !== game.appid))
    try {
      await window.ucDownloads?.deleteInstalled?.(game.appid)
      // Also delete the desktop shortcut if it exists
      await window.ucDownloads?.deleteDesktopShortcut?.(game.name)
      clearByAppid(game.appid)
    } finally {
      setRefreshTick((tick) => tick + 1)
      setHiddenAppIds((prev) => {
        const next = new Set(prev)
        next.delete(game.appid)
        return next
      })
    }
  }

  const handleDeleteInstalling = async (game: Game) => {
    setHiddenAppIds((prev) => {
      const next = new Set(prev)
      next.add(game.appid)
      return next
    })
    setInstalling((prev) => prev.filter((item) => item.appid !== game.appid))
    try {
      await window.ucDownloads?.deleteInstalling?.(game.appid)
      clearByAppid(game.appid)
    } finally {
      setRefreshTick((tick) => tick + 1)
      setHiddenAppIds((prev) => {
        const next = new Set(prev)
        next.delete(game.appid)
        return next
      })
    }
  }

  const getSavedExe = async (appid: string) => {
    if (!window.ucSettings?.get) return null
    try {
      return await window.ucSettings.get(`gameExe:${appid}`)
    } catch {
      return null
    }
  }

  const setSavedExe = async (appid: string, path: string | null) => {
    if (!window.ucSettings?.set) return
    try {
      await window.ucSettings.set(`gameExe:${appid}`, path || null)
    } catch {}
  }

  const dirname = (targetPath: string | null | undefined) => {
    if (!targetPath) return null
    const parts = targetPath.split(/[/\\]+/).filter(Boolean)
    parts.pop()
    return parts.length ? parts.join("\\") : null
  }

  const resolveBasename = (targetPath: string | null) => {
    if (!targetPath) return null
    const parts = targetPath.split(/[\\/]/)
    return parts[parts.length - 1] || null
  }

  const openExeSettings = (game: Game) => {
    setSettingsPopupGame(game)
    setShortcutFeedback(null)
    setSettingsPopupOpen(true)
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
      const savedName = resolveBasename(savedExe)
      const message = savedName
        ? `Select the exe to launch for "${game.name}".`
        : `Select the exe to launch for "${game.name}".`
      setExePickerTitle("Set launch executable")
      setExePickerMessage(message)
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

      // Prefer the directory of the saved exe (or first discovered exe) if it lives inside the folder.
      const preferredExePath = discoveredExePath
      const exeDir = preferredExePath ? dirname(preferredExePath) : null
      const candidate = exeDir || null
      if (folder && candidate && candidate.toLowerCase().startsWith(folder.toLowerCase())) {
        folder = candidate
      } else if (!folder && candidate) {
        folder = candidate
      } else if (folder && window.ucDownloads?.findGameSubfolder) {
        // If no exe is set, check if there's a game subfolder to navigate to
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

  const handleExePicked = async (path: string) => {
    if (!exePickerAppId) return
    await setSavedExe(exePickerAppId, path)
    // Update the current path to reflect the new selection
    setExePickerCurrentPath(path)
  }

  return (
    <div className="container mx-auto max-w-7xl space-y-10">
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl sm:text-3xl font-black font-montserrat">Your Library</h1>
          <Badge className="rounded-full bg-primary/15 text-primary border-primary/20">Direct downloads</Badge>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Titles detected inside your installed and installing folders appear here.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-black font-montserrat">Installed</h2>
        {loading || statsLoading ? (
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {Array.from({ length: 8 }).map((_, idx) => (
              <GameCardSkeleton key={idx} />
            ))}
          </div>
        ) : visibleInstalled.length ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {pagedInstalled.map((game) => (
                <div key={game.appid} className="relative">
                  <GameCard game={game} stats={stats[game.appid]} size="compact" />
                  <div className="absolute top-2 left-2 z-20">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        void openExeSettings(game)
                      }}
                      className="h-8 w-8 rounded-full bg-black/60 text-white hover:bg-white/20"
                      title="Change launch executable"
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="absolute top-2 right-2 z-20">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setPendingDeleteGame(game)
                        setPendingDeleteAction("installed")
                      }}
                      className="h-8 w-8 rounded-full bg-black/60 text-white hover:bg-white/20"
                      title="Delete installed game"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            {installedTotalPages > 1 && (
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => setInstalledPage(Math.max(1, installedPage - 1))}
                      className={installedPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                  {Array.from({ length: installedTotalPages }, (_, index) => index + 1).map((page) => (
                    <PaginationItem key={`installed-${page}`}>
                      <PaginationLink
                        onClick={() => setInstalledPage(page)}
                        isActive={installedPage === page}
                        className="cursor-pointer"
                      >
                        {page}
                      </PaginationLink>
                    </PaginationItem>
                  ))}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => setInstalledPage(Math.min(installedTotalPages, installedPage + 1))}
                      className={
                        installedPage === installedTotalPages ? "pointer-events-none opacity-50" : "cursor-pointer"
                      }
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-border/60 bg-card/60 p-6 text-sm text-muted-foreground">
            No installed titles yet. Start a download to populate your library.
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-black font-montserrat">Installing</h2>
        {loading || statsLoading ? (
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {Array.from({ length: 8 }).map((_, idx) => (
              <GameCardSkeleton key={idx} />
            ))}
          </div>
        ) : visibleInstalling.length ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {pagedInstalling.map((game) => (
                <div key={game.appid} className="relative">
                  <GameCard game={game} stats={stats[game.appid]} size="compact" />
                  {cancelledAppIds.has(game.appid) ? (
                    <>
                      <div className="absolute top-2 left-2 z-20">
                        <Badge className="rounded-full bg-amber-500/20 text-amber-200 border border-amber-400/40 px-2 py-0.5 text-[11px]">
                          Cancelled
                        </Badge>
                      </div>
                      <div className="absolute top-2 right-2 z-20">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            setPendingDeleteGame(game)
                            setPendingDeleteAction("installing")
                          }}
                          className="h-8 w-8 rounded-full bg-black/60 text-white hover:bg-white/20"
                          title="Remove cancelled download"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </>
                  ) : failedAppIds.has(game.appid) ? (
                    <>
                      <div className="absolute top-2 left-2 z-20">
                        <Badge className="rounded-full bg-destructive/20 text-destructive border border-destructive/40 px-2 py-0.5 text-[11px]">
                          Failed
                        </Badge>
                      </div>
                      <div className="absolute top-2 right-2 z-20">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            setPendingDeleteGame(game)
                            setPendingDeleteAction("installing")
                          }}
                          className="h-8 w-8 rounded-full bg-black/60 text-white hover:bg-white/20"
                          title="Remove failed download"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </>
                  ) : null}
                </div>
              ))}
            </div>
            {installingTotalPages > 1 && (
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => setInstallingPage(Math.max(1, installingPage - 1))}
                      className={installingPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                  {Array.from({ length: installingTotalPages }, (_, index) => index + 1).map((page) => (
                    <PaginationItem key={`installing-${page}`}>
                      <PaginationLink
                        onClick={() => setInstallingPage(page)}
                        isActive={installingPage === page}
                        className="cursor-pointer"
                      >
                        {page}
                      </PaginationLink>
                    </PaginationItem>
                  ))}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => setInstallingPage(Math.min(installingTotalPages, installingPage + 1))}
                      className={
                        installingPage === installingTotalPages ? "pointer-events-none opacity-50" : "cursor-pointer"
                      }
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-border/60 bg-card/60 p-6 text-sm text-muted-foreground">
            No current installs. Downloads will appear here while they install.
          </div>
        )}
      </section>
      {pendingDeleteGame && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => {
              setPendingDeleteGame(null)
              setPendingDeleteAction(null)
            }}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-border/60 bg-slate-950/95 p-5 text-white shadow-2xl">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {pendingDeleteAction === "installing" ? "Remove download" : "Delete game"}
            </div>
            <p className="mt-2 text-sm text-slate-300">
              {pendingDeleteAction === "installing"
                ? `Remove "${pendingDeleteGame.name}" from the installing list? This will delete any downloaded data.`
                : `Delete "${pendingDeleteGame.name}" permanently? This removes the installed files from disk.`}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setPendingDeleteGame(null)
                  setPendingDeleteAction(null)
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  const target = pendingDeleteGame
                  const action = pendingDeleteAction
                  setPendingDeleteGame(null)
                  setPendingDeleteAction(null)
                  if (!target) return
                  setTimeout(() => {
                    if (action === "installing") {
                      void handleDeleteInstalling(target)
                    } else {
                      void handleDeleteInstalled(target)
                    }
                  }, 0)
                }}
              >
                {pendingDeleteAction === "installing" ? "Remove" : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}
      {settingsPopupOpen && settingsPopupGame && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => {
              setSettingsPopupOpen(false)
              setShortcutFeedback(null)
            }}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-border/60 bg-slate-950/95 p-5 text-white shadow-2xl">
            <div className="text-lg font-semibold">Game Settings</div>
            <p className="mt-1 text-sm text-slate-300">{settingsPopupGame.name}</p>
            
            <div className="mt-4 space-y-2">
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={() => {
                  void openExecutablePicker(settingsPopupGame)
                }}
              >
                <Settings className="mr-2 h-4 w-4" />
                Set Executable
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={() => {
                  if (settingsPopupGame) {
                    void handleOpenGameFiles(settingsPopupGame)
                  }
                }}
              >
                <FolderOpen className="mr-2 h-4 w-4" />
                Open Game Files
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={async () => {
                  if (settingsPopupGame) {
                    setShortcutFeedback(null)
                    let savedExe = await window.ucSettings?.get?.(`gameExe:${settingsPopupGame.appid}`)
                    if (!savedExe && window.ucDownloads?.listGameExecutables) {
                      try {
                        const result = await window.ucDownloads.listGameExecutables(settingsPopupGame.appid)
                        savedExe = result?.exes?.[0]?.path || null
                      } catch {}
                    }

                    if (savedExe) {
                      const result = await window.ucDownloads?.createDesktopShortcut?.(settingsPopupGame.name, savedExe)
                      if (result?.ok) {
                        gameLogger.info('Desktop shortcut created manually', { appid: settingsPopupGame.appid })
                        setShortcutFeedback({ type: 'success', message: 'Desktop shortcut created.' })
                      } else if (result?.existed) {
                        gameLogger.info('Desktop shortcut already exists', { appid: settingsPopupGame.appid })
                        setShortcutFeedback({ type: 'success', message: 'Desktop shortcut already exists.' })
                      } else {
                        setShortcutFeedback({ type: 'error', message: 'Failed to create desktop shortcut.' })
                      }
                    } else {
                      gameLogger.warn('No saved exe found for creating shortcut', { appid: settingsPopupGame.appid })
                      setShortcutFeedback({ type: 'error', message: 'Select an executable first.' })
                      void openExecutablePicker(settingsPopupGame)
                    }
                    setTimeout(() => setShortcutFeedback(null), 3000)
                  }
                }}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Create Desktop Shortcut
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start text-destructive hover:text-destructive"
                onClick={() => {
                  if (settingsPopupGame) {
                    setSettingsPopupOpen(false)
                    setShortcutFeedback(null)
                    setPendingDeleteGame(settingsPopupGame)
                    setPendingDeleteAction("installed")
                  }
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Game
              </Button>
            </div>

            {shortcutFeedback && (
              <div className={`mt-3 text-xs ${shortcutFeedback.type === 'success' ? 'text-emerald-400' : 'text-destructive'}`}>
                {shortcutFeedback.message}
              </div>
            )}

            <div className="mt-4 flex justify-end">
              <Button
                variant="ghost"
                onClick={() => {
                  setSettingsPopupOpen(false)
                  setShortcutFeedback(null)
                }}
              >
                Close
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
    </div>
  )
}
