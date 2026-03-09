import { useController, ControllerSettings } from '../hooks/use-controller'
import { Switch } from './ui/switch'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Slider } from './ui/slider'
import { useEffect, useState } from 'react'

export function ControllerSettingsPanel() {
  const { 
    settings, 
    connected, 
    controllerInfo, 
    loading, 
    updateSettings, 
    setEnabled,
    checkControllers 
  } = useController()
  
  const [localSettings, setLocalSettings] = useState<ControllerSettings>(settings)

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

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-gray-400">Loading controller settings...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-4">
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
                Refresh
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
    </div>
  )
}

export default ControllerSettingsPanel
