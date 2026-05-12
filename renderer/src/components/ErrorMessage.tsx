"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AlertTriangle, Check, ChevronDown, Copy, ExternalLink } from "lucide-react"

interface ErrorMessageProps {
  title?: string
  message: string
  errorCode?: string
  retry?: () => void
  defaultDetailsOpen?: boolean
  showSupportLinks?: boolean
  layout?: "inline" | "panel"
}

export function ErrorMessage({
  title = "Something went wrong",
  message,
  errorCode,
  retry,
  defaultDetailsOpen = false,
  showSupportLinks = true,
  layout = "inline",
}: ErrorMessageProps) {
  const [copied, setCopied] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(defaultDetailsOpen)

  const copyErrorCode = () => {
    if (!errorCode) return
    navigator.clipboard.writeText(errorCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const detailsContent = (
    <div className="mt-3 w-full rounded-xl border bg-background/50 p-3 space-y-3">
      {errorCode && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono text-xs">
            Error: {errorCode}
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={copyErrorCode}
            aria-label="Copy error code"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
      )}

      {showSupportLinks && (
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className="gap-2 bg-transparent">
            <a href="https://status.union-crax.xyz/" target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              Status
            </a>
          </Button>
          <Button asChild variant="outline" size="sm" className="gap-2 bg-transparent">
            <a href="https://union-crax.xyz/discord" target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              Discord
            </a>
          </Button>
        </div>
      )}
    </div>
  )

  const detailsSection = (errorCode || showSupportLinks) ? (
    <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 px-0 sm:px-2">
          Details
          <ChevronDown className={`h-4 w-4 transition-transform ${detailsOpen ? "rotate-180" : ""}`} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>{detailsContent}</CollapsibleContent>
    </Collapsible>
  ) : null

  if (layout === "panel") {
    return (
      <Card className="rounded-2xl border-destructive/25 bg-gradient-to-br from-destructive/[0.14] via-destructive/[0.06] to-transparent">
        <CardHeader className="pb-3 sm:pb-4">
          <div className="flex items-start gap-4">
            <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-destructive/30 bg-destructive/15">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <CardTitle className="text-lg sm:text-xl">{title}</CardTitle>
              <p className="mt-2 text-sm sm:text-base text-zinc-300 leading-relaxed">{message}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-wrap gap-2">
            {retry && (
              <Button variant="default" onClick={retry}>
                Try again
              </Button>
            )}
            {detailsSection}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Alert variant="destructive" className="rounded-2xl border-destructive/25 bg-destructive/5">
      <AlertTriangle className="text-destructive" />
      <AlertTitle className="text-base sm:text-lg">{title}</AlertTitle>
      <AlertDescription className="w-full">
        <p className="text-sm">{message}</p>

        <div className="mt-3 flex flex-wrap gap-2">
          {retry && (
            <Button variant="outline" size="sm" onClick={retry} className="bg-background/60">
              Try again
            </Button>
          )}

          {detailsSection}
        </div>
      </AlertDescription>
    </Alert>
  )
}
