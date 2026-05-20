import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import {
  ArrowLeft,
  ArrowRight,
  Check,
  GitFork,
  Globe,
  Layers3,
  Loader2,
  MoreHorizontal,
  Search,
  Users,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  CollectionActionContextMenu,
  CollectionActionMenuPanel,
  COLLECTION_MENU_ICONS,
  type CollectionMenuPoint,
  type CollectionMenuSection,
} from "@/components/CollectionActionMenu"
import { proxyImageUrl, getCardImage } from "@/lib/utils"
import {
  followPublicCollection,
  listPublicCollections,
  type PublicCollection,
} from "@/lib/public-collections"
import { useFollowedCollections } from "@/hooks/use-followed-collections"
import { useUserCollections } from "@/hooks/use-user-collections"
import { useAuth } from "@/hooks/useAuth"
import { forkCloudCollection, shareUrlFor } from "@/lib/cloud-collections"

export function BrowseCollectionsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialQ = searchParams.get("q") ?? ""

  const [inputValue, setInputValue] = useState(initialQ)
  const [appliedQ, setAppliedQ] = useState(initialQ)
  const [items, setItems] = useState<PublicCollection[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [followingId, setFollowingId] = useState<string | null>(null)
  const [forkingId, setForkingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [forkedIds, setForkedIds] = useState<Set<string>>(() => new Set())
  const reqIdRef = useRef(0)

  const followed = useFollowedCollections()
  const userCollections = useUserCollections()
  const [{ user, isAuthenticated }] = useAuth()
  const viewerDiscordId = user?.discordId ?? null

  const followedTokens = useMemo(() => {
    const set = new Set<string>()
    for (const c of followed.items || []) {
      if (c.shareToken) set.add(c.shareToken)
    }
    return set
  }, [followed.items])

  const fetchResults = useCallback(async (term: string) => {
    const reqId = ++reqIdRef.current
    setLoading(true)
    setError(null)
    try {
      const result = await listPublicCollections({ q: term, limit: 48 })
      if (reqId !== reqIdRef.current) return
      setItems(result.items)
      setTotal(result.total)
    } catch (err) {
      if (reqId !== reqIdRef.current) return
      setItems([])
      setTotal(0)
      setError(err instanceof Error ? err.message : "Could not load public collections")
    } finally {
      if (reqId === reqIdRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchResults(initialQ)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = inputValue.trim()
    setAppliedQ(trimmed)
    const next = new URLSearchParams(searchParams)
    if (trimmed) next.set("q", trimmed)
    else next.delete("q")
    setSearchParams(next, { replace: true })
    void fetchResults(trimmed)
  }

  const handleClear = () => {
    setInputValue("")
    setAppliedQ("")
    const next = new URLSearchParams(searchParams)
    next.delete("q")
    setSearchParams(next, { replace: true })
    void fetchResults("")
  }

  const handleFollow = async (collection: PublicCollection) => {
    if (!collection.shareToken || followingId) return
    setActionError(null)
    setFollowingId(collection.id)
    try {
      const res = await followPublicCollection(collection.shareToken)
      if (res.status === 401) {
        setActionError("Sign in to follow collections.")
        return
      }
      if (!res.ok) {
        setActionError("Could not follow this collection.")
        return
      }
      await followed.refresh()
    } finally {
      setFollowingId(null)
    }
  }

  const handleFork = async (collection: PublicCollection) => {
    if (!collection.shareToken || forkingId) return
    if (!isAuthenticated) {
      setActionError("Sign in to fork collections.")
      return
    }
    setActionError(null)
    setForkingId(collection.id)
    try {
      await forkCloudCollection(collection.shareToken)
      await userCollections.refresh()
      setForkedIds((prev) => {
        const next = new Set(prev)
        next.add(collection.id)
        return next
      })
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not fork this collection.")
    } finally {
      setForkingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/collections")}
            className="gap-1.5 -ml-2 h-8 text-xs text-zinc-400 hover:text-white hover:bg-white/[.05]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Your collections
          </Button>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Community</p>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Layers3 className="h-6 w-6 text-zinc-400" />
            Public collections
          </h1>
          <p className="text-sm text-zinc-400 max-w-xl">
            Collections owners have marked public. Search by name, owner, or games inside.
          </p>
        </div>
      </header>

      <form onSubmit={handleSearch} className="flex gap-2 max-w-2xl">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Search by collection name, owner, or game…"
            className="pl-9 pr-9 rounded-2xl bg-white/[.03] border-white/[.07] h-11 text-white placeholder:text-zinc-500"
          />
          {inputValue && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Button type="submit" className="rounded-2xl h-11 px-5" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
        </Button>
      </form>

      {appliedQ && !loading && !error && (
        <p className="text-xs text-zinc-500">
          {total} {total === 1 ? "result" : "results"} for &ldquo;{appliedQ}&rdquo;
        </p>
      )}

      {actionError && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200 flex items-start justify-between gap-3">
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-amber-200/70 hover:text-amber-100"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {error ? (
        <Card className="rounded-3xl border-white/[.07] bg-zinc-950/40">
          <CardContent className="p-10 text-center text-sm text-zinc-400 space-y-2">
            <p>Could not load public collections.</p>
            <p className="text-xs text-zinc-500">{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => void fetchResults(appliedQ)}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-72 rounded-3xl bg-zinc-900/40 animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card className="rounded-3xl border-white/[.07] bg-zinc-950/40">
          <CardContent className="p-10 text-center text-sm text-zinc-400 space-y-2">
            {appliedQ ? (
              <>
                <p>No collections match &ldquo;{appliedQ}&rdquo;.</p>
                <p className="text-xs text-zinc-500">Try a different search term.</p>
              </>
            ) : (
              <p>
                No public collections yet. Share a collection from the Collections page to appear here.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((c) => (
            <PublicCollectionCard
              key={c.id}
              collection={c}
              viewerDiscordId={viewerDiscordId}
              isAuthenticated={isAuthenticated}
              isFollowing={Boolean(c.shareToken && followedTokens.has(c.shareToken))}
              followingId={followingId}
              forkingId={forkingId}
              justForked={forkedIds.has(c.id)}
              onOpen={() => {
                const url = shareUrlFor(c.shareToken)
                if (window.ucSystem?.openExternal) {
                  void window.ucSystem.openExternal(url)
                } else {
                  window.open(url, "_blank")
                }
              }}
              onFollow={() => void handleFollow(c)}
              onFork={() => void handleFork(c)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

type PublicCollectionCardProps = {
  collection: PublicCollection
  viewerDiscordId: string | null
  isAuthenticated: boolean
  isFollowing: boolean
  followingId: string | null
  forkingId: string | null
  justForked: boolean
  onOpen: () => void
  onFollow: () => void
  onFork: () => void
}

function PublicCollectionCard({
  collection: c,
  viewerDiscordId,
  isAuthenticated,
  isFollowing,
  followingId,
  forkingId,
  justForked,
  onOpen,
  onFollow,
  onFork,
}: PublicCollectionCardProps) {
  const ownerName = c.owner.displayName || c.owner.username || "Member"
  const isOwn = !!viewerDiscordId && c.owner.discordId === viewerDiscordId
  const contributors = c.contributorsPreview || []
  const tiles = (c.previewCoverUrls || []).slice(0, 6)
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<CollectionMenuPoint | null>(null)

  const menuSections: CollectionMenuSection[] = (() => {
    const sections: CollectionMenuSection[] = []
    sections.push({
      id: "open",
      items: [
        { id: "open", icon: COLLECTION_MENU_ICONS.open, label: "Open share page", onSelect: onOpen },
      ],
    })
    if (!isOwn) {
      const items: CollectionMenuSection["items"] = []
      items.push({
        id: "follow",
        icon: isFollowing ? COLLECTION_MENU_ICONS.unfollow : COLLECTION_MENU_ICONS.follow,
        label: isFollowing ? "Already following" : "Follow",
        disabled: !isAuthenticated || isFollowing || followingId === c.id,
        onSelect: onFollow,
      })
      items.push({
        id: "fork",
        icon: COLLECTION_MENU_ICONS.fork,
        label: justForked ? "Forked" : "Fork into my collections",
        disabled: !isAuthenticated || forkingId === c.id || justForked,
        onSelect: onFork,
      })
      sections.push({ id: "actions", items })
    }
    return sections
  })()

  return (
    <div
      className="group/card flex flex-col rounded-3xl border border-white/[.07] bg-zinc-900/40 backdrop-blur-md overflow-hidden transition-colors hover:border-white/[.14]"
      onContextMenu={(e) => {
        e.preventDefault()
        setContextMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="relative aspect-[16/10] w-full overflow-hidden bg-zinc-900 cursor-pointer text-left"
        aria-label={`Open ${c.name}`}
      >
        {tiles.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-700">
            <Layers3 className="h-12 w-12" />
          </div>
        ) : (
          <div className="absolute inset-0 grid grid-cols-3 grid-rows-2 gap-px bg-zinc-950">
            {tiles.map((src, idx) => (
              <div key={`${c.id}-${idx}`} className="relative overflow-hidden">
                {src ? (
                  <img
                    src={proxyImageUrl(getCardImage(src))}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                    onError={(e) => ((e.currentTarget as HTMLImageElement).style.opacity = "0")}
                  />
                ) : (
                  <div className="h-full w-full bg-zinc-900" />
                )}
              </div>
            ))}
            {Array.from({ length: Math.max(0, 6 - tiles.length) }).map((_, idx) => (
              <div key={`pad-${idx}`} className="bg-zinc-900" />
            ))}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-white/[.10] bg-black/60 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold text-zinc-100">
            <Globe className="h-2.5 w-2.5" /> Public
          </span>
          {isOwn && (
            <Badge variant="outline" className="rounded-full bg-black/60 backdrop-blur-sm text-[10px] gap-1">
              <Check className="h-3 w-3" /> Yours
            </Badge>
          )}
        </div>
        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-white/[.10] bg-black/50 backdrop-blur-sm px-2.5 py-0.5 text-[11px] font-semibold text-zinc-200">
            <Layers3 className="h-3 w-3" />
            {c.gameCount} {c.gameCount === 1 ? "game" : "games"}
            <span className="ml-1 inline-flex items-center gap-0.5 text-zinc-400">
              <Users className="h-2.5 w-2.5" />
              {c.followerCount}
            </span>
            <span className="ml-0.5 inline-flex items-center gap-0.5 text-zinc-400">
              <GitFork className="h-2.5 w-2.5" />
              {c.forkCount}
            </span>
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-white/[.10] bg-black/50 backdrop-blur-sm px-2.5 py-0.5 text-[11px] font-semibold text-zinc-200 opacity-0 group-hover/card:opacity-100 transition-opacity">
            Open <ArrowRight className="h-3 w-3" />
          </span>
        </div>
      </button>

      <div className="flex flex-col gap-2 px-4 py-3 border-t border-white/[.05]">
        <div className="flex items-center gap-2">
          <h3 className="flex-1 truncate font-semibold text-sm text-white">{c.name}</h3>
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="More actions"
                title="More actions"
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/[.06] hover:text-zinc-100 transition-colors"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto p-0 bg-transparent border-0 shadow-none">
              <CollectionActionMenuPanel
                title={c.name}
                subtitle={isOwn ? "Your collection" : `by ${ownerName}`}
                sections={menuSections}
                onAfterSelect={() => setMenuOpen(false)}
              />
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-zinc-500">
          <div className="h-5 w-5 rounded-full overflow-hidden bg-zinc-800 shrink-0" title={`Owner: ${ownerName}`}>
            {c.owner.avatarUrl ? (
              <img src={c.owner.avatarUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : null}
          </div>
          <span className="truncate">by {ownerName}</span>
          {contributors.length > 0 && (
            <div className="flex -space-x-1.5 ml-auto shrink-0">
              {contributors.slice(0, 3).map((cc) => {
                const label = cc.displayName || cc.username || "Contributor"
                return (
                  <div
                    key={cc.discordId}
                    className="h-4 w-4 rounded-full overflow-hidden bg-zinc-800 ring-1 ring-zinc-950"
                    title={`Contributor: ${label}`}
                  >
                    {cc.avatarUrl ? (
                      <img src={cc.avatarUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : null}
                  </div>
                )
              })}
              {contributors.length > 3 && (
                <div className="h-4 w-4 rounded-full bg-zinc-800 ring-1 ring-zinc-950 flex items-center justify-center text-[8px] font-semibold text-zinc-300">
                  +{contributors.length - 3}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <CollectionActionContextMenu
        open={contextMenu != null}
        position={contextMenu}
        onClose={() => setContextMenu(null)}
        title={c.name}
        subtitle={isOwn ? "Your collection" : `by ${ownerName}`}
        sections={menuSections}
      />
    </div>
  )
}
