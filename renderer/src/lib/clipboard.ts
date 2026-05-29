/**
 * Copy to clipboard with a unified toast.
 *
 * Anywhere we previously had ad-hoc copy state ("Copied!" badge that
 * auto-clears after 1.5s) can just call this instead. The toast is raised
 * via a window event so the helper stays usable from non-React code —
 * `ToastProvider` listens for `uc_toast` and routes it through its normal
 * dispatch.
 *
 * Returns true on success, false on failure. The caller almost always wants
 * to ignore the return value because the toast already communicates outcome.
 */

export type ClipboardToastOptions = {
  /** Message shown on a successful copy. Defaults to "Copied to clipboard". */
  successMessage?: string
  /** Message shown when the clipboard API throws or isn't available. */
  errorMessage?: string
  /** Suppress the toast entirely (callers that want their own UI feedback). */
  silent?: boolean
}

export async function copyToClipboard(text: string, options: ClipboardToastOptions = {}): Promise<boolean> {
  const successMessage = options.successMessage ?? "Copied to clipboard"
  const errorMessage = options.errorMessage ?? "Couldn't copy to clipboard"
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      throw new Error("clipboard-unavailable")
    }
    await navigator.clipboard.writeText(text)
    if (!options.silent && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("uc_toast", {
        detail: { message: successMessage, type: "success" },
      }))
    }
    return true
  } catch {
    if (!options.silent && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("uc_toast", {
        detail: { message: errorMessage, type: "error" },
      }))
    }
    return false
  }
}

/**
 * Fire-and-forget toast from anywhere. Useful for IPC callbacks, settings
 * saves, and other places where pulling in useToast() would force a
 * component refactor.
 */
export function emitToast(message: string, type: "success" | "error" | "info" = "info", duration = 3000): void {
  if (typeof window === "undefined" || !message) return
  try {
    window.dispatchEvent(new CustomEvent("uc_toast", { detail: { message, type, duration } }))
  } catch { /* ignore */ }
}
