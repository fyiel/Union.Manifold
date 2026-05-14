import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  Layers3,
  Pencil,
  Plus,
  Search,
  GitFork,
  Trash2,
  X,
  Check,
  AlertTriangle,
  ArrowRight,
  Share2,
  Globe,
  Lock,
  Copy,
  ExternalLink,
  Cloud,
  CloudOff,
  Download,
  Bell,
  BellOff,
  Sparkles,
  Loader2,
  RefreshCw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { getInstalledVersionLabel, hasInstalledVersionUpdate, proxyImageUrl, getCardImage, cn } from "@/lib/utils"
import { useUserCollections, type UserCollection } from "@/hooks/use-user-collections"
import { useGamesData } from "@/hooks/use-games"
import { forkCloudCollection, shareUrlFor } from "@/lib/cloud-collections"
import { useFollowedCollections, type FollowedCollection } from "@/hooks/use-followed-collections"
import { useDownloadsActions } from "@/context/downloads-context"
import { getCatalogCache, type CatalogGame } from "@/lib/catalog"
import { apiFetch } from "@/lib/api"

type InstalledGame = {
  appid: string
  name: string
  image?: string
  version?: string
}

export function CollectionsPage() {
  const navigate = useNavigate()
  const {
    collections,
    loading,
    authed,
    error,
    clearError,
    refresh,
    create,
    setMembership,
    rename,
    remove,
    share,
    unshare,
  } = useUserCollections()
  const [installed, setInstalled] = useState<InstalledGame[]>([])
  const [installedLoading, setInstalledLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<UserCollection | null>(null)
  const [renameDraft, setRenameDraft] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<UserCollection | null>(null)
  const [editTarget, setEditTarget] = useState<UserCollection | null>(null)
  const [shareTarget, setShareTarget] = useState<UserCollection | null>(null)
  const [batchInstallStatus, setBatchInstallStatus] = useState<{
    name: string
    queued: number
    skipped: number
  } | null>(null)
  const [syncTarget, setSyncTarget] = useState<FollowedCollection | null>(null)
  const [forkingId, setForkingId] = useState<string | null>(null)
  const [forkError, setForkError] = useState<string | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const { startGameDownload } = useDownloadsActions()
  const { games: catalogGames } = useGamesData()
  const followed = useFollowedCollections()
  const pageError = error || forkError
  const catalogVersionByAppid = useMemo(() => {
    const source = catalogGames.length > 0 ? catalogGames : getCatalogCache().games
    return new Map(source.map((game) => [game.appid, game.version || ""]))
  }, [catalogGames])

  const catalogById = useMemo(() => {
    const source = catalogGames.length > 0 ? catalogGames : getCatalogCache().games
    return new Map(source.map((g) => [g.appid, g]))
  }, [catalogGames])

  // Combined list for the collection editor: installed games first, then every
  // catalog game not already installed so users can add uninstalled titles.
  const allGamesForPicker = useMemo(() => {
    const installedSet = new Set(installed.map((g) => g.appid))
    const result: Array<{ appid: string; name: string; image?: string; installed: boolean }> = installed.map((g) => ({
      appid: g.appid,
      name: g.name,
      image: g.image,
      installed: true,
    }))
    catalogById.forEach((g, appid) => {
      if (!installedSet.has(appid)) {
        result.push({
          appid,
          name: g.name,
          image: g.image || g.hero_image || g.splash || "",
          installed: false,
        })
      }
    })
    return result
  }, [installed, catalogById])

  // ---- Load installed games for the picker + cover mosaics ----
  useEffect(() => {
    let mounted = true
    void (async () => {
      try {
        const list =
          (await window.ucDownloads?.listInstalledGlobal?.()) ||
          (await window.ucDownloads?.listInstalled?.()) ||
          []
        if (!mounted) return
        const games: InstalledGame[] = []
        for (const entry of list as any[]) {
          const item = entry?.metadata || entry
          if (!item?.appid) continue
          games.push({
            appid: item.appid,
            name: item.name || item.appid,
            image: item.image || item.localImage || "",
            version: getInstalledVersionLabel(entry) || item.version || "",
          })
        }
        games.sort((a, b) => a.name.localeCompare(b.name))
        setInstalled(games)
      } finally {
        if (mounted) setInstalledLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  const installedById = useMemo(() => new Map(installed.map((g) => [g.appid, g])), [installed])

  // Batch-install every missing game in a collection. Resolves each appid from
  // the cached catalog (the one Browse already keeps warm) and feeds them to
  // `startGameDownload` one by one — the downloads queue handles concurrency
  // limits, mirror selection, and retries.
  const handleInstallMissing = useCallback(
    async (collection: UserCollection) => {
      const catalog = getCatalogCache().games as CatalogGame[]
      const byId = new Map(catalog.map((g) => [g.appid, g]))
      const missingAppids = collection.appids.filter((id) => !installedById.has(id))
      let queued = 0
      let skipped = 0
      for (const appid of missingAppids) {
        const game = byId.get(appid)
        if (!game) {
          skipped += 1
          continue
        }
        try {
          await startGameDownload(game as any)
          queued += 1
        } catch {
          skipped += 1
        }
      }
      setBatchInstallStatus({ name: collection.name, queued, skipped })
    },
    [installedById, startGameDownload]
  )

  const handleUpdateAll = useCallback(
    async (collection: UserCollection) => {
      const catalog = getCatalogCache().games as CatalogGame[]
      const byId = new Map(catalog.map((g) => [g.appid, g]))
      const outdatedAppids = collection.appids.filter((id) => {
        const inst = installedById.get(id)
        if (!inst) return false
        return hasInstalledVersionUpdate(catalogVersionByAppid.get(id), [inst.version])
      })
      let queued = 0
      let skipped = 0
      for (const appid of outdatedAppids) {
        const game = byId.get(appid)
        if (!game) { skipped += 1; continue }
        try {
          await startGameDownload(game as any)
          queued += 1
        } catch {
          skipped += 1
        }
      }
      setBatchInstallStatus({ name: collection.name, queued, skipped })
    },
    [installedById, catalogVersionByAppid, startGameDownload]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return collections
    return collections.filter((c) => c.name.toLowerCase().includes(q))
  }, [collections, search])

  // ---- Rename inline focus management ----
  useEffect(() => {
    if (renameTarget) {
      const id = window.setTimeout(() => renameInputRef.current?.select(), 30)
      return () => window.clearTimeout(id)
    }
  }, [renameTarget])

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-white">Collections</h1>
          <p className="text-sm text-zinc-400">
            Group your games into collections you can filter, share, and resync across devices.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SyncStatus authed={authed} loading={loading} />
          <Button
            className="rounded-2xl gap-2 h-10"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" />
            New collection
          </Button>
        </div>
      </header>

      {pageError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-start justify-between gap-3">
          <span className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            {pageError}
          </span>
          <button
            type="button"
            onClick={() => {
              clearError()
              setForkError(null)
            }}
            className="text-destructive/80 hover:text-destructive"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Search */}
      {!loading && collections.length > 0 && (
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search collections…"
            className="rounded-2xl bg-white/[.03] border-white/[.07] pl-10 h-11"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-100 transition-colors"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Following — collections curated by other people that the user tracks. */}
      {followed.items && followed.items.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                <Bell className="h-4 w-4" />
                Following
                {followed.items.some((c) => c.hasUpdates) && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300 text-[10px] font-semibold px-2 py-0.5">
                    <Sparkles className="h-2.5 w-2.5" />
                    {followed.items.filter((c) => c.hasUpdates).length} updated
                  </span>
                )}
              </h2>
              <p className="text-xs text-zinc-500">
                Collections by other people. When the owner adds games, you'll see an Update badge.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void followed.refresh()}
              className="inline-flex items-center gap-1 rounded-full border border-white/[.07] bg-white/[.03] px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-white/[.07] hover:text-white transition-colors"
            >
              <RefreshCw className={cn("h-3 w-3", followed.loading && "animate-spin")} />
              Refresh
            </button>
          </div>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {followed.items.map((collection) => (
              <FollowedCard
                key={collection.id}
                collection={collection}
                installedById={installedById}
                onSync={() => setSyncTarget(collection)}
                onFork={async () => {
                  if (!collection.shareToken || forkingId) return
                  setForkError(null)
                  setForkingId(collection.id)
                  try {
                    const forked = await forkCloudCollection(collection.shareToken)
                    await refresh()
                    navigate(`/library?collection=${encodeURIComponent(forked.name)}`)
                  } catch (err) {
                    console.error("fork followed collection failed", err)
                    setForkError(err instanceof Error ? err.message : "Could not fork collection")
                  } finally {
                    setForkingId(null)
                  }
                }}
                forking={forkingId === collection.id}
                onMarkSeen={() => void followed.markSeen(collection)}
                onUnfollow={() => void followed.unfollow(collection)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Sync popup */}
      <SyncCollectionDialog
        target={syncTarget}
        installedById={installedById}
        onClose={() => setSyncTarget(null)}
        onConfirm={async (missing) => {
          const catalog = getCatalogCache().games as CatalogGame[]
          const byId = new Map(catalog.map((g) => [g.appid, g]))
          let queued = 0
          let skipped = 0
          for (const appid of missing) {
            const game = byId.get(appid)
            if (!game) {
              skipped += 1
              continue
            }
            try {
              await startGameDownload(game as any)
              queued += 1
            } catch {
              skipped += 1
            }
          }
          if (syncTarget) {
            await followed.markSeen(syncTarget)
          }
          setSyncTarget(null)
          if (queued > 0 || skipped > 0) {
            setBatchInstallStatus({ name: syncTarget?.name || "Collection", queued, skipped })
          }
        }}
      />

      {/* Body */}
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
            <Layers3 className="h-4 w-4" />
            Made by you
          </h2>
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1 rounded-full border border-white/[.07] bg-white/[.03] px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-white/[.07] hover:text-white transition-colors"
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </section>
      {loading || installedLoading ? (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 6 }).map((_, idx) => (
            <CollectionCardSkeleton key={idx} />
          ))}
        </div>
      ) : collections.length === 0 ? (
        <EmptyState
          onCreate={() => setCreateOpen(true)}
        />
      ) : filtered.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/[.07] bg-white/[.02] p-10 text-center text-sm text-zinc-400">
          No collections match "{search}".{" "}
          <button
            type="button"
            onClick={() => setSearch("")}
            className="text-zinc-200 underline-offset-2 hover:underline"
          >
            Clear search
          </button>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((collection) => (
            <CollectionCard
              key={collection.id}
              collection={collection}
              installedById={installedById}
              catalogById={catalogById}
              catalogVersionByAppid={catalogVersionByAppid}
              renaming={renameTarget?.id === collection.id}
              renameDraft={renameDraft}
              renameInputRef={renameInputRef}
              onOpen={() => navigate(`/library?collection=${encodeURIComponent(collection.name)}`)}
              onStartRename={() => {
                setRenameDraft(collection.name)
                setRenameTarget(collection)
              }}
              onChangeRename={setRenameDraft}
              onCommitRename={async () => {
                await rename(collection, renameDraft.trim())
                setRenameTarget(null)
              }}
              onCancelRename={() => setRenameTarget(null)}
              onEditMembers={() => setEditTarget(collection)}
              onDelete={() => setDeleteTarget(collection)}
              onShare={() => setShareTarget(collection)}
              onInstallMissing={() => void handleInstallMissing(collection)}
              onUpdateOutdated={() => void handleUpdateAll(collection)}
            />
          ))}
        </div>
      )}

      {/* Batch install feedback */}
      <Dialog
        open={batchInstallStatus != null}
        onOpenChange={(open) => { if (!open) setBatchInstallStatus(null) }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              {batchInstallStatus && batchInstallStatus.queued > 0
                ? `Queued ${batchInstallStatus.queued} download${batchInstallStatus.queued === 1 ? "" : "s"}`
                : "Nothing queued"}
            </DialogTitle>
            <DialogDescription>
              {batchInstallStatus?.skipped
                ? `${batchInstallStatus.skipped} game${batchInstallStatus.skipped === 1 ? "" : "s"} couldn't be queued — they may have been removed from the catalogue.`
                : "Track progress in the Activity tab."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setBatchInstallStatus(null)}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create dialog */}
      <CollectionEditorDialog
        open={createOpen}
        title="Create a collection"
        description="Pick a name and the games that belong to it."
        games={allGamesForPicker}
        initialName=""
        initialMembers={new Set()}
        confirmLabel="Create"
        onConfirm={async (name, ids) => {
          const created = await create(name, Array.from(ids))
          setCreateOpen(false)
          return Boolean(created)
        }}
        onCancel={() => setCreateOpen(false)}
      />

      {/* Edit members dialog */}
      <CollectionEditorDialog
        open={editTarget != null}
        title={editTarget ? `Edit "${editTarget.name}"` : ""}
        description="Add or remove games. The change syncs to your other devices when signed in."
        games={allGamesForPicker}
        initialName={editTarget?.name || ""}
        initialMembers={new Set(editTarget?.appids || [])}
        confirmLabel="Save"
        nameReadOnly
        onConfirm={async (_name, ids) => {
          if (editTarget) {
            await setMembership(editTarget, Array.from(ids))
          }
          setEditTarget(null)
          return true
        }}
        onCancel={() => setEditTarget(null)}
      />

      {/* Share dialog */}
      <ShareDialog
        target={shareTarget}
        authed={authed === true}
        onClose={() => setShareTarget(null)}
        onShare={share}
        onUnshare={unshare}
      />

      {/* Delete confirm */}
      <Dialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              Delete "{deleteTarget?.name}"?
            </DialogTitle>
            <DialogDescription>
              The collection is removed from your account. Games stay installed and any share links you copied will stop working.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (deleteTarget) {
                  await remove(deleteTarget)
                }
                setDeleteTarget(null)
              }}
            >
              <Trash2 className="h-4 w-4 mr-1.5" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SyncStatus({ authed, loading }: { authed: boolean | null; loading: boolean }) {
  if (loading) {
    return (
      <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-white/[.07] bg-white/[.02] px-3 py-1 text-[11px] text-zinc-500">
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-500 animate-pulse" />
        Syncing…
      </span>
    )
  }
  if (authed) {
    return (
      <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] text-emerald-300">
        <Cloud className="h-3 w-3" />
        Synced to your account
      </span>
    )
  }
  return (
    <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-white/[.07] bg-white/[.02] px-3 py-1 text-[11px] text-zinc-400">
      <CloudOff className="h-3 w-3" />
      Local only — sign in to sync
    </span>
  )
}

function CollectionCard({
  collection,
  installedById,
  catalogById,
  catalogVersionByAppid,
  renaming,
  renameDraft,
  renameInputRef,
  onOpen,
  onStartRename,
  onChangeRename,
  onCommitRename,
  onCancelRename,
  onEditMembers,
  onDelete,
  onShare,
  onInstallMissing,
  onUpdateOutdated,
}: {
  collection: UserCollection
  installedById: Map<string, InstalledGame>
  catalogById: Map<string, CatalogGame>
  catalogVersionByAppid: Map<string, string>
  renaming: boolean
  renameDraft: string
  renameInputRef: React.MutableRefObject<HTMLInputElement | null>
  onOpen: () => void
  onStartRename: () => void
  onChangeRename: (value: string) => void
  onCommitRename: () => void
  onCancelRename: () => void
  onEditMembers: () => void
  onDelete: () => void
  onShare: () => void
  onInstallMissing: () => void
  onUpdateOutdated: () => void
}) {
  const installedAppids = collection.appids.filter((id) => installedById.has(id))
  const missingCount = collection.appids.length - installedAppids.length
  const updateCount = installedAppids.filter((appid) => {
    const installed = installedById.get(appid)
    return hasInstalledVersionUpdate(catalogVersionByAppid.get(appid), [installed?.version])
  }).length
  // Cover mosaic: prefer installed images, fall back to catalog images for uninstalled members
  const coverCandidates: string[] = []
  for (const id of collection.appids) {
    if (coverCandidates.length >= 4) break
    const installedImg = installedById.get(id)?.image
    if (installedImg) { coverCandidates.push(installedImg); continue }
    const catalogGame = catalogById.get(id)
    const catalogImg = catalogGame?.image || catalogGame?.hero_image || catalogGame?.splash
    if (catalogImg) coverCandidates.push(catalogImg)
  }
  const cover = coverCandidates

  return (
    <div className="group/card flex flex-col rounded-3xl border border-white/[.07] bg-zinc-900/40 backdrop-blur-md overflow-hidden transition-colors hover:border-white/[.14]">
      <button
        type="button"
        onClick={onOpen}
        className="relative aspect-[16/10] w-full overflow-hidden bg-zinc-900 cursor-pointer text-left"
        aria-label={`Open ${collection.name}`}
      >
        <CoverMosaic cover={cover} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-2">
          {collection.shareToken && (
            <span className="inline-flex items-center gap-1 rounded-full border border-white/[.10] bg-black/60 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold text-zinc-100">
              {collection.isPublic ? <Globe className="h-2.5 w-2.5" /> : <Share2 className="h-2.5 w-2.5" />}
              {collection.isPublic ? "Public" : "Shared"}
            </span>
          )}
          {!collection.cloud && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold text-amber-300">
              <CloudOff className="h-2.5 w-2.5" />
              Local
            </span>
          )}
        </div>
        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-white/[.10] bg-black/50 backdrop-blur-sm px-2.5 py-0.5 text-[11px] font-semibold text-zinc-200">
            <Layers3 className="h-3 w-3" />
            {collection.appids.length} {collection.appids.length === 1 ? "game" : "games"}
            {missingCount > 0 && (
              <span className="ml-1 rounded-full bg-white/10 px-1 text-[9px] uppercase">
                {missingCount} missing
              </span>
            )}
            {updateCount > 0 && (
              <span className="ml-1 rounded-full bg-emerald-500/20 px-1.5 text-[9px] uppercase text-emerald-200">
                {updateCount} update{updateCount === 1 ? "" : "s"}
              </span>
            )}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-white/[.10] bg-black/50 backdrop-blur-sm px-2.5 py-0.5 text-[11px] font-semibold text-zinc-200 opacity-0 group-hover/card:opacity-100 transition-opacity">
            Open <ArrowRight className="h-3 w-3" />
          </span>
        </div>
      </button>

      <div className="flex items-center gap-2 px-4 py-3 border-t border-white/[.05]">
        {renaming ? (
          <Input
            ref={renameInputRef}
            value={renameDraft}
            onChange={(e) => onChangeRename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                onCommitRename()
              } else if (e.key === "Escape") {
                e.preventDefault()
                onCancelRename()
              }
            }}
            onBlur={onCommitRename}
            className="h-8 rounded-xl bg-white/[.03] border-white/[.10] text-sm font-semibold"
          />
        ) : (
          <h3 className="flex-1 truncate font-semibold text-sm text-white">{collection.name}</h3>
        )}
        <div className="flex items-center gap-1 shrink-0">
          {missingCount > 0 && (
            <IconButton
              title={`Install ${missingCount} missing game${missingCount === 1 ? "" : "s"}`}
              onClick={onInstallMissing}
            >
              <Download className="h-3.5 w-3.5" />
            </IconButton>
          )}
          {updateCount > 0 && (
            <IconButton
              title={`Update ${updateCount} game${updateCount === 1 ? "" : "s"}`}
              onClick={onUpdateOutdated}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </IconButton>
          )}
          <IconButton title="Edit games" onClick={onEditMembers}>
            <Layers3 className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton title="Share" onClick={onShare} disabled={!collection.cloud}>
            <Share2 className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton title="Rename" onClick={onStartRename}>
            <Pencil className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton title="Delete" onClick={onDelete} destructive>
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>
    </div>
  )
}

function CoverMosaic({ cover }: { cover: string[] }) {
  if (cover.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-zinc-700">
        <Layers3 className="h-12 w-12" />
      </div>
    )
  }

  const tiles = cover.slice(0, 4)
  return (
    <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-px bg-zinc-950">
      {tiles.map((src, idx) => (
        <div key={`${src}-${idx}`} className="relative overflow-hidden">
          <img
            src={proxyImageUrl(getCardImage(src))}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0" }}
          />
        </div>
      ))}
      {Array.from({ length: 4 - tiles.length }).map((_, idx) => (
        <div key={`empty-${idx}`} className="bg-zinc-900" />
      ))}
    </div>
  )
}

function CollectionCardSkeleton() {
  return (
    <div className="rounded-3xl border border-white/[.07] bg-zinc-900/40 overflow-hidden">
      <div className="aspect-[16/10] w-full">
        <Skeleton className="h-full w-full rounded-none" />
      </div>
      <div className="flex items-center gap-2 px-4 py-3 border-t border-white/[.05]">
        <Skeleton className="h-4 flex-1 rounded" />
        <Skeleton className="h-7 w-20 rounded-full" />
      </div>
    </div>
  )
}

function FollowedCard({
  collection,
  installedById,
  onSync,
  onFork,
  forking,
  onMarkSeen,
  onUnfollow,
}: {
  collection: FollowedCollection
  installedById: Map<string, InstalledGame>
  onSync: () => void
  onFork: () => void
  forking: boolean
  onMarkSeen: () => void
  onUnfollow: () => void
}) {
  const ownerName = collection.owner.displayName || collection.owner.username || "Someone"
  return (
    <div className="group/card flex flex-col rounded-3xl border border-white/[.07] bg-zinc-900/40 backdrop-blur-md overflow-hidden transition-colors hover:border-white/[.14] relative">
      {collection.hasUpdates && (
        <span className="absolute top-3 left-3 z-20 inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold text-amber-300">
          <Sparkles className="h-2.5 w-2.5" />
          Updated
        </span>
      )}
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-zinc-900">
        {collection.previewCovers.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-700">
            <Layers3 className="h-12 w-12" />
          </div>
        ) : (
          <div className="absolute inset-0 grid grid-cols-3 grid-rows-2 gap-px bg-zinc-950">
            {collection.previewCovers.slice(0, 6).map((tile, idx) => (
              <div key={`${tile.appid}-${idx}`} className="relative overflow-hidden">
                {tile.image ? (
                  <img
                    src={proxyImageUrl(getCardImage(tile.image))}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="h-full w-full bg-zinc-900" />
                )}
              </div>
            ))}
            {Array.from({ length: Math.max(0, 6 - collection.previewCovers.length) }).map((_, idx) => (
              <div key={`empty-${idx}`} className="bg-zinc-900" />
            ))}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-white/[.10] bg-black/50 backdrop-blur-sm px-2.5 py-0.5 text-[11px] font-semibold text-zinc-200">
            <Layers3 className="h-3 w-3" />
            {collection.gameCount} {collection.gameCount === 1 ? "game" : "games"}
          </span>
        </div>
      </div>
      <div className="px-4 py-3 border-t border-white/[.05] space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold text-sm text-white">{collection.name}</p>
            <p className="truncate text-[11px] text-zinc-500">by {ownerName}</p>
          </div>
          <button
            type="button"
            onClick={onUnfollow}
            title="Stop following"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/[.07] bg-white/[.03] text-zinc-400 hover:bg-white/[.07] hover:text-white transition-colors shrink-0"
          >
            <BellOff className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={collection.hasUpdates ? "default" : "outline"}
            size="sm"
            className="flex-1 rounded-full gap-1.5"
            onClick={onSync}
            disabled={!collection.shareToken}
          >
            <Download className="h-3.5 w-3.5" />
            {collection.hasUpdates ? "Sync update" : "Sync"}
          </Button>
          {collection.shareToken && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-full gap-1.5"
              onClick={onFork}
              disabled={forking}
            >
              {forking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitFork className="h-3.5 w-3.5" />}
              {forking ? "Forking" : "Fork"}
            </Button>
          )}
          {collection.shareToken && (
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full px-2.5"
              onClick={() => {
                if (typeof window === "undefined") return
                try {
                  window.open(shareUrlFor(collection.shareToken!), "_blank")
                } catch { /* swallow */ }
                onMarkSeen()
              }}
              title="View on union-crax.xyz"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function SyncCollectionDialog({
  target,
  installedById,
  onClose,
  onConfirm,
}: {
  target: FollowedCollection | null
  installedById: Map<string, InstalledGame>
  onClose: () => void
  onConfirm: (missingAppids: string[]) => Promise<void>
}) {
  const [appids, setAppids] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!target?.shareToken) {
      setAppids(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const res = await apiFetch(`/api/collections/share/${encodeURIComponent(target.shareToken!)}`)
        if (cancelled) return
        if (!res.ok) {
          setError("Couldn't reach the server. Try again in a moment.")
          setAppids(null)
          return
        }
        const data = await res.json()
        setAppids(Array.isArray(data?.appids) ? data.appids.map(String) : [])
      } catch {
        if (!cancelled) {
          setError("Couldn't reach the server. Try again in a moment.")
          setAppids(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [target?.shareToken])

  const missing = useMemo(() => {
    if (!appids) return [] as string[]
    return appids.filter((id) => !installedById.has(id))
  }, [appids, installedById])

  const totalGb = useMemo(() => {
    if (!missing.length) return 0
    const catalog = getCatalogCache().games as CatalogGame[]
    const byId = new Map(catalog.map((g) => [g.appid, g]))
    let gb = 0
    for (const id of missing) {
      const size = byId.get(id)?.size
      if (!size) continue
      const match = String(size).match(/([\d.]+)\s*(GB|MB)/i)
      if (!match) continue
      const value = Number.parseFloat(match[1])
      if (Number.isNaN(value) || value <= 0) continue
      gb += match[2].toUpperCase() === "GB" ? value : value / 1024
    }
    return Math.round(gb * 10) / 10
  }, [missing])

  return (
    <Dialog open={target != null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            {target?.hasUpdates ? `"${target?.name}" has new games` : `Sync "${target?.name}"`}
          </DialogTitle>
          <DialogDescription>
            {target?.hasUpdates
              ? "The creator added games since you last checked in. Here's what's not yet on this PC."
              : "Install every game in this collection that's missing from this PC."}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-zinc-400 gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : (
          <div className="rounded-2xl border border-white/[.07] bg-white/[.02] p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-400">Games to install</span>
              <span className="font-mono text-zinc-100">{missing.length}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-400">Total size</span>
              <span className="font-mono text-zinc-100">
                {totalGb > 0 ? `${totalGb.toLocaleString()} GB` : missing.length > 0 ? "Unknown" : "—"}
              </span>
            </div>
            {missing.length === 0 && appids && appids.length > 0 && (
              <p className="text-xs text-emerald-300 pt-1">You already have every game in this collection.</p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>No, thanks</Button>
          <Button
            onClick={async () => {
              if (missing.length === 0) {
                onClose()
                return
              }
              setSubmitting(true)
              try {
                await onConfirm(missing)
              } finally {
                setSubmitting(false)
              }
            }}
            disabled={loading || submitting || missing.length === 0 || Boolean(error)}
          >
            {submitting ? (
              <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Queuing…</>
            ) : missing.length === 0 ? (
              "Nothing to sync"
            ) : (
              <>Yes, sync {missing.length}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function IconButton({
  children,
  title,
  destructive,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  title: string
  destructive?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/[.07] bg-white/[.03] transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
        destructive
          ? "text-zinc-400 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30"
          : "text-zinc-400 hover:bg-white/[.07] hover:text-white"
      )}
    >
      {children}
    </button>
  )
}

function EmptyState({
  onCreate,
}: {
  onCreate: () => void
}) {
  return (
    <div className="rounded-3xl border border-dashed border-white/[.07] bg-white/[.02] p-10 sm:p-14 text-center space-y-4">
      <div className="mx-auto h-14 w-14 rounded-full bg-white/[.04] border border-white/[.07] flex items-center justify-center">
        <Layers3 className="h-6 w-6 text-zinc-400" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-xl font-bold text-white">No collections yet</h2>
        <p className="text-sm text-zinc-400 max-w-md mx-auto">
          Bundle games — by genre, vibe, party night, anything — and reach them from the sidebar. Sign in and they'll sync to every device.
        </p>
      </div>
      <Button onClick={onCreate} className="rounded-2xl gap-2 h-10">
        <Plus className="h-4 w-4" /> Create your first collection
      </Button>
    </div>
  )
}

function ShareDialog({
  target,
  authed,
  onClose,
  onShare,
  onUnshare,
}: {
  target: UserCollection | null
  authed: boolean
  onClose: () => void
  onShare: (collection: UserCollection, makePublic: boolean) => Promise<{ shareToken: string; isPublic: boolean } | null>
  onUnshare: (collection: UserCollection) => Promise<void>
}) {
  const [working, setWorking] = useState(false)
  const [makePublic, setMakePublic] = useState<boolean>(target?.isPublic ?? false)
  const [token, setToken] = useState<string | null>(target?.shareToken ?? null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (target) {
      setMakePublic(target.isPublic)
      setToken(target.shareToken)
      setCopied(false)
    }
  }, [target])

  if (!target) return null

  const url = token ? shareUrlFor(token) : null

  const handleEnableShare = async () => {
    setWorking(true)
    const result = await onShare(target, makePublic)
    if (result) setToken(result.shareToken)
    setWorking(false)
  }

  const handleTogglePublic = async (next: boolean) => {
    setMakePublic(next)
    if (token) {
      setWorking(true)
      const result = await onShare(target, next)
      if (result) setToken(result.shareToken)
      setWorking(false)
    }
  }

  const handleStopSharing = async () => {
    setWorking(true)
    await onUnshare(target)
    setToken(null)
    setMakePublic(false)
    setWorking(false)
    onClose()
  }

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Share "{target.name}"
          </DialogTitle>
          <DialogDescription>
            {authed
              ? "Anyone with the link can view this collection on union-crax.xyz."
              : "Sign in to share collections from your account."}
          </DialogDescription>
        </DialogHeader>

        {!authed ? (
          <div className="rounded-2xl border border-white/[.07] bg-white/[.02] p-5 space-y-2 text-sm text-zinc-400">
            <p>Sharing requires a signed-in account so the link stays available across devices.</p>
          </div>
        ) : !token ? (
          <div className="space-y-3">
            <ToggleRow
              icon={<Globe className="h-4 w-4" />}
              title="Show on my public profile"
              description="Anyone visiting your union-crax.xyz profile sees this collection."
              checked={makePublic}
              onCheckedChange={setMakePublic}
            />
            <Button onClick={handleEnableShare} disabled={working} className="w-full rounded-2xl h-10">
              {working ? "Generating link…" : "Generate share link"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/[.07] bg-white/[.03] p-3 flex items-center gap-2">
              <input
                readOnly
                value={url || ""}
                className="flex-1 min-w-0 bg-transparent text-xs text-zinc-200 outline-none truncate"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <Button
                variant="outline"
                size="sm"
                className="rounded-full gap-1.5 shrink-0"
                onClick={() => {
                  if (!url) return
                  try {
                    navigator.clipboard.writeText(url)
                    setCopied(true)
                    window.setTimeout(() => setCopied(false), 1500)
                  } catch { /* swallow */ }
                }}
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>

            <ToggleRow
              icon={<Globe className="h-4 w-4" />}
              title="Show on my public profile"
              description="Anyone visiting your union-crax.xyz profile sees this collection."
              checked={makePublic}
              onCheckedChange={handleTogglePublic}
              disabled={working}
            />

            {url && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-100 transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                Open public page
              </a>
            )}
          </div>
        )}

        <DialogFooter>
          {token ? (
            <Button variant="outline" onClick={handleStopSharing} disabled={working} className="gap-2">
              <Lock className="h-4 w-4" />
              Stop sharing
            </Button>
          ) : (
            <Button variant="outline" onClick={onClose}>Close</Button>
          )}
          {token && (
            <Button onClick={onClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ToggleRow({
  icon,
  title,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  icon: React.ReactNode
  title: string
  description: string
  checked: boolean
  onCheckedChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-white/[.07] bg-white/[.02] p-4">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[.04] text-zinc-300">
        {icon}
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-semibold text-zinc-100">{title}</p>
        <p className="text-xs text-zinc-400 leading-snug">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  )
}

function CollectionEditorDialog({
  open,
  title,
  description,
  games,
  initialName,
  initialMembers,
  confirmLabel,
  nameReadOnly,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description?: string
  games: Array<{ appid: string; name: string; image?: string; installed: boolean }>
  initialName: string
  initialMembers: Set<string>
  confirmLabel: string
  nameReadOnly?: boolean
  onConfirm: (name: string, ids: Set<string>) => Promise<boolean>
  onCancel: () => void
}) {
  const [name, setName] = useState(initialName)
  const [selected, setSelected] = useState<Set<string>>(new Set(initialMembers))
  const [filter, setFilter] = useState("")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setName(initialName)
      setSelected(new Set(initialMembers))
      setFilter("")
      setSubmitting(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialName])

  const toggle = (appid: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(appid)) next.delete(appid)
      else next.add(appid)
      return next
    })
  }

  // When no search: show installed games + already-selected uninstalled games.
  // When searching: show all matching games (installed or not).
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return games.filter((g) => {
      const matches = !q || g.name.toLowerCase().includes(q) || g.appid.toLowerCase().includes(q)
      if (!matches) return false
      if (g.installed) return true
      // Uninstalled: always show if already selected, otherwise only when searching
      return selected.has(g.appid) || Boolean(q)
    })
  }, [filter, games, selected])

  const canConfirm = Boolean(name.trim()) && selected.size > 0 && !submitting

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent className="sm:max-w-2xl p-0 max-h-[85vh] flex flex-col">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="px-6 py-4 space-y-3">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Couch co-op night"
              className="h-10"
              readOnly={nameReadOnly}
              disabled={nameReadOnly}
              autoFocus={!nameReadOnly}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">Games</label>
              <span className="text-[11px] text-zinc-500">{selected.size} selected</span>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search games… (type to find uninstalled)"
                className="h-9 rounded-xl bg-white/[.03] border-white/[.07] pl-8"
              />
            </div>
          </div>
        </div>

        <ScrollArea className="flex-1 px-6 min-h-[180px]">
          {games.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-12">No games available.</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-12">No games match "{filter}".</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pb-2">
              {filtered.map((game) => {
                const active = selected.has(game.appid)
                return (
                  <button
                    key={game.appid}
                    type="button"
                    onClick={() => toggle(game.appid)}
                    className={cn(
                      "group/pick relative flex items-center gap-2 rounded-xl border p-2 text-left transition-all active:scale-[0.99]",
                      active
                        ? "border-white bg-white/[.08]"
                        : "border-white/[.07] bg-white/[.02] hover:bg-white/[.04]"
                    )}
                  >
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-zinc-800">
                      {game.image ? (
                        <img
                          src={proxyImageUrl(getCardImage(game.image))}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-zinc-100">{game.name}</p>
                      {!game.installed && (
                        <p className="text-[10px] text-zinc-500">Not installed</p>
                      )}
                    </div>
                    <div
                      className={cn(
                        "shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-full border transition-colors",
                        active
                          ? "border-white bg-white text-black"
                          : "border-zinc-600 bg-black/40 text-transparent group-hover/pick:text-zinc-500"
                      )}
                    >
                      <Check className="h-3 w-3" />
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="px-6 py-4 border-t border-white/[.07] flex sm:justify-between">
          <p className="text-xs text-zinc-500 hidden sm:block self-center">
            {selected.size === 0 ? "Pick at least one game." : `${selected.size} game${selected.size === 1 ? "" : "s"} ready.`}
          </p>
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" onClick={onCancel} disabled={submitting}>Cancel</Button>
            <Button
              onClick={async () => {
                if (!canConfirm) return
                setSubmitting(true)
                try {
                  const ok = await onConfirm(name.trim(), selected)
                  if (!ok) setSubmitting(false)
                } catch {
                  setSubmitting(false)
                }
              }}
              disabled={!canConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
