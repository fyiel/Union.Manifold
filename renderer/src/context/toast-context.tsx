import { createContext, useCallback, useContext, useReducer } from "react"

export type ToastType = "success" | "error" | "info"

export interface ToastItem {
  id: string
  message: string
  type: ToastType
  duration: number
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
  toast: (message: string, type?: ToastType, duration?: number) => void
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, dispatch] = useReducer(reducer, [])

  const dismiss = useCallback((id: string) => {
    dispatch({ type: "REMOVE", id })
  }, [])

  const toast = useCallback(
    (message: string, type: ToastType = "info", duration = 3000) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      dispatch({ type: "ADD", toast: { id, message, type, duration } })
      // Remove after duration + 800ms (500ms exit animation + buffer)
      setTimeout(() => dispatch({ type: "REMOVE", id }), duration + 800)
    },
    []
  )

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
