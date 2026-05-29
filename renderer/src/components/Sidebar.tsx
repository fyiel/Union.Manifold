import { NavLink, useLocation, useNavigate } from "react-router-dom"
import {
  Bell,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  Layers3,
  Plus,
  Settings2,
  Sparkles,
} from "@/components/icons"
import { Square } from "lucide-react"
import { LogoStaticDark } from "@/components/brand/brand-assets"
import { primaryNavItems, secondaryNavItems, bottomNavItems } from "@/lib/navigation"
import { cn, proxyImageUrl } from "@/lib/utils"
import { useEffect, useState } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useUserCollections, type UserCollection } from "@/hooks/use-user-collections"
import { useFollowedCollections, type FollowedCollection } from "@/hooks/use-followed-collections"
import { useRunningGamesSessions, type RunningSession } from "@/hooks/use-running-games"
import { useGamesData } from "@/hooks/use-games"
import {
  CollectionActionContextMenu,
  COLLECTION_MENU_ICONS,
  type CollectionMenuPoint,
  type CollectionMenuSection,
} from "@/components/CollectionActionMenu"

/** Live session timer — ticks every second while the game is running. */
function SessionTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(() => Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
  useEffect(() => {
    const id = setInterval(
      () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000))),
      1000
    )
    return () => clearInterval(id)
  }, [startedAt])
  const h = Math.floor(elapsed / 3600)
  const m = Math.floor((elapsed % 3600) / 60)
  const s = elapsed % 60
  if (h > 0) return <>{h}h {m}m</>
  if (m > 0) return <>{m}m {s}s</>
  return <>{s}s</>
}

interface SidebarProps {
  mobileOpen: boolean
  onClose: () => void
  collapsed: boolean
  onToggleCollapse: () => void
}

export function Sidebar({ mobileOpen, onClose, collapsed, onToggleCollapse }: SidebarProps) {
  const [libraryOpen, setLibraryOpen] = useState(true)
  const [collectionsOpen, setCollectionsOpen] = useState(true)
  const [followingOpen, setFollowingOpen] = useState(true)
  const location = useLocation()
  const navigate = useNavigate()
  const { collections } = useUserCollections()
  const followed = useFollowedCollections()
  const followedItems = followed.items || []
  const followedUpdateCount = followedItems.filter((c) => c.hasUpdates).length
  const runningSessions = useRunningGamesSessions()
  const { games } = useGamesData()
  const [ownedContextMenu, setOwnedContextMenu] = useState<
    { collection: UserCollection; point: CollectionMenuPoint } | null
  >(null)
  const [followedContextMenu, setFollowedContextMenu] = useState<
    { collection: FollowedCollection; point: CollectionMenuPoint } | null
  >(null)

  const handleQuitSession = async (appid: string) => {
    if (!window.ucDownloads?.quitGameExecutable) return
    try {
      await window.ucDownloads.quitGameExecutable(appid)
    } catch {
      // ignore — presence events will update the running state automatically
    }
  }

  const buildOwnedContextSections = (collection: UserCollection): CollectionMenuSection[] => {
    const isOwner = collection.role === "owner"
    const manage: CollectionMenuSection["items"] = [
      {
        id: "open",
        icon: COLLECTION_MENU_ICONS.open,
        label: "Open",
        onSelect: () => {
          onClose()
          navigate(`/collections/view/${encodeURIComponent(collection.id)}`)
        },
      },
      {
        id: "edit",
        icon: COLLECTION_MENU_ICONS.edit,
        label: "Edit games",
        onSelect: () => {
          onClose()
          navigate(`/collections?edit=${encodeURIComponent(collection.id)}`)
        },
      },
    ]
    const sharing: CollectionMenuSection["items"] = []
    if (isOwner) {
      sharing.push({
        id: "share",
        icon: COLLECTION_MENU_ICONS.share,
        label: collection.shareToken ? "Sharing settings" : "Share",
        disabled: !collection.cloud,
        onSelect: () => {
          onClose()
          navigate(`/collections?share=${encodeURIComponent(collection.id)}`)
        },
      })
      sharing.push({
        id: "contributors",
        icon: COLLECTION_MENU_ICONS.contributors,
        label: "Manage contributors",
        onSelect: () => {
          onClose()
          navigate(`/collections?contributors=${encodeURIComponent(collection.id)}`)
        },
      })
    }
    const danger: CollectionMenuSection["items"] = []
    if (isOwner) {
      danger.push({
        id: "delete",
        icon: COLLECTION_MENU_ICONS.delete,
        label: "Delete collection",
        destructive: true,
        onSelect: () => {
          onClose()
          navigate(`/collections/view/${encodeURIComponent(collection.id)}?action=delete`)
        },
      })
    }
    const out: CollectionMenuSection[] = [{ id: "manage", items: manage }]
    if (sharing.length > 0) out.push({ id: "sharing", label: "Sharing", items: sharing })
    if (danger.length > 0) out.push({ id: "danger", items: danger })
    return out
  }

  const buildFollowedContextSections = (collection: FollowedCollection): CollectionMenuSection[] => [
    {
      id: "actions",
      items: [
        {
          id: "open",
          icon: COLLECTION_MENU_ICONS.open,
          label: "Open in Collections",
          onSelect: () => {
            onClose()
            navigate(`/collections#followed-${collection.id}`)
          },
        },
        ...(collection.hasUpdates
          ? [{
              id: "mark-seen",
              icon: COLLECTION_MENU_ICONS.update,
              label: "Mark as seen",
              onSelect: () => { void followed.markSeen(collection) },
            }]
          : []),
        {
          id: "unfollow",
          icon: COLLECTION_MENU_ICONS.unfollow,
          label: "Unfollow",
          destructive: true,
          onSelect: () => { void followed.unfollow(collection) },
        },
      ],
    },
  ]

  const handleLogoNav = () => {
    onClose()
    navigate("/")
    if (typeof window !== "undefined") {
      if (window.location.hash !== "#/") {
        window.location.hash = "#/"
      }
      window.setTimeout(() => window.dispatchEvent(new Event("uc_home_hero")), 80)
    }
  }

  // Active collection: either the legacy /library?collection=<name> filter or
  // the new /collections/view/<id> dedicated page.
  const activeCollectionName = location.pathname.startsWith("/library")
    ? new URLSearchParams(location.search).get("collection")
    : null
  const activeCollectionId = (() => {
    const match = location.pathname.match(/^\/collections\/view\/([^/?#]+)/)
    if (!match) return null
    try { return decodeURIComponent(match[1]) } catch { return match[1] }
  })()

  const content = (isCollapsed: boolean) => (
    <div className="flex h-full flex-col">
      {/* Brand block — vertically aligns with the TopBar nav pill (pt-2 wrapper
          + h-14 pill ≈ centered at y=36px) so the sidebar reads as the left
          half of the same top row, not a detached panel. */}
      <button
        type="button"
        onClick={handleLogoNav}
        title="Browse"
        aria-label="Go to Browse"
        className={cn(
          "flex w-full items-center transition-opacity hover:opacity-80",
          isCollapsed ? "justify-center px-3 pt-3 pb-3" : "px-4 pt-3 pb-3 gap-3"
        )}
      >
        <span
          className={cn(
            // Container stays at its original 44px — that read fine. Bump
            // only the glyph inside so the logo fills more of the puck and
            // matches the web's lockup ratio without ballooning the chrome.
            "flex shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-transform",
            isCollapsed ? "h-9 w-9" : "h-11 w-11"
          )}
        >
          <LogoStaticDark className={cn(isCollapsed ? "h-[22px] w-[22px]" : "h-[30px] w-[30px]")} />
        </span>
        {!isCollapsed && (
          <div className="min-w-0 leading-none">
            <span className="block text-[15px] font-bold tracking-tight text-sidebar-foreground">UnionCrax</span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-sidebar-foreground/55 mt-1">.Direct</span>
          </div>
        )}
      </button>

      <div className="h-px bg-sidebar-foreground/[.06] mx-3" />

      {/* Nav */}
      <ScrollArea className="flex-1 min-h-0">
        <nav className={cn("py-3", isCollapsed ? "px-2" : "px-2")}>
          {/* Primary nav */}
          <div className="space-y-px">
            {primaryNavItems.map((item) => (
              <NavLink
                key={item.label}
                to={item.to}
                end={item.to === "/"}
                onClick={onClose}
                title={isCollapsed ? item.label : undefined}
                className={({ isActive }) =>
                  cn(
                    "uc-sidebar-row group flex items-center rounded-lg text-[13px] font-medium transition-colors duration-150",
                    isCollapsed ? "justify-center p-2.5" : "gap-2.5 px-2.5 py-2",
                    isActive
                      ? "is-active is-active-inverse bg-sidebar-primary text-sidebar-primary-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon className={cn(
                      "uc-sidebar-icon h-4 w-4 shrink-0",
                      isActive ? "text-sidebar-primary-foreground" : "text-sidebar-foreground/60 group-hover:text-sidebar-foreground/90"
                    )} />
                    {!isCollapsed && (
                      <span className={cn("uc-sidebar-label font-semibold", isActive ? "text-sidebar-primary-foreground" : "")}>{item.label}</span>
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>

          {/* My Library */}
          <div className="mt-5">
            {isCollapsed ? (
              <div className="space-y-px">
                {secondaryNavItems.map((item) => (
                  <NavLink
                    key={item.label}
                    to={item.to}
                    onClick={onClose}
                    title={item.label}
                    className={({ isActive }) =>
                      cn(
                        "flex justify-center items-center rounded-lg p-2.5 transition-colors duration-150",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/45 hover:bg-sidebar-foreground/[.05] hover:text-sidebar-foreground/80"
                      )
                    }
                  >
                    {({ isActive }) => <item.icon className={cn("h-4 w-4 shrink-0", isActive && "text-sidebar-foreground")} />}
                  </NavLink>
                ))}
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setLibraryOpen(!libraryOpen)}
                  aria-label={libraryOpen ? "Collapse my library" : "Expand my library"}
                  className="mb-1 flex w-full items-center justify-between px-2.5 py-1 group"
                >
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/45 group-hover:text-sidebar-foreground/65 transition-colors duration-150">My Library</span>
                  <ChevronDown className={cn(
                    "h-3 w-3 text-sidebar-foreground/30 group-hover:text-sidebar-foreground/55 transition-[transform,color] duration-150",
                    libraryOpen ? "rotate-0" : "-rotate-90"
                  )} />
                </button>
                {/* CSS grid expand — no layout thrash */}
                <div className={cn(
                  "grid transition-[grid-template-rows] duration-200 ease-in-out",
                  libraryOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                )}>
                  <div className="overflow-hidden">
                    <div className="space-y-px pb-1">
                      {secondaryNavItems.map((item) => (
                        <NavLink
                          key={item.label}
                          to={item.to}
                          onClick={onClose}
                          className={({ isActive }) =>
                            cn(
                              "uc-sidebar-row group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-150",
                              isActive
                                ? "is-active bg-sidebar-accent text-sidebar-accent-foreground"
                                : "text-sidebar-foreground/55 hover:bg-sidebar-foreground/[.04] hover:text-sidebar-foreground/90"
                            )
                          }
                        >
                          {({ isActive }) => (
                            <>
                              <item.icon className={cn(
                                "uc-sidebar-icon h-3.5 w-3.5 shrink-0",
                                isActive ? "text-sidebar-foreground/90" : "text-sidebar-foreground/45 group-hover:text-sidebar-foreground/65"
                              )} />
                              <span className="uc-sidebar-label">{item.label}</span>
                            </>
                          )}
                        </NavLink>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Collections */}
          {isCollapsed ? (
            <div className="mt-4 space-y-px">
              <NavLink
                to="/collections"
                onClick={onClose}
                title="Manage collections"
                className={({ isActive }) =>
                  cn(
                    "flex justify-center items-center rounded-lg p-2.5 transition-colors duration-150",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/45 hover:bg-sidebar-foreground/[.05] hover:text-sidebar-foreground/80"
                  )
                }
              >
                <Layers3 className="h-4 w-4 shrink-0" />
              </NavLink>
              {collections.slice(0, 6).map((collection) => {
                const isActive =
                  activeCollectionId === collection.id ||
                  activeCollectionName?.toLowerCase() === collection.name.toLowerCase()
                return (
                  <NavLink
                    key={collection.id}
                    to={`/collections/view/${encodeURIComponent(collection.id)}`}
                    onClick={onClose}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setOwnedContextMenu({ collection, point: { x: e.clientX, y: e.clientY } })
                    }}
                    title={`${collection.name} (${collection.appids.length})`}
                    className={cn(
                      "flex justify-center items-center rounded-lg p-2.5 transition-colors duration-150",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/45 hover:bg-sidebar-foreground/[.05] hover:text-sidebar-foreground/80"
                    )}
                  >
                    <span className="text-[10px] font-bold uppercase tracking-wider leading-none">
                      {collection.name.slice(0, 1)}
                    </span>
                  </NavLink>
                )
              })}
              {followedItems.slice(0, 4).map((collection) => (
                <NavLink
                  key={`f-${collection.id}`}
                  to={`/collections#followed-${collection.id}`}
                  onClick={onClose}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setFollowedContextMenu({ collection, point: { x: e.clientX, y: e.clientY } })
                  }}
                  title={`${collection.name} (following${collection.hasUpdates ? " — updated" : ""})`}
                  className="relative flex justify-center items-center rounded-lg p-2.5 transition-colors duration-150 text-sidebar-foreground/45 hover:bg-sidebar-foreground/[.05] hover:text-sidebar-foreground/80"
                >
                  <Bell className="h-3.5 w-3.5" />
                  {collection.hasUpdates && (
                    <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-amber-500" />
                  )}
                </NavLink>
              ))}
            </div>
          ) : (
            <div className="mt-5">
              <div className="mb-1 flex items-center justify-between px-2.5 py-1">
                <button
                  type="button"
                  onClick={() => setCollectionsOpen(!collectionsOpen)}
                  aria-label={collectionsOpen ? "Collapse collections" : "Expand collections"}
                  className="flex items-center gap-1.5 group"
                >
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/45 group-hover:text-sidebar-foreground/65 transition-colors duration-150">
                    Collections
                  </span>
                  {collections.length > 0 && (
                    <span className="rounded-full bg-sidebar-foreground/[.06] px-1 text-[9px] font-bold text-sidebar-foreground/55 leading-4 tabular-nums">
                      {collections.length}
                    </span>
                  )}
                  <ChevronDown className={cn(
                    "h-3 w-3 text-sidebar-foreground/30 group-hover:text-sidebar-foreground/55 transition-[transform,color] duration-150",
                    collectionsOpen ? "rotate-0" : "-rotate-90"
                  )} />
                </button>
                <NavLink
                  to="/collections"
                  onClick={onClose}
                  title={followedUpdateCount > 0 ? `${followedUpdateCount} followed collection${followedUpdateCount === 1 ? "" : "s"} updated` : "Manage collections"}
                  className="inline-flex items-center gap-1 rounded-md text-sidebar-foreground/45 hover:text-sidebar-foreground/80 transition-colors duration-150 p-1 relative"
                >
                  <Settings2 className="h-3 w-3" />
                  {followedUpdateCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[8px] font-bold text-black">
                      {followedUpdateCount}
                    </span>
                  )}
                </NavLink>
              </div>
              {/* CSS grid expand */}
              <div className={cn(
                "grid transition-[grid-template-rows] duration-200 ease-in-out",
                collectionsOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              )}>
                <div className="overflow-hidden">
                  <div className="space-y-px pb-1">
                    {collections.length === 0 ? (
                      <NavLink
                        to="/collections"
                        onClick={onClose}
                        className="group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12px] text-sidebar-foreground/45 hover:bg-sidebar-foreground/[.04] hover:text-sidebar-foreground/80 transition-colors duration-150"
                      >
                        <Plus className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/30 group-hover:text-sidebar-foreground/55" />
                        <span>Create your first</span>
                      </NavLink>
                    ) : (
                      <>
                        {collections.map((collection) => {
                          const isActive =
                            activeCollectionId === collection.id ||
                            activeCollectionName?.toLowerCase() === collection.name.toLowerCase()
                          return (
                            <NavLink
                              key={collection.id}
                              to={`/collections/view/${encodeURIComponent(collection.id)}`}
                              onClick={onClose}
                              onContextMenu={(e) => {
                                e.preventDefault()
                                setOwnedContextMenu({ collection, point: { x: e.clientX, y: e.clientY } })
                              }}
                              className={cn(
                                "uc-sidebar-row group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-150",
                                isActive
                                  ? "is-active bg-sidebar-accent text-sidebar-accent-foreground"
                                  : "text-sidebar-foreground/55 hover:bg-sidebar-foreground/[.04] hover:text-sidebar-foreground/90"
                              )}
                            >
                              <Layers3 className={cn(
                                "uc-sidebar-icon h-3.5 w-3.5 shrink-0",
                                isActive ? "text-sidebar-foreground/80" : "text-sidebar-foreground/30 group-hover:text-sidebar-foreground/55"
                              )} />
                              <span className="uc-sidebar-label truncate flex-1">{collection.name}</span>
                              <span className={cn(
                                "text-[10px] font-medium tabular-nums",
                                isActive ? "text-sidebar-foreground/65" : "text-sidebar-foreground/30 group-hover:text-sidebar-foreground/55"
                              )}>
                                {collection.appids.length}
                              </span>
                            </NavLink>
                          )
                        })}
                        <NavLink
                          to="/collections"
                          onClick={onClose}
                          className="group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12px] text-sidebar-foreground/45 hover:bg-sidebar-foreground/[.04] hover:text-sidebar-foreground/80 transition-colors duration-150"
                        >
                          <Plus className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/30 group-hover:text-sidebar-foreground/55" />
                          <span>New collection</span>
                        </NavLink>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Following — collections the user follows from other people */}
              {followedItems.length > 0 && (
                <div className="mt-5">
                  <div className="mb-1 flex items-center justify-between px-2.5 py-1">
                    <button
                      type="button"
                      onClick={() => setFollowingOpen(!followingOpen)}
                      aria-label={followingOpen ? "Collapse following" : "Expand following"}
                      className="flex items-center gap-1.5 group"
                    >
                      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/45 group-hover:text-sidebar-foreground/65 transition-colors duration-150">
                        Following
                      </span>
                      <span className="rounded-full bg-sidebar-foreground/[.06] px-1 text-[9px] font-bold text-sidebar-foreground/55 leading-4 tabular-nums">
                        {followedItems.length}
                      </span>
                      {followedUpdateCount > 0 && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 text-amber-300 px-1 text-[9px] font-bold leading-4">
                          <Sparkles className="h-2 w-2" />
                          {followedUpdateCount}
                        </span>
                      )}
                      <ChevronDown className={cn(
                        "h-3 w-3 text-sidebar-foreground/30 group-hover:text-sidebar-foreground/55 transition-[transform,color] duration-150",
                        followingOpen ? "rotate-0" : "-rotate-90"
                      )} />
                    </button>
                  </div>
                  <div className={cn(
                    "grid transition-[grid-template-rows] duration-200 ease-in-out",
                    followingOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  )}>
                    <div className="overflow-hidden">
                      <div className="space-y-px pb-1">
                        {followedItems.map((collection) => {
                          const ownerLabel = collection.owner.displayName || collection.owner.username || "Unknown"
                          return (
                            <NavLink
                              key={collection.id}
                              to={`/collections#followed-${collection.id}`}
                              onClick={onClose}
                              onContextMenu={(e) => {
                                e.preventDefault()
                                setFollowedContextMenu({ collection, point: { x: e.clientX, y: e.clientY } })
                              }}
                              title={`${collection.name} — by ${ownerLabel}`}
                              className="uc-sidebar-row group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-150 text-sidebar-foreground/55 hover:bg-sidebar-foreground/[.04] hover:text-sidebar-foreground/90"
                            >
                              <Bell className={cn(
                                "uc-sidebar-icon h-3.5 w-3.5 shrink-0",
                                collection.hasUpdates
                                  ? "uc-anim-wiggle text-amber-400 animate-[uc-bell-wiggle_1.6s_ease-in-out_infinite] origin-top"
                                  : "text-sidebar-foreground/30 group-hover:text-sidebar-foreground/55"
                              )} />
                              <span className="uc-sidebar-label truncate flex-1">{collection.name}</span>
                              <span className="text-[10px] font-medium tabular-nums text-sidebar-foreground/30 group-hover:text-sidebar-foreground/55">
                                {collection.gameCount}
                              </span>
                            </NavLink>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </nav>
      </ScrollArea>

      {/* Now Playing — shown when one or more games are running */}
      {runningSessions.length > 0 && (
        <div className={cn("border-t border-green-500/[.12] bg-green-950/[.08]", isCollapsed ? "px-1.5 py-2" : "px-2 py-2")}>
          {isCollapsed ? (
            /* Collapsed: pulsing game icon as a visual cue; clicking navigates to Activity */
            <button
              type="button"
              onClick={() => { onClose(); navigate("/downloads") }}
              title={`Playing: ${runningSessions.map(s => games.find(g => g.appid === s.appid)?.name || s.appid).join(", ")}`}
              className="relative flex w-full justify-center rounded-lg p-2 text-green-400 hover:bg-green-500/10 transition-colors active:scale-95"
            >
              <span className="relative flex h-5 w-5 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400/25" />
                <Gamepad2 className="relative h-4 w-4" />
              </span>
            </button>
          ) : (
            <>
              <div className="mb-1.5 flex items-center gap-2 px-2.5">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-green-600">Now Playing</span>
              </div>
              <div className="space-y-1">
                {runningSessions.map((session: RunningSession) => {
                  const game = games.find((g) => g.appid === session.appid)
                  const artSrc =
                    proxyImageUrl(
                      (game as any)?.image ||
                      (game as any)?.localImage ||
                      (game as any)?.splash ||
                      (game as any)?.localSplash ||
                      ""
                    ) || "./fallbacks/game-card-3x4.svg"
                  return (
                    <div
                      key={session.appid}
                      className="group relative overflow-hidden rounded-xl ring-1 ring-green-500/20 bg-card/60"
                    >
                      {/* Ambient game art */}
                      <div className="absolute inset-0">
                        <img src={artSrc} alt="" className="h-full w-full object-cover opacity-25" />
                        <div className="absolute inset-0 bg-gradient-to-r from-background/90 to-background/50" />
                      </div>
                      <div className="relative flex items-center gap-2 px-2.5 py-2">
                        <button
                          type="button"
                          onClick={() => { onClose(); navigate(`/game/${encodeURIComponent(session.appid)}`) }}
                          aria-label={`Open ${game?.name || session.appid}`}
                          title="Open game page"
                          className="min-w-0 flex-1 text-left rounded-md hover:bg-sidebar-foreground/[.04] focus-visible:bg-sidebar-foreground/[.04] transition-colors -mx-1 px-1 py-0.5"
                        >
                          <div className="truncate text-[12px] font-semibold text-sidebar-foreground leading-snug">
                            {game?.name || session.appid}
                          </div>
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="h-1 w-1 shrink-0 rounded-full bg-green-400 animate-pulse" />
                            <span className="text-[10px] font-mono text-green-400">
                              <SessionTimer startedAt={session.startedAt} />
                            </span>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={(event) => { event.stopPropagation(); void handleQuitSession(session.appid) }}
                          aria-label="Stop game"
                          title="Stop game"
                          className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-sidebar-foreground/55 ring-1 ring-sidebar-foreground/[.06] transition-colors hover:bg-red-500/15 hover:text-red-400 active:scale-95"
                        >
                          <Square className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Bottom */}
      <div className={cn("mt-auto border-t border-white/[.05] py-2 space-y-px", isCollapsed ? "px-2" : "px-2")}>
        {bottomNavItems.map((item) => (
          <NavLink
            key={item.label}
            to={item.to}
            onClick={onClose}
            title={isCollapsed ? item.label : undefined}
            className={({ isActive }) =>
              cn(
                "uc-sidebar-row group flex items-center rounded-lg text-[13px] font-medium transition-colors duration-150",
                isCollapsed ? "justify-center p-2.5" : "gap-2.5 px-2.5 py-2",
                isActive
                  ? "is-active bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/55 hover:bg-sidebar-foreground/[.05] hover:text-sidebar-foreground/90"
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon className={cn(
                  "uc-sidebar-icon h-4 w-4 shrink-0",
                  isActive ? "text-sidebar-foreground" : "text-sidebar-foreground/45 group-hover:text-sidebar-foreground/65"
                )} />
                {!isCollapsed && <span className="uc-sidebar-label">{item.label}</span>}
              </>
            )}
          </NavLink>
        ))}

        {/* Collapse toggle */}
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "group flex w-full items-center rounded-lg text-[13px] font-medium transition-colors duration-150 text-sidebar-foreground/45 hover:bg-sidebar-foreground/[.04] hover:text-sidebar-foreground/65",
            isCollapsed ? "justify-center p-2.5" : "gap-2.5 px-2.5 py-2"
          )}
        >
          {isCollapsed
            ? <ChevronRight className="h-4 w-4 shrink-0" />
            : (
              <>
                <ChevronLeft className="h-4 w-4 shrink-0 text-sidebar-foreground/30 group-hover:text-sidebar-foreground/65 transition-colors duration-150" />
                <span>Collapse</span>
              </>
            )
          }
        </button>
      </div>
    </div>
  )

  return (
    <>
      {/* Match the same visual DNA as the TopBar nav pill:
          bg-zinc-950/72 + backdrop-blur-2xl + border-sidebar-border
          so sidebar and navbar read as the same material. */}
      <aside className={cn(
        "hidden md:fixed md:bottom-0 md:left-0 md:top-0 md:z-30 md:flex md:flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-[inset_-1px_0_0_rgba(255,255,255,0.03)] transition-[width] duration-200 ease-in-out overflow-hidden",
        collapsed ? "md:w-[56px]" : "md:w-[15rem]"
      )}>
        {content(collapsed)}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
          <div className="absolute left-0 top-0 bottom-0 flex w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-2xl">
            {content(false)}
          </div>
        </div>
      )}
      <CollectionActionContextMenu
        open={ownedContextMenu != null}
        position={ownedContextMenu?.point ?? null}
        onClose={() => setOwnedContextMenu(null)}
        title={ownedContextMenu?.collection.name}
        subtitle={
          ownedContextMenu?.collection.role === "contributor"
            ? `by ${ownedContextMenu.collection.owner?.displayName || ownedContextMenu.collection.owner?.username || "Someone"}`
            : "Your collection"
        }
        sections={ownedContextMenu ? buildOwnedContextSections(ownedContextMenu.collection) : []}
      />
      <CollectionActionContextMenu
        open={followedContextMenu != null}
        position={followedContextMenu?.point ?? null}
        onClose={() => setFollowedContextMenu(null)}
        title={followedContextMenu?.collection.name}
        subtitle={
          followedContextMenu
            ? `by ${followedContextMenu.collection.owner.displayName || followedContextMenu.collection.owner.username || "Someone"}`
            : undefined
        }
        sections={followedContextMenu ? buildFollowedContextSections(followedContextMenu.collection) : []}
      />
    </>
  )
}
