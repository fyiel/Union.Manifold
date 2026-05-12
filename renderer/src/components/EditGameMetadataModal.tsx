import { useEffect, useMemo, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ImageIcon, Link as LinkIcon, Loader2, Save, Upload, X } from "lucide-react"
import { proxyImageUrl, cn } from "@/lib/utils"
import type { Game } from "@/lib/types"

interface EditGameMetadataModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  game: Game
  onSaved: (updates: Record<string, any>) => void
}

type ImageMode = "file" | "url"

export function EditGameMetadataModal({ open, onOpenChange, game, onSaved }: EditGameMetadataModalProps) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [developer, setDeveloper] = useState("")
  const [version, setVersion] = useState("")
  const [size, setSize] = useState("")
  const [cardImage, setCardImage] = useState("")
  const [bannerImage, setBannerImage] = useState("")
  const [genres, setGenres] = useState<string[]>([])
  const [genreDraft, setGenreDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cardMode, setCardMode] = useState<ImageMode>("file")
  const [bannerMode, setBannerMode] = useState<ImageMode>("file")
  const initialSnapshotRef = useRef<string>("")

  const cardPreview = cardImage ? proxyImageUrl(cardImage) : null
  const bannerPreview = bannerImage ? proxyImageUrl(bannerImage) : null

  useEffect(() => {
    if (open && game) {
      const initialName = game.name || ""
      const initialDesc = game.description || ""
      const initialDev = game.developer || ""
      const initialVersion = game.version || ""
      const initialSize = game.size || ""
      const initialCard = game.image || ""
      const initialBanner = (game as any).splash || ""
      const initialGenres = Array.isArray(game.genres) ? [...game.genres] : []

      setName(initialName)
      setDescription(initialDesc)
      setDeveloper(initialDev)
      setVersion(initialVersion)
      setSize(initialSize)
      setCardImage(initialCard)
      setBannerImage(initialBanner)
      setGenres(initialGenres)
      setGenreDraft("")
      setCardMode(isLikelyUrl(initialCard) ? "url" : "file")
      setBannerMode(isLikelyUrl(initialBanner) ? "url" : "file")
      setError(null)
      setSaving(false)

      initialSnapshotRef.current = JSON.stringify({
        name: initialName,
        description: initialDesc,
        developer: initialDev,
        version: initialVersion,
        size: initialSize,
        image: initialCard,
        splash: initialBanner,
        genres: initialGenres,
      })
    }
  }, [open, game])

  const dirty = useMemo(() => {
    const current = JSON.stringify({
      name: name.trim(),
      description: description.trim(),
      developer: developer.trim(),
      version: version.trim(),
      size: size.trim(),
      image: cardImage.trim(),
      splash: bannerImage.trim(),
      genres,
    })
    return current !== initialSnapshotRef.current
  }, [name, description, developer, version, size, cardImage, bannerImage, genres])

  const pickImageFile = async (target: "card" | "banner") => {
    try {
      const path = await window.ucDownloads?.pickImage?.()
      if (path) {
        if (target === "card") setCardImage(path)
        else setBannerImage(path)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pick image")
    }
  }

  const addGenre = (raw: string) => {
    const value = raw.trim()
    if (!value) return
    if (genres.some((g) => g.toLowerCase() === value.toLowerCase())) return
    setGenres((prev) => [...prev, value])
    setGenreDraft("")
  }

  const removeGenre = (genre: string) => {
    setGenres((prev) => prev.filter((g) => g !== genre))
  }

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Game name is required.")
      return
    }

    setSaving(true)
    setError(null)

    try {
      const updates: Record<string, any> = {
        name: name.trim(),
        description: description.trim(),
        developer: developer.trim(),
        version: version.trim(),
        size: size.trim(),
        image: cardImage.trim(),
        splash: bannerImage.trim(),
        genres,
        update_time: new Date().toISOString(),
      }

      const result = await window.ucDownloads?.updateInstalledMetadata?.(game.appid, updates)

      if (result?.ok) {
        onSaved(updates)
        onOpenChange(false)
      } else {
        setError(result?.error || "Failed to save. Please try again.")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save metadata")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        <div className="px-6 pt-6 pb-2">
          <DialogHeader className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-white/[.07] bg-white/[.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                External
              </span>
              <DialogTitle className="text-lg">Edit game details</DialogTitle>
            </div>
            <DialogDescription className="text-zinc-400">
              Customize how this game appears in your library. Changes only affect your local copy.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 pb-2 space-y-6">
          {/* Banner — full-width hero, what users see at the top of the game page */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                Hero banner
              </Label>
              <ImageSourceTabs mode={bannerMode} onChange={setBannerMode} />
            </div>
            <ImageDrop
              ratio="aspect-[16/9]"
              preview={bannerPreview}
              hint="Used at the top of the game page. 16:9 works best."
              onPickFile={() => pickImageFile("banner")}
              onClear={() => setBannerImage("")}
              mode={bannerMode}
              urlValue={bannerImage}
              onUrlChange={setBannerImage}
            />
          </div>

          {/* Cover + identity row */}
          <div className="grid gap-4 sm:grid-cols-[148px_1fr]">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                  Cover
                </Label>
              </div>
              <ImageSourceTabs mode={cardMode} onChange={setCardMode} compact />
              <ImageDrop
                ratio="aspect-[2/3]"
                preview={cardPreview}
                hint="2:3 portrait."
                onPickFile={() => pickImageFile("card")}
                onClear={() => setCardImage("")}
                mode={cardMode}
                urlValue={cardImage}
                onUrlChange={setCardImage}
                compact
              />
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-name">Name</Label>
                <Input
                  id="edit-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Game name"
                  className="h-10"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-developer">Developer</Label>
                <Input
                  id="edit-developer"
                  value={developer}
                  onChange={(e) => setDeveloper(e.target.value)}
                  placeholder="Studio or publisher"
                  className="h-10"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-version">Version</Label>
                  <Input
                    id="edit-version"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    placeholder="1.0.2"
                    className="h-10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-size">Size</Label>
                  <Input
                    id="edit-size"
                    value={size}
                    onChange={(e) => setSize(e.target.value)}
                    placeholder="15 GB"
                    className="h-10"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="edit-description">Description</Label>
            <Textarea
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this game about?"
              rows={3}
              className="resize-none"
            />
          </div>

          {/* Genres — chip-based */}
          <div className="space-y-2">
            <Label htmlFor="edit-genre-input">Genres</Label>
            <div className="rounded-2xl border border-white/[.07] bg-white/[.02] p-2 focus-within:border-white/20 transition-colors">
              <div className="flex flex-wrap gap-1.5">
                {genres.map((g) => {
                  const isNsfw = g.toLowerCase() === "nsfw"
                  return (
                    <span
                      key={g}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
                        isNsfw
                          ? "border-red-500/30 bg-red-500/10 text-red-300"
                          : "border-white/[.07] bg-white/[.04] text-zinc-200"
                      )}
                    >
                      {g}
                      <button
                        type="button"
                        onClick={() => removeGenre(g)}
                        className={cn(
                          "ml-0.5 inline-flex items-center justify-center h-4 w-4 rounded-full transition-colors",
                          isNsfw ? "hover:bg-red-500/20" : "hover:bg-white/[.10]"
                        )}
                        aria-label={`Remove ${g}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  )
                })}
                <input
                  id="edit-genre-input"
                  value={genreDraft}
                  onChange={(e) => setGenreDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault()
                      addGenre(genreDraft)
                    } else if (e.key === "Backspace" && !genreDraft && genres.length > 0) {
                      e.preventDefault()
                      removeGenre(genres[genres.length - 1])
                    }
                  }}
                  onBlur={() => addGenre(genreDraft)}
                  placeholder={genres.length === 0 ? "Type a genre and press Enter…" : "Add another…"}
                  className="flex-1 min-w-[120px] bg-transparent border-0 outline-none text-sm text-zinc-100 placeholder:text-zinc-500 px-2 py-1"
                />
              </div>
            </div>
            <p className="text-[11px] text-zinc-500">
              Press <kbd className="rounded bg-white/[.06] px-1 font-mono text-[10px]">Enter</kbd> or
              <kbd className="rounded bg-white/[.06] px-1 font-mono text-[10px] ml-1">,</kbd> to add.
            </p>
          </div>

          {error && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-start gap-2">
              <X className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter className="px-6 pb-6 pt-2 flex items-center sm:justify-between gap-3">
          <p className="text-xs text-zinc-500 hidden sm:block">
            {dirty ? "Unsaved changes" : "No changes"}
          </p>
          <div className="flex justify-end gap-2 ml-auto">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !name.trim() || !dirty}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ImageSourceTabs({
  mode,
  onChange,
  compact,
}: {
  mode: ImageMode
  onChange: (mode: ImageMode) => void
  compact?: boolean
}) {
  return (
    <div className={cn(
      "inline-flex items-center rounded-full border border-white/[.07] bg-white/[.03] p-0.5",
      compact ? "text-[10px]" : "text-[11px]"
    )}>
      {(["file", "url"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-semibold tracking-wide transition-colors",
            mode === m ? "bg-white text-black" : "text-zinc-400 hover:text-zinc-100"
          )}
        >
          {m === "file" ? <Upload className="h-3 w-3" /> : <LinkIcon className="h-3 w-3" />}
          {m === "file" ? "File" : "URL"}
        </button>
      ))}
    </div>
  )
}

function ImageDrop({
  ratio,
  preview,
  hint,
  onPickFile,
  onClear,
  mode,
  urlValue,
  onUrlChange,
  compact,
}: {
  ratio: string
  preview: string | null
  hint: string
  onPickFile: () => void
  onClear: () => void
  mode: ImageMode
  urlValue: string
  onUrlChange: (value: string) => void
  compact?: boolean
}) {
  const [imgError, setImgError] = useState(false)

  useEffect(() => {
    setImgError(false)
  }, [preview])

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "group relative w-full overflow-hidden rounded-2xl border border-white/[.07] bg-white/[.02] transition-colors",
          ratio,
          mode === "file" ? "cursor-pointer hover:border-white/20" : ""
        )}
        onClick={mode === "file" ? onPickFile : undefined}
        role={mode === "file" ? "button" : undefined}
      >
        {preview && !imgError ? (
          <>
            <img
              src={preview}
              alt=""
              className="h-full w-full object-cover"
              onError={() => setImgError(true)}
            />
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <span className="text-xs font-semibold text-white">
                {mode === "file" ? "Replace" : "Preview"}
              </span>
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onClear() }}
              className="absolute top-2 right-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/[.10] bg-black/70 text-zinc-300 backdrop-blur-sm hover:bg-red-500/20 hover:text-red-300 hover:border-red-500/30 transition-colors opacity-0 group-hover:opacity-100"
              aria-label="Clear image"
            >
              <X className="h-3 w-3" />
            </button>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500 gap-1.5 px-3 text-center">
            <ImageIcon className={compact ? "h-5 w-5" : "h-6 w-6"} />
            <span className={cn("font-medium", compact ? "text-[10px]" : "text-xs")}>
              {imgError ? "Couldn't load image" : mode === "file" ? "Click to choose a file" : "Paste a URL below"}
            </span>
            {!compact && <span className="text-[10px] text-zinc-600">{hint}</span>}
          </div>
        )}
      </div>

      {mode === "url" && (
        <Input
          value={urlValue}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="https://…"
          className="h-9 text-xs"
        />
      )}
    </div>
  )
}

function isLikelyUrl(value: string | undefined): boolean {
  if (!value) return false
  return /^https?:\/\//i.test(value)
}
