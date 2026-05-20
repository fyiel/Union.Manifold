import { createPortal } from "react-dom"
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import {
  Bell,
  BellOff,
  Download,
  ExternalLink,
  GitFork,
  Layers3,
  Pencil,
  RefreshCw,
  Share2,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

export type CollectionMenuPoint = { x: number; y: number }

export type CollectionMenuAction = {
  id: string
  icon: LucideIcon
  label: string
  destructive?: boolean
  disabled?: boolean
  onSelect: () => void | Promise<void>
}

export type CollectionMenuSection = {
  id: string
  /** Optional small header label (e.g. "Sharing"). */
  label?: string
  items: CollectionMenuAction[]
}

type CollectionActionMenuPanelProps = {
  title?: string
  subtitle?: ReactNode
  sections: CollectionMenuSection[]
  /** Auto-close after a selection. Defaults to true. */
  onAfterSelect?: () => void
  className?: string
}

const ACTION_ICONS = {
  open: ExternalLink,
  rename: Pencil,
  edit: Layers3,
  share: Share2,
  contributors: Users,
  follow: Bell,
  unfollow: BellOff,
  fork: GitFork,
  install: Download,
  update: RefreshCw,
  delete: Trash2,
} as const satisfies Record<string, LucideIcon>
export const COLLECTION_MENU_ICONS = ACTION_ICONS

export function CollectionActionMenuPanel({
  title,
  subtitle,
  sections,
  onAfterSelect,
  className,
}: CollectionActionMenuPanelProps) {
  const visibleSections = sections
    .map((s) => ({ ...s, items: s.items.filter(Boolean) }))
    .filter((s) => s.items.length > 0)

  return (
    <div
      className={cn(
        "w-64 rounded-2xl border border-white/[.08] bg-zinc-950/95 backdrop-blur-xl p-1.5 shadow-[0_20px_60px_rgba(0,0,0,0.55)]",
        className
      )}
      role="menu"
    >
      {(title || subtitle) && (
        <div className="px-2 pt-1 pb-2 border-b border-white/[.05] mb-1">
          {title && <div className="text-sm font-semibold text-white truncate">{title}</div>}
          {subtitle && <div className="text-[11px] text-zinc-500 truncate">{subtitle}</div>}
        </div>
      )}
      {visibleSections.map((section, sIdx) => (
        <div key={section.id} className={cn(sIdx > 0 && "mt-1 pt-1 border-t border-white/[.05]")}>
          {section.label && (
            <div className="px-2 pt-1 pb-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-600">
              {section.label}
            </div>
          )}
          <div className="space-y-px">
            {section.items.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    if (item.disabled) return
                    void Promise.resolve(item.onSelect()).finally(() => onAfterSelect?.())
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-left transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed",
                    item.destructive
                      ? "text-red-400 hover:bg-red-500/10 hover:text-red-300"
                      : "text-zinc-300 hover:bg-white/[.06] hover:text-white"
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                  <span className="flex-1 truncate">{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

type CollectionActionContextMenuProps = CollectionActionMenuPanelProps & {
  open: boolean
  position: CollectionMenuPoint | null
  onClose: () => void
}

export function CollectionActionContextMenu({
  open,
  position,
  onClose,
  className,
  ...panelProps
}: CollectionActionContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [resolvedPosition, setResolvedPosition] = useState<CollectionMenuPoint | null>(position)

  useLayoutEffect(() => {
    if (!open || !position) return
    const padding = 12
    const rect = menuRef.current?.getBoundingClientRect()
    const width = rect?.width || 256
    const height = rect?.height || 320
    setResolvedPosition({
      x: Math.min(Math.max(padding, position.x), window.innerWidth - width - padding),
      y: Math.min(Math.max(padding, position.y), window.innerHeight - height - padding),
    })
  }, [open, position])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose() } }
    const onResize = () => onClose()
    window.addEventListener("keydown", onKey)
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("resize", onResize)
    }
  }, [open, onClose])

  if (!open || !position || typeof document === "undefined") return null
  const left = resolvedPosition?.x ?? position.x
  const top = resolvedPosition?.y ?? position.y

  return createPortal(
    <div
      className="fixed inset-0 z-[80]"
      onMouseDown={onClose}
      onContextMenu={(e) => { e.preventDefault(); onClose() }}
    >
      <div
        ref={menuRef}
        className="absolute"
        style={{ left, top }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
      >
        <CollectionActionMenuPanel {...panelProps} onAfterSelect={onClose} className={className} />
      </div>
    </div>,
    document.body
  )
}
