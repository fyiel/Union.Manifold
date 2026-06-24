import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { GameCard } from "@/components/GameCard"
import { PageAura } from "@/components/page-aura"
import { GameCardSkeleton } from "@/components/GameCardSkeleton"
import { apiFetch } from "@/lib/api"
import { useDiscordAccount } from "@/hooks/use-discord-account"
import { cn } from "@/lib/utils"
import {
  LIBRARY_STATUS_ORDER,
  LIBRARY_STATUS_LABELS,
  type LibraryStatus,
  type LibraryCounts,
} from "@/lib/account-lists"
import { RefreshCw } from "lucide-react"
import { Heart, LogIn } from "@/components/icons"
import { EmptyState } from "@/components/EmptyState"

interface Game {
  appid: string
  name: string
  description: string
  genres: string[]
  image: string
  release_date: string
  size: string
  source: string
  version?: string
  update_time?: string
  developer?: string
  hasCoOp?: boolean
  status: LibraryStatus
}

type TabKey = "all" | LibraryStatus

function isStatus(v: string | null): v is LibraryStatus {
  return !!v && (LIBRARY_STATUS_ORDER as string[]).includes(v)
}

/**
 * Unified game library ("MyAnimeList, but for games"). Replaces the old
 * standalone Liked + Wishlist pages: a single view with per-status tabs and
 * counts, backed by /api/account/library.
 */
export function LikedPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user: accountUser, loading: accountLoading } = useDiscordAccount()
  const [items, setItems] = useState<Game[]>([])
  const [counts, setCounts] = useState<LibraryCounts | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loggingIn] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const statusParam = searchParams.get("status")
  const activeTab: TabKey = isStatus(statusParam) ? statusParam : "all"

  const loadItems = useCallback(async (retrySession = true) => {
    setError(null)
    setLoading(true)
    try {
      let res = await apiFetch("/api/account/library")
      if (res.status === 401 && retrySession) {
        const sessionRes = await apiFetch("/api/comments/session", { method: "POST" })
        if (sessionRes.ok) res = await apiFetch("/api/account/library")
      }
      if (res.status === 401) {
        setItems([])
        setCounts(null)
        return
      }
      if (!res.ok) {
        setError("Unable to load your library.")
        setItems([])
        return
      }
      const data = await res.json()
      setItems(Array.isArray(data?.items) ? data.items : [])
      setCounts(data?.counts ?? null)
    } catch {
      setError("Unable to load your library.")
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadItems().catch(() => {})
    setRefreshing(false)
  }

  const filtered = useMemo(
    () => (activeTab === "all" ? items : items.filter((g) => g.status === activeTab)),
    [items, activeTab],
  )

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "all", label: "All" },
    ...LIBRARY_STATUS_ORDER.map((s) => ({ key: s, label: LIBRARY_STATUS_LABELS[s] })),
  ]

  const countFor = (key: TabKey) =>
    key === "all" ? counts?.total ?? items.length : counts?.[key] ?? 0

  const selectTab = (key: TabKey) => {
    const next = new URLSearchParams(searchParams)
    if (key === "all") next.delete("status")
    else next.set("status", key)
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="relative space-y-6 sm:space-y-8">
      <PageAura />
      <div className="relative z-10">
        <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-1 sm:mb-2">Library</h1>
            <p className="text-sm sm:text-base text-muted-foreground">
              Track what you're playing, planning, and have finished.
            </p>
          </div>
          <Button variant="outline" onClick={handleRefresh} disabled={refreshing} className="flex items-center gap-2 self-start">
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {accountUser && (
          <div className="mb-6 flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => selectTab(tab.key)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                  activeTab === tab.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-white/[.04] text-muted-foreground hover:bg-white/[.08] hover:text-foreground",
                )}
              >
                <span>{tab.label}</span>
                <span className={cn("rounded-full px-1.5 text-xs tabular-nums", activeTab === tab.key ? "bg-black/20" : "bg-black/30")}>
                  {countFor(tab.key)}
                </span>
              </button>
            ))}
          </div>
        )}

        {!accountUser && !accountLoading && (
          <Card className="border border-white/[.07] bg-card/40">
            <CardContent className="p-6 text-center space-y-3">
              <div className="inline-flex items-center justify-center rounded-full bg-white/10 text-white p-3">
                <Heart className="h-5 w-5" />
              </div>
              <div className="text-lg font-semibold">Login to see your library</div>
              <p className="text-sm text-muted-foreground">Sign in to sync your library across devices.</p>
              <Button className="gap-2" onClick={() => navigate("/login")} disabled={loggingIn}>
                <LogIn className="h-4 w-4" />
                {loggingIn ? "Redirecting..." : "Sign In"}
              </Button>
            </CardContent>
          </Card>
        )}

        {error && accountUser && (
          <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {!accountUser && !accountLoading ? null : loading || accountLoading ? (
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, idx) => (
              <GameCardSkeleton key={idx} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Heart}
            title={activeTab === "all" ? "Your library is empty" : `Nothing marked "${LIBRARY_STATUS_LABELS[activeTab as LibraryStatus]}"`}
            description="Open any game and pick a status to start tracking it here."
            action={(
              <Button onClick={() => navigate("/search")}>Find games</Button>
            )}
            hint="Tip: use the library status dropdown on a game page."
          />
        ) : (
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filtered.map((game) => (
              <GameCard key={game.appid} game={game} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
