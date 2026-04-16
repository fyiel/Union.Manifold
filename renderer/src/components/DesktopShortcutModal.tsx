import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { ExternalLink } from "lucide-react"
import { useEffect, useState } from "react"

type DesktopShortcutModalProps = {
  open: boolean
  gameName: string
  defaultAlwaysCreate?: boolean
  onCreateShortcut: (alwaysCreate: boolean) => void
  onSkip: (alwaysCreate: boolean) => void
  onClose: (alwaysCreate: boolean) => void
}

export function DesktopShortcutModal({
  open,
  gameName,
  defaultAlwaysCreate = false,
  onCreateShortcut,
  onSkip,
  onClose,
}: DesktopShortcutModalProps) {
  const [alwaysCreate, setAlwaysCreate] = useState(defaultAlwaysCreate)

  useEffect(() => {
    if (!open) return
    setAlwaysCreate(Boolean(defaultAlwaysCreate))
  }, [defaultAlwaysCreate, open])

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose(alwaysCreate)}>
      <DialogContent className="sm:max-w-md rounded-2xl border-white/[.07] bg-zinc-900/95 shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ExternalLink className="h-5 w-5 text-white" />
            Create Desktop Shortcut?
          </DialogTitle>
          <DialogDescription className="text-left pt-2">
            Would you like to create a desktop shortcut for <span className="font-semibold text-zinc-100">{gameName}</span>? This will allow you to launch the game directly from your desktop.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-2xl border border-white/[.07] bg-zinc-800/50 px-4 py-3 flex items-center gap-3">
          <Checkbox
            id="always-create-shortcut"
            checked={alwaysCreate}
            onCheckedChange={(checked) => setAlwaysCreate(checked === true)}
          />
          <Label htmlFor="always-create-shortcut" className="text-sm text-zinc-200 cursor-pointer leading-snug">
            Always create shortcuts on desktop
          </Label>
        </div>
        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button
            variant="outline"
            onClick={() => onSkip(alwaysCreate)}
            className="flex-1 sm:flex-none"
          >
            No, thanks
          </Button>
          <Button
            onClick={() => onCreateShortcut(alwaysCreate)}
            className="flex-1 sm:flex-none"
          >
            Create Shortcut
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

