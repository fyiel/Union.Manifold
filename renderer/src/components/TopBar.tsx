import { useEffect, useMemo, useState } from "react"
import { NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
  { label: "Settings", to: "/settings" },
]

const accountItems = [
  { label: "My profile", path: "/account" },
  { label: "View history", path: "/view-history" },
  { label: "Liked", path: "/liked" },
  { label: "Wishlist", path: "/wishlist" },
  { label: "Public request feed", path: "/public-request-feed" },
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
  const [customAvatar, setCustomAvatar] = useState<string | null>(null)
  const { user: accountUser, loading: accountLoading, refresh } = useDiscordAccount()

  useEffect(() => {
    if (location.pathname.startsWith("/search")) {
      setGlobalSearch(initialQuery)
    }
  }, [initialQuery, location.pathname])

  useEffect(() => {
    const syncAvatar = () => {
      try {
        setCustomAvatar(localStorage.getItem("uc_profile_avatar"))
      } catch {
        // ignore
      }
    }

    syncAvatar()

    const onStorage = (e: StorageEvent) => {
      if (e.key === "uc_profile_avatar") syncAvatar()
    }
    const onPreferenceChange = () => syncAvatar()

    window.addEventListener("storage", onStorage)
    window.addEventListener("uc_profile_avatar", onPreferenceChange)

    return () => {
      window.removeEventListener("storage", onStorage)
      window.removeEventListener("uc_profile_avatar", onPreferenceChange)
    }
  }, [])

  const handleSearchShortcut = () => {
    if (typeof window === "undefined") return
    window.dispatchEvent(new Event("uc_open_search_popup"))
  }

  const openExternal = (path: string) => {
    if (typeof window === "undefined") return
    window.open(apiUrl(path), "_blank", "noopener")
  }

  const accountLabel = accountUser ? accountUser.displayName || accountUser.username : "Account"
  const avatarUrl = customAvatar || accountUser?.avatarUrl
  const showAccountLoading = accountLoading

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
        await refresh()
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
      <nav className="sticky top-0 z-40 w-full border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="container mx-auto max-w-7xl px-4">
          <div className="flex h-16 items-center gap-4">
            <BackButton />
            
            <NavLink to="/" className="flex items-center gap-2">
              <Hammer className="h-7 w-7 text-foreground" />
              <span className="font-black text-lg text-foreground font-montserrat">UnionCrax</span>
              <Badge className="rounded-full bg-primary/15 text-primary border-primary/20">Direct</Badge>
            </NavLink>

            <div className="hidden lg:flex items-center gap-5">
              {siteNavItems.map((item) => (
                item.label === "Home" ? (
                  <NavLink
                    key={item.label}
                    to="/"
                    className={({ isActive }) =>
                      `cursor-pointer text-sm font-medium transition-colors ${
                        isActive ? "text-primary" : "text-muted-foreground hover:text-primary"
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
                    className="cursor-pointer text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
                  >
                    {item.label}
                  </button>
                )
              ))}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-2 rounded-full">
                    Direct
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-44 rounded-2xl p-2">
                  {directNavItems.map((item) => (
                    <NavLink
                      key={item.label}
                      to={item.to}
                      className={({ isActive }) =>
                        `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                          isActive
                            ? "bg-primary/15 text-primary"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                        }`
                      }
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </PopoverContent>
              </Popover>
            </div>

            <div className="ml-auto hidden lg:flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleSearchShortcut}
                aria-label="Open search"
                title="Ctrl+K to search"
              >
                <Search className="h-5 w-5" />
              </Button>

              {accountUser ? (
                <Popover>
                  <PopoverTrigger
                    className="flex items-center justify-center rounded-full outline-hidden ring-offset-background focus-visible:ring-2 focus-visible:ring-primary/60"
                    aria-label={`${accountLabel} menu`}
                  >
                    {avatarUrl ? (
                      <DiscordAvatar avatarUrl={avatarUrl} alt="Account avatar" className="h-9 w-9 rounded-full" />
                    ) : (
                      <div className="h-9 w-9 rounded-full border border-border/60 flex items-center justify-center bg-card/70">
                        <UserRound className="h-5 w-5" />
                      </div>
                    )}
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-56 rounded-2xl p-2">
                    <div className="px-3 pb-2">
                      <div className="text-sm font-semibold text-foreground">{accountLabel}</div>
                      <div className="text-xs text-muted-foreground">Discord account</div>
                    </div>
                    {accountItems.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => openExternal(item.path)}
                        className="block w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:text-primary hover:bg-primary/10"
                      >
                        {item.label}
                      </button>
                    ))}
                    <div className="my-2 h-px bg-border/60" />
                    <button
                      type="button"
                      onClick={() => openExternal("/settings")}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-primary hover:bg-primary/10"
                    >
                      <Settings className="h-4 w-4" />
                      Settings
                    </button>
                    <button
                      type="button"
                      onClick={handleLogout}
                      disabled={loggingOut}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
                    >
                      <LogOut className="h-4 w-4" />
                      {loggingOut ? "Signing out..." : "Logout"}
                    </button>
                  </PopoverContent>
                </Popover>
              ) : showAccountLoading ? (
                <div className="h-9 w-9 rounded-full border border-border/60 flex items-center justify-center bg-card/70">
                  <UserRound className="h-5 w-5" />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleLogin}
                  className="inline-flex items-center rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-primary/20 disabled:opacity-60"
                  disabled={loggingIn}
                >
                  {loggingIn ? "Connecting..." : "Login with Discord"}
                </button>
              )}
            </div>

            <div className="ml-auto flex items-center gap-2 lg:hidden">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleSearchShortcut}
                aria-label="Open search"
              >
                <Search className="h-5 w-5" />
              </Button>
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Open menu">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-64">
                  <div className="flex flex-col gap-4 pt-6">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center">
                        <Hammer className="h-6 w-6 text-primary" />
                      </div>
                      <div>
                        <div className="text-base font-black font-montserrat">UnionCrax.Direct</div>
                        <div className="text-xs text-muted-foreground">Direct downloads</div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {accountUser ? (
                        <button
                          type="button"
                          onClick={() => {
                            openExternal("/account")
                            setMobileOpen(false)
                          }}
                          className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors text-foreground hover:bg-muted/40"
                        >
                          {avatarUrl ? (
                            <DiscordAvatar avatarUrl={avatarUrl} alt="Account avatar" className="h-9 w-9 rounded-full" />
                          ) : (
                            <div className="h-9 w-9 rounded-full border border-border/60 flex items-center justify-center bg-card/70">
                              <UserRound className="h-5 w-5" />
                            </div>
                          )}
                          <div>
                            <div className="text-sm font-semibold">{accountLabel}</div>
                            <div className="text-xs text-muted-foreground">Profile & requests</div>
                          </div>
                        </button>
                      ) : showAccountLoading ? (
                        <div className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted-foreground">
                          <div className="h-9 w-9 rounded-full border border-border/60 flex items-center justify-center bg-card/70">
                            <UserRound className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold">Loading account...</div>
                            <div className="text-xs text-muted-foreground">Please wait</div>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            handleLogin()
                            setMobileOpen(false)
                          }}
                          className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors text-foreground hover:bg-muted/40"
                        >
                          <div className="h-9 w-9 rounded-full border border-border/60 flex items-center justify-center bg-card/70">
                            <UserRound className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold">Login with Discord</div>
                            <div className="text-xs text-muted-foreground">Login to continue</div>
                          </div>
                        </button>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground px-1">UnionCrax</div>
                      {siteNavItems.map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => {
                            openExternal(item.path)
                            setMobileOpen(false)
                          }}
                          className="flex w-full cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-primary hover:bg-primary/10"
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground px-1">Direct</div>
                      {directNavItems.map((item) => (
                        <NavLink
                          key={item.label}
                          to={item.to}
                          onClick={() => setMobileOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center justify-between rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                              isActive
                                ? "bg-primary/15 text-primary"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                            }`
                          }
                        >
                          {item.label}
                        </NavLink>
                      ))}
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
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
