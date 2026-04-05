/**
 * Controller Support API Type Definitions
 *
 * x360ce-style: Translates unsupported controller inputs to Xbox 360 inputs
 * antimicrox-style: Remaps controller inputs to keyboard and mouse inputs
 */

import type { ControllerSettings, ControllerProfile, ControllerMapping } from '../lib/controller-mappings'

/** Raw per-axis motion vector from the controller IMU. */
export interface MotionVector {
  x: number
  y: number
  z: number
}

/** A single touchpad finger contact. */
export interface TouchPoint {
  active: boolean
  /** X coordinate, 0–1919 */
  x: number
  /** Y coordinate, 0–941 (DS4) / 0–1079 (DualSense) */
  y: number
}

/**
 * Raw controller state snapshot as delivered by gcpadGetStates().
 * buttons[17] is the touchpad click (GCPAD_BUTTON_TOUCHPAD).
 * gyro is in deg/s; accel is in m/s².
 */
export interface RawControllerState {
  slot: number
  connected: boolean
  name: string
  battery: number
  charging: boolean
  /** 18 digital buttons; index 17 = touchpad click */
  buttons: boolean[]
  /** 6 analog axes: [LX, LY, RX, RY, LT, RT] in –1..+1 (triggers 0..+1) */
  axes: number[]
  /** Gyroscope in degrees/second */
  gyro: MotionVector
  /** Accelerometer in m/s² */
  accel: MotionVector
  /** Up to 2 simultaneous touchpad contacts */
  touchpad: [TouchPoint, TouchPoint]
}

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
  onControllerInput: (callback: (data: RawControllerState) => void) => () => void
  
  // Overlay-specific
  getOverlaySettings: () => Promise<{ ok: boolean; settings?: { overlayEnabled: boolean; overlayHotkey: string; overlayPosition: 'left' | 'right' }; error?: string }>
  setOverlaySettings: (settings: { overlayEnabled?: boolean; overlayHotkey?: string; overlayPosition?: 'left' | 'right' }) => Promise<{ ok: boolean; error?: string }>
}

declare global {
  interface Window {
    ucController?: ControllerAPI
  }
}

export {}
