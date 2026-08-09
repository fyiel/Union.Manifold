import { useState, useEffect, useCallback } from 'react'
import { createDefaultControllerSettings, type ControllerSettings } from '../lib/controller-mappings'

export function useController() {
  const [settings, setSettings] = useState<ControllerSettings>(createDefaultControllerSettings())
  const [loading, setLoading] = useState(true)

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
        await window.ucController?.setSettings(updated)
      }
    } catch (err) {
      console.error('Failed to save controller settings:', err)
    }
  }, [settings])

  return {
    settings,
    loading,
    updateSettings,
  }
}

export default useController
