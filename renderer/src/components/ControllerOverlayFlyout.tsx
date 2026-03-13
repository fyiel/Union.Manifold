import { useState, useEffect, useCallback } from 'react'
import { useController, ControllerProfile } from '../hooks/use-controller'
import { Switch } from './ui/switch'
import { 
  Gamepad2, X, ChevronDown, ChevronUp, Save, RefreshCw,
  Keyboard, Mouse, Settings, Monitor, Volume2
} from 'lucide-react'

interface ControllerOverlayFlyoutProps {
  visible: boolean
  onClose: () => void
  position?: 'left' | 'right'
}

export function ControllerOverlayFlyout({ visible, onClose, position = 'right' }: ControllerOverlayFlyoutProps) {
  const { 
    settings, 
    connected, 
    controllerInfo,
    activeProfile,
    updateProfile,
    setActiveProfile,
    profiles,
    checkControllers
  } = useController()

  const [expanded, setExpanded] = useState(true)
  const [activeTab, setActiveTab] = useState<'mapping' | 'mouse' | 'quick'>('quick')
  const [localDeadzone, setLocalDeadzone] = useState(settings.deadzone)
  const [localVibration, setLocalVibration] = useState(settings.vibrationEnabled)

  useEffect(() => {
    if (settings) {
      setLocalDeadzone(settings.deadzone)
      setLocalVibration(settings.vibrationEnabled)
    }
  }, [settings])

  // Close on Escape
  useEffect(() => {
    if (!visible) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [visible, onClose])

  // Poll for controller connection
  useEffect(() => {
    if (!visible) return
    checkControllers()
    const interval = setInterval(checkControllers, 3000)
    return () => clearInterval(interval)
  }, [visible, checkControllers])

  const handleDeadzoneChange = useCallback((value: number[]) => {
    setLocalDeadzone(value[0])
  }, [])

  const handleDeadzoneCommit = useCallback(() => {
    if (activeProfile) {
      const updated = { ...activeProfile, deadzone: localDeadzone }
      updateProfile(updated)
    }
  }, [activeProfile, localDeadzone, updateProfile])

  const handleVibrationToggle = useCallback((enabled: boolean) => {
    setLocalVibration(enabled)
    if (activeProfile) {
      const updated = { ...activeProfile, vibrationEnabled: enabled }
      updateProfile(updated)
    }
  }, [activeProfile, updateProfile])

  const handleStickToMouseToggle = useCallback((stick: 'left' | 'right', enabled: boolean) => {
    if (!activeProfile) return
    const updated: ControllerProfile = {
      ...activeProfile,
      keyBinding: {
        ...activeProfile.keyBinding,
        stickToMouse: {
          leftStick: stick === 'left' ? enabled : (activeProfile.keyBinding?.stickToMouse?.leftStick ?? false),
          rightStick: stick === 'right' ? enabled : (activeProfile.keyBinding?.stickToMouse?.rightStick ?? false),
          mouseSpeed: activeProfile.keyBinding?.stickToMouse?.mouseSpeed ?? 1.0,
          mouseAcceleration: activeProfile.keyBinding?.stickToMouse?.mouseAcceleration ?? false,
        }
      }
    }
    updateProfile(updated)
  }, [activeProfile, updateProfile])

  const handleMouseSpeedChange = useCallback((value: number[]) => {
    if (!activeProfile) return
    const updated: ControllerProfile = {
      ...activeProfile,
      keyBinding: {
        ...activeProfile.keyBinding,
        stickToMouse: {
          leftStick: activeProfile.keyBinding?.stickToMouse?.leftStick ?? false,
          rightStick: activeProfile.keyBinding?.stickToMouse?.rightStick ?? false,
          mouseSpeed: value[0],
          mouseAcceleration: activeProfile.keyBinding?.stickToMouse?.mouseAcceleration ?? false,
        }
      }
    }
    updateProfile(updated)
  }, [activeProfile, updateProfile])

  if (!visible) return null

  const isLeft = position === 'left'

  return (
    <div
      style={{
        position: 'fixed',
        top: 20,
        [isLeft ? 'left' : 'right']: 20,
        width: 320,
        zIndex: 10000,
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(-10px)',
        transition: 'opacity 0.2s ease, transform 0.2s ease',
        pointerEvents: visible ? 'auto' : 'none',
      }}
      onClick={e => e.stopPropagation()}
    >
      <div
        style={{
          background: 'rgba(9, 9, 11, 0.88)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 28,
          boxShadow: '0 28px 80px rgba(0,0,0,0.6)',
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div 
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 10, 
            padding: '12px 16px', 
            borderBottom: expanded ? '1px solid rgba(255,255,255,0.07)' : 'none',
            cursor: 'pointer',
          }}
          onClick={() => setExpanded(!expanded)}
        >
          <div style={{ width: 28, height: 28, borderRadius: 8, background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Gamepad2 size={14} color="#09090b" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(161,161,170,1)', lineHeight: 1, letterSpacing: '0.18em', textTransform: 'uppercase' }}>Controller</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'white', lineHeight: 1.1, marginTop: 4, letterSpacing: '-0.02em' }}>Input Console</div>
            <div style={{ fontSize: 10, color: connected ? 'rgba(34,197,94,0.8)' : 'rgba(255,255,255,0.35)', marginTop: 2, lineHeight: 1 }}>
              {connected ? (controllerInfo.name || 'Connected') : 'Disconnected'}
            </div>
          </div>
          <button 
            onClick={(e) => { e.stopPropagation(); onClose() }}
            style={{ padding: 8, borderRadius: 999, background: 'rgba(24,24,27,0.85)', border: '1px solid rgba(255,255,255,0.07)', cursor: 'pointer', color: 'rgba(255,255,255,0.45)', display: 'flex' }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Expanded Content */}
        {expanded && (
          <div style={{ padding: 14 }}>
            {/* Quick Tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
              <button
                onClick={() => setActiveTab('quick')}
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  borderRadius: 999,
                  border: activeTab === 'quick' ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.07)',
                  background: activeTab === 'quick' ? '#ffffff' : 'rgba(24,24,27,0.75)',
                  color: activeTab === 'quick' ? '#09090b' : 'rgba(255,255,255,0.55)',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                }}
              >
                <Settings size={12} />
                Quick
              </button>
              <button
                onClick={() => setActiveTab('mouse')}
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  borderRadius: 999,
                  border: activeTab === 'mouse' ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.07)',
                  background: activeTab === 'mouse' ? '#ffffff' : 'rgba(24,24,27,0.75)',
                  color: activeTab === 'mouse' ? '#09090b' : 'rgba(255,255,255,0.55)',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                }}
              >
                <Mouse size={12} />
                Mouse
              </button>
              <button
                onClick={() => setActiveTab('mapping')}
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  borderRadius: 999,
                  border: activeTab === 'mapping' ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.07)',
                  background: activeTab === 'mapping' ? '#ffffff' : 'rgba(24,24,27,0.75)',
                  color: activeTab === 'mapping' ? '#09090b' : 'rgba(255,255,255,0.55)',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                }}
              >
                <Gamepad2 size={12} />
                Mapping
              </button>
            </div>

            {/* Quick Settings Tab */}
            {activeTab === 'quick' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Deadzone */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>Deadzone</span>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{Math.round(localDeadzone * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="0.5"
                    step="0.01"
                    value={localDeadzone}
                    onChange={(e) => handleDeadzoneChange([Number(e.target.value)])}
                    onMouseUp={handleDeadzoneCommit}
                    onTouchEnd={handleDeadzoneCommit}
                    style={{
                      width: '100%',
                      height: 4,
                      appearance: 'none',
                      background: `linear-gradient(to right, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.95) ${(localDeadzone / 0.5) * 100}%, rgba(255,255,255,0.15) ${(localDeadzone / 0.5) * 100}%, rgba(255,255,255,0.15) 100%)`,
                      borderRadius: 2,
                      cursor: 'pointer',
                    }}
                  />
                </div>

                {/* Vibration */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Volume2 size={14} color="rgba(255,255,255,0.5)" />
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>Vibration</span>
                  </div>
                  <Switch 
                    checked={localVibration} 
                    onCheckedChange={handleVibrationToggle}
                  />
                </div>

                {/* Refresh Controller */}
                <button 
                  onClick={checkControllers}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    padding: '8px 12px',
                    borderRadius: 999,
                    border: '1px solid rgba(255,255,255,0.07)',
                    background: 'rgba(24,24,27,0.75)',
                    color: 'rgba(255,255,255,0.7)',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  <RefreshCw size={12} />
                  Refresh Controller
                </button>
              </div>
            )}

            {/* Mouse Settings Tab */}
            {activeTab === 'mouse' && activeProfile && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Mouse size={14} color="rgba(255,255,255,0.5)" />
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>Left Stick → Mouse</span>
                  </div>
                  <Switch 
                    checked={activeProfile.keyBinding?.stickToMouse?.leftStick ?? false} 
                    onCheckedChange={(checked) => handleStickToMouseToggle('left', checked)}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Mouse size={14} color="rgba(255,255,255,0.5)" />
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>Right Stick → Mouse</span>
                  </div>
                  <Switch 
                    checked={activeProfile.keyBinding?.stickToMouse?.rightStick ?? false} 
                    onCheckedChange={(checked) => handleStickToMouseToggle('right', checked)}
                  />
                </div>

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>Mouse Speed</span>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
                      {(activeProfile.keyBinding?.stickToMouse?.mouseSpeed ?? 1.0).toFixed(1)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="3.0"
                    step="0.1"
                    value={activeProfile.keyBinding?.stickToMouse?.mouseSpeed ?? 1.0}
                    onChange={(e) => handleMouseSpeedChange([Number(e.target.value)])}
                    style={{
                      width: '100%',
                      height: 4,
                      appearance: 'none',
                      background: `linear-gradient(to right, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.95) ${((activeProfile.keyBinding?.stickToMouse?.mouseSpeed ?? 1.0) - 0.1) / 2.9 * 100}%, rgba(255,255,255,0.15) ${((activeProfile.keyBinding?.stickToMouse?.mouseSpeed ?? 1.0) - 0.1) / 2.9 * 100}%, rgba(255,255,255,0.15) 100%)`,
                      borderRadius: 2,
                      cursor: 'pointer',
                    }}
                  />
                </div>
              </div>
            )}

            {/* Mapping Tab */}
            {activeTab === 'mapping' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', marginBottom: 6, display: 'block' }}>Active Profile</span>
                  <select
                    value={activeProfile?.id || ''}
                    onChange={(e) => setActiveProfile(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 18,
                      border: '1px solid rgba(255,255,255,0.07)',
                      background: 'rgba(24,24,27,0.78)',
                      color: 'white',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    {profiles.map(profile => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ 
                  padding: 10, 
                  borderRadius: 18, 
                  background: 'rgba(24,24,27,0.78)', 
                  border: '1px solid rgba(255,255,255,0.07)',
                }}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', marginBottom: 4 }}>
                    Input Translation
                  </div>
                  <div style={{ fontSize: 11, color: 'white', fontWeight: 600 }}>
                    {settings.inputTranslation?.enabled ? 'Enabled' : 'Disabled'}
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                    Preset: {settings.inputTranslation?.mappingPreset || 'Auto'}
                  </div>
                </div>

                <button
                  onClick={onClose}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    padding: '10px 12px',
                    borderRadius: 999,
                    border: '1px solid rgba(255,255,255,0.2)',
                    background: '#ffffff',
                    color: '#09090b',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Settings size={14} />
                  Open Full Settings
                </button>
              </div>
            )}

            {/* Footer */}
            <div style={{ 
              marginTop: 12, 
              paddingTop: 10, 
              borderTop: '1px solid rgba(255,255,255,0.04)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>Press</span>
              <kbd style={{ 
                fontSize: 9, 
                fontFamily: 'monospace', 
                color: 'rgba(255,255,255,0.3)', 
                background: 'rgba(255,255,255,0.05)', 
                border: '1px solid rgba(255,255,255,0.08)', 
                borderRadius: 4, 
                padding: '1px 5px' 
              }}>Esc</kbd>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>to close</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ControllerOverlayFlyout
