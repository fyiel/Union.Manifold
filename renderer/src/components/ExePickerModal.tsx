import { Button } from "@/components/ui/button"
import { isIgnoredEngineExecutableName } from "@/lib/utils"

type ExePickerModalProps = {
  open: boolean
  title: string
  message: string
  exes: Array<{ name: string; path: string }>
  currentExePath?: string | null
  actionLabel?: string
  onSelect: (path: string) => void
  onClose: () => void
}

export function ExePickerModal({ open, title, message, exes, currentExePath, actionLabel = "Launch", onSelect, onClose }: ExePickerModalProps) {
  if (!open) return null

  // Extract relative path by removing the base directory
  const getRelativePath = (fullPath: string) => {
    // Find the game folder name in the path (after "installed\\")
    const match = fullPath.match(/installed[\\/]([^\\/]+)[\\/](.+)/)
    if (match) {
      return match[2] // Return the path after the game folder
    }
    // Fallback: just return the last two segments
    const parts = fullPath.split(/[\\/]/)
    if (parts.length >= 2) {
      return parts.slice(-2).join('\\')
    }
    return fullPath
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-border/60 bg-slate-950/95 p-5 text-white shadow-2xl">
        <div className="text-lg font-semibold">{title}</div>
        <p className="mt-1 text-sm text-slate-300">{message}</p>

        <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">
          {exes.length ? (
            exes.map((exe) => {
              const isIgnored = isIgnoredEngineExecutableName(exe.name)
              const isCurrent = currentExePath && exe.path === currentExePath
              const relativePath = getRelativePath(exe.path)
              return (
              <div 
                key={exe.path} 
                className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 transition-colors ${
                  isCurrent 
                    ? 'border-primary/60 bg-primary/10' 
                    : 'border-white/10 bg-white/5 hover:border-white/20'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 truncate text-sm font-medium">
                    <span className={`truncate ${isCurrent ? 'text-primary' : ''}`}>{exe.name}</span>
                    {isIgnored ? (
                      <span className="flex-none rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-200">
                        Engine helper
                      </span>
                    ) : null}
                  </div>
                  <div className={`truncate text-xs ${isCurrent ? 'text-primary/70' : 'text-slate-400'}`}>{relativePath}</div>
                </div>
                <Button 
                  size="sm" 
                  variant={isCurrent ? "default" : "secondary"} 
                  onClick={() => onSelect(exe.path)}
                >
                  {actionLabel}
                </Button>
              </div>
              )
            })
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-300">
              No executables found.
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}
