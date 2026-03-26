import { useEffect, useMemo, useState, useCallback } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { SearchSuggestions } from "@/components/SearchSuggestions"
import { DiscordAvatar } from "@/components/DiscordAvatar"
import { useDiscordAccount } from "@/hooks/use-discord-account"
import { apiFetch, apiUrl, getApiBaseUrl } from "@/lib/api"
import { getRouteChrome } from "@/lib/navigation"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, Hammer, LogIn, LogOut, Menu, RotateCw, Search, Settings, UserRound } from "lucide-react"
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
        <nav className="sticky top-0 z-40 w-full border-b border-white/[.05] bg-zinc-950/80 backdrop-blur-xl">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 md:px-8 xl:px-10">
          {/* Mobile Menu Button */}
          <button
            type="button"
            aria-label="Open navigation"
            onClick={onOpenMenu}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[.07] bg-white/[0.04] text-zinc-400 transition hover:bg-white/[0.08] hover:text-white active:scale-95 md:hidden"
          >
            <Menu className="h-4.5 w-4.5" />
          </button>

          {/* Desktop Navigation Controls */}
          <div className="hidden items-center gap-1 md:flex">
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
              <RotateCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} strokeWidth={2.5} />
            </button>
          </div>

          {/* Separator */}
          <div className="hidden h-5 w-px bg-white/[.07] md:block" />

          {/* Page Title Section */}
          <div className="min-w-0 flex-1">
            <div className="md:hidden">
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-600">{chrome.eyebrow}</div>
              <div className="truncate text-sm font-semibold text-white">{chrome.title}</div>
            </div>
            <div className="hidden md:block">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-600">{chrome.eyebrow}</span>
                <span className="text-zinc-700">/</span>
                <span className="text-sm font-medium text-zinc-300">{chrome.title}</span>
              </div>
            </div>
          </div>

          {/* Search Button */}
          <Button
            type="button"
            variant="outline"
            onClick={handleSearchShortcut}
            className="hidden h-9 min-w-[200px] justify-between rounded-xl border-white/[.07] bg-zinc-900/80 px-3 text-zinc-500 hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-300 active:scale-[0.98] md:flex"
          >
            <span className="flex items-center gap-2">
              <Search className="h-3.5 w-3.5" />
              <span className="text-[13px]">Search...</span>
            </span>
            <kbd className="rounded-md border border-white/[.07] bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
              Ctrl+K
            </kbd>
          </Button>

          {/* Mobile Search */}
          <button
            type="button"
            onClick={handleSearchShortcut}
            aria-label="Open search"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[.07] bg-zinc-900/80 text-zinc-400 transition hover:bg-zinc-800 hover:text-white active:scale-95 md:hidden"
          >
            <Search className="h-4 w-4" />
          </button>

          {/* Account Menu */}
          {showAccountLoading ? (
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[.07] bg-zinc-900/80 text-zinc-600">
              <UserRound className="h-4 w-4" />
            </div>
          ) : (
            <Popover>
              <PopoverTrigger
                className="flex items-center justify-center rounded-xl border border-white/[.07] bg-zinc-900/80 p-0.5 outline-none transition hover:border-zinc-700 hover:bg-zinc-800 focus-visible:ring-1 focus-visible:ring-white/20 active:scale-95"
                aria-label={`${accountLabel} menu`}
              >
                {avatarUrl ? (
                  <DiscordAvatar
                    avatarUrl={avatarUrl}
                    alt="Account avatar"
                    className="h-8 w-8 rounded-lg"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800 text-zinc-500">
                    <UserRound className="h-4 w-4" />
                  </div>
                )}
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-56 rounded-xl border border-white/[.07] bg-zinc-900/95 p-1.5 shadow-2xl backdrop-blur-xl"
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
              </PopoverContent>
            </Popover>
          )}
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
