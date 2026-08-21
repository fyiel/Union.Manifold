import { useEffect, useRef } from "react"
import { useToast } from "@/context/toast-context"

type ResolverState = "solving" | "interactive" | "captured" | "cleared" | "failed" | "cancelled"

/**
 * Surfaces webview-solver progress that would otherwise be invisible: a
 * hidden solve stays quiet, but when the solver window becomes visible the
 * user should know why, and a failed visible session deserves an
 * explanation before the browser fallback opens.
 */
export function ResolverStatusGuard() {
  const { toast } = useToast()
  const escalatedForHost = useRef<string | null>(null)

  useEffect(() => {
    const unlisten = window.ucResolver?.onStatus?.((data) => {
      const state = data?.state as ResolverState
      const host = data?.host || "the file host"
      if (state === "interactive") {
        escalatedForHost.current = host
        toast(
          `Finish the security check for ${host} in the window that just opened — the download continues automatically.`,
          "info",
          10_000,
        )
      } else if ((state === "failed" || state === "cancelled") && escalatedForHost.current === host) {
        escalatedForHost.current = null
        const reason = data?.reason === "cancelled" ? "was closed" : "timed out"
        toast(
          `Verification for ${host} ${reason}. Opening the link in your browser instead.`,
          "error",
          6_000,
        )
      } else if (state === "captured" || state === "cleared") {
        escalatedForHost.current = null
      }
    })
    return () => unlisten?.()
  }, [toast])

  return null
}
