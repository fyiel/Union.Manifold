import { NavLink, useNavigate, useLocation } from "react-router-dom"
import { Hammer, ChevronDown, ChevronLeft, ChevronRight, RotateCw } from "lucide-react"
import { primaryNavItems, secondaryNavItems, bottomNavItems } from "@/lib/navigation"
import { cn } from "@/lib/utils"
import { useState, useCallback } from "react"

interface SidebarProps {
  mobileOpen: boolean
  onClose: () => void
}

export function Sidebar({ mobileOpen, onClose }: SidebarProps) {
  const [collectionsOpen, setCollectionsOpen] = useState(true)
  const navigate = useNavigate()
  const location = useLocation()
  const [isRefreshing, setIsRefreshing] = useState(false)

  const handleBack = useCallback(() => {
    window.history.back()
  }, [])

  const handleForward = useCallback(() => {
    window.history.forward()
  }, [])

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true)
    window.location.reload()
    setTimeout(() => setIsRefreshing(false), 1000)
  }, [])

  const content = (
    <div className="flex h-full flex-col">
      {/* Header with Logo and Navigation Controls */}
      <div className="px-4 pt-4 pb-3">
        {/* Browser-style Navigation Controls */}
        <div className="mb-4 flex items-center gap-1">
          <button
            type="button"
            onClick={handleBack}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-all hover:bg-white/[.06] hover:text-zinc-300 active:scale-95"
            aria-label="Go back"
          >
            <ChevronLeft className="h-4.5 w-4.5" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={handleForward}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-all hover:bg-white/[.06] hover:text-zinc-300 active:scale-95"
            aria-label="Go forward"
          >
            <ChevronRight className="h-4.5 w-4.5" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-all hover:bg-white/[.06] hover:text-zinc-300 active:scale-95"
            aria-label="Refresh"
          >
            <RotateCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} strokeWidth={2.5} />
          </button>
        </div>

        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-lg shadow-white/10">
            <Hammer className="h-5 w-5 text-black" />
          </div>
          <div className="min-w-0">
            <span className="block text-[15px] font-bold tracking-tight text-white">UnionCrax</span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">.Direct</span>
          </div>
        </div>
      </div>

      <div className="mx-4 h-px bg-gradient-to-r from-transparent via-white/[.07] to-transparent" />

      {/* Main Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 pt-5">
        <div className="mb-2 px-3">
          <span className="section-label">Navigation</span>
        </div>
        <div className="space-y-1">
          {primaryNavItems.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              end={item.to === "/"}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-200",
                  isActive
                    ? "bg-white text-black shadow-lg shadow-white/10"
                    : "text-zinc-400 hover:bg-white/[.06] hover:text-zinc-100"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <div className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-200",
                    isActive ? "bg-black/10" : "bg-white/[.04] group-hover:bg-white/[.08]"
                  )}>
                    <item.icon className={cn("h-4 w-4 shrink-0", isActive && "text-black")} />
                  </div>
                  <div className="flex flex-col">
                    <span className={cn("font-semibold", isActive && "text-black")}>{item.label}</span>
                    <span className={cn(
                      "text-[10px] leading-tight",
                      isActive ? "text-black/60" : "text-zinc-600 group-hover:text-zinc-500"
                    )}>
                      {item.description.slice(0, 32)}...
                    </span>
                  </div>
                </>
              )}
            </NavLink>
          ))}
        </div>

        {/* Collections section */}
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setCollectionsOpen(!collectionsOpen)}
            className="mb-2 flex w-full items-center justify-between px-3 group"
          >
            <span className="section-label">Collections</span>
            <ChevronDown className={cn(
              "h-3.5 w-3.5 text-zinc-600 transition-transform duration-200 group-hover:text-zinc-400",
              collectionsOpen ? "rotate-0" : "-rotate-90"
            )} />
          </button>
          <div className={cn(
            "space-y-1 overflow-hidden transition-all duration-300",
            collectionsOpen ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
          )}>
            {secondaryNavItems.map((item) => (
              <NavLink
                key={item.label}
                to={item.to}
                onClick={onClose}
                className={({ isActive }) =>
                  cn(
                    "group flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-all duration-200",
                    isActive
                      ? "bg-white/[.10] text-white"
                      : "text-zinc-500 hover:bg-white/[.05] hover:text-zinc-300"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <div className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors",
                      isActive ? "bg-white/10" : "bg-transparent group-hover:bg-white/[.05]"
                    )}>
                      <item.icon className="h-4 w-4 shrink-0" />
                    </div>
                    <span>{item.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </div>
      </nav>

      {/* Bottom section */}
      <div className="mt-auto border-t border-white/[.05] px-3 py-3">
        {bottomNavItems.map((item) => (
          <NavLink
            key={item.label}
            to={item.to}
            onClick={onClose}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-200",
                isActive
                  ? "bg-white/[.10] text-white"
                  : "text-zinc-500 hover:bg-white/[.05] hover:text-zinc-300"
              )
            }
          >
            {({ isActive }) => (
              <>
                <div className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                  isActive ? "bg-white/10" : "bg-white/[.04] group-hover:bg-white/[.06]"
                )}>
                  <item.icon className="h-4 w-4 shrink-0" />
                </div>
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </div>
  )

  return (
    <>
      <aside className="hidden md:fixed md:inset-y-0 md:z-40 md:flex md:w-[16rem] md:flex-col border-r border-white/[.05] bg-zinc-950">
        {content}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
          <div className="absolute left-0 top-0 bottom-0 flex w-72 flex-col border-r border-white/[.07] bg-zinc-950 shadow-2xl">
            {content}
          </div>
        </div>
      )}
    </>
  )
}

