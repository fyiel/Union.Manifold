"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AlertTriangle, Copy, Check, ExternalLink } from "lucide-react"

interface ErrorMessageProps {
  title?: string
  message: string
  errorCode: string
  retry?: () => void
}

export function ErrorMessage({ title = "Something went wrong", message, errorCode, retry }: ErrorMessageProps) {
  const [copied, setCopied] = useState(false)

  const copyErrorCode = () => {
    navigator.clipboard.writeText(errorCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card className="border-2 border-primary/30 bg-card/95 backdrop-blur-sm hover:border-primary/50 transition-colors">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="bg-primary/10 rounded-lg p-1.5 flex-shrink-0">
            <AlertTriangle className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
            <p className="text-sm text-muted-foreground mb-4">{message}</p>

            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center mb-4">
              <div className="flex items-center gap-2 bg-primary/10 px-3 py-2 rounded-lg border border-primary/20">
                <span className="text-sm font-mono text-foreground">Error Code: {errorCode}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-lg hover:bg-primary/20"
                  onClick={copyErrorCode}
                >
                  {copied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3 text-primary" />}
                </Button>
              </div>

              {retry && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={retry}
                  className="border-2 border-primary/30 text-primary hover:bg-primary/10 hover:border-primary/50 bg-transparent"
                >
                  Try Again
                </Button>
              )}
            </div>

            <div className="bg-card/50 p-3 rounded-lg border-2 border-border/50 backdrop-blur-sm">
              <p className="text-sm text-muted-foreground mb-2">
                Need help? Check our status page or contact us on Discord with this error code:
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="gap-2 border-2 border-primary/30 text-primary hover:bg-primary/10 hover:border-primary/50 bg-transparent"
                >
                  <a href="https://status.union-crax.xyz/" target="_blank" rel="noreferrer">
                    <ExternalLink className="h-3 w-3" />
                    Status Page
                  </a>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="gap-2 border-2 border-primary/30 text-primary hover:bg-primary/10 hover:border-primary/50 bg-transparent"
                >
                  <a href="https://union-crax.xyz/discord" target="_blank" rel="noreferrer">
                    <ExternalLink className="h-3 w-3" />
                    Join Our Discord
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
