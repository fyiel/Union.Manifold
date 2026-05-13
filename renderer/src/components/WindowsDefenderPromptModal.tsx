import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

type WindowsDefenderPromptModalProps = {
  open: boolean
  downloadPath: string
  onOpenSecurity: () => void
  onOpenFolder: () => void
  onDismiss: () => void
}

export function WindowsDefenderPromptModal({
  open,
  downloadPath,
  onOpenSecurity,
  onOpenFolder,
  onDismiss,
}: WindowsDefenderPromptModalProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onDismiss()}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Whitelist your game folder in Windows Defender</DialogTitle>
          <DialogDescription className="space-y-3 pt-2 text-left">
            <span className="block">
              UnionCrax.Direct stores downloads, installs, and extracted game files in this folder. Windows Defender can sometimes quarantine cracked or patched files before the install finishes.
            </span>
            <span className="block rounded-lg border border-white/[.07] bg-white/[.03] px-3 py-2 font-mono text-xs text-zinc-200">
              {downloadPath || "Download path not set yet"}
            </span>
            <span className="block">
              If Defender is interrupting installs, add this folder to your exclusions in Windows Security. If you add external games elsewhere, exclude those folders too.
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button
            variant="outline"
            onClick={onDismiss}
            className="flex-1 sm:flex-none"
          >
            Dismiss
          </Button>
          <Button
            variant="outline"
            onClick={onOpenSecurity}
            className="flex-1 sm:flex-none"
          >
            Open Windows Security
          </Button>
          <Button
            onClick={onOpenFolder}
            className="flex-1 sm:flex-none"
          >
            Open folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}