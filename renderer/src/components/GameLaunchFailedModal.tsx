import { Button } from "@/components/ui/button"
import { AlertTriangle, Shield } from "lucide-react"

type GameLaunchFailedModalProps = {
  open: boolean
  gameName: string
  isWindows: boolean
  adminAlreadyEnabled: boolean
  onEnableAdmin?: () => void
  onClose: () => void
}

export function GameLaunchFailedModal({
  open,
  gameName,
  isWindows,
  adminAlreadyEnabled,
  onEnableAdmin,
  onClose,
}: GameLaunchFailedModalProps) {
  if (!open) return null

  // Only suggest admin on Windows when it's not already enabled
  const showAdminSuggestion = isWindows && !adminAlreadyEnabled

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-background/40 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-border/60 bg-card/95 p-5 text-foreground shadow-2xl animate-in slide-in-from-top-4 duration-300 ease-out">
        <div className="flex items-center gap-3 mb-2">
          <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0" />
          <div className="text-base font-semibold">Game couldn't start</div>
        </div>

        <p className="text-sm text-muted-foreground mb-3">
          Looks like your game couldn't start correctly. Make sure the correct
          executable is selected using the{" "}
          <span className="font-medium text-foreground">gear icon</span> next to
          the Play button.
        </p>

        {showAdminSuggestion && (
          <p className="text-sm text-muted-foreground mb-4">
            If the issue persists, try enabling{" "}
            <span className="font-semibold text-foreground">
              Launch as Administrator
            </span>
            . {gameName} may require admin privileges to start correctly.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Dismiss
          </Button>
          {showAdminSuggestion && onEnableAdmin && (
            <Button size="sm" onClick={onEnableAdmin} className="gap-1.5">
              <Shield className="h-4 w-4" />
              Enable Admin Launch
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
