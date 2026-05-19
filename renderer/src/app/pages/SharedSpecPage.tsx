import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Cpu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiFetch } from "@/lib/api"
import { SystemProfileCard } from "@/components/SystemProfileCard"

type SharedSpecPayload = {
  ok: true
  tier: "summary" | "full"
  summary: string | null
  spec: any
  fingerprint: string
  capturedAt: string
  viewCount: number
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; data: SharedSpecPayload }
  | { kind: "not-found" }
  | { kind: "error"; message: string }

export function SharedSpecPage() {
  const navigate = useNavigate()
  const { shortCode = "" } = useParams<{ shortCode: string }>()
  const [state, setState] = useState<State>({ kind: "loading" })

  useEffect(() => {
    let cancelled = false
    if (!/^[A-Za-z0-9]{4,32}$/.test(shortCode)) {
      setState({ kind: "not-found" })
      return
    }
    void (async () => {
      try {
        const res = await apiFetch(`/api/profile/system/share/${encodeURIComponent(shortCode)}`)
        if (cancelled) return
        if (res.status === 404) {
          setState({ kind: "not-found" })
          return
        }
        if (!res.ok) {
          setState({ kind: "error", message: `Failed to load share (status ${res.status})` })
          return
        }
        const data = (await res.json()) as SharedSpecPayload
        if (!data?.ok) {
          setState({ kind: "not-found" })
          return
        }
        setState({ kind: "ready", data })
      } catch (e: any) {
        if (!cancelled) setState({ kind: "error", message: e?.message || "Failed to load share" })
      }
    })()
    return () => { cancelled = true }
  }, [shortCode])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
      </div>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-zinc-100">Shared PC specs</h1>
        <p className="text-sm text-zinc-400">
          A UnionCrax user shared this hardware snapshot via a short link. The
          specs shown are frozen as of the scan date.
        </p>
      </header>

      {state.kind === "loading" && (
        <div className="rounded-3xl border border-white/[.07] bg-zinc-900/40 p-6 text-sm text-zinc-400">
          Loading…
        </div>
      )}

      {state.kind === "not-found" && (
        <div className="rounded-3xl border border-white/[.07] bg-zinc-900/40 p-6 text-sm text-zinc-400">
          This share link doesn't exist or has been revoked.
        </div>
      )}

      {state.kind === "error" && (
        <div className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-6 text-sm text-rose-200">
          {state.message}
        </div>
      )}

      {state.kind === "ready" && (
        <SystemProfileCard
          tier={state.data.tier}
          summary={state.data.summary}
          spec={state.data.spec}
          fingerprint={state.data.fingerprint}
          capturedAt={state.data.capturedAt}
        />
      )}

      <p className="text-[11px] text-zinc-500 text-center inline-flex items-center justify-center gap-1.5 w-full">
        <Cpu className="h-3 w-3" />
        Want one of these for your own PC? Open Settings → System Profile and scan your hardware.
      </p>
    </div>
  )
}
