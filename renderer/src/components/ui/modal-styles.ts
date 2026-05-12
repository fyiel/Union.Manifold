// Shared modal/floating-surface tokens — kept in sync with union-crax.xyz
// (components/ui/modal-styles.ts). The web app and launcher should look
// identical when displaying any popover, dialog, sheet, tooltip, or select.

export const modalOverlayClassName =
  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/72 backdrop-blur-md"

export const modalSurfaceClassName =
  "border border-white/[.07] bg-zinc-950/88 text-white shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl"

export const centeredModalContentClassName =
  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed left-1/2 top-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-3xl p-6 duration-300 max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg"

export const modalCloseButtonClassName =
  "absolute right-4 top-4 inline-flex size-9 items-center justify-center rounded-full border border-white/[.07] bg-white/5 text-zinc-400 opacity-100 transition-all hover:bg-white hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 active:scale-95 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

export const modalTitleClassName = "text-lg font-semibold tracking-tight text-white"

export const modalDescriptionClassName = "text-sm leading-relaxed text-zinc-400"

export const floatingSurfaceClassName =
  "border border-white/[.07] bg-zinc-950/92 text-white shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl"

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
  "relative flex cursor-default items-center gap-2 rounded-xl px-2.5 py-2 text-sm text-zinc-200 outline-hidden select-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-zinc-400 focus:bg-white/[.08] focus:text-white active:scale-[0.99]"

export const floatingMenuLabelClassName =
  "px-2.5 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500"

export const floatingMenuSeparatorClassName = "-mx-1 my-1 h-px bg-white/[.07]"

export const floatingMenuShortcutClassName =
  "ml-auto text-[11px] tracking-[0.18em] text-zinc-500"

export const floatingSubTriggerClassName =
  "data-[state=open]:bg-white/[.08] data-[state=open]:text-white"

export const tooltipSurfaceClassName =
  "z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-2xl border border-white/[.07] bg-zinc-950/94 px-3 py-2 text-xs text-zinc-100 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
