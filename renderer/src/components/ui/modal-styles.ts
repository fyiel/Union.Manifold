// Shared modal/floating-surface tokens — kept in sync with union-crax.xyz
// (components/ui/modal-styles.ts). The web app and launcher should look
// identical when displaying any popover, dialog, sheet, tooltip, or select.

export const modalOverlayClassName =
  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/72 backdrop-blur-md"

export const modalSurfaceClassName =
  "border border-border bg-background/95 text-foreground shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl"

export const centeredModalContentClassName =
  "uc-themed-scroll data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed left-1/2 top-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-3xl p-6 duration-300 max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg"

export const modalCloseButtonClassName =
  "absolute right-4 top-4 inline-flex size-9 items-center justify-center rounded-full border border-border bg-secondary/60 text-muted-foreground opacity-100 transition-all hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

export const modalTitleClassName = "text-lg font-semibold tracking-tight text-foreground"

export const modalDescriptionClassName = "text-sm leading-relaxed text-muted-foreground"

export const floatingSurfaceClassName =
  "border border-border bg-popover/95 text-popover-foreground shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl"

export function floatingPopupContentClassName(originVariable: string) {
  return [
    "data-[state=open]:animate-in",
    "data-[state=closed]:animate-out",
    "data-[state=closed]:fade-out-0",
    "data-[state=open]:fade-in-0",
    "data-[state=closed]:zoom-out-95",
    "data-[state=open]:zoom-in-95",
    "data-[side=bottom]:slide-in-from-top-2",
    "data-[side=left]:slide-in-from-right-2",
    "data-[side=right]:slide-in-from-left-2",
    "data-[side=top]:slide-in-from-bottom-2",
    "z-50",
    `origin-(${originVariable})`,
    "overflow-hidden",
    "rounded-2xl",
    "p-1.5",
    "outline-hidden",
  ].join(" ")
}

export const floatingMenuItemClassName =
  "relative flex cursor-default items-center gap-2 rounded-xl px-2.5 py-2 text-sm text-popover-foreground outline-hidden select-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground focus:bg-accent/15 focus:text-foreground active:scale-[0.99]"

export const floatingMenuLabelClassName =
  "px-2.5 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80"

export const floatingMenuSeparatorClassName = "-mx-1 my-1 h-px bg-border"

export const floatingMenuShortcutClassName =
  "ml-auto text-[11px] tracking-[0.18em] text-muted-foreground/80"

export const floatingSubTriggerClassName =
  "data-[state=open]:bg-accent/15 data-[state=open]:text-foreground"

export const tooltipSurfaceClassName =
  "z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-2xl border border-border bg-popover/95 px-3 py-2 text-xs text-popover-foreground shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
