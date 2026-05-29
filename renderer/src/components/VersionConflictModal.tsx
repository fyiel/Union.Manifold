import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  ArrowRight,
  Calendar,
  Tag,
} from "lucide-react"
import { AlertTriangle } from "@/components/icons"
import { timeAgoLong } from "@/lib/utils"

type Props = {
  open: boolean
  onProceed: () => void
  onClose: () => void
  /** Currently-installed version label (first one if multiple). Falls back
   *  to a generic "Installed" string when unknown. */
  currentVersion?: string | null
  /** Version about to be installed (from the catalog). */
  newVersion?: string | null
  /** Catalog update_time so we can show "released X ago". */
  releasedAt?: string | null
  /** Optional changelog / patch notes. Rendered as plain text — short. */
  notes?: string | null
  /** Game name for the headline. */
  gameName?: string | null
}

/**
 * Modal shown the moment the user actually opts to update a game.
 *
 * The data shown here is what the user used to discover by hovering the now-
 * removed yellow "Update available - X.Y" button: it folds the version diff,
 * release date, and the "back up your saves" reminder into the single update
 * flow so there's no second yellow CTA below the main button.
 */
export function UpdateBackupWarningModal({
  open,
  onProceed,
  onClose,
  currentVersion,
  newVersion,
  releasedAt,
  notes,
  gameName,
}: Props) {
  const releaseLabel = releasedAt ? timeAgoLong(releasedAt) : null
  const showVersionRow = Boolean(currentVersion || newVersion)

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            Update {gameName ? `"${gameName}"` : "this game"}?
          </DialogTitle>
        </DialogHeader>

        {showVersionRow && (
          <div className="space-y-2 rounded-xl border border-white/[.07] bg-card/50 px-3 py-2.5 text-sm">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground/80">
              <Tag className="h-3 w-3" />
              <span>Version</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-md bg-secondary/80 px-2 py-0.5 text-xs font-mono text-foreground/80">
                {currentVersion || "Installed"}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/80" />
              <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-mono text-emerald-200">
                {newVersion || "Latest"}
              </span>
              {releaseLabel && (
                <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground/80">
                  <Calendar className="h-3 w-3" />
                  Released {releaseLabel}
                </span>
              )}
            </div>
            {notes && (
              <p className="pt-1.5 text-xs text-muted-foreground leading-relaxed border-t border-white/[.06] mt-2">
                {notes}
              </p>
            )}
          </div>
        )}

        <p className="text-sm text-muted-foreground leading-relaxed">
          Please backup your game data before updating &mdash; some games store saves
          inside the game folder. For help, join our Discord server.
        </p>

        <div className="flex flex-col gap-2">
          <Button
            className="w-full justify-center rounded-xl"
            onClick={onProceed}
          >
            Got it, Proceed with Update
          </Button>

          <Button
            variant="ghost"
            className="w-full rounded-xl"
            onClick={onClose}
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
