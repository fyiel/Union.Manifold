import { useState, useEffect, useCallback } from 'react'

export interface ControllerSettings {
  enabled: boolean
  controllerType: 'xbox' | 'playstation' | 'generic'
  vibrationEnabled: boolean
  deadzone: number
  triggerDeadzone: number
  buttonLayout: 'default' | 'legacy'
}

const DEFAULT_CONTROLLER_SETTINGS: ControllerSettings = {
  enabled: false,
  controllerType: 'generic',
  vibrationEnabled: true,
  deadzone: 0.15,
  triggerDeadzone: 0.1,
  buttonLayout: 'default'
}

export function useController() {
  const [settings, setSettings] = useState<ControllerSettings>(DEFAULT_CONTROLLER_SETTINGS)
  const [connected, setConnected] = useState(false)
  const [controllerInfo, setControllerInfo] = useState<{
    id: string | null
    name: string | null
    type: string | null
  }>({ id: null, name: null, type: null })
  const [loading, setLoading] = useState(true)

  // Load settings from main process
  useEffect(() => {
    async function loadSettings() {
      try {
        if (window.ucController?.getSettings) {
          const result = await window.ucController.getSettings()
          if (result?.ok && result.settings) {
            setSettings({ ...DEFAULT_CONTROLLER_SETTINGS, ...result.settings })
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
        await window.ucController.setSettings(updated)
      }
    } catch (err) {
      console.error('Failed to save controller settings:', err)
    }
  }, [settings])

  // Check for connected controllers
  const checkControllers = useCallback(async () => {
    try {
      if (window.ucController?.getConnected) {
        const result = await window.ucController.getConnected()
        setConnected(result.connected)
        setControllerInfo({
          id: result.controllerId,
          name: result.controllerName,
          type: result.controllerType
        })
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

  return {
    settings,
    connected,
    controllerInfo,
    loading,
    updateSettings,
    setEnabled,
    checkControllers
  }
}

export default useController
