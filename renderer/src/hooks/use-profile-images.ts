import { useCallback, useEffect, useRef, useState } from "react"
import { apiFetch, apiUpload } from "@/lib/api"

export type ProfileMediaKind = "avatar" | "banner"

export type RecentMedia = {
  fileId: number
  url: string
  createdAt: string
  isCurrent: boolean
}

export type OAuthAvatar = {
  source: string // 'discord' | 'google'
  label: string
  url: string
}

export type ProfileImages = {
  avatarUrl: string | null
  customAvatarUrl: string | null
  bannerUrl: string | null
  avatarSource: string | null
  recentAvatars: RecentMedia[]
  recentBanners: RecentMedia[]
  oauthAvatars: OAuthAvatar[]
  avatarCooldownActive: boolean
  bannerCooldownActive: boolean
  avatarNextChangeAt: string | null
  bannerNextChangeAt: string | null
}

export const EMPTY_PROFILE_IMAGES: ProfileImages = {
  avatarUrl: null,
  customAvatarUrl: null,
  bannerUrl: null,
  avatarSource: null,
  recentAvatars: [],
  recentBanners: [],
  oauthAvatars: [],
  avatarCooldownActive: false,
  bannerCooldownActive: false,
  avatarNextChangeAt: null,
  bannerNextChangeAt: null,
}

/**
 * Resolve the avatar URL currently displayed for the user, honouring
 * `avatarSource`: a custom upload, or one of the connected OAuth providers.
 */
export function resolveCurrentAvatarUrl(images: ProfileImages | null): string | null {
  if (!images) return null
  if (images.avatarSource === "custom") return images.customAvatarUrl ?? null
  if (images.avatarSource) {
    const match = images.oauthAvatars.find((a) => a.source === images.avatarSource)
    if (match) return match.url
  }
  return images.customAvatarUrl ?? images.oauthAvatars[0]?.url ?? null
}

type UploadResult = { ok: boolean; error?: string }

/**
 * Shared avatar/banner state + actions for the Account and Settings pages.
 * Wraps the `/api/account/profile-images` GET/POST/PATCH endpoints.
 */
export function useProfileImages(enabled = true) {
  const [images, setImages] = useState<ProfileImages | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch("/api/account/profile-images")
      if (!res.ok) return
      const data = await res.json()
      if (!mountedRef.current) return
      setImages({
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
      // ignore — keep last good state
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (enabled) void reload()
  }, [enabled, reload])

  const upload = useCallback(async (kind: ProfileMediaKind, file: File): Promise<UploadResult> => {
    setBusy(true)
    try {
      const res = await apiUpload("/api/account/profile-images", {
        file,
        fileName: file.name || `${kind}.webp`,
        fields: { kind },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, error: data?.error || `Failed to upload ${kind}.` }
      await reload()
      return { ok: true }
    } catch {
      return { ok: false, error: `Failed to upload ${kind}.` }
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }, [reload])

  // Switch the active avatar to a previous custom upload, or revert to an OAuth
  // provider's avatar. `fileId` selects a specific entry from history.
  const select = useCallback(async (
    args: { source: "custom" | "discord" | "google"; kind?: ProfileMediaKind; fileId?: number },
  ): Promise<UploadResult> => {
    setBusy(true)
    try {
      const res = await apiFetch("/api/account/profile-images", {
        method: "PATCH",
        body: JSON.stringify({ source: args.source, kind: args.kind ?? "avatar", fileId: args.fileId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, error: data?.error || "Failed to update avatar." }
      await reload()
      return { ok: true }
    } catch {
      return { ok: false, error: "Failed to update avatar." }
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }, [reload])

  const reset = useCallback(() => setImages(null), [])

  return {
    images: images ?? EMPTY_PROFILE_IMAGES,
    hasData: images != null,
    loading,
    busy,
    reload,
    reset,
    upload,
    select,
    currentAvatarUrl: resolveCurrentAvatarUrl(images),
  }
}
