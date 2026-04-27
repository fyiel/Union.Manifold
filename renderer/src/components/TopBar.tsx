import { useEffect, useMemo, useState, useCallback } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { SearchSuggestions } from "@/components/SearchSuggestions"
import { DiscordAvatar } from "@/components/DiscordAvatar"
import { LoadingAnimated, LogoStaticDark } from "@/components/brand/brand-assets"
import { useDiscordAccount } from "@/hooks/use-discord-account"
import { apiFetch, apiUrl, getApiBaseUrl } from "@/lib/api"
import { getRouteChrome } from "@/lib/navigation"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, LogIn, LogOut, Mail, Menu, RotateCw, Search, Settings, UserRound } from "lucide-react"
import { cn } from "@/lib/utils"

interface TopBarProps {
  onOpenMenu: () => void
}

export function TopBar({ onOpenMenu }: TopBarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const initialQuery = useMemo(() => searchParams.get("q") || "", [searchParams])
  const [globalSearch, setGlobalSearch] = useState(initialQuery)
  const [loggingOut, setLoggingOut] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const { user: accountUser, loading: accountLoading, refresh } = useDiscordAccount()
  const chrome = useMemo(() => getRouteChrome(location.pathname), [location.pathname])

  // Back is only available after the first navigation (location.key is "default" on initial load)
  const canGoBack = location.key !== "default"

  const handleBack = useCallback(() => {
    navigate(-1)
  }, [navigate])

  const handleForward = useCallback(() => {
    navigate(1)
  }, [navigate])

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true)
    window.location.reload()
    setTimeout(() => setIsRefreshing(false), 1000)
  }, [])

  useEffect(() => {
    if (location.pathname.startsWith("/search")) {
      setGlobalSearch(initialQuery)
    }
  }, [initialQuery, location.pathname])


  const handleSearchShortcut = () => {
    if (typeof window === "undefined") return
    window.dispatchEvent(new Event("uc_open_search_popup"))
  }

  const handleLogoNav = () => {
    if (typeof window === "undefined") return
    if (location.pathname === "/") {
      window.dispatchEvent(new Event("uc_home_hero"))
      return
    }
    navigate("/")
    window.setTimeout(() => window.dispatchEvent(new Event("uc_home_hero")), 80)
  }

  const accountLabel = accountUser ? accountUser.displayName || accountUser.username : "Account"
  const avatarUrl = accountUser?.avatarUrl
  const showAccountLoading = accountLoading
  const accountSubtitle = accountUser ? "Discord account" : "Login to continue"
  const accountActionLabel = accountUser
    ? (loggingOut ? "Signing out..." : "Logout")
    : (loggingIn ? "Connecting..." : "Log in")

  const handleLogin = async () => {
    navigate("/login")
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
      <div className="pointer-events-auto px-4 pb-3 pt-3 md:px-8 xl:px-10">
        <nav className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 rounded-full border border-white/[.12] bg-zinc-950/68 px-2 py-2 shadow-[0_8px_30px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
          {/* Mobile Menu Button */}
          <button
            type="button"
            aria-label="Open navigation"
            onClick={onOpenMenu}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[.10] bg-white/[0.04] text-zinc-400 transition hover:bg-white/[0.08] hover:text-white active:scale-95 md:hidden"
          >
            <Menu className="h-4.5 w-4.5" />
          </button>

          <button
            type="button"
            onClick={handleLogoNav}
            aria-label="Go to home"
            className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-black shadow-md transition-all hover:scale-[1.03] hover:bg-zinc-200 active:scale-95 md:flex"
          >
            <LogoStaticDark className="h-4.5 w-4.5" />
          </button>

          {/* Desktop Navigation Controls */}
          <div className="hidden h-5 w-px bg-white/[.08] md:block" />

          <div className="hidden items-center gap-1 md:flex">
            <button
              type="button"
              onClick={handleBack}
              disabled={!canGoBack}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-full transition-all active:scale-95",
                canGoBack
                  ? "text-zinc-400 hover:bg-white/[.08] hover:text-zinc-100"
                  : "cursor-default text-zinc-700"
              )}
              aria-label="Go back"
            >
              <ChevronLeft className="h-4.5 w-4.5" strokeWidth={2.5} />
            </button>
            <button
              type="button"
              onClick={handleForward}
              className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-700 transition-all hover:bg-white/[.08] hover:text-zinc-300 active:scale-95"
              aria-label="Go forward"
            >
              <ChevronRight className="h-4.5 w-4.5" strokeWidth={2.5} />
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-600 transition-all hover:bg-white/[.08] hover:text-zinc-200 active:scale-95"
              aria-label="Refresh"
            >
              <RotateCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} strokeWidth={2.5} />
            </button>
          </div>

          {/* Page Title Section */}
          <div className="min-w-0 flex-1 md:px-2">
            <div className="md:hidden">
              <div className="truncate text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">{chrome.eyebrow}</div>
              <div className="truncate text-sm font-semibold text-zinc-100">{chrome.title}</div>
            </div>
            <div className="hidden md:flex md:justify-center">
              <div className="flex min-w-0 max-w-full items-center gap-2 rounded-full border border-white/[.06] bg-white/[.03] px-4 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">{chrome.eyebrow}</span>
                <span className="text-zinc-700">/</span>
                <span className="truncate text-sm font-semibold text-zinc-100">{chrome.title}</span>
              </div>
            </div>
          </div>

          {/* Search Button */}
          <Button
            type="button"
            variant="outline"
            onClick={handleSearchShortcut}
            className="hidden h-9 min-w-[220px] justify-between rounded-full border border-white/[.10] bg-black/20 px-4 text-zinc-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-xl hover:border-white/[.14] hover:bg-white/[.06] hover:text-zinc-100 active:scale-[0.98] md:flex"
          >
            <span className="flex items-center gap-2">
              <Search className="h-3.5 w-3.5" />
              <span className="text-[13px]">Search...</span>
            </span>
            <kbd className="rounded-full border border-white/[.08] bg-white/[.03] px-2 py-0.5 text-[10px] font-medium text-zinc-500">
              Ctrl+K
            </kbd>
          </Button>

          {/* Mobile Search */}
          <button
            type="button"
            onClick={handleSearchShortcut}
            aria-label="Open search"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[.10] bg-white/[0.04] text-zinc-400 transition hover:bg-white/[0.08] hover:text-white active:scale-95 md:hidden"
          >
            <Search className="h-4 w-4" />
          </button>

          {/* Account Menu */}
          {showAccountLoading ? (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[.10] bg-white/[0.04] text-zinc-600">
              <LoadingAnimated className="h-4 w-4 opacity-70" />
            </div>
          ) : (
            <Popover>
              <PopoverTrigger
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[.10] bg-white/[0.04] p-0.5 outline-none transition hover:border-white/[.16] hover:bg-white/[0.08] focus-visible:ring-1 focus-visible:ring-white/20 active:scale-95"
                aria-label={`${accountLabel} menu`}
              >
                {avatarUrl ? (
                  <DiscordAvatar
                    avatarUrl={avatarUrl}
                    alt="Account avatar"
                    className="h-8 w-8 rounded-full"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-zinc-500">
                    <UserRound className="h-4 w-4" />
                  </div>
                )}
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-56 rounded-[1.5rem] border border-white/[.10] bg-zinc-950/88 p-1.5 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
              >
                <div className="px-3 py-2">
                  <div className="text-sm font-semibold text-zinc-100">{accountLabel}</div>
                  <div className="text-[11px] text-zinc-500">{accountSubtitle}</div>
                </div>
                <div className="my-1 h-px bg-white/[.05]" />
                <button
                  type="button"
                  onClick={() => navigate("/settings")}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-zinc-400 transition hover:bg-white/[0.05] hover:text-white"
                >
                  <Settings className="h-4 w-4" />
                  Settings
                </button>
                <button
                  type="button"
                  onClick={accountUser ? handleLogout : handleLogin}
                  disabled={accountUser ? loggingOut : loggingIn}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition disabled:opacity-40 ${
                    accountUser
                      ? "text-zinc-500 hover:bg-red-500/10 hover:text-red-400"
                      : "text-zinc-400 hover:bg-white/[0.05] hover:text-white"
                  }`}
                >
                  {accountUser ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
                  {accountActionLabel}
                </button>
                {!accountUser && (
                  <button
                    type="button"
                    onClick={() => navigate("/login")}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-zinc-400 transition hover:bg-white/[0.05] hover:text-white"
                  >
                    <Mail className="h-4 w-4" />
                    More sign-in options
                  </button>
                )}
              </PopoverContent>
            </Popover>
          )}
        </nav>
      </div>
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
        enableShortcut={false}
        showShortcutHint
        openEventName="uc_open_search_popup"
        hideInputWhenClosed
        closeOnSubmit
      />
    </>
  )
}
