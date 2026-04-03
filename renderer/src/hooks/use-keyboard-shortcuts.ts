import { useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  if (target.isContentEditable) return true
  if (target.closest("[contenteditable='true']")) return true
  return false
}

export function useKeyboardShortcuts() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.altKey) return

      const key = event.key.toLowerCase()
      const editableTarget = isEditableTarget(event.target)

      if (key === "k" && !event.shiftKey) {
        event.preventDefault()
        window.dispatchEvent(new Event("uc_open_search_popup"))
        return
      }

      if (editableTarget) return

      if (key === ",") {
        event.preventDefault()
        if (location.pathname !== "/settings") navigate("/settings")
        return
      }

      if (!event.shiftKey) {
        if (key === "1") {
          event.preventDefault()
          if (location.pathname !== "/") navigate("/")
          return
        }
        if (key === "2") {
          event.preventDefault()
          if (location.pathname !== "/library") navigate("/library")
          return
        }
        if (key === "3") {
          event.preventDefault()
          if (location.pathname !== "/downloads") navigate("/downloads")
          return
        }
        if (key === "4") {
          event.preventDefault()
          if (location.pathname !== "/wishlist") navigate("/wishlist")
          return
        }
      }

      if (event.shiftKey && key === "s" && location.pathname.startsWith("/library")) {
        event.preventDefault()
        window.dispatchEvent(new Event("uc_library_cycle_sort"))
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [location.pathname, navigate])
}
