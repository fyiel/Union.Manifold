import { createPortal } from "react-dom"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  Check,
  ChevronRight,
  ExternalLink,
  FolderOpen,
  Heart,
  Layers3,
  Pencil,
  Plus,
  Settings,
  Star,
  Terminal,
  Trash2,
  Unlink2,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"

export type GameActionMenuPoint = {
  x: number
  y: number
}

type ShortcutFeedback = {
  type: "success" | "error"
  message: string
} | null

export type CollectionPickerEntry = {
  /** Stable identifier — appid string or cloud collection id. Used for keys. */
  id: string
  name: string
  /** True if the target game is already in this collection. */
  included: boolean
}

type CollectionPickerProps = {
  /** Existing collections (with current membership flag) the user can toggle. */
  collections: CollectionPickerEntry[]
  /** Add the game to an existing collection (id matches CollectionPickerEntry.id). */
  onAddToCollection: (collectionId: string) => void | Promise<void>
  /** Remove the game from an existing collection. */
  onRemoveFromCollection: (collectionId: string) => void | Promise<void>
  /** Create a brand-new collection containing this game. */
  onCreateCollection: (name: string) => void | Promise<void>
}

type GameActionMenuPanelProps = {
  gameName: string
  gameSource?: string
  isExternal?: boolean
  isLinux?: boolean
  shortcutFeedback?: ShortcutFeedback
  /** Library-only actions. Pass `null` to hide entirely (e.g. on Browse). */
  onSetExecutable?: (() => void | Promise<void>) | null
  onOpenFiles?: (() => void | Promise<void>) | null
  onCreateShortcut?: (() => void | Promise<void>) | null
  onEditDetails?: () => void | Promise<void>
  onLinuxConfig?: () => void | Promise<void>
  /** When provided shows the delete/unlink row. */
  onDelete?: (() => void | Promise<void>) | null
  /** Wishlist toggle — when provided the menu shows an Add/Remove entry. */
  wishlist?: { inList: boolean; toggle: () => void | Promise<void> }
  /** Favorites/Liked toggle. */
  favorites?: { inList: boolean; toggle: () => void | Promise<void> }
  collectionPicker?: CollectionPickerProps
  className?: string
}

type GameActionContextMenuProps = GameActionMenuPanelProps & {
  open: boolean
  position: GameActionMenuPoint | null
  onClose: () => void
}

type MenuItemProps = {
  icon: LucideIcon
  label: string
  destructive?: boolean
  trailing?: React.ReactNode
  onClick: () => void | Promise<void>
}

function MenuItem({ icon: Icon, label, destructive = false, trailing, onClick }: MenuItemProps) {
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors active:scale-[0.98]",
        destructive
          ? "text-red-400 hover:bg-red-500/10 hover:text-red-300"
          : "text-zinc-300 hover:bg-white/[.06] hover:text-white"
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
      <span className="flex-1 text-left truncate">{label}</span>
      {trailing}
    </button>
  )
}

function CollectionPicker({ collections, onAddToCollection, onRemoveFromCollection, onCreateCollection }: CollectionPickerProps) {
  const [newDraft, setNewDraft] = useState("")
  const [filter, setFilter] = useState("")

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return collections
    return collections.filter((c) => c.name.toLowerCase().includes(q))
  }, [collections, filter])

  const draftCollides = collections.some(
    (c) => c.name.toLowerCase() === newDraft.trim().toLowerCase()
  )

  return (
    <div className="space-y-1.5 px-1 py-1">
      {collections.length > 4 && (
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="w-full rounded-lg border border-white/[.07] bg-white/[.03] px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-500 outline-none focus-visible:border-white/20"
        />
      )}

      <div className="max-h-40 overflow-y-auto uc-scrollbar space-y-px pr-1">
        {collections.length === 0 ? (
          <p className="px-2 py-1.5 text-[11px] text-zinc-500 italic">
            No collections yet. Create one below.
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-1.5 text-[11px] text-zinc-500 italic">
            No match.
          </p>
        ) : (
          filtered.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() =>
                void (entry.included
                  ? onRemoveFromCollection(entry.id)
                  : onAddToCollection(entry.id))
              }
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors",
                entry.included
                  ? "bg-white/[.06] text-white"
                  : "text-zinc-300 hover:bg-white/[.05] hover:text-white"
              )}
            >
              <div
                className={cn(
                  "shrink-0 inline-flex h-4 w-4 items-center justify-center rounded border transition-colors",
                  entry.included
                    ? "border-white bg-white text-black"
                    : "border-zinc-600 bg-black/30 text-transparent"
                )}
              >
                <Check className="h-3 w-3" />
              </div>
              <span className="truncate flex-1">{entry.name}</span>
            </button>
          ))
        )}
      </div>

      <div className="border-t border-white/[.06] pt-1.5">
        <div className="flex items-center gap-1.5">
          <Plus className="h-3 w-3 text-zinc-500" />
          <input
            value={newDraft}
            onChange={(e) => setNewDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                const name = newDraft.trim()
                if (!name || draftCollides) return
                void onCreateCollection(name)
                setNewDraft("")
              }
            }}
            placeholder="New collection…"
            className="flex-1 min-w-0 rounded-md border border-transparent bg-transparent px-1 py-1 text-xs text-zinc-200 placeholder:text-zinc-500 outline-none focus-visible:border-white/10"
          />
          {newDraft.trim() && !draftCollides && (
            <button
              type="button"
              onClick={() => {
                const name = newDraft.trim()
                if (!name) return
                void onCreateCollection(name)
                setNewDraft("")
              }}
              className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-semibold text-black hover:bg-zinc-200"
            >
              Add
            </button>
          )}
        </div>
        {draftCollides && (
          <p className="mt-1 px-1 text-[10px] text-amber-300/80">
            That name already exists — toggle it above instead.
          </p>
        )}
      </div>
    </div>
  )
}

export function GameActionMenuPanel({
  isExternal = false,
  isLinux = false,
  shortcutFeedback = null,
  onSetExecutable,
  onOpenFiles,
  onCreateShortcut,
  onEditDetails,
  onLinuxConfig,
  onDelete,
  wishlist,
  favorites,
  collectionPicker,
  className,
}: GameActionMenuPanelProps) {
  const [pickerOpen, setPickerOpen] = useState(false)

  const hasLibraryGroup = Boolean(onSetExecutable || onOpenFiles || onCreateShortcut || onEditDetails || (isLinux && onLinuxConfig))
  const hasListGroup = Boolean(wishlist || favorites)

  return (
    <div
      className={cn(
        "w-56 rounded-xl border border-white/[.07] bg-zinc-950/95 p-1 text-white shadow-xl backdrop-blur-xl",
        className
      )}
    >
      {hasLibraryGroup && (
        <div className="space-y-px">
          {onSetExecutable ? <MenuItem icon={Settings} label="Set Executable" onClick={onSetExecutable} /> : null}
          {onOpenFiles ? <MenuItem icon={FolderOpen} label="Open Files" onClick={onOpenFiles} /> : null}
          {onCreateShortcut ? <MenuItem icon={ExternalLink} label="Create Shortcut" onClick={onCreateShortcut} /> : null}
          {onEditDetails ? <MenuItem icon={Pencil} label="Edit Details" onClick={onEditDetails} /> : null}
          {isLinux && onLinuxConfig ? <MenuItem icon={Terminal} label="Linux / VR Config" onClick={onLinuxConfig} /> : null}
        </div>
      )}

      {hasListGroup && (
        <>
          {hasLibraryGroup && <div className="my-1 h-px bg-white/[.06]" />}
          <div className="space-y-px">
            {wishlist ? (
              <MenuItem
                icon={Star}
                label={wishlist.inList ? "Remove from wishlist" : "Add to wishlist"}
                onClick={wishlist.toggle}
              />
            ) : null}
            {favorites ? (
              <MenuItem
                icon={Heart}
                label={favorites.inList ? "Remove from liked" : "Add to liked"}
                onClick={favorites.toggle}
              />
            ) : null}
          </div>
        </>
      )}

      {collectionPicker ? (
        <>
          {(hasLibraryGroup || hasListGroup) && <div className="my-1 h-px bg-white/[.06]" />}
          <MenuItem
            icon={Layers3}
            label="Add to collection"
            trailing={
              <ChevronRight
                className={cn(
                  "h-3 w-3 text-zinc-500 transition-transform",
                  pickerOpen && "rotate-90"
                )}
              />
            }
            onClick={() => setPickerOpen((prev) => !prev)}
          />
          {pickerOpen && (
            <CollectionPicker
              collections={collectionPicker.collections}
              onAddToCollection={collectionPicker.onAddToCollection}
              onRemoveFromCollection={collectionPicker.onRemoveFromCollection}
              onCreateCollection={collectionPicker.onCreateCollection}
            />
          )}
        </>
      ) : null}

      {onDelete && (
        <>
          <div className="my-1 h-px bg-white/[.06]" />
          <MenuItem
            icon={isExternal ? Unlink2 : Trash2}
            label={isExternal ? "Unlink Game" : "Delete Game"}
            destructive
            onClick={onDelete}
          />
        </>
      )}

      {shortcutFeedback ? (
        <div
          className={cn(
            "mt-1 rounded-lg border px-2.5 py-1.5 text-xs",
            shortcutFeedback.type === "success"
              ? "border-white/[.07] bg-white/[.04] text-zinc-400"
              : "border-red-500/20 bg-red-500/10 text-red-300"
          )}
        >
          {shortcutFeedback.message}
        </div>
      ) : null}
    </div>
  )
}

export function GameActionContextMenu({
  open,
  position,
  onClose,
  className,
  ...panelProps
}: GameActionContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [resolvedPosition, setResolvedPosition] = useState<GameActionMenuPoint | null>(position)

  useLayoutEffect(() => {
    if (!open || !position) return

    const padding = 12
    const rect = menuRef.current?.getBoundingClientRect()
    const width = rect?.width || 288
    const height = rect?.height || 360

    setResolvedPosition({
      x: Math.min(Math.max(padding, position.x), window.innerWidth - width - padding),
      y: Math.min(Math.max(padding, position.y), window.innerHeight - height - padding),
    })
  }, [open, position, panelProps.shortcutFeedback?.message])

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
      }
    }

    const handleResize = () => onClose()

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("resize", handleResize)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("resize", handleResize)
    }
  }, [open, onClose])

  if (!open || !position || typeof document === "undefined") return null

  const left = resolvedPosition?.x ?? position.x
  const top = resolvedPosition?.y ?? position.y

  return createPortal(
    <div
      className="fixed inset-0 z-[80]"
      onMouseDown={onClose}
      onContextMenu={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div
        ref={menuRef}
        className="absolute"
        style={{ left, top }}
        onMouseDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.stopPropagation()}
      >
        <GameActionMenuPanel {...panelProps} className={className} />
      </div>
    </div>,
    document.body
  )
}
