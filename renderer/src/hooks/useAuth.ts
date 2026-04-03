"use client"

import { useCallback, useEffect, useState } from "react"
import { apiFetch, getApiBaseUrl } from "@/lib/api"
import type { AuthUser, Identity, GetMeResponse } from "@/lib/auth-types"

export type AuthState = {
  user: AuthUser | null
  linkedProviders: Identity[]
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
}

export type AuthActions = {
  login: (email: string, password: string) => Promise<void>
  register: (email: string, username: string, password: string) => Promise<void>
  loginWithOAuth: (provider: "discord" | "google") => Promise<void>
  logout: () => Promise<void>
  linkProvider: (provider: "discord" | "google") => Promise<void>
  unlinkProvider: (provider: "discord" | "google") => Promise<void>
  updateProfile: (data: Partial<AuthUser>) => Promise<void>
  updatePassword: (currentPassword: string, newPassword: string) => Promise<void>
  refresh: (forceRefresh?: boolean) => Promise<void>
}

const AUTH_STATE_KEY = "uc_auth_state"
const USER_CACHE_KEY = "uc_user_cache"
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

interface CachedUser {
  user: AuthUser | null
  timestamp: number
}

function getCachedUser(): CachedUser | null {
  try {
    const cached = localStorage.getItem(USER_CACHE_KEY)
    if (!cached) return null
    const parsed = JSON.parse(cached) as CachedUser
    if (Date.now() - parsed.timestamp > CACHE_DURATION) {
      localStorage.removeItem(USER_CACHE_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function setCachedUser(user: AuthUser | null) {
  try {
    if (user) {
      localStorage.setItem(USER_CACHE_KEY, JSON.stringify({ user, timestamp: Date.now() }))
    } else {
      localStorage.removeItem(USER_CACHE_KEY)
    }
  } catch {
    // ignore
  }
}

function getAuthState(): "logged_in" | "logged_out" {
  try {
    return (sessionStorage.getItem(AUTH_STATE_KEY) as "logged_in" | "logged_out") || "logged_out"
  } catch {
    return "logged_out"
  }
}

function setAuthState(state: "logged_in" | "logged_out") {
  try {
    sessionStorage.setItem(AUTH_STATE_KEY, state)
  } catch {
    // ignore
  }
}

export function useAuth(): [AuthState, AuthActions] {
  const [state, setState] = useState<AuthState>({
    user: null,
    linkedProviders: [],
    isAuthenticated: false,
    isLoading: true,
    error: null,
  })

  const setError = useCallback((error: string | null) => {
    setState((prev) => ({ ...prev, error }))
  }, [])

  const refresh = useCallback(async (forceRefresh = false) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }))

    try {
      // Check cache first if not forcing refresh
      if (!forceRefresh) {
        const cached = getCachedUser()
        if (cached?.user) {
          setState((prev) => ({
            ...prev,
            user: cached.user,
            isAuthenticated: true,
            isLoading: false,
            linkedProviders: prev.linkedProviders,
          }))
          return
        }

        const authState = getAuthState()
        if (authState === "logged_out") {
          setState((prev) => ({
            ...prev,
            user: null,
            isAuthenticated: false,
            isLoading: false,
            linkedProviders: [],
          }))
          return
        }
      }

      // Fetch current user from API
      const response = await apiFetch("/api/auth/me")
      if (!response.ok) {
        setState((prev) => ({
          ...prev,
          user: null,
          isAuthenticated: false,
          isLoading: false,
          linkedProviders: [],
        }))
        setAuthState("logged_out")
        setCachedUser(null)
        return
      }

      const data = (await response.json()) as GetMeResponse
      const user = data.user || null
      const linkedProviders = data.linkedProviders || []

      setState((prev) => ({
        ...prev,
        user,
        isAuthenticated: !!user,
        isLoading: false,
        linkedProviders,
      }))

      if (user) {
        setAuthState("logged_in")
        setCachedUser(user)
      } else {
        setAuthState("logged_out")
        setCachedUser(null)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch auth state"
      setState((prev) => ({
        ...prev,
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: message,
        linkedProviders: [],
      }))
    }
  }, [])

  // Initial load on mount
  useEffect(() => {
    refresh()
  }, [refresh])

  const login = useCallback(
    async (email: string, password: string) => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }))
      try {
        if (!window.ucAuth?.emailLogin) {
          throw new Error("Auth handler not available")
        }

        const response = await window.ucAuth.emailLogin(getApiBaseUrl(), email, password)
        if (!response.ok) {
          throw new Error(response.error || "Login failed")
        }

        await refresh(true)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Login failed"
        setState((prev) => ({ ...prev, error: message }))
        throw err
      }
    },
    [refresh]
  )

  const register = useCallback(
    async (email: string, username: string, password: string) => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }))
      try {
        if (!window.ucAuth?.register) {
          throw new Error("Auth handler not available")
        }

        const response = await window.ucAuth.register(getApiBaseUrl(), email, username, password)
        if (!response.ok) {
          throw new Error(response.error || "Registration failed")
        }

        // Don't auto-refresh after register, user needs to verify email first
        setState((prev) => ({ ...prev, isLoading: false }))
      } catch (err) {
        const message = err instanceof Error ? err.message : "Registration failed"
        setState((prev) => ({ ...prev, error: message, isLoading: false }))
        throw err
      }
    },
    []
  )

  const loginWithOAuth = useCallback(
    async (provider: "discord" | "google") => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }))
      try {
        if (!window.ucAuth?.login) {
          throw new Error("Auth handler not available")
        }

        const response = await window.ucAuth.login(getApiBaseUrl())
        if (!response.ok) {
          throw new Error(response.error || "OAuth login failed")
        }

        await refresh(true)
      } catch (err) {
        const message = err instanceof Error ? err.message : "OAuth login failed"
        setState((prev) => ({ ...prev, error: message, isLoading: false }))
        throw err
      }
    },
    [refresh]
  )

  const logout = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }))
    try {
      if (!window.ucAuth?.logout) {
        throw new Error("Auth handler not available")
      }

      const response = await window.ucAuth.logout(getApiBaseUrl())
      if (!response.ok) {
        throw new Error(response.error || "Logout failed")
      }

      setState((prev) => ({
        ...prev,
        user: null,
        isAuthenticated: false,
        isLoading: false,
        linkedProviders: [],
      }))
      setAuthState("logged_out")
      setCachedUser(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Logout failed"
      setState((prev) => ({ ...prev, error: message, isLoading: false }))
      throw err
    }
  }, [])

  const linkProvider = useCallback(
    async (provider: "discord" | "google") => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }))
      try {
        if (!window.ucAuth?.linkProvider) {
          throw new Error("Auth handler not available")
        }

        const response = await window.ucAuth.linkProvider(getApiBaseUrl(), provider)
        if (!response.ok) {
          throw new Error(response.error || "Link provider failed")
        }

        await refresh(true)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Link provider failed"
        setState((prev) => ({ ...prev, error: message, isLoading: false }))
        throw err
      }
    },
    [refresh]
  )

  const unlinkProvider = useCallback(
    async (provider: "discord" | "google") => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }))
      try {
        if (!window.ucAuth?.unlinkProvider) {
          throw new Error("Auth handler not available")
        }

        const response = await window.ucAuth.unlinkProvider(getApiBaseUrl(), provider)
        if (!response.ok) {
          throw new Error(response.error || "Unlink provider failed")
        }

        await refresh(true)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unlink provider failed"
        setState((prev) => ({ ...prev, error: message, isLoading: false }))
        throw err
      }
    },
    [refresh]
  )

  const updateProfile = useCallback(
    async (data: Partial<AuthUser>) => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }))
      try {
        if (!window.ucAuth?.updateProfile) {
          throw new Error("Auth handler not available")
        }

        const response = await window.ucAuth.updateProfile(getApiBaseUrl(), data)
        if (!response.ok) {
          throw new Error(response.error || "Update profile failed")
        }

        await refresh(true)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Update profile failed"
        setState((prev) => ({ ...prev, error: message, isLoading: false }))
        throw err
      }
    },
    [refresh]
  )

  const updatePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }))
      try {
        if (!window.ucAuth?.updatePassword) {
          throw new Error("Auth handler not available")
        }

        const response = await window.ucAuth.updatePassword(
          getApiBaseUrl(),
          currentPassword,
          newPassword
        )
        if (!response.ok) {
          throw new Error(response.error || "Update password failed")
        }

        setState((prev) => ({ ...prev, isLoading: false }))
      } catch (err) {
        const message = err instanceof Error ? err.message : "Update password failed"
        setState((prev) => ({ ...prev, error: message, isLoading: false }))
        throw err
      }
    },
    []
  )

  const actions: AuthActions = {
    login,
    register,
    loginWithOAuth,
    logout,
    linkProvider,
    unlinkProvider,
    updateProfile,
    updatePassword,
    refresh,
  }

  return [state, actions]
}

// For backward compatibility, keep the old hook but delegate to new one
export function useDiscordAccount() {
  const [authState, authActions] = useAuth()

  return {
    user: authState.user
      ? {
          discordId: authState.user.discordId,
          username: authState.user.username,
          displayName: authState.user.displayName,
          avatarUrl: authState.user.avatarUrl,
          bio: authState.user.bio,
        }
      : null,
    loading: authState.isLoading,
    authenticated: authState.isAuthenticated,
    refresh: authActions.refresh,
  }
}
