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
    setLoggingIn(true)
    try {
      if (window.ucAuth?.login) {
        const result = await window.ucAuth.login(getApiBaseUrl())
        if (result?.ok) {
          await apiFetch("/api/comments/session", { method: "POST" })
          await refresh().catch(() => {})
          await loadItems().catch(() => {})
        }
      } else {
        window.open(apiUrl("/api/discord/connect?next=/settings"), "_blank")
      }
    } finally {
      setLoggingIn(false)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadItems().catch(() => {})
    setRefreshing(false)
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-7xl px-3 sm:px-4 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground font-montserrat mb-1 sm:mb-2">View History</h1>
            <p className="text-sm sm:text-base text-muted-foreground">Quickly jump back to recently viewed games.</p>
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
          <Card className="border border-border/60 bg-card/40">
            <CardContent className="p-6 text-center space-y-3">
              <div className="inline-flex items-center justify-center rounded-full bg-primary/10 text-primary p-3">
                <Clock className="h-5 w-5" />
              </div>
              <div className="text-lg font-semibold">Login to see your view history</div>
              <p className="text-sm text-muted-foreground">Sign in to sync view history across devices.</p>
              <Button className="gap-2" onClick={handleLogin} disabled={loggingIn}>
                <LogIn className="h-4 w-4" />
                {loggingIn ? "Connecting..." : "Login with Discord"}
              </Button>
            </CardContent>
          </Card>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, idx) => (
              <GameCardSkeleton key={idx} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <Card className="border border-border/60 bg-card/40">
            <CardContent className="p-10 text-center text-muted-foreground">
              No view history yet.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((game) => (
              <div key={game.appid} className="space-y-2">
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <Clock className="h-3 w-3" />
                  Viewed {new Date(game.lastViewedAt).toLocaleDateString()}
                </div>
                <GameCard game={game} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
