import { useCallback, useEffect, useRef, useState } from "react"
import { apiFetch } from "@/lib/api"

export type UcPlusStatus = {
  active: boolean
  expiresAt: string | null
  status: "active" | "revoked" | "expired" | null
  source: string | null
  claim: {
    code: string
    expiresAt: string | null
    kofiUrl: string
  } | null
  claimCodeValidDays: number | null
}

type UcPlusState = {
  active: boolean
  loading: boolean
  status: UcPlusStatus | null
  refresh: () => Promise<void>
}

const EMPTY_STATUS: UcPlusStatus = {
  active: false,
  expiresAt: null,
  status: null,
  source: null,
  claim: null,
  claimCodeValidDays: null,
}

let cachedStatus: UcPlusStatus | null = null
let cachedAt = 0
const TTL_MS = 60_000
const listeners = new Set<() => void>()

function notify() {
  for (const cb of listeners) cb()
}

async function fetchStatus(): Promise<UcPlusStatus> {
  try {
    const res = await apiFetch("/api/uc-plus/claim", { cache: "no-store" })
    if (!res.ok) return EMPTY_STATUS
    const data = (await res.json()) as UcPlusStatus
    return data
  } catch {
    return EMPTY_STATUS
  }
}

/**
 * Returns the viewer's UC+ status. Caches the result in-memory for 60s so
 * multiple consumers don't trigger redundant /api/uc-plus/claim calls.
 *
 * Mirrors union-crax.xyz/hooks/use-uc-plus.ts (swaps fetch → apiFetch so the
 * desktop's base-URL/auth wrapper is used).
 *
 * Auth-required: anonymous viewers see `{ active: false }` and no claim.
 */
export function useUcPlus(): UcPlusState {
  const [, force] = useState(0)
  const fetchingRef = useRef(false)

  useEffect(() => {
    const tick = () => force((n) => n + 1)
    listeners.add(tick)
    return () => {
      listeners.delete(tick)
    }
  }, [])

  const refresh = useCallback(async () => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    try {
      const next = await fetchStatus()
      cachedStatus = next
      cachedAt = Date.now()
      notify()
    } finally {
      fetchingRef.current = false
    }
  }, [])

  useEffect(() => {
    const fresh = cachedStatus != null && Date.now() - cachedAt < TTL_MS
    if (!fresh) {
      void refresh()
    }
  }, [refresh])

  return {
    active: Boolean(cachedStatus?.active),
    loading: cachedStatus == null,
    status: cachedStatus,
    refresh,
  }
}
