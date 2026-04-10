import { useController, ControllerSettings, ControllerProfile } from '../hooks/use-controller'
import { Switch } from './ui/switch'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Slider } from './ui/slider'
import { Button } from './ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { useEffect, useState, useCallback } from 'react'
import {
  Gamepad2, Plus, Trash2, Copy, Settings, Keyboard, Mouse,
  RefreshCw, ChevronRight, X, Pencil,
} from 'lucide-react'
import {
  createDefaultProfile,
  Xbox360ButtonLabels,
  NativeButtonLabels,
  NativeButton,
  InputAction,
} from '../lib/controller-mappings'
import { CompactRemapSection } from './CompactRemapSection'

// ─── Button list ─────────────────────────────────────────────────────────────

const BUTTON_GROUPS: Array<{ group: string; buttons: Array<{ key: NativeButton; label: string }> }> = [
  {
    group: 'Face',
    buttons: [
      { key: NativeButton.A,  label: 'A' },
      { key: NativeButton.B,  label: 'B' },
      { key: NativeButton.X,  label: 'X' },
      { key: NativeButton.Y,  label: 'Y' },
    ],
  },
  {
    group: 'Bumpers & Triggers',
    buttons: [
      { key: NativeButton.LB, label: 'LB (Left Bumper)' },
      { key: NativeButton.RB, label: 'RB (Right Bumper)' },
      { key: NativeButton.LT, label: 'LT (Left Trigger)' },
      { key: NativeButton.RT, label: 'RT (Right Trigger)' },
    ],
  },
  {
    group: 'Sticks',
    buttons: [
      { key: NativeButton.LS, label: 'L3 (Left Stick Click)' },
      { key: NativeButton.RS, label: 'R3 (Right Stick Click)' },
    ],
  },
  {
    group: 'Menu',
    buttons: [
      { key: NativeButton.START, label: 'Start / Menu' },
      { key: NativeButton.BACK,  label: 'Back / View' },
      { key: NativeButton.GUIDE, label: 'Guide / Home' },
    ],
  },
  {
    group: 'D-Pad',
    buttons: [
      { key: NativeButton.DPAD_UP,    label: 'D-Pad Up' },
      { key: NativeButton.DPAD_DOWN,  label: 'D-Pad Down' },
      { key: NativeButton.DPAD_LEFT,  label: 'D-Pad Left' },
      { key: NativeButton.DPAD_RIGHT, label: 'D-Pad Right' },
    ],
  },
  {
    group: 'Special',
    buttons: [
      { key: NativeButton.TOUCHPAD, label: 'Touchpad Click' },
      { key: NativeButton.SHARE,    label: 'Share / Create' },
    ],
  },
]

// ─── Formatting helpers ───────────────────────────────────────────────────────

function formatAction(action: InputAction | undefined): string {
  if (!action || action.type === 'none') return ''
  if (action.type === 'keyboard') {
    const { key, modifiers } = action.key
    const parts: string[] = []
    if (modifiers?.ctrl)  parts.push('Ctrl')
    if (modifiers?.alt)   parts.push('Alt')
    if (modifiers?.shift) parts.push('Shift')
    if (modifiers?.meta)  parts.push('Win')
    parts.push(key === ' ' ? 'Space' : key)
    return parts.join('+')
  }
  if (action.type === 'mouse') {
    const { input } = action
    if (input.type === 'scroll') return input.direction === 'up' ? 'Scroll Up' : 'Scroll Down'
    if (input.button === 'left')   return 'Left Click'
    if (input.button === 'right')  return 'Right Click'
    if (input.button === 'middle') return 'Middle Click'
    return 'Mouse'
  }
  if (action.type === 'xbox360') {
    if (action.button) return `Xbox: ${action.button.toUpperCase()}`
    if (action.axis)   return `Axis: ${action.axis}`
  }
  return ''
}

function actionBadgeClass(action: InputAction | undefined): string {
  if (!action || action.type === 'none') return ''
  if (action.type === 'keyboard') return 'bg-blue-900/40 text-blue-300 border border-blue-700/40'
  if (action.type === 'mouse')    return 'bg-green-900/40 text-green-300 border border-green-700/40'
  return 'bg-purple-900/40 text-purple-300 border border-purple-700/40'
}

// ─── BindingCapture component ─────────────────────────────────────────────────

interface BindingCaptureProps {
  buttonLabel: string
  currentAction: InputAction | undefined
  onSave: (action: InputAction) => void
  onCancel: () => void
}

function BindingCapture({ buttonLabel, currentAction, onSave, onCancel }: BindingCaptureProps) {
  const [waitingKey, setWaitingKey] = useState(false)

  useEffect(() => {
    if (!waitingKey) return
    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return
      onSave({
        type: 'keyboard',
        key: {
          key: e.key,
          code: e.code,
          modifiers: {
            ctrl:  e.ctrlKey  || undefined,
            alt:   e.altKey   || undefined,
            shift: e.shiftKey || undefined,
            meta:  e.metaKey  || undefined,
          },
        },
      })
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [waitingKey, onSave])

  return (
    <div className="rounded-lg border border-blue-500/40 bg-blue-950/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-white">
          Binding: <span className="text-blue-300">{buttonLabel}</span>
        </span>
        <button onClick={onCancel} className="text-gray-400 hover:text-white p-0.5">
          <X size={15} />
        </button>
      </div>

      {waitingKey ? (
        <div className="flex flex-col items-center gap-2 py-4">
          <Keyboard size={28} className="text-blue-400 animate-pulse" />
          <p className="text-sm font-medium text-white">Press any key...</p>
          <p className="text-xs text-gray-400">Ctrl / Alt / Shift combos are supported</p>
          <button
            onClick={() => setWaitingKey(false)}
            className="mt-1 text-xs text-gray-400 hover:text-white underline"
          >
            Back
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">Choose what this button does:</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setWaitingKey(true)}
              className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-white transition-colors"
            >
              <Keyboard size={15} className="text-blue-400" />
              Keyboard Key
            </button>
            <button
              onClick={() => onSave({ type: 'mouse', input: { type: 'click', button: 'left' } })}
              className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-white transition-colors"
            >
              <Mouse size={15} className="text-green-400" />
              Left Click
            </button>
            <button
              onClick={() => onSave({ type: 'mouse', input: { type: 'right_click', button: 'right' } })}
              className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-white transition-colors"
            >
              <Mouse size={15} className="text-yellow-400" />
              Right Click
            </button>
            <button
              onClick={() => onSave({ type: 'mouse', input: { type: 'middle_click', button: 'middle' } })}
              className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-white transition-colors"
            >
              <Mouse size={15} className="text-purple-400" />
              Middle Click
            </button>
            <button
              onClick={() => onSave({ type: 'mouse', input: { type: 'scroll', direction: 'up' } })}
              className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-white transition-colors"
            >
              <Mouse size={15} className="text-cyan-400" />
              Scroll Up
            </button>
            <button
              onClick={() => onSave({ type: 'mouse', input: { type: 'scroll', direction: 'down' } })}
              className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-white transition-colors"
            >
              <Mouse size={15} className="text-cyan-400" />
              Scroll Down
            </button>
          </div>
          {currentAction && currentAction.type !== 'none' && (
            <button
              onClick={() => onSave({ type: 'none' })}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-red-950/40 hover:bg-red-950/70 border border-red-700/30 text-sm text-red-400 transition-colors"
            >
              <X size={13} />
              Clear Binding
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function ControllerSettingsPanel() {
  const {
    settings,
    connected,
    controllerInfo,
    loading,
    profiles,
    activeProfile,
    updateSettings,
    setEnabled,
    checkControllers,
    setActiveMapping,
    setActiveProfile,
    createProfile,
    updateProfile,
    deleteProfile,
  } = useController()

  const [localSettings, setLocalSettings] = useState<ControllerSettings>(settings)
  const [activeTab, setActiveTab] = useState('general')
  const [profileName, setProfileName] = useState('')
  const [editingButton, setEditingButton] = useState<NativeButton | null>(null)

  useEffect(() => {
    setLocalSettings(settings)
  }, [settings])

  // ── General handlers ──────────────────────────────────────────────────────

  const handleEnabledChange = async (enabled: boolean) => {
    setLocalSettings(prev => ({ ...prev, enabled }))
    await setEnabled(enabled)
  }

  const handleControllerTypeChange = async (value: string) => {
    const newSettings = { ...localSettings, controllerType: value as ControllerSettings['controllerType'] }
    setLocalSettings(newSettings)
    await updateSettings({ controllerType: value as ControllerSettings['controllerType'] })
  }

  const handleVibrationChange = async (enabled: boolean) => {
    const newSettings = { ...localSettings, vibrationEnabled: enabled }
    setLocalSettings(newSettings)
    await updateSettings({ vibrationEnabled: enabled })
  }

  const handleDeadzoneChange = async (value: number[]) => {
    const newSettings = { ...localSettings, deadzone: value[0] }
    setLocalSettings(newSettings)
    await updateSettings({ deadzone: value[0] })
  }

  const handleTriggerDeadzoneChange = async (value: number[]) => {
    const newSettings = { ...localSettings, triggerDeadzone: value[0] }
    setLocalSettings(newSettings)
    await updateSettings({ triggerDeadzone: value[0] })
  }

  const handleButtonLayoutChange = async (value: string) => {
    const newSettings = { ...localSettings, buttonLayout: value as ControllerSettings['buttonLayout'] }
    setLocalSettings(newSettings)
    await updateSettings({ buttonLayout: value as ControllerSettings['buttonLayout'] })
  }

  // ── Input Translation handlers ────────────────────────────────────────────

  const handleInputTranslationToggle = async (enabled: boolean) => {
    const newSettings = { ...localSettings, inputTranslation: { ...localSettings.inputTranslation, enabled } }
    setLocalSettings(newSettings)
    await updateSettings({ inputTranslation: newSettings.inputTranslation })
  }

  const handleAutoDetectToggle = async (enabled: boolean) => {
    const ns = { ...localSettings, inputTranslation: { ...localSettings.inputTranslation, autoDetect: enabled } }
    setLocalSettings(ns)
    await updateSettings({ inputTranslation: ns.inputTranslation })
  }

  const handleMappingPresetChange = async (preset: string) => {
    const ns = {
      ...localSettings,
      inputTranslation: {
        ...localSettings.inputTranslation,
        mappingPreset: preset as ControllerSettings['inputTranslation']['mappingPreset'],
      },
    }
    setLocalSettings(ns)
    await updateSettings({ inputTranslation: ns.inputTranslation })
    await setActiveMapping(preset)
  }

  // ── Key Binding handlers ──────────────────────────────────────────────────

  const handleKeyBindingToggle = async (enabled: boolean) => {
    const ns = { ...localSettings, keyBinding: { ...localSettings.keyBinding, enabled } }
    setLocalSettings(ns)
    await updateSettings({ keyBinding: ns.keyBinding })
  }

  const handleProfileSelect = async (profileId: string) => {
    const ns = { ...localSettings, keyBinding: { ...localSettings.keyBinding, activeProfileId: profileId } }
    setLocalSettings(ns)
    await updateSettings({ keyBinding: ns.keyBinding })
    await setActiveProfile(profileId)
    setEditingButton(null)
  }

  const handleCreateProfile = async () => {
    const newProfile = createDefaultProfile(profileName || `Profile ${profiles.length + 1}`)
    await createProfile(newProfile)
    setProfileName('')
  }

  const handleDeleteProfile = async (profileId: string) => {
    if (profiles.length <= 1) return
    await deleteProfile(profileId)
  }

  const handleDuplicateProfile = async (profile: ControllerProfile | null) => {
    if (!profile) return
    const dup: ControllerProfile = {
      ...profile,
      id: `profile_${Date.now()}`,
      name: `${profile.name} (Copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await createProfile(dup)
  }

  // Save a single button's binding inside the active profile
  const saveButtonBinding = useCallback(async (button: NativeButton, action: InputAction) => {
    if (!activeProfile) return
    const updated: ControllerProfile = {
      ...activeProfile,
      keyBinding: {
        ...activeProfile.keyBinding,
        buttonMappings: {
          ...activeProfile.keyBinding?.buttonMappings,
          [button]: action,
        },
      },
      updatedAt: Date.now(),
    }
    await updateProfile(updated)
    setEditingButton(null)
  }, [activeProfile, updateProfile])

  // ── Stick / Trigger helpers ───────────────────────────────────────────────

  const patchStickToMouse = async (patch: Partial<NonNullable<typeof activeProfile>['keyBinding']['stickToMouse']>) => {
    if (!activeProfile) return
    const updated: ControllerProfile = {
      ...activeProfile,
      keyBinding: {
        ...activeProfile.keyBinding,
        stickToMouse: {
          leftStick: false,
          rightStick: false,
          mouseSpeed: 1.0,
          mouseAcceleration: false,
          ...activeProfile.keyBinding?.stickToMouse,
          ...patch,
        },
      },
      updatedAt: Date.now(),
    }
    await updateProfile(updated)
  }

  const patchTriggerToScroll = async (patch: Partial<NonNullable<typeof activeProfile>['keyBinding']['triggerToScroll']>) => {
    if (!activeProfile) return
    const updated: ControllerProfile = {
      ...activeProfile,
      keyBinding: {
        ...activeProfile.keyBinding,
        triggerToScroll: {
          leftTrigger: false,
          rightTrigger: false,
          scrollSpeed: 1.0,
          ...activeProfile.keyBinding?.triggerToScroll,
          ...patch,
        },
      },
      updatedAt: Date.now(),
    }
    await updateProfile(updated)
  }

  // ── Overlay handlers ──────────────────────────────────────────────────────

  const handleOverlayToggle = async (enabled: boolean) => {
    const ns = { ...localSettings, overlayEnabled: enabled }
    setLocalSettings(ns)
    await updateSettings({ overlayEnabled: enabled })
    await (window.ucController as any)?.setOverlaySettings?.({ overlayEnabled: enabled })
  }

  const handleOverlayHotkeyChange = async (hotkey: string) => {
    const ns = { ...localSettings, overlayHotkey: hotkey }
    setLocalSettings(ns)
    await updateSettings({ overlayHotkey: hotkey })
    await (window.ucController as any)?.setOverlaySettings?.({ overlayHotkey: hotkey })
  }

  const handleOverlayPositionChange = async (position: 'left' | 'right') => {
    const ns = { ...localSettings, overlayPosition: position }
    setLocalSettings(ns)
    await updateSettings({ overlayPosition: position })
    await (window.ucController as any)?.setOverlaySettings?.({ overlayPosition: position })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-gray-400">Loading controller settings...</div>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 p-4">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="input-translation">Input Translation</TabsTrigger>
          <TabsTrigger value="key-binding">Key Binding</TabsTrigger>
          <TabsTrigger value="overlay">Overlay</TabsTrigger>
        </TabsList>

        {/* ── General Tab ────────────────────────────────────────────────── */}
        <TabsContent value="general" className="space-y-6 mt-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-base">Controller Support</Label>
              <p className="text-sm text-gray-400">Enable controller navigation and gamepad input</p>
            </div>
            <Switch checked={localSettings.enabled} onCheckedChange={handleEnabledChange} />
          </div>

          {localSettings.enabled && (
            <>
              {/* Connection status */}
              <div className="rounded-lg bg-gray-800/50 p-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label className="text-sm font-medium">Connection Status</Label>
                    <div className="flex items-center gap-2">
                      <div className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-500'}`} />
                      <span className="text-sm text-gray-300">
                        {connected ? (controllerInfo.name || 'Controller connected') : 'No controller detected'}
                      </span>
                    </div>
                  </div>
                  <button onClick={checkControllers} className="text-sm text-blue-400 hover:text-blue-300">
                    <RefreshCw size={16} />
                  </button>
                </div>
              </div>

              {/* Controller type */}
              <div className="space-y-2">
                <Label>Controller Type</Label>
                <Select value={localSettings.controllerType} onValueChange={handleControllerTypeChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="generic">Generic</SelectItem>
                    <SelectItem value="xbox">Xbox</SelectItem>
                    <SelectItem value="playstation">PlayStation</SelectItem>
                    <SelectItem value="dualsense">DualSense (PS5)</SelectItem>
                    <SelectItem value="dualshock4">DualShock 4 (PS4)</SelectItem>
                    <SelectItem value="xboxone">Xbox One</SelectItem>
                    <SelectItem value="xboxseries">Xbox Series X</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-400">Affects button prompts and layout</p>
              </div>

              {/* Vibration */}
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-base">Vibration</Label>
                  <p className="text-sm text-gray-400">Enable controller rumble feedback</p>
                </div>
                <Switch checked={localSettings.vibrationEnabled} onCheckedChange={handleVibrationChange} />
              </div>

              {/* Stick deadzone */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Stick Deadzone</Label>
                  <span className="text-sm text-gray-400">{Math.round(localSettings.deadzone * 100)}%</span>
                </div>
                <Slider value={[localSettings.deadzone]} min={0} max={0.5} step={0.01} onValueChange={handleDeadzoneChange} />
                <p className="text-xs text-gray-400">Minimum stick movement required for input</p>
              </div>

              {/* Trigger deadzone */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Trigger Deadzone</Label>
                  <span className="text-sm text-gray-400">{Math.round(localSettings.triggerDeadzone * 100)}%</span>
                </div>
                <Slider value={[localSettings.triggerDeadzone]} min={0} max={0.5} step={0.01} onValueChange={handleTriggerDeadzoneChange} />
                <p className="text-xs text-gray-400">Minimum trigger pressure required for input</p>
              </div>

              {/* Button layout */}
              <div className="space-y-2">
                <Label>Button Layout</Label>
                <Select value={localSettings.buttonLayout} onValueChange={handleButtonLayoutChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default</SelectItem>
                    <SelectItem value="legacy">Legacy</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </TabsContent>

        {/* ── Input Translation Tab ───────────────────────────────────────── */}
        <TabsContent value="input-translation" className="space-y-6 mt-4">
          <div className="rounded-lg bg-purple-900/20 border border-purple-500/30 p-4">
            <div className="flex items-center gap-3 mb-2">
              <Gamepad2 className="text-purple-400" size={20} />
              <Label className="text-base font-medium">Xbox 360 Input Translation (GCPad_Remap)</Label>
            </div>
            <p className="text-sm text-gray-400">
              Translate unsupported controller inputs to Xbox 360 format for better game compatibility
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-base">Enable Input Translation</Label>
              <p className="text-sm text-gray-400">Automatically translate controller inputs</p>
            </div>
            <Switch
              checked={localSettings.inputTranslation?.enabled ?? true}
              onCheckedChange={handleInputTranslationToggle}
            />
          </div>

          {localSettings.inputTranslation?.enabled && (
            <>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-base">Auto-Detect Controller</Label>
                  <p className="text-sm text-gray-400">Automatically detect and apply best mapping</p>
                </div>
                <Switch
                  checked={localSettings.inputTranslation?.autoDetect ?? true}
                  onCheckedChange={handleAutoDetectToggle}
                />
              </div>

              <div className="space-y-2">
                <Label>Controller Mapping Preset</Label>
                <Select
                  value={localSettings.inputTranslation?.mappingPreset || 'auto'}
                  onValueChange={handleMappingPresetChange}
                  disabled={localSettings.inputTranslation?.autoDetect}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto-Detect</SelectItem>
                    <SelectItem value="generic">Generic Controller</SelectItem>
                    <SelectItem value="xbox">Xbox Controller</SelectItem>
                    <SelectItem value="playstation">PlayStation Controller</SelectItem>
                    <SelectItem value="dualsense">DualSense (PS5)</SelectItem>
                    <SelectItem value="dualshock4">DualShock 4 (PS4)</SelectItem>
                    <SelectItem value="xboxone">Xbox One</SelectItem>
                    <SelectItem value="xboxseries">Xbox Series X</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-400">Select your controller type for proper button mapping</p>
              </div>

              <div className="rounded-lg bg-gray-800/50 p-4">
                <Label className="text-sm font-medium mb-3 block">Button Mapping Preview</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="text-xs text-gray-500 uppercase">Native Button</div>
                    {Object.entries(NativeButtonLabels).slice(0, 8).map(([key, label]) => (
                      <div key={key} className="flex items-center justify-between text-sm">
                        <span className="text-gray-300">{label}</span>
                        <ChevronRight size={14} className="text-gray-600" />
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-gray-500 uppercase">Xbox 360 Output</div>
                    {Object.entries(Xbox360ButtonLabels).slice(0, 8).map(([key, label]) => (
                      <div key={key} className="text-sm">
                        <span className="text-purple-400 font-medium">{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </TabsContent>

        {/* ── Key Binding Tab ─────────────────────────────────────────────── */}
        <TabsContent value="key-binding" className="space-y-6 mt-4">
          <div className="rounded-lg bg-blue-900/20 border border-blue-500/30 p-4">
            <div className="flex items-center gap-3 mb-2">
              <Keyboard className="text-blue-400" size={20} />
              <Label className="text-base font-medium">Controller Remapping</Label>
            </div>
            <p className="text-sm text-gray-400">
              Map any button, trigger, or stick to keyboard keys or mouse inputs.
              Click a button row and press a key — or choose a mouse action.
            </p>
          </div>

          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-base">Enable Key Binding</Label>
              <p className="text-sm text-gray-400">Map controller inputs to keyboard / mouse</p>
            </div>
            <Switch
              checked={localSettings.keyBinding?.enabled ?? false}
              onCheckedChange={handleKeyBindingToggle}
            />
          </div>

          {localSettings.keyBinding?.enabled && (
            <>
              {/* ── Profile management ─────────────────────────────────── */}
              <div className="space-y-3">
                <Label>Active Profile</Label>
                <div className="flex gap-2">
                  <Select
                    value={localSettings.keyBinding?.activeProfileId || ''}
                    onValueChange={handleProfileSelect}
                  >
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Select profile" /></SelectTrigger>
                    <SelectContent>
                      {profiles.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline" size="icon"
                    onClick={() => handleDuplicateProfile(activeProfile)}
                    disabled={!activeProfile}
                    title="Duplicate profile"
                  >
                    <Copy size={16} />
                  </Button>
                  <Button
                    variant="outline" size="icon"
                    onClick={() => handleDeleteProfile(activeProfile?.id || '')}
                    disabled={profiles.length <= 1}
                    title="Delete profile"
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="New profile name"
                    value={profileName}
                    onChange={e => setProfileName(e.target.value)}
                    className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white text-sm"
                  />
                  <Button onClick={handleCreateProfile}>
                    <Plus size={16} className="mr-2" />
                    Create
                  </Button>
                </div>
              </div>

              {activeProfile && (
                <>
                  {/* ── Compact Remap Section ─────────────────────────────────── */}
                  <CompactRemapSection 
                    activeProfile={activeProfile} 
                    onUpdateProfile={updateProfile}
                  />
                </>
              )}
            </>
          )}
        </TabsContent>

        {/* ── Overlay Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="overlay" className="space-y-6 mt-4">
          <div className="rounded-lg bg-green-900/20 border border-green-500/30 p-4">
            <div className="flex items-center gap-3 mb-2">
              <Settings className="text-green-400" size={20} />
              <Label className="text-base font-medium">In-Game Overlay</Label>
            </div>
            <p className="text-sm text-gray-400">
              Configure the flyout overlay for quick controller remapping while in-game
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-base">Enable Overlay</Label>
              <p className="text-sm text-gray-400">Show controller remapping flyout in games</p>
            </div>
            <Switch checked={localSettings.overlayEnabled ?? true} onCheckedChange={handleOverlayToggle} />
          </div>

          {localSettings.overlayEnabled && (
            <>
              <div className="space-y-2">
                <Label>Overlay Hotkey</Label>
                <input
                  type="text"
                  value={localSettings.overlayHotkey || 'Guide Button'}
                  onChange={e => handleOverlayHotkeyChange(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white text-sm"
                  placeholder="Guide Button"
                />
                <p className="text-xs text-gray-400">Press the guide button on your controller to open the overlay</p>
              </div>

              <div className="space-y-2">
                <Label>Overlay Position</Label>
                <Select
                  value={localSettings.overlayPosition || 'right'}
                  onValueChange={v => handleOverlayPositionChange(v as 'left' | 'right')}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="left">Left Side</SelectItem>
                    <SelectItem value="right">Right Side</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-lg bg-gray-800/50 p-4">
                <div className="flex items-center gap-2 text-sm text-gray-300">
                  <Gamepad2 size={16} className="text-gray-400" />
                  <span>
                    Press{' '}
                    <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-xs">
                      {localSettings.overlayHotkey || 'Ctrl+Shift+Gamepad'}
                    </kbd>{' '}
                    while in-game to open quick controller settings
                  </span>
                </div>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default ControllerSettingsPanel
