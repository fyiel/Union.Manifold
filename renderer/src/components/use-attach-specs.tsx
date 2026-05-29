import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/api"

/**
 * Shared hook + UI for the per-post "share my specs" toggle.
 *
 * The toggle is only available when:
 *   - the viewer is signed in (so /api/profile/system returns 200)
 *   - they have an active system profile uploaded
 *
 * Default state mirrors the user's global visibility tier for the given
 * surface ("comment" or "forum"). Clicking flips the choice for the
 * current post only — the persistent tier in Settings is untouched.
 *
 * payloadValue collapses to `undefined` whenever the local override
 * matches the global default, so the network call simply omits the
 * field and the server uses the saved tier.
 */
export function useAttachSpecsToggle(surface: "comment" | "forum") {
  const [available, setAvailable] = useState(false)
  const [defaultOn, setDefaultOn] = useState(false)
  const [attachSpecs, setAttachSpecs] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await apiFetch("/api/profile/system")
        if (cancelled) return
        if (!res.ok) {
          setAvailable(false)
          return
        }
        const data = await res.json()
        const hasProfile = Boolean(data?.profile)
        setAvailable(hasProfile)
        const tier = surface === "comment"
          ? data?.visibility?.comments
          : data?.visibility?.forums
        setDefaultOn(tier !== "off")
        setAttachSpecs(undefined)
      } catch {
        if (!cancelled) setAvailable(false)
      }
    })()
    return () => { cancelled = true }
  }, [surface])

  const payloadValue = attachSpecs
  const displayedValue = attachSpecs === undefined ? defaultOn : attachSpecs
  const onChange = (next: boolean) => {
    setAttachSpecs(next === defaultOn ? undefined : next)
  }

  return { available, defaultOn, displayedValue, payloadValue, onChange }
}

export function AttachSpecsToggle({ value, onChange, className = "" }: {
  value: boolean
  onChange: (next: boolean) => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors " +
        (value
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
          : "border-white/10 bg-card/40 text-muted-foreground hover:text-foreground/90") +
        " " + className
      }
      title={value ? "Your PC specs will be shown on this post" : "Your PC specs will be hidden on this post"}
      aria-pressed={value}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${value ? "bg-emerald-300" : "bg-zinc-500"}`} />
      {value ? "Specs on" : "Specs off"}
    </button>
  )
}
