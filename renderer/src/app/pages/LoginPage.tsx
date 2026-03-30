"use client"

import { useCallback, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Mail, Lock, User, Eye, EyeOff, Loader2, AlertCircle, LogIn, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useToast } from "@/context/toast-context"
import { getApiBaseUrl } from "@/lib/api"
import type { LoginRequest, RegisterRequest, LoginResponse, RegisterResponse } from "@/lib/auth-types"

type AuthMode = "login" | "register"

export function LoginPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<AuthMode>("login")
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [error, setError] = useState("")
  const { toast } = useToast()

  // Form state
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [username, setUsername] = useState("")

  const canUseOAuth = typeof window !== "undefined" && Boolean(window.ucAuth)

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email) && email.length <= 255
  }

  const validatePassword = (password: string): boolean => {
    return password.length >= 8 && password.length <= 128
  }

  const validateUsername = (username: string): boolean => {
    const usernameRegex = /^[a-zA-Z0-9_-]{2,32}$/
    return usernameRegex.test(username)
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

  const handleEmailLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!validateEmail(email)) {
      setError("Invalid email address")
      return
    }

    if (!validatePassword(password)) {
      setError("Password must be 8-128 characters")
      return
    }

    setLoading(true)
    try {
      if (!window.ucAuth?.emailLogin) {
        throw new Error("Auth handler not available")
      }

      const response = await window.ucAuth.emailLogin(getApiBaseUrl(), email, password)
      if (!response.ok) {
        setError(response.error || "Login failed")
        return
      }

      toast("Login successful!", "success")
      navigate("/", { replace: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error"
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [email, password, navigate, toast])

  const handleRegister = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!validateEmail(email)) {
      setError("Invalid email address")
      return
    }

    if (!validateUsername(username)) {
      setError("Username must be 2-32 characters (alphanumeric, -, _)")
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
      if (!window.ucAuth?.register) {
        throw new Error("Auth handler not available")
      }

      const response = await window.ucAuth.register(getApiBaseUrl(), email, username, password)
      if (!response.ok) {
        setError(response.error || "Registration failed")
        return
      }

      toast("Account created! Check your email to verify.", "success")
      navigate("/verify-email", { replace: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error"
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [email, username, password, confirmPassword, navigate, toast])

  const handleDiscordOAuth = useCallback(async () => {
    setError("")
    setLoading(true)
    try {
      if (!window.ucAuth?.login) {
        throw new Error("Auth handler not available")
      }

      const response = await window.ucAuth.login(getApiBaseUrl())
      if (!response.ok) {
        setError(response.error || "Discord login failed")
        return
      }

      toast("Logged in with Discord!", "success")
      navigate("/", { replace: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error"
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [navigate, toast])

  const handleGoogleOAuth = useCallback(async () => {
    setError("")
    setLoading(true)
    try {
      if (!window.ucAuth?.login) {
        throw new Error("Auth handler not available")
      }

      const response = await window.ucAuth.login(getApiBaseUrl(), "google")
      if (!response.ok) {
        setError(response.error || "Google login failed")
        return
      }

      toast("Logged in with Google!", "success")
      navigate("/", { replace: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error"
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [navigate, toast])

  const handleForgotPassword = useCallback(() => {
    navigate("/forgot-password")
  }, [navigate])

  const passwordStrength = calculatePasswordStrength(password)
  const isPasswordValid = validatePassword(password)
  const isPasswordsMatch = password === confirmPassword && password.length > 0

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
            {/* Header */}
            <div className="text-center space-y-1">
              <h1 className="text-xl font-semibold text-zinc-100">
                {mode === "login" ? "Sign in" : "Create account"}
              </h1>
              <p className="text-sm text-zinc-500">
                {mode === "login" ? "Welcome back" : "Get started with UnionCrax"}
              </p>
            </div>

            {/* Mode Tabs */}
            <div className="flex gap-1 rounded-lg bg-zinc-800/60 p-1">
              <button
                onClick={() => { setMode("login"); setError(""); setConfirmPassword(""); setUsername("") }}
                className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
                  mode === "login"
                    ? "bg-white/[.08] text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                Login
              </button>
              <button
                onClick={() => { setMode("register"); setError("") }}
                className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
                  mode === "register"
                    ? "bg-white/[.08] text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                Register
              </button>
            </div>

            {/* Error */}
            {error && (
              <div className="flex gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
                <p className="text-sm text-red-300">{error}</p>
              </div>
            )}

            {/* Login Form */}
            {mode === "login" ? (
              <form onSubmit={handleEmailLogin} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-zinc-300">Email</label>
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
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-zinc-300">Password</label>
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
                </div>

                <Button
                  type="submit"
                  disabled={loading || !email || !password}
                  className="w-full gap-2"
                >
                  {loading ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Signing in...</>
                  ) : (
                    <><LogIn className="h-4 w-4" /> Sign In</>
                  )}
                </Button>

                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={loading}
                  className="w-full text-sm text-zinc-500 hover:text-zinc-300 disabled:text-zinc-700"
                >
                  Forgot password?
                </button>
              </form>
            ) : (
              /* Register Form */
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-zinc-300">Email</label>
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
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-zinc-300">Username</label>
                  <div className="relative">
                    <User className="absolute left-3 top-3 h-4 w-4 text-zinc-500" />
                    <Input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value.toLowerCase())}
                      placeholder="username"
                      className="pl-10 border-white/[.07] bg-zinc-800/50 text-white placeholder:text-zinc-600"
                      disabled={loading}
                      maxLength={32}
                    />
                  </div>
                  {username && !validateUsername(username) && (
                    <p className="text-xs text-orange-400">2-32 characters, alphanumeric, -, _</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-zinc-300">Password</label>
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
                  disabled={loading || !email || !username || !password || !isPasswordValid || !isPasswordsMatch}
                  className="w-full gap-2"
                >
                  {loading ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Creating account...</>
                  ) : (
                    "Create Account"
                  )}
                </Button>
              </form>
            )}

            {/* OAuth Divider */}
            {canUseOAuth && (
              <>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-white/[.07]" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="bg-zinc-900/40 px-3 text-zinc-500">or continue with</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleDiscordOAuth}
                    disabled={loading}
                    className="w-full gap-2 border-white/[.07] bg-zinc-800/50 text-zinc-300 hover:bg-white/[.08] hover:text-white"
                  >
                    {loading ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Connecting...</>
                    ) : (
                      <><LogIn className="h-4 w-4" /> Continue with Discord</>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleGoogleOAuth}
                    disabled={loading}
                    className="w-full gap-2 border-white/[.07] bg-zinc-800/50 text-zinc-300 hover:bg-white/[.08] hover:text-white"
                  >
                    {loading ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Connecting...</>
                    ) : (
                      <><LogIn className="h-4 w-4" /> Continue with Google</>
                    )}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
