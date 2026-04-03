import { ArrowLeft, ArrowUpRight, ShieldAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { MAIN_WEBSITE_LOGIN_URL, MIRROR_AUTH_BLOCK_MESSAGE } from "@/lib/auth-origin"

type AuthMirrorBlockedCardProps = {
  title: string
  description?: string
  backLabel?: string
  onBack?: () => void
}

export function AuthMirrorBlockedCard({
  title,
  description = "This app mirror can still browse and download, but account access only works on the main site.",
  backLabel = "Back",
  onBack,
}: AuthMirrorBlockedCardProps) {
  return (
    <div className="min-h-screen bg-[#09090b] flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        {onBack ? (
          <Button
            variant="ghost"
            onClick={onBack}
            className="gap-2 text-zinc-400 hover:text-white hover:bg-white/[.05]"
          >
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </Button>
        ) : null}

        <Card className="border border-white/[.07] bg-zinc-900/40 backdrop-blur-xl">
          <CardContent className="p-6 space-y-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[.07] bg-zinc-800/60">
              <ShieldAlert className="h-7 w-7 text-zinc-100" />
            </div>

            <div className="space-y-2">
              <h1 className="text-xl font-semibold text-zinc-100">{title}</h1>
              <p className="text-sm text-zinc-300">{MIRROR_AUTH_BLOCK_MESSAGE}</p>
              <p className="text-sm text-zinc-500">{description}</p>
            </div>

            <Button
              className="w-full gap-2"
              onClick={() => window.open(MAIN_WEBSITE_LOGIN_URL, "_blank")}
            >
              Open Main Website
              <ArrowUpRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}