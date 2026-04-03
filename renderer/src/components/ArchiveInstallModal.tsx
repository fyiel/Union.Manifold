import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { useDownloadsActions } from "@/context/downloads-context"
import type { Game } from "@/lib/types"
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  CircleX,
  FileArchive,
  FolderOpen,
  Layers,
  Loader2,
  Upload,
} from "lucide-react"

type Step = "method" | "pick" | "confirm" | "installing" | "done" | "error"
type ArchiveMode = "single" | "multipart"
type SelectedFile = { path: string; name: string; size: number }

export type ArchiveInstallMetadata = {
  appid?: string
  name?: string
  description?: string
  genres?: string[]
  image?: string
  developer?: string
  release_date?: string
  size?: string
}

type Props = {
  open: boolean
  game: Game | null
  installMetadata?: ArchiveInstallMetadata | null
  onInstalled?: () => void
  onClose: () => void
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

export function ArchiveInstallModal({ open, game, installMetadata, onInstalled, onClose }: Props) {
  const { upsertDownload } = useDownloadsActions()
  const [step, setStep] = useState<Step>("method")
  const [mode, setMode] = useState<ArchiveMode>("single")
  const [files, setFiles] = useState<SelectedFile[]>([])
  const [downloadId, setDownloadId] = useState<string | null>(null)
  const [progress, setProgress] = useState({ percent: 0, speedBps: 0, etaSeconds: null as number | null, status: "" })
  const [errorMsg, setErrorMsg] = useState("")
  const [dragOver, setDragOver] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)
  const installedNotifiedRef = useRef(false)
  const resolvedName = installMetadata?.name?.trim() || game?.name || "archive"
  const resolvedMetadata = {
    appid: installMetadata?.appid || game?.appid,
    name: resolvedName,
    image: installMetadata?.image ?? game?.image,
    description: installMetadata?.description ?? game?.description,
    genres: installMetadata?.genres ?? game?.genres ?? [],
    developer: installMetadata?.developer ?? game?.developer,
    release_date: installMetadata?.release_date ?? game?.release_date,
    size: installMetadata?.size ?? game?.size,
  }

  // Reset when modal opens
  useEffect(() => {
    if (!open) return
    setStep("method")
    setMode("single")
    setFiles([])
    setDownloadId(null)
    setProgress({ percent: 0, speedBps: 0, etaSeconds: null, status: "" })
    setErrorMsg("")
    setDragOver(false)
    installedNotifiedRef.current = false
  }, [open])

  useEffect(() => {
    if (step !== "done" || installedNotifiedRef.current) return
    installedNotifiedRef.current = true
    try {
      window.dispatchEvent(new Event("uc_game_installed"))
    } catch {
      // ignore DOM event failures
    }
    onInstalled?.()
  }, [step, onInstalled])

  // Subscribe to download updates during installation
  useEffect(() => {
    if (step !== "installing" || !downloadId) return
    const unsub = window.ucDownloads?.onUpdate?.((update) => {
      if (update.downloadId !== downloadId) return
      if (update.status === "extracting") {
        const total = update.totalBytes || 1
        const received = update.receivedBytes || 0
        const rawPercent = Math.round((received / total) * 100)
        setProgress({
          percent: Math.min(rawPercent, 99),
          speedBps: update.speedBps || 0,
          etaSeconds: update.etaSeconds ?? null,
          status: "Extracting...",
        })
      } else if (update.status === "extracted" || update.status === "completed") {
        setProgress((p) => ({ ...p, percent: 100, status: "Done" }))
        setStep("done")
      } else if (update.status === "extract_failed" || update.status === "failed") {
        setErrorMsg(update.error || "Extraction failed")
        setStep("error")
      }
    })
    return () => { unsub?.() }
  }, [step, downloadId])

  const isElectron = typeof window !== "undefined" && Boolean(window.ucDownloads)

  const handleBrowse = useCallback(async () => {
    if (!window.ucDownloads?.pickArchiveFiles) return
    const result = await window.ucDownloads.pickArchiveFiles()
    if (!result.ok || !result.files?.length) return
    if (mode === "single") {
      setFiles([result.files[0]])
    } else {
      // For multipart, add all selected files (dedup by path)
      setFiles((prev) => {
        const existing = new Set(prev.map((f) => f.path))
        const next = [...prev]
        for (const f of result.files!) {
          if (!existing.has(f.path)) next.push(f)
        }
        return next.sort((a, b) => a.name.localeCompare(b.name))
      })
    }
  }, [mode])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragOver(false)

      const droppedFiles: SelectedFile[] = []
      const items = Array.from(e.dataTransfer.files)
      for (const file of items) {
        const filePath = (file as any).path as string | undefined
        if (!filePath) continue
        droppedFiles.push({ path: filePath, name: file.name, size: file.size })
      }
      if (droppedFiles.length === 0) return

      if (mode === "single") {
        setFiles([droppedFiles[0]])
      } else {
        setFiles((prev) => {
          const existing = new Set(prev.map((f) => f.path))
          const next = [...prev]
          for (const f of droppedFiles) {
            if (!existing.has(f.path)) next.push(f)
          }
          return next.sort((a, b) => a.name.localeCompare(b.name))
        })
      }
    },
    [mode]
  )

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(true)
  }
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
  }

  const removeFile = (path: string) => {
    setFiles((prev) => prev.filter((f) => f.path !== path))
  }

  const totalSize = files.reduce((s, f) => s + f.size, 0)

  const startInstall = useCallback(async () => {
    if (!window.ucDownloads?.installFromArchive || files.length === 0) return

    // Generate downloadId client-side so we can subscribe to updates before extraction starts
    const id = `archive-install-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
    const appid = resolvedMetadata.appid || "manual-install"
    const primaryFile = files[0]
    const partTotal = files.length > 1 ? files.length : undefined

    upsertDownload({
      id,
      appid,
      gameName: resolvedName,
      host: "local",
      url: primaryFile?.path || "",
      originalUrl: primaryFile?.path || undefined,
      filename: primaryFile?.name || `${resolvedName}.archive`,
      partIndex: partTotal ? 1 : undefined,
      partTotal,
      status: "extracting",
      receivedBytes: 0,
      totalBytes: totalSize,
      speedBps: 0,
      etaSeconds: null,
      extractProgress: 0,
      savePath: primaryFile?.path,
      startedAt: Date.now(),
      error: null,
      spaceCheck: null,
    })
    setDownloadId(id)
    setStep("installing")
    setProgress({ percent: 0, speedBps: 0, etaSeconds: null, status: "Starting extraction..." })

    const result = await window.ucDownloads.installFromArchive({
      appid: resolvedMetadata.appid,
      gameName: resolvedName,
      archivePaths: files.map((f) => f.path),
      downloadId: id,
      metadata: resolvedMetadata,
    })

    if (!result.ok) {
      upsertDownload({
        id,
        appid,
        gameName: resolvedName,
        host: "local",
        url: primaryFile?.path || "",
        originalUrl: primaryFile?.path || undefined,
        filename: primaryFile?.name || `${resolvedName}.archive`,
        partIndex: partTotal ? 1 : undefined,
        partTotal,
        status: result.error === "insufficient_space" ? "install_ready" : "failed",
        receivedBytes: 0,
        totalBytes: totalSize,
        speedBps: 0,
        etaSeconds: null,
        extractProgress: null,
        savePath: primaryFile?.path,
        startedAt: Date.now(),
        error: result.error || "Failed to start installation",
        spaceCheck: result.spaceCheck ?? null,
      })
      setErrorMsg(result.error || "Failed to start installation")
      setStep("error")
    }
  }, [files, resolvedMetadata, resolvedName, totalSize, upsertDownload])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-[#09090b]/40 backdrop-blur-sm animate-in fade-in duration-300 ease-out" onClick={onClose} />
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-white/[.07] bg-zinc-900/95 p-5 text-zinc-100 shadow-2xl animate-in slide-in-from-top-4 duration-300 ease-out">

        {/* ── Step 1: Choose Method ── */}
        {step === "method" && (
          <div className="space-y-4">
            <div className="text-lg font-semibold">Install from archive</div>
            <p className="text-sm text-zinc-400">
              Install {resolvedName ? <span className="font-medium text-zinc-100">{resolvedName}</span> : "a game"} from
              archive files you already have.
            </p>

            {!isElectron ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-200">
                Archive install requires the desktop app.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => { setMode("single"); setFiles([]); setStep("pick") }}
                  className="flex flex-col items-center gap-3 rounded-xl border border-white/[.07] bg-[#09090b]/50 p-4 text-center transition-all hover:border-zinc-500 hover:bg-white/5"
                >
                  <FileArchive className="h-8 w-8 text-white" />
                  <div>
                    <div className="text-sm font-medium">Single archive</div>
                    <div className="mt-0.5 text-[11px] text-zinc-400">.7z</div>
                  </div>
                </button>
                <button
                  onClick={() => { setMode("multipart"); setFiles([]); setStep("pick") }}
                  className="flex flex-col items-center gap-3 rounded-xl border border-white/[.07] bg-[#09090b]/50 p-4 text-center transition-all hover:border-zinc-500 hover:bg-white/5"
                >
                  <Layers className="h-8 w-8 text-white" />
                  <div>
                    <div className="text-sm font-medium">Multipart archive</div>
                    <div className="mt-0.5 text-[11px] text-zinc-400">.7z.001, .7z.002…</div>
                  </div>
                </button>
              </div>
            )}

            <div className="flex justify-end">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
            </div>
          </div>
        )}

        {/* ── Step 2: Pick Files ── */}
        {step === "pick" && (
          <div className="space-y-4">
            <div className="text-lg font-semibold">
              {mode === "single" ? "Select archive" : "Select archive parts"}
            </div>
            <p className="text-sm text-zinc-400">
              {mode === "single"
                ? "Drag and drop your .7z file below, or browse to select it."
                : "Select the .001 file (sibling parts will be auto-detected), or select all parts manually."}
            </p>

            {/* Drop zone */}
            <div
              ref={dropRef}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed transition-colors ${
                dragOver
                  ? "border-white bg-white/10"
                  : "border-white/[.07] bg-[#09090b]/30 hover:border-zinc-700"
              }`}
            >
              <Upload className={`h-6 w-6 ${dragOver ? "text-white" : "text-zinc-400"}`} />
              <p className="text-xs text-zinc-400">
                {dragOver ? "Drop files here" : "Drag & drop archive files here"}
              </p>
              <Button variant="outline" size="sm" onClick={handleBrowse} className="mt-1">
                <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                Browse files
              </Button>
            </div>

            {/* Selected files list */}
            {files.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-medium text-zinc-400">
                  {files.length} file{files.length !== 1 ? "s" : ""} selected ({formatBytes(totalSize)})
                </div>
                <div className="max-h-[160px] overflow-y-auto rounded-lg border border-white/[.07] bg-[#09090b]/30">
                  {files.map((f) => (
                    <div key={f.path} className="flex items-center justify-between gap-2 border-b border-white/[.07] px-3 py-1.5 last:border-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <Archive className="h-3.5 w-3.5 flex-shrink-0 text-zinc-400" />
                        <span className="truncate text-xs">{f.name}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[10px] text-zinc-400">{formatBytes(f.size)}</span>
                        <button
                          onClick={() => removeFile(f.path)}
                          className="rounded p-0.5 text-zinc-400 hover:text-destructive transition-colors"
                        >
                          <CircleX className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <Button variant="ghost" onClick={() => { setFiles([]); setStep("method") }}>Back</Button>
              <Button disabled={files.length === 0} onClick={() => setStep("confirm")}>
                Continue
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 3: Confirm ── */}
        {step === "confirm" && (
          <div className="space-y-4">
            <div className="text-lg font-semibold">Confirm installation</div>

            <div className="rounded-lg border border-white/[.07] bg-[#09090b]/30 p-3 space-y-2">
              {resolvedName && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-400">Game:</span>
                  <span className="text-sm font-medium">{resolvedName}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400">Type:</span>
                <span className="text-sm">{mode === "single" ? "Single archive" : `Multipart (${files.length} parts)`}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400">Total size:</span>
                <span className="text-sm">{formatBytes(totalSize)}</span>
              </div>
              {files.length <= 6 && (
                <div className="space-y-0.5 pt-1 border-t border-white/[.07]">
                  {files.map((f) => (
                    <div key={f.path} className="flex items-center gap-2 text-xs text-zinc-400">
                      <Archive className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">{f.name}</span>
                      <span className="ml-auto flex-shrink-0">{formatBytes(f.size)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-white/[.07] bg-zinc-800/30 px-3 py-2 text-xs text-zinc-400">
              The archive will be extracted to your game library. Original files will not be modified.
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <Button variant="ghost" onClick={() => setStep("pick")}>Back</Button>
              <Button onClick={startInstall}>Install</Button>
            </div>
          </div>
        )}

        {/* ── Step 4: Installing ── */}
        {step === "installing" && (
          <div className="space-y-4 py-2">
            <div className="text-lg font-semibold">Installing…</div>
            <p className="text-sm text-zinc-400">
              Extracting {resolvedName ? <span className="font-medium text-zinc-100">{resolvedName}</span> : "archive"}. Please do not close the app.
            </p>

            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-800/50">
                <div
                  className="h-full rounded-full bg-white transition-all duration-300 ease-out"
                  style={{ width: `${Math.min(100, progress.percent)}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>{progress.status || "Extracting..."}</span>
                <div className="flex items-center gap-3">
                  {progress.speedBps > 0 && <span>{formatBytes(progress.speedBps)}/s</span>}
                  <span>{progress.percent}%</span>
                  {progress.etaSeconds != null && progress.etaSeconds > 0 && (
                    <span>
                      ~{progress.etaSeconds > 60
                        ? `${Math.ceil(progress.etaSeconds / 60)}m`
                        : `${progress.etaSeconds}s`}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/80">
              <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" />
              Extraction will continue in the background if you close this window
            </div>
            <div className="flex justify-end">
              <Button variant="ghost" onClick={onClose}>Close</Button>
            </div>
          </div>
        )}

        {/* ── Step 5: Done ── */}
        {step === "done" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              Installation complete
            </div>
            <p className="text-sm text-zinc-400">
              {resolvedName ? <span className="font-medium text-zinc-100">{resolvedName}</span> : "The game"} has been
              installed successfully. You can now launch it from your library.
            </p>
            <div className="flex justify-end">
              <Button onClick={onClose}>Close</Button>
            </div>
          </div>
        )}

        {/* ── Step 6: Error ── */}
        {step === "error" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Installation failed
            </div>
            <p className="text-sm text-zinc-400">
              {errorMsg || "Something went wrong during extraction."}
            </p>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={onClose}>Close</Button>
              <Button onClick={() => { setErrorMsg(""); setStep("pick") }}>Try again</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

