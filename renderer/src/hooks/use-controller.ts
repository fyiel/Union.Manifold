import { useState, useEffect, useCallback } from 'react'
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
  const [profiles, setProfiles] = useState<ControllerProfile[]>([])
  const [activeProfile, setActiveProfile] = useState<ControllerProfile | null>(null)

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
        // Load profiles
        if (window.ucController?.getProfiles) {
          const profilesResult = await (window.ucController as ControllerAPI).getProfiles()
          if (profilesResult?.ok && profilesResult.profiles) {
            setProfiles(profilesResult.profiles)
          }
        }
        // Load active profile
        if (window.ucController?.getActiveProfile) {
          const activeResult = await (window.ucController as ControllerAPI).getActiveProfile()
          if (activeResult?.ok && activeResult.profile) {
            setActiveProfile(activeResult.profile)
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

  // Get available controllers
  const getAvailableControllers = useCallback(async () => {
    try {
      if (window.ucController?.getAvailableControllers) {
        const result = await (window.ucController as ControllerAPI).getAvailableControllers()
        if (result?.ok && result.controllers) {
          return result.controllers
        }
      }
      // Fallback to browser gamepad API
      if (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
        const pads = Array.from(navigator.getGamepads() || []).filter((p): p is Gamepad => p !== null)
        return pads.map(pad => ({
          index: pad.index,
          id: pad.id || 'Unknown',
          name: pad.id || 'Unknown Gamepad'
        }))
      }
      return []
    } catch (err) {
      console.error('Failed to get available controllers:', err)
      return []
    }
  }, [])

  // Set controller slot
  const setControllerSlot = useCallback(async (slot: number | null) => {
    try {
      if (window.ucController?.setControllerSlot) {
        await (window.ucController as ControllerAPI).setControllerSlot(slot)
      }
      // Update local settings
      await updateSettings({ controllerSlot: slot })
    } catch (err) {
      console.error('Failed to set controller slot:', err)
    }
  }, [updateSettings])

  // Check for connected controllers
  const checkControllers = useCallback(async () => {
    try {
      let detected = false
      
      // Check if user has selected a specific slot
      const selectedSlot = settings.controllerSlot
      
      if (window.ucController?.getConnected) {
        const result = await window.ucController.getConnected()
        if (result.connected) {
          const controllerIndex = result.controllerId ? parseInt(result.controllerId, 10) : null
          
          // If user selected a slot, check if it matches
          if (selectedSlot !== null && controllerIndex !== selectedSlot) {
            // User selected a different slot, try to connect to that one
            setConnected(false)
            setControllerInfo({ id: null, name: null, type: null })
          } else {
            detected = true
            setConnected(true)
            setControllerInfo({
              id: result.controllerId ?? null,
              name: result.controllerName ?? null,
              type: result.controllerType ?? null
            })
          }
        }
      }

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
          setConnected(true)
          setControllerInfo({
            id: String(targetPad.index),
            name: targetPad.id || 'Gamepad connected',
            type: detectControllerType({ id: targetPad.id || 'generic', axes: [], buttons: [] })
          })
        }
      }

      if (!detected) {
        setConnected(false)
        setControllerInfo({ id: null, name: null, type: null })
      }
    } catch (err) {
      console.error('Failed to check controllers:', err)
      setConnected(false)
    }
  }, [settings.controllerSlot])

  // Poll for controller connections
  useEffect(() => {
    checkControllers()
    const interval = setInterval(checkControllers, 5000)
    return () => clearInterval(interval)
  }, [checkControllers])

  // Enable/disable controller support
  const setEnabled = useCallback(async (enabled: boolean) => {
    await updateSettings({ enabled })
  }, [updateSettings])

  // Input translation methods
  const getMappingPresets = useCallback(async () => {
    try {
      if (window.ucController?.getMappingPresets) {
        return await (window.ucController as ControllerAPI).getMappingPresets()
      }
      return { ok: false }
    } catch (err) {
      console.error('Failed to get mapping presets:', err)
      return { ok: false, presets: [] }
    }
  }, [])

  const setActiveMapping = useCallback(async (preset: string, customMapping?: ControllerMapping) => {
    try {
      if (window.ucController?.setActiveMapping) {
        await (window.ucController as ControllerAPI).setActiveMapping(preset, customMapping)
        // Refresh settings after change
        const result = await window.ucController.getSettings()
        if (result?.ok && result.settings) {
          setSettings({ ...createDefaultControllerSettings(), ...result.settings })
        }
      }
    } catch (err) {
      console.error('Failed to set active mapping:', err)
    }
  }, [])

  // Key binding methods
  const getActiveProfile = useCallback(async () => {
    try {
      if (window.ucController?.getActiveProfile) {
        const result = await (window.ucController as ControllerAPI).getActiveProfile()
        if (result?.ok && result.profile) {
          setActiveProfile(result.profile)
          return result.profile
        }
      }
      return null
    } catch (err) {
      console.error('Failed to get active profile:', err)
      return null
    }
  }, [])

  const setActiveProfileById = useCallback(async (profileId: string) => {
    try {
      if (window.ucController?.setActiveProfile) {
        await (window.ucController as ControllerAPI).setActiveProfile(profileId)
        await getActiveProfile()
      }
    } catch (err) {
      console.error('Failed to set active profile:', err)
    }
  }, [getActiveProfile])

  const createProfile = useCallback(async (profile: Partial<ControllerProfile>) => {
    try {
      if (window.ucController?.createProfile) {
        const result = await (window.ucController as ControllerAPI).createProfile(profile)
        if (result?.ok) {
          // Refresh profiles
          const profilesResult = await (window.ucController as ControllerAPI).getProfiles()
          if (profilesResult?.ok && profilesResult.profiles) {
            setProfiles(profilesResult.profiles)
          }
        }
        return result
      }
      return { ok: false }
    } catch (err) {
      console.error('Failed to create profile:', err)
      return { ok: false }
    }
  }, [])

  const updateProfile = useCallback(async (profile: ControllerProfile) => {
    try {
      if (window.ucController?.updateProfile) {
        const result = await (window.ucController as ControllerAPI).updateProfile(profile)
        if (result?.ok) {
          // Refresh profiles
          const profilesResult = await (window.ucController as ControllerAPI).getProfiles()
          if (profilesResult?.ok && profilesResult.profiles) {
            setProfiles(profilesResult.profiles)
          }
          // Refresh active profile if it was updated
          if (activeProfile?.id === profile.id) {
            await getActiveProfile()
          }
        }
        return result
      }
      return { ok: false }
    } catch (err) {
      console.error('Failed to update profile:', err)
      return { ok: false }
    }
  }, [activeProfile, getActiveProfile])

  const deleteProfile = useCallback(async (profileId: string) => {
    try {
      if (window.ucController?.deleteProfile) {
        const result = await (window.ucController as ControllerAPI).deleteProfile(profileId)
        if (result?.ok) {
          // Refresh profiles
          const profilesResult = await (window.ucController as ControllerAPI).getProfiles()
          if (profilesResult?.ok && profilesResult.profiles) {
            setProfiles(profilesResult.profiles)
          }
        }
        return result
      }
      return { ok: false }
    } catch (err) {
      console.error('Failed to delete profile:', err)
      return { ok: false }
    }
  }, [])

  // Controller event listeners
  useEffect(() => {
    if (!window.ucController) return

    const unsubConnected = (window.ucController as ControllerAPI).onControllerConnected?.((data) => {
      setConnected(true)
      setControllerInfo({
        id: data.controllerId ?? null,
        name: data.controllerName ?? null,
        type: data.controllerType ?? null
      })
    })

    const unsubDisconnected = (window.ucController as ControllerAPI).onControllerDisconnected?.(() => {
      setConnected(false)
      setControllerInfo({ id: null, name: null, type: null })
    })

    return () => {
      unsubConnected?.()
      unsubDisconnected?.()
    }
  }, [])

  return {
    settings,
    connected,
    controllerInfo,
    loading,
    profiles,
    activeProfile,
    updateSettings,
    setEnabled,
    checkControllers,
    getAvailableControllers,
    setControllerSlot,
    // Input translation
    getMappingPresets,
    setActiveMapping,
    // Key binding
    getActiveProfile,
    setActiveProfile: setActiveProfileById,
    createProfile,
    updateProfile,
    deleteProfile,
  }
}

export default useController
