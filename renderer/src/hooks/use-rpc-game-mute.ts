import { useCallback, useEffect, useState } from "react"

/**
 * Subscribe to the per-game Discord RPC mute setting (`rpcMutedAppids` in
 * ucSettings — a `Record<appid, true>`). When `muted` is true UC.D suppresses
 * the Playing-X presence card for that specific game. The global
 * `discordRpcEnabled` toggle and the NSFW mask still apply on top.
 */
export function useRpcGameMute(appid: string | null | undefined): {
  muted: boolean
  toggle: () => Promise<void>
} {
  const [muted, setMuted] = useState(false)

  useEffect(() => {
    if (!appid) {
      setMuted(false)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const value = await window.ucSettings?.get?.("rpcMutedAppids")
        if (cancelled) return
        const map = (value && typeof value === "object" && !Array.isArray(value)) ? value as Record<string, true> : {}
        setMuted(map[appid] === true)
      } catch { /* ignore */ }
    })()
    const off = window.ucSettings?.onChanged?.((data: any) => {
      if (!data || cancelled) return
      if (data.key === "__CLEAR_ALL__") {
        setMuted(false)
        return
      }
      if (data.key !== "rpcMutedAppids") return
      const map = (data.value && typeof data.value === "object" && !Array.isArray(data.value)) ? data.value as Record<string, true> : {}
      setMuted(map[appid] === true)
    })
    return () => {
      cancelled = true
      if (typeof off === "function") off()
    }
  }, [appid])

  const toggle = useCallback(async () => {
    if (!appid) return
    try {
      const current = await window.ucSettings?.get?.("rpcMutedAppids")
      const next: Record<string, true> = (current && typeof current === "object" && !Array.isArray(current))
        ? { ...(current as Record<string, true>) }
        : {}
      if (next[appid]) delete next[appid]
      else next[appid] = true
      await window.ucSettings?.set?.("rpcMutedAppids", next)
      setMuted(next[appid] === true)
    } catch { /* fail silently — settings backend will surface its own errors */ }
  }, [appid])

  return { muted, toggle }
}
