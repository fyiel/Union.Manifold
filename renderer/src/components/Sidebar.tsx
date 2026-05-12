import { NavLink, useLocation, useNavigate } from "react-router-dom"
import { ChevronDown, ChevronLeft, ChevronRight, Layers3, Plus, Settings2 } from "lucide-react"
import { LogoStaticDark } from "@/components/brand/brand-assets"
import { primaryNavItems, secondaryNavItems, bottomNavItems } from "@/lib/navigation"
import { cn } from "@/lib/utils"
import { useState } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useLibraryCollections } from "@/hooks/use-library-collections"
import { useFollowedCollections } from "@/hooks/use-followed-collections"

interface SidebarProps {
  mobileOpen: boolean
  onClose: () => void
  collapsed: boolean
  onToggleCollapse: () => void
}

export function Sidebar({ mobileOpen, onClose, collapsed, onToggleCollapse }: SidebarProps) {
  const [libraryOpen, setLibraryOpen] = useState(true)
  const [collectionsOpen, setCollectionsOpen] = useState(true)
  const location = useLocation()
  const navigate = useNavigate()
  const { collections } = useLibraryCollections()
  const followed = useFollowedCollections()
  const followedUpdateCount = followed.items?.filter((c) => c.hasUpdates).length || 0

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

  const activeCollection = location.pathname.startsWith("/library")
    ? new URLSearchParams(location.search).get("collection")
    : null

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
            "flex shrink-0 items-center justify-center rounded-full bg-white text-black shadow-md transition-transform",
            isCollapsed ? "h-9 w-9" : "h-11 w-11"
          )}
        >
          <LogoStaticDark className={cn(isCollapsed ? "h-5 w-5" : "h-7 w-7")} />
        </span>
        {!isCollapsed && (
          <div className="min-w-0 leading-none">
            <span className="block text-[15px] font-bold tracking-tight text-white">UnionCrax</span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500 mt-1">.Direct</span>
          </div>
        )}
      </button>

      <div className="h-px bg-white/[.06] mx-3" />

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
                    "group flex items-center rounded-lg text-[13px] font-medium transition-colors duration-150",
                    isCollapsed ? "justify-center p-2.5" : "gap-2.5 px-2.5 py-2",
                    isActive
                      ? "bg-white text-zinc-900"
                      : "text-zinc-400 hover:bg-white/[.05] hover:text-zinc-100"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon className={cn("h-4 w-4 shrink-0", isActive ? "text-zinc-900" : "text-zinc-500 group-hover:text-zinc-300")} />
                    {!isCollapsed && (
                      <span className={cn("font-semibold", isActive ? "text-zinc-900" : "")}>{item.label}</span>
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
                          ? "bg-white/[.08] text-white"
                          : "text-zinc-600 hover:bg-white/[.05] hover:text-zinc-300"
                      )
                    }
                  >
                    {({ isActive }) => <item.icon className={cn("h-4 w-4 shrink-0", isActive && "text-white")} />}
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
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-600 group-hover:text-zinc-400 transition-colors duration-150">My Library</span>
                  <ChevronDown className={cn(
                    "h-3 w-3 text-zinc-700 group-hover:text-zinc-500 transition-[transform,color] duration-150",
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
                              "group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-150",
                              isActive
                                ? "bg-white/[.07] text-white"
                                : "text-zinc-500 hover:bg-white/[.04] hover:text-zinc-200"
                            )
                          }
                        >
                          {({ isActive }) => (
                            <>
                              <item.icon className={cn("h-3.5 w-3.5 shrink-0", isActive ? "text-zinc-200" : "text-zinc-600 group-hover:text-zinc-400")} />
                              <span>{item.label}</span>
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
                      ? "bg-white/[.08] text-white"
                      : "text-zinc-600 hover:bg-white/[.05] hover:text-zinc-300"
                  )
                }
              >
                <Layers3 className="h-4 w-4 shrink-0" />
              </NavLink>
              {collections.slice(0, 6).map((collection) => {
                const isActive = activeCollection?.toLowerCase() === collection.name.toLowerCase()
                return (
                  <NavLink
                    key={collection.name}
                    to={`/library?collection=${encodeURIComponent(collection.name)}`}
                    onClick={onClose}
                    title={`${collection.name} (${collection.count})`}
                    className={cn(
                      "flex justify-center items-center rounded-lg p-2.5 transition-colors duration-150",
                      isActive
                        ? "bg-white/[.08] text-white"
                        : "text-zinc-600 hover:bg-white/[.05] hover:text-zinc-300"
                    )}
                  >
                    <span className="text-[10px] font-bold uppercase tracking-wider leading-none">
                      {collection.name.slice(0, 1)}
                    </span>
                  </NavLink>
                )
              })}
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
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-600 group-hover:text-zinc-400 transition-colors duration-150">
                    Collections
                  </span>
                  {collections.length > 0 && (
                    <span className="rounded-full bg-white/[.06] px-1 text-[9px] font-bold text-zinc-500 leading-4 tabular-nums">
                      {collections.length}
                    </span>
                  )}
                  <ChevronDown className={cn(
                    "h-3 w-3 text-zinc-700 group-hover:text-zinc-500 transition-[transform,color] duration-150",
                    collectionsOpen ? "rotate-0" : "-rotate-90"
                  )} />
                </button>
                <NavLink
                  to="/collections"
                  onClick={onClose}
                  title={followedUpdateCount > 0 ? `${followedUpdateCount} followed collection${followedUpdateCount === 1 ? "" : "s"} updated` : "Manage collections"}
                  className="inline-flex items-center gap-1 rounded-md text-zinc-600 hover:text-zinc-300 transition-colors duration-150 p-1 relative"
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
                        className="group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12px] text-zinc-600 hover:bg-white/[.04] hover:text-zinc-300 transition-colors duration-150"
                      >
                        <Plus className="h-3.5 w-3.5 shrink-0 text-zinc-700 group-hover:text-zinc-500" />
                        <span>Create your first</span>
                      </NavLink>
                    ) : (
                      <>
                        {collections.map((collection) => {
                          const isActive = activeCollection?.toLowerCase() === collection.name.toLowerCase()
                          return (
                            <NavLink
                              key={collection.name}
                              to={`/library?collection=${encodeURIComponent(collection.name)}`}
                              onClick={onClose}
                              className={cn(
                                "group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-150",
                                isActive
                                  ? "bg-white/[.07] text-white"
                                  : "text-zinc-500 hover:bg-white/[.04] hover:text-zinc-200"
                              )}
                            >
                              <Layers3 className={cn("h-3.5 w-3.5 shrink-0", isActive ? "text-zinc-300" : "text-zinc-700 group-hover:text-zinc-500")} />
                              <span className="truncate flex-1">{collection.name}</span>
                              <span className={cn(
                                "text-[10px] font-medium tabular-nums",
                                isActive ? "text-zinc-400" : "text-zinc-700 group-hover:text-zinc-500"
                              )}>
                                {collection.count}
                              </span>
                            </NavLink>
                          )
                        })}
                        <NavLink
                          to="/collections"
                          onClick={onClose}
                          className="group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12px] text-zinc-600 hover:bg-white/[.04] hover:text-zinc-300 transition-colors duration-150"
                        >
                          <Plus className="h-3.5 w-3.5 shrink-0 text-zinc-700 group-hover:text-zinc-500" />
                          <span>New collection</span>
                        </NavLink>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </nav>
      </ScrollArea>

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
                "group flex items-center rounded-lg text-[13px] font-medium transition-colors duration-150",
                isCollapsed ? "justify-center p-2.5" : "gap-2.5 px-2.5 py-2",
                isActive
                  ? "bg-white/[.07] text-white"
                  : "text-zinc-500 hover:bg-white/[.05] hover:text-zinc-200"
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon className={cn("h-4 w-4 shrink-0", isActive ? "text-white" : "text-zinc-600 group-hover:text-zinc-400")} />
                {!isCollapsed && <span>{item.label}</span>}
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
            "group flex w-full items-center rounded-lg text-[13px] font-medium transition-colors duration-150 text-zinc-600 hover:bg-white/[.04] hover:text-zinc-400",
            isCollapsed ? "justify-center p-2.5" : "gap-2.5 px-2.5 py-2"
          )}
        >
          {isCollapsed
            ? <ChevronRight className="h-4 w-4 shrink-0" />
            : (
              <>
                <ChevronLeft className="h-4 w-4 shrink-0 text-zinc-700 group-hover:text-zinc-400 transition-colors duration-150" />
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
      {/* Uses the UDL `.glass` token (rgba(24,24,27,0.70) + 14px backdrop-blur)
          so the GameDetailPage ambient background drifts through the sidebar
          on game routes. On other routes the underlying body is bg-zinc-950,
          which sits ~indistinguishably behind the glass — no visual regression. */}
      <aside className={cn(
        "hidden md:fixed md:bottom-0 md:left-0 md:top-0 md:z-30 md:flex md:flex-col glass border-r border-white/[.05] transition-[width] duration-200 ease-in-out overflow-hidden",
        collapsed ? "md:w-[56px]" : "md:w-[15rem]"
      )}>
        {content(collapsed)}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
          <div className="absolute left-0 top-0 bottom-0 flex w-64 flex-col border-r border-white/[.07] glass shadow-2xl">
            {content(false)}
          </div>
        </div>
      )}
    </>
  )
}
