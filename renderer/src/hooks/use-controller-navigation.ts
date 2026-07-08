import { useEffect, useRef } from 'react'
import { playHaptic, setHapticsEnabled, setHapticsIntensity } from '../lib/haptics'

interface ControllerNavOptions {
  enabled: boolean
  hapticsEnabled: boolean
  deadzone: number
  intensity?: number
}

const BTN = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
} as const

type Direction = 'up' | 'down' | 'left' | 'right'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[role="button"]:not([aria-disabled="true"])',
  '[role="tab"]',
  '[role="menuitem"]',
  '[data-uc-focusable]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function isVisible(el: HTMLElement): boolean {
  if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') return false
  const rect = el.getBoundingClientRect()
  if (rect.width <= 1 || rect.height <= 1) return false
  if (rect.bottom < -40 || rect.top > window.innerHeight + 40) return false
  if (rect.right < -40 || rect.left > window.innerWidth + 40) return false
  const style = window.getComputedStyle(el)
  if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') return false
  return true
}

function collectFocusable(): HTMLElement[] {
  const all = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
  return all.filter(isVisible)
}

interface Rect { cx: number; cy: number; left: number; right: number; top: number; bottom: number }

function rectOf(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect()
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, left: r.left, right: r.right, top: r.top, bottom: r.bottom }
}

function findCandidate(current: HTMLElement, dir: Direction, candidates: HTMLElement[]): HTMLElement | null {
  const from = rectOf(current)
  let best: HTMLElement | null = null
  let bestScore = Infinity

  for (const el of candidates) {
    if (el === current) continue
    const to = rectOf(el)

    let primary: number
    let perpendicular: number

    switch (dir) {
      case 'up':
        primary = from.cy - to.cy
        perpendicular = Math.abs(from.cx - to.cx)
        if (to.cy >= from.cy - 4) continue
        break
      case 'down':
        primary = to.cy - from.cy
        perpendicular = Math.abs(from.cx - to.cx)
        if (to.cy <= from.cy + 4) continue
        break
      case 'left':
        primary = from.cx - to.cx
        perpendicular = Math.abs(from.cy - to.cy)
        if (to.cx >= from.cx - 4) continue
        break
      case 'right':
        primary = to.cx - from.cx
        perpendicular = Math.abs(from.cy - to.cy)
        if (to.cx <= from.cx + 4) continue
        break
    }

    if (primary <= 0) continue
    const score = primary + perpendicular * 2
    if (score < bestScore) {
      bestScore = score
      best = el
    }
  }
  return best
}

export function useControllerNavigation(options: ControllerNavOptions) {
  const { enabled, hapticsEnabled, deadzone, intensity = 1 } = options

  const optsRef = useRef(options)
  optsRef.current = options

  useEffect(() => {
    setHapticsEnabled(hapticsEnabled)
    setHapticsIntensity(intensity)
  }, [hapticsEnabled, intensity])

  useEffect(() => {
    if (!enabled) return
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return

    let raf = 0
    let active = true
    let looping = false
    let fallbackTimer = 0
    let noPadFrames = 0

    const prevButtons: Record<number, boolean> = {}
    const dirHeldSince: Record<Direction, number> = { up: 0, down: 0, left: 0, right: 0 }
    const dirNextRepeat: Record<Direction, number> = { up: 0, down: 0, left: 0, right: 0 }
    const REPEAT_DELAY = 380
    const REPEAT_RATE = 110

    function markGamepadActive() {
      const root = document.documentElement
      if (!root.hasAttribute('data-uc-gamepad')) root.setAttribute('data-uc-gamepad', 'true')
    }

    function ensureFocus(): HTMLElement | null {
      const activeEl = document.activeElement as HTMLElement | null
      if (activeEl && activeEl !== document.body && isVisible(activeEl)) return activeEl
      const list = collectFocusable()
      const first = list[0] ?? null
      if (first) {
        first.focus({ preventScroll: true })
        first.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
      }
      return first
    }

    function move(dir: Direction) {
      markGamepadActive()
      const activeEl = document.activeElement as HTMLElement | null
      const hadFocus = !!activeEl && activeEl !== document.body && isVisible(activeEl)
      const current = ensureFocus()
      if (!current) return
      if (!hadFocus) { playHaptic('nav'); return }
      const candidates = collectFocusable()
      const next = findCandidate(current, dir, candidates)
      if (next) {
        next.focus({ preventScroll: true })
        next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
        playHaptic('nav')
      } else {
        const scrolled = scrollInDirection(dir)
        playHaptic(scrolled ? 'nav' : 'boundary')
      }
    }

    function scrollInDirection(dir: Direction): boolean {
      const container = findScrollContainer(document.activeElement as HTMLElement | null)
      if (!container) return false
      const delta = 160
      const before = dir === 'up' || dir === 'down' ? container.scrollTop : container.scrollLeft
      if (dir === 'down') container.scrollTop += delta
      else if (dir === 'up') container.scrollTop -= delta
      else if (dir === 'right') container.scrollLeft += delta
      else container.scrollLeft -= delta
      const after = dir === 'up' || dir === 'down' ? container.scrollTop : container.scrollLeft
      return after !== before
    }

    function activate(el: HTMLElement | null) {
      markGamepadActive()
      const target = el ?? ensureFocus()
      if (!target) return
      const tag = target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        target.focus()
        playHaptic('select')
        return
      }
      target.click()
      playHaptic('select')
    }

    function goBack() {
      markGamepadActive()
      const openSurface = document.querySelector(
        '[role="dialog"][data-state="open"], [role="menu"][data-state="open"], [data-radix-popper-content-wrapper]'
      )
      if (openSurface) {
        const escTarget = (document.activeElement as HTMLElement | null) ?? document.body
        escTarget.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
        playHaptic('back')
        return
      }
      const backEl = document.querySelector<HTMLElement>('[data-uc-back]:not([disabled])')
      if (backEl && isVisible(backEl)) {
        backEl.click()
        playHaptic('back')
        return
      }
      const escTarget = (document.activeElement as HTMLElement | null) ?? document.body
      escTarget.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
      playHaptic('back')
    }

    function handleDirection(dir: Direction, pressed: boolean, now: number) {
      if (!pressed) {
        dirHeldSince[dir] = 0
        dirNextRepeat[dir] = 0
        return
      }
      if (dirHeldSince[dir] === 0) {
        dirHeldSince[dir] = now
        dirNextRepeat[dir] = now + REPEAT_DELAY
        move(dir)
      } else if (now >= dirNextRepeat[dir]) {
        dirNextRepeat[dir] = now + REPEAT_RATE
        move(dir)
      }
    }

    function loop() {
      if (!active || !looping) return
      const now = performance.now()
      const pads = navigator.getGamepads?.() || []
      const pad = Array.from(pads).find((p): p is Gamepad => !!p && p.connected) || null

      if (pad) {
        noPadFrames = 0
        const dz = Math.max(0.05, optsRef.current.deadzone || 0.15)
        const lx = pad.axes[0] ?? 0
        const ly = pad.axes[1] ?? 0

        const btn = (i: number) => !!pad.buttons[i]?.pressed
        const edge = (i: number) => {
          const cur = btn(i)
          const was = prevButtons[i] || false
          prevButtons[i] = cur
          return cur && !was
        }

        const horizDominant = Math.abs(lx) >= Math.abs(ly)
        const stickUp = !horizDominant && ly < -dz
        const stickDown = !horizDominant && ly > dz
        const stickLeft = horizDominant && lx < -dz
        const stickRight = horizDominant && lx > dz

        handleDirection('up', btn(BTN.DPAD_UP) || stickUp, now)
        handleDirection('down', btn(BTN.DPAD_DOWN) || stickDown, now)
        handleDirection('left', btn(BTN.DPAD_LEFT) || stickLeft, now)
        handleDirection('right', btn(BTN.DPAD_RIGHT) || stickRight, now)

        if (edge(BTN.A)) activate(document.activeElement as HTMLElement | null)
        if (edge(BTN.B)) goBack()
        edge(BTN.X); edge(BTN.Y); edge(BTN.LB); edge(BTN.RB)
        edge(BTN.LT); edge(BTN.RT); edge(BTN.BACK); edge(BTN.START)

        const ry = pad.axes[3] ?? 0
        if (Math.abs(ry) > dz) {
          const container = findScrollContainer(document.activeElement as HTMLElement | null)
          if (container) container.scrollTop += ry * 18
        }
      } else if (++noPadFrames >= 600) {
        stopLoop()
        return
      }

      raf = requestAnimationFrame(loop)
    }

    const padPresent = () => Array.from(navigator.getGamepads?.() || []).some((p) => !!p && p.connected)

    function startLoop() {
      if (!active || looping) return
      looping = true
      noPadFrames = 0
      stopFallback()
      raf = requestAnimationFrame(loop)
    }

    function stopLoop() {
      looping = false
      cancelAnimationFrame(raf)
      if (active) startFallback()
    }

    function startFallback() {
      if (fallbackTimer) return
      fallbackTimer = window.setInterval(() => {
        if (!document.hidden && padPresent()) startLoop()
      }, 10_000)
    }

    function stopFallback() {
      if (!fallbackTimer) return
      clearInterval(fallbackTimer)
      fallbackTimer = 0
    }

    const onPadConnected = () => startLoop()
    const onPadDisconnected = () => { if (!padPresent()) stopLoop() }
    window.addEventListener('gamepadconnected', onPadConnected)
    window.addEventListener('gamepaddisconnected', onPadDisconnected)

    if (padPresent()) startLoop()
    else startFallback()

    const clearGamepadFlag = () => document.documentElement.removeAttribute('data-uc-gamepad')
    window.addEventListener('mousemove', clearGamepadFlag, { passive: true })
    window.addEventListener('mousedown', clearGamepadFlag, { passive: true })

    return () => {
      active = false
      cancelAnimationFrame(raf)
      stopFallback()
      window.removeEventListener('gamepadconnected', onPadConnected)
      window.removeEventListener('gamepaddisconnected', onPadDisconnected)
      window.removeEventListener('mousemove', clearGamepadFlag)
      window.removeEventListener('mousedown', clearGamepadFlag)
      document.documentElement.removeAttribute('data-uc-gamepad')
    }
  }, [enabled, deadzone])
}

function findScrollContainer(el: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = el
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node)
    const oy = style.overflowY
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 4) {
      return node
    }
    node = node.parentElement
  }
  const main = document.querySelector<HTMLElement>('main, [data-uc-scroll]')
  if (main && main.scrollHeight > main.clientHeight + 4) return main
  return document.scrollingElement as HTMLElement | null
}

export default useControllerNavigation
