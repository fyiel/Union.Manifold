import { NavLink } from "react-router-dom"
import { Hammer, ChevronDown } from "lucide-react"
import { primaryNavItems, secondaryNavItems, bottomNavItems } from "@/lib/navigation"
import { cn } from "@/lib/utils"
import { useState } from "react"

interface SidebarProps {
  mobileOpen: boolean
  onClose: () => void
}

export function Sidebar({ mobileOpen, onClose }: SidebarProps) {
  const [collectionsOpen, setCollectionsOpen] = useState(true)

  const content = (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm">
          <Hammer className="h-4.5 w-4.5 text-black" />
        </div>
        <div className="min-w-0">
          <span className="block text-sm font-bold tracking-tight text-white">UnionCrax</span>
          <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">.Direct</span>
        </div>
      </div>

      <div className="mx-4 h-px bg-white/[.07]" />

      {/* Main Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 pt-4">
        <div className="mb-1 px-3">
          <span className="section-label">Main</span>
        </div>
        <div className="space-y-0.5">
          {primaryNavItems.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              end={item.to === "/"}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  "group flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-all duration-150",
                  isActive
                    ? "bg-white/[.08] text-white shadow-sm"
                    : "text-zinc-500 hover:bg-white/[.04] hover:text-zinc-200"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <div className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors",
                    isActive ? "bg-white/10" : "bg-transparent group-hover:bg-white/[.04]"
                  )}>
                    <item.icon className="h-4 w-4 shrink-0" />
                  </div>
                  <span>{item.label}</span>
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
            className="mb-1 flex w-full items-center justify-between px-3 group"
          >
            <span className="section-label">Collections</span>
            <ChevronDown className={cn(
              "h-3 w-3 text-zinc-600 transition-transform duration-200 group-hover:text-zinc-400",
              collectionsOpen ? "rotate-0" : "-rotate-90"
            )} />
          </button>
          {collectionsOpen && (
            <div className="space-y-0.5">
              {secondaryNavItems.map((item) => (
                <NavLink
                  key={item.label}
                  to={item.to}
                  onClick={onClose}
                  className={({ isActive }) =>
                    cn(
                      "group flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-all duration-150",
                      isActive
                        ? "bg-white/[.08] text-white shadow-sm"
                        : "text-zinc-500 hover:bg-white/[.04] hover:text-zinc-200"
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <div className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors",
                        isActive ? "bg-white/10" : "bg-transparent group-hover:bg-white/[.04]"
                      )}>
                        <item.icon className="h-4 w-4 shrink-0" />
                      </div>
                      <span>{item.label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          )}
        </div>
      </nav>

      {/* Bottom section */}
      <div className="mt-auto border-t border-white/[.07] px-3 py-3">
        {bottomNavItems.map((item) => (
          <NavLink
            key={item.label}
            to={item.to}
            onClick={onClose}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-all duration-150",
                isActive
                  ? "bg-white/[.08] text-white shadow-sm"
                  : "text-zinc-500 hover:bg-white/[.04] hover:text-zinc-200"
              )
            }
          >
            {({ isActive }) => (
              <>
                <div className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors",
                  isActive ? "bg-white/10" : "bg-transparent group-hover:bg-white/[.04]"
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
      <aside className="hidden md:fixed md:inset-y-0 md:z-40 md:flex md:w-[16rem] md:flex-col border-r border-white/[.07] bg-zinc-950/95 backdrop-blur-xl">
        {content}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
          <div className="absolute left-0 top-0 bottom-0 flex w-72 flex-col border-r border-white/[.07] bg-zinc-950 shadow-2xl">
            {content}
          </div>
        </div>
      )}
    </>
  )
}

