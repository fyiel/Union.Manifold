import { useState, useEffect, useCallback } from 'react'
import { useController, ControllerProfile } from '../hooks/use-controller'
import { Switch } from './ui/switch'
import { Gamepad2, X, RefreshCw, Mouse, Settings, Volume2 } from 'lucide-react'

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
    checkControllers,
  } = useController()

  const [expanded, setExpanded] = useState(true)
  const [activeTab, setActiveTab] = useState<'mapping' | 'mouse' | 'quick'>('quick')
  const [localDeadzone, setLocalDeadzone] = useState(settings?.deadzone ?? 0.1)
  const [localVibration, setLocalVibration] = useState(settings?.vibrationEnabled ?? true)

  useEffect(() => {
    if (settings) {
      setLocalDeadzone(settings.deadzone)
      setLocalVibration(settings.vibrationEnabled)
    }
  }, [settings])

  useEffect(() => {
    if (!visible) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [visible, onClose])

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
        },
      },
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
        },
      },
    }
    updateProfile(updated)
  }, [activeProfile, updateProfile])

  if (!visible) return null

  const isLeft = position === 'left'
  const sideClass = isLeft ? 'left-6' : 'right-6'
  const statusLabel = connected ? (controllerInfo.name || 'Connected') : 'Disconnected'

  return (
    <div
      className={`pointer-events-auto fixed top-5 ${sideClass} z-[10000] w-[320px] transition-all duration-200 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
      }`}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="glass overflow-hidden rounded-[28px] border border-white/[.07] !bg-zinc-950/92 shadow-[0_28px_80px_rgba(0,0,0,0.6)]">
        <div
          className={`flex items-center gap-3 px-4 py-3 ${expanded ? 'border-b border-white/[.07]' : ''} cursor-pointer`}
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-black">
            <Gamepad2 size={15} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Controller</div>
            <div className="text-base font-black tracking-tight text-white">Input Console</div>
            <div className={`text-[10px] ${connected ? 'text-emerald-300' : 'text-zinc-500'}`}>{statusLabel}</div>
          </div>
          <button
            onClick={(event) => {
              event.stopPropagation()
              onClose()
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[.08] bg-zinc-900/85 text-zinc-400 transition hover:bg-white/[.06] hover:text-white active:scale-95"
            aria-label="Close controller overlay"
          >
            <X size={14} />
          </button>
        </div>

        {expanded && (
          <div className="p-4">
            <div className="flex gap-2">
              <button
                onClick={() => setActiveTab('quick')}
                className={`flex-1 rounded-full border px-3 py-2 text-[11px] font-semibold transition active:scale-95 ${
                  activeTab === 'quick'
                    ? 'border-white/60 bg-white text-black'
                    : 'border-white/[.07] bg-zinc-900/85 text-zinc-400 hover:bg-white/[.06] hover:text-white'
                }`}
              >
                <span className="inline-flex items-center justify-center gap-2">
                  <Settings size={12} />
                  Quick
                </span>
              </button>
              <button
                onClick={() => setActiveTab('mouse')}
                className={`flex-1 rounded-full border px-3 py-2 text-[11px] font-semibold transition active:scale-95 ${
                  activeTab === 'mouse'
                    ? 'border-white/60 bg-white text-black'
                    : 'border-white/[.07] bg-zinc-900/85 text-zinc-400 hover:bg-white/[.06] hover:text-white'
                }`}
              >
                <span className="inline-flex items-center justify-center gap-2">
                  <Mouse size={12} />
                  Mouse
                </span>
              </button>
              <button
                onClick={() => setActiveTab('mapping')}
                className={`flex-1 rounded-full border px-3 py-2 text-[11px] font-semibold transition active:scale-95 ${
                  activeTab === 'mapping'
                    ? 'border-white/60 bg-white text-black'
                    : 'border-white/[.07] bg-zinc-900/85 text-zinc-400 hover:bg-white/[.06] hover:text-white'
                }`}
              >
                <span className="inline-flex items-center justify-center gap-2">
                  <Gamepad2 size={12} />
                  Mapping
                </span>
              </button>
            </div>

            {activeTab === 'quick' && (
              <div className="mt-4 space-y-4">
                <div>
                  <div className="mb-2 flex items-center justify-between text-[11px] text-zinc-400">
                    <span>Deadzone</span>
                    <span>{Math.round(localDeadzone * 100)}%</span>
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
                    className="h-1.5 w-full appearance-none rounded-full bg-transparent"
                    style={{
                      background: `linear-gradient(to right, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.95) ${(localDeadzone / 0.5) * 100}%, rgba(255,255,255,0.15) ${(localDeadzone / 0.5) * 100}%, rgba(255,255,255,0.15) 100%)`,
                    }}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                    <Volume2 size={14} className="text-zinc-500" />
                    <span>Vibration</span>
                  </div>
                  <Switch checked={localVibration} onCheckedChange={handleVibrationToggle} />
                </div>

                <button
                  onClick={checkControllers}
                  className="flex w-full items-center justify-center gap-2 rounded-full border border-white/[.07] bg-zinc-900/85 px-3 py-2 text-[11px] text-zinc-300 transition hover:bg-white/[.06] hover:text-white active:scale-95"
                >
                  <RefreshCw size={12} />
                  Refresh Controller
                </button>
              </div>
            )}

            {activeTab === 'mouse' && activeProfile && (
              <div className="mt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                    <Mouse size={14} className="text-zinc-500" />
                    <span>Left Stick to Mouse</span>
                  </div>
                  <Switch
                    checked={activeProfile.keyBinding?.stickToMouse?.leftStick ?? false}
                    onCheckedChange={(checked) => handleStickToMouseToggle('left', checked)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                    <Mouse size={14} className="text-zinc-500" />
                    <span>Right Stick to Mouse</span>
                  </div>
                  <Switch
                    checked={activeProfile.keyBinding?.stickToMouse?.rightStick ?? false}
                    onCheckedChange={(checked) => handleStickToMouseToggle('right', checked)}
                  />
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between text-[11px] text-zinc-400">
                    <span>Mouse Speed</span>
                    <span>{(activeProfile.keyBinding?.stickToMouse?.mouseSpeed ?? 1.0).toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="3.0"
                    step="0.1"
                    value={activeProfile.keyBinding?.stickToMouse?.mouseSpeed ?? 1.0}
                    onChange={(e) => handleMouseSpeedChange([Number(e.target.value)])}
                    className="h-1.5 w-full appearance-none rounded-full bg-transparent"
                    style={{
                      background: `linear-gradient(to right, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.95) ${((activeProfile.keyBinding?.stickToMouse?.mouseSpeed ?? 1.0) - 0.1) / 2.9 * 100}%, rgba(255,255,255,0.15) ${((activeProfile.keyBinding?.stickToMouse?.mouseSpeed ?? 1.0) - 0.1) / 2.9 * 100}%, rgba(255,255,255,0.15) 100%)`,
                    }}
                  />
                </div>
              </div>
            )}

            {activeTab === 'mapping' && (
              <div className="mt-4 space-y-4">
                <div>
                  <div className="mb-2 text-[11px] text-zinc-400">Active Profile</div>
                  <select
                    value={activeProfile?.id || ''}
                    onChange={(e) => setActiveProfile(e.target.value)}
                  className="w-full rounded-2xl border border-white/[.07] bg-zinc-900/85 px-3 py-2 text-sm text-white"
                >
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-2xl border border-white/[.07] bg-zinc-950/85 px-3 py-3">
                  <div className="text-[10px] text-zinc-500">Input Translation</div>
                  <div className="mt-1 text-sm font-semibold text-white">
                    {settings?.inputTranslation?.enabled ? 'Enabled' : 'Disabled'}
                  </div>
                  <div className="mt-1 text-[10px] text-zinc-500">
                    Preset: {settings?.inputTranslation?.mappingPreset || 'Auto'}
                  </div>
                </div>

                <button
                  onClick={onClose}
                  className="flex w-full items-center justify-center gap-2 rounded-full border border-white/60 bg-white px-3 py-2 text-[12px] font-semibold text-black transition hover:bg-zinc-200 active:scale-95"
                >
                  <Settings size={14} />
                  Open Full Settings
                </button>
              </div>
            )}

            <div className="mt-4 border-t border-white/[.06] pt-3">
              <div className="flex items-center justify-center gap-2 text-[10px] text-zinc-500">
                <span>Press</span>
                <span className="token-chip text-[9px]">Esc</span>
                <span className="text-zinc-700">|</span>
                <span>Close</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ControllerOverlayFlyout
