"use client"

import { useMemo } from "react"
import { useAuthContext } from "@/context/auth-context"

export type DiscordAccount = {
  discordId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  bio?: string | null
}

type DiscordAccountState = {
  user: DiscordAccount | null
  loading: boolean
  authenticated: boolean
  refresh: (forceAccountFetch?: boolean) => Promise<void>
}

/**
 * Thin wrapper over the unified auth context, kept for backwards compatibility
 * with components that consume the legacy {user, loading, authenticated, refresh}
 * shape. Source of truth is /api/auth/me — there is no Discord-only fallback,
 * so the avatar always reflects the actual signed-in user (or null).
 */
export function useDiscordAccount(): DiscordAccountState {
  const ctx = useAuthContext()

  const user = useMemo<DiscordAccount | null>(() => {
    if (!ctx.user) return null
    return {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
      displayName: ctx.user.displayName,
      avatarUrl: ctx.user.avatarUrl,
      bio: ctx.user.bio,
    }
  }, [ctx.user])

  return {
    user,
    loading: ctx.isLoading,
    authenticated: ctx.isAuthenticated,
    refresh: async () => {
      await ctx.refresh()
    },
  }
}
