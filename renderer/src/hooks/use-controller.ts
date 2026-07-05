import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ControllerSettings,
  ControllerProfile,
  ControllerMapping,
  KeyBinding,
  createDefaultControllerSettings,
  detectControllerType,
} from '../lib/controller-mappings'
import type { ControllerAPI } from '../types/controller.d'

export type { ControllerSettings, ControllerProfile, ControllerMapping, KeyBinding }

export function useController() {
  const [settings, setSettings] = useState<ControllerSettings>(createDefaultControllerSettings())
  const [connected, setConnected] = useState(false)
  const [controllerInfo, setControllerInfo] = useState<{
    id: string | null
    name: string | null
    type: string | null
  }>({ id: null, name: null, type: null })
  const [loading, setLoading] = useState(true)
  
  // Debounce ref to prevent rapid connect/disconnect due to USB enumeration issues
  const connectionDebounceRef = useRef<{
    timeout: ReturnType<typeof setTimeout> | null
    pendingConnected: boolean
    pendingInfo: { id: string | null; name: string | null; type: string | null }
  }>({
    timeout: null,
    pendingConnected: false,
    pendingInfo: { id: null, name: null, type: null }
  })

  // Debounced update for connection state
  const updateConnectionState = useCallback((isConnected: boolean, info: { id: string | null; name: string | null; type: string | null }) => {
    const debounce = connectionDebounceRef.current
    
    // Clear any pending timeout
    if (debounce.timeout) {
      clearTimeout(debounce.timeout)
    }
    
    // If already in the same state, do nothing
    if (isConnected === connected && info.id === controllerInfo.id) {
      return
    }
    
    // Debounce for 750ms to handle USB controller enumeration flakiness
    debounce.timeout = setTimeout(() => {
      setConnected(isConnected)
      setControllerInfo(info)
      debounce.timeout = null
    }, 750)
  }, [connected, controllerInfo.id])

  // Load settings from main process
  useEffect(() => {
    async function loadSettings() {
      try {
        if (window.ucController?.getSettings) {
          const result = await window.ucController.getSettings()
          if (result?.ok && result.settings) {
            // Merge with defaults to ensure all properties are present
            setSettings({ ...createDefaultControllerSettings(), ...result.settings })
          }
        }
      } catch (err) {
        console.error('Failed to load controller settings:', err)
      } finally {
        setLoading(false)
      }
    }
    loadSettings()
  }, [])

  // Update settings
  const updateSettings = useCallback(async (newSettings: Partial<ControllerSettings>) => {
    const updated = { ...settings, ...newSettings }
    setSettings(updated)
    
    try {
      if (window.ucController?.setSettings) {
        await (window.ucController as ControllerAPI).setSettings(updated)
      }
    } catch (err) {
      console.error('Failed to save controller settings:', err)
    }
  }, [settings])

  // Check for connected controllers
  const checkControllers = useCallback(async () => {
    try {
      let detected = false
      
      // Check if user has selected a specific slot
      const selectedSlot = settings.controllerSlot
      
      // If no backend controller or using browser gamepad API
      if (!detected && typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
        const pads = Array.from(navigator.getGamepads() || []).filter((p): p is Gamepad => p !== null)
        
        // Find controller at the selected slot (or first available if no selection)
        let targetPad: Gamepad | null = null
        if (selectedSlot !== null) {
          targetPad = pads.find(pad => pad.index === selectedSlot) ?? null
        }
        if (!targetPad && pads.length > 0) {
          targetPad = pads[0] ?? null
        }
        
        if (targetPad) {
          detected = true
          updateConnectionState(true, {
            id: String(targetPad.index),
            name: targetPad.id || 'Gamepad connected',
            type: detectControllerType({ id: targetPad.id || 'generic', axes: [], buttons: [] })
          })
        }
      }

      if (!detected) {
        updateConnectionState(false, { id: null, name: null, type: null })
      }
    } catch (err) {
      console.error('Failed to check controllers:', err)
      updateConnectionState(false, { id: null, name: null, type: null })
    }
  }, [settings.controllerSlot, updateConnectionState])

  // Detect controllers from connect/disconnect events plus one initial check
  // (a pad plugged in before mount may already be visible without any event).
  useEffect(() => {
    checkControllers()
    window.addEventListener('gamepadconnected', checkControllers)
    window.addEventListener('gamepaddisconnected', checkControllers)
    return () => {
      window.removeEventListener('gamepadconnected', checkControllers)
      window.removeEventListener('gamepaddisconnected', checkControllers)
    }
  }, [checkControllers])

  // Some webviews only surface a pad in getGamepads() (and fire the connect
  // event) after a button press, so keep a slow safety-net poll — but only
  // while the feature is enabled and no pad is known, and never while hidden.
  useEffect(() => {
    if (!settings.enabled || connected) return
    const interval = setInterval(() => {
      if (document.hidden) return
      checkControllers()
    }, 12_000)
    return () => clearInterval(interval)
  }, [settings.enabled, connected, checkControllers])

  // Enable/disable controller support
  const setEnabled = useCallback(async (enabled: boolean) => {
    await updateSettings({ enabled })
  }, [updateSettings])

  // Controller event listeners
  useEffect(() => {
    if (!window.ucController) return

    const unsubConnected = (window.ucController as ControllerAPI).onControllerConnected?.((data) => {
      updateConnectionState(true, {
        id: data.controllerId ?? null,
        name: data.controllerName ?? null,
        type: data.controllerType ?? null
      })
    })

    const unsubDisconnected = (window.ucController as ControllerAPI).onControllerDisconnected?.(() => {
      updateConnectionState(false, { id: null, name: null, type: null })
    })

    return () => {
      unsubConnected?.()
      unsubDisconnected?.()
    }
  }, [updateConnectionState])

  // Clear any pending connection-debounce timeout on unmount so a late fire
  // can't setState after teardown.
  useEffect(() => () => {
    clearTimeout(connectionDebounceRef.current.timeout ?? undefined)
  }, [])

  return {
    settings,
    connected,
    controllerInfo,
    loading,
    updateSettings,
    setEnabled,
    checkControllers,
  }
}

export default useController
