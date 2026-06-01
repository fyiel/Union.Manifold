/**
 * Controller haptics — "the motor things that vibrate".
 *
 * Gives the UI tactile feedback when navigating or activating things with a
 * gamepad. Two delivery paths, tried in order:
 *
 *   1. The W3C Gamepad API `vibrationActuator` (Chromium/Electron). This is
 *      the cross-platform path and works for any gamepad the browser sees.
 *   2. The native GCPad bridge (`window.ucController.rumble`) which drives the
 *      real motors through gcpad.dll. Used as a fallback for pads that expose
 *      rumble through GCPad but not through the Gamepad API.
 *
 * Everything is best-effort: if no actuator is available the calls are no-ops.
 * A module-level enable flag (kept in sync with the user's "Vibration" setting)
 * lets the rest of the app fire haptics without threading the setting through
 * every component.
 */

export type HapticPattern =
  | 'nav'      // moving focus between elements — tiny tick
  | 'select'   // confirming / activating (A button) — firm bump
  | 'back'     // cancel / go back (B button) — soft double-ish bump
  | 'toggle'   // switches, checkboxes
  | 'error'    // blocked action / nothing to do — longer buzz
  | 'boundary' // hit the edge of the layout, no move possible

interface RumbleSpec {
  duration: number       // ms
  strong: number         // 0..1 (low-frequency / left motor)
  weak: number           // 0..1 (high-frequency / right motor)
}

const PATTERNS: Record<HapticPattern, RumbleSpec> = {
  nav:      { duration: 18,  strong: 0.0,  weak: 0.35 },
  select:   { duration: 45,  strong: 0.45, weak: 0.55 },
  back:     { duration: 30,  strong: 0.25, weak: 0.30 },
  toggle:   { duration: 28,  strong: 0.20, weak: 0.45 },
  error:    { duration: 130, strong: 0.65, weak: 0.20 },
  boundary: { duration: 14,  strong: 0.30, weak: 0.0  },
}

let enabled = true
let intensity = 1.0
let lastFireAt = 0

/** Keep the haptics engine in sync with the user's "Vibration" preference. */
export function setHapticsEnabled(value: boolean) {
  enabled = value
}

/** Global multiplier (0..1) applied to every effect. */
export function setHapticsIntensity(value: number) {
  intensity = Math.max(0, Math.min(1, value))
}

export function getHapticsEnabled() {
  return enabled
}

type GamepadWithActuator = Gamepad & {
  vibrationActuator?: {
    playEffect?: (type: string, params: Record<string, number>) => Promise<unknown>
    reset?: () => Promise<unknown>
  }
  // Older Chromium exposed an array of actuators with a pulse() method.
  hapticActuators?: Array<{ pulse?: (value: number, duration: number) => Promise<unknown> }>
}

function firstActiveGamepad(): GamepadWithActuator | null {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
    return null
  }
  const pads = navigator.getGamepads()
  if (!pads) return null
  for (const pad of pads) {
    if (pad && pad.connected) return pad as GamepadWithActuator
  }
  return null
}

/**
 * Fire a named haptic effect. Safe to call from anywhere — throttled so a
 * stream of rapid navigation events can't saturate the actuator queue (which
 * on some drivers causes the motor to "stick" on).
 */
export function playHaptic(pattern: HapticPattern, padIndex?: number) {
  if (!enabled) return

  const spec = PATTERNS[pattern]
  // Throttle: never more than one effect per ~30ms. Navigation ticks are the
  // hot path and queueing them up makes the rumble feel mushy.
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now())
  if (pattern === 'nav' && now - lastFireAt < 30) return
  lastFireAt = now

  const strong = spec.strong * intensity
  const weak = spec.weak * intensity

  // Path 1 — Gamepad API actuator.
  let pad: GamepadWithActuator | null = null
  if (typeof padIndex === 'number') {
    const pads = navigator.getGamepads?.()
    pad = (pads && (pads[padIndex] as GamepadWithActuator)) || null
  }
  if (!pad) pad = firstActiveGamepad()

  let delivered = false
  if (pad?.vibrationActuator?.playEffect) {
    pad.vibrationActuator
      .playEffect('dual-rumble', {
        startDelay: 0,
        duration: spec.duration,
        strongMagnitude: strong,
        weakMagnitude: weak,
      })
      .catch(() => {})
    delivered = true
  } else if (pad?.hapticActuators?.[0]?.pulse) {
    pad.hapticActuators[0].pulse(Math.max(strong, weak), spec.duration).catch(() => {})
    delivered = true
  }

  // Path 2 — native GCPad rumble (real motor control through gcpad.dll). Fire
  // alongside the Gamepad API only when the API couldn't deliver, to avoid
  // double-buzzing the same physical motor.
  if (!delivered) {
    const rumble = (window as unknown as { ucController?: { rumble?: (slot: number, l: number, r: number) => unknown } })
      .ucController?.rumble
    if (typeof rumble === 'function') {
      const slot = typeof padIndex === 'number' ? padIndex : (pad?.index ?? 0)
      try {
        rumble(slot, Math.round(strong * 255), Math.round(weak * 255))
        // Stop the motor after the effect window so it doesn't run forever.
        window.setTimeout(() => { try { rumble(slot, 0, 0) } catch {} }, spec.duration)
      } catch {}
    }
  }
}

/** Immediately stop any ongoing rumble on the active pad. */
export function stopHaptics(padIndex?: number) {
  const pad = typeof padIndex === 'number'
    ? (navigator.getGamepads?.()?.[padIndex] as GamepadWithActuator | null)
    : firstActiveGamepad()
  pad?.vibrationActuator?.reset?.().catch(() => {})
  const rumble = (window as unknown as { ucController?: { rumble?: (slot: number, l: number, r: number) => unknown } })
    .ucController?.rumble
  if (typeof rumble === 'function') {
    try { rumble(pad?.index ?? padIndex ?? 0, 0, 0) } catch {}
  }
}
