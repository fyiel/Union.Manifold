import type { ControllerSettings } from '../lib/controller-mappings'

export interface ControllerAPI {
  getSettings: () => Promise<{ ok: boolean; settings?: ControllerSettings; error?: string }>
  setSettings: (settings: Partial<ControllerSettings>) => Promise<{ ok: boolean; error?: string }>

  rumble: (slot: number, left: number, right: number) => Promise<{ ok: boolean; error?: string }>

  onControllerConnected: (callback: (data: { controllerId: string; controllerName: string; controllerType: string }) => void) => () => void
  onControllerDisconnected: (callback: () => void) => () => void
}

declare global {
  interface Window {
    ucController?: ControllerAPI
  }
}

export {}
