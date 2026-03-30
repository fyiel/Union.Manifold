"use client"

import { useCallback, useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { CheckCircle, AlertCircle, Loader2, Mail, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useToast } from "@/context/toast-context"
import { getApiBaseUrl } from "@/lib/api"

export function VerifyEmailPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [verified, setVerified] = useState(false)
  const [error, setError] = useState("")
  const [token, setToken] = useState(searchParams.get("token") || "")
  const { toast } = useToast()

  useEffect(() => {
    const urlToken = searchParams.get("token")
    if (urlToken && !verified) {
      handleVerify(urlToken)
    }
  }, [searchParams])

  const handleVerify = useCallback(async (verifyToken: string) => {
    if (!verifyToken) {
      setError("No verification token provided")
      return
    }

    setLoading(true)
    setError("")
    try {
      if (!window.ucAuth?.verifyEmail) {
        throw new Error("Auth handler not available")
      }

      const response = await window.ucAuth.verifyEmail(getApiBaseUrl(), verifyToken)
      if (!response.ok) {
        setError(response.error || "Verification failed")
        return
      }

      setVerified(true)
      toast("Email verified! You can now log in.", "success")
      setTimeout(() => {
        navigate("/login", { replace: true })
      }, 2000)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error"
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [navigate, toast])

  const handleSubmitToken = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    await handleVerify(token)
  }, [token, handleVerify])

  if (verified) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center p-4">
        <Card className="w-full max-w-md border border-white/[.07] bg-zinc-900/40 backdrop-blur-xl">
          <CardContent className="p-6 space-y-4 text-center">
            <div className="inline-flex items-center justify-center rounded-full bg-green-500/10 p-3">
              <CheckCircle className="h-8 w-8 text-green-400" />
            </div>
            <h2 className="text-xl font-semibold text-zinc-100">Email Verified!</h2>
            <p className="text-sm text-zinc-400">
              Your email has been verified. Redirecting to login...
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#09090b] flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        <Button
          variant="ghost"
          onClick={() => navigate("/login")}
          className="gap-2 text-zinc-400 hover:text-white hover:bg-white/[.05]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Login
        </Button>

        <Card className="border border-white/[.07] bg-zinc-900/40 backdrop-blur-xl">
          <CardContent className="p-6 space-y-6">
            <div className="text-center space-y-1">
              <h1 className="text-xl font-semibold text-zinc-100">Verify Your Email</h1>
              <p className="text-sm text-zinc-500">Enter the verification token from your email</p>
            </div>

            {error && (
              <div className="flex gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
                <p className="text-sm text-red-300">{error}</p>
              </div>
            )}

            <div className="rounded-lg border border-white/[.07] bg-zinc-800/50 p-4">
              <div className="flex gap-2 mb-2">
                <Mail className="h-5 w-5 shrink-0 text-zinc-400" />
                <p className="text-sm text-zinc-300">Check your email for a verification link or token.</p>
              </div>
              <p className="text-xs text-zinc-500 ml-7">
                You can click the link in the email or paste the token below.
              </p>
            </div>

            <form onSubmit={handleSubmitToken} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-zinc-300">Verification Token</label>
                <Input
                  type="text"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Paste your token here"
                  className="border-white/[.07] bg-zinc-800/50 text-white placeholder:text-zinc-600"
                  disabled={loading}
                />
              </div>

              <Button type="submit" disabled={loading || !token} className="w-full gap-2">
                {loading ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Verifying...</>
                ) : (
                  "Verify Email"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
