"use client"

import { useMemo } from "react"
import { useAuthContext } from "@/context/auth-context"
import type { AuthUser, Identity } from "@/lib/auth-types"

export type AuthState = {
  user: AuthUser | null
  linkedProviders: Identity[]
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
}

export type AuthActions = {
  signInWithWebsite: () => Promise<{ ok: boolean; error?: string }>
  logout: () => Promise<{ ok: boolean; error?: string }>
  refresh: (force?: boolean) => Promise<void>
  linkProvider: (provider: "discord" | "google") => Promise<{ ok: boolean; error?: string }>
  unlinkProvider: (provider: "discord" | "google") => Promise<{ ok: boolean; error?: string }>
  updateProfile: (data: Partial<AuthUser>) => Promise<{ ok: boolean; error?: string }>
  updatePassword: (
    currentPassword: string,
    newPassword: string
  ) => Promise<{ ok: boolean; error?: string }>
}

export function useAuth(): [AuthState, AuthActions] {
  const ctx = useAuthContext()

  const state = useMemo<AuthState>(
    () => ({
      user: ctx.user,
      linkedProviders: ctx.linkedProviders,
      isAuthenticated: ctx.isAuthenticated,
      isLoading: ctx.isLoading,
      error: ctx.error,
    }),
    [ctx.user, ctx.linkedProviders, ctx.isAuthenticated, ctx.isLoading, ctx.error]
  )

  const actions = useMemo<AuthActions>(
    () => ({
      signInWithWebsite: ctx.signInWithWebsite,
      logout: ctx.logout,
      refresh: async () => {
        await ctx.refresh()
      },
      linkProvider: ctx.linkProvider,
      unlinkProvider: ctx.unlinkProvider,
      updateProfile: ctx.updateProfile,
      updatePassword: ctx.updatePassword,
    }),
    [
      ctx.signInWithWebsite,
      ctx.logout,
      ctx.refresh,
      ctx.linkProvider,
      ctx.unlinkProvider,
      ctx.updateProfile,
      ctx.updatePassword,
    ]
  )

  return [state, actions]
}
