import { NavLink } from "react-router-dom"
import { Download, Gamepad2, Library, Settings } from "lucide-react"

const navItems = [
  { label: "Browse", to: "/", icon: Gamepad2 },
  { label: "Library", to: "/library", icon: Library },
  { label: "Activity", to: "/downloads", icon: Download },
  { label: "Settings", to: "/settings", icon: Settings },
]

interface SidebarProps {
  mobileOpen: boolean
  onClose: () => void
}

export function Sidebar({ mobileOpen, onClose }: SidebarProps) {
  return (
    <>
      <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
        <div className="flex items-center gap-3 px-6 py-6">
          <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center">
            <Gamepad2 className="h-6 w-6 text-primary" />
          </div>
          <div>
            <div className="text-lg font-black font-montserrat">UnionCrax.Direct</div>
            <div className="text-xs text-muted-foreground">Direct downloads</div>
          </div>
        </div>
        <nav className="flex-1 px-3 space-y-2">
          {navItems.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl transition-all border border-transparent ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground border-sidebar-border"
                    : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60"
                }`
              }
            >
              <item.icon className="h-5 w-5" />
              <span className="font-medium">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="px-6 py-4 border-t border-sidebar-border" />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={onClose} />
          <div className="absolute left-0 top-0 bottom-0 w-72 bg-sidebar text-sidebar-foreground border-r border-sidebar-border p-4 flex flex-col">
            <div className="flex items-center gap-3 px-2 py-4">
              <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <Gamepad2 className="h-6 w-6 text-primary" />
              </div>
              <div>
                <div className="text-lg font-black font-montserrat">UnionCrax.Direct</div>
                <div className="text-xs text-muted-foreground">Direct downloads</div>
              </div>
            </div>
            <nav className="flex-1 px-1 space-y-2">
              {navItems.map((item) => (
                <NavLink
                  key={item.label}
                  to={item.to}
                  end={item.to === "/"}
                  onClick={onClose}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-4 py-3 rounded-xl transition-all border border-transparent ${
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground border-sidebar-border"
                        : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60"
                    }`
                  }
                >
                  <item.icon className="h-5 w-5" />
                  <span className="font-medium">{item.label}</span>
                </NavLink>
              ))}
            </nav>
            <div className="px-2 py-3 border-t border-sidebar-border" />
          </div>
        </div>
      )}
    </>
  )
}
