import type { ComponentType } from "react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Cloud, Share2 } from "lucide-react"
import {
  Layers3,
  Bell,
  Heart,
  LogIn,
} from "@/components/icons"

type LoginPromptModalProps = {
  open: boolean
  onSignIn: () => void
  onSkip: () => void
  signingIn?: boolean
}

/** Permissive icon type — Lucide icons and our animated wrappers both fit. */
type BenefitIcon = ComponentType<{ className?: string }>

const benefits: Array<{ icon: BenefitIcon; label: string; desc: string }> = [
  { icon: Cloud, label: "Cloud sync", desc: "Your collections, wishlist and library follow you to every device." },
  { icon: Layers3, label: "Collections", desc: "Create, share, and follow curated game collections." },
  { icon: Share2, label: "Friends & sharing", desc: "Share what you're playing and see what others recommend." },
  { icon: Bell, label: "Update alerts", desc: "Get notified when followed collections add new games." },
  { icon: Heart, label: "Likes & history", desc: "Like games, keep your view history, and pick up where you left off." },
]

export function LoginPromptModal({ open, onSignIn, onSkip, signingIn }: LoginPromptModalProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onSkip() }}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-xl">Sign in to UnionCrax</DialogTitle>
          <DialogDescription className="text-left pt-1 text-zinc-400">
            You can use UC.Direct without an account, but signing in unlocks a lot more.
          </DialogDescription>
        </DialogHeader>
        <ul className="grid gap-2 py-1">
          {benefits.map(({ icon: Icon, label, desc }) => (
            <li key={label} className="flex items-start gap-3 rounded-xl border border-white/[.06] bg-white/[.02] px-3 py-2.5">
              <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[.06] text-zinc-200">
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-zinc-100 leading-tight">{label}</div>
                <div className="text-[12px] text-zinc-500 leading-snug">{desc}</div>
              </div>
            </li>
          ))}
        </ul>
        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button
            variant="outline"
            onClick={onSkip}
            disabled={signingIn}
            className="flex-1 sm:flex-none"
          >
            Skip for now
          </Button>
          <Button
            onClick={onSignIn}
            disabled={signingIn}
            className="flex-1 sm:flex-none gap-2 bg-white text-black hover:bg-zinc-200"
          >
            <LogIn className="h-4 w-4" />
            {signingIn ? "Signing in…" : "Sign in"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
