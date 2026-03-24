import { useEffect, useMemo, useState } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { SearchSuggestions } from "@/components/SearchSuggestions"
import { DiscordAvatar } from "@/components/DiscordAvatar"
import { useDiscordAccount } from "@/hooks/use-discord-account"
import { apiFetch, apiUrl, getApiBaseUrl } from "@/lib/api"
import { getRouteChrome } from "@/lib/navigation"
import { Button } from "@/components/ui/button"
import { Hammer, LogIn, LogOut, Menu, Search, Settings, UserRound } from "lucide-react"

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
  const { user: accountUser, loading: accountLoading, refresh } = useDiscordAccount()
  const chrome = useMemo(() => getRouteChrome(location.pathname), [location.pathname])

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
        <nav className="sticky top-0 z-40 w-full border-b border-white/[.07] glass">
          <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 md:px-8 xl:px-10">
          <button
            type="button"
            aria-label="Open navigation"
            onClick={onOpenMenu}
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.045] text-zinc-300 transition hover:bg-white/[0.08] hover:text-white md:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={handleLogoNav}
            className="hidden items-center gap-3 md:flex"
          >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[.07] bg-white">
                <Hammer className="h-5 w-5 text-black" />
            </div>
            <div className="text-left">
              <div className="text-sm font-semibold uppercase tracking-[0.24em] text-zinc-500">{chrome.eyebrow}</div>
              <div className="font-brand text-xl leading-tight text-white">{chrome.title}</div>
            </div>
          </button>

          <div className="min-w-0 flex-1 md:ml-4">
            <div className="md:hidden">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500">{chrome.eyebrow}</div>
              <div className="truncate font-brand text-lg text-white">{chrome.title}</div>
            </div>
            <p className="hidden text-sm text-zinc-500 md:block">{chrome.description}</p>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={handleSearchShortcut}
            className="hidden h-10 min-w-[220px] justify-between rounded-full border-white/[.07] bg-zinc-800 px-4 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100 active:scale-95 md:flex"
          >
            <span className="flex items-center gap-2">
              <Search className="h-4 w-4" />
              Search games
            </span>
            <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] uppercase tracking-[0.16em] text-zinc-500">
              Ctrl+K
            </span>
          </Button>

          <button
            type="button"
            onClick={handleSearchShortcut}
            aria-label="Open search"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[.07] bg-zinc-800 text-zinc-300 transition hover:bg-zinc-700 hover:text-white active:scale-95 md:hidden"
          >
            <Search className="h-4.5 w-4.5" />
          </button>

          {showAccountLoading ? (
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[.07] bg-zinc-800 text-zinc-500">
              <UserRound className="h-4 w-4" />
            </div>
          ) : (
            <Popover>
              <PopoverTrigger
                className="flex items-center justify-center rounded-full border border-white/[.07] bg-zinc-800 p-1 outline-none transition hover:bg-zinc-700 focus-visible:ring-1 focus-visible:ring-white/20 active:scale-95"
                aria-label={`${accountLabel} menu`}
              >
                {avatarUrl ? (
                  <DiscordAvatar
                    avatarUrl={avatarUrl}
                    alt="Account avatar"
                    className="h-9 w-9 rounded-full border border-white/20"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-700 text-zinc-400">
                    <UserRound className="h-4 w-4" />
                  </div>
                )}
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-60 rounded-2xl glass p-2 shadow-2xl"
              >
                <div className="px-3 py-2">
                  <div className="text-sm font-semibold text-zinc-100">{accountLabel}</div>
                  <div className="text-xs text-zinc-500">{accountSubtitle}</div>
                </div>
                <div className="my-1 h-px bg-white/8" />
                <button
                  type="button"
                  onClick={() => navigate("/settings")}
                  className="flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-sm text-zinc-300 transition hover:bg-white/[0.05] hover:text-white"
                >
                  <Settings className="h-4 w-4" />
                  Open settings
                </button>
                <button
                  type="button"
                  onClick={accountUser ? handleLogout : handleLogin}
                  disabled={accountUser ? loggingOut : loggingIn}
                  className={`mt-1 flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-sm transition disabled:opacity-40 ${
                    accountUser
                      ? "text-zinc-400 hover:bg-red-500/10 hover:text-red-300"
                      : "text-zinc-300 hover:bg-white/[0.05] hover:text-white"
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
