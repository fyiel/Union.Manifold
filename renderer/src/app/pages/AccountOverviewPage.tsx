import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CommentMarkdown } from "@/components/CommentMarkdown"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { MyRequests } from "@/components/MyRequests"
import { apiFetch, apiUrl } from "@/lib/api"
import { useAuth } from "@/hooks/useAuth"
import { LogIn, RefreshCw, Star, Heart, Clock, LogOut, Link2, Unlink, Loader2, Upload, ImageIcon, Pencil, X, Check } from "lucide-react"

const MAX_BIO_LENGTH = 240

type ProfileImages = {
  avatarUrl: string | null
  customAvatarUrl: string | null
  bannerUrl: string | null
  avatarCooldownActive: boolean
  bannerCooldownActive: boolean
  avatarNextChangeAt: string | null
  bannerNextChangeAt: string | null
}


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
  const [refreshing, setRefreshing] = useState(false)
  const [linkingProvider, setLinkingProvider] = useState<string | null>(null)
  const [unlinkingProvider, setUnlinkingProvider] = useState<string | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)
  const [profileImages, setProfileImages] = useState<ProfileImages | null>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [bannerUploading, setBannerUploading] = useState(false)
  const [profileUploadError, setProfileUploadError] = useState<string | null>(null)
  const [editingProfile, setEditingProfile] = useState(false)
  const [bioDraft, setBioDraft] = useState("")
  const [bioSaving, setBioSaving] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)
  
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
      if (data?.user?.bio !== undefined) {
        setBioDraft(data.user.bio ?? "")
      }
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

  const loadProfileImages = useCallback(async () => {
    try {
      const res = await apiFetch("/api/account/profile-images")
      if (!res.ok) return
      const data = await res.json()
      setProfileImages({
        avatarUrl: data.avatarUrl ?? null,
        customAvatarUrl: data.customAvatarUrl ?? null,
        bannerUrl: data.bannerUrl ?? null,
        avatarCooldownActive: Boolean(data.avatarCooldownActive),
        bannerCooldownActive: Boolean(data.bannerCooldownActive),
        avatarNextChangeAt: data.avatarNextChangeAt ?? null,
        bannerNextChangeAt: data.bannerNextChangeAt ?? null,
      })
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    if (!authState.user || !authState.isAuthenticated) return
    void loadProfileImages()
  }, [authState.user, authState.isAuthenticated, loadProfileImages])

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setProfileUploadError(null)
    setAvatarUploading(true)
    try {
      const form = new FormData()
      form.append("file", file)
      form.append("kind", "avatar")
      const res = await fetch(apiUrl("/api/account/profile-images"), {
        method: "POST",
        body: form,
        credentials: "include",
      })
      const data = await res.json()
      if (!res.ok) {
        setProfileUploadError(data?.error || "Failed to upload avatar.")
      } else {
        await loadProfileImages()
      }
    } catch {
      setProfileUploadError("Failed to upload avatar.")
    } finally {
      setAvatarUploading(false)
      if (avatarInputRef.current) avatarInputRef.current.value = ""
    }
  }

  const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setProfileUploadError(null)
    setBannerUploading(true)
    try {
      const form = new FormData()
      form.append("file", file)
      form.append("kind", "banner")
      const res = await fetch(apiUrl("/api/account/profile-images"), {
        method: "POST",
        body: form,
        credentials: "include",
      })
      const data = await res.json()
      if (!res.ok) {
        setProfileUploadError(data?.error || "Failed to upload banner.")
      } else {
        await loadProfileImages()
      }
    } catch {
      setProfileUploadError("Failed to upload banner.")
    } finally {
      setBannerUploading(false)
      if (bannerInputRef.current) bannerInputRef.current.value = ""
    }
  }

  useEffect(() => {
    if (hasSession) return
    setSummary(null)
    setSummaryError(null)
    setRecentComments([])
    setRecentError(null)
    setProfileImages(null)
    setProfileUploadError(null)
    setBioDraft("")
    setEditingProfile(false)
  }, [hasSession])

  const handleLogin = async () => {
    navigate("/login")
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
    await authActions.refresh(true).catch(() => {})
    await loadSummary().catch(() => {})
    await loadRecentComments().catch(() => {})
    await loadProfileImages().catch(() => {})
    setRefreshing(false)
  }

  const saveBio = async () => {
    setBioSaving(true)
    try {
      const res = await apiFetch("/api/account/bio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bio: bioDraft.trim().slice(0, MAX_BIO_LENGTH) }),
      })
      if (res.ok) {
        setEditingProfile(false)
      }
    } catch {
      // ignore
    } finally {
      setBioSaving(false)
    }
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

        {!hasSession && !authState.isLoading && (
          <Card className="glass rounded-2xl">
            <CardContent className="py-12 text-center space-y-4">
              <p className="text-lg font-semibold text-zinc-100">Login to continue.</p>
              <p className="text-sm text-zinc-400">
                Sign in to see your saved lists and recent activity.
              </p>
              <Button className="w-full md:w-auto" onClick={handleLogin}>
                <LogIn className="h-4 w-4 mr-2" />
                Sign In
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

            <Card className="glass rounded-2xl anim anim-d1 overflow-hidden">
              <input ref={bannerInputRef} type="file" accept="image/*" className="hidden" onChange={handleBannerUpload} />
              <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />

              {/* Banner + Avatar Hero */}
              <div className="relative">
                <div className="w-full h-32 bg-zinc-800/40 overflow-hidden">
                  {profileImages?.bannerUrl ? (
                    <img src={profileImages.bannerUrl} alt="Profile banner" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-r from-zinc-800 to-zinc-700" />
                  )}
                </div>
                <div className="px-5 pb-4">
                  <div className="flex items-end justify-between -mt-8">
                    <div className="h-16 w-16 rounded-full border-2 border-[#09090b] bg-zinc-800/80 overflow-hidden flex items-center justify-center shrink-0">
                      {profileImages?.customAvatarUrl || profileImages?.avatarUrl ? (
                        <img
                          src={profileImages.customAvatarUrl ?? profileImages.avatarUrl ?? ""}
                          alt="Avatar"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <ImageIcon className="h-6 w-6 text-zinc-500" />
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 mb-1"
                      onClick={() => {
                        if (!editingProfile) setBioDraft(summary?.user?.bio ?? bioDraft)
                        setEditingProfile((v) => !v)
                        setProfileUploadError(null)
                      }}
                    >
                      {editingProfile ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                      {editingProfile ? "Cancel" : "Edit Profile"}
                    </Button>
                  </div>
                  <div className="mt-2">
                    <p className="font-semibold text-zinc-100">
                      {authState.user?.displayName || authState.user?.username || "Your Account"}
                    </p>
                    {authState.user?.username && authState.user?.displayName && (
                      <p className="text-xs text-zinc-500">@{authState.user.username}</p>
                    )}
                    {!editingProfile && summary?.user?.bio && (
                      <p className="mt-1 text-sm text-zinc-400 line-clamp-2">{summary.user.bio}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Edit Mode */}
              {editingProfile && (
                <div className="px-5 pb-5 pt-1 space-y-4 border-t border-white/[.07]">
                  {profileUploadError && (
                    <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                      {profileUploadError}
                    </div>
                  )}

                  {/* Banner upload */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Banner</p>
                    <button
                      type="button"
                      disabled={bannerUploading || Boolean(profileImages?.bannerCooldownActive)}
                      onClick={() => bannerInputRef.current?.click()}
                      className="relative w-full h-24 rounded-xl overflow-hidden border border-white/[.07] bg-zinc-800/30 flex items-center justify-center group transition-opacity disabled:opacity-50"
                    >
                      {profileImages?.bannerUrl ? (
                        <img src={profileImages.bannerUrl} alt="Banner" className="w-full h-full object-cover" />
                      ) : null}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-xl">
                        {bannerUploading ? (
                          <Loader2 className="h-5 w-5 text-white animate-spin" />
                        ) : (
                          <Upload className="h-5 w-5 text-white" />
                        )}
                      </div>
                      {!profileImages?.bannerUrl && !bannerUploading && (
                        <div className="flex flex-col items-center gap-1 text-zinc-500">
                          <Upload className="h-5 w-5" />
                          <span className="text-xs">Click to upload banner</span>
                        </div>
                      )}
                    </button>
                    {profileImages?.bannerCooldownActive && profileImages.bannerNextChangeAt && (
                      <p className="text-xs text-zinc-500">
                        Next change available after {new Date(profileImages.bannerNextChangeAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>

                  {/* Avatar upload */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Profile Picture</p>
                    <div className="flex items-center gap-4">
                      <button
                        type="button"
                        disabled={avatarUploading || Boolean(profileImages?.avatarCooldownActive)}
                        onClick={() => avatarInputRef.current?.click()}
                        className="relative h-16 w-16 rounded-full overflow-hidden border border-white/[.07] bg-zinc-800/30 flex items-center justify-center group shrink-0 transition-opacity disabled:opacity-50"
                      >
                        {profileImages?.customAvatarUrl || profileImages?.avatarUrl ? (
                          <img
                            src={profileImages.customAvatarUrl ?? profileImages.avatarUrl ?? ""}
                            alt="Avatar"
                            className="w-full h-full object-cover"
                          />
                        ) : null}
                        <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          {avatarUploading ? (
                            <Loader2 className="h-4 w-4 text-white animate-spin" />
                          ) : (
                            <Upload className="h-4 w-4 text-white" />
                          )}
                        </div>
                        {!profileImages?.customAvatarUrl && !profileImages?.avatarUrl && !avatarUploading && (
                          <ImageIcon className="h-6 w-6 text-zinc-500" />
                        )}
                      </button>
                      <div className="space-y-1 text-xs text-zinc-500">
                        <p>Click the circle to upload a new profile picture.</p>
                        {profileImages?.avatarCooldownActive && profileImages.avatarNextChangeAt && (
                          <p>Next change available after {new Date(profileImages.avatarNextChangeAt).toLocaleDateString()}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Bio */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Bio</p>
                    <Textarea
                      value={bioDraft}
                      onChange={(e) => setBioDraft(e.target.value.slice(0, MAX_BIO_LENGTH))}
                      placeholder="Tell the community about you..."
                      rows={3}
                      maxLength={MAX_BIO_LENGTH}
                    />
                    <p className="text-xs text-zinc-500 text-right">{bioDraft.length}/{MAX_BIO_LENGTH}</p>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      className="gap-2"
                      onClick={saveBio}
                      disabled={bioSaving || avatarUploading || bannerUploading}
                    >
                      {bioSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      {bioSaving ? "Saving..." : "Save"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingProfile(false)
                        setProfileUploadError(null)
                        setBioDraft(summary?.user?.bio ?? "")
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </Card>

            <Card className="glass rounded-2xl anim anim-d2">
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
                        <CommentMarkdown text={comment.body} className="mt-2 max-h-24 overflow-hidden text-zinc-100" />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="glass rounded-2xl anim anim-d3">
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

