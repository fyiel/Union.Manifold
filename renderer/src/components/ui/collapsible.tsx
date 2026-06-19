"use client"

import * as React from "react"
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"

function Collapsible({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return (
    <CollapsiblePrimitive.CollapsibleTrigger
      data-slot="collapsible-trigger"
      {...props}
    />
  )
}

function CollapsibleContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return (
    <>
      <style>{`
        @keyframes collapsible-down {
          from { height: 0; }
          to { height: var(--radix-collapsible-content-height); }
        }
        @keyframes collapsible-up {
          from { height: var(--radix-collapsible-content-height); }
          to { height: 0; }
        }
        .collapsible-anim[data-state="open"] {
          animation: collapsible-down 220ms ease-in-out;
        }
        .collapsible-anim[data-state="closed"] {
          animation: collapsible-up 220ms ease-in-out;
        }
      `}</style>
      <CollapsiblePrimitive.CollapsibleContent
        data-slot="collapsible-content"
        className={`overflow-hidden collapsible-anim ${className || ""}`}
        {...props}
      >
        {children}
      </CollapsiblePrimitive.CollapsibleContent>
    </>
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
