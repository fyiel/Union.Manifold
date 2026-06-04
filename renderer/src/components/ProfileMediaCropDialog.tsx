import { useEffect, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { ZoomIn, RotateCcw } from "lucide-react"

type CropKind = "avatar" | "banner"

type CropValues = {
  zoom: number
  panX: number
  panY: number
}

type Props = {
  open: boolean
  kind: CropKind
  file: File | null
  onOpenChange: (open: boolean) => void
  onApply: (file: File) => void
}

const TARGET_SIZE: Record<CropKind, { width: number; height: number }> = {
  avatar: { width: 512, height: 512 },
  banner: { width: 1500, height: 500 },
}

const MAX_ZOOM = 4

// Stage (the interactive crop viewport) is fit inside these bounds keeping the
// output aspect ratio, so the avatar is a big rounded square and the banner is a
// wide strip — both shown at the same shape they appear on the profile.
const STAGE_MAX_W = 520
const STAGE_MAX_H = 340

function computeDrawBox(
  imageWidth: number,
  imageHeight: number,
  targetWidth: number,
  targetHeight: number,
  values: CropValues
) {
  const baseScale = Math.max(targetWidth / imageWidth, targetHeight / imageHeight)
  const drawScale = baseScale * values.zoom
  const drawWidth = imageWidth * drawScale
  const drawHeight = imageHeight * drawScale

  const maxPanX = Math.max(0, (drawWidth - targetWidth) / 2)
  const maxPanY = Math.max(0, (drawHeight - targetHeight) / 2)

  const offsetX = (targetWidth - drawWidth) / 2 + (values.panX / 100) * maxPanX
  const offsetY = (targetHeight - drawHeight) / 2 + (values.panY / 100) * maxPanY

  return { offsetX, offsetY, drawWidth, drawHeight, maxPanX, maxPanY }
}

async function renderCroppedFile(file: File, kind: CropKind, values: CropValues): Promise<File> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error("Failed to load image"))
      img.src = objectUrl
    })

    const target = TARGET_SIZE[kind]
    const canvas = document.createElement("canvas")
    canvas.width = target.width
    canvas.height = target.height

    const context = canvas.getContext("2d")
    if (!context) throw new Error("Canvas not available")

    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = "high"

    const draw = computeDrawBox(image.width, image.height, target.width, target.height, values)
    context.drawImage(image, draw.offsetX, draw.offsetY, draw.drawWidth, draw.drawHeight)

    let quality = 0.92
    if (file.size > 2 * 1024 * 1024) quality = 0.82
    if (file.size > 5 * 1024 * 1024) quality = 0.7

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) => {
          if (!value) { reject(new Error("Failed to create cropped image")); return }
          resolve(value)
        },
        "image/webp",
        quality
      )
    })

    return new File([blob], `${kind}-${Date.now()}.webp`, { type: "image/webp" })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function ProfileMediaCropDialog({ open, kind, file, onOpenChange, onApply }: Props) {
  const [zoom, setZoom] = useState(1)
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  // Live pan/zoom are mutated rapidly during a drag; refs avoid stale closures
  // inside the pointer handlers without forcing the values through state on
  // every pointermove.
  const dragState = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null)
  const panRef = useRef({ x: 0, y: 0 })
  const zoomRef = useRef(1)
  useEffect(() => { panRef.current = { x: panX, y: panY } }, [panX, panY])
  useEffect(() => { zoomRef.current = zoom }, [zoom])

  const { width: tw, height: th } = TARGET_SIZE[kind]
  const aspect = tw / th
  // Fit the stage inside the bounds keeping aspect.
  let STAGE_W = STAGE_MAX_W
  let STAGE_H = Math.round(STAGE_MAX_W / aspect)
  if (STAGE_H > STAGE_MAX_H) {
    STAGE_H = STAGE_MAX_H
    STAGE_W = Math.round(STAGE_MAX_H * aspect)
  }

  // Minimum zoom: scale that makes the image fit entirely (contain), as a fraction of cover-scale
  const minZoom = imageSize
    ? (() => {
        const base = Math.max(tw / imageSize.w, th / imageSize.h)
        const contain = Math.min(tw / imageSize.w, th / imageSize.h)
        return Math.max(0.05, Math.round((contain / base) * 1000) / 1000)
      })()
    : 0.1

  // Pixel-accurate preview: mirrors computeDrawBox scaled to the stage size.
  const box = imageSize
    ? computeDrawBox(imageSize.w, imageSize.h, tw, th, { zoom, panX, panY })
    : null
  const k = STAGE_H / th
  const previewStyle = box && sourceUrl
    ? {
        left: Math.round(box.offsetX * k),
        top: Math.round(box.offsetY * k),
        width: Math.round(box.drawWidth * k),
        height: Math.round(box.drawHeight * k),
      }
    : null

  useEffect(() => {
    if (!file) {
      setSourceUrl(null)
      setImageSize(null)
      return
    }
    const objectUrl = URL.createObjectURL(file)
    setSourceUrl(objectUrl)
    setImageSize(null)
    setPanX(0)
    setPanY(0)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    const iw = img.naturalWidth
    const ih = img.naturalHeight
    setImageSize({ w: iw, h: ih })
    const base = Math.max(tw / iw, th / ih)
    const contain = Math.min(tw / iw, th / ih)
    // Start at cover (zoom 1) so the frame is filled, matching how avatars are
    // displayed everywhere else.
    setZoom(Math.max(Math.max(0.05, Math.round((contain / base) * 1000) / 1000), 1))
    setPanX(0)
    setPanY(0)
  }

  const resetValues = () => {
    setZoom(1)
    setPanX(0)
    setPanY(0)
    setImageSize(null)
    setDragging(false)
    dragState.current = null
  }

  // ── Direct manipulation: drag to pan, wheel to zoom ──────────────────────
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!imageSize) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragState.current = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY }
    setDragging(true)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current
    if (!drag || drag.pointerId !== e.pointerId || !imageSize) return
    const dxPx = e.clientX - drag.lastX
    const dyPx = e.clientY - drag.lastY
    drag.lastX = e.clientX
    drag.lastY = e.clientY

    const current = computeDrawBox(imageSize.w, imageSize.h, tw, th, {
      zoom: zoomRef.current,
      panX: panRef.current.x,
      panY: panRef.current.y,
    })
    // Convert the on-screen drag (stage px) to target px (÷k), then to a % of
    // the available pan range. Dragging the image follows the cursor.
    if (current.maxPanX > 0) {
      const dPanX = ((dxPx / k) / current.maxPanX) * 100
      setPanX((prev) => clamp(prev + dPanX, -100, 100))
    }
    if (current.maxPanY > 0) {
      const dPanY = ((dyPx / k) / current.maxPanY) * 100
      setPanY((prev) => clamp(prev + dPanY, -100, 100))
    }
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragState.current?.pointerId === e.pointerId) {
      try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
      dragState.current = null
      setDragging(false)
    }
  }

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!imageSize) return
    const factor = Math.exp(-e.deltaY * 0.0015)
    setZoom((prev) => clamp(Math.round(prev * factor * 1000) / 1000, minZoom, MAX_ZOOM))
  }

  const applyCrop = async () => {
    if (!file) return
    setSubmitting(true)
    try {
      const cropped = await renderCroppedFile(file, kind, { zoom, panX, panY })
      onApply(cropped)
      resetValues()
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  const isAvatar = kind === "avatar"

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) resetValues()
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit {isAvatar ? "avatar" : "banner"}</DialogTitle>
          <DialogDescription>
            Drag to reposition · scroll or use the slider to zoom.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-5 py-2">
          {/* Interactive stage. The image is positioned pixel-accurately to
              match exactly what will be exported by the canvas pipeline. */}
          <div
            className="relative overflow-hidden rounded-2xl bg-black/60 ring-1 ring-white/10 select-none touch-none"
            style={{ width: STAGE_W, height: STAGE_H, cursor: dragging ? "grabbing" : "grab" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onWheel={onWheel}
          >
            {sourceUrl && (
              <img
                src={sourceUrl}
                alt="Crop preview"
                draggable={false}
                className="absolute max-w-none pointer-events-none"
                style={
                  previewStyle
                    ? { left: previewStyle.left, top: previewStyle.top, width: previewStyle.width, height: previewStyle.height }
                    : { opacity: 0 }
                }
                onLoad={handleImageLoad}
              />
            )}

            {/* Crop mask: dim everything outside the avatar circle / banner frame
                so the user sees exactly what's kept. */}
            <div
              aria-hidden
              className={`pointer-events-none absolute inset-0 rounded-2xl`}
              style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)" }}
            />
            <div
              aria-hidden
              className={`pointer-events-none absolute inset-0 ring-1 ring-white/40 rounded-2xl`}
            />
          </div>

          {/* Zoom control */}
          <div className="flex w-full max-w-sm items-center gap-3">
            <ZoomIn className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Slider
              value={[zoom]}
              min={minZoom}
              max={MAX_ZOOM}
              step={0.01}
              onValueChange={(v) => setZoom(clamp(v[0] ?? minZoom, minZoom, MAX_ZOOM))}
              className="flex-1"
            />
            <button
              type="button"
              onClick={() => { setZoom(1); setPanX(0); setPanY(0) }}
              className="shrink-0 inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[.04] px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground hover:bg-white/[.08]"
              title="Reset"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </button>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={applyCrop} disabled={!file || submitting}>
            {submitting ? "Applying..." : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
