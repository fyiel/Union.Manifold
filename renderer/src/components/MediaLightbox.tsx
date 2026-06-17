import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { X, ChevronLeft, ChevronRight, Plus, Minus, Download, Trash2 } from "@/components/icons"

export type LightboxImage = {
  src: string
  alt?: string
  /** Shown if `src` fails to load. */
  fallbackSrc?: string
  /** Optional URL to open/download externally (defaults to `src`). */
  downloadUrl?: string
}

type Props = {
  open: boolean
  images: LightboxImage[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
  /** When provided, a delete button is shown in the toolbar for the current image. */
  onDelete?: () => void
}

const MIN_ZOOM = 1
const MAX_ZOOM = 5
const ZOOM_STEP = 0.5

/**
 * Full-viewport image lightbox shared by the screenshots gallery and comment
 * attachments. Panning is applied directly to the DOM (no React state per
 * pointermove) so dragging stays smooth, the image fills the viewport with
 * object-contain (no inner box), and all controls live in a bottom toolbar so
 * they're reachable on small screens.
 */
export function MediaLightbox({ open, images, index, onIndexChange, onClose, onDelete }: Props) {
  const imgRef = useRef<HTMLImageElement | null>(null)
  const panRef = useRef({ x: 0, y: 0 })
  const draggingRef = useRef(false)
  const pointerIdRef = useRef<number | null>(null)
  const startRef = useRef({ x: 0, y: 0 })
  const startPanRef = useRef({ x: 0, y: 0 })
  const movedRef = useRef(false)
  const [zoom, setZoom] = useState(1)

  const count = images.length
  const current = images[index]

  const applyTransform = useCallback((animate: boolean) => {
    const img = imgRef.current
    if (!img) return
    img.style.transition = animate ? "transform 150ms ease-out" : "none"
    img.style.transform = `translate3d(${panRef.current.x}px, ${panRef.current.y}px, 0) scale(${zoom})`
  }, [zoom])

  const clampPan = useCallback((x: number, y: number, z: number) => {
    const img = imgRef.current
    if (!img) return { x, y }
    // offsetWidth/Height reflect the contained (untransformed) layout size.
    const overflowX = Math.max(0, (img.offsetWidth * z - window.innerWidth) / 2)
    const overflowY = Math.max(0, (img.offsetHeight * z - window.innerHeight) / 2)
    return {
      x: Math.min(overflowX, Math.max(-overflowX, x)),
      y: Math.min(overflowY, Math.max(-overflowY, y)),
    }
  }, [])

  const resetView = useCallback(() => {
    panRef.current = { x: 0, y: 0 }
    setZoom(1)
  }, [])

  const goTo = useCallback((next: number) => {
    if (count === 0) return
    resetView()
    onIndexChange(((next % count) + count) % count)
  }, [count, onIndexChange, resetView])

  // Reset zoom/pan whenever the shown image changes or the lightbox opens.
  useEffect(() => { if (open) resetView() }, [open, index, resetView])

  // Re-apply (and re-clamp) the transform when zoom changes.
  useEffect(() => {
    panRef.current = clampPan(panRef.current.x, panRef.current.y, zoom)
    applyTransform(true)
  }, [zoom, applyTransform, clampPan])

  // Keyboard controls.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      else if (e.key === "ArrowRight") goTo(index + 1)
      else if (e.key === "ArrowLeft") goTo(index - 1)
      else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))
      else if (e.key === "-") setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))
      else if (e.key === "0") resetView()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, index, goTo, onClose, resetView])

  if (!open || count === 0 || !current) return null

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (zoom <= 1) return
    draggingRef.current = true
    movedRef.current = false
    pointerIdRef.current = e.pointerId
    startRef.current = { x: e.clientX, y: e.clientY }
    startPanRef.current = { ...panRef.current }
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* ignore */ }
    applyTransform(false)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || pointerIdRef.current !== e.pointerId) return
    const dx = e.clientX - startRef.current.x
    const dy = e.clientY - startRef.current.y
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) movedRef.current = true
    panRef.current = clampPan(startPanRef.current.x + dx, startPanRef.current.y + dy, zoom)
    applyTransform(false) // imperative — no re-render, stays smooth
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current === e.pointerId) {
      draggingRef.current = false
      pointerIdRef.current = null
    }
  }

  const onImageClick = () => {
    if (movedRef.current) { movedRef.current = false; return }
    setZoom((z) => (z > 1 ? 1 : 2))
  }

  const openExternal = () => {
    const url = current.downloadUrl || current.src
    const isCdn = (() => { try { return new URL(url).hostname.toLowerCase() === "cdn.union-crax.xyz" } catch { return false } })()
    if (isCdn) {
      // CDN URLs don't force-download when opened externally — fetch as blob so
      // Electron can save it via the native download mechanism.
      fetch(url)
        .then((r) => (r.ok ? r.blob() : Promise.reject()))
        .then((blob) => {
          const blobUrl = URL.createObjectURL(blob)
          const a = document.createElement("a")
          a.href = blobUrl
          a.download = current.alt || url.split("/").pop() || "download"
          a.style.display = "none"
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
        })
        .catch(() => {
          try { window.ucSystem?.openExternal?.(url) } catch { /* ignore */ }
        })
      return
    }
    try { window.ucSystem?.openExternal?.(url) } catch { /* ignore */ }
  }

  const btn = "h-9 w-9 rounded-full border border-white/[.12] bg-white/[.06] hover:bg-white/[.14] flex items-center justify-center text-white transition-colors active:scale-95 disabled:opacity-40"

  return createPortal(
    <div className="fixed inset-0 z-[10000] select-none" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/92 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />

      {/* Close (always top-right, safe area) */}
      <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 sm:right-5 sm:top-5 z-20 h-10 w-10 rounded-full border border-white/[.12] bg-white/[.06] hover:bg-white/[.14] flex items-center justify-center text-white transition-colors active:scale-95">
        <X className="h-5 w-5" />
      </button>

      {/* Desktop side arrows */}
      {count > 1 && (
        <>
          <button onClick={() => goTo(index - 1)} aria-label="Previous" className="hidden sm:flex absolute left-4 top-1/2 -translate-y-1/2 z-20 h-12 w-12 rounded-full border border-white/[.12] bg-white/[.06] hover:bg-white/[.14] items-center justify-center text-white transition-colors active:scale-95">
            <ChevronLeft className="h-7 w-7" />
          </button>
          <button onClick={() => goTo(index + 1)} aria-label="Next" className="hidden sm:flex absolute right-4 top-1/2 -translate-y-1/2 z-20 h-12 w-12 rounded-full border border-white/[.12] bg-white/[.06] hover:bg-white/[.14] items-center justify-center text-white transition-colors active:scale-95">
            <ChevronRight className="h-7 w-7" />
          </button>
        </>
      )}

      {/* Image stage — fills the viewport */}
      <div
        className="absolute inset-0 z-10 flex items-center justify-center overflow-hidden px-2 pb-20 pt-14 sm:px-16"
        style={{ touchAction: zoom > 1 ? "none" : "manipulation" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={(e) => setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP))))}
        onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      >
        <img
          ref={imgRef}
          key={current.src}
          src={current.src}
          alt={current.alt || `Image ${index + 1}`}
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          onClick={onImageClick}
          onError={(e) => {
            const el = e.currentTarget
            const retries = parseInt(el.dataset.retries ?? "0", 10)
            if (retries < 2) {
              el.dataset.retries = String(retries + 1)
              setTimeout(() => { el.src = current.src + (current.src.includes("?") ? "&" : "?") + `_r=${retries + 1}` }, 1200 * (retries + 1))
            } else if (current.fallbackSrc) {
              el.src = current.fallbackSrc
            }
          }}
          className={`max-h-full max-w-full object-contain ${zoom > 1 ? (draggingRef.current ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in"}`}
          style={{ transform: `translate3d(0,0,0) scale(${zoom})`, willChange: "transform" }}
        />
      </div>

      {/* Bottom toolbar — all controls live here so they're reachable on mobile */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-full border border-white/[.12] bg-black/70 px-2.5 py-2 backdrop-blur-md shadow-lg">
        {count > 1 && (
          <button onClick={() => goTo(index - 1)} aria-label="Previous" className={btn}>
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        <button onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))} aria-label="Zoom out" disabled={zoom <= MIN_ZOOM} className={btn}>
          <Minus className="h-4 w-4" />
        </button>
        <button onClick={resetView} aria-label="Reset zoom" className="h-9 min-w-[3.25rem] rounded-full border border-white/[.12] bg-white/[.06] hover:bg-white/[.14] px-2 text-xs font-bold text-white transition-colors active:scale-95">
          {Math.round(zoom * 100)}%
        </button>
        <button onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))} aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} className={btn}>
          <Plus className="h-4 w-4" />
        </button>
        <button onClick={openExternal} aria-label="Open externally" className={btn}>
          <Download className="h-4 w-4" />
        </button>
        {onDelete && (
          <button onClick={onDelete} aria-label="Delete" className="h-9 w-9 rounded-full border border-white/[.12] bg-white/[.06] hover:bg-red-500/30 hover:border-red-400/40 flex items-center justify-center text-white transition-colors active:scale-95">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        {count > 1 && (
          <>
            <span className="px-1.5 text-xs font-semibold tabular-nums text-white/90">{index + 1} / {count}</span>
            <button onClick={() => goTo(index + 1)} aria-label="Next" className={btn}>
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
