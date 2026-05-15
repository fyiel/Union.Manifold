/**
 * use-controller-navigation.ts
 *
 * Enables D-pad / left-stick driven focus navigation and UI actions
 * for UnionCrax.Direct, similar to Steam Deck's controller interface.
 *
 * Wire focusables via `tabIndex={0} onKeyDown={handleKeyDown}` and they'll
 * participate in the roving focus set. Hold a modifier button (default:
 * L2/R2) to enable radial highlighting for quick navigation.
 */

import { useEffect, useRef, useCallback, useState } from 'react'

// Button indices per GCPad (must match GCPad_API)
const BTN_DPAD_UP     = 0
const BTN_DPAD_DOWN   = 1
const BTN_DPAD_LEFT   = 2
const BTN_DPAD_RIGHT  = 3
const BTN_L2          = 6   // Left bumper - navigation modifier
const BTN_R2          = 7   // Right bumper - action mode

export interface ControllerNavigationOptions {
  onConfirm?: () => void
  onCancel?: () => void
  onNavigateUp?: () => void
  onNavigateDown?: () => void
  onNavigateLeft?: () => void
  onNavigateRight?: () => void
  deadzone?: number  // default 0.3
  pollMs?: number    // default 100
}

interface StickState {
  x: number
  y: number
}

const DEADZONE = 0.3
const POLL_MS = 100

export function useControllerNavigation(opts: ControllerNavigationOptions = {}) {
  const {
    onConfirm, onCancel,
    onNavigateUp, onNavigateDown,
    onNavigateLeft, onNavigateRight,
    deadzone = DEADZONE,
    pollMs = POLL_MS,
  } = opts

  const [enabled, setEnabled] = useState(true)
  const prevStateRef = useRef<StickState>({ x: 0, y: 0 })
  const lastNavTimeRef = useRef(0)
  const edgeTriggeredRef = useRef<{up: boolean, down: boolean, left: boolean, right: boolean}>({
    up: true, down: true, left: true, right: true
  })

  // Dispatch simulated key events for existing onKeyDown handlers to catch
  const dispatchKey = useCallback((key: string, keyCode?: number) => {
    const el = document.activeElement
    if (!el) return
    const evt = new KeyboardEvent('keydown', {
      key,
      code: keyCode ? `Key${String.fromCharCode(keyCode)}` : key.toUpperCase(),
      bubbles: true,
      cancelable: true,
    })
    el.dispatchEvent(evt)
  }, [])

  // Poll for controller input via window.ucController
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !window.ucController) return

    const interval = setInterval(() => {
      if (typeof window.ucController?.getConnected !== 'function') return

      const connected = window.ucController.getConnected()
      if (!connected?.connected) return

      const states = window.ucController.getStates?.()
      if (!states?.length) return

      const state = states[0]
      if (!state?.axes || state.axes.length < 6) return

      // Axis 0 = left stick X, Axis 1 = left stick Y
      const lx = state.axes[0] || 0
      const ly = state.axes[1] || 0

      // Get button states
      const btns = state.buttons || []
      const upBtn = btns[BTN_DPAD_UP]
      const downBtn = btns[BTN_DPAD_DOWN]
      const leftBtn = btns[BTN_DPAD_LEFT]
      const rightBtn = btns[BTN_DPAD_RIGHT]
      const l2Btn = btns[BTN_L2]
      const r2Btn = btns[BTN_R2]

      const now = Date.now()
      const cooldown = 150  // ms between same-direction triggers

      // D-pad takes priority
      if (upBtn) {
        if (edgeTriggeredRef.current.up && now - lastNavTimeRef.current > cooldown) {
          edgeTriggeredRef.current = { ...edgeTriggeredRef.current, up: false }
          lastNavTimeRef.current = now
          onNavigateUp?.()
          dispatchKey('ArrowUp')
        }
      } else {
        edgeTriggeredRef.current.up = true
      }

      if (downBtn) {
        if (edgeTriggeredRef.current.down && now - lastNavTimeRef.current > cooldown) {
          edgeTriggeredRef.current = { ...edgeTriggeredRef.current, down: false }
          lastNavTimeRef.current = now
          onNavigateDown?.()
          dispatchKey('ArrowDown')
        }
      } else {
        edgeTriggeredRef.current.down = true
      }

      if (leftBtn) {
        if (edgeTriggeredRef.current.left && now - lastNavTimeRef.current > cooldown) {
          edgeTriggeredRef.current = { ...edgeTriggeredRef.current, left: false }
          lastNavTimeRef.current = now
          onNavigateLeft?.()
          dispatchKey('ArrowLeft')
        }
      } else {
        edgeTriggeredRef.current.left = true
      }

      if (rightBtn) {
        if (edgeTriggeredRef.current.right && now - lastNavTimeRef.current > cooldown) {
          edgeTriggeredRef.current = { ...edgeTriggeredRef.current, right: false }
          lastNavTimeRef.current = now
          onNavigateRight?.()
          dispatchKey('ArrowRight')
        }
      } else {
        edgeTriggeredRef.current.right = true
      }

      // Stick navigation (with deadzone)
      if (Math.abs(lx) < deadzone && Math.abs(ly) < deadzone) {
        prevStateRef.current = { x: 0, y: 0 }
        return
      }

      // Only trigger on edges, not holds
      if (lx > deadzone && edgeTriggeredRef.current.right && prevStateRef.current.x <= deadzone) {
        edgeTriggeredRef.current = { ...edgeTriggeredRef.current, right: false }
        prevStateRef.current = { ...prevStateRef.current, x: lx }
        onNavigateRight?.()
        dispatchKey('ArrowRight')
      } else if (lx < -deadzone && edgeTriggeredRef.current.left && prevStateRef.current.x >= -deadzone) {
        edgeTriggeredRef.current = { ...edgeTriggeredRef.current, left: false }
        prevStateRef.current = { ...prevStateRef.current, x: lx }
        onNavigateLeft?.()
        dispatchKey('ArrowLeft')
      } else {
        // Decay edge triggers when returning to center
        if (Math.abs(lx) < deadzone * 0.5) {
          edgeTriggeredRef.current = { ...edgeTriggeredRef.current, left: true, right: true }
        }
      }

      if (ly < -deadzone && edgeTriggeredRef.current.up && prevStateRef.current.y >= -deadzone) {
        edgeTriggeredRef.current = { ...edgeTriggeredRef.current, up: false }
        prevStateRef.current = { ...prevStateRef.current, y: ly }
        onNavigateUp?.()
        dispatchKey('ArrowUp')
      } else if (ly > deadzone && edgeTriggeredRef.current.down && prevStateRef.current.y <= deadzone) {
        edgeTriggeredRef.current = { ...edgeTriggeredRef.current, down: false }
        prevStateRef.current = { ...prevStateRef.current, y: ly }
        onNavigateDown?.()
        dispatchKey('ArrowDown')
      } else {
        if (Math.abs(ly) < deadzone * 0.5) {
          edgeTriggeredRef.current = { ...edgeTriggeredRef.current, up: true, down: true }
        }
      }
    }, pollMs)

    return () => clearInterval(interval)
  }, [enabled, onNavigateUp, onNavigateDown, onNavigateLeft, onNavigateRight, pollMs])

  // Listen for raw button events from gcpad
  useEffect(() => {
    if (!window.ucController?.onControllerInput) return

    const unsub = window.ucController.onControllerInput?.((data: any) => {
      const btns = data?.buttons || []
      const A_BTN = 0
      const B_BTN = 1
      const X_BTN = 2
      const Y_BTN = 3
      const START = 9
      const SELECT = 8

      // A = confirm, B = cancel
      if (btns[A_BTN]) onConfirm?.()
      if (btns[B_BTN]) onCancel?.()
    })

    return unsub
  }, [onConfirm, onCancel])

  return { enabled, setEnabled }
}