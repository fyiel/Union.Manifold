import { useCallback, useEffect, useState } from "react"

let cache: Set<string> = new Set()
let hydratedAt = 0
let hydrating: Promise<void> | null = null
const listeners = new Set<() => void>()

const sessionStartTimes = new Map<string, number>()

function notify() {
  for (const listener of listeners) {
    try { listener() } catch {  }
  }
}

function setCache(next: Set<string>) {
  for (const appid of next) {
    if (!cache.has(appid) && !sessionStartTimes.has(appid)) {
      sessionStartTimes.set(appid, Date.now())
    }
  }
  for (const appid of cache) {
    if (!next.has(appid)) {
      sessionStartTimes.delete(appid)
    }
  }

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
  if (!force && hydratedAt && Date.now() - hydratedAt < 30_000) return
  hydrating = (async () => {
    try {
      const result = await window.ucDownloads?.listRunningGameAppids?.()
      if (result?.ok) {
        setCache(new Set(result.appids || []))
        hydratedAt = Date.now()
      }
    } catch {  } finally {
      hydrating = null
    }
  })()
  return hydrating
}

let presenceWired = false
function ensurePresenceSubscription() {
  if (presenceWired || typeof window === "undefined") return
  presenceWired = true
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
  window.addEventListener("focus", () => { void hydrate(true) })
}

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

export function refreshRunningGames() {
  return hydrate(true)
}

export function setRunningOptimistic(appid: string, running: boolean) {
  if (!appid) return
  if (running === cache.has(appid)) return
  const next = new Set(cache)
  if (running) next.add(appid)
  else next.delete(appid)
  setCache(next)
}

export function isRunningGameSync(appid: string): boolean {
  return cache.has(appid)
}

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
