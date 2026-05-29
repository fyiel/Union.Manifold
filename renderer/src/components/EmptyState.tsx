import type { ComponentType, ReactNode } from "react"
import { cn } from "@/lib/utils"

type EmptyStateProps = {
  /** Lucide-style icon component (animated wrappers from @/components/icons
   *  work too — both accept a `className` prop). */
  icon?: ComponentType<{ className?: string }>
  title: string
  description?: ReactNode
  action?: ReactNode
  /** Optional secondary content rendered below the description (links,
   *  helper text, etc.) without competing with `action`. */
  hint?: ReactNode
  /** Compact variant fits in a sidebar / between sections. */
  size?: "default" | "compact"
  className?: string
}

/**
 * Consistent empty-state panel for grid/list views. Replaces the
 * one-off "no results" copy scattered across the launcher so every page
 * uses the same illustration, spacing, and CTA placement.
 *
 * Stays intentionally low-key — no oversized illustrations or marketing
 * copy. The goal is to tell the user *what they're looking at* and
 * *what to do next*, nothing more.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  hint,
  size = "default",
  className,
}: EmptyStateProps) {
  const compact = size === "compact"
  return (
    <div
      className={cn(
        "rounded-3xl border border-dashed border-white/[.07] bg-white/[.02] text-center mx-auto",
        compact ? "px-6 py-7 max-w-md space-y-2.5" : "px-8 py-12 max-w-xl space-y-3",
        className
      )}
    >
      {Icon && (
        <div
          className={cn(
            "mx-auto rounded-full bg-white/[.04] border border-white/[.07] flex items-center justify-center",
            compact ? "h-10 w-10" : "h-14 w-14"
          )}
        >
          <Icon className={cn(compact ? "h-4 w-4 text-muted-foreground/80" : "h-6 w-6 text-muted-foreground/80")} />
        </div>
      )}
      <h3 className={cn("font-semibold text-white", compact ? "text-sm" : "text-base")}>{title}</h3>
      {description && (
        <p className={cn("text-muted-foreground leading-relaxed", compact ? "text-xs" : "text-sm")}>
          {description}
        </p>
      )}
      {action && <div className="pt-1">{action}</div>}
      {hint && <div className="pt-1 text-[11px] text-muted-foreground/80">{hint}</div>}
    </div>
  )
}
