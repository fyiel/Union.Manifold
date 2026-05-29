import { type ReactNode } from "react"
import { useActiveTheme } from "@/hooks/use-active-theme"

export function ThemeBoundary({ children }: { children: ReactNode }) {
  useActiveTheme()
  return <>{children}</>
}
