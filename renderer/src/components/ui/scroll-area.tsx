"use client"

import * as React from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"
import { cn } from "@/lib/utils"

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    data-slot="scrollbar"
    className={cn(
      "flex touch-none select-none bg-transparent transition-colors",
      orientation === "vertical" ? "h-full w-2.5" : "h-2.5 flex-col",
      className
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb
      data-slot="scrollbar-thumb"
      className="relative m-0.5 flex-1 rounded-full bg-zinc-700/95 hover:bg-zinc-600"
    />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
))
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
    viewportClassName?: string
  }
>(({ className, viewportClassName, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    type="always"
    data-slot="scroll-area"
    className={cn("relative overflow-hidden", className)}
    {...props}
  >
    <ScrollAreaPrimitive.Viewport ref={ref} className={cn("h-full w-full rounded-[inherit]", viewportClassName)}>
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar orientation="vertical" />
    <ScrollBar orientation="horizontal" />
    <ScrollAreaPrimitive.Corner className="bg-transparent" />
  </ScrollAreaPrimitive.Root>
))
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName

export { ScrollArea, ScrollBar }
