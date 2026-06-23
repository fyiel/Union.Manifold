import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { GameExecutable, getExecutableRelativePath, rankGameExecutables } from "@/lib/utils"
import { Folder, Search, Sparkles } from "@/components/icons"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"

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
    if (open) setSearch("")
  }, [open, exes])

  // Close on Escape — matches the Radix dialogs used elsewhere so keyboard
  // behaviour is consistent across every launch modal.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

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

  // Build the visible list: drop the recommended (shown separately) + filter
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return ranked.filter((exe) => {
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
  const showSearch = ranked.length > 5

  // A single executable row, shared by the recommended highlight and the list.
  const renderRow = (exe: typeof ranked[number], opts?: { recommended?: boolean }) => {
    const isCurrent = !!currentExePath && exe.path.toLowerCase() === currentExePath.toLowerCase()
    const relativePath = getRelativePath(exe.path)
    return (
      <div
        key={exe.path}
        className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
          opts?.recommended
            ? "border-primary/40 bg-primary/[.07]"
            : isCurrent
              ? "border-white/40 bg-white/[.06]"
              : "border-white/[.07] bg-black/20 hover:border-white/20 hover:bg-white/[.04]"
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="truncate">{exe.name}</span>
            {opts?.recommended ? (
              <span className="flex-none inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground/90">
                <Sparkles className="h-2.5 w-2.5" /> Recommended
              </span>
            ) : isCurrent ? (
              <span className="flex-none rounded-full border border-border bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-white/90">
                Current
              </span>
            ) : null}
          </div>
          <div className="truncate text-xs text-muted-foreground">{relativePath}</div>
          {typeof exe.size === "number" && exe.size > 0 ? (
            <div className="text-[10px] text-muted-foreground/70">{formatFileSize(exe.size)}</div>
          ) : null}
        </div>
        <Button
          size="sm"
          variant={opts?.recommended || isCurrent ? "default" : "secondary"}
          className="flex-none"
          onClick={() => onSelect(exe.path)}
        >
          {actionLabel}
        </Button>
      </div>
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md animate-in fade-in duration-200 ease-out" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-background/95 text-foreground shadow-[0_24px_80px_rgba(0,0,0,0.6)] backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-200 ease-out"
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4">
          <h2 className="text-lg font-semibold leading-tight">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-3 overflow-y-auto px-6 pb-3">
          {recommended ? renderRow(recommended, { recommended: true }) : null}

          {showSearch ? (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search exe name or path…"
                className="h-9 rounded-xl bg-black/30 pl-9"
              />
            </div>
          ) : null}

          {visible.length > 0 ? (
            visible.map((exe) => renderRow(exe))
          ) : hasExes && search.trim() ? (
            <div className="rounded-xl border border-white/[.07] bg-black/20 px-3 py-3 text-sm text-muted-foreground">
              No executables matching &quot;{search.trim()}&quot;.
            </div>
          ) : !hasExes ? (
            <div className="rounded-xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground/80">No executables found in this game folder.</p>
              <p className="mt-1 text-xs text-muted-foreground">The game may still be extracting, or its folder layout is unusual. Use <span className="font-medium text-foreground/80">Browse…</span> to pick the file manually.</p>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-white/10 px-6 py-4">
          <Button variant="outline" size="sm" disabled={browsing} onClick={handleBrowse}>
            <Folder className="mr-1.5 h-4 w-4" />
            {browsing ? "Browsing…" : "Browse…"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
