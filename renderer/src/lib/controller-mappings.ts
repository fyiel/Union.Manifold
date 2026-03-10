/**
 * Controller Input Mapping System
 * 
 * x360ce-style: Translates unsupported controller inputs to Xbox 360 inputs
 * antimicrox-style: Remaps controller inputs to keyboard and mouse inputs
 */

// Standard Xbox 360 Controller Button/Input IDs
export enum Xbox360Button {
  A = 'a',
  B = 'b',
  X = 'x',
  Y = 'y',
  LB = 'lb',
  RB = 'rb',
  BACK = 'back',
  START = 'start',
  LS = 'ls',
  RS = 'rs',
  DPAD_UP = 'dpad_up',
  DPAD_DOWN = 'dpad_down',
  DPAD_LEFT = 'dpad_left',
  DPAD_RIGHT = 'dpad_right',
}

export enum Xbox360Axis {
  LEFT_X = 'left_x',
  LEFT_Y = 'left_y',
  RIGHT_X = 'right_x',
  RIGHT_Y = 'right_y',
  LEFT_TRIGGER = 'lt',
  RIGHT_TRIGGER = 'rt',
}

// Native controller button definitions (for mapping source inputs)
export enum NativeButton {
  // Face buttons
  A = 'native_a',
  B = 'native_b',
  X = 'native_x',
  Y = 'native_y',
  // Shoulder buttons
  LB = 'native_lb',
  RB = 'native_rb',
  LT = 'native_lt',
  RT = 'native_rt',
  // Stick buttons
  LS = 'native_ls',
  RS = 'native_rs',
  // Menu buttons
  BACK = 'native_back',
  START = 'native_start',
  // D-Pad
  DPAD_UP = 'native_dpad_up',
  DPAD_DOWN = 'native_dpad_down',
  DPAD_LEFT = 'native_dpad_left',
  DPAD_RIGHT = 'native_dpad_right',
  // Special
  GUIDE = 'native_guide',
  TOUCHPAD = 'native_touchpad',
  SHARE = 'native_share',
}

export enum NativeAxis {
  LEFT_X = 'native_left_x',
  LEFT_Y = 'native_left_y',
  RIGHT_X = 'native_right_x',
  RIGHT_Y = 'native_right_y',
  LEFT_TRIGGER = 'native_lt_axis',
  RIGHT_TRIGGER = 'native_rt_axis',
}

// Keyboard key definitions
export interface KeyboardKey {
  key: string
  code: string
  modifiers?: {
    ctrl?: boolean
    shift?: boolean
    alt?: boolean
    meta?: boolean
  }
}

// Mouse input definitions
export interface MouseInput {
  type: 'move' | 'click' | 'right_click' | 'middle_click' | 'scroll'
  button?: 'left' | 'right' | 'middle'
  direction?: 'up' | 'down'
  deltaX?: number
  deltaY?: number
}

// Combined output action (can be keyboard, mouse, or virtual Xbox input)
export type InputAction = 
  | { type: 'keyboard'; key: KeyboardKey }
  | { type: 'mouse'; input: MouseInput }
  | { type: 'xbox360'; button?: Xbox360Button; axis?: Xbox360Axis; value?: number }
  | { type: 'none' }

// Input mapping: native controller input -> Xbox 360 output
export interface ControllerMapping {
  id: string
  name: string
  sourceController: 'generic' | 'xbox' | 'playstation' | 'switch' | 'dualsense' | 'dualshock4' | 'xboxone' | 'xboxseries'
  mappings: {
    [key in NativeButton]?: Xbox360Button
  } & {
    [key in NativeAxis]?: {
      axis: Xbox360Axis
      invert?: boolean
      deadzone?: number
    }
  }
}

// Key binding: controller input -> keyboard/mouse output (antimicrox-style)
export interface KeyBinding {
  id: string
  name: string
  profileName: string
  enabled: boolean
  // Button mappings
  buttonMappings: {
    [key in NativeButton]?: InputAction
  } & {
    [key in NativeAxis]?: InputAction & { sensitivity?: number }
  }
  // Stick to mouse mapping options
  stickToMouse?: {
    leftStick: boolean
    rightStick: boolean
    mouseSpeed: number
    mouseAcceleration: boolean
  }
  // Trigger to mouse scroll
  triggerToScroll?: {
    leftTrigger: boolean
    rightTrigger: boolean
    scrollSpeed: number
  }
}

// Controller profile (collection of settings for a specific game/app)
export interface ControllerProfile {
  id: string
  name: string
  appid?: string // Optional game association
  createdAt: number
  updatedAt: number
  // x360ce-style settings
  mappingEnabled: boolean
  controllerMapping: ControllerMapping
  // antimicrox-style settings
  keyBindingEnabled: boolean
  keyBinding: KeyBinding
  // General settings
  deadzone: number
  triggerDeadzone: number
  vibrationEnabled: boolean
  vibrationIntensity: number
}

// Complete controller settings
export interface ControllerSettings {
  // Basic settings
  enabled: boolean
  controllerType: 'xbox' | 'playstation' | 'generic' | 'dualsense' | 'xboxone' | 'xboxseries'
  vibrationEnabled: boolean
  deadzone: number
  triggerDeadzone: number
  buttonLayout: 'default' | 'legacy'
  
  // x360ce-style input translation
  inputTranslation: {
    enabled: boolean
    // Auto-detect controller type and apply appropriate mapping
    autoDetect: boolean
    // Manual mapping override
    mappingPreset: 'auto' | 'generic' | 'xbox' | 'playstation' | 'dualsense' | 'dualshock4' | 'xboxone' | 'xboxseries'
    // Custom mapping (if not using preset)
    customMapping?: ControllerMapping
  }
  
  // antimicrox-style key binding
  keyBinding: {
    enabled: boolean
    // Active profile ID
    activeProfileId: string | null
    // All profiles
    profiles: ControllerProfile[]
    // Default profile (used when no game-specific profile exists)
    defaultProfileId: string | null
  }
  
  // In-overlay settings
  overlayEnabled: boolean
  overlayHotkey: string
  overlayPosition: 'left' | 'right'
}

// Default Xbox 360-style button labels for UI
export const Xbox360ButtonLabels: Record<Xbox360Button, string> = {
  [Xbox360Button.A]: 'A',
  [Xbox360Button.B]: 'B',
  [Xbox360Button.X]: 'X',
  [Xbox360Button.Y]: 'Y',
  [Xbox360Button.LB]: 'LB',
  [Xbox360Button.RB]: 'RB',
  [Xbox360Button.BACK]: 'Back',
  [Xbox360Button.START]: 'Start',
  [Xbox360Button.LS]: 'L3',
  [Xbox360Button.RS]: 'R3',
  [Xbox360Button.DPAD_UP]: 'D-Pad Up',
  [Xbox360Button.DPAD_DOWN]: 'D-Pad Down',
  [Xbox360Button.DPAD_LEFT]: 'D-Pad Left',
  [Xbox360Button.DPAD_RIGHT]: 'D-Pad Right',
}

// Native button labels for UI
export const NativeButtonLabels: Record<NativeButton | NativeAxis, string> = {
  // Face buttons
  [NativeButton.A]: 'Button A',
  [NativeButton.B]: 'Button B',
  [NativeButton.X]: 'Button X',
  [NativeButton.Y]: 'Button Y',
  // Shoulders
  [NativeButton.LB]: 'Left Bumper',
  [NativeButton.RB]: 'Right Bumper',
  [NativeButton.LT]: 'Left Trigger',
  [NativeButton.RT]: 'Right Trigger',
  // Sticks
  [NativeButton.LS]: 'Left Stick Click',
  [NativeButton.RS]: 'Right Stick Click',
  // Menu
  [NativeButton.BACK]: 'Back',
  [NativeButton.START]: 'Start',
  // D-Pad
  [NativeButton.DPAD_UP]: 'D-Pad Up',
  [NativeButton.DPAD_DOWN]: 'D-Pad Down',
  [NativeButton.DPAD_LEFT]: 'D-Pad Left',
  [NativeButton.DPAD_RIGHT]: 'D-Pad Right',
  // Special
  [NativeButton.GUIDE]: 'Guide',
  [NativeButton.TOUCHPAD]: 'Touchpad',
  [NativeButton.SHARE]: 'Share',
  // Axes
  [NativeAxis.LEFT_X]: 'Left Stick X',
  [NativeAxis.LEFT_Y]: 'Left Stick Y',
  [NativeAxis.RIGHT_X]: 'Right Stick X',
  [NativeAxis.RIGHT_Y]: 'Right Stick Y',
  [NativeAxis.LEFT_TRIGGER]: 'Left Trigger',
  [NativeAxis.RIGHT_TRIGGER]: 'Right Trigger',
}

// Controller type presets for auto-detection
export const ControllerPresets: Record<string, Partial<ControllerMapping>> = {
  generic: {
    id: 'generic',
    name: 'Generic Controller',
    sourceController: 'generic',
    mappings: {},
  },
  xbox: {
    id: 'xbox',
    name: 'Xbox Controller',
    sourceController: 'xbox',
    mappings: {
      [NativeButton.A]: Xbox360Button.A,
      [NativeButton.B]: Xbox360Button.B,
      [NativeButton.X]: Xbox360Button.X,
      [NativeButton.Y]: Xbox360Button.Y,
      [NativeButton.LB]: Xbox360Button.LB,
      [NativeButton.RB]: Xbox360Button.RB,
      [NativeButton.LS]: Xbox360Button.LS,
      [NativeButton.RS]: Xbox360Button.RS,
      [NativeButton.BACK]: Xbox360Button.BACK,
      [NativeButton.START]: Xbox360Button.START,
    },
  },
  playstation: {
    id: 'playstation',
    name: 'PlayStation Controller',
    sourceController: 'playstation',
    mappings: {
      [NativeButton.A]: Xbox360Button.A,
      [NativeButton.B]: Xbox360Button.B,
      [NativeButton.X]: Xbox360Button.X,
      [NativeButton.Y]: Xbox360Button.Y,
      [NativeButton.LB]: Xbox360Button.LB,
      [NativeButton.RB]: Xbox360Button.RB,
      [NativeButton.LS]: Xbox360Button.LS,
      [NativeButton.RS]: Xbox360Button.RS,
      [NativeButton.BACK]: Xbox360Button.BACK,
      [NativeButton.START]: Xbox360Button.START,
    },
  },
  dualsense: {
    id: 'dualsense',
    name: 'DualSense Controller',
    sourceController: 'dualsense',
    mappings: {
      [NativeButton.A]: Xbox360Button.A,
      [NativeButton.B]: Xbox360Button.B,
      [NativeButton.X]: Xbox360Button.X,
      [NativeButton.Y]: Xbox360Button.Y,
      [NativeButton.LB]: Xbox360Button.LB,
      [NativeButton.RB]: Xbox360Button.RB,
      [NativeButton.LT]: Xbox360Button.LB, // Map to LB for games that don't use triggers as buttons
      [NativeButton.RT]: Xbox360Button.RB,
      [NativeButton.LS]: Xbox360Button.LS,
      [NativeButton.RS]: Xbox360Button.RS,
      [NativeButton.BACK]: Xbox360Button.BACK,
      [NativeButton.START]: Xbox360Button.START,
      [NativeButton.GUIDE]: Xbox360Button.START,
      [NativeButton.TOUCHPAD]: Xbox360Button.BACK,
      [NativeButton.SHARE]: Xbox360Button.BACK,
    },
  },
  dualshock4: {
    id: 'dualshock4',
    name: 'DualShock 4 Controller',
    sourceController: 'dualshock4',
    mappings: {
      [NativeButton.A]: Xbox360Button.A,
      [NativeButton.B]: Xbox360Button.B,
      [NativeButton.X]: Xbox360Button.X,
      [NativeButton.Y]: Xbox360Button.Y,
      [NativeButton.LB]: Xbox360Button.LB,
      [NativeButton.RB]: Xbox360Button.RB,
      [NativeButton.LT]: Xbox360Button.LB,
      [NativeButton.RT]: Xbox360Button.RB,
      [NativeButton.LS]: Xbox360Button.LS,
      [NativeButton.RS]: Xbox360Button.RS,
      [NativeButton.BACK]: Xbox360Button.BACK,
      [NativeButton.START]: Xbox360Button.START,
      [NativeButton.TOUCHPAD]: Xbox360Button.BACK,
    },
  },
  xboxone: {
    id: 'xboxone',
    name: 'Xbox One Controller',
    sourceController: 'xboxone',
    mappings: {
      [NativeButton.A]: Xbox360Button.A,
      [NativeButton.B]: Xbox360Button.B,
      [NativeButton.X]: Xbox360Button.X,
      [NativeButton.Y]: Xbox360Button.Y,
      [NativeButton.LB]: Xbox360Button.LB,
      [NativeButton.RB]: Xbox360Button.RB,
      [NativeButton.LS]: Xbox360Button.LS,
      [NativeButton.RS]: Xbox360Button.RS,
      [NativeButton.BACK]: Xbox360Button.BACK,
      [NativeButton.START]: Xbox360Button.START,
      [NativeButton.GUIDE]: Xbox360Button.START,
    },
  },
  xboxseries: {
    id: 'xboxseries',
    name: 'Xbox Series X Controller',
    sourceController: 'xboxseries',
    mappings: {
      [NativeButton.A]: Xbox360Button.A,
      [NativeButton.B]: Xbox360Button.B,
      [NativeButton.X]: Xbox360Button.X,
      [NativeButton.Y]: Xbox360Button.Y,
      [NativeButton.LB]: Xbox360Button.LB,
      [NativeButton.RB]: Xbox360Button.RB,
      [NativeButton.LS]: Xbox360Button.LS,
      [NativeButton.RS]: Xbox360Button.RS,
      [NativeButton.BACK]: Xbox360Button.BACK,
      [NativeButton.START]: Xbox360Button.START,
      [NativeButton.GUIDE]: Xbox360Button.START,
      [NativeButton.SHARE]: Xbox360Button.BACK,
    },
  },
}

// Default key binding profile
export function createDefaultKeyBinding(): KeyBinding {
  return {
    id: 'default',
    name: 'Default',
    profileName: 'Default',
    enabled: true,
    buttonMappings: {},
    stickToMouse: {
      leftStick: false,
      rightStick: false,
      mouseSpeed: 1.0,
      mouseAcceleration: false,
    },
    triggerToScroll: {
      leftTrigger: false,
      rightTrigger: false,
      scrollSpeed: 1.0,
    },
  }
}

// Default controller profile
export function createDefaultProfile(name: string = 'Default'): ControllerProfile {
  const now = Date.now()
  return {
    id: `profile_${now}`,
    name,
    createdAt: now,
    updatedAt: now,
    mappingEnabled: true,
    controllerMapping: ControllerPresets.generic as ControllerMapping,
    keyBindingEnabled: false,
    keyBinding: createDefaultKeyBinding(),
    deadzone: 0.15,
    triggerDeadzone: 0.1,
    vibrationEnabled: true,
    vibrationIntensity: 1.0,
  }
}

// Default controller settings
export function createDefaultControllerSettings(): ControllerSettings {
  const defaultProfile = createDefaultProfile('Default')
  return {
    enabled: false,
    controllerType: 'generic',
    vibrationEnabled: true,
    deadzone: 0.15,
    triggerDeadzone: 0.1,
    buttonLayout: 'default',
    inputTranslation: {
      enabled: true,
      autoDetect: true,
      mappingPreset: 'auto',
    },
    keyBinding: {
      enabled: false,
      activeProfileId: defaultProfile.id,
      profiles: [defaultProfile],
      defaultProfileId: defaultProfile.id,
    },
    overlayEnabled: true,
    overlayHotkey: 'Ctrl+Shift+Gamepad',
    overlayPosition: 'right',
  }
}

// Helper to detect controller type from gamepad info
export function detectControllerType(gamepad: { id: string; axes: number[]; buttons: { pressed: boolean }[] }): string {
  const id = gamepad.id.toLowerCase()
  
  // Xbox controllers
  if (id.includes('xbox') || id.includes('microsoft')) {
    if (id.includes('xbox series') || id.includes('xbox one')) {
      return 'xboxseries'
    } else if (id.includes('xbox 360')) {
      return 'xbox'
    } else if (id.includes('xbox one')) {
      return 'xboxone'
    }
    return 'xbox'
  }
  
  // Sony controllers
  if (id.includes('sony') || id.includes('playstation') || id.includes('dualsense') || id.includes('dualshock') || id.includes('ps5') || id.includes('ps4')) {
    if (id.includes('dualsense') || id.includes('ps5')) {
      return 'dualsense'
    } else if (id.includes('dualshock') || id.includes('ps4')) {
      return 'dualshock4'
    }
    return 'playstation'
  }
  
  // Nintendo controllers
  if (id.includes('nintendo') || id.includes('switch') || id.includes('joy-con') || id.includes('pro controller')) {
    return 'switch'
  }
  
  // Generic
  return 'generic'
}
