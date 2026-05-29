import { createPortal } from "react-dom"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { ComponentType } from "react"
import { Pencil } from "lucide-react"

/** Permissive icon component type — accepts both Lucide icons and our
 *  animated wrappers from `@/components/icons`. */
type MenuIconComponent = ComponentType<{ className?: string }>
import {
  Check,
  ChevronRight,
  Download,
  ExternalLink,
  EyeOff,
  FolderOpen,
  Heart,
  Layers3,
  Plus,
  Settings,
  Star,
  Terminal,
  Trash2,
  Unlink2,
} from "@/components/icons"

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
  /** Open the per-game "Launch options" dialog (custom CLI args). Available
   *  whenever the game is installed. */
  onLaunchOptions?: (() => void | Promise<void>) | null
  /** When provided shows the delete/unlink row. */
  onDelete?: (() => void | Promise<void>) | null
  /** Universal "download / queue" action for not-installed games. The
   *  `mode` lets us label the row correctly ("Add to download queue" when
   *  there's already an active download, otherwise "Download"). */
  download?: {
    mode: "download" | "queue"
    onClick: () => void | Promise<void>
  }
  /** Wishlist toggle — when provided the menu shows an Add/Remove entry. */
  wishlist?: { inList: boolean; toggle: () => void | Promise<void> }
  /** Favorites/Liked toggle. */
  favorites?: { inList: boolean; toggle: () => void | Promise<void> }
  /** Per-game Discord RPC mute. When `muted` is true the game is hidden
   *  from the Playing-X presence card on Discord. Independent from the
   *  global "Show in Discord" toggle. */
  rpcMute?: { muted: boolean; toggle: () => void | Promise<void> }
  collectionPicker?: CollectionPickerProps
  className?: string
}

type GameActionContextMenuProps = GameActionMenuPanelProps & {
  open: boolean
  position: GameActionMenuPoint | null
  onClose: () => void
}

type MenuItemProps = {
  icon: MenuIconComponent
  label: string
  destructive?: boolean
  /** Override icon color when the action is "triggered" (e.g. already in list). */
  iconClassName?: string
  /** When true, marks the icon's active row — currently signalled by a tinted
   *  dot under the icon since the animated SVGs don't accept `fill`. */
  iconFilled?: boolean
  trailing?: React.ReactNode
  onClick: () => void | Promise<void>
}

function MenuItem({ icon: Icon, label, destructive = false, iconClassName, iconFilled = false, trailing, onClick }: MenuItemProps) {
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors active:scale-[0.98]",
        destructive
          ? "text-red-400 hover:bg-red-500/10 hover:text-red-300"
          : "text-foreground/80 hover:bg-white/[.06] hover:text-white"
      )}
    >
      <span className={cn("relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center transition-colors", iconClassName ?? "text-muted-foreground/80")}>
        <Icon className="h-3.5 w-3.5" />
        {iconFilled ? (
          <span className="pointer-events-none absolute inset-0 rounded-full bg-current opacity-15" aria-hidden="true" />
        ) : null}
      </span>
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
          className="w-full rounded-lg border border-white/[.07] bg-white/[.03] px-2 py-1 text-xs text-foreground/90 placeholder:text-muted-foreground/80 outline-none focus-visible:border-white/20"
        />
      )}

      <div className="max-h-40 overflow-y-auto uc-scrollbar space-y-px pr-1">
        {collections.length === 0 ? (
          <p className="px-2 py-1.5 text-[11px] text-muted-foreground/80 italic">
            No collections yet. Create one below.
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-1.5 text-[11px] text-muted-foreground/80 italic">
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
                  : "text-foreground/80 hover:bg-white/[.05] hover:text-white"
              )}
            >
              <div
                className={cn(
                  "shrink-0 inline-flex h-4 w-4 items-center justify-center rounded border transition-colors",
                  entry.included
                    ? "border-white bg-primary text-primary-foreground"
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
          <Plus className="h-3 w-3 text-muted-foreground/80" />
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
            className="flex-1 min-w-0 rounded-md border border-transparent bg-transparent px-1 py-1 text-xs text-foreground/90 placeholder:text-muted-foreground/80 outline-none focus-visible:border-white/10"
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
              className="rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground hover:brightness-110"
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
  onLaunchOptions,
  onDelete,
  download,
  wishlist,
  favorites,
  rpcMute,
  collectionPicker,
  className,
}: GameActionMenuPanelProps) {
  const [pickerOpen, setPickerOpen] = useState(false)

  const hasInstallGroup = Boolean(download)
  const hasLibraryGroup = Boolean(onSetExecutable || onOpenFiles || onCreateShortcut || onEditDetails || onLaunchOptions || (isLinux && onLinuxConfig))
  const hasListGroup = Boolean(wishlist || favorites || rpcMute)

  return (
    <div
      className={cn(
        "w-56 rounded-xl border border-white/[.07] bg-background/95 p-1 text-white shadow-xl backdrop-blur-xl",
        className
      )}
    >
      {hasInstallGroup && download && (
        <div className="space-y-px">
          <MenuItem
            icon={Download}
            label={download.mode === "queue" ? "Add to download queue" : "Download"}
            onClick={download.onClick}
          />
        </div>
      )}

      {hasLibraryGroup && (
        <>
          {hasInstallGroup && <div className="my-1 h-px bg-white/[.06]" />}
          <div className="space-y-px">
            {onSetExecutable ? <MenuItem icon={Settings} label="Set Executable" onClick={onSetExecutable} /> : null}
            {onOpenFiles ? <MenuItem icon={FolderOpen} label="Open Files" onClick={onOpenFiles} /> : null}
            {onCreateShortcut ? <MenuItem icon={ExternalLink} label="Create Shortcut" onClick={onCreateShortcut} /> : null}
            {onLaunchOptions ? <MenuItem icon={Terminal} label="Launch options" onClick={onLaunchOptions} /> : null}
            {onEditDetails ? <MenuItem icon={Pencil} label="Edit Details" onClick={onEditDetails} /> : null}
            {isLinux && onLinuxConfig ? <MenuItem icon={Terminal} label="Linux / VR Config" onClick={onLinuxConfig} /> : null}
          </div>
        </>
      )}

      {hasListGroup && (
        <>
          {(hasInstallGroup || hasLibraryGroup) && <div className="my-1 h-px bg-white/[.06]" />}
          <div className="space-y-px">
            {wishlist ? (
              <MenuItem
                icon={Star}
                label={wishlist.inList ? "Remove from wishlist" : "Add to wishlist"}
                iconClassName={wishlist.inList ? "text-amber-400" : undefined}
                iconFilled={wishlist.inList}
                onClick={wishlist.toggle}
              />
            ) : null}
            {favorites ? (
              <MenuItem
                icon={Heart}
                label={favorites.inList ? "Remove from liked" : "Add to liked"}
                iconClassName={favorites.inList ? "text-rose-400" : undefined}
                iconFilled={favorites.inList}
                onClick={favorites.toggle}
              />
            ) : null}
            {rpcMute ? (
              <MenuItem
                icon={EyeOff}
                label={rpcMute.muted ? "Show on Discord" : "Hide from Discord"}
                iconClassName={rpcMute.muted ? "text-fuchsia-400" : undefined}
                iconFilled={rpcMute.muted}
                onClick={rpcMute.toggle}
              />
            ) : null}
          </div>
        </>
      )}

      {collectionPicker ? (
        <>
          {(hasInstallGroup || hasLibraryGroup || hasListGroup) && <div className="my-1 h-px bg-white/[.06]" />}
          {(() => {
            const includedCount = collectionPicker.collections.filter((c) => c.included).length
            return (
          <>
          <MenuItem
            icon={Layers3}
            label={includedCount > 0 ? `In ${includedCount} collection${includedCount === 1 ? "" : "s"}` : "Add to collection"}
            iconClassName={includedCount > 0 ? "text-sky-400" : undefined}
            trailing={
              <ChevronRight
                className={cn(
                  "h-3 w-3 text-muted-foreground/80 transition-transform",
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
            )
          })()}
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
              ? "border-white/[.07] bg-white/[.04] text-muted-foreground"
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
