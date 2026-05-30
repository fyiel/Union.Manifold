import { useEffect, useRef, useState } from "react"
import { X } from "@/components/icons"
import { Pencil } from "lucide-react"
import { MoreHorizontal, Trash2 } from "@/components/icons"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  CollectionActionContextMenu,
  COLLECTION_MENU_ICONS,
  type CollectionMenuPoint,
  type CollectionMenuSection,
} from "@/components/CollectionActionMenu"

type PillProps = {
  label: string
  /** When `label` already contains decoration (e.g. "#tag"), the rawLabel is what we use for editing. */
  rawLabel?: string
  count?: number
  active: boolean
  onClick: () => void
  onRename?: (next: string) => void
  onDelete?: () => void
  onRemoveFromSelected?: () => void
}

function Pill({
  label,
  rawLabel,
  count,
  active,
  onClick,
  onRename,
  onDelete,
  onRemoveFromSelected,
}: PillProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<CollectionMenuPoint | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState(rawLabel ?? label)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (renaming) {
      const id = window.setTimeout(() => inputRef.current?.select(), 50)
      return () => window.clearTimeout(id)
    }
  }, [renaming])

  const commitRename = () => {
    const next = renameDraft.trim()
    if (next && next !== (rawLabel ?? label)) {
      onRename?.(next)
    }
    setRenaming(false)
    setMenuOpen(false)
  }

  const hasManagement = Boolean(onRename || onDelete || onRemoveFromSelected)

  const buildContextSections = (): CollectionMenuSection[] => {
    const manage: CollectionMenuSection["items"] = []
    if (onRename) {
      manage.push({
        id: "rename",
        icon: COLLECTION_MENU_ICONS.rename,
        label: "Rename",
        onSelect: () => {
          setRenameDraft(rawLabel ?? label)
          setRenaming(true)
        },
      })
    }
    if (onRemoveFromSelected) {
      manage.push({
        id: "remove-from-selection",
        icon: COLLECTION_MENU_ICONS.edit,
        label: "Remove from selection",
        onSelect: onRemoveFromSelected,
      })
    }
    const danger: CollectionMenuSection["items"] = []
    if (onDelete) {
      danger.push({
        id: "delete",
        icon: COLLECTION_MENU_ICONS.delete,
        label: "Delete collection",
        destructive: true,
        onSelect: onDelete,
      })
    }
    const out: CollectionMenuSection[] = []
    if (manage.length > 0) out.push({ id: "manage", items: manage })
    if (danger.length > 0) out.push({ id: "danger", items: danger })
    return out
  }

  if (renaming) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs",
          "border-white/[.10] bg-white/[.06]"
        )}
      >
        <Input
          ref={inputRef}
          value={renameDraft}
          onChange={(e) => setRenameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              commitRename()
            } else if (e.key === "Escape") {
              e.preventDefault()
              setRenaming(false)
              setRenameDraft(rawLabel ?? label)
            }
          }}
          onBlur={commitRename}
          className="h-6 w-32 rounded-full border-none bg-transparent px-1 text-xs focus-visible:ring-0"
        />
      </span>
    )
  }

  return (
    <span
      className={cn(
        "group/pill inline-flex items-center gap-1 rounded-full border text-xs font-medium transition-all",
        active
          ? "border-white bg-primary text-primary-foreground"
          : "border-white/[.07] bg-white/[.03] text-foreground/80 hover:bg-white/[.07] hover:text-white"
      )}
      onContextMenu={(e) => {
        if (!hasManagement) return
        e.preventDefault()
        e.stopPropagation()
        setContextMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full active:scale-95"
      >
        <span className="truncate max-w-[160px]">{label}</span>
        {typeof count === "number" && (
          <span
            className={cn(
              "rounded-full px-1.5 py-0 text-[10px] font-semibold leading-4",
              active ? "bg-black/15 text-black/70" : "bg-white/[.06] text-muted-foreground"
            )}
          >
            {count}
          </span>
        )}
      </button>

      {hasManagement && (
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              aria-label="Manage"
              className={cn(
                "mr-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full opacity-0 group-hover/pill:opacity-100 transition-opacity",
                active ? "text-black/70 hover:bg-black/10" : "text-muted-foreground hover:bg-white/[.08]"
              )}
            >
              <MoreHorizontal className="h-3 w-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={6} className="w-44 p-1">
            {onRename && (
              <button
                type="button"
                onClick={() => {
                  setRenameDraft(rawLabel ?? label)
                  setRenaming(true)
                  setMenuOpen(false)
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-foreground/90 transition-colors hover:bg-white/[.08]"
              >
                <Pencil className="h-3.5 w-3.5" />
                Rename
              </button>
            )}
            {onRemoveFromSelected && (
              <button
                type="button"
                onClick={() => {
                  onRemoveFromSelected()
                  setMenuOpen(false)
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-foreground/90 transition-colors hover:bg-white/[.08]"
              >
                <X className="h-3.5 w-3.5" />
                Remove from selection
              </button>
            )}
            {onDelete && (
              <>
                {(onRename || onRemoveFromSelected) && <div className="my-1 h-px bg-white/[.07]" />}
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    onDelete()
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-red-400 transition-colors hover:bg-red-500/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete collection
                </button>
              </>
            )}
          </PopoverContent>
        </Popover>
      )}
      <CollectionActionContextMenu
        open={contextMenu != null}
        position={contextMenu}
        onClose={() => setContextMenu(null)}
        title={rawLabel ?? label}
        sections={buildContextSections()}
      />
    </span>
  )
}

export function CollectionPill(props: PillProps) {
  return <Pill {...props} />
}

export function NewCollectionInline({
  onCreate,
  placeholder = "New collection",
  disabled,
}: {
  onCreate: (name: string) => void
  placeholder?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState("")
  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setDraft("") }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className="h-8 rounded-full text-xs"
        >
          + New
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{placeholder}</p>
          <div className="flex gap-2">
            <Input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft.trim()) {
                  onCreate(draft.trim())
                  setDraft("")
                  setOpen(false)
                }
              }}
              placeholder="Name"
              className="h-8 text-xs flex-1"
            />
            <Button
              size="sm"
              className="h-8"
              onClick={() => {
                if (!draft.trim()) return
                onCreate(draft.trim())
                setDraft("")
                setOpen(false)
              }}
              disabled={!draft.trim()}
            >
              Add
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
