"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { apiFetch, getApiBaseUrl } from "@/lib/api"
import type { AuthUser, GetMeResponse, Identity } from "@/lib/auth-types"

export type AuthContextState = {
  user: AuthUser | null
  linkedProviders: Identity[]
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
}

export type AuthContextActions = {
  signInWithWebsite: () => Promise<{ ok: boolean; error?: string }>
  logout: () => Promise<{ ok: boolean; error?: string }>
  refresh: () => Promise<void>
  linkProvider: (provider: "discord" | "google") => Promise<{ ok: boolean; error?: string }>
  unlinkProvider: (provider: "discord" | "google") => Promise<{ ok: boolean; error?: string }>
  updateProfile: (data: Partial<AuthUser>) => Promise<{ ok: boolean; error?: string }>
  updatePassword: (
    currentPassword: string,
    newPassword: string
  ) => Promise<{ ok: boolean; error?: string }>
}

export type AuthContextValue = AuthContextState & AuthContextActions

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [linkedProviders, setLinkedProviders] = useState<Identity[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fetchingRef = useRef(false)

  const refresh = useCallback(async () => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    setError(null)
    try {
      const response = await apiFetch("/api/auth/me")
      if (!response.ok) {
        setUser(null)
        setLinkedProviders([])
        return
      }
      const data = (await response.json()) as GetMeResponse
      setUser(data.user || null)
      setLinkedProviders(data.linkedProviders || [])
    } catch (err) {
      setUser(null)
      setLinkedProviders([])
      setError(err instanceof Error ? err.message : "Failed to fetch session")
    } finally {
      setIsLoading(false)
      fetchingRef.current = false
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Re-validate when the app regains focus, so an external sign-out or
  // session expiry is reflected without requiring a manual reload.
  useEffect(() => {
    if (typeof window === "undefined") return
    const onFocus = () => {
      void refresh()
    }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [refresh])

  const signInWithWebsite = useCallback(async () => {
    if (!window.ucAuth?.websiteLogin) {
      return { ok: false, error: "Sign in is only available in the desktop app." }
    }
    try {
      const result = await window.ucAuth.websiteLogin(getApiBaseUrl())
      if (result?.ok) {
        await refresh()
      }
      return { ok: !!result?.ok, error: result?.error }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Sign in failed" }
    }
  }, [refresh])

  const logout = useCallback(async () => {
    setIsLoading(true)
    try {
      if (window.ucAuth?.logout) {
        await window.ucAuth.logout(getApiBaseUrl())
      } else {
        // Fallback to direct fetch if the IPC bridge isn't available
        await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => null)
      }
      setUser(null)
      setLinkedProviders([])
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Logout failed" }
    } finally {
      setIsLoading(false)
    }
  }, [])

  const linkProvider = useCallback(
    async (provider: "discord" | "google") => {
      if (!window.ucAuth?.linkProvider) {
        return { ok: false, error: "Auth handler not available" }
      }
      const result = await window.ucAuth.linkProvider(getApiBaseUrl(), provider)
      if (result?.ok) {
        await refresh()
      }
      return { ok: !!result?.ok, error: result?.error }
    },
    [refresh]
  )

  const unlinkProvider = useCallback(
    async (provider: "discord" | "google") => {
      if (!window.ucAuth?.unlinkProvider) {
        return { ok: false, error: "Auth handler not available" }
      }
      const result = await window.ucAuth.unlinkProvider(getApiBaseUrl(), provider)
      if (result?.ok) {
        await refresh()
      }
      return { ok: !!result?.ok, error: result?.error }
    },
    [refresh]
  )

  const updateProfile = useCallback(
    async (data: Partial<AuthUser>) => {
      if (!window.ucAuth?.updateProfile) {
        return { ok: false, error: "Auth handler not available" }
      }
      const result = await window.ucAuth.updateProfile(getApiBaseUrl(), data)
      if (result?.ok) {
        await refresh()
      }
      return { ok: !!result?.ok, error: result?.error }
    },
    [refresh]
  )

  const updatePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      if (!window.ucAuth?.updatePassword) {
        return { ok: false, error: "Auth handler not available" }
      }
      const result = await window.ucAuth.updatePassword(
        getApiBaseUrl(),
        currentPassword,
        newPassword
      )
      return { ok: !!result?.ok, error: result?.error }
    },
    []
  )

  const value: AuthContextValue = {
    user,
    linkedProviders,
    isAuthenticated: !!user,
    isLoading,
    error,
    signInWithWebsite,
    logout,
    refresh,
    linkProvider,
    unlinkProvider,
    updateProfile,
    updatePassword,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error("useAuthContext must be used within an AuthProvider")
  }
  return ctx
}
