import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { apiFetch, apiUrl, getApiBaseUrl } from "@/lib/api"
import { useDiscordAccount } from "@/hooks/use-discord-account"
import { Clock, LogIn, RefreshCw, Trash2 } from "lucide-react"

interface SearchHistoryItem {
  term: string
  last_searched_at?: string
  lastSearchedAt?: string
}

export function SearchHistoryPage() {
  const navigate = useNavigate()
  const { user: accountUser, loading: accountLoading, refresh } = useDiscordAccount()
  const [items, setItems] = useState<SearchHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [clearing, setClearing] = useState(false)

  const loadItems = useCallback(async (retrySession = true) => {
    setError(null)
    setLoading(true)
    try {
      let res = await apiFetch("/api/search-history")
      if (res.status === 401 && retrySession) {
        const sessionRes = await apiFetch("/api/comments/session", { method: "POST" })
        if (sessionRes.ok) {
          res = await apiFetch("/api/search-history")
        }
      }
      if (!res.ok) {
        setError("Unable to load search history.")
        setItems([])
        return
      }
      const data = await res.json()
      setItems(Array.isArray(data?.items) ? data.items : [])
    } catch {
      setError("Unable to load search history.")
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

  const handleClear = async () => {
    setClearing(true)
    try {
      await apiFetch("/api/search-history", { method: "DELETE" })
      await loadItems(false).catch(() => {})
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-6xl px-3 sm:px-4 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground font-montserrat mb-1 sm:mb-2">Search History</h1>
            <p className="text-sm sm:text-base text-muted-foreground">Recent searches synced with your account.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate("/view-history")} className="gap-2">
              <Clock className="h-4 w-4" />
              View history
            </Button>
            <Button variant="outline" onClick={handleRefresh} disabled={refreshing} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="destructive" onClick={handleClear} disabled={clearing} className="gap-2">
              <Trash2 className="h-4 w-4" />
              {clearing ? "Clearing..." : "Clear"}
            </Button>
          </div>
        </div>

        {!accountUser && !accountLoading && (
          <Card className="border border-border/60 bg-card/40">
            <CardContent className="p-6 text-center space-y-3">
              <div className="inline-flex items-center justify-center rounded-full bg-primary/10 text-primary p-3">
                <Clock className="h-5 w-5" />
              </div>
              <div className="text-lg font-semibold">Login to see your search history</div>
              <p className="text-sm text-muted-foreground">Sign in to sync search history across devices.</p>
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
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="h-12 rounded-xl bg-muted/30" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <Card className="border border-border/60 bg-card/40">
            <CardContent className="p-10 text-center text-muted-foreground">
              No search history yet.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {items.map((item, index) => {
              const timestamp = item.lastSearchedAt || item.last_searched_at
              return (
                <Card key={`${item.term}-${index}`} className="border border-border/60 bg-card/40">
                  <CardContent className="flex items-center justify-between gap-4 p-4">
                    <div>
                      <div className="text-sm font-semibold text-foreground">{item.term}</div>
                      {timestamp ? (
                        <div className="text-xs text-muted-foreground">Searched {new Date(timestamp).toLocaleDateString()}</div>
                      ) : null}
                    </div>
                    <Button variant="outline" onClick={() => navigate(`/search?q=${encodeURIComponent(item.term)}`)}>
                      Search again
                    </Button>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
