import { useEffect, useRef, useState } from 'react'
import { useController } from '../hooks/use-controller'

interface ControllerDiagramProps {
  onButtonClick?: (button: string) => void
  compact?: boolean
}

const BUTTON_IMAGE_MAP: Record<string, string> = {
  '0': 'a pressed.webp',
  '1': 'b pressed.webp',
  '2': 'x pressed.webp',
  '3': 'y pressed.webp',
  '4': 'start pressed.webp',
  '5': 'select pressed.webp',
  '6': 'guide pressed.webp',
  '7': 'lb pressed.webp',
  '8': 'rb pressed.webp',
  '9': 'lt pressed.webp',
  '10': 'rt pressed.webp',
  '11': 'lsclick.webp',
  '12': 'rsclick.webp',
  '13': 'dpup pressed.webp',
  '14': 'dpdown pressed.webp',
  '15': 'dpleft pressed.webp',
  '16': 'dpright pressed.webp',
  '17': 'dpupright pressed.webp',
  '18': 'dpleftup pressed.webp',
  '19': 'dprightdown pressed.webp',
  '20': 'dpdownleft pressed.webp',
  '21': 'lsmove.webp',
  '22': 'rsmove.webp',
}

const CONTROLLER_PATH = '/controller/'

export function ControllerDiagram({ onButtonClick, compact = false }: ControllerDiagramProps) {
  const { connected, controllerInfo } = useController()
  const [pressedButtons, setPressedButtons] = useState<Set<number>>(new Set())
  const [axisValues, setAxisValues] = useState<number[]>(new Array(6).fill(0))

  useEffect(() => {
    if (!connected) {
      setPressedButtons(new Set())
      setAxisValues(new Array(6).fill(0))
      return
    }

    const handleInput = (event: CustomEvent) => {
      const states = event.detail
      if (states && states.length > 0) {
        const state = states[0]
        if (state.buttons) {
          setPressedButtons(new Set(state.buttons.map((b: boolean, i: number) => b ? i : -1).filter((i: number) => i >= 0)))
        }
        if (state.axes) {
          setAxisValues(state.axes)
        }
      }
    }

    window.addEventListener('uc:controller-input', handleInput as EventListener)
    return () => {
      window.removeEventListener('uc:controller-input', handleInput as EventListener)
    }
  }, [connected])

  const scale = compact ? 0.5 : 1

  const getActiveImage = (): string => {
    if (pressedButtons.size === 0) {
      return 'whole controller.webp'
    }
    
    const pressedArray = Array.from(pressedButtons)
    for (const btn of pressedArray) {
      const img = BUTTON_IMAGE_MAP[btn.toString()]
      if (img) return img
    }
    
    return 'whole controller.webp'
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