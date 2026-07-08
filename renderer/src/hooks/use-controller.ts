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
  
  const connectionDebounceRef = useRef<{
    timeout: ReturnType<typeof setTimeout> | null
    pendingConnected: boolean
    pendingInfo: { id: string | null; name: string | null; type: string | null }
  }>({
    timeout: null,
    pendingConnected: false,
    pendingInfo: { id: null, name: null, type: null }
  })

  const updateConnectionState = useCallback((isConnected: boolean, info: { id: string | null; name: string | null; type: string | null }) => {
    const debounce = connectionDebounceRef.current
    
    if (debounce.timeout) {
      clearTimeout(debounce.timeout)
    }
    
    if (isConnected === connected && info.id === controllerInfo.id) {
      return
    }
    
    debounce.timeout = setTimeout(() => {
      setConnected(isConnected)
      setControllerInfo(info)
      debounce.timeout = null
    }, 750)
  }, [connected, controllerInfo.id])

  useEffect(() => {
    async function loadSettings() {
      try {
        if (window.ucController?.getSettings) {
          const result = await window.ucController.getSettings()
          if (result?.ok && result.settings) {
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

  const checkControllers = useCallback(async () => {
    try {
      let detected = false
      
      const selectedSlot = settings.controllerSlot
      
      if (!detected && typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
        const pads = Array.from(navigator.getGamepads() || []).filter((p): p is Gamepad => p !== null)
        
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

  useEffect(() => {
    checkControllers()
    window.addEventListener('gamepadconnected', checkControllers)
    window.addEventListener('gamepaddisconnected', checkControllers)
    return () => {
      window.removeEventListener('gamepadconnected', checkControllers)
      window.removeEventListener('gamepaddisconnected', checkControllers)
    }
  }, [checkControllers])

  useEffect(() => {
    if (!settings.enabled || connected) return
    const interval = setInterval(() => {
      if (document.hidden) return
      checkControllers()
    }, 12_000)
    return () => clearInterval(interval)
  }, [settings.enabled, connected, checkControllers])

  const setEnabled = useCallback(async (enabled: boolean) => {
    await updateSettings({ enabled })
  }, [updateSettings])

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
