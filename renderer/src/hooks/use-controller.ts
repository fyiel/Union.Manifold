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

  // Check for connected controllers
  const checkControllers = useCallback(async () => {
    try {
      let detected = false
      if (window.ucController?.getConnected) {
        const result = await window.ucController.getConnected()
        if (result.connected) {
          detected = true
          setConnected(true)
          setControllerInfo({
            id: result.controllerId ?? null,
            name: result.controllerName ?? null,
            type: result.controllerType ?? null
          })
        }
      }

      if (!detected && typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
        const pads = Array.from(navigator.getGamepads?.() || []).filter(Boolean)
        const firstPad = pads[0]
        if (firstPad) {
          detected = true
          setConnected(true)
          setControllerInfo({
            id: String(firstPad.index),
            name: firstPad.id || 'Gamepad connected',
            type: detectControllerType(firstPad.id || 'generic')
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
  }, [])

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

  // Input translation (x360ce-style) methods
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

  // Key binding (antimicrox-style) methods
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
