import { useEffect, useState } from "react"
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

// Fixed preview height (px); width is derived from aspect ratio
const PREVIEW_H = 176

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

  return { offsetX, offsetY, drawWidth, drawHeight }
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

export function ProfileMediaCropDialog({ open, kind, file, onOpenChange, onApply }: Props) {
  const [zoom, setZoom] = useState(1)
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null)

  const { width: tw, height: th } = TARGET_SIZE[kind]
  const PREVIEW_W = Math.round(PREVIEW_H * (tw / th))

  // Minimum zoom: scale that makes the image fit entirely (contain), as a fraction of cover-scale
  const minZoom = imageSize
    ? (() => {
        const base = Math.max(tw / imageSize.w, th / imageSize.h)
        const contain = Math.min(tw / imageSize.w, th / imageSize.h)
        return Math.max(0.05, Math.round((contain / base) * 1000) / 1000)
      })()
    : 0.1

  // Pixel-accurate preview: mirrors computeDrawBox scaled to PREVIEW_H
  const previewStyle = imageSize && sourceUrl
    ? (() => {
        const k = PREVIEW_H / th
        const { offsetX, offsetY, drawWidth, drawHeight } = computeDrawBox(
          imageSize.w, imageSize.h, tw, th, { zoom, panX, panY }
        )
        return {
          left: Math.round(offsetX * k),
          top: Math.round(offsetY * k),
          width: Math.round(drawWidth * k),
          height: Math.round(drawHeight * k),
        }
      })()
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
    setZoom(Math.max(0.05, Math.round((contain / base) * 1000) / 1000))
  }

  const resetValues = () => {
    setZoom(1)
    setPanX(0)
    setPanY(0)
    setImageSize(null)
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
          <DialogTitle>Adjust {kind === "avatar" ? "avatar" : "banner"}</DialogTitle>
          <DialogDescription>
            Position and scale your image before uploading.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl border border-white/[.07] bg-zinc-900/50 p-4">
            <p className="mb-2 text-xs text-zinc-400">Live preview</p>
            <div
              className={`relative mx-auto overflow-hidden border border-zinc-700/70 bg-zinc-950/70 ${kind === "avatar" ? "rounded-full" : "rounded-xl"}`}
              style={{ width: PREVIEW_W, height: PREVIEW_H }}
            >
              {sourceUrl && (
                <img
                  src={sourceUrl}
                  alt="Crop preview"
                  className="absolute max-w-none"
                  style={
                    previewStyle
                      ? { left: previewStyle.left, top: previewStyle.top, width: previewStyle.width, height: previewStyle.height }
                      : { opacity: 0 }
                  }
                  onLoad={handleImageLoad}
                />
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-zinc-400">
                <span>Zoom</span>
                <span>{zoom.toFixed(2)}x</span>
              </div>
              <Slider value={[zoom]} min={minZoom} max={3} step={0.01} onValueChange={(v) => setZoom(v[0] ?? minZoom)} />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-zinc-400">
                <span>Horizontal</span>
                <span>{panX}%</span>
              </div>
              <Slider value={[panX]} min={-100} max={100} step={1} onValueChange={(v) => setPanX(Math.round(v[0] ?? 0))} />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-zinc-400">
                <span>Vertical</span>
                <span>{panY}%</span>
              </div>
              <Slider value={[panY]} min={-100} max={100} step={1} onValueChange={(v) => setPanY(Math.round(v[0] ?? 0))} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={applyCrop} disabled={!file || submitting}>
            {submitting ? "Applying..." : "Apply crop"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
