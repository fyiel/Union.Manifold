import { createContext, useCallback, useContext, useEffect, useReducer } from "react"

export type ToastType = "success" | "error" | "info"

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastItem {
  id: string
  message: string
  type: ToastType
  duration: number
  action?: ToastAction
}

export interface ToastOptions {
  duration?: number
  action?: ToastAction
}

type Action =
  | { type: "ADD"; toast: ToastItem }
  | { type: "REMOVE"; id: string }

function reducer(state: ToastItem[], action: Action): ToastItem[] {
  switch (action.type) {
    case "ADD":
      return [...state, action.toast]
    case "REMOVE":
      return state.filter((t) => t.id !== action.id)
    default:
      return state
  }
}

interface ToastContextValue {
  toasts: ToastItem[]
  toast: (message: string, type?: ToastType, durationOrOptions?: number | ToastOptions) => string
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, dispatch] = useReducer(reducer, [])

  const dismiss = useCallback((id: string) => {
    dispatch({ type: "REMOVE", id })
  }, [])

  const toast = useCallback(
    (message: string, type: ToastType = "info", durationOrOptions: number | ToastOptions = 3000): string => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      let duration = 3000
      let action: ToastAction | undefined
      if (typeof durationOrOptions === "number") {
        duration = durationOrOptions
      } else if (durationOrOptions && typeof durationOrOptions === "object") {
        duration = durationOrOptions.duration ?? 3000
        action = durationOrOptions.action
      }
      dispatch({ type: "ADD", toast: { id, message, type, duration, action } })
      setTimeout(() => dispatch({ type: "REMOVE", id }), duration + 800)
      return id
    },
    []
  )

  useEffect(() => {
    if (typeof window === "undefined") return
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string; type?: ToastType; duration?: number }>).detail
      if (!detail?.message) return
      toast(detail.message, detail.type ?? "info", detail.duration ?? 3000)
    }
    window.addEventListener("uc_toast", onToast)
    return () => window.removeEventListener("uc_toast", onToast)
  }, [toast])

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error("useToast must be used inside ToastProvider")
  return ctx
}
