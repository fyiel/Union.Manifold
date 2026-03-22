import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"

export type LaunchPreflightCheck = {
  level: "error" | "warning" | "info"
  code: string
  message: string
}

export type LaunchPreflightResult = {
  ok: boolean
  canLaunch: boolean
  checks: LaunchPreflightCheck[]
  resolved?: {
    command: string
    args: string[]
    cwd: string
  } | null
}

type GameLaunchPreflightModalProps = {
  open: boolean
  gameName: string
  result: LaunchPreflightResult | null
  onClose: () => void
  onContinue?: () => void
  onChooseAnother?: () => void
}

function getCheckStyle(level: LaunchPreflightCheck["level"]) {
  if (level === "error") {
    return {
      icon: ShieldAlert,
      className: "border-red-500/30 bg-red-500/10 text-red-100",
      iconClassName: "text-red-300",
      label: "Blocking issue",
    }
  }

  if (level === "warning") {
    return {
      icon: AlertTriangle,
      className: "border-amber-500/30 bg-amber-500/10 text-amber-100",
      iconClassName: "text-amber-300",
      label: "Warning",
    }
  }

  return {
    icon: CheckCircle2,
    className: "border-blue-500/30 bg-blue-500/10 text-blue-100",
    iconClassName: "text-blue-300",
    label: "Info",
  }
}

export function GameLaunchPreflightModal({
  open,
  gameName,
  result,
  onClose,
  onContinue,
  onChooseAnother,
}: GameLaunchPreflightModalProps) {
  if (!open || !result) return null

  const canContinue = result.canLaunch && typeof onContinue === "function"
  const checks = result.checks || []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-background/50 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
      />

      <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-border/60 bg-card/95 p-5 text-foreground shadow-2xl animate-in slide-in-from-top-4 duration-300 ease-out">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-amber-500/15 p-2 text-amber-300">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold">Launch preflight for {gameName}</div>
            <p className="mt-1 text-sm text-muted-foreground">
              UC.Direct checked the selected executable before launch and found {checks.length === 1 ? "1 issue" : `${checks.length} issues`}.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {checks.map((check) => {
            const style = getCheckStyle(check.level)
            const Icon = style.icon
            return (
              <div
                key={`${check.code}-${check.message}`}
                className={`rounded-xl border px-4 py-3 ${style.className}`}
              >
                <div className="flex items-start gap-3">
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.iconClassName}`} />
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] opacity-80">{style.label}</div>
                    <p className="mt-1 text-sm leading-6">{check.message}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {result.resolved && (
          <div className="mt-4 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-xs text-zinc-300">
            <div className="font-semibold text-zinc-100">Resolved launch command</div>
            <div className="mt-2 font-mono break-all">{result.resolved.command}</div>
            {result.resolved.args.length > 0 && (
              <div className="mt-1 font-mono break-all">Args: {result.resolved.args.join(" ")}</div>
            )}
            <div className="mt-1 font-mono break-all">Working dir: {result.resolved.cwd}</div>
          </div>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {onChooseAnother && (
            <Button variant="outline" size="sm" onClick={onChooseAnother}>
              Pick another executable
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          {canContinue && (
            <Button size="sm" onClick={onContinue}>
              Continue anyway
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}