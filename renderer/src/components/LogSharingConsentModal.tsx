import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

type LogSharingConsentModalProps = {
  open: boolean
  onAccept: () => void
  onDecline: () => void
}

export function LogSharingConsentModal({ open, onAccept, onDecline }: LogSharingConsentModalProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onDecline()}>
      <DialogContent className="sm:max-w-md rounded-2xl border-white/[.07] bg-zinc-900/95 shadow-2xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Share error reports?</DialogTitle>
          <DialogDescription className="text-left pt-2">
            When an error occurs, UC Direct can automatically send a redacted log snapshot to the UC Development team. This helps us find and fix bugs faster.
            <br /><br />
            No personal data or file paths are included. You can turn this off at any time in Settings.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button
            variant="outline"
            onClick={onDecline}
            className="flex-1 sm:flex-none"
          >
            No thanks
          </Button>
          <Button
            onClick={onAccept}
            className="flex-1 sm:flex-none"
          >
            Send error reports
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
