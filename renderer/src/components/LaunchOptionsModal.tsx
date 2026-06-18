import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Terminal } from "@/components/icons"
import { apiFetch } from "@/lib/api"

type Props = {
  open: boolean
  appid: string
  gameName: string
  onClose: () => void
}

// Steam/admin-curated config from the game record (the authoritative list).
type OfficialOption = {
  exe: string
  args: string
  label: string
  oslist: string
  recommended: boolean
}

// A config another player explicitly published.
type CommunityOption = {
  exe: string
  args: string
  count: number
  mine?: boolean
}

/**
 * Per-game "Launch options" — like Steam's custom launch arguments. The string
 * is split on whitespace by the main process (honouring quoted tokens) and
 * appended to the resolved argv at spawn time. Persisted under
 * settings.gameLaunchArgs[appid].
 *
 * Surfaces two sources of suggestions from union-crax.xyz:
 *   - Official launch options — the exes/args admins pulled from Steam (one is
 *     recommended). These are pre-filled and shown first.
 *   - Community launch options — configs other players chose to publish.
 * Sharing is never automatic: the user publishes their own config explicitly
 * via the "Publish to community" button.
 */
export function LaunchOptionsModal({ open, appid, gameName, onClose }: Props) {
  const [args, setArgs] = useState("")
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [exeBasename, setExeBasename] = useState("")
  const [official, setOfficial] = useState<OfficialOption[]>([])
  const [community, setCommunity] = useState<CommunityOption[]>([])
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [publishState, setPublishState] = useState<"idle" | "publishing" | "done" | "error">("idle")

  useEffect(() => {
    if (!open || !appid) return
    let cancelled = false
    setLoaded(false)
    setOfficial([])
    setCommunity([])
    setPublishState("idle")
    void (async () => {
      let localArgs = ""
      try {
        const map = await window.ucSettings?.get?.("gameLaunchArgs")
        localArgs = map && typeof map === "object" && !Array.isArray(map)
          ? ((map as Record<string, string>)[appid] || "")
          : ""
        const savedExe = await window.ucSettings?.get?.(`gameExe:${appid}`)
        if (cancelled) return
        setArgs(typeof localArgs === "string" ? localArgs : "")
        const exePath = typeof savedExe === "string" ? savedExe : ""
        setExeBasename(exePath ? exePath.split(/[\\/]/).pop() || "" : "")
      } catch { /* ignore */ } finally {
        if (!cancelled) setLoaded(true)
      }

      setOptionsLoading(true)
      try {
        const res = await apiFetch(`/api/games/${appid}/launch-options`)
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (res.ok && json?.success) {
          const off: OfficialOption[] = Array.isArray(json.official) ? json.official : []
          const com: CommunityOption[] = Array.isArray(json.community) ? json.community : []
          setOfficial(off)
          setCommunity(com)
          // Pre-fill the recommended official args only when the user has none.
          if (!cancelled && !(typeof localArgs === "string" && localArgs.trim())) {
            const rec = off.find((o) => o.recommended) || off[0]
            if (rec && rec.args) setArgs(rec.args)
          }
        }
      } catch { /* offline / signed-out — local args still work */ } finally {
        if (!cancelled) setOptionsLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, appid])

  const handleSave = async () => {
    if (!appid) return
    setSaving(true)
    try {
      // Save is local only — it never publishes anything to the community.
      const trimmed = args.trim()
      const current = await window.ucSettings?.get?.("gameLaunchArgs")
      const next: Record<string, string> = (current && typeof current === "object" && !Array.isArray(current))
        ? { ...(current as Record<string, string>) }
        : {}
      if (trimmed) next[appid] = trimmed
      else delete next[appid]
      await window.ucSettings?.set?.("gameLaunchArgs", next)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const handlePublish = async () => {
    if (!appid || !exeBasename) return
    setPublishState("publishing")
    try {
      const res = await apiFetch(`/api/games/${appid}/launch-options`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exe: exeBasename, args: args.trim() }),
      })
      if (res.ok) {
        setPublishState("done")
        // Reflect the new entry locally so the user sees it immediately.
        setCommunity((prev) => {
          const key = `${exeBasename} ${args.trim()}`
          if (prev.some((c) => `${c.exe} ${c.args}` === key)) {
            return prev.map((c) => (`${c.exe} ${c.args}` === key ? { ...c, mine: true } : c))
          }
          return [{ exe: exeBasename, args: args.trim(), count: 1, mine: true }, ...prev]
        })
      } else {
        setPublishState("error")
      }
    } catch {
      setPublishState("error")
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Terminal className="h-4 w-4 text-foreground/80" />
            Launch options
          </DialogTitle>
          <DialogDescription>
            Extra command-line arguments to pass to {gameName} when it launches. Use double quotes around values with spaces, e.g. <code className="text-amber-200">--mod "My Mod"</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/80" htmlFor="launch-args-input">
            Arguments
          </label>
          <textarea
            id="launch-args-input"
            value={args}
            onChange={(event) => { setArgs(event.target.value); setPublishState("idle") }}
            placeholder="--fullscreen --novid"
            rows={3}
            spellCheck={false}
            autoComplete="off"
            className="w-full rounded-xl border border-white/[.07] bg-white/[.03] px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/80 outline-none focus-visible:border-white/20"
            disabled={!loaded}
          />
          <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
            Leave blank to launch with no extra arguments. Bad arguments can crash the game on launch — clear this field and relaunch if the game stops opening.
          </p>
        </div>

        {official.length > 0 && (
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
              Official launch options
            </label>
            <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
              {official.map((option, idx) => (
                <button
                  key={`off-${option.exe}|${option.args}|${idx}`}
                  type="button"
                  onClick={() => { setArgs(option.args || ""); setPublishState("idle") }}
                  className="group flex w-full items-start gap-2 rounded-lg border border-white/[.07] bg-white/[.02] px-3 py-2 text-left transition-colors hover:border-white/20 hover:bg-white/[.05]"
                  title="Use these arguments"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-mono text-xs text-foreground/90">{option.label}</span>
                      {option.recommended && (
                        <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-300">Recommended</span>
                      )}
                      {option.oslist && option.oslist.toLowerCase() !== "windows" && (
                        <span className="shrink-0 rounded-full bg-white/[.06] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground/70">{option.oslist}</span>
                      )}
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground/80">
                      {option.args ? option.args : <span className="italic">no arguments</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {(optionsLoading || community.length > 0) && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
                Community launch options
              </label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="About community launch options"
                    className="flex h-4 w-4 items-center justify-center rounded-full border border-white/20 text-[10px] font-bold leading-none text-muted-foreground/70 transition-colors hover:border-white/40 hover:text-foreground/90"
                  >
                    ?
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-[240px] text-[11px] leading-snug">
                  Submitted by other players and not verified — quality and reliability may not be great. The official options above are the recommended ones.
                </TooltipContent>
              </Tooltip>
            </div>
            {optionsLoading && community.length === 0 ? (
              <p className="text-[11px] text-muted-foreground/70">Loading…</p>
            ) : (
              <div className="max-h-36 space-y-1.5 overflow-y-auto pr-1">
                {community.map((option, idx) => (
                  <button
                    key={`com-${option.exe}|${option.args}|${idx}`}
                    type="button"
                    onClick={() => { setArgs(option.args || ""); setPublishState("idle") }}
                    className="group flex w-full items-start gap-2 rounded-lg border border-white/[.07] bg-white/[.02] px-3 py-2 text-left transition-colors hover:border-white/20 hover:bg-white/[.05]"
                    title="Use these arguments"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-mono text-xs text-foreground/90">{option.exe}</span>
                        {option.mine && (
                          <span className="shrink-0 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-300">Yours</span>
                        )}
                      </div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground/80">
                        {option.args ? option.args : <span className="italic">no arguments</span>}
                      </div>
                    </div>
                    {option.count > 1 && (
                      <span className="mt-0.5 shrink-0 text-[10px] text-muted-foreground/60">{option.count}×</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Explicit, opt-in sharing — nothing leaves the machine unless clicked. */}
        <div className="flex items-center justify-between gap-2 rounded-lg border border-white/[.06] bg-white/[.02] px-3 py-2">
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-foreground/80">Share with the community</div>
            <div className="text-[10px] text-muted-foreground/70 leading-snug">
              {exeBasename
                ? <>Publishes <span className="font-mono">{exeBasename}</span> + your arguments so other players can use them.</>
                : <>Set this game&apos;s executable first to publish a config.</>}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={handlePublish}
            disabled={!exeBasename || publishState === "publishing" || publishState === "done"}
          >
            {publishState === "publishing" ? "Publishing…" : publishState === "done" ? "Published ✓" : publishState === "error" ? "Retry" : "Publish to community"}
          </Button>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !loaded}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
