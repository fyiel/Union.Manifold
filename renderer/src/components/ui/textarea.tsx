import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "bg-card border border-border text-foreground/90 placeholder:text-muted-foreground/60 flex field-sizing-content min-h-16 w-full rounded-2xl px-3 py-2 text-base transition-colors outline-none focus-visible:border-white aria-invalid:border-red-500/60 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
