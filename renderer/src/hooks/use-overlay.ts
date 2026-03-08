import { useState, useEffect, useCallback } from 'react'

interface OverlayStatus {
  enabled: boolean
  visible: boolean
  hotkey: string
  autoShow: boolean
  currentAppid: string | null
}

interface OverlaySettings {
  enabled: boolean
  hotkey: string
  autoShow: boolean
}

/**
 * Hook for managing the in-game overlay
 */
export function useOverlay() {
  const [status, setStatus] = useState<OverlayStatus>({
    enabled: true,
    visible: false,
    hotkey: 'Ctrl+Shift+Tab',
    autoShow: true,
    currentAppid: null
  })
  const [settings, setSettings] = useState<OverlaySettings>({
    enabled: true,
    hotkey: 'Ctrl+Shift+Tab',
    autoShow: true
  })
  const [isLoading, setIsLoading] = useState(true)

  // Initialize and listen for changes
  useEffect(() => {
    const overlay = window.ucOverlay
    if (!overlay) {
      setIsLoading(false)
      return
    }

    // Get initial status
    const initStatus = async () => {
      try {
        const statusResult = await overlay.getStatus()
        if (statusResult.ok) {
          setStatus({
            enabled: statusResult.enabled,
            visible: statusResult.visible,
            hotkey: statusResult.hotkey,
            autoShow: statusResult.autoShow,
            currentAppid: statusResult.currentAppid
          })
        }

        const settingsResult = await overlay.getSettings()
        if (settingsResult.ok) {
          setSettings({
            enabled: settingsResult.enabled,
            hotkey: settingsResult.hotkey,
            autoShow: settingsResult.autoShow
          })
        }
      } catch (error) {
        console.error('Failed to get overlay status:', error)
      } finally {
        setIsLoading(false)
      }
    }

    initStatus()

    // Listen for state changes
    const unsubShow = overlay.onShow((data) => {
      setStatus(prev => ({ ...prev, visible: true, currentAppid: data.appid }))
    })

    const unsubHide = overlay.onHide(() => {
      setStatus(prev => ({ ...prev, visible: false }))
    })

    const unsubStateChanged = overlay.onStateChanged((data) => {
      setStatus(prev => ({ 
        ...prev, 
        visible: data.visible, 
        currentAppid: data.appid 
      }))
    })

    return () => {
      unsubShow()
      unsubHide()
      unsubStateChanged()
    }
  }, [])

  const showOverlay = useCallback(async (appid?: string) => {
    if (!window.ucOverlay) return { ok: false, error: 'Overlay not available' }
    return await window.ucOverlay.show(appid)
  }, [])

  const hideOverlay = useCallback(async () => {
    if (!window.ucOverlay) return { ok: false, error: 'Overlay not available' }
    return await window.ucOverlay.hide()
  }, [])

  const toggleOverlay = useCallback(async (appid?: string) => {
    if (!window.ucOverlay) return { ok: false, error: 'Overlay not available' }
    return await window.ucOverlay.toggle(appid)
  }, [])

  const updateSettings = useCallback(async (newSettings: Partial<OverlaySettings>) => {
    if (!window.ucOverlay) return { ok: false, error: 'Overlay not available' }
    
    // Transform settings to match the expected format
    const transformedSettings: {
      overlayEnabled?: boolean
      overlayHotkey?: string
      overlayAutoShow?: boolean
    } = {}
    
    if (newSettings.enabled !== undefined) {
      transformedSettings.overlayEnabled = newSettings.enabled
    }
    if (newSettings.hotkey !== undefined) {
      transformedSettings.overlayHotkey = newSettings.hotkey
    }
    if (newSettings.autoShow !== undefined) {
      transformedSettings.overlayAutoShow = newSettings.autoShow
    }
    
    const result = await window.ucOverlay.setSettings(transformedSettings)
    if (result.ok) {
      setSettings(prev => ({ ...prev, ...newSettings }))
    }
    return result
  }, [])

  return {
    status,
    settings,
    isLoading,
    showOverlay,
    hideOverlay,
    toggleOverlay,
    updateSettings,
    isAvailable: !!window.ucOverlay
  }
}

export default useOverlay
