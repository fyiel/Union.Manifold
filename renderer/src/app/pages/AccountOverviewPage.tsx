import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { MyRequests } from "@/components/MyRequests"
import { apiFetch, apiUrl, getApiBaseUrl } from "@/lib/api"
import { useDiscordAccount } from "@/hooks/use-discord-account"
import { LogIn, MessageCircle, RefreshCw, Shield, Star, Heart, Clock } from "lucide-react"


type RecentComment = {
  id: string
  appid: string
  body: string
  createdAt: string
  gameName: string | null
}

export function AccountOverviewPage() {
  const navigate = useNavigate()
  const { user: accountUser, loading: accountLoading, authenticated, refresh } = useDiscordAccount()
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [summary, setSummary] = useState<any | null>(null)
  const [recentComments, setRecentComments] = useState<RecentComment[]>([])
  const [recentLoading, setRecentLoading] = useState(false)
  const [recentError, setRecentError] = useState<string | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const hasSession = Boolean(accountUser && authenticated)

  const loadSummary = useCallback(async (retrySession = true) => {
    setSummaryError(null)
    setSummaryLoading(true)
    try {
      let res = await apiFetch("/api/account/summary")
      if (res.status === 401 && retrySession) {
        const sessionRes = await apiFetch("/api/comments/session", { method: "POST" })
        if (sessionRes.ok) {
          res = await apiFetch("/api/account/summary")
        }
      }
      if (!res.ok) {
        setSummaryError("Unable to load account overview.")
        setSummary(null)
        return
      }
      const data = await res.json()
      setSummary(data)
    } catch {
      setSummaryError("Unable to load account overview.")
      setSummary(null)
    } finally {
      setSummaryLoading(false)
    }
  }, [])

  const loadRecentComments = useCallback(async (retrySession = true) => {
    setRecentError(null)
    setRecentLoading(true)
    try {
      let res = await apiFetch("/api/comments/recent")
      if (res.status === 401 && retrySession) {
        const sessionRes = await apiFetch("/api/comments/session", { method: "POST" })
        if (sessionRes.ok) {
          res = await apiFetch("/api/comments/recent")
        }
      }
      if (!res.ok) {
        setRecentError("Unable to load recent activity.")
        setRecentComments([])
        return
      }
      const data = await res.json()
      setRecentComments(Array.isArray(data?.comments) ? data.comments : [])
    } catch {
      setRecentError("Unable to load recent activity.")
      setRecentComments([])
    } finally {
      setRecentLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!accountUser || !authenticated) return
    void loadSummary()
    void loadRecentComments()
  }, [accountUser, authenticated, loadSummary, loadRecentComments])

  useEffect(() => {
    if (hasSession) return
    setSummary(null)
    setSummaryError(null)
    setRecentComments([])
    setRecentError(null)
  }, [hasSession])

  const handleLogin = async () => {
    setLoggingIn(true)
    try {
      if (window.ucAuth?.login) {
        const result = await window.ucAuth.login(getApiBaseUrl())
        if (result?.ok) {
          await apiFetch("/api/comments/session", { method: "POST" })
          await refresh().catch(() => {})
          await loadSummary().catch(() => {})
          await loadRecentComments().catch(() => {})
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
    await refresh().catch(() => {})
    await loadSummary().catch(() => {})
    await loadRecentComments().catch(() => {})
    setRefreshing(false)
  }


  const overviewStats = useMemo(() => {
    const wishlist = Array.isArray(summary?.wishlist) ? summary.wishlist.length : 0
    const favorites = Array.isArray(summary?.favorites) ? summary.favorites.length : 0
    const viewHistory = Array.isArray(summary?.viewHistory) ? summary.viewHistory.length : 0
    const searchHistory = Array.isArray(summary?.searchHistory) ? summary.searchHistory.length : 0
    return { wishlist, favorites, viewHistory, searchHistory }
  }, [summary])

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-10 sm:py-12 md:py-14 max-w-6xl">
        <div className="text-center mb-12">
          <div className="flex justify-center mb-6">
            <div className="p-4 sm:p-6 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 shadow-lg shadow-primary/10">
              <Shield className="h-12 w-12 sm:h-14 sm:w-14 text-primary" />
            </div>
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-black text-foreground mb-4 font-montserrat">My Profile</h1>
          <p className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
            Track your account activity and stay on top of what you care about.
          </p>
        </div>

        {!hasSession && !accountLoading && (
          <Card className="border-2 border-border/50 shadow-xl bg-card/60 backdrop-blur-sm rounded-2xl">
            <CardContent className="py-12 text-center space-y-4">
              <p className="text-lg font-semibold text-foreground">Login to continue.</p>
              <p className="text-sm text-muted-foreground">
                Sign in to see your saved lists and recent activity.
              </p>
              <Button className="w-full md:w-auto" onClick={handleLogin} disabled={loggingIn}>
                <LogIn className="h-4 w-4 mr-2" />
                {loggingIn ? "Connecting..." : "Login with Discord"}
              </Button>
            </CardContent>
          </Card>
        )}

        {hasSession && (
          <div className="space-y-8">
            <Card className="border-2 border-border/50 shadow-xl bg-card/60 backdrop-blur-sm rounded-2xl">
              <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <CardTitle className="text-xl font-bold flex items-center gap-2">
                  <MessageCircle className="h-5 w-5 text-primary" />
                  Recent Activity
                </CardTitle>
                <Button variant="outline" className="gap-2" onClick={handleRefresh} disabled={refreshing}>
                  <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                  {refreshing ? "Refreshing..." : "Refresh"}
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {summaryError && (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {summaryError}
                  </div>
                )}
                {summaryLoading || recentLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, index) => (
                      <Skeleton key={index} className="h-20 w-full rounded-2xl" />
                    ))}
                  </div>
                ) : recentError ? (
                  <p className="text-sm text-muted-foreground">{recentError}</p>
                ) : recentComments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recent comments yet.</p>
                ) : (
                  <div className="space-y-3">
                    {recentComments.map((comment) => (
                      <div key={comment.id} className="rounded-xl border border-border/60 bg-muted/20 p-4">
                        <p className="text-sm text-muted-foreground">
                          {comment.gameName ? (
                            <Button
                              variant="link"
                              className="px-0 text-primary"
                              onClick={() => navigate(`/game/${comment.appid}`)}
                            >
                              {comment.gameName}
                            </Button>
                          ) : (
                            <Button
                              variant="link"
                              className="px-0 text-primary"
                              onClick={() => navigate(`/game/${comment.appid}`)}
                            >
                              View game
                            </Button>
                          )}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {new Date(comment.createdAt).toLocaleDateString()}
                          </span>
                        </p>
                        <p className="text-sm text-foreground mt-2 line-clamp-3">{comment.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-2 border-border/50 shadow-xl bg-card/60 backdrop-blur-sm rounded-2xl">
              <CardHeader>
                <CardTitle className="text-xl font-bold">Your Lists</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Star className="h-4 w-4 text-primary" />
                    <p className="text-sm font-semibold">Wishlist</p>
                  </div>
                  <p className="text-2xl font-bold">{overviewStats.wishlist}</p>
                  <Button variant="outline" className="gap-2" onClick={() => navigate("/wishlist")}>View wishlist</Button>
                </div>
                <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Heart className="h-4 w-4 text-primary" />
                    <p className="text-sm font-semibold">Liked</p>
                  </div>
                  <p className="text-2xl font-bold">{overviewStats.favorites}</p>
                  <Button variant="outline" className="gap-2" onClick={() => navigate("/liked")}>View liked</Button>
                </div>
                <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-primary" />
                    <p className="text-sm font-semibold">View history</p>
                  </div>
                  <p className="text-2xl font-bold">{overviewStats.viewHistory}</p>
                  <Button variant="outline" className="gap-2" onClick={() => navigate("/view-history")}>View history</Button>
                </div>
                <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-primary" />
                    <p className="text-sm font-semibold">Search history</p>
                  </div>
                  <p className="text-2xl font-bold">{overviewStats.searchHistory}</p>
                  <Button variant="outline" className="gap-2" onClick={() => navigate("/search-history")}>View searches</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <div className="mt-8">
          {accountLoading ? (
            <Card className="border-2 border-border/50 shadow-xl bg-card/60 backdrop-blur-sm rounded-2xl">
              <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-9 w-32" />
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <Skeleton className="h-44 w-full rounded-2xl" />
                  <Skeleton className="h-44 w-full rounded-2xl" />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Skeleton className="h-44 w-full rounded-2xl" />
                  <Skeleton className="h-44 w-full rounded-2xl" />
                </div>
              </CardContent>
            </Card>
          ) : hasSession ? (
            <MyRequests title="Your Requests" showUnauthedHelp={false} />
          ) : (
            <MyRequests title="Your Requests" showUnauthedHelp match="ip" />
          )}
        </div>
      </div>
    </div>
  )
}
