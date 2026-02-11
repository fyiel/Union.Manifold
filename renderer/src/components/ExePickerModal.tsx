import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { GameExecutable, getExecutableRelativePath, rankGameExecutables } from "@/lib/utils"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

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
  // --- All hooks MUST be called unconditionally (React Rules of Hooks) ---
  const [search, setSearch] = useState("")
  const [browsing, setBrowsing] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  // Reset search when modal opens with new data
  useEffect(() => {
    if (open) {
      setSearch("")
      setBrowsing(false)
      // Auto-focus search after render
      requestAnimationFrame(() => searchRef.current?.focus())
    }
  }, [open, exes])

  // Deduplicate exes by normalised path (case-insensitive on Windows)
  const dedupedExes = useMemo(() => {
    const seen = new Set<string>()
    const out: GameExecutable[] = []
    for (const exe of exes) {
      const key = (exe.path || "").toLowerCase().replace(/\//g, "\\")
      if (seen.has(key)) continue
      seen.add(key)
      out.push(exe)
    }
    return out
  }, [exes])

  // Rank exes by relevance to game name
  const ranked = useMemo(() => {
    if (!gameName) return dedupedExes.map((exe) => ({ ...exe, score: 0, ignored: false, tags: [] as string[] }))
    return rankGameExecutables(dedupedExes, gameName, baseFolder)
  }, [dedupedExes, gameName, baseFolder])

  // The top-scored exe is the recommendation (only meaningful with 2+ exes)
  const recommended = useMemo(() => {
    if (ranked.length < 2) return null
    const top = ranked[0]
    if (!top || top.score <= 0) return null
    return top
  }, [ranked])

  // Build the visible list: apply search filter, keep recommended separate only if shown
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return ranked.filter((exe) => {
      // Only hide the recommended exe from the main list if it will be shown in the header
      if (recommended && exe.path === recommended.path && exe.name === recommended.name) return false
      if (!needle) return true
      return exe.name.toLowerCase().includes(needle) || exe.path.toLowerCase().includes(needle)
    })
  }, [ranked, search, recommended])

  const getRelativePath = useCallback((fullPath: string) => {
    if (baseFolder) return getExecutableRelativePath(fullPath, baseFolder)
    const parts = fullPath.split(/[\\/]/)
    if (parts.length >= 2) return parts.slice(-2).join("\\")
    return fullPath
  }, [baseFolder])

  const handleBrowse = useCallback(async () => {
    if (browsing) return
    setBrowsing(true)
    try {
      // Use the Electron native file dialog via the pickExternalGameFolder-style IPC
      // We'll call the new browseForGameExe IPC or fall back to pickExternalGameFolder
      const w = window as any
      if (w.ucDownloads?.browseForGameExe) {
        const result = await w.ucDownloads.browseForGameExe(baseFolder || undefined)
        if (result?.path) {
          onSelect(result.path)
          return
        }
      }
    } catch (err) {
      console.error("[UC] Browse for exe failed", err)
    } finally {
      setBrowsing(false)
    }
  }, [browsing, baseFolder, onSelect])

  // --- Early return AFTER all hooks ---
  if (!open) return null

  const hasExes = ranked.length > 0
  const showRecommended = !!recommended

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-border/60 bg-slate-950/95 p-5 text-white shadow-2xl">
        <div className="text-lg font-semibold">{title}</div>
        <p className="mt-1 text-sm text-slate-300">{message}</p>

        <div className="mt-4 space-y-3">
          {/* Search bar — only show when there are enough exes to warrant searching */}
          {ranked.length > 3 && (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                ref={searchRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search exe name or path..."
                className="h-9 flex-1 rounded-xl bg-white/5"
              />
            </div>
          )}

          {/* Recommended exe (highlighted at top, only when there are 2+ exes) */}
          {showRecommended && recommended ? (
            <div className="rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
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

          {/* Main exe list */}
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {visible.length > 0 ? (
              visible.map((exe) => {
                const isCurrent = !!currentExePath && exe.path.toLowerCase() === currentExePath.toLowerCase()
                const relativePath = getRelativePath(exe.path)
                return (
                  <div
                    key={exe.path}
                    className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 transition-colors ${
                      isCurrent
                        ? "border-primary/60 bg-primary/10"
                        : "border-white/10 bg-white/5 hover:border-white/20"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 truncate text-sm font-medium">
                        <span className={`truncate ${isCurrent ? "text-primary" : ""}`}>{exe.name}</span>
                        {isCurrent ? (
                          <span className="flex-none rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary/90">
                            Current
                          </span>
                        ) : null}
                      </div>
                      <div className={`truncate text-xs ${isCurrent ? "text-primary/70" : "text-slate-400"}`}>{relativePath}</div>
                      {typeof exe.size === "number" && exe.size > 0 ? (
                        <div className="text-[10px] text-slate-500">{formatFileSize(exe.size)}</div>
                      ) : null}
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
            ) : hasExes && search.trim() ? (
              <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-300">
                No executables matching &quot;{search.trim()}&quot;.
              </div>
            ) : !hasExes ? (
              <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-4 text-center text-sm text-slate-300">
                <p>No executables found in this game folder.</p>
                <p className="mt-1 text-xs text-slate-500">The game may still be extracting, or the folder structure is unusual.</p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            disabled={browsing}
            onClick={handleBrowse}
          >
            {browsing ? "Browsing..." : "Browse..."}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
