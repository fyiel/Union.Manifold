import { Button } from "@/components/ui/button"
import { AlertTriangle } from "lucide-react"

type Props = {
  open: boolean
  onProceed: () => void
  onClose: () => void
}

export function UpdateBackupWarningModal({ open, onProceed, onClose }: Props) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md rounded-2xl border border-border/60 bg-card/95 p-6 text-foreground shadow-2xl">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <AlertTriangle className="h-5 w-5 text-amber-400" />
          Backup your game data first
        </div>

        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
          Please backup your game data before updating. As sometimes game saves are stored inside the game files. For help, join our Discord server.
        </p>

        <div className="mt-5 flex flex-col gap-2">
          <Button
            className="w-full justify-center rounded-xl"
            onClick={onProceed}
          >
            Got it, Proceed with Update
          </Button>

          <Button
            variant="ghost"
            className="w-full rounded-xl"
            onClick={onClose}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
