"use client"

import { useCallback, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Mail, Loader2, AlertCircle, CheckCircle, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useToast } from "@/context/toast-context"
import { getApiBaseUrl } from "@/lib/api"

export function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [email, setEmail] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const { toast } = useToast()

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email) && email.length <= 255
  }

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!validateEmail(email)) {
      setError("Invalid email address")
      return
    }

    setLoading(true)
    try {
      if (!window.ucAuth?.forgotPassword) {
        throw new Error("Auth handler not available")
      }

      const response = await window.ucAuth.forgotPassword(getApiBaseUrl(), email)
      if (!response.ok) {
        setError(response.error || "Request failed")
        return
      }

      setSubmitted(true)
      toast("Check your email for password reset instructions", "success")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error"
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [email, toast])

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center p-4">
        <Card className="w-full max-w-md border border-white/[.07] bg-zinc-900/40 backdrop-blur-xl">
          <CardContent className="p-6 space-y-4 text-center">
            <div className="inline-flex items-center justify-center rounded-full bg-green-500/10 p-3">
              <CheckCircle className="h-8 w-8 text-green-400" />
            </div>
            <h2 className="text-xl font-semibold text-zinc-100">Check Your Email</h2>
            <p className="text-sm text-zinc-300">
              We've sent password reset instructions to <strong>{email}</strong>
            </p>
            <p className="text-xs text-zinc-500">
              Check your email (including spam folder) for a link to reset your password.
            </p>
            <Button onClick={() => navigate("/login", { replace: true })} className="w-full gap-2">
              Back to Login
            </Button>
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
              <h1 className="text-xl font-semibold text-zinc-100">Reset Password</h1>
              <p className="text-sm text-zinc-500">
                Enter your email to receive password reset instructions
              </p>
            </div>

            {error && (
              <div className="flex gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
                <p className="text-sm text-red-300">{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-zinc-300">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-4 w-4 text-zinc-500" />
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="pl-10 border-white/[.07] bg-zinc-800/50 text-white placeholder:text-zinc-600"
                    disabled={loading}
                  />
                </div>
                <p className="text-xs text-zinc-500">
                  Enter the email address associated with your account
                </p>
              </div>

              <Button type="submit" disabled={loading || !email} className="w-full gap-2">
                {loading ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Sending...</>
                ) : (
                  "Send Reset Link"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
