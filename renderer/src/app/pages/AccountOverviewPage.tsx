import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { apiFetch, apiUpload } from "@/lib/api"
import { proxyImageUrl } from "@/lib/utils"
import { useAuth } from "@/hooks/useAuth"
import { ProfileView, type ProfilePayload } from "@/components/ProfileView"
import { AvatarPickerDialog } from "@/components/AvatarPickerDialog"
import { EMPTY_PROFILE_IMAGES, resolveCurrentAvatarUrl, type ProfileImages } from "@/hooks/use-profile-images"
import { LogIn, LogOut, Loader2, Link2, Unlink, Pencil, ImagePlus } from "lucide-react"

const MAX_BIO_LENGTH = 240

export function AccountOverviewPage() {
  const navigate = useNavigate()
  const [authState, authActions] = useAuth()

  const [profile, setProfile] = useState<ProfilePayload | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileImages, setProfileImages] = useState<ProfileImages | null>(null)
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false)
  const [bannerPickerOpen, setBannerPickerOpen] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [bannerUploading, setBannerUploading] = useState(false)
  const [profileUploadError, setProfileUploadError] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [bioDraft, setBioDraft] = useState("")
  const [bioSaving, setBioSaving] = useState(false)
  const [linkingProvider, setLinkingProvider] = useState<string | null>(null)
  const [unlinkingProvider, setUnlinkingProvider] = useState<string | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)

  const hasSession = authState.isAuthenticated && authState.user !== null
  const linkedProviders = authState.linkedProviders || []
  const username = authState.user?.username || null

  const loadProfile = useCallback(async () => {
    if (!username) return
    try {
      const res = await apiFetch(`/api/profile/${encodeURIComponent(username)}`)
      if (!res.ok) return
      const data = await res.json()
      setProfile(data as ProfilePayload)
    } catch {
      // keep last good
    } finally {
      setProfileLoading(false)
    }
  }, [username])

  const loadProfileImages = useCallback(async () => {
    try {
      const res = await apiFetch("/api/account/profile-images")
      if (!res.ok) return
      const data = await res.json()
      setProfileImages({
        avatarUrl: data.avatarUrl ?? null,
        customAvatarUrl: data.customAvatarUrl ?? null,
        bannerUrl: data.bannerUrl ?? null,
        avatarSource: data.avatarSource ?? null,
        recentAvatars: Array.isArray(data.recentAvatars) ? data.recentAvatars : [],
        recentBanners: Array.isArray(data.recentBanners) ? data.recentBanners : [],
        oauthAvatars: Array.isArray(data.oauthAvatars) ? data.oauthAvatars : [],
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
    if (!hasSession) {
      setProfile(null)
      setProfileImages(null)
      setProfileLoading(false)
      return
    }
    setProfileLoading(true)
    void loadProfile()
    void loadProfileImages()
  }, [hasSession, loadProfile, loadProfileImages])

  // After an avatar/banner change, refetch both the picker data and the
  // rendered profile so the hero updates immediately.
  const refreshAfterMediaChange = useCallback(async () => {
    await Promise.all([loadProfileImages(), loadProfile()])
  }, [loadProfileImages, loadProfile])

  const doAvatarUpload = async (file: File) => {
    setProfileUploadError(null)
    setAvatarUploading(true)
    try {
      const res = await apiUpload("/api/account/profile-images", { file, fileName: file.name || "avatar.webp", fields: { kind: "avatar" } })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) setProfileUploadError(data?.error || "Failed to upload avatar.")
      else await refreshAfterMediaChange()
    } catch {
      setProfileUploadError("Failed to upload avatar.")
    } finally {
      setAvatarUploading(false)
    }
  }

  const doBannerUpload = async (file: File) => {
    setProfileUploadError(null)
    setBannerUploading(true)
    try {
      const res = await apiUpload("/api/account/profile-images", { file, fileName: file.name || "banner.webp", fields: { kind: "banner" } })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) setProfileUploadError(data?.error || "Failed to upload banner.")
      else await refreshAfterMediaChange()
    } catch {
      setProfileUploadError("Failed to upload banner.")
    } finally {
      setBannerUploading(false)
    }
  }

  const selectProfileMedia = async (args: { source: "custom" | "discord" | "google"; kind?: "avatar" | "banner"; fileId?: number }) => {
    setProfileUploadError(null)
    try {
      const res = await apiFetch("/api/account/profile-images", {
        method: "PATCH",
        body: JSON.stringify({ source: args.source, kind: args.kind ?? "avatar", fileId: args.fileId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setProfileUploadError(data?.error || "Failed to update avatar."); return }
      await refreshAfterMediaChange()
    } catch {
      setProfileUploadError("Failed to update avatar.")
    }
  }

  const saveBio = async () => {
    setBioSaving(true)
    try {
      const res = await apiFetch("/api/account/bio", {
        method: "POST",
        body: JSON.stringify({ bio: bioDraft.trim().slice(0, MAX_BIO_LENGTH) }),
      })
      if (res.ok) {
        setEditOpen(false)
        await loadProfile()
      }
    } catch {
      // ignore
    } finally {
      setBioSaving(false)
    }
  }

  const handleLogin = () => navigate("/login")

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      await authActions.logout()
      navigate("/login", { replace: true })
    } finally {
      setLoggingOut(false)
    }
  }

  const handleLinkProvider = async (provider: "discord" | "google") => {
    setLinkingProvider(provider)
    try { await authActions.linkProvider(provider) } catch { /* handled */ } finally { setLinkingProvider(null) }
  }

  const handleUnlinkProvider = async (provider: "discord" | "google") => {
    setUnlinkingProvider(provider)
    try { await authActions.unlinkProvider(provider) } catch { /* handled */ } finally { setUnlinkingProvider(null) }
  }

  const openEdit = () => {
    setBioDraft(profile?.user.bio ?? "")
    setProfileUploadError(null)
    setEditOpen(true)
  }

  // ── Not signed in ──
  if (!hasSession && !authState.isLoading) {
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <Card className="glass rounded-3xl">
          <CardContent className="py-12 text-center space-y-4">
            <p className="text-lg font-semibold text-foreground">Login to continue.</p>
            <p className="text-sm text-muted-foreground">Sign in to see your profile and activity.</p>
            <Button onClick={handleLogin}><LogIn className="h-4 w-4 mr-2" />Sign In</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const heroActions = (
    <>
      <Button variant="outline" size="sm" className="gap-2" onClick={openEdit}>
        <Pencil className="h-3.5 w-3.5" /> Edit Profile
      </Button>
      <Button variant="outline" size="sm" className="gap-2" onClick={handleLogout} disabled={loggingOut}>
        <LogOut className="h-3.5 w-3.5" /> {loggingOut ? "Signing out…" : "Logout"}
      </Button>
    </>
  )

  return (
    <div className="max-w-6xl mx-auto space-y-6 sm:space-y-8">
      {profileLoading || !profile ? (
        <div className="space-y-6 anim">
          <Skeleton className="h-56 w-full rounded-3xl" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}
          </div>
          <Skeleton className="h-40 w-full rounded-3xl" />
        </div>
      ) : (
        <div className="anim space-y-6 sm:space-y-8">
          <ProfileView data={profile} heroActions={heroActions} />

          {/* Account management (desktop-only — not part of the public profile) */}
          <Card className="rounded-3xl bg-card/80 border border-border/50 backdrop-blur-md shadow-[0_8px_30px_rgb(0,0,0,0.12)]">
            <CardHeader className="flex flex-row items-center gap-2">
              <CardTitle className="text-base font-semibold">Account</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                {authState.user?.email && (
                  <div className="rounded-2xl border border-border/50 bg-secondary/40 p-4">
                    <p className="text-xs font-semibold text-muted-foreground mb-1">Email</p>
                    <p className="text-sm text-foreground break-all">{authState.user.email}</p>
                  </div>
                )}
                {authState.user?.username && (
                  <div className="rounded-2xl border border-border/50 bg-secondary/40 p-4">
                    <p className="text-xs font-semibold text-muted-foreground mb-1">Username</p>
                    <p className="text-sm text-foreground">{authState.user.username}</p>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <p className="text-sm font-semibold text-foreground/80">Linked accounts</p>
                <div className="grid gap-2 md:grid-cols-2">
                  {(["discord", "google"] as const).map((provider) => {
                    const linked = linkedProviders.some((p) => p.provider === provider)
                    const busy = linkingProvider === provider || unlinkingProvider === provider
                    return (
                      <div key={provider} className="rounded-2xl border border-border/50 bg-secondary/40 p-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${provider === "discord" ? "bg-indigo-500" : "bg-red-500"}`} />
                          <span className="text-sm text-foreground/80 capitalize">{provider}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => (linked ? handleUnlinkProvider(provider) : handleLinkProvider(provider))}
                          disabled={busy || (linked && linkedProviders.length === 1)}
                        >
                          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : linked ? <Unlink className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Edit profile dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit profile</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            {profileUploadError && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{profileUploadError}</div>
            )}
            <div className="flex items-center gap-3">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border border-white/10 bg-secondary/60 flex items-center justify-center" style={{ containerType: "inline-size" }}>
                {resolveCurrentAvatarUrl(profileImages) ? (
                  <img src={proxyImageUrl(resolveCurrentAvatarUrl(profileImages) ?? "")} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span aria-hidden className="font-bold uppercase leading-none text-muted-foreground/80" style={{ fontSize: "45cqw" }}>
                    {(profile?.user.displayName || authState.user?.username || "?").charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setAvatarPickerOpen(true)}>
                  <ImagePlus className="h-3.5 w-3.5" /> Change avatar
                </Button>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setBannerPickerOpen(true)}>
                  <ImagePlus className="h-3.5 w-3.5" /> Change banner
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Bio</p>
              <Textarea
                value={bioDraft}
                onChange={(e) => setBioDraft(e.target.value.slice(0, MAX_BIO_LENGTH))}
                placeholder="Share something about you…"
                rows={3}
                maxLength={MAX_BIO_LENGTH}
              />
              <p className="text-xs text-muted-foreground/80 text-right">{bioDraft.length}/{MAX_BIO_LENGTH}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditOpen(false)}>Close</Button>
              <Button size="sm" onClick={() => void saveBio()} disabled={bioSaving}>
                {bioSaving ? "Saving…" : "Save bio"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AvatarPickerDialog
        open={avatarPickerOpen}
        onOpenChange={setAvatarPickerOpen}
        kind="avatar"
        images={profileImages ?? EMPTY_PROFILE_IMAGES}
        currentUrl={resolveCurrentAvatarUrl(profileImages)}
        busy={avatarUploading}
        cooldownActive={Boolean(profileImages?.avatarCooldownActive)}
        nextChangeAt={profileImages?.avatarNextChangeAt ?? null}
        onUpload={(file) => doAvatarUpload(file)}
        onSelectRecent={(fileId) => selectProfileMedia({ source: "custom", kind: "avatar", fileId })}
        onSelectOAuth={(source) => selectProfileMedia({ source: source as "discord" | "google", kind: "avatar" })}
      />
      <AvatarPickerDialog
        open={bannerPickerOpen}
        onOpenChange={setBannerPickerOpen}
        kind="banner"
        images={profileImages ?? EMPTY_PROFILE_IMAGES}
        currentUrl={profileImages?.bannerUrl ?? null}
        busy={bannerUploading}
        cooldownActive={Boolean(profileImages?.bannerCooldownActive)}
        nextChangeAt={profileImages?.bannerNextChangeAt ?? null}
        onUpload={(file) => doBannerUpload(file)}
        onSelectRecent={(fileId) => selectProfileMedia({ source: "custom", kind: "banner", fileId })}
      />
    </div>
  )
}
