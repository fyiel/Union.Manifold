import { NavLink } from "react-router-dom"
import { Hammer, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import { primaryNavItems, secondaryNavItems, bottomNavItems } from "@/lib/navigation"
import { cn } from "@/lib/utils"
import { useState } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"

interface SidebarProps {
  mobileOpen: boolean
  onClose: () => void
  collapsed: boolean
  onToggleCollapse: () => void
}

export function Sidebar({ mobileOpen, onClose, collapsed, onToggleCollapse }: SidebarProps) {
  const [collectionsOpen, setCollectionsOpen] = useState(true)

  const content = (isCollapsed: boolean) => (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className={cn("flex items-center pt-5 pb-4", isCollapsed ? "justify-center px-3" : "px-4")}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white shadow shadow-white/10">
          <Hammer className="h-[18px] w-[18px] text-black" />
        </div>
        {!isCollapsed && (
          <div className="ml-3 min-w-0">
            <span className="block text-[15px] font-bold tracking-tight text-white">UnionCrax</span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">.Direct</span>
          </div>
        )}
      </div>

      <div className={cn("h-px bg-gradient-to-r from-transparent via-white/[.07] to-transparent", isCollapsed ? "mx-2" : "mx-4")} />

      {/* Nav */}
      <ScrollArea className="flex-1 min-h-0">
      <nav className={cn("pt-4 space-y-1", isCollapsed ? "px-2" : "px-3")}>
        {/* Primary */}
        {!isCollapsed && (
          <div className="mb-1.5 px-3">
            <span className="section-label">Navigate</span>
          </div>
        )}
        <div className="space-y-0.5">
          {primaryNavItems.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              end={item.to === "/"}
              onClick={onClose}
              title={isCollapsed ? item.label : undefined}
              className={({ isActive }) =>
                cn(
                  "group flex items-center rounded-xl text-[13px] font-medium transition-all duration-200 active:scale-95",
                  isCollapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2.5",
                  isActive
                    ? "bg-white text-black shadow shadow-white/10"
                    : "text-zinc-400 hover:bg-white/[.06] hover:text-zinc-100"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <div className={cn(
                    "flex shrink-0 items-center justify-center rounded-lg transition-all duration-200",
                    isCollapsed ? "h-5 w-5" : "h-7 w-7",
                    isActive ? "bg-black/10" : "bg-white/[.04] group-hover:bg-white/[.08]"
                  )}>
                    <item.icon className={cn("h-4 w-4 shrink-0", isActive && "text-black")} />
                  </div>
                  {!isCollapsed && (
                    <span className={cn("font-semibold", isActive && "text-black")}>{item.label}</span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </div>

        {/* Collections */}
        <div className="mt-5 space-y-0.5">
          {isCollapsed ? (
            secondaryNavItems.map((item) => (
              <NavLink
                key={item.label}
                to={item.to}
                onClick={onClose}
                title={item.label}
                className={({ isActive }) =>
                  cn(
                    "group flex justify-center items-center rounded-xl p-2.5 transition-all duration-200 active:scale-95",
                    isActive
                      ? "bg-white/[.10] text-white"
                      : "text-zinc-600 hover:bg-white/[.05] hover:text-zinc-300"
                  )
                }
              >
                {() => <item.icon className="h-4 w-4 shrink-0" />}
              </NavLink>
            ))
          ) : (
            <>
              <button
                type="button"
                onClick={() => setCollectionsOpen(!collectionsOpen)}
                aria-label={collectionsOpen ? "Collapse collections" : "Expand collections"}
                className="mb-1.5 flex w-full items-center justify-between px-3 group"
              >
                <span className="section-label">Collections</span>
                <ChevronDown className={cn(
                  "h-3 w-3 text-zinc-600 transition-transform duration-200 group-hover:text-zinc-400",
                  collectionsOpen ? "rotate-0" : "-rotate-90"
                )} />
              </button>
              <div className={cn(
                "space-y-0.5 overflow-hidden transition-all duration-300",
                collectionsOpen ? "max-h-[400px] opacity-100" : "max-h-0 opacity-0"
              )}>
                {secondaryNavItems.map((item) => (
                  <NavLink
                    key={item.label}
                    to={item.to}
                    onClick={onClose}
                    className={({ isActive }) =>
                      cn(
                        "group flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-all duration-200 active:scale-95",
                        isActive
                          ? "bg-white/[.08] text-white"
                          : "text-zinc-500 hover:bg-white/[.05] hover:text-zinc-300"
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <div className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors",
                          isActive ? "text-white" : "text-zinc-500 group-hover:text-zinc-300"
                        )}>
                          <item.icon className="h-3.5 w-3.5 shrink-0" />
                        </div>
                        <span>{item.label}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </>
          )}
        </div>
      </nav>
      </ScrollArea>

      {/* Bottom */}
      <div className={cn("mt-auto border-t border-white/[.05] py-3 space-y-0.5", isCollapsed ? "px-2" : "px-3")}>
        {bottomNavItems.map((item) => (
          <NavLink
            key={item.label}
            to={item.to}
            onClick={onClose}
            title={isCollapsed ? item.label : undefined}
            className={({ isActive }) =>
              cn(
                "group flex items-center rounded-xl text-[13px] font-medium transition-all duration-200 active:scale-95",
                isCollapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2",
                isActive
                  ? "bg-white/[.08] text-white"
                  : "text-zinc-500 hover:bg-white/[.05] hover:text-zinc-300"
              )
            }
          >
            {({ isActive }) => (
              <>
                <div className={cn(
                  "flex shrink-0 items-center justify-center rounded-lg transition-colors",
                  isCollapsed ? "h-5 w-5" : "h-7 w-7",
                  isActive ? "bg-white/10" : "bg-white/[.04] group-hover:bg-white/[.06]"
                )}>
                  <item.icon className="h-4 w-4 shrink-0" />
                </div>
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
            "group flex w-full items-center rounded-xl text-[13px] font-medium transition-all duration-200 active:scale-95 text-zinc-600 hover:bg-white/[.04] hover:text-zinc-400",
            isCollapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2"
          )}
        >
          <div className={cn(
            "flex shrink-0 items-center justify-center rounded-lg transition-colors",
            isCollapsed ? "h-5 w-5" : "h-7 w-7",
            "bg-white/[.03] group-hover:bg-white/[.06]"
          )}>
            {isCollapsed
              ? <ChevronRight className="h-3.5 w-3.5" />
              : <ChevronLeft className="h-3.5 w-3.5" />
            }
          </div>
          {!isCollapsed && <span>Collapse</span>}
        </button>
      </div>
    </div>
  )

  return (
    <>
      <aside className={cn(
        "hidden md:fixed md:bottom-0 md:left-0 md:top-8 md:z-30 md:flex md:flex-col bg-zinc-950 border-r border-white/[.05] transition-[width] duration-300 ease-in-out overflow-hidden",
        collapsed ? "md:w-[64px]" : "md:w-[16rem]"
      )}>
        {content(collapsed)}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
          <div className="absolute left-0 top-0 bottom-0 flex w-72 flex-col border-r border-white/[.07] bg-zinc-950 shadow-2xl">
            {content(false)}
          </div>
        </div>
      )}
    </>
  )
}

