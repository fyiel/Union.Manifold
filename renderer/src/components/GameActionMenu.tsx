import { createPortal } from "react-dom"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import {
  ExternalLink,
  FolderOpen,
  Pencil,
  Settings,
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

type GameActionMenuPanelProps = {
  gameName: string
  gameSource?: string
  isExternal?: boolean
  isLinux?: boolean
  shortcutFeedback?: ShortcutFeedback
  onSetExecutable: () => void | Promise<void>
  onOpenFiles: () => void | Promise<void>
  onCreateShortcut: () => void | Promise<void>
  onEditDetails?: () => void | Promise<void>
  onLinuxConfig?: () => void | Promise<void>
  onDelete: () => void | Promise<void>
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
  onClick: () => void | Promise<void>
}

function MenuItem({ icon: Icon, label, destructive = false, onClick }: MenuItemProps) {
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
      {label}
    </button>
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
  className,
}: GameActionMenuPanelProps) {
  return (
    <div
      className={cn(
        "w-52 rounded-xl border border-white/[.07] bg-zinc-950/95 p-1 text-white shadow-xl backdrop-blur-xl",
        className
      )}
    >
      <div className="space-y-px">
        <MenuItem icon={Settings} label="Set Executable" onClick={onSetExecutable} />
        <MenuItem icon={FolderOpen} label="Open Files" onClick={onOpenFiles} />
        <MenuItem icon={ExternalLink} label="Create Shortcut" onClick={onCreateShortcut} />
        {onEditDetails ? <MenuItem icon={Pencil} label="Edit Details" onClick={onEditDetails} /> : null}
        {isLinux && onLinuxConfig ? <MenuItem icon={Terminal} label="Linux / VR Config" onClick={onLinuxConfig} /> : null}
      </div>

      <div className="my-1 h-px bg-white/[.06]" />

      <MenuItem
        icon={isExternal ? Unlink2 : Trash2}
        label={isExternal ? "Unlink Game" : "Delete Game"}
        destructive
        onClick={onDelete}
      />

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