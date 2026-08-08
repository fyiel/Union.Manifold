export type HapticPattern =
  | 'nav'
  | 'select'
  | 'back'
  | 'toggle'
  | 'error'
  | 'boundary'

interface RumbleSpec {
  duration: number
  strong: number
  weak: number
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

export function setHapticsEnabled(value: boolean) {
  enabled = value
}

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

export function playHaptic(pattern: HapticPattern, padIndex?: number) {
  if (!enabled) return

  const spec = PATTERNS[pattern]
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now())
  if (pattern === 'nav' && now - lastFireAt < 30) return
  lastFireAt = now

  const strong = spec.strong * intensity
  const weak = spec.weak * intensity

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

}

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
