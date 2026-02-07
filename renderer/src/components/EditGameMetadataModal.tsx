import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { ImageIcon, Loader2, Save, X } from "lucide-react"
import { DialogDescription } from "@/components/ui/dialog"
import { proxyImageUrl } from "@/lib/utils"
import type { Game } from "@/lib/types"

interface EditGameMetadataModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  game: Game
  onSaved: (updates: Record<string, any>) => void
}

export function EditGameMetadataModal({ open, onOpenChange, game, onSaved }: EditGameMetadataModalProps) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [developer, setDeveloper] = useState("")
  const [version, setVersion] = useState("")
  const [size, setSize] = useState("")
  const [cardImage, setCardImage] = useState("")
  const [bannerImage, setBannerImage] = useState("")
  const [genres, setGenres] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cardImagePreview, setCardImagePreview] = useState<string | null>(null)
  const [bannerImagePreview, setBannerImagePreview] = useState<string | null>(null)

  useEffect(() => {
    if (open && game) {
      setName(game.name || "")
      setDescription(game.description || "")
      setDeveloper(game.developer || "")
      setVersion(game.version || "")
      setSize(game.size || "")
      setCardImage(game.image || "")
      setBannerImage(game.splash || "")
      setGenres(game.genres?.join(", ") || "")
      setCardImagePreview(game.image ? proxyImageUrl(game.image) : null)
      setBannerImagePreview(game.splash ? proxyImageUrl(game.splash) : null)
      setError(null)
      setSaving(false)
    }
  }, [open, game])

  const handlePickCardImage = async () => {
    try {
      const path = await window.ucDownloads?.pickImage?.()
      if (path) {
        setCardImage(path)
        setCardImagePreview(proxyImageUrl(path))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pick image")
    }
  }

  const handlePickBannerImage = async () => {
    try {
      const path = await window.ucDownloads?.pickImage?.()
      if (path) {
        setBannerImage(path)
        setBannerImagePreview(proxyImageUrl(path))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pick image")
    }
  }

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Game name is required")
      return
    }

    setSaving(true)
    setError(null)

    try {
      const parsedGenres = genres
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean)

      const updates: Record<string, any> = {
        name: name.trim(),
        description: description.trim(),
        developer: developer.trim(),
        version: version.trim(),
        size: size.trim(),
        image: cardImage.trim(),
        splash: bannerImage.trim(),
        genres: parsedGenres,
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
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Save className="h-5 w-5 text-primary" />
            Edit Game Details
          </DialogTitle>
          <DialogDescription className="sr-only">Edit metadata for this game</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Images Row */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Images
            </Label>
            <div className="flex gap-3">
              {/* Card Image */}
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Card</p>
                <button
                  type="button"
                  onClick={handlePickCardImage}
                  disabled={saving}
                  className="group/card relative h-28 w-20 rounded-lg border border-border/60 bg-muted/30 overflow-hidden flex items-center justify-center cursor-pointer hover:border-primary/60 transition-colors"
                >
                  {cardImagePreview ? (
                    <img
                      src={cardImagePreview}
                      alt="Card"
                      className="h-full w-full object-cover"
                      onError={() => setCardImagePreview(null)}
                    />
                  ) : (
                    <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
                  )}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/card:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="text-xs text-white font-medium">Change</span>
                  </div>
                  {cardImage && (
                    <div
                      onClick={(e) => { e.stopPropagation(); setCardImage(""); setCardImagePreview(null) }}
                      className="absolute top-1 right-1 h-4 w-4 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-opacity hover:bg-destructive cursor-pointer"
                    >
                      <X className="h-2.5 w-2.5" />
                    </div>
                  )}
                </button>
              </div>
              {/* Banner Image */}
              <div className="flex-1 space-y-1">
                <p className="text-xs text-muted-foreground">Banner</p>
                <button
                  type="button"
                  onClick={handlePickBannerImage}
                  disabled={saving}
                  className="group/banner relative h-28 w-full rounded-lg border border-border/60 bg-muted/30 overflow-hidden flex items-center justify-center cursor-pointer hover:border-primary/60 transition-colors"
                >
                  {bannerImagePreview ? (
                    <img
                      src={bannerImagePreview}
                      alt="Banner"
                      className="h-full w-full object-cover"
                      onError={() => setBannerImagePreview(null)}
                    />
                  ) : (
                    <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
                  )}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/banner:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="text-xs text-white font-medium">Change</span>
                  </div>
                  {bannerImage && (
                    <div
                      onClick={(e) => { e.stopPropagation(); setBannerImage(""); setBannerImagePreview(null) }}
                      className="absolute top-1 right-1 h-4 w-4 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover/banner:opacity-100 transition-opacity hover:bg-destructive cursor-pointer"
                    >
                      <X className="h-2.5 w-2.5" />
                    </div>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="edit-name">Game Name</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Game name"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="edit-description">Description</Label>
            <Textarea
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of the game..."
              rows={3}
              className="resize-none"
            />
          </div>

          {/* Developer */}
          <div className="space-y-2">
            <Label htmlFor="edit-developer">Developer</Label>
            <Input
              id="edit-developer"
              value={developer}
              onChange={(e) => setDeveloper(e.target.value)}
              placeholder="Developer name"
            />
          </div>

          {/* Version + Size row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="edit-version">Version</Label>
              <Input
                id="edit-version"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="e.g. 1.0.2"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-size">Size</Label>
              <Input
                id="edit-size"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                placeholder="e.g. 15 GB"
              />
            </div>
          </div>

          {/* Genres */}
          <div className="space-y-2">
            <Label htmlFor="edit-genres">Genres</Label>
            <Input
              id="edit-genres"
              value={genres}
              onChange={(e) => setGenres(e.target.value)}
              placeholder="Action, Adventure, RPG"
            />
            <p className="text-xs text-muted-foreground">Comma-separated</p>
            {genres.trim() && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {genres.split(",").map((g) => g.trim()).filter(Boolean).map((g) => (
                  <Badge
                    key={g}
                    variant={g.toLowerCase() === "nsfw" ? "destructive" : "default"}
                    className="px-2 py-0.5 text-xs rounded-full bg-primary/20 border-primary/30 text-primary"
                  >
                    {g}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-center gap-2">
              <X className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Details
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
