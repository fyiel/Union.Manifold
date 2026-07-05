/**
 * Controller Support API Type Definitions
 */

import type { ControllerSettings } from '../lib/controller-mappings'

export interface ControllerAPI {
  // Basic settings
  getSettings: () => Promise<{ ok: boolean; settings?: ControllerSettings; error?: string }>
  setSettings: (settings: Partial<ControllerSettings>) => Promise<{ ok: boolean; error?: string }>

  // Rumble / haptics — left & right motor intensities in 0..255
  rumble: (slot: number, left: number, right: number) => Promise<{ ok: boolean; error?: string }>

  // Connection events
  onControllerConnected: (callback: (data: { controllerId: string; controllerName: string; controllerType: string }) => void) => () => void
  onControllerDisconnected: (callback: () => void) => () => void
}

declare global {
  interface Window {
    ucController?: ControllerAPI
  }
}

export {}
