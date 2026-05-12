"use client"

import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, ExternalLink, LogIn } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export function LoginPage() {
  const navigate = useNavigate()
  const [redirecting, setRedirecting] = useState(false)

  const continueUrl = "https://union-crax.xyz/direct/continue?source=ucd"

  const handleWebsiteLogin = () => {
    setRedirecting(true)
    if (typeof window !== "undefined") {
      window.location.href = continueUrl
    }
  }

  return (
    <div className="min-h-screen bg-[#09090b] flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        {/* Back button */}
        <Button
          variant="ghost"
          onClick={() => navigate(-1)}
          className="gap-2 text-zinc-400 hover:text-white hover:bg-white/[.05]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        <Card className="border border-white/[.07] bg-zinc-900/40 backdrop-blur-xl">
          <CardContent className="p-6 space-y-6">
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-semibold text-zinc-100">
                Sign in to UnionCrax.Direct
              </h1>
              <p className="text-sm text-zinc-500">
                Continue on union-crax.xyz, then come back to UC.D.
              </p>
            </div>

            <Button
              type="button"
              onClick={handleWebsiteLogin}
              disabled={redirecting}
              className="w-full gap-2 bg-white text-black hover:bg-zinc-200"
            >
              <LogIn className="h-4 w-4" />
              {redirecting ? "Redirecting..." : "Sign In on union-crax.xyz"}
              <ExternalLink className="h-4 w-4" />
            </Button>

            <p className="text-xs text-zinc-500 text-center">
              This opens the official website login flow with UC.D continuation.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
