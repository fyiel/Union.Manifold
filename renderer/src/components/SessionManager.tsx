import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { apiFetch } from "@/lib/api"
import { Monitor, Smartphone, Globe, LogOut, Loader2, RefreshCw, ShieldAlert } from "lucide-react"

type SessionInfo = {
  id: number | string
  deviceName: string | null
  deviceId: string | null
  lastIp: string | null
  lastActiveAt: string | null
  createdAt: string
  isCurrent: boolean
}

function DeviceIcon({ deviceName }: { deviceName: string | null }) {
  const name = (deviceName ?? "").toLowerCase()
  if (name.includes("mobile") || name.includes("android") || name.includes("iphone") || name.includes("ios")) {
    return <Smartphone className="h-4 w-4 text-zinc-400" />
  }
  if (name.includes("unioncrax.direct") || name.includes("electron") || name.includes("windows") || name.includes("linux") || name.includes("mac")) {
    return <Monitor className="h-4 w-4 text-zinc-400" />
  }
  return <Globe className="h-4 w-4 text-zinc-400" />
}

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return "Unknown"
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function SessionManager() {
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [revokingAll, setRevokingAll] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  const loadSessions = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const res = await apiFetch("/api/auth/sessions")
      if (!res.ok) {
        setError("Unable to load sessions.")
        return
      }
      const data = await res.json()
      setSessions(Array.isArray(data?.sessions) ? data.sessions : [])
    } catch {
      setError("Unable to load sessions.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  const revokeSession = async (sessionId: string | number) => {
    setRevoking(String(sessionId))
    setFeedback(null)
    try {
      const res = await apiFetch("/api/auth/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: String(sessionId) }),
      })
      if (res.ok) {
        setFeedback("Session signed out.")
        await loadSessions()
      } else {
        const data = await res.json()
        setFeedback(data?.error || "Failed to revoke session.")
      }
    } catch {
      setFeedback("Failed to revoke session.")
    } finally {
      setRevoking(null)
    }
  }

  const revokeAllOtherSessions = async () => {
    setRevokingAll(true)
    setFeedback(null)
    try {
      const res = await apiFetch("/api/auth/sessions", { method: "DELETE" })
      if (res.ok) {
        setFeedback("Signed out from all other devices.")
        await loadSessions()
      } else {
        const data = await res.json()
        setFeedback(data?.error || "Failed to sign out other devices.")
      }
    } catch {
      setFeedback("Failed to sign out other devices.")
    } finally {
      setRevokingAll(false)
    }
  }

  const otherSessions = sessions.filter((s) => !s.isCurrent)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-400">
          {loading ? "Loading sessions..." : `${sessions.length} active session${sessions.length !== 1 ? "s" : ""}`}
        </p>
        <Button variant="ghost" size="sm" className="gap-2 text-zinc-400" onClick={loadSessions} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {feedback && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/40 px-4 py-2 text-sm text-zinc-200">
          {feedback}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-zinc-500">No active sessions found.</p>
      ) : (
        <div className="space-y-2">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`rounded-xl border ${session.isCurrent ? "border-zinc-600 bg-zinc-800/40" : "border-white/[.07] bg-zinc-800/20"} p-4 flex items-center justify-between gap-4`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <DeviceIcon deviceName={session.deviceName} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-zinc-100 truncate">
                      {session.deviceName || "Unknown device"}
                    </span>
                    {session.isCurrent && (
                      <span className="text-[10px] font-semibold bg-zinc-700 text-zinc-200 px-1.5 py-0.5 rounded-full">
                        This device
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    {session.lastIp && (
                      <span className="text-xs text-zinc-500">{session.lastIp}</span>
                    )}
                    <span className="text-xs text-zinc-500">
                      Active {formatRelative(session.lastActiveAt)}
                    </span>
                  </div>
                </div>
              </div>
              {!session.isCurrent && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                  onClick={() => revokeSession(session.id)}
                  disabled={revoking === String(session.id) || revokingAll}
                >
                  {revoking === String(session.id) ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <LogOut className="h-3.5 w-3.5" />
                  )}
                  Sign Out
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && otherSessions.length > 1 && (
        <Button
          variant="outline"
          className="w-full gap-2 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
          onClick={revokeAllOtherSessions}
          disabled={revokingAll}
        >
          {revokingAll ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ShieldAlert className="h-4 w-4" />
          )}
          {revokingAll ? "Signing out..." : "Sign Out All Other Devices"}
        </Button>
      )}
    </div>
  )
}
