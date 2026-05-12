"use client"

import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

interface CriticalLoadModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  message: string
  errorCode?: string
  onRetry?: () => void
  onContinue?: () => void
  continueLabel?: string
}

export function CriticalLoadModal({
  open,
  onOpenChange,
  title,
  message,
  errorCode,
  onRetry,
  onContinue,
  continueLabel = "Continue anyway",
}: CriticalLoadModalProps) {
  const handleContinue = () => {
    onContinue?.()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={true}
        className="sm:max-w-2xl"
      >
        <DialogHeader className="text-left">
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl border border-red-500/25 bg-red-500/10">
            <AlertTriangle className="h-5 w-5 text-red-400" />
          </div>
          <DialogTitle className="text-xl tracking-tight text-white">{title}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-zinc-300">
            {message}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 rounded-2xl border border-white/[.07] bg-zinc-900/60 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-zinc-100">Service interruption detected.</p>
            <p className="text-xs text-zinc-400">
              Check live incident updates on our status page, or socials for broader announcements.
            </p>
          </div>
          {errorCode && (
            <Badge variant="outline" className="w-fit font-mono text-[11px] border-white/20 text-zinc-300">
              Error: {errorCode}
            </Badge>
          )}
        </div>

        <DialogFooter className="gap-3 border-t border-white/[.07] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild variant="ghost" className="justify-start px-0 text-zinc-300 hover:text-white hover:bg-transparent">
              <a href="https://status.union-crax.xyz/" target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Status page
              </a>
            </Button>
            <Button asChild variant="ghost" className="justify-start px-0 text-zinc-300 hover:text-white hover:bg-transparent">
              <a href="https://union-crax.xyz/discord" target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Check socials
              </a>
            </Button>
          </div>

          <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:items-center">
            <Button variant="outline" onClick={handleContinue} className="border-white/20 bg-transparent text-zinc-100 hover:bg-white/10">
              {continueLabel}
            </Button>
            {onRetry && (
              <Button onClick={onRetry} className="bg-white text-black hover:bg-zinc-200">
                <RefreshCw className="mr-2 h-4 w-4" />
                Try again
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
