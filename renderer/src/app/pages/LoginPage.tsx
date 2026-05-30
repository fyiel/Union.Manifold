"use client"

import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, AlertCircle } from "lucide-react"
import { Loader2, LogIn } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useAuth } from "@/hooks/useAuth"

export function LoginPage() {
  const navigate = useNavigate()
  const [{ isAuthenticated, isLoading }, { signInWithWebsite }] = useAuth()
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Once we're authenticated, leave this page automatically.
  useEffect(() => {
    if (isAuthenticated) {
      navigate("/account", { replace: true })
    }
  }, [isAuthenticated, navigate])

  const handleSignIn = async () => {
    if (signingIn) return
    setError(null)
    setSigningIn(true)
    try {
      const result = await signInWithWebsite()
      if (!result.ok) {
        // Don't show a banner for the user simply closing the window — that's a
        // normal cancel path, not an error.
        if (result.error && result.error !== "cancelled") {
          setError(result.error)
        }
      }
    } finally {
      setSigningIn(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        <Button
          variant="ghost"
          onClick={() => navigate(-1)}
          className="gap-2 text-muted-foreground hover:text-white hover:bg-white/[.05]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        <Card className="border border-white/[.07] bg-card/40 backdrop-blur-xl">
          <CardContent className="p-6 space-y-6">
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-semibold text-foreground">
                Sign in to UnionCrax.Direct
              </h1>
              <p className="text-sm text-muted-foreground/80">
                Sign in with your UnionCrax account. A secure window will open
                so you can complete the login.
              </p>
            </div>

            {error ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200"
              >
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            <Button
              type="button"
              onClick={handleSignIn}
              disabled={signingIn || isLoading}
              className="w-full gap-2 bg-primary text-primary-foreground hover:brightness-110"
            >
              {signingIn ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Waiting for sign in…
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4" />
                  Sign in with UnionCrax
                </>
              )}
            </Button>

            <p className="text-xs text-muted-foreground/80 text-center">
              Your session stays on this device. Closing the sign-in window cancels the flow.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
