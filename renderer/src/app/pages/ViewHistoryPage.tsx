import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { GameCard } from "@/components/GameCard"
import { GameCardSkeleton } from "@/components/GameCardSkeleton"
import { apiFetch, apiUrl, getApiBaseUrl } from "@/lib/api"
import { useDiscordAccount } from "@/hooks/use-discord-account"
import { Clock, LogIn, RefreshCw } from "lucide-react"

interface HistoryItem {
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
  lastViewedAt: string
}

export function ViewHistoryPage() {
  const navigate = useNavigate()
  const { user: accountUser, loading: accountLoading, refresh } = useDiscordAccount()
  const [items, setItems] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const loadItems = useCallback(async (retrySession = true) => {
    setError(null)
    setLoading(true)
    try {
      let res = await apiFetch("/api/view-history")
      if (res.status === 401 && retrySession) {
        const sessionRes = await apiFetch("/api/comments/session", { method: "POST" })
        if (sessionRes.ok) {
          res = await apiFetch("/api/view-history")
        }
      }
      if (res.status === 401) {
        // Not logged in — the login prompt is the empty state. Don't double up with an error banner.
        setItems([])
        return
      }
      if (!res.ok) {
        setError("Unable to load view history.")
        setItems([])
        return
      }
      const data = await res.json()
      setItems(Array.isArray(data?.items) ? data.items : [])
    } catch {
      setError("Unable to load view history.")
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  const handleLogin = async () => {
    navigate("/login")
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadItems().catch(() => {})
    setRefreshing(false)
  }

  return (
    <div className="min-h-screen bg-[#09090b]">
      <div className="container mx-auto max-w-7xl px-3 sm:px-4 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-zinc-100  mb-1 sm:mb-2">View History</h1>
            <p className="text-sm sm:text-base text-zinc-400">Quickly jump back to recently viewed games.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate("/search-history")} className="gap-2">
              <Clock className="h-4 w-4" />
              Search history
            </Button>
            <Button variant="outline" onClick={handleRefresh} disabled={refreshing} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {!accountUser && !accountLoading && (
          <Card className="border border-white/[.07] bg-zinc-900/40">
            <CardContent className="p-6 text-center space-y-3">
              <div className="inline-flex items-center justify-center rounded-full bg-white/10 text-white p-3">
                <Clock className="h-5 w-5" />
              </div>
              <div className="text-lg font-semibold">Login to see your view history</div>
              <p className="text-sm text-zinc-400">Sign in to sync view history across devices.</p>
              <Button className="gap-2" onClick={handleLogin} disabled={loggingIn}>
                <LogIn className="h-4 w-4" />
                {loggingIn ? "Connecting..." : "Sign In"}
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
        ) : items.length === 0 ? (
          <Card className="border border-white/[.07] bg-zinc-900/40">
            <CardContent className="p-10 text-center text-zinc-400">
              No view history yet.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {items.map((game) => (
              <div key={game.appid} className="space-y-2">
                <GameCard game={game} />
                <div className="text-[11px] text-zinc-500 flex items-center gap-1.5 px-1">
                  <Clock className="h-3 w-3" />
                  {new Date(game.lastViewedAt).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

