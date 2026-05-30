import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { GitFork, X, Share2, UserPlus } from "@/components/icons"
import { Pencil, ArrowDown, ArrowRight, ArrowUp, Cloud, CloudOff, BellOff, RefreshCw } from "lucide-react"
import {
  Layers3,
  Plus,
  Search,
  Trash2,
  Check,
  AlertTriangle,
  Globe,
  Lock,
  Copy,
  ExternalLink,
  Download,
  Bell,
  Sparkles,
  Loader2,
  Users,
} from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { getInstalledVersionLabel, hasInstalledVersionUpdate, proxyImageUrl, getCardImage, cn } from "@/lib/utils"
import { useUserCollections, type UserCollection } from "@/hooks/use-user-collections"
import { useGamesData } from "@/hooks/use-games"
import {
  forkCloudCollection,
  shareUrlFor,
  listCloudContributors,
  inviteCloudContributor,
  updateCloudContributorPermissions,
  removeCloudContributor,
  searchCloudUsers,
  type CloudContributor,
  type CloudUserSearchResult,
} from "@/lib/cloud-collections"
import { useFollowedCollections, type FollowedCollection } from "@/hooks/use-followed-collections"
import { useDownloadsActions } from "@/context/downloads-context"
import { getCatalogCache, type CatalogGame } from "@/lib/catalog"
import { apiFetch } from "@/lib/api"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  CollectionActionContextMenu,
  CollectionActionMenuPanel,
  COLLECTION_MENU_ICONS,
  type CollectionMenuPoint,
  type CollectionMenuSection,
} from "@/components/CollectionActionMenu"
import { MoreHorizontal } from "@/components/icons"

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
  const [contributorsTarget, setContributorsTarget] = useState<UserCollection | null>(null)
  const [syncPromptTarget, setSyncPromptTarget] = useState<UserCollection | null>(null)
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

  // Scroll the matching followed card into view when arriving via
  // `/collections#followed-<id>` (used by the sidebar's Following links).
  useEffect(() => {
    if (typeof window === "undefined") return
    const hash = window.location.hash || ""
    const m = hash.match(/followed-([^/?]+)$/)
    if (!m) return
    if (!followed.items || followed.items.length === 0) return
    const id = m[1]
    const tries = [80, 250, 600]
    const timers = tries.map((delay) =>
      window.setTimeout(() => {
        const el = document.getElementById(`followed-${id}`)
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
      }, delay)
    )
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [followed.items])

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

  // ---- Deep-link from the detail page: ?edit=<id> / ?share=<id> / ?contributors=<id>
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    if (collections.length === 0) return
    const editId = searchParams.get("edit")
    const shareId = searchParams.get("share")
    const contributorsId = searchParams.get("contributors")
    let consumed = false
    if (editId) {
      const target = collections.find((c) => c.id === editId)
      if (target) { setEditTarget(target); consumed = true }
    }
    if (shareId) {
      const target = collections.find((c) => c.id === shareId)
      if (target) { setShareTarget(target); consumed = true }
    }
    if (contributorsId) {
      const target = collections.find((c) => c.id === contributorsId)
      if (target) {
        if (target.cloud) setContributorsTarget(target)
        else setSyncPromptTarget(target)
        consumed = true
      }
    }
    if (consumed) {
      const next = new URLSearchParams(searchParams)
      next.delete("edit")
      next.delete("share")
      next.delete("contributors")
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, collections, setSearchParams])

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-white">Collections</h1>
          <p className="text-sm text-muted-foreground">
            Group your games into collections you can filter, share, and resync across devices.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SyncStatus authed={authed} loading={loading} />
          <Button
            variant="outline"
            className="rounded-2xl gap-2 h-10"
            onClick={() => navigate("/collections/browse")}
          >
            <Globe className="h-4 w-4" />
            Discover
          </Button>
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
          <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
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
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
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
              <p className="text-xs text-muted-foreground/80">
                Collections by other people. When the owner adds games, you'll see an Update badge.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void followed.refresh()}
              className="inline-flex items-center gap-1 rounded-full border border-white/[.07] bg-white/[.03] px-2.5 py-1 text-[11px] text-foreground/80 hover:bg-white/[.07] hover:text-white transition-colors"
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
                    navigate(`/collections/view/${encodeURIComponent(forked.id)}`)
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
            className="inline-flex items-center gap-1 rounded-full border border-white/[.07] bg-white/[.03] px-2.5 py-1 text-[11px] text-foreground/80 hover:bg-white/[.07] hover:text-white transition-colors"
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
        <div className="rounded-3xl border border-dashed border-white/[.07] bg-white/[.02] p-10 text-center text-sm text-muted-foreground">
          No collections match "{search}".{" "}
          <button
            type="button"
            onClick={() => setSearch("")}
            className="text-foreground/90 underline-offset-2 hover:underline"
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
              onOpen={() => navigate(`/collections/view/${encodeURIComponent(collection.id)}`)}
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
              onContributors={() => {
                if (!collection.cloud) {
                  setSyncPromptTarget(collection)
                  return
                }
                setContributorsTarget(collection)
              }}
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
        initialOrder={[]}
        confirmLabel="Create"
        permissions={{ canAdd: true, canRemove: true, canRename: true }}
        onConfirm={async (name, ids) => {
          const created = await create(name, ids)
          setCreateOpen(false)
          return Boolean(created)
        }}
        onCancel={() => setCreateOpen(false)}
      />

      {/* Edit members dialog */}
      <CollectionEditorDialog
        open={editTarget != null}
        title={editTarget ? `Edit "${editTarget.name}"` : ""}
        description="Add, remove, or reorder games. Changes sync to your other devices."
        games={allGamesForPicker}
        initialName={editTarget?.name || ""}
        initialOrder={editTarget?.appids || []}
        confirmLabel="Save"
        nameReadOnly
        permissions={editTarget?.permissions ?? { canAdd: true, canRemove: true, canRename: true }}
        onConfirm={async (_name, ids) => {
          if (editTarget) {
            await setMembership(editTarget, ids)
          }
          setEditTarget(null)
          return true
        }}
        onCancel={() => setEditTarget(null)}
      />

      {/* Contributors dialog */}
      <ContributorsDialog
        target={contributorsTarget}
        onClose={() => setContributorsTarget(null)}
        onChanged={() => { void refresh() }}
      />

      {/* Sync prompt for local-only collections */}
      <Dialog
        open={syncPromptTarget != null}
        onOpenChange={(open) => { if (!open) setSyncPromptTarget(null) }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Cloud className="h-5 w-5" />
              Sync this collection first
            </DialogTitle>
            <DialogDescription>
              Inviting contributors needs the collection to live on your account in the cloud, so the
              changes can sync to them. Sign in (or wait for the migration) before sharing.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setSyncPromptTarget(null)}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
      <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-white/[.07] bg-white/[.02] px-3 py-1 text-[11px] text-muted-foreground/80">
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
    <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-white/[.07] bg-white/[.02] px-3 py-1 text-[11px] text-muted-foreground">
      <CloudOff className="h-3 w-3" />
      Local only — sign in to sync
    </span>
  )
}

function buildCollectionMenuSections(args: {
  collection: UserCollection
  missingCount: number
  updateCount: number
  onEditMembers: () => void
  onStartRename: () => void
  onShare: () => void
  onContributors: () => void
  onInstallMissing: () => void
  onUpdateOutdated: () => void
  onDelete: () => void
}): CollectionMenuSection[] {
  const {
    collection,
    missingCount,
    updateCount,
    onEditMembers,
    onStartRename,
    onShare,
    onContributors,
    onInstallMissing,
    onUpdateOutdated,
    onDelete,
  } = args
  const isOwner = collection.role === "owner"
  const canRename = isOwner || collection.permissions.canRename

  const downloads: CollectionMenuSection["items"] = []
  if (missingCount > 0) {
    downloads.push({
      id: "install-missing",
      icon: COLLECTION_MENU_ICONS.install,
      label: `Install ${missingCount} missing`,
      onSelect: onInstallMissing,
    })
  }
  if (updateCount > 0) {
    downloads.push({
      id: "update-outdated",
      icon: COLLECTION_MENU_ICONS.update,
      label: `Update ${updateCount} game${updateCount === 1 ? "" : "s"}`,
      onSelect: onUpdateOutdated,
    })
  }

  const manage: CollectionMenuSection["items"] = [
    { id: "edit", icon: COLLECTION_MENU_ICONS.edit, label: "Edit games", onSelect: onEditMembers },
  ]
  if (canRename) {
    manage.push({ id: "rename", icon: COLLECTION_MENU_ICONS.rename, label: "Rename", onSelect: onStartRename })
  }

  const sharing: CollectionMenuSection["items"] = []
  if (isOwner) {
    sharing.push({
      id: "share",
      icon: COLLECTION_MENU_ICONS.share,
      label: collection.shareToken ? "Sharing settings" : "Share collection",
      disabled: !collection.cloud,
      onSelect: onShare,
    })
    sharing.push({
      id: "contributors",
      icon: COLLECTION_MENU_ICONS.contributors,
      label: "Manage contributors",
      onSelect: onContributors,
    })
  }

  const danger: CollectionMenuSection["items"] = []
  if (isOwner) {
    danger.push({
      id: "delete",
      icon: COLLECTION_MENU_ICONS.delete,
      label: "Delete collection",
      destructive: true,
      onSelect: onDelete,
    })
  }

  return [
    ...(downloads.length > 0 ? [{ id: "downloads", label: "Downloads", items: downloads }] : []),
    { id: "manage", label: "Manage", items: manage },
    ...(sharing.length > 0 ? [{ id: "sharing", label: "Sharing", items: sharing }] : []),
    ...(danger.length > 0 ? [{ id: "danger", items: danger }] : []),
  ]
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
  onContributors,
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
  onContributors: () => void
  onInstallMissing: () => void
  onUpdateOutdated: () => void
}) {
  const isOwner = collection.role === "owner"
  const ownerName =
    collection.owner?.displayName || collection.owner?.username || "Someone"
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
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<CollectionMenuPoint | null>(null)
  const menuSections = buildCollectionMenuSections({
    collection,
    missingCount,
    updateCount,
    onEditMembers,
    onStartRename,
    onShare,
    onContributors,
    onInstallMissing,
    onUpdateOutdated,
    onDelete,
  })

  return (
    <div
      className="group/card flex flex-col rounded-3xl border border-white/[.07] bg-card/40 backdrop-blur-md overflow-hidden transition-colors hover:border-white/[.14]"
      onContextMenu={(e) => {
        e.preventDefault()
        setContextMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="relative aspect-[16/10] w-full overflow-hidden bg-card cursor-pointer text-left"
        aria-label={`Open ${collection.name}`}
      >
        <CoverMosaic cover={cover} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-2">
          {collection.shareToken && (
            <span className="inline-flex items-center gap-1 rounded-full border border-white/[.10] bg-black/60 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold text-foreground">
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
          <span className="inline-flex items-center gap-1 rounded-full border border-white/[.10] bg-black/50 backdrop-blur-sm px-2.5 py-0.5 text-[11px] font-semibold text-foreground/90">
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
          <span className="inline-flex items-center gap-1 rounded-full border border-white/[.10] bg-black/50 backdrop-blur-sm px-2.5 py-0.5 text-[11px] font-semibold text-foreground/90 opacity-0 group-hover/card:opacity-100 transition-opacity">
            Open <ArrowRight className="h-3 w-3" />
          </span>
        </div>
      </button>

      <div className="flex flex-col gap-2 px-4 py-3 border-t border-white/[.05]">
        <div className="flex items-center gap-2">
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
            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="More actions"
                  title="More actions"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-white/[.06] hover:text-foreground transition-colors"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto p-0 bg-transparent border-0 shadow-none">
                <CollectionActionMenuPanel
                  title={collection.name}
                  subtitle={isOwner ? "Your collection" : `by ${ownerName}`}
                  sections={menuSections}
                  onAfterSelect={() => setMenuOpen(false)}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
          {isOwner ? <span>by you</span> : <span>by {ownerName}</span>}
          {!isOwner && (
            <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-1.5 text-[10px] text-violet-200 inline-flex items-center gap-1">
              <Users className="h-2.5 w-2.5" /> Contributor
            </span>
          )}
          {collection.contributors && collection.contributors.length > 0 && (
            <ContributorAvatarStack contributors={collection.contributors} />
          )}
        </div>
      </div>
      <CollectionActionContextMenu
        open={contextMenu != null}
        position={contextMenu}
        onClose={() => setContextMenu(null)}
        title={collection.name}
        subtitle={isOwner ? "Your collection" : `by ${ownerName}`}
        sections={menuSections}
      />
    </div>
  )
}

function ContributorAvatarStack({
  contributors,
}: {
  contributors: Array<{ discordId: string; username: string | null; displayName: string | null; avatarUrl: string | null }>
}) {
  const visible = contributors.slice(0, 3)
  const extra = Math.max(0, contributors.length - visible.length)
  return (
    <span className="inline-flex items-center -space-x-1.5">
      {visible.map((c) => {
        const name = c.displayName || c.username || "User"
        return (
          <span
            key={c.discordId}
            title={name}
            className="inline-flex h-4 w-4 overflow-hidden rounded-full ring-1 ring-zinc-950 bg-secondary"
          >
            {c.avatarUrl ? (
              <img src={c.avatarUrl} alt={name} className="h-full w-full object-cover" />
            ) : (
              <span className="h-full w-full bg-violet-500/40" />
            )}
          </span>
        )
      })}
      {extra > 0 && (
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-secondary px-1 ring-1 ring-zinc-950 text-[9px] font-semibold text-foreground/80">
          +{extra}
        </span>
      )}
    </span>
  )
}

function CoverMosaic({ cover }: { cover: string[] }) {
  if (cover.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40">
        <Layers3 className="h-12 w-12" />
      </div>
    )
  }

  const tiles = cover.slice(0, 4)
  return (
    <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-px bg-background">
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
        <div key={`empty-${idx}`} className="bg-card" />
      ))}
    </div>
  )
}

function CollectionCardSkeleton() {
  return (
    <div className="rounded-3xl border border-white/[.07] bg-card/40 overflow-hidden">
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
    <div id={`followed-${collection.id}`} className="group/card flex flex-col rounded-3xl border border-white/[.07] bg-card/40 backdrop-blur-md overflow-hidden transition-colors hover:border-white/[.14] relative scroll-mt-24">
      {collection.hasUpdates && (
        <span className="absolute top-3 left-3 z-20 inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold text-amber-300">
          <Sparkles className="h-2.5 w-2.5" />
          Updated
        </span>
      )}
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-card">
        {collection.previewCovers.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40">
            <Layers3 className="h-12 w-12" />
          </div>
        ) : (
          <div className="absolute inset-0 grid grid-cols-3 grid-rows-2 gap-px bg-background">
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
                  <div className="h-full w-full bg-card" />
                )}
              </div>
            ))}
            {Array.from({ length: Math.max(0, 6 - collection.previewCovers.length) }).map((_, idx) => (
              <div key={`empty-${idx}`} className="bg-card" />
            ))}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-white/[.10] bg-black/50 backdrop-blur-sm px-2.5 py-0.5 text-[11px] font-semibold text-foreground/90">
            <Layers3 className="h-3 w-3" />
            {collection.gameCount} {collection.gameCount === 1 ? "game" : "games"}
          </span>
        </div>
      </div>
      <div className="px-4 py-3 border-t border-white/[.05] space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold text-sm text-white">{collection.name}</p>
            <p className="truncate text-[11px] text-muted-foreground/80">by {ownerName}</p>
          </div>
          <button
            type="button"
            onClick={onUnfollow}
            title="Stop following"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/[.07] bg-white/[.03] text-muted-foreground hover:bg-white/[.07] hover:text-white transition-colors shrink-0"
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
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground gap-2">
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
              <span className="text-muted-foreground">Games to install</span>
              <span className="font-mono text-foreground">{missing.length}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total size</span>
              <span className="font-mono text-foreground">
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
          ? "text-muted-foreground hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30"
          : "text-muted-foreground hover:bg-white/[.07] hover:text-white"
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
        <Layers3 className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-xl font-bold text-white">No collections yet</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
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
          <div className="rounded-2xl border border-white/[.07] bg-white/[.02] p-5 space-y-2 text-sm text-muted-foreground">
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
                className="flex-1 min-w-0 bg-transparent text-xs text-foreground/90 outline-none truncate"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <Button
                variant="outline"
                size="sm"
                className="rounded-full gap-1.5 shrink-0"
                onClick={async () => {
                  if (!url) return
                  const { copyToClipboard } = await import("@/lib/clipboard")
                  const ok = await copyToClipboard(url, { successMessage: "Share link copied" })
                  if (ok) {
                    setCopied(true)
                    window.setTimeout(() => setCopied(false), 1500)
                  }
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
                className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
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
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[.04] text-foreground/80">
        {icon}
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground leading-snug">{description}</p>
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
  initialOrder,
  confirmLabel,
  nameReadOnly,
  permissions,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description?: string
  games: Array<{ appid: string; name: string; image?: string; installed: boolean }>
  initialName: string
  initialOrder: string[]
  confirmLabel: string
  nameReadOnly?: boolean
  permissions: { canAdd: boolean; canRemove: boolean; canRename: boolean }
  onConfirm: (name: string, ids: string[]) => Promise<boolean>
  onCancel: () => void
}) {
  const [name, setName] = useState(initialName)
  const [order, setOrder] = useState<string[]>(initialOrder)
  const [initialAppids] = useState<Set<string>>(new Set(initialOrder))
  const [filter, setFilter] = useState("")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setName(initialName)
      setOrder(initialOrder)
      setFilter("")
      setSubmitting(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialName])

  const selectedSet = useMemo(() => new Set(order), [order])
  const gamesByAppid = useMemo(() => new Map(games.map((g) => [g.appid, g])), [games])

  function toggle(appid: string) {
    if (selectedSet.has(appid)) {
      if (initialAppids.has(appid) && !permissions.canRemove) return
      setOrder((prev) => prev.filter((id) => id !== appid))
      return
    }
    if (!permissions.canAdd) return
    setOrder((prev) => [...prev, appid])
  }

  function moveSelected(appid: string, direction: -1 | 1) {
    setOrder((prev) => {
      const idx = prev.indexOf(appid)
      const nextIdx = idx + direction
      if (idx < 0 || nextIdx < 0 || nextIdx >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(idx, 1)
      next.splice(nextIdx, 0, moved)
      return next
    })
  }

  // Left panel: catalog/library filtered list, mirroring web's catalog search
  // semantics. Always show installed; show uninstalled when filtering OR when
  // they're already selected.
  const leftPanelGames = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return games.filter((g) => {
      const matches = !q || g.name.toLowerCase().includes(q) || g.appid.toLowerCase().includes(q)
      if (!matches) return false
      if (g.installed) return true
      return selectedSet.has(g.appid) || Boolean(q)
    })
  }, [filter, games, selectedSet])

  const canConfirm = Boolean(name.trim()) && order.length > 0 && !submitting

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent className="p-0 flex flex-col max-h-[90vh] w-[95vw] sm:max-w-3xl">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle className="truncate">{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="px-6 pt-2 pb-3 space-y-1.5 shrink-0">
          <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Name
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Couch co-op night"
            className="h-10"
            readOnly={nameReadOnly || !permissions.canRename}
            disabled={nameReadOnly || !permissions.canRename}
            autoFocus={!nameReadOnly && permissions.canRename}
            maxLength={80}
          />
        </div>

        <div className="flex flex-1 min-h-0 flex-col gap-4 px-6 pb-4 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-2 min-h-0">
            <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground shrink-0">
              Library &amp; catalog
            </label>
            <div className="relative shrink-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search by title or app id…"
                className="h-9 rounded-xl bg-white/[.03] border-white/[.07] pl-8"
                disabled={!permissions.canAdd}
              />
            </div>
            <ScrollArea className="flex-1 min-h-[160px] md:min-h-0 rounded-xl border border-white/[.07] bg-black/20">
              <div className="space-y-1 p-2">
                {leftPanelGames.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground/80">
                    {filter ? `No games match "${filter}".` : "No games available."}
                  </p>
                ) : (
                  leftPanelGames.map((game) => {
                    const active = selectedSet.has(game.appid)
                    const disabledToggle = !active && !permissions.canAdd
                    return (
                      <button
                        key={game.appid}
                        type="button"
                        onClick={() => toggle(game.appid)}
                        disabled={disabledToggle}
                        className={cn(
                          "group/pick w-full flex items-center gap-2 rounded-xl border p-2 text-left transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed",
                          active
                            ? "border-white bg-white/[.08]"
                            : "border-white/[.07] bg-white/[.02] hover:bg-white/[.04]"
                        )}
                      >
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-secondary">
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
                          <p className="truncate text-xs font-semibold text-foreground">{game.name}</p>
                          {!game.installed && (
                            <p className="text-[10px] text-muted-foreground/80">Not installed</p>
                          )}
                        </div>
                        <div
                          className={cn(
                            "shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-full border transition-colors",
                            active
                              ? "border-white bg-primary text-primary-foreground"
                              : "border-zinc-600 bg-black/40 text-transparent group-hover/pick:text-muted-foreground/80"
                          )}
                        >
                          <Check className="h-3 w-3" />
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="flex flex-col gap-2 min-h-0">
            <div className="flex items-center justify-between shrink-0">
              <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                In collection
              </label>
              <span className="text-[11px] text-muted-foreground/80">
                {order.length} {order.length === 1 ? "game" : "games"}
              </span>
            </div>
            <ScrollArea className="flex-1 min-h-[160px] md:min-h-0 rounded-xl border border-white/[.07] bg-black/20">
              <div className="space-y-1 p-2">
                {order.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/[.07] p-6 text-center text-sm text-muted-foreground/80">
                    Pick games on the left to add them to the collection.
                  </div>
                ) : (
                  order.map((appid, index) => {
                    const game = gamesByAppid.get(appid)
                    const wasInitial = initialAppids.has(appid)
                    const removable = !wasInitial || permissions.canRemove
                    return (
                      <div
                        key={appid}
                        className="flex items-center gap-2 rounded-xl border border-white/[.07] bg-white/[.02] p-2"
                      >
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-secondary">
                          {game?.image ? (
                            <img
                              src={proxyImageUrl(getCardImage(game.image))}
                              alt=""
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <Layers3 className="h-4 w-4 text-muted-foreground/60" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-foreground">
                            {game?.name || appid}
                          </p>
                          <p className="text-[10px] text-muted-foreground/80">#{index + 1}</p>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => moveSelected(appid, -1)}
                            disabled={index === 0}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition hover:text-white disabled:opacity-30"
                            aria-label="Move up"
                          >
                            <ArrowUp className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveSelected(appid, 1)}
                            disabled={index === order.length - 1}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition hover:text-white disabled:opacity-30"
                            aria-label="Move down"
                          >
                            <ArrowDown className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => toggle(appid)}
                            disabled={!removable}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
                            aria-label="Remove"
                            title={removable ? "Remove" : "You do not have permission to remove this game."}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-white/[.07] shrink-0 sm:justify-between">
          <p className="text-xs text-muted-foreground/80 hidden sm:block self-center">
            {order.length === 0
              ? "Pick at least one game."
              : `${order.length} game${order.length === 1 ? "" : "s"} ready.`}
          </p>
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" onClick={onCancel} disabled={submitting}>Cancel</Button>
            <Button
              onClick={async () => {
                if (!canConfirm) return
                setSubmitting(true)
                try {
                  const ok = await onConfirm(name.trim(), order)
                  if (!ok) setSubmitting(false)
                } catch {
                  setSubmitting(false)
                }
              }}
              disabled={!canConfirm}
            >
              {submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {confirmLabel}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---- Contributors dialog ----

function ContributorsDialog({
  target,
  onClose,
  onChanged,
}: {
  target: UserCollection | null
  onClose: () => void
  onChanged: (collectionId: string, contributors: CloudContributor[]) => void
}) {
  const [contributors, setContributors] = useState<CloudContributor[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [searchResults, setSearchResults] = useState<CloudUserSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [inviting, setInviting] = useState<string | null>(null)
  const [draftPerms, setDraftPerms] = useState<{ canAdd: boolean; canRemove: boolean; canRename: boolean }>({
    canAdd: true,
    canRemove: false,
    canRename: false,
  })

  useEffect(() => {
    if (!target) {
      setContributors([])
      setError(null)
      setSearch("")
      setSearchResults([])
      setDraftPerms({ canAdd: true, canRemove: false, canRename: false })
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const list = await listCloudContributors(target.id)
        if (!cancelled) setContributors(list)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load contributors.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [target?.id])

  useEffect(() => {
    if (!target) return
    const trimmed = search.trim()
    if (trimmed.length < 2) {
      setSearchResults([])
      setSearching(false)
      return
    }
    const controller = new AbortController()
    const id = window.setTimeout(async () => {
      try {
        setSearching(true)
        const users = await searchCloudUsers(trimmed)
        if (!controller.signal.aborted) setSearchResults(users)
      } catch {
        if (!controller.signal.aborted) setSearchResults([])
      } finally {
        if (!controller.signal.aborted) setSearching(false)
      }
    }, 250)
    return () => {
      controller.abort()
      window.clearTimeout(id)
    }
  }, [search, target?.id])

  if (!target) return null

  async function invite(username: string) {
    setInviting(username)
    setError(null)
    try {
      const next = await inviteCloudContributor(target!.id, { username, ...draftPerms })
      setContributors(next)
      onChanged(target!.id, next)
      setSearch("")
      setSearchResults([])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not invite contributor.")
    } finally {
      setInviting(null)
    }
  }

  async function updatePermission(discordId: string, perms: Partial<{ canAdd: boolean; canRemove: boolean; canRename: boolean }>) {
    const prev = contributors
    setError(null)
    setContributors((curr) => curr.map((c) => (c.discordId === discordId ? { ...c, ...perms } : c)))
    try {
      const next = await updateCloudContributorPermissions(target!.id, discordId, perms)
      setContributors(next)
      onChanged(target!.id, next)
    } catch (err) {
      setContributors(prev)
      setError(err instanceof Error ? err.message : "Could not update permission.")
    }
  }

  async function remove(discordId: string) {
    const prev = contributors
    setError(null)
    setContributors((curr) => curr.filter((c) => c.discordId !== discordId))
    try {
      await removeCloudContributor(target!.id, discordId)
      onChanged(target!.id, contributors.filter((c) => c.discordId !== discordId))
    } catch (err) {
      setContributors(prev)
      setError(err instanceof Error ? err.message : "Could not remove contributor.")
    }
  }

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="p-0 flex flex-col max-h-[90vh] w-[95vw] sm:max-w-2xl">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Contributors on "{target.name}"
          </DialogTitle>
          <DialogDescription>
            Contributors can add games to this collection. Optionally let them remove games or rename it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 flex-col gap-4 px-6 pb-4">
          <div className="space-y-2 shrink-0">
            <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Invite a user
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by username…"
                className="h-9 rounded-xl bg-white/[.03] border-white/[.07] pl-8"
              />
            </div>
            <div className="rounded-2xl border border-white/[.07] bg-white/[.02] p-3 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Permissions for the invite
              </p>
              <PermissionRow
                label="Add games"
                description="Search the catalog and add games to this collection."
                checked={draftPerms.canAdd}
                onCheckedChange={(v) => setDraftPerms((p) => ({ ...p, canAdd: v }))}
              />
              <PermissionRow
                label="Remove games"
                description="Take any game out of the collection."
                checked={draftPerms.canRemove}
                onCheckedChange={(v) => setDraftPerms((p) => ({ ...p, canRemove: v }))}
              />
              <PermissionRow
                label="Rename collection"
                description="Change the collection name."
                checked={draftPerms.canRename}
                onCheckedChange={(v) => setDraftPerms((p) => ({ ...p, canRename: v }))}
              />
            </div>
            {search.trim().length >= 2 && (
              <div className="rounded-xl border border-white/[.07] bg-black/20 max-h-44 overflow-y-auto">
                {searching ? (
                  <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching…
                  </div>
                ) : searchResults.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground/80">No matches.</p>
                ) : (
                  <div className="p-1.5 space-y-1">
                    {searchResults.map((u) => {
                      const already = contributors.some((c) => c.discordId === u.discordId)
                      const isOwner = target!.owner?.discordId === u.discordId
                      const disabled = already || isOwner || inviting === u.username
                      return (
                        <button
                          key={u.discordId}
                          type="button"
                          onClick={() => u.username && invite(u.username)}
                          disabled={disabled}
                          className="w-full flex items-center gap-2 rounded-lg p-2 text-left transition hover:bg-white/[.04] disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <span className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-secondary">
                            {u.avatarUrl ? (
                              <img src={u.avatarUrl} alt="" className="h-full w-full object-cover" />
                            ) : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold text-foreground">
                              {u.displayName || u.username || "Unknown"}
                            </span>
                            <span className="block truncate text-[10px] text-muted-foreground/80">
                              {u.username ? `@${u.username}` : ""}
                              {isOwner ? " · owner" : already ? " · already invited" : ""}
                            </span>
                          </span>
                          {inviting === u.username ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          ) : (
                            <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-1 min-h-0 flex-col gap-2">
            <div className="flex items-center justify-between shrink-0">
              <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Current contributors
              </label>
              <span className="text-[11px] text-muted-foreground/80">{contributors.length}</span>
            </div>
            <ScrollArea className="flex-1 min-h-[120px] rounded-xl border border-white/[.07] bg-black/20">
              <div className="p-2 space-y-1">
                {loading ? (
                  <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading…
                  </div>
                ) : contributors.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground/80">
                    No contributors yet. Search above to invite someone.
                  </p>
                ) : (
                  contributors.map((c) => (
                    <div
                      key={c.discordId}
                      className="rounded-xl border border-white/[.07] bg-white/[.02] p-3 space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-secondary">
                          {c.avatarUrl ? (
                            <img src={c.avatarUrl} alt="" className="h-full w-full object-cover" />
                          ) : null}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-foreground">
                            {c.displayName || c.username || "Unknown"}
                          </p>
                          <p className="truncate text-[10px] text-muted-foreground/80">
                            {c.username ? `@${c.username}` : ""}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => remove(c.discordId)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-red-500/10 hover:text-red-400 transition"
                          title="Remove contributor"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        <PermissionChip
                          label="Add"
                          checked={c.canAdd}
                          onChange={(v) => updatePermission(c.discordId, { canAdd: v })}
                        />
                        <PermissionChip
                          label="Remove"
                          checked={c.canRemove}
                          onChange={(v) => updatePermission(c.discordId, { canRemove: v })}
                        />
                        <PermissionChip
                          label="Rename"
                          checked={c.canRename}
                          onChange={(v) => updatePermission(c.discordId, { canRename: v })}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200 shrink-0">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-white/[.07] shrink-0">
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PermissionRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string
  description: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-foreground">{label}</p>
        <p className="text-[10px] text-muted-foreground/80 leading-snug">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

function PermissionChip({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "rounded-full px-2 py-1 text-[10px] font-semibold transition",
        checked
          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
          : "bg-white/[.03] text-muted-foreground border border-white/[.07] hover:text-white"
      )}
    >
      {checked ? "✓ " : "○ "}
      {label}
    </button>
  )
}
