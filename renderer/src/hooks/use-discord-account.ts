"use client"

import { useCallback, useEffect, useState } from "react"
import { apiFetch, getApiBaseUrl } from "@/lib/api"

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
  refresh: () => Promise<void>
}

export function useDiscordAccount(): DiscordAccountState {
  const [user, setUser] = useState<DiscordAccount | null>(null)
  const [loading, setLoading] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)

  const fetchFallbackAccount = useCallback(async () => {
    let discordId: string | null = null
    try {
      const res = await apiFetch("/api/discord/session")
      if (res.ok) {
        const data = await res.json()
        if (data?.discordId) discordId = data.discordId
      }
    } catch {
      // ignore
    }
    if (!discordId && window.ucAuth?.getSession) {
      try {
        const res = await window.ucAuth.getSession(getApiBaseUrl())
        if (res?.discordId) discordId = res.discordId
      } catch {
        // ignore
      }
    }
    if (!discordId) return null
    try {
      const res = await apiFetch(`/api/discord-avatar/${encodeURIComponent(discordId)}`)
      if (res.ok) {
        const data = await res.json()
        return {
          discordId,
          username: data?.username || "Discord user",
          displayName: data?.displayName || null,
          avatarUrl: data?.avatar || null,
        } as DiscordAccount
      }
    } catch {
      // fall back below
    }
    return {
      discordId,
      username: "Discord user",
      displayName: null,
      avatarUrl: null,
    } as DiscordAccount
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const summaryRes = await apiFetch("/api/account/summary")
      if (summaryRes.ok) {
        const summary = await summaryRes.json()
        const nextUser = summary?.user ?? null
        setUser(nextUser)
        setAuthenticated(Boolean(nextUser))
        return
      }

      const res = await apiFetch("/api/comments/me")
      if (!res.ok) {
        const fallback = await fetchFallbackAccount()
        setUser(fallback)
        setAuthenticated(false)
        return
      }
      const data = await res.json()
      setUser(data?.user ?? null)
      setAuthenticated(true)
    } catch {
      const fallback = await fetchFallbackAccount()
      setUser(fallback)
      setAuthenticated(false)
    } finally {
      setLoading(false)
    }
  }, [fetchFallbackAccount])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (user?.discordId) {
      try {
        localStorage.setItem("discord_id", user.discordId)
      } catch {
        // ignore storage errors
      }
    } else {
      try {
        localStorage.removeItem("discord_id")
      } catch {
        // ignore storage errors
      }
    }
  }, [user])

  useEffect(() => {
    const handleLogout = () => {
      setUser(null)
      setAuthenticated(false)
      setLoading(false)
    }

    window.addEventListener("uc_discord_logout", handleLogout)
    return () => window.removeEventListener("uc_discord_logout", handleLogout)
  }, [])

  return { user, loading, authenticated, refresh }
}
