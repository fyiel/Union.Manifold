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
  Save, RefreshCw, ChevronRight, X, Check
} from 'lucide-react'
import { createDefaultProfile, ControllerPresets, Xbox360ButtonLabels, NativeButtonLabels, detectControllerType } from '../lib/controller-mappings'

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
    deleteProfile
  } = useController()
  
  const [localSettings, setLocalSettings] = useState<ControllerSettings>(settings)
  const [activeTab, setActiveTab] = useState('general')
  const [editingProfile, setEditingProfile] = useState<ControllerProfile | null>(null)
  const [profileName, setProfileName] = useState('')

  useEffect(() => {
    setLocalSettings(settings)
  }, [settings])

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

  // Input Translation (x360ce-style) handlers
  const handleInputTranslationToggle = async (enabled: boolean) => {
    const newSettings = {
      ...localSettings,
      inputTranslation: { ...localSettings.inputTranslation, enabled }
    }
    setLocalSettings(newSettings)
    await updateSettings({ inputTranslation: newSettings.inputTranslation })
  }

  const handleAutoDetectToggle = async (enabled: boolean) => {
    const newSettings = {
      ...localSettings,
      inputTranslation: { ...localSettings.inputTranslation, autoDetect: enabled }
    }
    setLocalSettings(newSettings)
    await updateSettings({ inputTranslation: newSettings.inputTranslation })
  }

  const handleMappingPresetChange = async (preset: string) => {
    const newSettings = {
      ...localSettings,
      inputTranslation: { ...localSettings.inputTranslation, mappingPreset: preset as ControllerSettings['inputTranslation']['mappingPreset'] }
    }
    setLocalSettings(newSettings)
    await updateSettings({ inputTranslation: newSettings.inputTranslation })
    await setActiveMapping(preset)
  }

  // Key Binding (antimicrox-style) handlers
  const handleKeyBindingToggle = async (enabled: boolean) => {
    const newSettings = {
      ...localSettings,
      keyBinding: { ...localSettings.keyBinding, enabled }
    }
    setLocalSettings(newSettings)
    await updateSettings({ keyBinding: newSettings.keyBinding })
  }

  const handleProfileSelect = async (profileId: string) => {
    await setActiveProfile(profileId)
  }

  const handleCreateProfile = async () => {
    const newProfile = createDefaultProfile(profileName || `Profile ${profiles.length + 1}`)
    await createProfile(newProfile)
    setProfileName('')
  }

  const handleDeleteProfile = async (profileId: string) => {
    if (profiles.length <= 1) return // Keep at least one profile
    await deleteProfile(profileId)
  }

  const handleDuplicateProfile = async (profile: ControllerProfile) => {
    const duplicated: ControllerProfile = {
      ...profile,
      id: `profile_${Date.now()}`,
      name: `${profile.name} (Copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    await createProfile(duplicated)
  }

  // Overlay settings
  const handleOverlayToggle = async (enabled: boolean) => {
    const newSettings = { ...localSettings, overlayEnabled: enabled }
    setLocalSettings(newSettings)
    await updateSettings({ overlayEnabled: enabled })
  }

  const handleOverlayHotkeyChange = async (hotkey: string) => {
    const newSettings = { ...localSettings, overlayHotkey: hotkey }
    setLocalSettings(newSettings)
    await updateSettings({ overlayHotkey: hotkey })
  }

  const handleOverlayPositionChange = async (position: 'left' | 'right') => {
    const newSettings = { ...localSettings, overlayPosition: position }
    setLocalSettings(newSettings)
    await updateSettings({ overlayPosition: position })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-gray-400">Loading controller settings...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-4">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="input-translation">Input Translation</TabsTrigger>
          <TabsTrigger value="key-binding">Key Binding</TabsTrigger>
          <TabsTrigger value="overlay">Overlay</TabsTrigger>
        </TabsList>

        {/* General Tab */}
        <TabsContent value="general" className="space-y-6 mt-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-base">Controller Support</Label>
              <p className="text-sm text-gray-400">
                Enable controller navigation and gamepad input
              </p>
            </div>
            <Switch 
              checked={localSettings.enabled} 
              onCheckedChange={handleEnabledChange}
            />
          </div>

          {localSettings.enabled && (
            <>
              {/* Controller Connection Status */}
              <div className="rounded-lg bg-gray-800/50 p-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label className="text-sm font-medium">Connection Status</Label>
                    <div className="flex items-center gap-2">
                      <div className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-500'}`} />
                      <span className="text-sm text-gray-300">
                        {connected 
                          ? controllerInfo.name || 'Controller connected' 
                          : 'No controller detected'
                        }
                      </span>
                    </div>
                  </div>
                  <button 
                    onClick={checkControllers}
                    className="text-sm text-blue-400 hover:text-blue-300"
                  >
                    <RefreshCw size={16} />
                  </button>
                </div>
              </div>

              {/* Controller Type */}
              <div className="space-y-2">
                <Label>Controller Type</Label>
                <Select 
                  value={localSettings.controllerType} 
                  onValueChange={handleControllerTypeChange}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
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
                <p className="text-xs text-gray-400">
                  Affects button prompts and layout
                </p>
              </div>

              {/* Vibration */}
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-base">Vibration</Label>
                  <p className="text-sm text-gray-400">
                    Enable controller rumble feedback
                  </p>
                </div>
                <Switch 
                  checked={localSettings.vibrationEnabled} 
                  onCheckedChange={handleVibrationChange}
                />
              </div>

              {/* Deadzone */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Stick Deadzone</Label>
                  <span className="text-sm text-gray-400">
                    {Math.round(localSettings.deadzone * 100)}%
                  </span>
                </div>
                <Slider 
                  value={[localSettings.deadzone]} 
                  min={0} 
                  max={0.5} 
                  step={0.01}
                  onValueChange={handleDeadzoneChange}
                />
                <p className="text-xs text-gray-400">
                  Minimum stick movement required for input
                </p>
              </div>

              {/* Trigger Deadzone */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Trigger Deadzone</Label>
                  <span className="text-sm text-gray-400">
                    {Math.round(localSettings.triggerDeadzone * 100)}%
                  </span>
                </div>
                <Slider 
                  value={[localSettings.triggerDeadzone]} 
                  min={0} 
                  max={0.5} 
                  step={0.01}
                  onValueChange={handleTriggerDeadzoneChange}
                />
                <p className="text-xs text-gray-400">
                  Minimum trigger pressure required for input
                </p>
              </div>

              {/* Button Layout */}
              <div className="space-y-2">
                <Label>Button Layout</Label>
                <Select 
                  value={localSettings.buttonLayout} 
                  onValueChange={handleButtonLayoutChange}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default</SelectItem>
                    <SelectItem value="legacy">Legacy</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-400">
                  Choose button layout for prompts
                </p>
              </div>
            </>
          )}
        </TabsContent>

        {/* Input Translation Tab (x360ce-style) */}
        <TabsContent value="input-translation" className="space-y-6 mt-4">
          <div className="rounded-lg bg-purple-900/20 border border-purple-500/30 p-4">
            <div className="flex items-center gap-3 mb-2">
              <Gamepad2 className="text-purple-400" size={20} />
              <Label className="text-base font-medium">x360ce-Style Input Translation</Label>
            </div>
            <p className="text-sm text-gray-400">
              Translate unsupported controller inputs (Windows/PS4/PS5) to Xbox 360 format for better game compatibility
            </p>
          </div>

          {/* Enable Input Translation */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-base">Enable Input Translation</Label>
              <p className="text-sm text-gray-400">
                Automatically translate controller inputs
              </p>
            </div>
            <Switch 
              checked={localSettings.inputTranslation?.enabled ?? true} 
              onCheckedChange={handleInputTranslationToggle}
            />
          </div>

          {localSettings.inputTranslation?.enabled && (
            <>
              {/* Auto-Detect */}
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-base">Auto-Detect Controller</Label>
                  <p className="text-sm text-gray-400">
                    Automatically detect and apply best mapping
                  </p>
                </div>
                <Switch 
                  checked={localSettings.inputTranslation?.autoDetect ?? true} 
                  onCheckedChange={handleAutoDetectToggle}
                />
              </div>

              {/* Mapping Preset */}
              <div className="space-y-2">
                <Label>Controller Mapping Preset</Label>
                <Select 
                  value={localSettings.inputTranslation?.mappingPreset || 'auto'} 
                  onValueChange={handleMappingPresetChange}
                  disabled={localSettings.inputTranslation?.autoDetect}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
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
                <p className="text-xs text-gray-400">
                  Select your controller type for proper button mapping
                </p>
              </div>

              {/* Current Mapping Display */}
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
                      <div key={key} className="flex items-center justify-between text-sm">
                        <span className="text-purple-400 font-medium">{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </TabsContent>

        {/* Key Binding Tab (antimicrox-style) */}
        <TabsContent value="key-binding" className="space-y-6 mt-4">
          <div className="rounded-lg bg-blue-900/20 border border-blue-500/30 p-4">
            <div className="flex items-center gap-3 mb-2">
              <Keyboard className="text-blue-400" size={20} />
              <Label className="text-base font-medium">antimicrox-Style Key Binding</Label>
            </div>
            <p className="text-sm text-gray-400">
              Remap controller buttons, triggers, and sticks to keyboard and mouse inputs for games without controller support
            </p>
          </div>

          {/* Enable Key Binding */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-base">Enable Key Binding</Label>
              <p className="text-sm text-gray-400">
                Map controller inputs to keyboard/mouse
              </p>
            </div>
            <Switch 
              checked={localSettings.keyBinding?.enabled ?? false} 
              onCheckedChange={handleKeyBindingToggle}
            />
          </div>

          {localSettings.keyBinding?.enabled && (
            <>
              {/* Profile Selection */}
              <div className="space-y-3">
                <Label>Active Profile</Label>
                <div className="flex gap-2">
                  <Select 
                    value={localSettings.keyBinding?.activeProfileId || ''} 
                    onValueChange={handleProfileSelect}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select profile" />
                    </SelectTrigger>
                    <SelectContent>
                      {profiles.map(profile => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button 
                    variant="outline" 
                    size="icon"
                    onClick={() => handleDuplicateProfile(activeProfile!)}
                    title="Duplicate profile"
                  >
                    <Copy size={16} />
                  </Button>
                  <Button 
                    variant="outline" 
                    size="icon"
                    onClick={() => handleDeleteProfile(activeProfile?.id || '')}
                    disabled={profiles.length <= 1}
                    title="Delete profile"
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </div>

              {/* Create New Profile */}
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="New profile name"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white text-sm"
                />
                <Button onClick={handleCreateProfile}>
                  <Plus size={16} className="mr-2" />
                  Create
                </Button>
              </div>

              {/* Mouse Settings */}
              {activeProfile && (
                <div className="rounded-lg bg-gray-800/50 p-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <Mouse size={16} className="text-gray-400" />
                    <Label className="text-sm font-medium">Stick to Mouse Settings</Label>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">Left Stick to Mouse</span>
                    <Switch 
                      checked={activeProfile.keyBinding?.stickToMouse?.leftStick ?? false} 
                      onCheckedChange={(checked) => {
                        const updated = {
                          ...activeProfile,
                          keyBinding: {
                            ...activeProfile.keyBinding,
                            stickToMouse: {
                              leftStick: checked,
                              rightStick: activeProfile.keyBinding?.stickToMouse?.rightStick ?? false,
                              mouseSpeed: activeProfile.keyBinding?.stickToMouse?.mouseSpeed ?? 1.0,
                              mouseAcceleration: activeProfile.keyBinding?.stickToMouse?.mouseAcceleration ?? false
                            }
                          }
                        }
                        updateProfile(updated)
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">Right Stick to Mouse</span>
                    <Switch 
                      checked={activeProfile.keyBinding?.stickToMouse?.rightStick ?? false} 
                      onCheckedChange={(checked) => {
                        const updated = {
                          ...activeProfile,
                          keyBinding: {
                            ...activeProfile.keyBinding,
                            stickToMouse: {
                              leftStick: activeProfile.keyBinding?.stickToMouse?.leftStick ?? false,
                              rightStick: checked,
                              mouseSpeed: activeProfile.keyBinding?.stickToMouse?.mouseSpeed ?? 1.0,
                              mouseAcceleration: activeProfile.keyBinding?.stickToMouse?.mouseAcceleration ?? false
                            }
                          }
                        }
                        updateProfile(updated)
                      }}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Mouse Speed</Label>
                      <span className="text-sm text-gray-400">
                        {activeProfile.keyBinding?.stickToMouse?.mouseSpeed ?? 1.0}x
                      </span>
                    </div>
                    <Slider 
                      value={[activeProfile.keyBinding?.stickToMouse?.mouseSpeed ?? 1.0]} 
                      min={0.1} 
                      max={3.0} 
                      step={0.1}
                      onValueChange={([value]) => {
                        const updated = {
                          ...activeProfile,
                          keyBinding: {
                            ...activeProfile.keyBinding,
                            stickToMouse: {
                              leftStick: activeProfile.keyBinding?.stickToMouse?.leftStick ?? false,
                              rightStick: activeProfile.keyBinding?.stickToMouse?.rightStick ?? false,
                              mouseSpeed: value,
                              mouseAcceleration: activeProfile.keyBinding?.stickToMouse?.mouseAcceleration ?? false
                            }
                          }
                        }
                        updateProfile(updated)
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Scroll Settings */}
              {activeProfile && (
                <div className="rounded-lg bg-gray-800/50 p-4 space-y-4">
                  <Label className="text-sm font-medium">Trigger to Scroll</Label>
                  
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">Left Trigger to Scroll</span>
                    <Switch 
                      checked={activeProfile.keyBinding?.triggerToScroll?.leftTrigger ?? false} 
                      onCheckedChange={(checked) => {
                        const updated = {
                          ...activeProfile,
                          keyBinding: {
                            ...activeProfile.keyBinding,
                            triggerToScroll: {
                              leftTrigger: checked,
                              rightTrigger: activeProfile.keyBinding?.triggerToScroll?.rightTrigger ?? false,
                              scrollSpeed: activeProfile.keyBinding?.triggerToScroll?.scrollSpeed ?? 1.0
                            }
                          }
                        }
                        updateProfile(updated)
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">Right Trigger to Scroll</span>
                    <Switch 
                      checked={activeProfile.keyBinding?.triggerToScroll?.rightTrigger ?? false} 
                      onCheckedChange={(checked) => {
                        const updated = {
                          ...activeProfile,
                          keyBinding: {
                            ...activeProfile.keyBinding,
                            triggerToScroll: {
                              leftTrigger: activeProfile.keyBinding?.triggerToScroll?.leftTrigger ?? false,
                              rightTrigger: checked,
                              scrollSpeed: activeProfile.keyBinding?.triggerToScroll?.scrollSpeed ?? 1.0
                            }
                          }
                        }
                        updateProfile(updated)
                      }}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* Overlay Tab */}
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

          {/* Enable Overlay */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-base">Enable Overlay</Label>
              <p className="text-sm text-gray-400">
                Show controller remapping flyout in games
              </p>
            </div>
            <Switch 
              checked={localSettings.overlayEnabled ?? true} 
              onCheckedChange={handleOverlayToggle}
            />
          </div>

          {localSettings.overlayEnabled && (
            <>
              {/* Overlay Hotkey */}
              <div className="space-y-2">
                <Label>Overlay Hotkey</Label>
                <input
                  type="text"
                  value={localSettings.overlayHotkey || 'Ctrl+Shift+Gamepad'}
                  onChange={(e) => handleOverlayHotkeyChange(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white text-sm"
                  placeholder="Ctrl+Shift+Gamepad"
                />
                <p className="text-xs text-gray-400">
                  Keyboard shortcut to open the controller overlay
                </p>
              </div>

              {/* Overlay Position */}
              <div className="space-y-2">
                <Label>Overlay Position</Label>
                <Select 
                  value={localSettings.overlayPosition || 'right'} 
                  onValueChange={(value) => handleOverlayPositionChange(value as 'left' | 'right')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="left">Left Side</SelectItem>
                    <SelectItem value="right">Right Side</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-400">
                  Where the overlay panel appears on screen
                </p>
              </div>

              {/* Overlay Info */}
              <div className="rounded-lg bg-gray-800/50 p-4">
                <div className="flex items-center gap-2 text-sm text-gray-300">
                  <Gamepad2 size={16} className="text-gray-400" />
                  <span>Press <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-xs">Ctrl+Shift+Gamepad</kbd> while in-game to open quick controller settings</span>
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
