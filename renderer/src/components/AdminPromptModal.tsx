import { Button } from "@/components/ui/button"
import { ShieldAlert } from "lucide-react"

type AdminPromptModalProps = {
  open: boolean
  gameName: string
  onRunAsAdmin: () => void
  onContinueWithoutAdmin: () => void
  onClose: () => void
}

export function AdminPromptModal({
  open,
  gameName,
  onRunAsAdmin,
  onContinueWithoutAdmin,
  onClose
}: AdminPromptModalProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-background/40 backdrop-blur-sm animate-in fade-in duration-300 ease-out" onClick={onClose} />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-border/60 bg-card/95 p-6 text-foreground shadow-2xl animate-in slide-in-from-top-4 duration-300 ease-out">
        <div className="flex items-center gap-3 mb-4">
          <ShieldAlert className="w-6 h-6 text-amber-400 flex-shrink-0" />
          <div className="text-lg font-semibold">Run as Administrator?</div>
        </div>

        <p className="text-sm text-muted-foreground mb-6">
          It's recommended to launch <span className="text-primary font-medium">{gameName}</span> with administrator privileges for the best experience and to avoid potential compatibility issues.
        </p>

        <div className="space-y-3">
          <Button
            onClick={onRunAsAdmin}
            className="w-full"
          >
            Run as Admin
          </Button>
          <Button
            onClick={onContinueWithoutAdmin}
            variant="outline"
            className="w-full"
          >
            Continue without Admin
          </Button>
        </div>
      </div>
    </div>
  )
}
