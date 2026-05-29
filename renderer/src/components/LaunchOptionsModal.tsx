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
import { Terminal } from "@/components/icons"

type Props = {
  open: boolean
  appid: string
  gameName: string
  onClose: () => void
}

/**
 * Per-game "Launch options" — same idea as Steam's custom launch arguments.
 * The string is split on whitespace by the main process (honouring single
 * and double quoted tokens) and appended to the resolved argv at spawn time.
 * Persisted under settings.gameLaunchArgs[appid].
 */
export function LaunchOptionsModal({ open, appid, gameName, onClose }: Props) {
  const [args, setArgs] = useState("")
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !appid) return
    let cancelled = false
    setLoaded(false)
    void (async () => {
      try {
        const map = await window.ucSettings?.get?.("gameLaunchArgs")
        if (cancelled) return
        const value = map && typeof map === "object" && !Array.isArray(map) ? (map as Record<string, string>)[appid] : ""
        setArgs(typeof value === "string" ? value : "")
      } catch { /* ignore */ } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [open, appid])

  const handleSave = async () => {
    if (!appid) return
    setSaving(true)
    try {
      const current = await window.ucSettings?.get?.("gameLaunchArgs")
      const next: Record<string, string> = (current && typeof current === "object" && !Array.isArray(current))
        ? { ...(current as Record<string, string>) }
        : {}
      const trimmed = args.trim()
      if (trimmed) next[appid] = trimmed
      else delete next[appid]
      await window.ucSettings?.set?.("gameLaunchArgs", next)
      onClose()
    } finally {
      setSaving(false)
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
            onChange={(event) => setArgs(event.target.value)}
            placeholder="--fullscreen --novid"
            rows={3}
            spellCheck={false}
            autoComplete="off"
            className="w-full rounded-xl border border-white/[.07] bg-white/[.03] px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/80 outline-none focus-visible:border-white/20"
            disabled={!loaded}
          />
          <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
            Leave blank to launch the game with no extra arguments. Bad arguments can crash the game on launch — clear this field and relaunch if the game stops opening.
          </p>
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
