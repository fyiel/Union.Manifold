import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        data-slot="input"
        className={cn(
          "file:text-foreground/90 placeholder:text-muted-foreground/60 selection:bg-white/20 selection:text-white border-border flex h-9 w-full min-w-0 rounded-2xl border bg-card px-4 py-1 text-sm text-foreground/90 transition-colors outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-30",
          "focus-visible:border-white",
          "aria-invalid:border-red-500/60",
          className
        )}
        {...props}
      />
    )
  }
)

Input.displayName = "Input"

export { Input }
