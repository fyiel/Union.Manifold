import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { MyRequests } from "@/components/MyRequests"
import { apiFetch, apiUrl, getApiBaseUrl } from "@/lib/api"
import { useAuth } from "@/hooks/useAuth"
import { LogIn, MessageCircle, RefreshCw, Star, Heart, Clock, LogOut, Link2, Unlink, Loader2 } from "lucide-react"


type RecentComment = {
  id: string
  appid: string
  body: string
  createdAt: string
  gameName: string | null
}

export function AccountOverviewPage() {
  const navigate = useNavigate()
  const [authState, authActions] = useAuth()
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [summary, setSummary] = useState<any | null>(null)
  const [recentComments, setRecentComments] = useState<RecentComment[]>([])
  const [recentLoading, setRecentLoading] = useState(false)
  const [recentError, setRecentError] = useState<string | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [linkingProvider, setLinkingProvider] = useState<string | null>(null)
  const [unlinkingProvider, setUnlinkingProvider] = useState<string | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)
  
  const hasSession = authState.isAuthenticated && authState.user !== null
  const linkedProviders = authState.linkedProviders || []

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
    if (!authState.user || !authState.isAuthenticated) return
    void loadSummary()
    void loadRecentComments()
  }, [authState.user, authState.isAuthenticated, loadSummary, loadRecentComments])

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
      await authActions.loginWithOAuth("discord")
      await loadSummary().catch(() => {})
      await loadRecentComments().catch(() => {})
    } catch (err) {
      // Error already handled by authActions
    } finally {
      setLoggingIn(false)
    }
  }

  const handleLinkProvider = async (provider: "discord" | "google") => {
    setLinkingProvider(provider)
    try {
      await authActions.linkProvider(provider)
      await loadSummary().catch(() => {})
    } catch (err) {
      // Error already handled
    } finally {
      setLinkingProvider(null)
    }
  }

  const handleUnlinkProvider = async (provider: "discord" | "google") => {
    setUnlinkingProvider(provider)
    try {
      await authActions.unlinkProvider(provider)
    } catch (err) {
      // Error already handled
    } finally {
      setUnlinkingProvider(null)
    }
  }

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      await authActions.logout()
      navigate("/login", { replace: true })
    } catch (err) {
      // Error already handled
    } finally {
      setLoggingOut(false)
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
    <div className="min-h-screen bg-[#09090b]">
      <div className="container mx-auto px-4 py-10 sm:py-12 md:py-14 max-w-6xl">
        <div className="mb-10 anim">
          <p className="section-label mb-2">Account</p>
          <h1 className="text-4xl sm:text-5xl font-light tracking-tight text-zinc-100">My Profile</h1>
          <p className="mt-3 text-base text-zinc-400">
            Track your account activity and stay on top of what you care about.
          </p>
        </div>

        {!hasSession && !accountLoading && (
          <Card className="glass rounded-2xl">
            <CardContent className="py-12 text-center space-y-4">
              <p className="text-lg font-semibold text-zinc-100">Login to continue.</p>
              <p className="text-sm text-zinc-400">
                Sign in to see your saved lists and recent activity.
              </p>
              <Button className="w-full md:w-auto" onClick={handleLogin} disabled={loggingIn}>
                <LogIn className="h-4 w-4 mr-2" />
                {loggingIn ? "Connecting..." : "Login with Discord"}
              </Button>
            </CardContent>
          </Card>
        )}

        {hasSession && authState.isLoading ? (
          <div className="space-y-8">
            <Card className="glass rounded-2xl">
              <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-9 w-32" />
              </CardHeader>
              <CardContent><Skeleton className="h-32 w-full rounded-lg" /></CardContent>
            </Card>
          </div>
        ) : null}

        {hasSession && !authState.isLoading && (
          <div className="space-y-8">
            {/* Account Info & Provider Management */}
            <Card className="glass rounded-2xl anim anim-d0">
              <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="section-label mb-1">Account</p>
                  <CardTitle className="text-xl font-light tracking-tight">
                    {authState.user?.displayName || authState.user?.username || "Your Account"}
                  </CardTitle>
                </div>
                <Button
                  variant="destructive"
                  className="gap-2"
                  onClick={handleLogout}
                  disabled={loggingOut}
                >
                  <LogOut className="h-4 w-4" />
                  {loggingOut ? "Logging out..." : "Logout"}
                </Button>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* User Info */}
                <div className="grid gap-4 md:grid-cols-2">
                  {authState.user?.email && (
                    <div className="rounded-lg border border-white/[.07] bg-zinc-800/20 p-4">
                      <p className="text-xs font-semibold text-zinc-400 mb-1">Email</p>
                      <p className="text-sm text-zinc-100 break-all">{authState.user.email}</p>
                    </div>
                  )}
                  {authState.user?.username && (
                    <div className="rounded-lg border border-white/[.07] bg-zinc-800/20 p-4">
                      <p className="text-xs font-semibold text-zinc-400 mb-1">Username</p>
                      <p className="text-sm text-zinc-100">{authState.user.username}</p>
                    </div>
                  )}
                </div>

                {/* Linked Providers */}
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-zinc-300">Linked Accounts</p>
                  <div className="grid gap-2 md:grid-cols-2">
                    {/* Discord */}
                    <div className="rounded-lg border border-white/[.07] bg-zinc-800/20 p-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-indigo-500" />
                        <span className="text-sm text-zinc-300">Discord</span>
                      </div>
                      {linkedProviders.some((p) => p.provider === "discord") ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleUnlinkProvider("discord")}
                          disabled={unlinkingProvider === "discord" || linkedProviders.length === 1}
                        >
                          {unlinkingProvider === "discord" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Unlink className="h-4 w-4" />
                          )}
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleLinkProvider("discord")}
                          disabled={linkingProvider === "discord"}
                        >
                          {linkingProvider === "discord" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Link2 className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                    </div>

                    {/* Google */}
                    <div className="rounded-lg border border-white/[.07] bg-zinc-800/20 p-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-red-500" />
                        <span className="text-sm text-zinc-300">Google</span>
                      </div>
                      {linkedProviders.some((p) => p.provider === "google") ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleUnlinkProvider("google")}
                          disabled={unlinkingProvider === "google" || linkedProviders.length === 1}
                        >
                          {unlinkingProvider === "google" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Unlink className="h-4 w-4" />
                          )}
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleLinkProvider("google")}
                          disabled={linkingProvider === "google"}
                        >
                          {linkingProvider === "google" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Link2 className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-zinc-500 mt-2">
                    You need at least one account linked. Link multiple providers for easier access.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="glass rounded-2xl anim anim-d1">
              <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="section-label mb-1">Activity</p>
                  <CardTitle className="text-xl font-light tracking-tight">
                    Recent Activity
                  </CardTitle>
                </div>
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
                  <p className="text-sm text-zinc-400">{recentError}</p>
                ) : recentComments.length === 0 ? (
                  <p className="text-sm text-zinc-400">No recent comments yet.</p>
                ) : (
                  <div className="space-y-3">
                    {recentComments.map((comment) => (
                      <div key={comment.id} className="rounded-xl border border-white/[.07] bg-zinc-800/20 p-4">
                        <p className="text-sm text-zinc-400">
                          {comment.gameName ? (
                            <Button
                              variant="link"
                              className="px-0 text-white"
                              onClick={() => navigate(`/game/${comment.appid}`)}
                            >
                              {comment.gameName}
                            </Button>
                          ) : (
                            <Button
                              variant="link"
                              className="px-0 text-white"
                              onClick={() => navigate(`/game/${comment.appid}`)}
                            >
                              View game
                            </Button>
                          )}
                          <span className="ml-2 text-xs text-zinc-400">
                            {new Date(comment.createdAt).toLocaleDateString()}
                          </span>
                        </p>
                        <p className="text-sm text-zinc-100 mt-2 line-clamp-3">{comment.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="glass rounded-2xl anim anim-d2">
              <CardHeader>
                <p className="section-label mb-1">Overview</p>
                <CardTitle className="text-xl font-light tracking-tight">Your Lists</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-white/[.07] bg-zinc-800/20 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Star className="h-4 w-4 text-white" />
                    <p className="text-sm font-semibold">Wishlist</p>
                  </div>
                  <p className="text-2xl font-bold">{overviewStats.wishlist}</p>
                  <Button variant="outline" className="gap-2" onClick={() => navigate("/wishlist")}>View wishlist</Button>
                </div>
                <div className="rounded-xl border border-white/[.07] bg-zinc-800/20 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Heart className="h-4 w-4 text-white" />
                    <p className="text-sm font-semibold">Liked</p>
                  </div>
                  <p className="text-2xl font-bold">{overviewStats.favorites}</p>
                  <Button variant="outline" className="gap-2" onClick={() => navigate("/liked")}>View liked</Button>
                </div>
                <div className="rounded-xl border border-white/[.07] bg-zinc-800/20 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-white" />
                    <p className="text-sm font-semibold">View history</p>
                  </div>
                  <p className="text-2xl font-bold">{overviewStats.viewHistory}</p>
                  <Button variant="outline" className="gap-2" onClick={() => navigate("/view-history")}>View history</Button>
                </div>
                <div className="rounded-xl border border-white/[.07] bg-zinc-800/20 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-white" />
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
          {authState.isLoading ? (
            <Card className="glass rounded-2xl">
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

