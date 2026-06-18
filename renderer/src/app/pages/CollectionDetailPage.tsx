import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { GitFork, Share2 } from "@/components/icons"
import { ArrowLeft, BellOff, Cloud, CloudOff, Pencil, RefreshCw } from "lucide-react"
import {
  Bell,
  Copy,
  Download,
  Globe,
  Layers3,
  Loader2,
  Lock,
  MoreHorizontal,
  Sparkles,
  Trash2,
  Users,
} from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { GameCard } from "@/components/GameCard"
import { PageAura } from "@/components/page-aura"
import { GameCardSkeleton } from "@/components/GameCardSkeleton"
import { cn, getCardImage, hasInstalledVersionUpdate, proxyImageUrl } from "@/lib/utils"
import { getCatalogCache, type CatalogGame } from "@/lib/catalog"
import { useUserCollections, type UserCollection } from "@/hooks/use-user-collections"
import { useFollowedCollections } from "@/hooks/use-followed-collections"
import { useGamesData } from "@/hooks/use-games"
import { useDownloadsActions, useDownloadsSelector } from "@/context/downloads-context"
import { useDownloadFlow } from "@/context/download-flow-context"
import { useAuth } from "@/hooks/useAuth"
import {
  forkCloudCollection,
  shareCloudCollection,
  shareUrlFor,
  unshareCloudCollection,
} from "@/lib/cloud-collections"
import {
  CollectionActionContextMenu,
  CollectionActionMenuPanel,
  COLLECTION_MENU_ICONS,
  type CollectionMenuPoint,
  type CollectionMenuSection,
} from "@/components/CollectionActionMenu"

type InstalledLite = { appid: string; name: string; image?: string; version?: string }

// Non-terminal download states: a game in any of these is actively being
// fetched/installed, so the collection view should not offer "Install" again.
const IN_PROGRESS_DL_STATUSES = new Set([
  "queued",
  "downloading",
  "paused",
  "verifying",
  "retrying",
  "extracting",
  "installing",
  "install_ready",
])
// States that mean the archive finished and the game is (about to be) installed.
const COMPLETED_DL_STATUSES = new Set(["completed", "extracted"])

export function CollectionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const userCollections = useUserCollections()
  const followed = useFollowedCollections()
  const { games: catalogGames } = useGamesData()
  const { startGameDownload } = useDownloadsActions()
  const { requestDownload } = useDownloadFlow()
  const [{ user, isAuthenticated }] = useAuth()
  const viewerDiscordId = user?.discordId ?? null

  const [installed, setInstalled] = useState<InstalledLite[]>([])
  const [installedLoading, setInstalledLoading] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<CollectionMenuPoint | null>(null)
  const [shareBusy, setShareBusy] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  const [batchStatus, setBatchStatus] = useState<{ queued: number; skipped: number } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmUnfollow, setConfirmUnfollow] = useState(false)
  const [forkBusy, setForkBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ---- Resolve the collection ----
  // Try owned first (by id), then check followed by share token.
  const ownedCollection: UserCollection | undefined = useMemo(
    () => userCollections.collections.find((c) => c.id === id),
    [userCollections.collections, id]
  )
  const followedCollection = useMemo(
    () => followed.items?.find((c) => c.shareToken === id || c.id === id),
    [followed.items, id]
  )

  const collection = ownedCollection ?? null
  const isFollowed = !ownedCollection && Boolean(followedCollection)
  const isOwner = collection?.role === "owner"
  const ownerName =
    collection?.owner?.displayName ||
    collection?.owner?.username ||
    followedCollection?.owner?.displayName ||
    followedCollection?.owner?.username ||
    (isOwner ? "you" : "Someone")

  // Open the delete confirm when navigated to with `?action=delete`
  // (used by the sidebar right-click "Delete collection" item).
  useEffect(() => {
    if (searchParams.get("action") !== "delete") return
    if (!collection) return
    setConfirmDelete(true)
    const next = new URLSearchParams(searchParams)
    next.delete("action")
    setSearchParams(next, { replace: true })
  }, [searchParams, collection, setSearchParams])

  // ---- Load installed snapshot for "missing/update" badges ----
  const refreshInstalled = useCallback(async () => {
    try {
      const list =
        (await window.ucDownloads?.listInstalledGlobal?.()) ||
        (await window.ucDownloads?.listInstalled?.()) ||
        []
      const games: InstalledLite[] = []
      for (const entry of list as any[]) {
        const item = entry?.metadata || entry
        if (!item?.appid) continue
        games.push({
          appid: item.appid,
          name: item.name || item.appid,
          image: item.image || item.localImage || "",
          version: item.version || "",
        })
      }
      setInstalled(games)
    } finally {
      setInstalledLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshInstalled()
  }, [refreshInstalled])

  // Appids with a live download/install in flight, and ones that have just
  // finished. The first set hides the "Install" prompt overlay while a game is
  // installing (otherwise it sits on top of GameCard's installing badge and
  // keeps re-prompting); the second refreshes the installed list — which only
  // loads on mount — so the overlay disappears for good once install completes.
  const inProgressKey = useDownloadsSelector(
    useCallback((items) => {
      const ids: string[] = []
      for (const it of items) {
        if (it.appid && IN_PROGRESS_DL_STATUSES.has(it.status)) ids.push(it.appid)
      }
      return Array.from(new Set(ids)).sort().join(",")
    }, [])
  )
  const completedKey = useDownloadsSelector(
    useCallback((items) => {
      const ids: string[] = []
      for (const it of items) {
        if (it.appid && COMPLETED_DL_STATUSES.has(it.status)) ids.push(it.appid)
      }
      return Array.from(new Set(ids)).sort().join(",")
    }, [])
  )
  const inProgressAppids = useMemo(
    () => new Set(inProgressKey ? inProgressKey.split(",") : []),
    [inProgressKey]
  )

  useEffect(() => {
    if (completedKey) void refreshInstalled()
  }, [completedKey, refreshInstalled])

  const installedById = useMemo(() => new Map(installed.map((g) => [g.appid, g])), [installed])
  const catalogById = useMemo(() => {
    const source = catalogGames.length > 0 ? catalogGames : getCatalogCache().games
    return new Map(source.map((g) => [g.appid, g]))
  }, [catalogGames])
  const catalogVersionByAppid = useMemo(() => {
    const source = catalogGames.length > 0 ? catalogGames : getCatalogCache().games
    return new Map(source.map((g) => [g.appid, g.version || ""]))
  }, [catalogGames])

  const appids = collection?.appids ?? []
  const missingAppids = useMemo(
    () => appids.filter((a) => !installedById.has(a)),
    [appids, installedById]
  )
  const updateAppids = useMemo(
    () =>
      appids.filter((id) => {
        const inst = installedById.get(id)
        if (!inst) return false
        return hasInstalledVersionUpdate(catalogVersionByAppid.get(id), [inst.version])
      }),
    [appids, installedById, catalogVersionByAppid]
  )

  // Build the cover candidates for the banner mosaic.
  const cover: string[] = useMemo(() => {
    const out: string[] = []
    for (const id of appids) {
      if (out.length >= 6) break
      const inst = installedById.get(id)
      if (inst?.image) { out.push(inst.image); continue }
      const catalog = catalogById.get(id)
      const img = catalog?.image || catalog?.hero_image || catalog?.splash
      if (img) out.push(img)
    }
    return out
  }, [appids, installedById, catalogById])

  const runBatchInstall = async (ids: string[]) => {
    const catalog = getCatalogCache().games as CatalogGame[]
    const byId = new Map(catalog.map((g) => [g.appid, g]))
    let queued = 0
    let skipped = 0
    for (const appid of ids) {
      const game = byId.get(appid)
      if (!game) { skipped += 1; continue }
      try {
        await startGameDownload(game as any)
        queued += 1
      } catch {
        skipped += 1
      }
    }
    setBatchStatus({ queued, skipped })
  }

  const handleInstallMissing = () => void runBatchInstall(missingAppids)
  const handleUpdateOutdated = () => void runBatchInstall(updateAppids)

  const handleToggleShare = async () => {
    if (!collection || shareBusy) return
    setShareBusy(true)
    try {
      if (collection.shareToken) {
        await unshareCloudCollection(collection.id)
      } else {
        await shareCloudCollection(collection.id, { public: false })
      }
      await userCollections.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sharing failed.")
    } finally {
      setShareBusy(false)
    }
  }

  const handleCopyShare = async () => {
    if (!collection?.shareToken) return
    // Routes through the shared toast bridge so the feedback matches every
    // other "copied!" surface in the app. We still flip the local shareCopied
    // flag so the button label can switch to "Copied" for ~1.6s.
    const { copyToClipboard } = await import("@/lib/clipboard")
    const ok = await copyToClipboard(shareUrlFor(collection.shareToken), {
      successMessage: "Share link copied",
    })
    if (ok) {
      setShareCopied(true)
      window.setTimeout(() => setShareCopied(false), 1600)
    }
  }

  const handleDelete = async () => {
    if (!collection) return
    try {
      const { deleteCloudCollection } = await import("@/lib/cloud-collections")
      await deleteCloudCollection(collection.id)
      await userCollections.refresh()
      navigate("/collections", { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete collection.")
    } finally {
      setConfirmDelete(false)
    }
  }

  const handleFork = async () => {
    if (forkBusy) return
    const token = collection?.shareToken || followedCollection?.shareToken
    if (!token) return
    if (!isAuthenticated) {
      setError("Sign in to fork collections.")
      return
    }
    setForkBusy(true)
    try {
      const forked = await forkCloudCollection(token)
      await userCollections.refresh()
      navigate(`/collections/view/${encodeURIComponent(forked.id)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not fork.")
    } finally {
      setForkBusy(false)
    }
  }

  const handleUnfollow = async () => {
    if (!followedCollection) return
    await followed.unfollow(followedCollection)
    setConfirmUnfollow(false)
    navigate("/collections", { replace: true })
  }

  // ---- Menu sections ----
  const menuSections: CollectionMenuSection[] = useMemo(() => {
    if (!collection) return []
    const downloads: CollectionMenuSection["items"] = []
    if (missingAppids.length > 0) {
      downloads.push({
        id: "install-missing",
        icon: COLLECTION_MENU_ICONS.install,
        label: `Install ${missingAppids.length} missing`,
        onSelect: handleInstallMissing,
      })
    }
    if (updateAppids.length > 0) {
      downloads.push({
        id: "update",
        icon: COLLECTION_MENU_ICONS.update,
        label: `Update ${updateAppids.length} game${updateAppids.length === 1 ? "" : "s"}`,
        onSelect: handleUpdateOutdated,
      })
    }
    const sections: CollectionMenuSection[] = []
    if (downloads.length > 0) sections.push({ id: "downloads", label: "Downloads", items: downloads })
    sections.push({
      id: "manage",
      label: "Manage",
      items: [
        {
          id: "edit",
          icon: COLLECTION_MENU_ICONS.edit,
          label: "Edit games",
          onSelect: () => navigate(`/collections?edit=${encodeURIComponent(collection.id)}`),
        },
      ],
    })
    if (isOwner) {
      sections.push({
        id: "sharing",
        label: "Sharing",
        items: [
          {
            id: "share",
            icon: COLLECTION_MENU_ICONS.share,
            label: collection.shareToken ? "Sharing settings" : "Share collection",
            disabled: !collection.cloud,
            onSelect: () => navigate(`/collections?share=${encodeURIComponent(collection.id)}`),
          },
          {
            id: "contributors",
            icon: COLLECTION_MENU_ICONS.contributors,
            label: "Manage contributors",
            onSelect: () => navigate(`/collections?contributors=${encodeURIComponent(collection.id)}`),
          },
        ],
      })
      sections.push({
        id: "danger",
        items: [
          {
            id: "delete",
            icon: COLLECTION_MENU_ICONS.delete,
            label: "Delete collection",
            destructive: true,
            onSelect: () => setConfirmDelete(true),
          },
        ],
      })
    }
    return sections
  }, [collection, missingAppids.length, updateAppids.length, isOwner, navigate])

  // ---- Resolve game cards (installed first, then catalog) ----
  const orderedGames = useMemo(() => {
    const out: Array<{ appid: string; installed: boolean; data: any }> = []
    for (const appid of appids) {
      const inst = installedById.get(appid)
      if (inst) {
        const meta = catalogById.get(appid)
        out.push({
          appid,
          installed: true,
          data: meta || {
            appid,
            name: inst.name,
            image: inst.image,
            description: "",
            genres: [],
            release_date: "",
            size: "",
            source: "local",
            version: inst.version,
          },
        })
      } else {
        const meta = catalogById.get(appid)
        if (meta) out.push({ appid, installed: false, data: meta })
        else
          out.push({
            appid,
            installed: false,
            data: {
              appid,
              name: appid,
              description: "",
              genres: [],
              image: "./fallbacks/game-card-3x4.svg",
              release_date: "",
              size: "",
              source: "catalog",
            },
          })
      }
    }
    return out
  }, [appids, installedById, catalogById])

  // ---- Loading & error states ----
  if (userCollections.loading && !collection && !followedCollection) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-44 w-full rounded-3xl" />
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => <GameCardSkeleton key={i} />)}
        </div>
      </div>
    )
  }

  if (!collection && !followedCollection) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate("/collections")} className="gap-2 text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Collections
        </Button>
        <div className="rounded-3xl border border-white/[.07] bg-background/40 p-10 text-center text-sm text-muted-foreground">
          Collection not found, or you don't have access.
        </div>
      </div>
    )
  }

  // Followed (read-only) view
  if (!collection && followedCollection) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => navigate("/collections")} className="gap-2 text-muted-foreground -ml-2">
          <ArrowLeft className="h-4 w-4" /> Collections
        </Button>
        <CollectionBanner
          name={followedCollection.name}
          isPublic={followedCollection.isPublic}
          cover={(followedCollection.previewCovers || [])
            .map((p) => p.image)
            .filter(Boolean) as string[]}
          isLocal={false}
          isShared={true}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-9 w-9 rounded-full overflow-hidden bg-secondary shrink-0">
              {followedCollection.owner.avatarUrl && (
                <img src={proxyImageUrl(followedCollection.owner.avatarUrl)} alt="" className="h-full w-full object-cover" />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white truncate">{ownerName}</div>
              <div className="text-[11px] text-muted-foreground/80">{followedCollection.gameCount} games · Following</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" className="rounded-full gap-2 h-9" onClick={handleFork} disabled={forkBusy}>
              {forkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitFork className="h-4 w-4" />}
              Fork
            </Button>
            <Button variant="outline" className="rounded-full gap-2 h-9 text-foreground/80" onClick={() => setConfirmUnfollow(true)}>
              <BellOff className="h-4 w-4" />
              Unfollow
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
            {error}
          </div>
        )}

        <div className="rounded-3xl border border-white/[.07] bg-white/[.02] p-6 text-sm text-muted-foreground">
          Followed collections show their full game list on the share page on the web. Fork to copy them
          into your own collections and view them here.
        </div>

        <Dialog open={confirmUnfollow} onOpenChange={(o) => !o && setConfirmUnfollow(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Unfollow this collection?</DialogTitle>
              <DialogDescription>
                You'll stop getting updates when the owner adds games. You can follow again any time.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmUnfollow(false)}>Keep following</Button>
              <Button variant="destructive" onClick={() => void handleUnfollow()}>Unfollow</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  if (!collection) return null
  const contributors = collection.contributors || []

  return (
    <div
      className="relative space-y-6"
      onContextMenu={(e) => {
        // Only intercept context on header chrome, not inside game cards
        const target = e.target as HTMLElement
        if (target.closest("[data-uc-game-card]")) return
        e.preventDefault()
        setContextMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <PageAura />
      <Button
        variant="ghost"
        onClick={() => navigate("/collections")}
        className="gap-2 text-muted-foreground -ml-2"
      >
        <ArrowLeft className="h-4 w-4" /> Collections
      </Button>

      <CollectionBanner
        name={collection.name}
        isPublic={collection.isPublic}
        cover={cover}
        isLocal={!collection.cloud}
        isShared={Boolean(collection.shareToken)}
      />

      {/* Owner / contributors / action row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-9 w-9 rounded-full overflow-hidden bg-secondary shrink-0" style={{ containerType: "inline-size" }}>
            {collection.owner?.avatarUrl ? (
              <img src={proxyImageUrl(collection.owner.avatarUrl)} alt="" className="h-full w-full object-cover" />
            ) : (
              <span aria-hidden className="flex h-full w-full items-center justify-center font-semibold uppercase leading-none text-muted-foreground/80" style={{ fontSize: "45cqw" }}>
                {(ownerName || "?").charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white truncate">
              {isOwner ? "You" : ownerName}
            </div>
            <div className="text-[11px] text-muted-foreground/80">
              {collection.appids.length} game{collection.appids.length === 1 ? "" : "s"}
              {!collection.cloud && " · Local only"}
              {!isOwner && " · Contributor"}
            </div>
          </div>
          {contributors.length > 0 && (
            <div className="flex -space-x-1.5 ml-2 shrink-0">
              {contributors.slice(0, 4).map((c) => {
                const name = c.displayName || c.username || "Contributor"
                return (
                  <div
                    key={c.discordId}
                    className="h-6 w-6 rounded-full overflow-hidden bg-secondary ring-2 ring-zinc-950"
                    style={{ containerType: "inline-size" }}
                    title={name}
                  >
                    {c.avatarUrl ? (
                      <img src={proxyImageUrl(c.avatarUrl)} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span aria-hidden className="flex h-full w-full items-center justify-center font-semibold uppercase leading-none text-muted-foreground/80" style={{ fontSize: "45cqw" }}>
                        {name.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                )
              })}
              {contributors.length > 4 && (
                <div className="h-6 w-6 rounded-full bg-secondary ring-2 ring-zinc-950 flex items-center justify-center text-[10px] font-semibold text-foreground/80">
                  +{contributors.length - 4}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {missingAppids.length > 0 && (
            <Button variant="outline" className="rounded-full gap-2 h-9" onClick={handleInstallMissing}>
              <Download className="h-4 w-4" />
              Install {missingAppids.length} missing
            </Button>
          )}
          {updateAppids.length > 0 && (
            <Button variant="outline" className="rounded-full gap-2 h-9" onClick={handleUpdateOutdated}>
              <RefreshCw className="h-4 w-4" />
              Update {updateAppids.length}
            </Button>
          )}
          {isOwner && collection.shareToken && (
            <Button variant="outline" className="rounded-full gap-2 h-9" onClick={() => void handleCopyShare()}>
              {shareCopied ? <Sparkles className="h-4 w-4 text-amber-300" /> : <Copy className="h-4 w-4" />}
              {shareCopied ? "Copied" : "Copy share link"}
            </Button>
          )}
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full h-9 w-9" title="More actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
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

      {error && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
          {error}
        </div>
      )}

      {/* Games grid */}
      {installedLoading ? (
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: Math.min(10, appids.length || 5) }).map((_, i) => (
            <GameCardSkeleton key={i} />
          ))}
        </div>
      ) : appids.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/[.07] bg-white/[.02] p-10 text-center text-sm text-muted-foreground space-y-3">
          <p>This collection is empty.</p>
          <Button
            variant="outline"
            className="rounded-full"
            onClick={() => navigate(`/collections?edit=${encodeURIComponent(collection.id)}`)}
          >
            Add games
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {orderedGames.map((entry) => (
            <div key={entry.appid} data-uc-game-card className="relative">
              <GameCard game={entry.data as any} />
              {!entry.installed && !inProgressAppids.has(entry.appid) && (
                <NotInstalledOverlay
                  onInstall={() => {
                    // Start in place via the app-wide flow (quick-queue or the
                    // check modal as an overlay, per the user's setting) instead
                    // of navigating to the game page.
                    void requestDownload(entry.data as any)
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Delete confirm */}
      <Dialog open={confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-red-400" />
              Delete "{collection.name}"?
            </DialogTitle>
            <DialogDescription>
              This collection will be removed from your account on every device. Games in it stay installed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void handleDelete()}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch install feedback */}
      <Dialog open={batchStatus != null} onOpenChange={(o) => { if (!o) setBatchStatus(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              {batchStatus && batchStatus.queued > 0
                ? `Queued ${batchStatus.queued} download${batchStatus.queued === 1 ? "" : "s"}`
                : "Nothing queued"}
            </DialogTitle>
            <DialogDescription>
              {batchStatus?.skipped
                ? `${batchStatus.skipped} game${batchStatus.skipped === 1 ? "" : "s"} couldn't be queued — they may have been removed from the catalogue.`
                : "Track progress in the Activity tab."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setBatchStatus(null)}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

function NotInstalledOverlay({ onInstall }: { onInstall: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="pointer-events-none absolute inset-0 z-30 rounded-2xl overflow-hidden">
      {/* Dim the cover so it reads as "not installed" at a glance. The dark
          layer sits above GameCard's own gradient. */}
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
            // Swallow the click so the parent Link in GameCard doesn't
            // navigate to the game detail page when the user just wanted to
            // queue an install from the collection view.
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

function CollectionBanner({
  name,
  cover,
  isPublic,
  isLocal,
  isShared,
}: {
  name: string
  cover: string[]
  isPublic: boolean
  isLocal: boolean
  isShared: boolean
}) {
  const tiles = cover.slice(0, 6)
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/[.07] bg-card aspect-[5/1] sm:aspect-[6/1] min-h-[160px]">
      {tiles.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40">
          <Layers3 className="h-12 w-12" />
        </div>
      ) : (
        <div className="absolute inset-0 grid grid-cols-3 sm:grid-cols-6 grid-rows-1 gap-px bg-background">
          {tiles.map((src, idx) => (
            <div key={`${src}-${idx}`} className="relative overflow-hidden">
              <img
                src={proxyImageUrl(getCardImage(src))}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
                onError={(e) => ((e.currentTarget as HTMLImageElement).style.opacity = "0")}
              />
            </div>
          ))}
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/10" />
      <div className="absolute inset-x-0 bottom-0 px-5 pb-4 sm:px-6 sm:pb-5">
        <div className="flex flex-wrap items-end gap-2">
          {isShared && (
            <Badge variant="secondary" className={cn("rounded-full text-[10px]", isPublic && "bg-emerald-500/25 text-emerald-300 border-emerald-400/60") }>
              {isPublic ? <Globe className="h-3 w-3 mr-1" /> : <Lock className="h-3 w-3 mr-1" />}
              {isPublic ? "Public" : "Shared"}
            </Badge>
          )}
          {isLocal && (
            <Badge variant="outline" className="rounded-full text-[10px] border-amber-500/30 text-amber-300">
              <CloudOff className="h-3 w-3 mr-1" />
              Local only
            </Badge>
          )}
          {!isLocal && !isShared && (
            <Badge variant="outline" className="rounded-full text-[10px] text-muted-foreground">
              <Cloud className="h-3 w-3 mr-1" />
              Cloud
            </Badge>
          )}
        </div>
        <h1 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-white truncate">{name}</h1>
      </div>
    </div>
  )
}
