import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Check, ChevronRight, FolderOpen, Search } from "@/components/icons"
import { LogIn } from "@/components/icons"
import { HardDrive } from "lucide-react"
import { useDiscordAccount } from "@/hooks/use-discord-account"

const SEEN_KEY = "uc_onboarding_completed_v1"

type Step = "welcome" | "account" | "install-drive" | "first-game"

const STEP_ORDER: Step[] = ["welcome", "account", "install-drive", "first-game"]

/**
 * First-run onboarding flow. Single source of truth: the
 * `uc_onboarding_completed_v1` ucSettings key. Once any user clicks the
 * "Get started" button on the welcome step, we record their choice; the
 * modal never auto-opens again on this device. (Re-openable via the
 * `uc_open_onboarding` event so we can wire it to a future "Walk me through
 * the launcher again" Settings entry.)
 *
 * Steps:
 *   1. Welcome — intro + "let's go".
 *   2. Account — Discord sign-in (skippable, but recommended for sync).
 *   3. Install drive — confirm or change the download root.
 *   4. First game — point at /search so the user lands somewhere they can act.
 */
export function OnboardingModal() {
  const navigate = useNavigate()
  const account = useDiscordAccount()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>("welcome")
  const [downloadPath, setDownloadPath] = useState<string | null>(null)
  const [pickingPath, setPickingPath] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // Decide whether to open on mount. Cached + persisted via ucSettings.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const seen = await window.ucSettings?.get?.(SEEN_KEY)
        if (cancelled) return
        if (!seen) setOpen(true)
      } catch { /* ignore — onboarding stays closed on error */ } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    const onOpen = () => setOpen(true)
    window.addEventListener("uc_open_onboarding", onOpen)
    return () => {
      cancelled = true
      window.removeEventListener("uc_open_onboarding", onOpen)
    }
  }, [])

  // Pull the current download path so the user can confirm or change it.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      try {
        const value = await window.ucDownloads?.getDownloadPath?.()
        if (!cancelled) setDownloadPath(typeof value === "string" ? value : null)
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [open])

  const persistCompleted = useCallback(async () => {
    try { await window.ucSettings?.set?.(SEEN_KEY, true) } catch { /* ignore */ }
  }, [])

  const handleClose = useCallback(async () => {
    setOpen(false)
    await persistCompleted()
  }, [persistCompleted])

  const next = useCallback(() => {
    const idx = STEP_ORDER.indexOf(step)
    if (idx === -1 || idx === STEP_ORDER.length - 1) {
      void handleClose()
      return
    }
    setStep(STEP_ORDER[idx + 1])
  }, [step, handleClose])

  const handlePickPath = useCallback(async () => {
    if (!window.ucDownloads?.pickDownloadPath) return
    setPickingPath(true)
    try {
      const value = await window.ucDownloads.pickDownloadPath()
      if (typeof value === "string" && value) setDownloadPath(value)
    } catch { /* ignore */ } finally {
      setPickingPath(false)
    }
  }, [])

  const stepProgress = useMemo(() => {
    const idx = STEP_ORDER.indexOf(step)
    return `${idx + 1} of ${STEP_ORDER.length}`
  }, [step])

  if (!loaded) return null

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) void handleClose() }}>
      <DialogContent showCloseButton={false} className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="text-base">Welcome to Union.Manifold</DialogTitle>
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">{stepProgress}</span>
          </div>
          <DialogDescription>
            {step === "welcome" && "A 30-second tour so you know what you're looking at."}
            {step === "account" && "Sign in with Discord so wishlist / collections / playtime / notes follow you across devices."}
            {step === "install-drive" && "Pick the drive where your games will install. You can change this any time from Settings."}
            {step === "first-game" && "All set. One last suggestion — go install something."}
          </DialogDescription>
        </DialogHeader>

        {/* ── Welcome ── */}
        {step === "welcome" && (
          <div className="space-y-3">
            <div className="rounded-2xl border border-white/[.07] bg-white/[.03] px-4 py-3">
              <p className="text-sm text-foreground/80 leading-relaxed">
                UC.Direct is a desktop game launcher.
              </p>
              <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground leading-relaxed">
                <li className="flex gap-2"><Check className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" /> Browse + download games from the catalog.</li>
                <li className="flex gap-2"><Check className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" /> Library with collections, notes, playtime, updates.</li>
                <li className="flex gap-2"><Check className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" /> Discord Rich Presence + in-game overlay.</li>
                <li className="flex gap-2"><Check className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" /> Press <kbd className="rounded bg-white/[.07] px-1 py-px text-[10px] font-mono">?</kbd> anywhere for keyboard shortcuts.</li>
              </ul>
            </div>
            <p className="text-[11px] text-muted-foreground/80">
              The next three steps are optional — you can skip any of them.
            </p>
          </div>
        )}

        {/* ── Discord account ── */}
        {step === "account" && (
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-2xl border border-white/[.07] bg-white/[.03] px-4 py-3">
              <LogIn className="h-4 w-4 text-foreground/80 mt-0.5 shrink-0" />
              <div className="min-w-0">
                {account.user ? (
                  <>
                    <div className="text-sm font-semibold text-white">Signed in as {account.user.username}</div>
                    <p className="text-xs text-muted-foreground mt-0.5">You're all set — collections, notes, and playtime will sync automatically.</p>
                  </>
                ) : (
                  <>
                    <div className="text-sm font-semibold text-white">Not signed in yet</div>
                    <p className="text-xs text-muted-foreground mt-0.5">Sign in with Discord. You'll keep your wishlist, collections, RPC settings, playtime, and game notes across every device you install UC.D on.</p>
                  </>
                )}
              </div>
            </div>
            {!account.user && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => { navigate("/login"); void handleClose() }}
              >
                <LogIn className="h-4 w-4 mr-2" />
                Sign in with Discord
              </Button>
            )}
          </div>
        )}

        {/* ── Install drive ── */}
        {step === "install-drive" && (
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-2xl border border-white/[.07] bg-white/[.03] px-4 py-3">
              <HardDrive className="h-4 w-4 text-foreground/80 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-white">Game install location</div>
                <p className="text-xs text-muted-foreground mt-0.5 break-all font-mono">
                  {downloadPath || "Not configured — UC.D will fall back to your default downloads folder."}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void handlePickPath()} disabled={pickingPath}>
                <FolderOpen className="h-4 w-4 mr-1.5" />
                {pickingPath ? "Picking…" : downloadPath ? "Change drive" : "Pick a drive"}
              </Button>
              <p className="text-[11px] text-muted-foreground/80 leading-relaxed self-center flex-1 min-w-[200px]">
                Tip: an SSD or NVMe drive makes load times noticeably better for big modern games.
              </p>
            </div>
          </div>
        )}

        {/* ── First game ── */}
        {step === "first-game" && (
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-2xl border border-white/[.07] bg-white/[.03] px-4 py-3">
              <Search className="h-4 w-4 text-foreground/80 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white">Find your first game</div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Browse the catalog by genre, platform, or just scroll the home page. Right-click any card for quick actions (Download, Wishlist, Like, Hide from Discord…).
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => { navigate("/search"); void handleClose() }}
            >
              <Search className="h-4 w-4 mr-2" />
              Open Search
            </Button>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={() => void handleClose()}
            className="text-[11px] text-muted-foreground/80 hover:text-foreground/80 transition-colors"
          >
            Skip the rest
          </button>
          <Button onClick={next}>
            {step === STEP_ORDER[STEP_ORDER.length - 1] ? "Finish" : "Next"}
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
