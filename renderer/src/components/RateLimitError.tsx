"use client"

import { useState } from "react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Badge } from "@/components/ui/badge"
import { Home, RefreshCw, ChevronDown, Check, Copy, ExternalLink, HelpCircle, Clock } from "lucide-react"

interface RateLimitErrorProps {
  message?: string
  errorCode?: string
  retry?: () => void
}

export function RateLimitError({
  message = "Ye be firin' the cannons too fast, matey! Give the crew a moment to reload before ye try again.",
  errorCode,
  retry,
}: RateLimitErrorProps) {
  const [copied, setCopied] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const copyErrorCode = () => {
    if (!errorCode) return
    navigator.clipboard.writeText(errorCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <section className="relative py-16 sm:py-20 md:py-24 px-4 text-center">
        <div className="container mx-auto max-w-4xl">
          <div className="flex justify-center mb-8">
            <img
              src="/429.png"
              alt="429 Too Many Requests"
              className="w-48 h-48 sm:w-64 sm:h-64 md:w-80 md:h-80 object-contain"
              draggable={false}
            />
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-7xl font-black mb-4 sm:mb-6 text-foreground font-montserrat tracking-tight">
            429 - Avast, Slow Down!
          </h1>
          <p className="text-base sm:text-xl text-muted-foreground mb-8 sm:mb-10 max-w-2xl mx-auto leading-relaxed text-pretty">
            {message}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            {retry && (
              <Button
                size="lg"
                className="font-semibold text-base sm:text-lg px-6 sm:px-8 py-5 sm:py-6 rounded-xl shadow-lg shadow-primary/25"
                onClick={retry}
              >
                <RefreshCw className="mr-2 h-5 w-5" />
                Try Again, Captain
              </Button>
            )}
            <Button
              size="lg"
              variant="outline"
              className="font-semibold text-base sm:text-lg px-6 sm:px-8 py-5 sm:py-6 rounded-xl border-2 bg-transparent"
              asChild
            >
              <Link to="/">
                <Home className="mr-2 h-5 w-5" />
                Sail Back Home
              </Link>
            </Button>
          </div>

          {errorCode && (
            <div className="mt-8 flex justify-center">
              <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
                    Details
                    <ChevronDown className={`h-4 w-4 transition-transform ${detailsOpen ? "rotate-180" : ""}`} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-3 rounded-xl border bg-background/50 p-3 space-y-3">
                    <div className="flex flex-wrap items-center justify-center gap-2">
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
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}
        </div>
      </section>

      <section className="py-12 sm:py-16 px-4">
        <div className="container mx-auto max-w-6xl">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-black text-foreground font-montserrat mb-8 sm:mb-10 text-center">
            While ye wait, matey...
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="overflow-hidden border-2 border-border/50 shadow-lg hover:shadow-xl hover:border-primary/30 hover:-translate-y-1 transition-all duration-300 rounded-2xl">
              <CardContent className="p-6 sm:p-8 text-center">
                <div className="flex justify-center mb-4">
                  <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
                    <Clock className="h-8 w-8 text-primary" />
                  </div>
                </div>
                <h3 className="text-lg sm:text-xl font-black text-foreground mb-3 font-montserrat">Wait a Moment</h3>
                <p className="text-muted-foreground mb-6 leading-relaxed">
                  Our cannons need time to cool down. Give it a few seconds then give 'er another go.
                </p>
                {retry && (
                  <Button variant="outline" className="w-full rounded-xl bg-transparent" onClick={retry}>
                    Retry Now
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card className="overflow-hidden border-2 border-border/50 shadow-lg hover:shadow-xl hover:border-primary/30 hover:-translate-y-1 transition-all duration-300 rounded-2xl">
              <CardContent className="p-6 sm:p-8 text-center">
                <div className="flex justify-center mb-4">
                  <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
                    <ExternalLink className="h-8 w-8 text-primary" />
                  </div>
                </div>
                <h3 className="text-lg sm:text-xl font-black text-foreground mb-3 font-montserrat">Check Our Status</h3>
                <p className="text-muted-foreground mb-6 leading-relaxed">
                  Peek at the ship's log to see if the whole fleet be under heavy fire.
                </p>
                <Button variant="outline" className="w-full rounded-xl bg-transparent" asChild>
                  <a href="https://status.union-crax.xyz/" target="_blank" rel="noreferrer">
                    View Status
                  </a>
                </Button>
              </CardContent>
            </Card>

            <Card className="overflow-hidden border-2 border-border/50 shadow-lg hover:shadow-xl hover:border-primary/30 hover:-translate-y-1 transition-all duration-300 rounded-2xl">
              <CardContent className="p-6 sm:p-8 text-center">
                <div className="flex justify-center mb-4">
                  <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
                    <HelpCircle className="h-8 w-8 text-primary" />
                  </div>
                </div>
                <h3 className="text-lg sm:text-xl font-black text-foreground mb-3 font-montserrat">Need a Hand?</h3>
                <p className="text-muted-foreground mb-6 leading-relaxed">
                  If this keeps happenin', hail the crew on Discord and we'll sort ye out.
                </p>
                <Button variant="outline" className="w-full rounded-xl bg-transparent" asChild>
                  <a href="https://union-crax.xyz/discord" target="_blank" rel="noreferrer">
                    Join Discord
                  </a>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    </>
  )
}
