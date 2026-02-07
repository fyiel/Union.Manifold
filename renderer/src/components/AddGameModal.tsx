import { useCallback, useEffect, useRef, useState } from "react"
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
import { Badge } from "@/components/ui/badge"
import { FolderOpen, Search, Loader2, ImageIcon, Plus, CheckCircle2 } from "lucide-react"
import { apiUrl } from "@/lib/api"
import { proxyImageUrl } from "@/lib/utils"

interface MatchedGame {
  appid: string
  name: string
  image: string
  genres: string[]
  size: string
  developer: string
}

interface AddGameModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddGameModal({ open, onOpenChange }: AddGameModalProps) {
  const [gameName, setGameName] = useState("")
  const [gamePath, setGamePath] = useState("")
  const [searching, setSearching] = useState(false)
  const [matchedGame, setMatchedGame] = useState<MatchedGame | null>(null)
  const [matchResults, setMatchResults] = useState<MatchedGame[]>([])
  const [showResults, setShowResults] = useState(false)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Reset state when modal opens/closes
  useEffect(() => {
    if (open) {
      setGameName("")
      setGamePath("")
      setMatchedGame(null)
      setMatchResults([])
      setShowResults(false)
      setImagePreview(null)
      setSaving(false)
      setSuccess(false)
      setError(null)
      setTimeout(() => nameInputRef.current?.focus(), 100)
    }
  }, [open])

  // Search UC catalog when name changes
  const searchUCCatalog = useCallback(async (name: string) => {
    if (!name || name.trim().length < 2) {
      setMatchResults([])
      setShowResults(false)
      setMatchedGame(null)
      setImagePreview(null)
      return
    }

    setSearching(true)
    try {
      const response = await fetch(apiUrl(`/api/games/suggestions?q=${encodeURIComponent(name.trim())}&limit=5&nsfw=true`))
      if (!response.ok) throw new Error("Search failed")
      const data = await response.json()

      const results: MatchedGame[] = (Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : data.results || [])
        .slice(0, 5)
        .map((game: any) => ({
          appid: game.appid,
          name: game.name,
          image: game.image || "",
          genres: Array.isArray(game.genres)
            ? game.genres
            : typeof game.genres === "string"
              ? (() => { try { return JSON.parse(game.genres) } catch { return [] } })()
              : [],
          size: game.size || "",
          developer: game.developer || "",
        }))

      setMatchResults(results)
      setShowResults(results.length > 0)

      // Auto-select exact or close match
      if (results.length > 0) {
        const exactMatch = results.find(
          (r) => r.name.toLowerCase() === name.trim().toLowerCase()
        )
        if (exactMatch) {
          selectMatch(exactMatch)
        }
      }
    } catch {
      // Silently fail — user can still add manually
      setMatchResults([])
      setShowResults(false)
    } finally {
      setSearching(false)
    }
  }, [])

  // Debounced search
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    if (!gameName.trim()) {
      setMatchResults([])
      setShowResults(false)
      return
    }
    searchTimeout.current = setTimeout(() => {
      searchUCCatalog(gameName)
    }, 400)
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current)
    }
  }, [gameName, searchUCCatalog])

  const selectMatch = (game: MatchedGame) => {
    setMatchedGame(game)
    setGameName(game.name)
    setShowResults(false)
    if (game.image) {
      setImagePreview(proxyImageUrl(game.image))
    }
  }

  const handlePickFolder = async () => {
    try {
      const result = await window.ucDownloads?.pickExternalGameFolder?.()
      if (result) {
        setGamePath(result)
      }
    } catch {
      // ignore
    }
  }

  const handleSave = async () => {
    if (!gameName.trim()) {
      setError("Please enter a game name")
      return
    }
    if (!gamePath.trim()) {
      setError("Please select the game folder")
      return
    }

    setSaving(true)
    setError(null)

    try {
      // Generate a unique appid for external games
      const appid = matchedGame?.appid || `external-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

      const metadata = {
        appid,
        name: gameName.trim(),
        description: matchedGame ? `Added from UC catalog match` : "Manually added external game",
        genres: matchedGame?.genres || [],
        image: matchedGame?.image || "",
        screenshots: [],
        release_date: "",
        size: matchedGame?.size || "",
        version: "",
        developer: matchedGame?.developer || "Unknown",
        source: matchedGame ? "uc-web" : "external",
        store: "",
        dlc: [],
        addedAt: Date.now(),
        externalPath: gamePath.trim(),
        isExternal: true,
      }

      // Use the IPC handler to register the game
      const result = await window.ucDownloads?.addExternalGame?.(appid, metadata, gamePath.trim())

      if (result?.ok) {
        setSuccess(true)
        // Dispatch event so library refreshes
        window.dispatchEvent(new Event("uc_game_installed"))
      } else {
        setError(result?.error || "Failed to add game. Please try again.")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add game")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-primary" />
            Add External Game
          </DialogTitle>
          <DialogDescription>
            Add a game downloaded from the UC website or another source. We'll try to match it with our catalog for images and metadata.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
            <p className="text-lg font-semibold text-foreground">Game Added!</p>
            <p className="text-sm text-muted-foreground">
              You can find it in your Library.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Game Name */}
            <div className="space-y-2">
              <Label htmlFor="game-name">Game Name</Label>
              <div className="relative">
                <Input
                  ref={nameInputRef}
                  id="game-name"
                  placeholder="e.g. Elden Ring, Cyberpunk 2077..."
                  value={gameName}
                  onChange={(e) => {
                    setGameName(e.target.value)
                    setMatchedGame(null)
                    setImagePreview(null)
                    setError(null)
                  }}
                  onFocus={() => {
                    if (matchResults.length > 0 && !matchedGame) setShowResults(true)
                  }}
                  className="pr-10"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {searching ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Search className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </div>

              {/* Search Results Dropdown */}
              {showResults && matchResults.length > 0 && (
                <div className="rounded-lg border border-border bg-card shadow-lg overflow-hidden">
                  <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border/50">
                    Matches from UC catalog
                  </div>
                  {matchResults.map((game) => (
                    <button
                      key={game.appid}
                      type="button"
                      onClick={() => selectMatch(game)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/50"
                    >
                      {game.image ? (
                        <img
                          src={proxyImageUrl(game.image)}
                          alt={game.name}
                          className="h-10 w-16 rounded object-cover bg-muted"
                          onError={(e) => {
                            ;(e.target as HTMLImageElement).style.display = "none"
                          }}
                        />
                      ) : (
                        <div className="flex h-10 w-16 items-center justify-center rounded bg-muted">
                          <ImageIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">{game.name}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {game.size && (
                            <span className="text-xs text-muted-foreground">{game.size}</span>
                          )}
                          {game.developer && (
                            <span className="text-xs text-muted-foreground">• {game.developer}</span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Matched Game Preview */}
              {matchedGame && (
                <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                  {imagePreview ? (
                    <img
                      src={imagePreview}
                      alt={matchedGame.name}
                      className="h-14 w-24 rounded-md object-cover bg-muted"
                      onError={() => setImagePreview(null)}
                    />
                  ) : (
                    <div className="flex h-14 w-24 items-center justify-center rounded-md bg-muted">
                      <ImageIcon className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-foreground">{matchedGame.name}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/30 text-primary">
                        UC Match
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {matchedGame.genres.slice(0, 3).map((genre) => (
                        <Badge key={genre} variant="secondary" className="text-[10px] px-1.5 py-0">
                          {genre}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Game Folder */}
            <div className="space-y-2">
              <Label>Game Folder</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  placeholder="Select the folder where the game is installed..."
                  value={gamePath}
                  className="flex-1 cursor-pointer"
                  onClick={handlePickFolder}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handlePickFolder}
                  className="shrink-0"
                  title="Browse for folder"
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Select the root folder containing the game's executable files.
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>
        )}

        {!success && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !gameName.trim() || !gamePath.trim()}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Game
                </>
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
