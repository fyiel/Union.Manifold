import { useCallback, useEffect, useRef, useState } from "react"
import { Camera, ChevronLeft, ChevronRight, FolderOpen, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"

interface Screenshot {
  filename: string
  path: string
  size: number
  takenAt: number
}

function toFileUrl(filePath: string): string {
  return "file:///" + filePath.replace(/\\/g, "/")
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp))
}

export function ScreenshotsPage() {
  const [screenshots, setScreenshots] = useState<Screenshot[]>([])
  const [loading, setLoading] = useState(true)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const lightboxRef = useRef<HTMLDivElement>(null)

  const loadScreenshots = useCallback(async () => {
    if (!window.ucSystem?.listScreenshots) return
    setLoading(true)
    try {
      const result = await window.ucSystem.listScreenshots()
      if (result.ok) setScreenshots(result.screenshots)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadScreenshots()
  }, [loadScreenshots])

  // Keyboard navigation in lightbox
  useEffect(() => {
    if (lightboxIndex === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setLightboxIndex(i => (i !== null ? Math.min(i + 1, screenshots.length - 1) : null))
      else if (e.key === "ArrowLeft") setLightboxIndex(i => (i !== null ? Math.max(i - 1, 0) : null))
      else if (e.key === "Escape") setLightboxIndex(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [lightboxIndex, screenshots.length])

  const openFolder = useCallback(async () => {
    if (!window.ucSystem?.getScreenshotPath) return
    const result = await window.ucSystem.getScreenshotPath()
    if (result.ok && result.path) {
      window.ucSystem?.openScreenshot?.(result.path)
    }
  }, [])

  const handleDelete = useCallback(async (filePath: string) => {
    if (!window.ucSystem?.deleteScreenshot) return
    const result = await window.ucSystem.deleteScreenshot(filePath)
    if (result.ok) {
      setScreenshots(prev => prev.filter(s => s.path !== filePath))
      setDeleteConfirm(null)
      if (lightboxIndex !== null) {
        setLightboxIndex(prev => {
          if (prev === null) return null
          const newLen = screenshots.length - 1
          if (newLen === 0) return null
          return Math.min(prev, newLen - 1)
        })
      }
    }
  }, [lightboxIndex, screenshots.length])

  const lightboxScreenshot = lightboxIndex !== null ? screenshots[lightboxIndex] : null

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Camera className="text-white/60" size={22} />
          <div>
            <h1 className="text-lg font-semibold text-white">Screenshots</h1>
            {!loading && (
              <p className="text-xs text-white/40">
                {screenshots.length === 0
                  ? "No screenshots yet"
                  : `${screenshots.length} screenshot${screenshots.length !== 1 ? "s" : ""}`}
              </p>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-white/70 border-white/20 bg-white/5 hover:bg-white/10 hover:text-white"
          onClick={openFolder}
        >
          <FolderOpen size={14} />
          Open Folder
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="aspect-video rounded-lg bg-white/5 animate-pulse"
              />
            ))}
          </div>
        ) : screenshots.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
              <Camera size={28} className="text-white/30" />
            </div>
            <div>
              <p className="text-white/60 font-medium">No screenshots yet</p>
              <p className="text-white/30 text-sm mt-1">
                Take screenshots from the in-game overlay with the camera button.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {screenshots.map((screenshot, index) => (
              <div
                key={screenshot.path}
                className="group relative aspect-video rounded-lg overflow-hidden bg-white/5 cursor-pointer ring-1 ring-white/10 hover:ring-white/30 transition-all"
                onClick={() => setLightboxIndex(index)}
              >
                <img
                  src={toFileUrl(screenshot.path)}
                  alt={screenshot.filename}
                  className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                  loading="lazy"
                />
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                {/* Date label */}
                <div className="absolute bottom-0 left-0 right-0 px-2 pb-2 translate-y-full group-hover:translate-y-0 transition-transform duration-200">
                  <p className="text-xs text-white/90 truncate">{formatDate(screenshot.takenAt)}</p>
                  <p className="text-xs text-white/50">{formatFileSize(screenshot.size)}</p>
                </div>
                {/* Delete button */}
                <button
                  className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80 text-white/70 hover:text-white"
                  onClick={e => {
                    e.stopPropagation()
                    setDeleteConfirm(screenshot.path)
                  }}
                  title="Delete screenshot"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            className="bg-[#1a1a2e] border border-white/15 rounded-xl p-6 w-80 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-white font-semibold mb-2">Delete Screenshot</h3>
            <p className="text-white/60 text-sm mb-5">
              This will permanently delete the screenshot. This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <Button
                variant="outline"
                size="sm"
                className="border-white/20 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-red-500/80 hover:bg-red-500 text-white border-0"
                onClick={() => handleDelete(deleteConfirm)}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxScreenshot && lightboxIndex !== null && (
        <div
          ref={lightboxRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setLightboxIndex(null)}
        >
          {/* Main image */}
          <img
            src={toFileUrl(lightboxScreenshot.path)}
            alt={lightboxScreenshot.filename}
            className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl"
            onClick={e => e.stopPropagation()}
          />

          {/* Close button */}
          <button
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-black/60 flex items-center justify-center text-white/70 hover:text-white hover:bg-black/80 transition-colors"
            onClick={() => setLightboxIndex(null)}
          >
            <X size={18} />
          </button>

          {/* Info bar */}
          <div
            className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-black/60 backdrop-blur-md rounded-full px-5 py-2.5 text-sm"
            onClick={e => e.stopPropagation()}
          >
            <span className="text-white/50 text-xs">{lightboxIndex + 1} / {screenshots.length}</span>
            <span className="text-white/80 truncate max-w-xs">{formatDate(lightboxScreenshot.takenAt)}</span>
            <span className="text-white/40 text-xs">{formatFileSize(lightboxScreenshot.size)}</span>
            <button
              className="text-white/50 hover:text-red-400 transition-colors ml-1"
              title="Delete screenshot"
              onClick={() => {
                setLightboxIndex(null)
                setDeleteConfirm(lightboxScreenshot.path)
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>

          {/* Prev/Next arrows */}
          {lightboxIndex > 0 && (
            <button
              className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 flex items-center justify-center text-white/70 hover:text-white hover:bg-black/80 transition-colors"
              onClick={e => { e.stopPropagation(); setLightboxIndex(lightboxIndex - 1) }}
            >
              <ChevronLeft size={22} />
            </button>
          )}
          {lightboxIndex < screenshots.length - 1 && (
            <button
              className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 flex items-center justify-center text-white/70 hover:text-white hover:bg-black/80 transition-colors"
              onClick={e => { e.stopPropagation(); setLightboxIndex(lightboxIndex + 1) }}
            >
              <ChevronRight size={22} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
