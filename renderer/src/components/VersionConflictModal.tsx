import { Button } from "@/components/ui/button"
import { AlertTriangle, Download, RefreshCw } from "lucide-react"

type Props = {
  open: boolean
  installedVersionLabel: string
  selectedVersionLabel: string
  onInstallSideBySide: () => void
  onOverwrite: () => void
  onClose: () => void
}

export function VersionConflictModal({
  open,
  installedVersionLabel,
  selectedVersionLabel,
  onInstallSideBySide,
  onOverwrite,
  onClose,
}: Props) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md rounded-2xl border border-border/60 bg-slate-950/95 p-6 text-white shadow-2xl">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <AlertTriangle className="h-5 w-5 text-primary" />
          Version Already Installed
        </div>

        <p className="mt-3 text-sm text-slate-300 leading-relaxed">
          You currently have <span className="font-semibold text-foreground">{installedVersionLabel}</span> installed.
          Do you wish to install the <span className="font-semibold text-foreground">{selectedVersionLabel}</span> version?
        </p>

        <div className="mt-5 flex flex-col gap-2">
          <Button
            className="w-full justify-start gap-2 rounded-xl"
            onClick={onInstallSideBySide}
          >
            <Download className="h-4 w-4" />
            Download &amp; Install
            <span className="ml-auto text-xs text-primary-foreground/60">keeps current version</span>
          </Button>

          <Button
            variant="outline"
            className="w-full justify-start gap-2 rounded-xl border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onOverwrite}
          >
            <RefreshCw className="h-4 w-4" />
            Download &amp; Overwrite
            <span className="ml-auto text-xs text-muted-foreground">replaces current version</span>
          </Button>
        </div>

        <div className="mt-3 flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
