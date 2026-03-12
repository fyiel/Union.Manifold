import { useEffect, useMemo, useState, type MouseEvent } from "react"
import { NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { SearchSuggestions } from "@/components/SearchSuggestions"
import { DiscordAvatar } from "@/components/DiscordAvatar"
import { BackButton } from "@/components/BackButton"
import { useDiscordAccount } from "@/hooks/use-discord-account"
import { apiFetch, apiUrl, getApiBaseUrl } from "@/lib/api"
import {
  ChevronDown,
  Hammer,
  LogIn,
  LogOut,
  Menu,
  Search,
  Settings,
  UserRound,
} from "lucide-react"

const siteNavItems = [
  { label: "Home", path: "/" },
  { label: "Blogs", path: "/blogs" },
  { label: "Request", path: "/request" },
  { label: "About", path: "/about" },
  { label: "Contacts", path: "/contacts" },
  { label: "FAQ", path: "/faq" },
  { label: "Donations", path: "/donations" },
  { label: "Discord", path: "/discord" },
]

const directNavItems = [
  { label: "Library", to: "/library" },
  { label: "Activity", to: "/downloads" },
  { label: "Screenshots", to: "/screenshots" },
  { label: "Settings", to: "/settings" },
]

const accountNavItems = [
  { label: "Profile", to: "/account" },
  { label: "Wishlist", to: "/wishlist" },
  { label: "Liked", to: "/liked" },
  { label: "View history", to: "/view-history" },
  { label: "Search history", to: "/search-history" },
]

export function TopBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const initialQuery = useMemo(() => searchParams.get("q") || "", [searchParams])
  const [globalSearch, setGlobalSearch] = useState(initialQuery)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)
  const { user: accountUser, loading: accountLoading, refresh } = useDiscordAccount()

  useEffect(() => {
    if (location.pathname.startsWith("/search")) {
      setGlobalSearch(initialQuery)
    }
  }, [initialQuery, location.pathname])


  const handleSearchShortcut = () => {
    if (typeof window === "undefined") return
    window.dispatchEvent(new Event("uc_open_search_popup"))
  }

  const handleHomeNav = (e?: MouseEvent) => {
    if (typeof window === "undefined") return
    e?.preventDefault()
    if (location.pathname === "/") {
      window.dispatchEvent(new Event("uc_home_nav"))
      return
    }
    navigate("/")
    window.setTimeout(() => window.dispatchEvent(new Event("uc_home_nav")), 80)
  }

  const handleLogoNav = (e?: MouseEvent) => {
    if (typeof window === "undefined") return
    e?.preventDefault()
    if (location.pathname === "/") {
      window.dispatchEvent(new Event("uc_home_hero"))
      return
    }
    navigate("/")
    window.setTimeout(() => window.dispatchEvent(new Event("uc_home_hero")), 80)
  }

  const openExternal = (path: string) => {
    if (typeof window === "undefined") return
    window.open(apiUrl(path), "_blank", "noopener")
  }

  const accountLabel = accountUser ? accountUser.displayName || accountUser.username : "Account"
  const avatarUrl = accountUser?.avatarUrl
  const showAccountLoading = accountLoading
  const accountSubtitle = accountUser ? "Discord account" : "Login to continue"
  const accountActionLabel = accountUser
    ? (loggingOut ? "Signing out..." : "Logout")
    : (loggingIn ? "Connecting..." : "Log in")

  const handleLogin = async () => {
    const baseUrl = getApiBaseUrl()
    if (!window.ucAuth?.login) {
      window.open(apiUrl("/api/discord/connect?next=/settings"), "_blank")
      return
    }

    setLoggingIn(true)
    try {
      const result = await window.ucAuth.login(baseUrl)
      if (result?.ok) {
        await refresh(true)
      }
    } catch {
      // ignore login errors
    } finally {
      setLoggingIn(false)
    }
  }

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      await apiFetch("/api/comments/session", { method: "DELETE" })
    } catch {
      // keep current state if logout fails
    }
    try {
      await window.ucAuth?.logout?.(getApiBaseUrl())
    } catch {
      // ignore cookie cleanup failures
    }
    try {
      localStorage.removeItem("discord_id")
    } catch {
      // ignore storage errors
    }
    window.dispatchEvent(new Event("uc_discord_logout"))
    await refresh()
    setLoggingOut(false)
  }

  return (
    <>
      <nav className="sticky top-0 z-40 w-full border-b border-white/[.07] bg-zinc-950/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex h-16 items-center gap-3">
            <BackButton />

            {/* Logo */}
            <NavLink to="/" className="flex items-center gap-2 shrink-0" onClick={handleLogoNav}>
              <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shrink-0">
                <Hammer className="w-4 h-4 text-black" />
              </div>
              <span className="font-brand text-base tracking-tight text-white hidden sm:block">
                UnionCrax<span className="text-zinc-400">.Direct</span>
              </span>
            </NavLink>

            {/* Desktop site nav */}
            <div className="hidden lg:flex items-center gap-5 ml-2">
              {siteNavItems.map((item) =>
                item.label === "Home" ? (
                  <NavLink
                    key={item.label}
                    to="/"
                    onClick={handleHomeNav}
                    className={({ isActive }) =>
                      `text-sm font-medium transition-colors ${
                        isActive ? "text-white" : "text-zinc-400 hover:text-white"
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                ) : (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => openExternal(item.path)}
                    className="text-sm font-medium text-zinc-400 hover:text-white transition-colors"
                  >
                    {item.label}
                  </button>
                )
              )}

              {/* Direct dropdown */}
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-sm font-medium text-zinc-400 hover:text-white transition-colors"
                  >
                    Direct
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-44 rounded-2xl p-2 bg-zinc-900 border border-white/[.07] shadow-2xl"
                >
                  {directNavItems.map((item) => (
                    <NavLink
                      key={item.label}
                      to={item.to}
                      className={({ isActive }) =>
                        `block rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                          isActive
                            ? "bg-white/[.05] text-white"
                            : "text-zinc-400 hover:text-white hover:bg-white/[.03]"
                        }`
                      }
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </PopoverContent>
              </Popover>
            </div>

            {/* Right side */}
            <div className="ml-auto flex items-center gap-2">
              {/* Search */}
              <button
                type="button"
                onClick={handleSearchShortcut}
                aria-label="Open search"
                title="Ctrl+K to search"
                className="w-9 h-9 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-white/[.05] transition-all active:scale-95"
              >
                <Search className="h-4.5 w-4.5" />
              </button>

              {/* Account â€” desktop */}
              <div className="hidden lg:block">
                {showAccountLoading ? (
                  <div className="w-9 h-9 rounded-full border border-white/[.07] bg-zinc-900 flex items-center justify-center">
                    <UserRound className="h-4.5 w-4.5 text-zinc-500" />
                  </div>
                ) : (
                  <Popover>
                    <PopoverTrigger
                      className="flex items-center justify-center rounded-full outline-none ring-offset-background focus-visible:ring-1 focus-visible:ring-white/20"
                      aria-label={`${accountLabel} menu`}
                    >
                      {avatarUrl ? (
                        <DiscordAvatar
                          avatarUrl={avatarUrl}
                          alt="Account avatar"
                          className="h-9 w-9 rounded-full border border-white/[.07]"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-full border border-white/[.07] bg-zinc-900 flex items-center justify-center hover:bg-zinc-800 transition-colors">
                          <UserRound className="h-4.5 w-4.5 text-zinc-400" />
                        </div>
                      )}
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      className="w-56 rounded-2xl p-2 bg-zinc-900 border border-white/[.07] shadow-2xl"
                    >
                      <div className="px-3 py-2">
                        <div className="text-sm font-semibold text-zinc-200">{accountLabel}</div>
                        <div className="text-xs text-zinc-500">{accountSubtitle}</div>
                      </div>
                      <div className="h-px bg-white/[.07] my-1" />
                      {accountNavItems.map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => navigate(item.to)}
                          className="block w-full text-left rounded-xl px-3 py-2 text-sm text-zinc-400 hover:text-white hover:bg-white/[.03] transition-colors"
                        >
                          {item.label}
                        </button>
                      ))}
                      <div className="h-px bg-white/[.07] my-1" />
                      <button
                        type="button"
                        onClick={() => navigate("/settings")}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-zinc-400 hover:text-white hover:bg-white/[.03] transition-colors"
                      >
                        <Settings className="h-4 w-4" />
                        Account settings
                      </button>
                      <button
                        type="button"
                        onClick={accountUser ? handleLogout : handleLogin}
                        disabled={accountUser ? loggingOut : loggingIn}
                        className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors disabled:opacity-40 ${
                          accountUser
                            ? "text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
                            : "text-zinc-400 hover:text-white hover:bg-white/[.03]"
                        }`}
                      >
                        {accountUser ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
                        {accountActionLabel}
                      </button>
                    </PopoverContent>
                  </Popover>
                )}
              </div>

              {/* Mobile hamburger */}
              <div className="lg:hidden">
                <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                  <SheetTrigger asChild>
                    <button
                      type="button"
                      aria-label="Open menu"
                      className="w-9 h-9 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-white/[.05] transition-all active:scale-95"
                    >
                      <Menu className="h-5 w-5" />
                    </button>
                  </SheetTrigger>
                  <SheetContent
                    side="right"
                    className="w-72 bg-zinc-950 border-l border-white/[.07] p-0"
                  >
                    <div className="flex flex-col gap-5 p-5 pt-8">
                      {/* Logo row */}
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
                          <Hammer className="w-4 h-4 text-black" />
                        </div>
                        <div>
                          <div className="text-sm font-brand text-white">UnionCrax.Direct</div>
                          <div className="text-xs text-zinc-500">Game launcher</div>
                        </div>
                      </div>

                      {/* Account row */}
                      <div className="glass rounded-2xl p-3">
                        {accountUser ? (
                          <button
                            type="button"
                            onClick={() => { navigate("/settings"); setMobileOpen(false) }}
                            className="flex items-center gap-3 w-full text-left"
                          >
                            {avatarUrl ? (
                              <DiscordAvatar avatarUrl={avatarUrl} alt="Account avatar" className="h-9 w-9 rounded-full" />
                            ) : (
                              <div className="w-9 h-9 rounded-full border border-white/[.07] bg-zinc-800 flex items-center justify-center">
                                <UserRound className="h-4.5 w-4.5 text-zinc-400" />
                              </div>
                            )}
                            <div>
                              <div className="text-sm font-semibold text-zinc-200">{accountLabel}</div>
                              <div className="text-xs text-zinc-500">Profile & requests</div>
                            </div>
                          </button>
                        ) : showAccountLoading ? (
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full border border-white/[.07] bg-zinc-800 flex items-center justify-center">
                              <UserRound className="h-4.5 w-4.5 text-zinc-500" />
                            </div>
                            <div className="text-sm text-zinc-500">Loading account...</div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => { handleLogin(); setMobileOpen(false) }}
                            className="flex items-center gap-3 w-full text-left"
                          >
                            <div className="w-9 h-9 rounded-full border border-white/[.07] bg-zinc-800 flex items-center justify-center">
                              <UserRound className="h-4.5 w-4.5 text-zinc-400" />
                            </div>
                            <div>
                              <div className="text-sm font-medium text-zinc-200">Login with Discord</div>
                              <div className="text-xs text-zinc-500">Connect your account</div>
                            </div>
                          </button>
                        )}
                      </div>

                      {/* Account nav items */}
                      {accountUser && (
                        <div>
                          <div className="section-label mb-2">Account</div>
                          <div className="space-y-0.5">
                            {accountNavItems.map((item) => (
                              <button
                                key={item.label}
                                type="button"
                                onClick={() => { navigate(item.to); setMobileOpen(false) }}
                                className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-400 hover:text-white hover:bg-white/[.03] transition-colors"
                              >
                                {item.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Site nav */}
                      <div>
                        <div className="section-label mb-2">UnionCrax</div>
                        <div className="space-y-0.5">
                          {siteNavItems.map((item) =>
                            item.label === "Home" ? (
                              <button
                                key={item.label}
                                type="button"
                                onClick={() => { handleHomeNav(); setMobileOpen(false) }}
                                className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-400 hover:text-white hover:bg-white/[.03] transition-colors"
                              >
                                {item.label}
                              </button>
                            ) : (
                              <button
                                key={item.label}
                                type="button"
                                onClick={() => { openExternal(item.path); setMobileOpen(false) }}
                                className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-400 hover:text-white hover:bg-white/[.03] transition-colors"
                              >
                                {item.label}
                              </button>
                            )
                          )}
                        </div>
                      </div>

                      {/* Direct nav */}
                      <div>
                        <div className="section-label mb-2">Direct</div>
                        <div className="space-y-0.5">
                          {directNavItems.map((item) => (
                            <NavLink
                              key={item.label}
                              to={item.to}
                              onClick={() => setMobileOpen(false)}
                              className={({ isActive }) =>
                                `flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                                  isActive
                                    ? "bg-white/[.05] text-white"
                                    : "text-zinc-400 hover:text-white hover:bg-white/[.03]"
                                }`
                              }
                            >
                              {item.label}
                            </NavLink>
                          ))}
                        </div>
                      </div>

                      {/* Logout / login at bottom */}
                      <button
                        type="button"
                        onClick={accountUser ? handleLogout : handleLogin}
                        disabled={accountUser ? loggingOut : loggingIn}
                        className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors disabled:opacity-40 ${
                          accountUser
                            ? "text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
                            : "text-zinc-400 hover:text-white hover:bg-white/[.03]"
                        }`}
                      >
                        {accountUser ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
                        {accountActionLabel}
                      </button>
                    </div>
                  </SheetContent>
                </Sheet>
              </div>
            </div>
          </div>
        </div>
      </nav>
      <SearchSuggestions
        value={globalSearch}
        onChange={setGlobalSearch}
        onSubmit={(e) => {
          e.preventDefault()
          const term = globalSearch.trim()
          navigate(term ? `/search?q=${encodeURIComponent(term)}` : "/search")
        }}
        placeholder="Search games..."
        popup
        showFiltersButton
        enableShortcut
        showShortcutHint
        openEventName="uc_open_search_popup"
        hideInputWhenClosed
        closeOnSubmit
      />
    </>
  )
}
