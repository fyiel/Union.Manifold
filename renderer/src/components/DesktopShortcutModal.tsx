import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ExternalLink } from "lucide-react"

type DesktopShortcutModalProps = {
  open: boolean
  gameName: string
  onCreateShortcut: () => void
  onSkip: () => void
  onClose: () => void
}

export function DesktopShortcutModal({ open, gameName, onCreateShortcut, onSkip, onClose }: DesktopShortcutModalProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ExternalLink className="h-5 w-5 text-primary" />
            Create Desktop Shortcut?
          </DialogTitle>
          <DialogDescription className="text-left pt-2">
            Would you like to create a desktop shortcut for <span className="font-semibold text-foreground">{gameName}</span>? This will allow you to launch the game directly from your desktop.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button
            variant="outline"
            onClick={onSkip}
            className="flex-1 sm:flex-none"
          >
            No, thanks
          </Button>
          <Button
            onClick={onCreateShortcut}
            className="flex-1 sm:flex-none"
          >
            Create Shortcut
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
