import { useCallback, useEffect, useState } from "react"

/**
 * Module-level cache of "which appids are currently running". One bulk fetch
 * on first subscription hydrates it; after that, ucPresence.onChanged keeps it
 * in sync push-style. Every GameCard reads the same Set so we only ever pay
 * one IPC round-trip per session for the initial state, no matter how many
 * cards are mounted.
 *
 * The cache is also exposed as a synchronous `isRunning(appid)` helper for
 * non-React code paths.
 */

let cache: Set<string> = new Set()
let hydratedAt = 0
let hydrating: Promise<void> | null = null
const listeners = new Set<() => void>()

/** Session start times: appid → epoch ms when the game was first detected running */
const sessionStartTimes = new Map<string, number>()

function notify() {
  for (const listener of listeners) {
    try { listener() } catch { /* ignore */ }
  }
}

function setCache(next: Set<string>) {
  // Record start times for newly-seen running games
  for (const appid of next) {
    if (!cache.has(appid) && !sessionStartTimes.has(appid)) {
      sessionStartTimes.set(appid, Date.now())
    }
  }
  // Clear start times for games that have exited
  for (const appid of cache) {
    if (!next.has(appid)) {
      sessionStartTimes.delete(appid)
    }
  }

  // Avoid notifying when nothing changed — listeners trigger re-renders.
  if (next.size === cache.size) {
    let same = true
    for (const value of cache) {
      if (!next.has(value)) { same = false; break }
    }
    if (same) return
  }
  cache = next
  notify()
}

async function hydrate(force = false) {
  if (typeof window === "undefined") return
  if (hydrating) return hydrating
  // Cache the bulk result for up to 30s — push events keep it fresh in
  // between, and on focus we re-hydrate as a safety net.
  if (!force && hydratedAt && Date.now() - hydratedAt < 30_000) return
  hydrating = (async () => {
    try {
      const result = await window.ucDownloads?.listRunningGameAppids?.()
      if (result?.ok) {
        setCache(new Set(result.appids || []))
        hydratedAt = Date.now()
      }
    } catch { /* ignore */ } finally {
      hydrating = null
    }
  })()
  return hydrating
}

let presenceWired = false
function ensurePresenceSubscription() {
  if (presenceWired || typeof window === "undefined") return
  presenceWired = true
  // Push-based updates: instant on launch / exit, no polling.
  window.ucPresence?.onChanged?.((detail) => {
    if (!detail || !detail.appid) return
    if (detail.reason === "game-started") {
      if (cache.has(detail.appid)) return
      const next = new Set(cache)
      next.add(detail.appid)
      setCache(next)
    } else if (detail.reason === "game-exited") {
      if (!cache.has(detail.appid)) return
      const next = new Set(cache)
      next.delete(detail.appid)
      setCache(next)
    }
  })
  // Belt-and-braces resync when the window regains focus, in case we missed
  // a presence event while suspended.
  window.addEventListener("focus", () => { void hydrate(true) })
}

/**
 * Subscribe a single GameCard (or anything else) to the running set. Returns
 * `true` when `appid` is currently running. Hydrates lazily on first call.
 */
export function useRunningGame(appid: string | null | undefined): boolean {
  const [running, setRunning] = useState<boolean>(() => Boolean(appid && cache.has(appid)))

  useEffect(() => {
    ensurePresenceSubscription()
    void hydrate()
    const update = () => setRunning(Boolean(appid && cache.has(appid)))
    listeners.add(update)
    update()
    return () => { listeners.delete(update) }
  }, [appid])

  return running
}

/** Returns true if any game is currently running. Subscribes to cache updates. */
export function useHasRunningGames(): boolean {
  const [has, setHas] = useState<boolean>(() => cache.size > 0)

  useEffect(() => {
    ensurePresenceSubscription()
    void hydrate()
    const update = () => setHas(cache.size > 0)
    listeners.add(update)
    update()
    return () => { listeners.delete(update) }
  }, [])

  return has
}

export type RunningSession = { appid: string; startedAt: number }

/**
 * Returns the list of currently-running game sessions with their start times.
 * `startedAt` is the epoch ms when the game was first detected running in this
 * renderer session (the true OS start time is not available via IPC).
 */
export function useRunningGamesSessions(): RunningSession[] {
  const [sessions, setSessions] = useState<RunningSession[]>(() =>
    Array.from(cache).map((appid) => ({ appid, startedAt: sessionStartTimes.get(appid) ?? Date.now() }))
  )

  useEffect(() => {
    ensurePresenceSubscription()
    void hydrate()
    const update = () =>
      setSessions(Array.from(cache).map((appid) => ({ appid, startedAt: sessionStartTimes.get(appid) ?? Date.now() })))
    listeners.add(update)
    update()
    return () => { listeners.delete(update) }
  }, [])

  return sessions
}

/** Force a re-fetch — wire to events that may not flow through ucPresence. */
export function refreshRunningGames() {
  return hydrate(true)
}

/** Synchronous check for callers outside React. */
export function isRunningGameSync(appid: string): boolean {
  return cache.has(appid)
}

/** Useful for grid views that need the live count + ability to refresh. */
export function useRunningGames(): { running: Set<string>; refresh: () => Promise<void> } {
  const [snapshot, setSnapshot] = useState<Set<string>>(() => new Set(cache))
  const refresh = useCallback(async () => { await hydrate(true) }, [])

  useEffect(() => {
    ensurePresenceSubscription()
    void hydrate()
    const update = () => setSnapshot(new Set(cache))
    listeners.add(update)
    update()
    return () => { listeners.delete(update) }
  }, [])

  return { running: snapshot, refresh }
}
