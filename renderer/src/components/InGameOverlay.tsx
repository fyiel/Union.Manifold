import { useState, useEffect, useCallback } from 'react'

interface InGameOverlayProps {
  initialAppid?: string | null
}

/**
 * In-Game Overlay Component
 * 
 * A Steam-like overlay that appears over running games.
 * Press the configured hotkey (default: Shift+Tab) to toggle.
 */
export function InGameOverlay({ initialAppid }: InGameOverlayProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [currentAppid, setCurrentAppid] = useState<string | null>(initialAppid || null)
  const [overlaySettings, setOverlaySettings] = useState({
    enabled: true,
    hotkey: 'Ctrl+Shift+Tab',
    autoShow: true
  })

  // Listen for overlay state changes from main process
  useEffect(() => {
    if (!window.ucOverlay) return

    const unsubShow = window.ucOverlay.onShow((data) => {
      setIsVisible(true)
      setCurrentAppid(data.appid)
    })

    const unsubHide = window.ucOverlay.onHide(() => {
      setIsVisible(false)
    })

    const unsubStateChanged = window.ucOverlay.onStateChanged((data) => {
      setIsVisible(data.visible)
      setCurrentAppid(data.appid)
    })

    // Get initial status
    window.ucOverlay.getStatus().then(status => {
      if (status.ok) {
        setIsVisible(status.visible)
        setCurrentAppid(status.currentAppid)
      }
    })

    // Get initial settings
    window.ucOverlay.getSettings().then(settings => {
      if (settings.ok) {
        setOverlaySettings({
          enabled: settings.enabled,
          hotkey: settings.hotkey,
          autoShow: settings.autoShow
        })
      }
    })

    return () => {
      unsubShow()
      unsubHide()
      unsubStateChanged()
    }
  }, [])

  // Handle escape key to close overlay
  useEffect(() => {
    if (!isVisible) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        hideOverlay()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isVisible])

  const hideOverlay = useCallback(() => {
    if (window.ucOverlay) {
      window.ucOverlay.hide()
    }
  }, [])

  const toggleOverlay = useCallback(() => {
    if (window.ucOverlay) {
      window.ucOverlay.toggle(currentAppid || undefined)
    }
  }, [currentAppid])

  if (!isVisible) {
    return null
  }

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ 
        background: 'transparent',
      }}
      onClick={(e) => {
        // Close overlay when clicking outside the content
        if (e.target === e.currentTarget) {
          hideOverlay()
        }
      }}
    >
      {/* Semi-transparent backdrop */}
      <div className="absolute inset-0 bg-black/60" />
      
      {/* Overlay Content */}
      <div className="relative z-10 w-[600px] max-h-[80vh] bg-[#1a1a1a] rounded-lg shadow-2xl border border-[#333] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#252525] border-b border-[#333]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-blue-500 rounded-md flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h2 className="text-white font-semibold text-lg">UnionCrax.Direct</h2>
              <p className="text-gray-400 text-xs">In-Game Overlay</p>
            </div>
          </div>
          <button
            onClick={hideOverlay}
            className="p-1 rounded hover:bg-[#333] text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Status Info */}
          <div className="bg-[#2a2a2a] rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-gray-300">Overlay Active</span>
              </div>
              <span className="text-gray-500 text-sm">
                Press {overlaySettings.hotkey} to toggle
              </span>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => {
                // Open UnionCrax website
                window.open('https://union-crax.xyz', '_blank')
              }}
              className="flex items-center gap-3 p-3 bg-[#2a2a2a] hover:bg-[#333] rounded-lg transition-colors group"
            >
              <div className="w-10 h-10 bg-[#3a3a3a] rounded-lg flex items-center justify-center group-hover:bg-[#4a4a4a] transition-colors">
                <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
              </div>
              <div className="text-left">
                <div className="text-white font-medium">Browse Store</div>
                <div className="text-gray-500 text-xs">Visit union-crax.xyz</div>
              </div>
            </button>

            <button
              onClick={() => {
                // Hide overlay and minimize to tray
                hideOverlay()
              }}
              className="flex items-center gap-3 p-3 bg-[#2a2a2a] hover:bg-[#333] rounded-lg transition-colors group"
            >
              <div className="w-10 h-10 bg-[#3a3a3a] rounded-lg flex items-center justify-center group-hover:bg-[#4a4a4a] transition-colors">
                <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                </svg>
              </div>
              <div className="text-left">
                <div className="text-white font-medium">Return to Game</div>
                <div className="text-gray-500 text-xs">Hide overlay</div>
              </div>
            </button>

            <button
              onClick={() => {
                // Close the game
                if (currentAppid && window.ucDownloads) {
                  window.ucDownloads.quitGameExecutable(currentAppid)
                }
                hideOverlay()
              }}
              className="flex items-center gap-3 p-3 bg-[#2a2a2a] hover:bg-[#333] rounded-lg transition-colors group"
            >
              <div className="w-10 h-10 bg-[#3a3a3a] rounded-lg flex items-center justify-center group-hover:bg-[#4a4a4a] transition-colors">
                <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <div className="text-left">
                <div className="text-white font-medium">Quit Game</div>
                <div className="text-gray-500 text-xs">Exit currently running game</div>
              </div>
            </button>

            <button
              onClick={() => {
                // Show main window
                hideOverlay()
              }}
              className="flex items-center gap-3 p-3 bg-[#2a2a2a] hover:bg-[#333] rounded-lg transition-colors group"
            >
              <div className="w-10 h-10 bg-[#3a3a3a] rounded-lg flex items-center justify-center group-hover:bg-[#4a4a4a] transition-colors">
                <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="text-left">
                <div className="text-white font-medium">Open Launcher</div>
                <div className="text-gray-500 text-xs">Show main window</div>
              </div>
            </button>
          </div>

          {/* Keyboard Shortcuts */}
          <div className="bg-[#2a2a2a] rounded-lg p-4">
            <h3 className="text-gray-400 text-sm font-medium mb-3">Keyboard Shortcuts</h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Toggle Overlay</span>
                <kbd className="px-2 py-1 bg-[#3a3a3a] rounded text-gray-300 text-xs">{overlaySettings.hotkey}</kbd>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Close Overlay</span>
                <kbd className="px-2 py-1 bg-[#3a3a3a] rounded text-gray-300 text-xs">Esc</kbd>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-[#252525] border-t border-[#333] text-center">
          <p className="text-gray-500 text-xs">
            UnionCrax.Direct In-Game Overlay
          </p>
        </div>
      </div>
    </div>
  )
}

export default InGameOverlay
