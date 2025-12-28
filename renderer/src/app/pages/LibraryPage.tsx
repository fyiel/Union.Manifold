import { useEffect, useMemo, useState } from "react"
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
import { Trash2, XCircle, AlertTriangle } from "lucide-react"

type LibraryEntry = {
  appid: string
  name?: string
  metadata?: Game
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
  const [refreshTick, setRefreshTick] = useState(0)
  const [pendingDeleteAppId, setPendingDeleteAppId] = useState<string | null>(null)
  const itemsPerPage = 8
  const [installedPage, setInstalledPage] = useState(1)
  const [installingPage, setInstallingPage] = useState(1)

  const installedTotalPages = Math.max(1, Math.ceil(installed.length / itemsPerPage))
  const installingTotalPages = Math.max(1, Math.ceil(installing.length / itemsPerPage))

  const pagedInstalled = useMemo(() => {
    const start = (installedPage - 1) * itemsPerPage
    return installed.slice(start, start + itemsPerPage)
  }, [installed, installedPage, itemsPerPage])

  const pagedInstalling = useMemo(() => {
    const start = (installingPage - 1) * itemsPerPage
    return installing.slice(start, start + itemsPerPage)
  }, [installing, installingPage, itemsPerPage])

  const cancelledAppIds = useMemo(() => {
    const ids = new Set<string>()
    for (const item of downloads) {
      if (item.status === "cancelled" && item.appid) ids.add(item.appid)
    }
    return ids
  }, [downloads])

  const queuedAppIds = useMemo(() => {
    const ids = new Set<string>()
    for (const item of downloads) {
      if (item.status === "queued" && item.appid) ids.add(item.appid)
    }
    return ids
  }, [downloads])

  useEffect(() => {
    let mounted = true
    const loadLibrary = async () => {
      setLoading(true)
      try {
        const [installedList, installingList] = await Promise.all([
          window.ucDownloads?.listInstalledGlobal?.() || window.ucDownloads?.listInstalled?.() || [],
          window.ucDownloads?.listInstallingGlobal?.() || window.ucDownloads?.listInstalling?.() || [],
        ])
        if (!mounted) return
        const installedGames = installedList
          .map((entry: LibraryEntry) => manifestToGame(entry))
          .filter(Boolean) as Game[]
        const installingGames = installingList
          .map((entry: LibraryEntry) => manifestToGame(entry))
          .filter(Boolean) as Game[]
        setInstalled(installedGames)
        setInstalling(installingGames)
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void loadLibrary()
    return () => {
      mounted = false
    }
  }, [refreshTick, cancelledAppIds])

  const handleDeleteInstalled = async (game: Game) => {
    try {
      await window.ucDownloads?.deleteInstalled?.(game.appid)
      clearByAppid(game.appid)
    } finally {
      setRefreshTick((tick) => tick + 1)
    }
  }

  const handleDeleteInstalling = async (game: Game) => {
    try {
      await window.ucDownloads?.deleteInstalling?.(game.appid)
      clearByAppid(game.appid)
    } finally {
      setRefreshTick((tick) => tick + 1)
    }
  }

  return (
    <div className="space-y-10">
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
        ) : installed.length ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {pagedInstalled.map((game) => (
                <div key={game.appid} className="relative">
                  <GameCard game={game} stats={stats[game.appid]} size="compact" />
                  <div className="absolute top-2 right-2 z-20">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setPendingDeleteAppId(game.appid)
                      }}
                      className="h-8 w-8 rounded-full bg-black/60 text-white hover:bg-destructive hover:text-destructive-foreground"
                      title="Delete installed game"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {pendingDeleteAppId === game.appid && (
                    <div className="absolute inset-x-2 bottom-2 z-30 rounded-xl border border-destructive/40 bg-black/80 p-3 text-xs text-white shadow-lg">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-destructive" />
                        <span className="font-semibold">Delete this game permanently?</span>
                      </div>
                      <div className="mt-2 flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            setPendingDeleteAppId(null)
                          }}
                          className="h-7 px-2 text-white/80 hover:text-white"
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            setPendingDeleteAppId(null)
                            void handleDeleteInstalled(game)
                          }}
                          className="h-7 px-2"
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  )}
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
        ) : installing.length ? (
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
                            void handleDeleteInstalling(game)
                          }}
                          className="h-8 w-8 rounded-full bg-black/60 text-white hover:bg-amber-500/80 hover:text-white"
                          title="Remove cancelled download"
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      </div>
                    </>
                  ) : queuedAppIds.has(game.appid) ? (
                    <div className="absolute top-2 left-2 z-20">
                      <Badge className="rounded-full bg-sky-500/20 text-sky-200 border border-sky-400/40 px-2 py-0.5 text-[11px]">
                        Queued
                      </Badge>
                    </div>
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
    </div>
  )
}
