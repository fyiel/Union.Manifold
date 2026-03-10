/**
 * Controller Support API Type Definitions
 * 
 * x360ce-style: Translates unsupported controller inputs to Xbox 360 inputs
 * antim Remaps controller inputs to keyboard and mouseicrox-style: inputs
 */

import type { ControllerSettings, ControllerProfile, ControllerMapping } from '../lib/controller-mappings'

export interface ControllerAPI {
  // Basic settings
  getSettings: () => Promise<{ ok: boolean; settings?: ControllerSettings; error?: string }>
  setSettings: (settings: Partial<ControllerSettings>) => Promise<{ ok: boolean; error?: string }>
  getConnected: () => Promise<{ ok: boolean; connected: boolean; controllerId?: string; controllerName?: string; controllerType?: string; error?: string }>
  
  // Input translation (x360ce-style)
  getMappingPresets: () => Promise<{ ok: boolean; presets?: ControllerMapping[]; error?: string }>
  getActiveMapping: () => Promise<{ ok: boolean; mapping?: ControllerMapping; error?: string }>
  setActiveMapping: (preset: string, customMapping?: ControllerMapping) => Promise<{ ok: boolean; error?: string }>
  
  // Key binding (antimicrox-style)
  getProfiles: () => Promise<{ ok: boolean; profiles?: ControllerProfile[]; error?: string }>
  getActiveProfile: () => Promise<{ ok: boolean; profile?: ControllerProfile; error?: string }>
  setActiveProfile: (profileId: string) => Promise<{ ok: boolean; error?: string }>
  createProfile: (profile: Partial<ControllerProfile>) => Promise<{ ok: boolean; profile?: ControllerProfile; error?: string }>
  updateProfile: (profile: ControllerProfile) => Promise<{ ok: boolean; error?: string }>
  deleteProfile: (profileId: string) => Promise<{ ok: boolean; error?: string }>
  
  // Input events
  onControllerConnected: (callback: (data: { controllerId: string; controllerName: string; controllerType: string }) => void) => () => void
  onControllerDisconnected: (callback: () => void) => () => void
  onControllerInput: (callback: (data: unknown) => void) => () => void
  
  // Overlay-specific
  getOverlaySettings: () => Promise<{ ok: boolean; settings?: { enabled: boolean; hotkey: string; position: string }; error?: string }>
  setOverlaySettings: (settings: { enabled?: boolean; hotkey?: string; position?: string }) => Promise<{ ok: boolean; error?: string }>
}

declare global {
  interface Window {
    ucController?: ControllerAPI
  }
}

export {}
