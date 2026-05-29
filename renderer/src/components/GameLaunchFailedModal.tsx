import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AlertTriangle, Info, Settings2 } from "@/components/icons"

type GameLaunchFailedModalProps = {
  open: boolean
  gameName: string
  onClose: () => void
  /** Optional: opens the executable picker for the failed game. When
   *  provided, the modal shows a primary "Pick executable" action so users
   *  don't have to dig through the gear menu to fix a wrong-exe launch. */
  onPickExecutable?: () => void
}

export function GameLaunchFailedModal({
  open,
  gameName,
  onClose,
  onPickExecutable,
}: GameLaunchFailedModalProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            Game couldn't start
          </DialogTitle>
          <DialogDescription>
            Looks like {gameName} couldn't start correctly. This is almost
            always because UC.D picked the wrong .exe to launch (e.g. an
            installer, redistributable, or launcher stub instead of the game
            itself).
          </DialogDescription>
        </DialogHeader>

        {/* Beta notice — UC.D does not yet have automatic exe-correctness
            detection, so the user is the one who decides which exe is right. */}
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[.06] px-3 py-2.5 text-xs text-amber-100">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
          <p className="leading-relaxed">
            UC.D currently has no system to determine if the right executable
            was chosen for launch — we're working on it. For now, please pick
            the executable manually before relaunching.
          </p>
        </div>

        <div className="rounded-xl border border-white/[.07] bg-white/[.03] px-3 py-2.5 text-xs text-foreground/80 leading-relaxed">
          <p className="font-semibold text-foreground mb-1">How to pick the right exe</p>
          <ol className="list-decimal pl-4 space-y-1">
            <li>Click <span className="font-medium text-foreground">Pick executable</span> below (or the gear icon next to Play).</li>
            <li>Choose the file that looks like the game's main launcher —
              usually the largest .exe in the game folder, often named after the game.</li>
            <li>Avoid anything starting with <code className="text-amber-200">unins</code>, <code className="text-amber-200">setup</code>, <code className="text-amber-200">vc_redist</code>, <code className="text-amber-200">dxsetup</code>, or anything in a <code className="text-amber-200">_CommonRedist</code> folder.</li>
          </ol>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Dismiss
          </Button>
          {onPickExecutable && (
            <Button size="sm" onClick={() => { onClose(); onPickExecutable() }}>
              <Settings2 className="h-3.5 w-3.5 mr-1.5" />
              Pick executable
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
