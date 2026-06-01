import { useState, useEffect, useCallback, type ComponentType } from 'react'
import { useController, ControllerProfile } from '../hooks/use-controller'
import { Switch } from './ui/switch'
import { Gamepad2, X, Settings, BatteryFull, Zap } from "@/components/icons"
import { RefreshCw, Mouse, Volume2, BatteryLow, BatteryMedium } from "lucide-react"
import { playHaptic } from '../lib/haptics'

interface ControllerOverlayFlyoutProps {
  visible: boolean
  onClose: () => void
  position?: 'left' | 'right'
}

type Tab = 'quick' | 'mouse' | 'mapping'

const TABS: Array<{ id: Tab; label: string; Icon: ComponentType<{ size?: number; className?: string }> }> = [
  { id: 'quick', label: 'Quick', Icon: Settings },
  { id: 'mouse', label: 'Mouse', Icon: Mouse },
  { id: 'mapping', label: 'Mapping', Icon: Gamepad2 },
]

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

  const [activeTab, setActiveTab] = useState<Tab>('quick')
  const [localDeadzone, setLocalDeadzone] = useState(settings?.deadzone ?? 0.1)
  const [localVibration, setLocalVibration] = useState(settings?.vibrationEnabled ?? true)
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null)
  const [isCharging, setIsCharging] = useState(false)

  useEffect(() => {
    if (settings) {
      setLocalDeadzone(settings.deadzone)
      setLocalVibration(settings.vibrationEnabled)
    }
  }, [settings])

  // Pull battery info out of the raw controller input stream.
  useEffect(() => {
    if (!visible || !window.ucController) return
    const unsub = window.ucController.onControllerInput?.((data: any) => {
      const states = Array.isArray(data) ? data : [data]
      const first = states[0]
      if (first && first.connected && first.battery > 0) {
        setBatteryLevel(Math.round(first.battery * 100))
        setIsCharging(!!first.charging)
      }
    })
    return () => { unsub?.() }
  }, [visible])

  useEffect(() => {
    if (!visible) return
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [visible, onClose])

  useEffect(() => {
    if (!visible) return
    checkControllers()
    const interval = setInterval(checkControllers, 3000)
    return () => clearInterval(interval)
  }, [visible, checkControllers])

  const handleDeadzoneCommit = useCallback(() => {
    if (activeProfile) updateProfile({ ...activeProfile, deadzone: localDeadzone })
  }, [activeProfile, localDeadzone, updateProfile])

  const handleVibrationToggle = useCallback((enabled: boolean) => {
    setLocalVibration(enabled)
    if (enabled) playHaptic('toggle')
    if (activeProfile) updateProfile({ ...activeProfile, vibrationEnabled: enabled })
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

  const handleMouseSpeedChange = useCallback((value: number) => {
    if (!activeProfile) return
    updateProfile({
      ...activeProfile,
      keyBinding: {
        ...activeProfile.keyBinding,
        stickToMouse: {
          leftStick: activeProfile.keyBinding?.stickToMouse?.leftStick ?? false,
          rightStick: activeProfile.keyBinding?.stickToMouse?.rightStick ?? false,
          mouseSpeed: value,
          mouseAcceleration: activeProfile.keyBinding?.stickToMouse?.mouseAcceleration ?? false,
        },
      },
    })
  }, [activeProfile, updateProfile])

  if (!visible) return null

  const isLeft = position === 'left'
  const sideClass = isLeft ? 'left-5' : 'right-5'
  const statusLabel = connected ? (controllerInfo.name || 'Connected') : 'No controller'
  const mouseSpeed = activeProfile?.keyBinding?.stickToMouse?.mouseSpeed ?? 1.0

  const sliderBg = (pct: number) =>
    `linear-gradient(to right, var(--primary) 0%, var(--primary) ${pct}%, rgba(255,255,255,0.12) ${pct}%, rgba(255,255,255,0.12) 100%)`

  return (
    <div
      className={`pointer-events-auto fixed top-4 ${sideClass} z-[10000] w-[330px] transition-all duration-200 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
      }`}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="overlay-panel overflow-hidden rounded-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-white/[.06] px-4 py-3.5">
          <div className={`relative flex h-10 w-10 items-center justify-center rounded-xl ${connected ? 'bg-primary text-primary-foreground' : 'bg-white/[.06] text-muted-foreground'}`}>
            <Gamepad2 size={17} />
            <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#0a0a0c] ${connected ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold leading-tight text-white">Controller</div>
            <div className="mt-0.5 flex items-center gap-2">
              <span className={`truncate text-[11px] ${connected ? 'text-emerald-300' : 'text-muted-foreground/70'}`}>{statusLabel}</span>
              {connected && batteryLevel != null && batteryLevel > 0 && (
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                  isCharging ? 'bg-emerald-500/20 text-emerald-300' :
                  batteryLevel > 60 ? 'bg-emerald-500/15 text-emerald-400' :
                  batteryLevel > 25 ? 'bg-amber-500/15 text-amber-400' :
                  'bg-red-500/15 text-red-400'
                }`}>
                  {isCharging ? <Zap size={9} /> :
                   batteryLevel > 60 ? <BatteryFull size={11} /> :
                   batteryLevel > 25 ? <BatteryMedium size={11} /> :
                   <BatteryLow size={11} />}
                  {batteryLevel}%
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[.08] bg-white/[.02] text-muted-foreground transition hover:bg-white/[.08] hover:text-white active:scale-90"
            aria-label="Close controller overlay"
          >
            <X size={14} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-3 pt-3">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-semibold transition active:scale-95 ${
                activeTab === id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-white/[.05] hover:text-white'
              }`}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>

        <div className="p-4">
          {activeTab === 'quick' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-3">
                <div className="mb-2 flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">Stick deadzone</span>
                  <span className="font-mono text-white">{Math.round(localDeadzone * 100)}%</span>
                </div>
                <input
                  type="range" min={0} max={0.5} step={0.01}
                  value={localDeadzone}
                  onChange={(e) => setLocalDeadzone(Number(e.target.value))}
                  onMouseUp={handleDeadzoneCommit}
                  onTouchEnd={handleDeadzoneCommit}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full"
                  style={{ background: sliderBg((localDeadzone / 0.5) * 100) }}
                />
              </div>

              <div className="flex items-center justify-between rounded-xl border border-white/[.06] bg-white/[.02] px-3 py-2.5">
                <div className="flex items-center gap-2 text-[12px] text-foreground/90">
                  <Volume2 size={15} className="text-muted-foreground" />
                  <span>Vibration</span>
                </div>
                <Switch checked={localVibration} onCheckedChange={handleVibrationToggle} />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => { playHaptic('select'); setTimeout(() => playHaptic('select'), 120) }}
                  disabled={!localVibration}
                  className="flex items-center justify-center gap-2 rounded-xl border border-white/[.06] bg-white/[.02] px-3 py-2.5 text-[11px] font-medium text-foreground/90 transition hover:bg-white/[.06] hover:text-white active:scale-95 disabled:opacity-40"
                >
                  <Zap size={13} />
                  Test rumble
                </button>
                <button
                  onClick={checkControllers}
                  className="flex items-center justify-center gap-2 rounded-xl border border-white/[.06] bg-white/[.02] px-3 py-2.5 text-[11px] font-medium text-foreground/90 transition hover:bg-white/[.06] hover:text-white active:scale-95"
                >
                  <RefreshCw size={13} />
                  Refresh
                </button>
              </div>
            </div>
          )}

          {activeTab === 'mouse' && (
            <div className="space-y-3">
              {!activeProfile ? (
                <p className="py-4 text-center text-[11px] text-muted-foreground">No active profile.</p>
              ) : (
                <>
                  <div className="flex items-center justify-between rounded-xl border border-white/[.06] bg-white/[.02] px-3 py-2.5">
                    <span className="text-[12px] text-foreground/90">Left stick → mouse</span>
                    <Switch
                      checked={activeProfile.keyBinding?.stickToMouse?.leftStick ?? false}
                      onCheckedChange={(c) => handleStickToMouseToggle('left', c)}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-white/[.06] bg-white/[.02] px-3 py-2.5">
                    <span className="text-[12px] text-foreground/90">Right stick → mouse</span>
                    <Switch
                      checked={activeProfile.keyBinding?.stickToMouse?.rightStick ?? false}
                      onCheckedChange={(c) => handleStickToMouseToggle('right', c)}
                    />
                  </div>
                  <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-3">
                    <div className="mb-2 flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">Mouse speed</span>
                      <span className="font-mono text-white">{mouseSpeed.toFixed(1)}x</span>
                    </div>
                    <input
                      type="range" min={0.1} max={3.0} step={0.1}
                      value={mouseSpeed}
                      onChange={(e) => handleMouseSpeedChange(Number(e.target.value))}
                      className="h-1.5 w-full cursor-pointer appearance-none rounded-full"
                      style={{ background: sliderBg(((mouseSpeed - 0.1) / 2.9) * 100) }}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'mapping' && (
            <div className="space-y-3">
              <div>
                <div className="mb-1.5 text-[11px] text-muted-foreground">Active profile</div>
                <select
                  value={activeProfile?.id || ''}
                  onChange={(e) => setActiveProfile(e.target.value)}
                  className="w-full rounded-xl border border-white/[.08] bg-white/[.03] px-3 py-2 text-sm text-white outline-none focus:border-primary/60"
                >
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id} className="bg-[#0a0a0c]">{profile.name}</option>
                  ))}
                </select>
              </div>

              <div className="rounded-xl border border-white/[.06] bg-white/[.02] px-3 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">Input translation</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${settings?.inputTranslation?.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/[.06] text-muted-foreground'}`}>
                    {settings?.inputTranslation?.enabled ? 'On' : 'Off'}
                  </span>
                </div>
                <div className="mt-1.5 text-[10px] text-muted-foreground/70">
                  Preset: {settings?.inputTranslation?.mappingPreset || 'Auto'}
                </div>
              </div>
            </div>
          )}

          <div className="mt-4 flex items-center justify-center gap-2 border-t border-white/[.06] pt-3 text-[10px] text-muted-foreground/60">
            <span className="token-chip text-[9px]">Esc</span>
            <span>to close</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ControllerOverlayFlyout
