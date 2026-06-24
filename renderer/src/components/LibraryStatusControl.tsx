import { useState } from "react"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { LIBRARY_STATUS_ORDER, LIBRARY_STATUS_LABELS, type LibraryStatus } from "@/lib/account-lists"
import {
  Play,
  CalendarClock,
  CheckCircle2,
  PauseCircle,
  XCircle,
  Heart,
  ChevronDown,
  Trash2,
  Plus,
  type LucideIcon,
} from "lucide-react"

const STATUS_META: Record<LibraryStatus, { icon: LucideIcon; tone: string }> = {
  playing: { icon: Play, tone: "text-emerald-400" },
  plan: { icon: CalendarClock, tone: "text-sky-400" },
  completed: { icon: CheckCircle2, tone: "text-violet-400" },
  onhold: { icon: PauseCircle, tone: "text-amber-400" },
  dropped: { icon: XCircle, tone: "text-rose-400" },
  favorite: { icon: Heart, tone: "text-pink-400" },
}

interface Props {
  appid: string
  name?: string | null
  status: LibraryStatus | null
  /** Persist the new status (or null to remove). Owns the network call. */
  onSelect: (next: LibraryStatus | null) => void
  disabled?: boolean
  className?: string
  align?: "start" | "center" | "end"
}

/**
 * Desktop counterpart to the web LibraryStatusControl — the MAL-style status
 * dropdown that replaces the separate Like + Wishlist buttons. Backed by the
 * shared useAccountLists store via the parent's onSelect handler.
 */
export function LibraryStatusControl({
  appid: _appid,
  name: _name,
  status,
  onSelect,
  disabled,
  className,
  align = "start",
}: Props) {
  const [open, setOpen] = useState(false)
  const active = status ? STATUS_META[status] : null
  const ActiveIcon = active?.icon ?? Plus

  const choose = (next: LibraryStatus | null) => {
    setOpen(false)
    if (next !== status) onSelect(next)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={status ? "secondary" : "outline"}
          disabled={disabled}
          className={cn("gap-2", className)}
        >
          <ActiveIcon className={cn("h-4 w-4", active?.tone)} />
          <span>{status ? LIBRARY_STATUS_LABELS[status] : "Add to library"}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-52 p-1.5">
        <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Library status</p>
        {LIBRARY_STATUS_ORDER.map((s) => {
          const meta = STATUS_META[s]
          const Icon = meta.icon
          const selected = status === s
          return (
            <button
              key={s}
              type="button"
              onClick={() => choose(s)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-secondary",
                selected && "bg-secondary/60 font-medium",
              )}
            >
              <Icon className={cn("h-4 w-4", meta.tone)} />
              <span>{LIBRARY_STATUS_LABELS[s]}</span>
              {selected && <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-primary" />}
            </button>
          )
        })}
        {status && (
          <>
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              onClick={() => choose(null)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Trash2 className="h-4 w-4" />
              <span>Remove from library</span>
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
