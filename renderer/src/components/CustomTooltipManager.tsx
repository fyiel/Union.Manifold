"use client"

import { useEffect, useRef } from "react"

type TooltipSide = "top" | "bottom" | "left" | "right"

const DEFAULT_DELAY_MS = 320
const MIN_DELAY_MS = 0
const MAX_DELAY_MS = 1200
const LONG_PRESS_MS = 450
const TAP_HIDE_MS = 1800
const TOOLTIP_OFFSET = 10
const VIEWPORT_MARGIN = 8

type PositionResult = {
  side: TooltipSide
  top: number
  left: number
}

function parseDelay(value: string | null): number {
  if (!value) return DEFAULT_DELAY_MS
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) return DEFAULT_DELAY_MS
  return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, parsed))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function parseSide(value: string | null): TooltipSide {
  if (value === "top" || value === "bottom" || value === "left" || value === "right") {
    return value
  }
  return "top"
}

function computePosition(
  targetRect: DOMRect,
  tooltipRect: DOMRect,
  preferredSide: TooltipSide
): PositionResult {
  const vw = window.innerWidth
  const vh = window.innerHeight

  const fitsTop = targetRect.top >= tooltipRect.height + TOOLTIP_OFFSET + VIEWPORT_MARGIN
  const fitsBottom = vh - targetRect.bottom >= tooltipRect.height + TOOLTIP_OFFSET + VIEWPORT_MARGIN
  const fitsLeft = targetRect.left >= tooltipRect.width + TOOLTIP_OFFSET + VIEWPORT_MARGIN
  const fitsRight = vw - targetRect.right >= tooltipRect.width + TOOLTIP_OFFSET + VIEWPORT_MARGIN

  const fallbackOrder: TooltipSide[] = [preferredSide]
  if (preferredSide === "top") fallbackOrder.push("bottom", "right", "left")
  if (preferredSide === "bottom") fallbackOrder.push("top", "right", "left")
  if (preferredSide === "left") fallbackOrder.push("right", "top", "bottom")
  if (preferredSide === "right") fallbackOrder.push("left", "top", "bottom")

  const canFit = (side: TooltipSide): boolean => {
    if (side === "top") return fitsTop
    if (side === "bottom") return fitsBottom
    if (side === "left") return fitsLeft
    return fitsRight
  }

  const side = fallbackOrder.find((candidate) => canFit(candidate)) ?? preferredSide

  let top = 0
  let left = 0

  if (side === "top") {
    top = targetRect.top - tooltipRect.height - TOOLTIP_OFFSET
    left = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2
  } else if (side === "bottom") {
    top = targetRect.bottom + TOOLTIP_OFFSET
    left = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2
  } else if (side === "left") {
    top = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2
    left = targetRect.left - tooltipRect.width - TOOLTIP_OFFSET
  } else {
    top = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2
    left = targetRect.right + TOOLTIP_OFFSET
  }

  top = clamp(top, VIEWPORT_MARGIN, vh - tooltipRect.height - VIEWPORT_MARGIN)
  left = clamp(left, VIEWPORT_MARGIN, vw - tooltipRect.width - VIEWPORT_MARGIN)

  return { side, top, left }
}

function findTooltipTarget(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null
  return node.closest<HTMLElement>("[data-uc-tooltip-content], [title]")
}

function normalizeTarget(element: HTMLElement): void {
  const current = element.getAttribute("data-uc-tooltip-content")
  if (current && current.trim()) {
    if (element.hasAttribute("title")) {
      element.removeAttribute("title")
    }
    return
  }

  const title = element.getAttribute("title")
  if (!title || !title.trim()) {
    if (title === "") {
      element.removeAttribute("title")
    }
    return
  }

  element.setAttribute("data-uc-tooltip-content", title)
  element.removeAttribute("title")
}

function removeManagedDescribedBy(target: HTMLElement, tooltipId: string): void {
  if (target.getAttribute("data-uc-tooltip-describedby") !== "true") return
  const current = target.getAttribute("aria-describedby")
  if (!current) {
    target.removeAttribute("data-uc-tooltip-describedby")
    return
  }

  const next = current
    .split(/\s+/)
    .filter((token) => token && token !== tooltipId)
    .join(" ")

  if (next) {
    target.setAttribute("aria-describedby", next)
  } else {
    target.removeAttribute("aria-describedby")
  }

  target.removeAttribute("data-uc-tooltip-describedby")
}

export function CustomTooltipManager() {
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLSpanElement | null>(null)
  const activeTargetRef = useRef<HTMLElement | null>(null)
  const showTimerRef = useRef<number | null>(null)
  const tapHideTimerRef = useRef<number | null>(null)
  const longPressTimerRef = useRef<number | null>(null)
  const longPressTriggeredRef = useRef(false)

  useEffect(() => {
    const tooltip = tooltipRef.current
    const content = contentRef.current
    if (!tooltip || !content) return

    let cleanupObserver: (() => void) | null = null

    const clearTimers = (): void => {
      if (showTimerRef.current !== null) {
        window.clearTimeout(showTimerRef.current)
        showTimerRef.current = null
      }
      if (tapHideTimerRef.current !== null) {
        window.clearTimeout(tapHideTimerRef.current)
        tapHideTimerRef.current = null
      }
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }
    }

    const hide = (): void => {
      clearTimers()
      const active = activeTargetRef.current
      if (active) {
        removeManagedDescribedBy(active, tooltip.id)
      }
      activeTargetRef.current = null
      tooltip.dataset.state = "hidden"
      tooltip.removeAttribute("data-side")
      tooltip.setAttribute("aria-hidden", "true")
      tooltip.style.top = "-9999px"
      tooltip.style.left = "-9999px"
    }

    const positionTooltip = (target: HTMLElement): void => {
      const preferredSide = parseSide(target.getAttribute("data-tooltip-position"))

      const targetRect = target.getBoundingClientRect()
      const tooltipRect = tooltip.getBoundingClientRect()
      const result = computePosition(targetRect, tooltipRect, preferredSide)

      tooltip.dataset.side = result.side
      tooltip.style.top = `${result.top}px`
      tooltip.style.left = `${result.left}px`
    }

    const show = (target: HTMLElement): void => {
      normalizeTarget(target)

      const text = target.getAttribute("data-uc-tooltip-content")?.trim()
      if (!text) return

      activeTargetRef.current = target
      content.textContent = text

      const arrowEnabled = target.getAttribute("data-tooltip-arrow") !== "false"
      tooltip.dataset.arrow = arrowEnabled ? "true" : "false"

      const existingDescription = target.getAttribute("aria-describedby")
      if (!existingDescription) {
        target.setAttribute("aria-describedby", tooltip.id)
        target.setAttribute("data-uc-tooltip-describedby", "true")
      } else if (!existingDescription.split(/\s+/).includes(tooltip.id)) {
        target.setAttribute("aria-describedby", `${existingDescription} ${tooltip.id}`.trim())
        target.setAttribute("data-uc-tooltip-describedby", "true")
      }

      tooltip.dataset.state = "visible"
      tooltip.setAttribute("aria-hidden", "false")
      positionTooltip(target)
    }

    const scheduleShow = (target: HTMLElement, immediate = false): void => {
      clearTimers()
      const delay = immediate ? 0 : parseDelay(target.getAttribute("data-tooltip-delay"))
      showTimerRef.current = window.setTimeout(() => {
        show(target)
      }, delay)
    }

    const shouldHideForRelatedTarget = (relatedTarget: EventTarget | null): boolean => {
      if (!(relatedTarget instanceof Element)) return true
      if (tooltip.contains(relatedTarget)) return false
      const activeTarget = activeTargetRef.current
      if (!activeTarget) return true
      return !activeTarget.contains(relatedTarget)
    }

    const onPointerOver = (event: PointerEvent): void => {
      if (event.pointerType === "touch") return
      const target = findTooltipTarget(event.target)
      if (!target) return
      scheduleShow(target)
    }

    const onPointerOut = (event: PointerEvent): void => {
      if (event.pointerType === "touch") return
      if (!shouldHideForRelatedTarget(event.relatedTarget)) return
      hide()
    }

    const onFocusIn = (event: FocusEvent): void => {
      const target = findTooltipTarget(event.target)
      if (!target) return
      scheduleShow(target)
    }

    const onFocusOut = (event: FocusEvent): void => {
      if (!shouldHideForRelatedTarget(event.relatedTarget)) return
      hide()
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        hide()
      }
    }

    const onPointerDown = (event: PointerEvent): void => {
      const target = findTooltipTarget(event.target)
      if (!target) {
        hide()
      }
    }

    const onTouchStart = (event: TouchEvent): void => {
      const target = findTooltipTarget(event.target)
      if (!target) {
        hide()
        return
      }
      clearTimers()
      longPressTriggeredRef.current = false
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTriggeredRef.current = true
        show(target)
      }, LONG_PRESS_MS)
    }

    const onTouchEnd = (event: TouchEvent): void => {
      const target = findTooltipTarget(event.target)
      if (!target) {
        hide()
        return
      }

      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }

      if (!longPressTriggeredRef.current) {
        show(target)
        tapHideTimerRef.current = window.setTimeout(() => hide(), TAP_HIDE_MS)
      }
    }

    const onScrollOrResize = (): void => {
      const activeTarget = activeTargetRef.current
      if (!activeTarget || tooltip.dataset.state !== "visible") return
      positionTooltip(activeTarget)
    }

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes" && mutation.target instanceof HTMLElement) {
          if (mutation.attributeName === "title") {
            normalizeTarget(mutation.target)
          }
          continue
        }

        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue
          const element = node as HTMLElement
          normalizeTarget(element)
          const descendants = element.querySelectorAll<HTMLElement>("[title]")
          descendants.forEach((descendant) => normalizeTarget(descendant))
        }
      }
    })

    const seedExistingTitles = (): void => {
      const withTitle = document.querySelectorAll<HTMLElement>("[title]")
      withTitle.forEach((element) => normalizeTarget(element))
    }

    seedExistingTitles()

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["title"],
    })

    cleanupObserver = () => observer.disconnect()

    document.addEventListener("pointerover", onPointerOver, true)
    document.addEventListener("pointerout", onPointerOut, true)
    document.addEventListener("focusin", onFocusIn, true)
    document.addEventListener("focusout", onFocusOut, true)
    document.addEventListener("keydown", onKeyDown, true)
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("touchstart", onTouchStart, true)
    document.addEventListener("touchend", onTouchEnd, true)
    window.addEventListener("scroll", onScrollOrResize, true)
    window.addEventListener("resize", onScrollOrResize)

    return () => {
      clearTimers()
      cleanupObserver?.()
      document.removeEventListener("pointerover", onPointerOver, true)
      document.removeEventListener("pointerout", onPointerOut, true)
      document.removeEventListener("focusin", onFocusIn, true)
      document.removeEventListener("focusout", onFocusOut, true)
      document.removeEventListener("keydown", onKeyDown, true)
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("touchstart", onTouchStart, true)
      document.removeEventListener("touchend", onTouchEnd, true)
      window.removeEventListener("scroll", onScrollOrResize, true)
      window.removeEventListener("resize", onScrollOrResize)
    }
  }, [])

  return (
    <div
      id="uc-global-tooltip"
      ref={tooltipRef}
      role="tooltip"
      aria-hidden="true"
      data-state="hidden"
      className="uc-global-tooltip"
      style={{ top: "-9999px", left: "-9999px" }}
    >
      <span className="uc-global-tooltip__content" ref={contentRef} />
      <span className="uc-global-tooltip__arrow" aria-hidden="true" />
    </div>
  )
}
