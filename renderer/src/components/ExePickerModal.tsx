import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { GameExecutable, getExecutableRelativePath, isHelperExecutableName, rankGameExecutables } from "@/lib/utils"
import { useMemo, useState } from "react"

type ExePickerModalProps = {
  open: boolean
  title: string
  message: string
  exes: GameExecutable[]
  gameName?: string
  baseFolder?: string | null
  currentExePath?: string | null
  actionLabel?: string
  onSelect: (path: string) => void
  onClose: () => void
}

export function ExePickerModal({ open, title, message, exes, gameName, baseFolder, currentExePath, actionLabel = "Launch", onSelect, onClose }: ExePickerModalProps) {
  if (!open) return null

  const [search, setSearch] = useState("")
  const [showHelpers, setShowHelpers] = useState(false)

  const dedupedExes = useMemo(() => {
    const seen = new Set<string>()
    const out: GameExecutable[] = []
    for (const exe of exes) {
      const key = `${exe.name.toLowerCase()}|${(exe.path || "").toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(exe)
    }
    return out
  }, [exes])

  const ranked = useMemo(() => {
    if (!gameName) return dedupedExes.map((exe) => ({ ...exe, score: 0, ignored: false, tags: [] }))
    return rankGameExecutables(dedupedExes, gameName, baseFolder)
  }, [dedupedExes, gameName, baseFolder])

  // Only show one recommended entry, even if multiple have the same path/name
  const recommended = ranked.length > 0 ? ranked.find((exe, idx, arr) =>
    exe.score === arr[0].score && exe.path === arr[0].path && exe.name === arr[0].name
  ) : null

  const helperCount = useMemo(() => ranked.filter((exe) => isHelperExecutableName(exe.name)).length, [ranked])

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return ranked.filter((exe) => {
      if (recommended && exe.path === recommended.path && exe.name === recommended.name) return false
      if (!showHelpers && isHelperExecutableName(exe.name)) return false
      if (!needle) return true
      return exe.name.toLowerCase().includes(needle) || exe.path.toLowerCase().includes(needle)
    })
  }, [ranked, search, showHelpers, recommended])

  const getRelativePath = (fullPath: string) => {
    if (baseFolder) return getExecutableRelativePath(fullPath, baseFolder)
    const parts = fullPath.split(/[\\/]/)
    if (parts.length >= 2) return parts.slice(-2).join('\\')
    return fullPath
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-border/60 bg-slate-950/95 p-5 text-white shadow-2xl">
        <div className="text-lg font-semibold">{title}</div>
        <p className="mt-1 text-sm text-slate-300">{message}</p>

        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search exe name or path..."
              className="h-9 flex-1 rounded-xl bg-white/5"
            />
            <Button
              type="button"
              size="sm"
              variant={showHelpers ? "default" : "secondary"}
              onClick={() => setShowHelpers((prev) => !prev)}
            >
              {showHelpers ? "Hide helpers" : `Show helpers (${helperCount} hidden)`}
            </Button>
          </div>

          {recommended && ranked.length > 1 ? (
            <div className="rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-wide text-primary/80">Recommended</div>
                  <div className="truncate text-sm font-semibold text-primary">{recommended.name}</div>
                  <div className="truncate text-xs text-primary/70">{getRelativePath(recommended.path)}</div>
                </div>
                <Button size="sm" onClick={() => onSelect(recommended.path)}>
                  {actionLabel}
                </Button>
              </div>
            </div>
          ) : null}

          <div className="max-h-72 space-y-2 overflow-y-auto">
            {visible.length ? (
              visible.map((exe) => {
                const isIgnored = isHelperExecutableName(exe.name)
                const isCurrent = currentExePath && exe.path === currentExePath
                const relativePath = getRelativePath(exe.path)
                const isRecommended = recommended && ranked.length > 1 && exe.path === recommended.path
                return (
                  <div
                    key={exe.path}
                    className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 transition-colors ${
                      isCurrent || isRecommended
                        ? 'border-primary/60 bg-primary/10'
                        : 'border-white/10 bg-white/5 hover:border-white/20'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 truncate text-sm font-medium">
                        <span className={`truncate ${isCurrent || isRecommended ? 'text-primary' : ''}`}>{exe.name}</span>
                        {isRecommended ? (
                          <span className="flex-none rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary/90">
                            Recommended
                          </span>
                        ) : null}
                        {isIgnored ? (
                          <span className="flex-none rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-200">
                            Helper
                          </span>
                        ) : null}
                      </div>
                      <div className={`truncate text-xs ${isCurrent || isRecommended ? 'text-primary/70' : 'text-slate-400'}`}>{relativePath}</div>
                    </div>
                    <Button
                      size="sm"
                      variant={isCurrent || isRecommended ? "default" : "secondary"}
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
