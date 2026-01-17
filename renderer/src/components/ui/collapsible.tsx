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
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  const ref = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return

    const setMaxHeight = (open: boolean) => {
      if (open) {
        const scrollH = el.scrollHeight
        el.style.maxHeight = scrollH + "px"
      } else {
        el.style.maxHeight = "0px"
      }
    }

    const initialState = el.getAttribute("data-state")
    setMaxHeight(initialState === "open")

    const observer = new MutationObserver((records) => {
      for (const rec of records) {
        if (rec.type === "attributes" && (rec as MutationRecord).attributeName === "data-state") {
          const state = el.getAttribute("data-state")
          requestAnimationFrame(() => {
            setMaxHeight(state === "open")
          })
        }
      }
    })

    observer.observe(el, { attributes: true })

    return () => observer.disconnect()
  }, [])

  return (
    <CollapsiblePrimitive.CollapsibleContent
      data-slot="collapsible-content"
      ref={ref}
      style={{ maxHeight: 0, transition: "max-height 320ms ease" }}
      className="overflow-hidden"
      {...props}
    />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
