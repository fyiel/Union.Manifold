import { useEffect, useRef, useState } from 'react'
import { useController } from '../hooks/use-controller'

interface ControllerDiagramProps {
  onButtonClick?: (button: string) => void
  compact?: boolean
}

const BUTTON_POSITIONS: Record<string, { x: number; y: number; size?: number }> = {
  // Face buttons
  A: { x: 280, y: 145 },
  B: { x: 310, y: 175 },
  X: { x: 250, y: 175 },
  Y: { x: 280, y: 115 },
  // Bumpers
  LB: { x: 95, y: 85 },
  RB: { x: 245, y: 85 },
  LT: { x: 95, y: 65 },
  RT: { x: 245, y: 65 },
  // Sticks (click)
  LS: { x: 140, y: 185 },
  RS: { x: 200, y: 185 },
  // Menu/Back
  START: { x: 170, y: 85 },
  BACK: { x: 130, y: 85 },
  GUIDE: { x: 150, y: 65 },
  // D-Pad
  DPAD_UP: { x: 75, y: 155 },
  DPAD_DOWN: { x: 75, y: 185 },
  DPAD_LEFT: { x: 55, y: 170 },
  DPAD_RIGHT: { x: 95, y: 170 },
}

const AXIS_POSITIONS: Record<string, { x: number; y: number; radius: number }> = {
  LEFT_X: { x: 140, y: 145, radius: 25 },
  LEFT_Y: { x: 140, y: 145, radius: 25 },
  RIGHT_X: { x: 200, y: 145, radius: 25 },
  RIGHT_Y: { x: 200, y: 145, radius: 25 },
  LT: { x: 95, y: 55, radius: 15 },
  RT: { x: 245, y: 55, radius: 15 },
}

export function ControllerDiagram({ onButtonClick, compact = false }: ControllerDiagramProps) {
  const { connected, controllerInfo } = useController()
  const [pressedButtons, setPressedButtons] = useState<Set<number>>(new Set())
  const [axisValues, setAxisValues] = useState<number[]>(new Array(6).fill(0))
  const animationRef = useRef<number>()

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
          const pressed = new Set<number>()
          state.buttons.forEach((pressed: boolean, idx: number) => {
            if (pressed) pressed.add(idx)
          })
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

  return (
    <div className="relative" style={{ width: 350 * scale, height: 260 * scale }}>
      <svg
        viewBox="0 0 350 260"
        className="w-full h-full"
        style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}
      >
        {/* Controller body */}
        <ellipse cx="175" cy="140" rx="160" ry="100" fill="#1a1a1a" stroke="#333" strokeWidth="2" />
        
        {/* Triggers */}
        <path d="M 70 60 Q 95 40 120 60" fill="#252525" stroke="#444" strokeWidth="1" />
        <path d="M 230 60 Q 255 40 280 60" fill="#252525" stroke="#444" strokeWidth="1" />
        
        {/* Bumpers */}
        <rect x="70" y="75" width="50" height="15" rx="5" fill="#2a2a2a" stroke="#444" />
        <rect x="230" y="75" width="50" height="15" rx="5" fill="#2a2a2a" stroke="#444" />
        
        {/* Left stick area */}
        <circle cx="140" cy="145" r="35" fill="#222" stroke="#444" strokeWidth="1" />
        <circle 
          cx="140 + axisValues[0] * 20" 
          cy="145 + axisValues[1] * 20" 
          r="25" 
          fill="#333" 
          stroke={pressedButtons.has(11) ? '#00ff88' : '#555'}
          strokeWidth={pressedButtons.has(11) ? 3 : 1}
        />
        
        {/* Right stick area */}
        <circle cx="200" cy="145" r="35" fill="#222" stroke="#444" strokeWidth="1" />
        <circle 
          cx="200 + axisValues[2] * 20" 
          cy="145 + axisValues[3] * 20" 
          r="25" 
          fill="#333" 
          stroke={pressedButtons.has(12) ? '#00ff88' : '#555'}
          strokeWidth={pressedButtons.has(12) ? 3 : 1}
        />
        
        {/* D-Pad */}
        <circle cx="75" cy="170" r="25" fill="#222" />
        <rect x="65" y="155" width="20" height="10" rx="2" fill={pressedButtons.has(13) ? '#00ff88' : '#333'} />
        <rect x="65" y="175" width="20" height="10" rx="2" fill={pressedButtons.has(14) ? '#00ff88' : '#333'} />
        <rect x="55" y="165" width="10" height="20" rx="2" fill={pressedButtons.has(15) ? '#00ff88' : '#333'} />
        <rect x="75" y="165" width="10" height="20" rx="2" fill={pressedButtons.has(16) ? '#00ff88' : '#333'} />
        
        {/* Face buttons */}
        <circle cx="280" cy="145" r="12" fill={pressedButtons.has(0) ? '#00ff88' : '#c74b4b'} onClick={() => onButtonClick?.('A')} style={{ cursor: onButtonClick ? 'pointer' : 'default' }} />
        <circle cx="310" cy="175" r="12" fill={pressedButtons.has(1) ? '#00ff88' : '#c7a04b'} onClick={() => onButtonClick?.('B')} style={{ cursor: onButtonClick ? 'pointer' : 'default' }} />
        <circle cx="250" cy="175" r="12" fill={pressedButtons.has(2) ? '#00ff88' : '#4b97c7'} onClick={() => onButtonClick?.('X')} style={{ cursor: onButtonClick ? 'pointer' : 'default' }} />
        <circle cx="280" cy="115" r="12" fill={pressedButtons.has(3) ? '#00ff88' : '#c7c74b'} onClick={() => onButtonClick?.('Y')} style={{ cursor: onButtonClick ? 'pointer' : 'default' }} />
        
        {/* Menu buttons */}
        <rect x="155" y="80" width="30" height="10" rx="3" fill={pressedButtons.has(4) ? '#00ff88' : '#333'} onClick={() => onButtonClick?.('START')} style={{ cursor: onButtonClick ? 'pointer' : 'default' }} />
        <rect x="115" y="80" width="30" height="10" rx="3" fill={pressedButtons.has(5) ? '#00ff88' : '#333'} onClick={() => onButtonClick?.('BACK')} style={{ cursor: onButtonClick ? 'pointer' : 'default' }} />
        
        {/* Guide button */}
        <circle cx="150" cy="55" r="15" fill={pressedButtons.has(6) ? '#00ff88' : '#444'} stroke="#666" strokeWidth="2" onClick={() => onButtonClick?.('GUIDE')} style={{ cursor: onButtonClick ? 'pointer' : 'default' }} />
        
        {/* Trigger indicators */}
        <rect x="70" y="45" width="50" height="10" rx="2" fill="#222">
          <rect x="70" y="45" width={axisValues[4] * 50} height="10" rx="2" fill={axisValues[4] > 0.1 ? '#00ff88' : '#444'} />
        </rect>
        <rect x="230" y="45" width="50" height="10" rx="2" fill="#222">
          <rect x="230" y="45" width={axisValues[5] * 50} height="10" rx="2" fill={axisValues[5] > 0.1 ? '#00ff88' : '#444'} />
        </rect>
      </svg>
      
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