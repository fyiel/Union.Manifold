import { useCallback, useEffect, useMemo, useState } from "react"
import { LoaderCircle, LogOut, TriangleAlert, WandSparkles, Zap } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type Props = {
  appid: string
  title: string
  steamAppid?: number
  onClose: () => void
  onLaunch: () => void | Promise<void>
}


export function WandTrainerModal({ appid, title, steamAppid, onClose, onLaunch }: Props) {
  const [result, setResult] = useState<WandTrainerResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [starting, setStarting] = useState(false)
  const [active, setActive] = useState(false)
  const [sending, setSending] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, number>>({})
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const response = await window.ucWand?.trainer(title, steamAppid)
      setResult(response || { ok: false, supported: false, error: "Wand integration is unavailable" })
      if (response?.error && !response.needsAuth) setError(response.error)
    } catch (cause) {
      setError(String(cause))
    } finally {
      setLoading(false)
      setConnecting(false)
    }
  }, [steamAppid, title])

  useEffect(() => { void load() }, [load])
  useEffect(() => window.ucWand?.onAuthChanged((event) => {
    if (event.ok) void load()
    else {
      setConnecting(false)
      setError(event.error || "Wand login failed")
    }
  }), [load])
  useEffect(() => {
    if (!connecting) return
    const timeout = window.setTimeout(() => {
      setConnecting(false)
      setError("Wand did not return to Manifold. Try signing in again.")
    }, 60_000)
    return () => window.clearTimeout(timeout)
  }, [connecting])
  useEffect(() => window.ucWand?.onRuntime((event) => {
    if (event.appid !== appid) return
    if (event.status === "active") {
      setActive(true)
      setStarting(false)
    }
    if (event.status === "value" && event.name && typeof event.value === "number") {
      setValues((current) => ({ ...current, [event.name!]: event.value! }))
    }
    if (event.status === "error") {
      setActive(false)
      setStarting(false)
      setError(event.message || "Wand trainer stopped")
    }
    if (event.status === "stopped") {
      setActive(false)
      setStarting(false)
    }
  }), [appid])

  const groups = useMemo(() => {
    const grouped = new Map<string, WandControl[]>()
    for (const control of result?.controls || []) {
      const category = control.category || "General"
      grouped.set(category, [...(grouped.get(category) || []), control])
    }
    return [...grouped]
  }, [result?.controls])

  const connect = async () => {
    setConnecting(true)
    setError("")
    try {
      const response = await window.ucWand?.connect()
      if (!response?.ok) throw new Error(response?.error || "Could not open Wand login")
    } catch (cause) {
      setConnecting(false)
      setError(String(cause))
    }
  }

  const disconnect = async () => {
    await window.ucWand?.stop(appid)
    await window.ucWand?.disconnect()
    setActive(false)
    setResult((current) => current ? { ...current, authenticated: false, needsAuth: true, controls: [] } : current)
  }

  const start = async () => {
    setStarting(true)
    setError("")
    try {
      await onLaunch()
      const response = await window.ucWand?.launch(appid, title, steamAppid)
      if (!response?.ok) throw new Error(response?.error || "Could not start the Wand trainer")
    } catch (cause) {
      void window.ucWand?.stop(appid)
      setStarting(false)
      setError(String(cause))
    }
  }

  const sendValue = async (control: WandControl, value: number) => {
    if (!active) return
    setSending(control.uuid)
    setError("")
    try {
      const response = await window.ucWand?.control(appid, control.target, value)
      if (!response?.ok) throw new Error(response?.error || "Could not set trainer value")
      setValues((current) => ({ ...current, [control.target]: value }))
    } catch (cause) {
      setError(String(cause))
    } finally {
      window.setTimeout(() => setSending(null), 180)
    }
  }

  const activate = (control: WandControl) => {
    const action = control.kind === "button" || control.kind === "action"
    void sendValue(control, action ? 1 : values[control.target] ? 0 : 1)
  }

  const close = () => {
    if (active || starting) void window.ucWand?.stop(appid)
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent className="sm:max-w-2xl max-h-[82vh] flex flex-col overflow-hidden p-0 gap-0">
        <DialogHeader className="border-b border-white/[.07] px-6 py-5 pr-14">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg border border-white/10 bg-white/[.05] p-2 text-white">
              <WandSparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-base">{result?.game?.name || title} trainer</DialogTitle>
              <DialogDescription className="mt-1">
                Wand assists run through Manifold. No separate Wand installation or window.
              </DialogDescription>
            </div>
            {result?.authenticated && (
              <button type="button" onClick={() => void disconnect()} className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground">
                <LogOut className="h-3.5 w-3.5" /> Disconnect
              </button>
            )}
          </div>
        </DialogHeader>

        <div role="status" className="flex items-center gap-2 border-b border-yellow-400/15 bg-yellow-400/[.06] px-6 py-2.5 font-mono text-[10px] leading-4 text-yellow-300/85">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          Experimental: trainer attachment may fail or stop responding.
        </div>

        <div className="mf-scroll min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex h-44 items-center justify-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" /> Loading trainer…
            </div>
          ) : result?.needsAuth || !result?.authenticated ? (
            <div className="flex min-h-52 flex-col items-center justify-center text-center">
              <WandSparkles className="mb-4 h-7 w-7 text-muted-foreground" strokeWidth={1.4} />
              <div className="text-sm font-medium text-foreground">Connect your Wand account</div>
              <p className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">
                Your browser handles Wand sign-in, then returns here. Manifold stores the session locally and uses it only for trainer access.
              </p>
              <button type="button" disabled={connecting} onClick={() => void connect()} className="mt-5 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-60">
                {connecting ? "Waiting for browser…" : "Connect Wand"}
              </button>
            </div>
          ) : (
            <>
              <div className="mb-5 flex items-center justify-between gap-4 rounded-xl border border-white/[.07] bg-white/[.025] px-4 py-3">
                <div>
                  <div className="text-xs font-medium text-foreground">{active ? "Trainer running" : "Trainer ready"}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {active ? "Changes are sent directly to the running trainer." : "Manifold launches the game, then attaches the trainer."}
                  </div>
                </div>
                <button type="button" disabled={starting || active} onClick={() => void start()} className="flex shrink-0 items-center gap-2 rounded-lg bg-white px-3.5 py-2 text-xs font-semibold text-black disabled:opacity-50">
                  {starting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                  {active ? "Running" : starting ? "Starting…" : "Start trainer"}
                </button>
              </div>

              {groups.length === 0 ? (
                <div className="py-10 text-center text-xs text-muted-foreground">This trainer did not publish any controls.</div>
              ) : groups.map(([category, controls]) => (
                <section key={category} className="mb-5 last:mb-0">
                  <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">{category}</h3>
                  <div className="overflow-hidden rounded-xl border border-white/[.07]">
                    {controls.map((control) => {
                      const on = Boolean(values[control.target])
                      const numeric = control.kind === "number" || control.kind === "input"
                      return (
                        <div key={control.uuid} className="flex w-full items-center gap-3 border-b border-white/[.06] px-4 py-3 last:border-0">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${on ? "bg-emerald-400" : "bg-white/20"}`} />
                          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{control.name}</span>
                          {numeric ? (
                            <input
                              type="number"
                              disabled={!active || sending === control.uuid}
                              value={values[control.target] ?? 0}
                              onChange={(event) => setValues((current) => ({ ...current, [control.target]: Number(event.target.value) }))}
                              onBlur={(event) => void sendValue(control, Number(event.target.value))}
                              onKeyDown={(event) => { if (event.key === "Enter") void sendValue(control, Number(event.currentTarget.value)) }}
                              className="w-24 rounded-md border border-white/10 bg-black/20 px-2 py-1 text-right font-mono text-[11px] text-foreground disabled:opacity-50"
                            />
                          ) : (
                            <button type="button" disabled={!active || sending === control.uuid} onClick={() => activate(control)} className="rounded-md border border-white/10 px-2.5 py-1 font-mono text-[10px] text-muted-foreground hover:bg-white/[.04] disabled:cursor-default disabled:opacity-50">
                              {sending === control.uuid ? "sending" : control.kind === "button" || control.kind === "action" ? "run" : on ? "on" : "off"}
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </section>
              ))}
            </>
          )}
          {error && <div className="mt-4 rounded-lg border border-red-400/20 bg-red-400/[.07] px-3 py-2 text-xs leading-5 text-red-300">{error}</div>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
