import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { PreferredDownloadHost } from "@/lib/downloads"

type HostOption = {
  key: PreferredDownloadHost
  label: string
  tag?: "beta" | "soon"
}

const HOST_OPTIONS: HostOption[] = [
  { key: "pixeldrain", label: "Pixeldrain" },
  { key: "rootz", label: "Rootz", tag: "beta" },
]

type DownloadHostModalProps = {
  open: boolean
  selectedHost: PreferredDownloadHost
  defaultHost: PreferredDownloadHost
  onSelect: (host: PreferredDownloadHost) => void
  onConfirm: (dontShowAgain: boolean) => void
  onClose: () => void
}

export function DownloadHostModal({
  open,
  selectedHost,
  defaultHost,
  onSelect,
  onConfirm,
  onClose,
}: DownloadHostModalProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false)

  if (!open) return null

  const defaultLabel = HOST_OPTIONS.find((h) => h.key === defaultHost)?.label || defaultHost
  const selectedLabel = HOST_OPTIONS.find((h) => h.key === selectedHost)?.label || selectedHost

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-border/60 bg-slate-950/95 p-5 text-white shadow-2xl">
        <div className="text-lg font-semibold">Choose download host</div>
        <p className="mt-1 text-sm text-slate-300">
          Leave it as the default ({defaultLabel}) or pick a different host for this download.
        </p>

        <div className="mt-4 space-y-3">
          <label className="text-sm font-medium text-slate-200">Host</label>
          <Select value={selectedHost} onValueChange={(v) => onSelect(v as PreferredDownloadHost)}>
            <SelectTrigger className="h-12 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOST_OPTIONS.map((h) => (
                <SelectItem key={h.key} value={h.key}>
                  <div className="flex items-center justify-between w-full">
                    <span>{h.label}</span>
                    {h.tag ? (
                      <span
                        className={`ml-2 inline-block text-[10px] font-medium px-2 py-0.5 rounded-full ${
                          h.tag === "beta" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-800"
                        }`}
                      >
                        {h.tag}
                      </span>
                    ) : null}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedHost === "rootz" && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              Download resuming is currently not supported for this host. Please do not close the app while
              downloading with Rootz.
            </div>
          )}

          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={() => setDontShowAgain(!dontShowAgain)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                dontShowAgain ? "bg-primary" : "bg-slate-700"
              }`}
              title="Don't show this dialog again"
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                  dontShowAgain ? "translate-x-4" : "translate-x-1"
                }`}
              />
            </button>
            <label className="text-sm text-slate-300 cursor-pointer select-none">
              Don't show this again
            </label>
          </div>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(dontShowAgain)}>Download with {selectedLabel}</Button>
        </div>
      </div>
    </div>
  )
}
