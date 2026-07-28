import { ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type ElevationPromptModalProps = {
  open: boolean
  gameName: string
  executablePath: string
  busy: boolean
  error?: string | null
  onCancel: () => void
  onConfirm: () => void
}

export function ElevationPromptModal({
  open,
  gameName,
  executablePath,
  busy,
  error,
  onCancel,
  onConfirm,
}: ElevationPromptModalProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onCancel() }}>
      <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-amber-500/15 p-2 text-amber-300">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base">Administrator access requested</DialogTitle>
              <DialogDescription className="mt-1 text-left">
                {gameName} asks Windows for administrator permission before it can start.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Executable
          </div>
          <div className="mt-1 break-all font-mono text-xs text-foreground/85">{executablePath}</div>
        </div>

        <p className="text-sm leading-6 text-foreground/80">
          Only continue if you trust this file. Administrator access lets it change protected
          files and system settings. Windows will show its standard permission prompt next.
        </p>

        {error ? (
          <div role="alert" className="rounded-xl border border-red-500/25 bg-red-500/[.07] px-3 py-2.5 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy} onClick={onConfirm}>
            <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />
            {busy ? "Waiting for Windows…" : "Launch as administrator"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
