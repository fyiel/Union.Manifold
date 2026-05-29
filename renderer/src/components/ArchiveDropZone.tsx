import { useEffect, useState } from "react"
import { FileArchive, Upload } from "lucide-react"

/**
 * Global drag-and-drop target. When the user drags archive files (.zip /
 * .rar / .7z / etc.) anywhere over the launcher window we light up a soft
 * overlay; on drop we dispatch `uc_open_add_game` so DownBar's
 * `AddGameModal` opens directly in archive-install mode.
 *
 * Folder drops are intentionally NOT handled here — Electron drag-drop only
 * exposes a path for `webkitGetAsEntry`-style file items, and the
 * folder-link flow already needs the user to pick a folder via the OS
 * dialog. Limiting scope to archives keeps the UX honest.
 */

const ARCHIVE_EXTENSIONS = [
  ".zip", ".7z", ".rar",
  ".7z.001", ".part1.rar", ".tar", ".tar.gz", ".tgz",
]

function isArchiveName(name: string): boolean {
  const lower = name.toLowerCase()
  return ARCHIVE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function ArchiveDropZone() {
  const [active, setActive] = useState(false)
  const [hint, setHint] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") return
    let depth = 0
    let hintTimer: ReturnType<typeof setTimeout> | null = null

    const showHint = (message: string) => {
      setHint(message)
      if (hintTimer) clearTimeout(hintTimer)
      hintTimer = setTimeout(() => setHint(null), 3200)
    }

    const onDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer) return
      const hasFiles = Array.from(event.dataTransfer.types).includes("Files")
      if (!hasFiles) return
      event.preventDefault()
      depth += 1
      setActive(true)
    }
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer) return
      const hasFiles = Array.from(event.dataTransfer.types).includes("Files")
      if (!hasFiles) return
      event.preventDefault()
      // Indicate copy intent so the OS cursor shows the right glyph.
      event.dataTransfer.dropEffect = "copy"
    }
    const onDragLeave = () => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) setActive(false)
    }
    const onDrop = (event: DragEvent) => {
      depth = 0
      setActive(false)
      if (!event.dataTransfer) return
      const files = Array.from(event.dataTransfer.files || [])
      if (files.length === 0) return
      event.preventDefault()

      const archiveFiles = files.filter((file) => isArchiveName(file.name))
      const nonArchiveCount = files.length - archiveFiles.length
      if (archiveFiles.length === 0) {
        showHint("Drop a .zip / .rar / .7z archive to add a game from disk.")
        return
      }

      // Show a quick confirmation hint then dispatch the open event so
      // DownBar's AddGameModal picks it up.
      const label = archiveFiles.length === 1
        ? archiveFiles[0].name
        : `${archiveFiles.length} archive files`
      showHint(`Opening installer for ${label}…${nonArchiveCount > 0 ? ` (skipped ${nonArchiveCount} non-archive)` : ""}`)
      try {
        window.dispatchEvent(new CustomEvent("uc_open_add_game", {
          detail: {
            source: "archive",
            // Electron's drag/drop in the renderer doesn't expose absolute
            // paths via the standard File API, so we can only report names
            // for the user; the modal still needs them to pick the files
            // via the native dialog. We're saving them one click (mode
            // pre-selected) and giving a clear context hint.
            archiveNames: archiveFiles.map((f) => f.name),
          },
        }))
      } catch { /* ignore */ }
    }

    window.addEventListener("dragenter", onDragEnter)
    window.addEventListener("dragover", onDragOver)
    window.addEventListener("dragleave", onDragLeave)
    window.addEventListener("drop", onDrop)
    return () => {
      window.removeEventListener("dragenter", onDragEnter)
      window.removeEventListener("dragover", onDragOver)
      window.removeEventListener("dragleave", onDragLeave)
      window.removeEventListener("drop", onDrop)
      if (hintTimer) clearTimeout(hintTimer)
    }
  }, [])

  return (
    <>
      {active && (
        <div className="fixed inset-0 z-[9990] pointer-events-none flex items-center justify-center bg-background/65 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="rounded-3xl border-2 border-dashed border-white/30 bg-background/80 px-8 py-6 text-center shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-white/[.07] bg-white/[.05]">
              <Upload className="h-6 w-6 text-foreground/90" />
            </div>
            <div className="text-base font-semibold text-white">Drop to install</div>
            <p className="mt-1 text-xs text-muted-foreground max-w-xs">
              Release a <code className="text-amber-200">.zip</code> / <code className="text-amber-200">.rar</code> / <code className="text-amber-200">.7z</code> archive to open the installer.
            </p>
          </div>
        </div>
      )}
      {hint && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-[9991] -translate-x-1/2 flex items-center gap-2 rounded-full border border-white/[.07] bg-background/92 px-4 py-2.5 text-sm text-foreground shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
        >
          <FileArchive className="h-4 w-4 text-foreground/80" />
          <span>{hint}</span>
        </div>
      )}
    </>
  )
}
