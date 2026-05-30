import { useCallback, useEffect, useMemo, useState } from "react"
import { Copy } from "@/components/icons"
import { Crown, RefreshCw } from "lucide-react"
import { Check, ExternalLink, Loader2 } from "@/components/icons"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { apiFetch, getApiBaseUrl } from "@/lib/api"
import { useToast } from "@/context/toast-context"
import { useAuthContext } from "@/context/auth-context"

type ClaimStatus = {
  active: boolean
  expiresAt: string | null
  status: "active" | "revoked" | "expired" | null
  source: string | null
  claim: {
    code: string
    expiresAt: string | null
    kofiUrl: string
  } | null
  claimCodeValidDays: number
}

function formatDate(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

function daysUntil(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const diff = date.getTime() - Date.now()
  if (diff <= 0) return 0
  return Math.ceil(diff / (24 * 60 * 60 * 1000))
}

function openExternal(url: string) {
  try {
    // Electron's window-open handler routes http(s) through shell.openExternal.
    window.open(url, "_blank", "noopener,noreferrer")
  } catch {
    // ignore
  }
}

export function UcPlusPanel() {
  const { user, isAuthenticated, isLoading: authLoading, signInWithWebsite } = useAuthContext()
  const { toast } = useToast()
  const [status, setStatus] = useState<ClaimStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [redeeming, setRedeeming] = useState(false)
  const [copied, setCopied] = useState(false)

  const loadStatus = useCallback(async () => {
    if (!isAuthenticated) {
      setStatus(null)
      return
    }
    setLoading(true)
    try {
      const res = await apiFetch("/api/uc-plus/claim", { cache: "no-store" })
      if (!res.ok) {
        if (res.status !== 401) {
          const data = await res.json().catch(() => ({}))
          toast(data?.error || `Could not load UC+ status (HTTP ${res.status})`, "error")
        }
        setStatus(null)
        return
      }
      const data = (await res.json()) as ClaimStatus
      setStatus(data)
    } catch (error: any) {
      toast(error?.message ?? "Network error while loading UC+ status", "error")
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated, toast])

  useEffect(() => {
    if (authLoading) return
    loadStatus()
  }, [authLoading, loadStatus])

  const startClaim = async () => {
    setCreating(true)
    try {
      const res = await apiFetch("/api/uc-plus/claim", { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast(data?.error || `Could not start UC+ claim (HTTP ${res.status})`, "error")
        return
      }
      setStatus(data as ClaimStatus)
    } catch (error: any) {
      toast(error?.message ?? "Network error", "error")
    } finally {
      setCreating(false)
    }
  }

  const redeemNow = async () => {
    setRedeeming(true)
    try {
      const res = await apiFetch("/api/uc-plus/claim/redeem", { method: "POST" })
      const data = await res.json().catch(() => ({}))

      if (res.ok && data?.ok) {
        const outcome = data.outcome as string
        if (outcome === "already-active") {
          toast("Your UC+ is already active.", "info")
        } else if (outcome === "redeemed-by-code") {
          toast("UC+ activated via your claim code.", "success")
        } else if (outcome === "redeemed-by-email") {
          toast("UC+ activated — matched your Ko-fi donation by email.", "success")
        } else {
          toast("UC+ activated.", "success")
        }
        await loadStatus()
        return
      }

      const outcome = data?.outcome as string | undefined
      const reason = data?.reason as string | undefined
      if (outcome === "no-matching-donation") {
        toast(reason || "No matching donation yet. Ko-fi may take a minute — try again shortly.", "error")
      } else if (outcome === "below-minimum") {
        toast(reason || "Donation below the $4.99 UC+ minimum.", "error")
      } else if (outcome === "donation-already-linked") {
        toast("That donation is linked to another account. Contact staff if this is wrong.", "error")
      } else {
        toast(data?.error || reason || `Couldn't redeem (HTTP ${res.status})`, "error")
      }
    } catch (error: any) {
      toast(error?.message ?? "Network error", "error")
    } finally {
      setRedeeming(false)
    }
  }

  const copyCode = async () => {
    if (!status?.claim?.code) return
    try {
      await navigator.clipboard.writeText(status.claim.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast("Couldn't copy — copy the code manually.", "error")
    }
  }

  const expiryLabel = useMemo(() => {
    if (!status?.expiresAt) return null
    const formatted = formatDate(status.expiresAt)
    const remaining = daysUntil(status.expiresAt)
    if (!formatted) return null
    if (remaining == null) return `Renews around ${formatted}`
    if (remaining <= 0) return `Lapsed ${formatted}`
    return `Renews around ${formatted} · ${remaining} day${remaining === 1 ? "" : "s"} left`
  }, [status?.expiresAt])

  // Not signed in
  if (!authLoading && !isAuthenticated) {
    return (
      <Card className="border-white/[.07]">
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center gap-3">
            <Crown className="h-5 w-5 text-cyan-300" />
            <h3 className="text-lg font-semibold">Sign in to manage UC+</h3>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            UC+ is tied to your UnionCrax account. Sign in via the website so we can attach your Ko-fi payment to your account.
          </p>
          <Button
            type="button"
            onClick={() => {
              void signInWithWebsite()
            }}
            className="rounded-full"
          >
            Sign in via website
          </Button>
        </CardContent>
      </Card>
    )
  }

  // Already active
  if (status?.active) {
    return (
      <Card className="border-cyan-400/20 bg-cyan-500/5">
        <CardContent className="space-y-4 p-6">
          <div className="flex flex-wrap items-center gap-3">
            <Badge className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-300">
              UC+ active
            </Badge>
            {expiryLabel ? <span className="text-xs text-muted-foreground">{expiryLabel}</span> : null}
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Thanks for backing UnionCrax — your perks are live. If you're on a monthly Ko-fi subscription, UC+ keeps renewing on its own. If a payment doesn't come through in time, UC+ pauses until the next one.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => openExternal(status.claim?.kofiUrl || "https://ko-fi.com/unioncrax")}
              className="rounded-full"
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Manage on Ko-fi
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={loadStatus}
              disabled={loading}
              className="rounded-full"
            >
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Has unredeemed code
  if (status?.claim) {
    const codeExpiry = formatDate(status.claim.expiresAt)
    return (
      <Card className="border-white/[.07]">
        <CardContent className="space-y-5 p-6">
          <div className="flex items-center gap-3">
            <Crown className="h-5 w-5 text-cyan-300" />
            <h3 className="text-lg font-semibold">Finish your UC+ claim on Ko-fi</h3>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Copy your code, then on Ko-fi donate or subscribe for <strong className="text-foreground">$4.99</strong> or more and <strong className="text-foreground">paste the code into the donation message</strong>. Your UC+ perks unlock as soon as the payment lands.
          </p>

          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-200/80">Your code</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <code className="rounded-xl bg-background/60 px-3 py-2 text-lg font-mono font-semibold tracking-widest">
                {status.claim.code}
              </code>
              <Button type="button" variant="outline" onClick={copyCode} className="rounded-full">
                {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            {codeExpiry ? (
              <p className="mt-3 text-xs text-muted-foreground">Code valid until {codeExpiry}.</p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => openExternal(status.claim!.kofiUrl)}
              className="rounded-full bg-[#ff5f5f] text-white hover:bg-[#ff4545]"
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Open Ko-fi
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={redeemNow}
              disabled={redeeming || loading}
              className="rounded-full"
            >
              {redeeming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              I just paid — redeem now
            </Button>
            <Button type="button" variant="ghost" onClick={loadStatus} disabled={loading} className="rounded-full">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh
            </Button>
          </div>

          <p className="text-xs text-muted-foreground/80">
            Don't forget to paste <strong>{status.claim.code}</strong> into the Ko-fi message — that's how we know the payment is yours.
          </p>
        </CardContent>
      </Card>
    )
  }

  // Signed in, no code yet, no active membership
  return (
    <Card className="border-white/[.07]">
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center gap-3">
          <Crown className="h-5 w-5 text-cyan-300" />
          <h3 className="text-lg font-semibold">Get UC+ via Ko-fi</h3>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Grab your claim code, head to Ko-fi, and your UC+ perks unlock the moment the payment lands.
        </p>
        <p className="text-xs text-muted-foreground/80">
          Subscribe monthly to keep UC+ rolling automatically, or send a one-time donation of $4.99 or more for 35 days of UC+.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={startClaim}
            disabled={creating || loading}
            className="rounded-full"
          >
            {creating || loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Crown className="mr-2 h-4 w-4" />}
            Generate my UC+ claim code
          </Button>
          {user?.email ? (
            <Button
              type="button"
              variant="outline"
              onClick={redeemNow}
              disabled={redeeming || loading}
              className="rounded-full"
            >
              {redeeming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              I already paid — check now
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            onClick={() => openExternal(`${getApiBaseUrl().replace(/\/+$/, "")}/uc-plus`)}
            className="rounded-full"
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            View benefits
          </Button>
        </div>
        {user?.email ? (
          <p className="text-xs text-muted-foreground/80">
            Already donated using the email on this account? Use "check now" — we'll match by email even without a code.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
