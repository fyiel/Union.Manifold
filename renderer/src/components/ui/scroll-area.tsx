"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Custom ScrollArea component that uses native scrolling for better performance,
 * middle-click (autoscroll) support, and standard scrollbar behavior.
 * Styles the native scrollbar using the systems defined in globals.css.
 */
function ScrollArea({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="scroll-area"
      className={cn("relative overflow-auto", className)}
      {...props}
    >
      {children}
    </div>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { orientation?: "vertical" | "horizontal" }) {
  // We use native scrollbars via CSS in globals.css, so this component 
  // doesn't need to render anything but we keep it for API compatibility.
  return null
}

export { ScrollArea, ScrollBar }
