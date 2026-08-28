import { useEffect, useRef } from "react"
import { useToast } from "@/context/toast-context"

type ResolverState = "solving" | "interactive" | "captured" | "cleared" | "failed" | "cancelled"

export function ResolverStatusGuard() {
  const { toast } = useToast()
  const escalatedForHost = useRef<string | null>(null)
  const hintShownForHost = useRef(new Set<string>())
  const doneForHost = useRef(new Set<string>())

  useEffect(() => {
    const unlisten = window.ucResolver?.onStatus?.((data) => {
      const state = data?.state as ResolverState
      const host = data?.host || "the file host"
      if (state === "solving" && !hintShownForHost.current.has(host)) {
        hintShownForHost.current.add(host)
        window.setTimeout(() => {
          if (escalatedForHost.current === host || doneForHost.current.has(host)) return
          toast(`Opening ${host} through a secure browser session…`, "info", 5_000)
        }, 8_000)
      }
      if (state === "interactive") {
        escalatedForHost.current = host
        toast(
          `Finish the security check for ${host} in the window that just opened — the download continues automatically.`,
          "info",
          {
            duration: 10_000,
            action: {
              label: "Cancel",
              onClick: () => void window.ucResolver?.cancel?.(),
            },
          },
        )
      } else if ((state === "failed" || state === "cancelled") && escalatedForHost.current === host) {
        escalatedForHost.current = null
        const reason =
          data?.reason === "cancelled"
            ? "was closed or cancelled"
            : data?.reason === "link appears dead or expired"
              ? "looks dead or expired"
              : "timed out"
        toast(
          `Verification for ${host} ${reason}. Opening the link in your browser instead.`,
          "error",
          6_000,
        )
      } else if (state === "captured" || state === "cleared") {
        escalatedForHost.current = null
        doneForHost.current.add(host)
      }
    })
    return () => unlisten?.()
  }, [toast])

  return null
}
