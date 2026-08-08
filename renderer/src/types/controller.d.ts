import type { ControllerSettings } from '../lib/controller-mappings'

export interface ControllerAPI {
  getSettings: () => Promise<{ ok: boolean; settings?: ControllerSettings; error?: string }>
  setSettings: (settings: Partial<ControllerSettings>) => Promise<{ ok: boolean; error?: string }>
}

declare global {
  interface Window {
    ucController?: ControllerAPI
  }
}

export {}
