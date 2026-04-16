import { useEffect, useRef, useState } from 'react'
import { useController } from '../hooks/use-controller'
import type { RawControllerState } from '../types/controller.d'

interface ControllerDiagramProps {
  onButtonClick?: (button: string) => void
  compact?: boolean
}

const BUTTON_IMAGE_MAP: Record<string, string> = {
  '0': 'a-pressed.webp',
  '1': 'b-pressed.webp',
  '2': 'x-pressed.webp',
  '3': 'y-pressed.webp',
  '4': 'start-pressed.webp',
  '5': 'select-pressed.webp',
  '6': 'guide-pressed.webp',
  '7': 'lb-pressed.webp',
  '8': 'rb-pressed.webp',
  '9': 'lt-pressed.webp',
  '10': 'rt-pressed.webp',
  '11': 'lsclick.webp',
  '12': 'rsclick.webp',
  '13': 'dpup-pressed.webp',
  '14': 'dpdown-pressed.webp',
  '15': 'dpleft-pressed.webp',
  '16': 'dpright-pressed.webp',
}

const CONTROLLER_PATH = '/controller/'

export function ControllerDiagram({ onButtonClick, compact = false }: ControllerDiagramProps) {
  const { connected } = useController()
  const [pressedButtons, setPressedButtons] = useState<Set<number>>(new Set())
  const [axisValues, setAxisValues] = useState<number[]>(new Array(6).fill(0))

  useEffect(() => {
    if (!connected) {
      setPressedButtons(new Set())
      setAxisValues(new Array(6).fill(0))
      return
    }

    const unsubInput = window.ucController?.onControllerInput?.((data: RawControllerState) => {
      if (data.buttons) {
        setPressedButtons(new Set(data.buttons.map((pressed, idx) => pressed ? idx : -1).filter(idx => idx >= 0)))
      }
      if (data.axes) {
        setAxisValues(data.axes)
      }
    })

    return () => {
      unsubInput?.()
    }
  }, [connected])

  const scale = compact ? 0.5 : 1

  const getActiveImage = (): string => {
    if (pressedButtons.size === 0) {
      // Check for stick movement
      const leftStickMoved = axisValues[0] !== 0 || axisValues[1] !== 0
      const rightStickMoved = axisValues[2] !== 0 || axisValues[3] !== 0
      
      if (leftStickMoved && rightStickMoved) {
        return 'whole-controller.webp' // Both sticks moved - could add combo image
      }
      if (leftStickMoved) {
        return 'lsmove.webp'
      }
      if (rightStickMoved) {
        return 'rsmove.webp'
      }
      return 'whole-controller.webp'
    }
    
    const pressedArray = Array.from(pressedButtons)
    
    // D-pad diagonals take priority over single directions
    const hasUpRight = pressedArray.includes(13) && pressedArray.includes(16)
    const hasLeftUp = pressedArray.includes(13) && pressedArray.includes(15)
    const hasRightDown = pressedArray.includes(16) && pressedArray.includes(14)
    const hasDownLeft = pressedArray.includes(14) && pressedArray.includes(15)
    
    if (hasUpRight) return 'dpupright-pressed.webp'
    if (hasLeftUp) return 'dpleftup-pressed.webp'
    if (hasRightDown) return 'dprightdown-pressed.webp'
    if (hasDownLeft) return 'dpdownleft-pressed.webp'
    
    for (const btn of pressedArray) {
      const img = BUTTON_IMAGE_MAP[btn.toString()]
      if (img) return img
    }
    
    return 'whole-controller.webp'
  }

  const activeImage = getActiveImage()

  return (
    <div className="relative" style={{ width: 350 * scale, height: 260 * scale }}>
      <img
        src={`${CONTROLLER_PATH}${activeImage}`}
        alt="Controller"
        className="w-full h-full"
        style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}
      />
      
      {!connected && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
          <span className="text-gray-400 text-sm">No controller connected</span>
        </div>
      )}
    </div>
  )
}

// Simple button label component for the compact UI
export function ControllerButtonLabel({ button, label }: { button: string; label: string }) {
  const colors: Record<string, string> = {
    A: 'bg-red-500',
    B: 'bg-yellow-500',
    X: 'bg-blue-500',
    Y: 'bg-green-500',
  }
  
  return (
    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${colors[button] || 'bg-gray-500'}`}>
      {button}
    </div>
  )
}
