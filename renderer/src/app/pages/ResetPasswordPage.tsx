"use client"

import { useCallback, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Lock, Loader2, AlertCircle, CheckCircle, Eye, EyeOff, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useToast } from "@/context/toast-context"
import { getApiBaseUrl } from "@/lib/api"
import { isMirrorAuthBlocked } from "@/lib/auth-origin"
import { AuthMirrorBlockedCard } from "@/components/AuthMirrorBlockedCard"

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [completed, setCompleted] = useState(false)
  const { toast } = useToast()
  const mirrorAuthBlocked = isMirrorAuthBlocked(getApiBaseUrl())

  const token = searchParams.get("token") || ""

  const validatePassword = (password: string): boolean => {
    return password.length >= 8 && password.length <= 128
  }

  const calculatePasswordStrength = (pwd: string): number => {
    let strength = 0
    if (pwd.length >= 8) strength += 1
    if (pwd.length >= 12) strength += 1
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) strength += 1
    if (/\d/.test(pwd)) strength += 1
    if (/[^a-zA-Z0-9]/.test(pwd)) strength += 1
    return strength
  }

  const getPasswordStrengthColor = (strength: number): string => {
    if (strength <= 1) return "bg-red-500"
    if (strength <= 2) return "bg-orange-500"
    if (strength <= 3) return "bg-yellow-500"
    return "bg-green-500"
  }

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!token) {
      setError("No reset token provided")
      return
    }

    if (!validatePassword(password)) {
      setError("Password must be 8-128 characters")
      return
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match")
      return
    }

    setLoading(true)
    try {
      if (!window.ucAuth?.resetPassword) {
        throw new Error("Auth handler not available")
      }

      const response = await window.ucAuth.resetPassword(getApiBaseUrl(), token, password)
      if (!response.ok) {
        setError(response.error || "Reset failed")
        return
      }

      setCompleted(true)
      toast("Password reset successfully!", "success")
      setTimeout(() => {
        navigate("/login", { replace: true })
      }, 2000)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error"
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [token, password, confirmPassword, navigate, toast])

  if (mirrorAuthBlocked) {
    return (
      <AuthMirrorBlockedCard
        title="Password reset is unavailable on this mirror"
        description="Complete password resets on union-crax.xyz so the full account flow stays on the primary domain."
        backLabel="Back to Login"
        onBack={() => navigate("/login")}
      />
    )
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center p-4">
        <Card className="w-full max-w-md border border-white/[.07] bg-zinc-900/40 backdrop-blur-xl">
          <CardContent className="p-6 space-y-4 text-center">
            <h2 className="text-xl font-semibold text-zinc-100">Invalid Link</h2>
            <p className="text-sm text-zinc-400">This password reset link is invalid or has expired.</p>
            <Button onClick={() => navigate("/forgot-password", { replace: true })} className="w-full gap-2">
              Request New Link
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (completed) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center p-4">
        <Card className="w-full max-w-md border border-white/[.07] bg-zinc-900/40 backdrop-blur-xl">
          <CardContent className="p-6 space-y-4 text-center">
            <div className="inline-flex items-center justify-center rounded-full bg-green-500/10 p-3">
              <CheckCircle className="h-8 w-8 text-green-400" />
            </div>
            <h2 className="text-xl font-semibold text-zinc-100">Password Reset</h2>
            <p className="text-sm text-zinc-400">Your password has been reset. Redirecting to login...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const passwordStrength = calculatePasswordStrength(password)
  const isPasswordValid = validatePassword(password)
  const isPasswordsMatch = password === confirmPassword && password.length > 0

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
              <h1 className="text-xl font-semibold text-zinc-100">Reset Your Password</h1>
              <p className="text-sm text-zinc-500">Enter a new password for your account</p>
            </div>

            {error && (
              <div className="flex gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
                <p className="text-sm text-red-300">{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-zinc-300">New Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-zinc-500" />
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="pl-10 pr-10 border-white/[.07] bg-zinc-800/50 text-white placeholder:text-zinc-600"
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-3 text-zinc-500 hover:text-zinc-300"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {password && (
                  <div className="space-y-1">
                    <div className="flex gap-1 h-1">
                      {[...Array(5)].map((_, i) => (
                        <div
                          key={i}
                          className={`flex-1 rounded-full transition-colors ${
                            i < passwordStrength
                              ? getPasswordStrengthColor(passwordStrength)
                              : "bg-zinc-700"
                          }`}
                        />
                      ))}
                    </div>
                    <p className="text-xs text-zinc-500">
                      {passwordStrength === 0 && "Very weak"}
                      {passwordStrength === 1 && "Weak"}
                      {passwordStrength === 2 && "Fair"}
                      {passwordStrength === 3 && "Good"}
                      {passwordStrength === 4 && "Strong"}
                      {passwordStrength === 5 && "Very strong"}
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-zinc-300">Confirm Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-zinc-500" />
                  <Input
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="pl-10 pr-10 border-white/[.07] bg-zinc-800/50 text-white placeholder:text-zinc-600"
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-3 text-zinc-500 hover:text-zinc-300"
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {confirmPassword && !isPasswordsMatch && (
                  <p className="text-xs text-red-400">Passwords do not match</p>
                )}
              </div>

              <Button
                type="submit"
                disabled={loading || !password || !isPasswordValid || !isPasswordsMatch}
                className="w-full gap-2"
              >
                {loading ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Resetting...</>
                ) : (
                  "Reset Password"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
