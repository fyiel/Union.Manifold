import { useController, ControllerProfile } from '../hooks/use-controller'
import { Switch } from './ui/switch'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Slider } from './ui/slider'
import { Button } from './ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { useEffect, useState, useCallback } from 'react'
import {
  Gamepad2, Plus, Trash2, Copy, Settings, Keyboard, Mouse,
  RefreshCw, ChevronRight, X, Pencil, GripHorizontal,
} from 'lucide-react'
import {
  createDefaultProfile,
  Xbox360ButtonLabels,
  NativeButtonLabels,
  NativeButton,
  InputAction,
} from '../lib/controller-mappings'
import { ControllerDiagram } from './ControllerDiagram'

const BUTTON_MAP: Array<{ key: NativeButton; label: string; group: string }> = [
  { key: NativeButton.A, label: 'A', group: 'face' },
  { key: NativeButton.B, label: 'B', group: 'face' },
  { key: NativeButton.X, label: 'X', group: 'face' },
  { key: NativeButton.Y, label: 'Y', group: 'face' },
  { key: NativeButton.LB, label: 'LB', group: 'bumper' },
  { key: NativeButton.RB, label: 'RB', group: 'bumper' },
  { key: NativeButton.LT, label: 'LT', group: 'trigger' },
  { key: NativeButton.RT, label: 'RT', group: 'trigger' },
  { key: NativeButton.LS, label: 'L3', group: 'stick' },
  { key: NativeButton.RS, label: 'R3', group: 'stick' },
  { key: NativeButton.START, label: 'Start', group: 'menu' },
  { key: NativeButton.BACK, label: 'Back', group: 'menu' },
  { key: NativeButton.GUIDE, label: 'Guide', group: 'menu' },
  { key: NativeButton.DPAD_UP, label: 'D-Pad Up', group: 'dpad' },
  { key: NativeButton.DPAD_DOWN, label: 'D-Pad Down', group: 'dpad' },
  { key: NativeButton.DPAD_LEFT, label: 'D-Pad Left', group: 'dpad' },
  { key: NativeButton.DPAD_RIGHT, label: 'D-Pad Right', group: 'dpad' },
]

function formatActionSimple(action: InputAction | undefined): string {
  if (!action || action.type === 'none') return ''
  if (action.type === 'keyboard') {
    const { key, modifiers } = action.key
    const parts: string[] = []
    if (modifiers?.ctrl) parts.push('Ctrl')
    if (modifiers?.alt) parts.push('Alt')
    if (modifiers?.shift) parts.push('Shift')
    if (modifiers?.meta) parts.push('Win')
    parts.push(key === ' ' ? 'Space' : key.toUpperCase())
    return parts.join('+')
  }
  if (action.type === 'mouse') {
    const { input } = action
    if (input.type === 'scroll') return input.direction === 'up' ? '↑ Scroll' : '↓ Scroll'
    if (input.button === 'left') return 'Left Click'
    if (input.button === 'right') return 'Right Click'
    if (input.button === 'middle') return 'Middle Click'
    return 'Mouse'
  }
  return ''
}

function actionBadgeClass(action: InputAction | undefined) {
  if (!action || action.type === 'none') return 'bg-gray-700 text-gray-500'
  if (action.type === 'keyboard') return 'bg-blue-600/70 text-blue-200'
  if (action.type === 'mouse') return 'bg-cyan-600/70 text-cyan-200'
  return 'bg-gray-700 text-gray-500'
}

interface CompactRemapSectionProps {
  activeProfile: ControllerProfile | null
  onUpdateProfile: (profile: ControllerProfile) => void
}

export function CompactRemapSection({ activeProfile, onUpdateProfile }: CompactRemapSectionProps) {
  const [selectedButton, setSelectedButton] = useState<NativeButton | null>(null)
  const [isListening, setIsListening] = useState(false)
  const [tempBinding, setTempBinding] = useState<InputAction | null>(null)

  const handleButtonClick = (button: NativeButton) => {
    if (selectedButton === button) {
      setSelectedButton(null)
      return
    }
    setSelectedButton(button)
    setTempBinding(null)
  }

  const handleKeyPress = useCallback((e: KeyboardEvent) => {
    if (!isListening || !selectedButton) return
    
    e.preventDefault()
    e.stopPropagation()
    
    const modifiers = {
      ctrl: e.ctrlKey,
      alt: e.altKey,
      shift: e.shiftKey,
      meta: e.metaKey,
    }
    
    const key = e.key === ' ' ? ' ' : e.key
    const code = e.code
    
    const action: InputAction = {
      type: 'keyboard',
      key: { key, code, modifiers },
    }
    
    setTempBinding(action)
    setIsListening(false)
  }, [isListening, selectedButton])

  useEffect(() => {
    if (isListening) {
      window.addEventListener('keydown', handleKeyPress)
      return () => window.removeEventListener('keydown', handleKeyPress)
    }
  }, [isListening, handleKeyPress])

  const saveBinding = (button: NativeButton, action: InputAction) => {
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
    
    onUpdateProfile(updated)
    setSelectedButton(null)
    setTempBinding(null)
  }

  const currentBinding = selectedButton && activeProfile?.keyBinding?.buttonMappings
    ? (activeProfile.keyBinding.buttonMappings as Record<string, InputAction>)[selectedButton]
    : undefined

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        {/* Controller Diagram */}
        <div className="flex-shrink-0">
          <ControllerDiagram onButtonClick={(button) => handleButtonClick(button as NativeButton)} />
        </div>
        
        {/* Button mapping list */}
        <div className="flex-1 space-y-2 max-h-[200px] overflow-y-auto">
          <div className="text-xs font-medium text-gray-500 uppercase mb-2">Buttons</div>
          {BUTTON_MAP.map(({ key, label }) => {
            const binding = activeProfile?.keyBinding?.buttonMappings
              ? (activeProfile.keyBinding.buttonMappings as Record<string, InputAction>)[key]
              : undefined
            const isSelected = selectedButton === key
            
            return (
              <button
                key={key}
                onClick={() => handleButtonClick(key)}
                className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-sm transition-colors text-left ${
                  isSelected 
                    ? 'bg-blue-600/30 border border-blue-500' 
                    : 'bg-gray-800/40 hover:bg-gray-800/80'
                }`}
              >
                <span className="text-gray-300">{label}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${actionBadgeClass(binding)}`}>
                  {formatActionSimple(binding) || '—'}
                </span>
              </button>
            )
          })}
        </div>
      </div>
      
      {/* Selected button binding UI */}
      {selectedButton && (
        <div className="rounded-lg bg-gray-800/60 p-4 border border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <GripHorizontal size={16} className="text-gray-400" />
              <span className="font-medium text-white">
                Mapping: {BUTTON_MAP.find(b => b.key === selectedButton)?.label}
              </span>
            </div>
            <button
              onClick={() => { setSelectedButton(null); setTempBinding(null) }}
              className="text-gray-400 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>
          
          {/* Current binding display */}
          <div className="flex items-center gap-3 mb-3">
            <span className="text-sm text-gray-400">Current:</span>
            <span className={`text-sm px-2 py-1 rounded ${actionBadgeClass(tempBinding || currentBinding)}`}>
              {formatActionSimple(tempBinding || currentBinding) || 'None'}
            </span>
          </div>
          
          {/* Binding options */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={isListening ? 'default' : 'outline'}
              size="sm"
              onClick={() => setIsListening(!isListening)}
              className={isListening ? 'bg-green-600 hover:bg-green-700' : ''}
            >
              <Keyboard size={14} className="mr-2" />
              {isListening ? 'Press a key...' : 'Map Key'}
            </Button>
            
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => saveBinding(selectedButton, { type: 'mouse', input: { type: 'click', button: 'left' } })}
              >
                <Mouse size={14} />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => saveBinding(selectedButton, { type: 'mouse', input: { type: 'right_click' } })}
              >
                R
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => saveBinding(selectedButton, { type: 'mouse', input: { type: 'scroll', direction: 'up' } })}
              >
                ↑
              </Button>
            </div>
          </div>
          
          {/* Save/Clear buttons */}
          <div className="flex gap-2 mt-3 pt-3 border-t border-gray-700">
            {tempBinding && (
              <Button size="sm" onClick={() => saveBinding(selectedButton, tempBinding)}>
                Save Binding
              </Button>
            )}
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => saveBinding(selectedButton, { type: 'none' })}
              disabled={!currentBinding && !tempBinding}
            >
              Clear
            </Button>
          </div>
        </div>
      )}
      
      {/* Mouse/Stick settings */}
      <div className="grid grid-cols-2 gap-4">
        {/* Stick to Mouse */}
        <div className="rounded-lg bg-gray-800/50 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Mouse size={16} className="text-gray-400" />
            <Label className="text-sm font-medium">Stick to Mouse</Label>
          </div>
          
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">Left Stick</span>
            <Switch
              checked={activeProfile?.keyBinding?.stickToMouse?.leftStick ?? false}
              onCheckedChange={(checked) => {
                if (!activeProfile) return
                onUpdateProfile({
                  ...activeProfile,
                  keyBinding: {
                    ...activeProfile.keyBinding,
                    stickToMouse: {
                      leftStick: checked,
                      rightStick: activeProfile.keyBinding?.stickToMouse?.rightStick ?? false,
                      mouseSpeed: activeProfile.keyBinding?.stickToMouse?.mouseSpeed ?? 1.0,
                      mouseAcceleration: activeProfile.keyBinding?.stickToMouse?.mouseAcceleration ?? true,
                    },
                  },
                  updatedAt: Date.now(),
                })
              }}
            />
          </div>
          
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">Right Stick</span>
            <Switch
              checked={activeProfile?.keyBinding?.stickToMouse?.rightStick ?? false}
              onCheckedChange={(checked) => {
                if (!activeProfile) return
                onUpdateProfile({
                  ...activeProfile,
                  keyBinding: {
                    ...activeProfile.keyBinding,
                    stickToMouse: {
                      leftStick: activeProfile.keyBinding?.stickToMouse?.leftStick ?? false,
                      rightStick: checked,
                      mouseSpeed: activeProfile.keyBinding?.stickToMouse?.mouseSpeed ?? 1.0,
                      mouseAcceleration: activeProfile.keyBinding?.stickToMouse?.mouseAcceleration ?? true,
                    },
                  },
                  updatedAt: Date.now(),
                })
              }}
            />
          </div>
          
          {(activeProfile?.keyBinding?.stickToMouse?.leftStick || activeProfile?.keyBinding?.stickToMouse?.rightStick) && (
            <>
              <div className="flex items-center justify-between pt-2">
                <Label className="text-xs">Sensitivity</Label>
                <span className="text-xs text-gray-400">
                  {((activeProfile?.keyBinding?.stickToMouse?.mouseSpeed ?? 1.0) * 100).toFixed(0)}%
                </span>
              </div>
              <Slider
                value={[activeProfile?.keyBinding?.stickToMouse?.mouseSpeed ?? 1.0]}
                min={0.1} max={10.0} step={0.1}
                onValueChange={([v]) => {
                  if (!activeProfile) return
                  onUpdateProfile({
                    ...activeProfile,
                    keyBinding: {
                      ...activeProfile.keyBinding,
                      stickToMouse: {
                        leftStick: activeProfile.keyBinding?.stickToMouse?.leftStick ?? false,
                        rightStick: activeProfile.keyBinding?.stickToMouse?.rightStick ?? false,
                        mouseSpeed: v,
                        mouseAcceleration: activeProfile.keyBinding?.stickToMouse?.mouseAcceleration ?? true,
                      },
                    },
                    updatedAt: Date.now(),
                  })
                }}
              />
            </>
          )}
        </div>
        
        {/* Deadzone */}
        <div className="rounded-lg bg-gray-800/50 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Settings size={16} className="text-gray-400" />
            <Label className="text-sm font-medium">Deadzone</Label>
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-300">Stick</span>
              <span className="text-xs text-gray-400">{((activeProfile?.deadzone ?? 0.15) * 100).toFixed(0)}%</span>
            </div>
            <Slider
              value={[activeProfile?.deadzone ?? 0.15]}
              min={0} max={0.5} step={0.01}
              onValueChange={([v]) => {
                if (!activeProfile) return
                onUpdateProfile({ ...activeProfile, deadzone: v, updatedAt: Date.now() })
              }}
            />
          </div>
          
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-300">Trigger</span>
              <span className="text-xs text-gray-400">{((activeProfile?.triggerDeadzone ?? 0.1) * 100).toFixed(0)}%</span>
            </div>
            <Slider
              value={[activeProfile?.triggerDeadzone ?? 0.1]}
              min={0} max={0.5} step={0.01}
              onValueChange={([v]) => {
                if (!activeProfile) return
                onUpdateProfile({ ...activeProfile, triggerDeadzone: v, updatedAt: Date.now() })
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default CompactRemapSection