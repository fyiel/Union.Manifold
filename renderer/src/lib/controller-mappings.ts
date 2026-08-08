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

export enum NativeButton {
  A = 'native_a',
  B = 'native_b',
  X = 'native_x',
  Y = 'native_y',
  LB = 'native_lb',
  RB = 'native_rb',
  LT = 'native_lt',
  RT = 'native_rt',
  LS = 'native_ls',
  RS = 'native_rs',
  BACK = 'native_back',
  START = 'native_start',
  DPAD_UP = 'native_dpad_up',
  DPAD_DOWN = 'native_dpad_down',
  DPAD_LEFT = 'native_dpad_left',
  DPAD_RIGHT = 'native_dpad_right',
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

export interface MouseInput {
  type: 'move' | 'click' | 'right_click' | 'middle_click' | 'scroll'
  button?: 'left' | 'right' | 'middle'
  direction?: 'up' | 'down'
  deltaX?: number
  deltaY?: number
}

export type InputAction = 
  | { type: 'keyboard'; key: KeyboardKey }
  | { type: 'mouse'; input: MouseInput }
  | { type: 'xbox360'; button?: Xbox360Button; axis?: Xbox360Axis; value?: number }
  | { type: 'none' }

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

export interface KeyBinding {
  id: string
  name: string
  profileName: string
  enabled: boolean
  buttonMappings: {
    [key in NativeButton]?: InputAction
  } & {
    [key in NativeAxis]?: InputAction & { sensitivity?: number }
  }
  stickToMouse?: {
    leftStick: boolean
    rightStick: boolean
    mouseSpeed: number
    mouseAcceleration: boolean
  }
  triggerToScroll?: {
    leftTrigger: boolean
    rightTrigger: boolean
    scrollSpeed: number
  }
}

export interface ControllerProfile {
  id: string
  name: string
  appid?: string
  createdAt: number
  updatedAt: number
  mappingEnabled: boolean
  controllerMapping: ControllerMapping
  keyBindingEnabled: boolean
  keyBinding: KeyBinding
  deadzone: number
  triggerDeadzone: number
  vibrationEnabled: boolean
  vibrationIntensity: number
}

export interface ControllerSettings {
  enabled: boolean
  controllerType: 'xbox' | 'playstation' | 'generic' | 'dualsense' | 'xboxone' | 'xboxseries'
  controllerSlot: number | null
  vibrationEnabled: boolean
  deadzone: number
  triggerDeadzone: number
  buttonLayout: 'default' | 'legacy'
  
  inputTranslation: {
    enabled: boolean
    autoDetect: boolean
    mappingPreset: 'auto' | 'generic' | 'xbox' | 'playstation' | 'dualsense' | 'dualshock4' | 'xboxone' | 'xboxseries'
    customMapping?: ControllerMapping
  }
  
  keyBinding: {
    enabled: boolean
    activeProfileId: string | null
    profiles: ControllerProfile[]
    defaultProfileId: string | null
  }
  
  overlayEnabled: boolean
  overlayHotkey: string
  overlayPosition: 'left' | 'right'
}

export function createDefaultControllerSettings(): ControllerSettings {
  const now = Date.now()
  const defaultProfile: ControllerProfile = {
    id: `profile_${now}`,
    name: 'Default',
    createdAt: now,
    updatedAt: now,
    mappingEnabled: true,
    controllerMapping: {
      id: 'generic',
      name: 'Generic',
      sourceController: 'generic',
      mappings: {},
    },
    keyBindingEnabled: false,
    keyBinding: {
      id: 'default',
      name: 'Default',
      profileName: 'Default',
      enabled: true,
      buttonMappings: {},
    },
    deadzone: 0.15,
    triggerDeadzone: 0.1,
    vibrationEnabled: true,
    vibrationIntensity: 1.0,
  }
  return {
    enabled: false,
    controllerType: 'generic',
    controllerSlot: null,
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
    overlayHotkey: 'Guide Button',
    overlayPosition: 'right',
  }
}

export function detectControllerType(gamepad: { id: string; axes: number[]; buttons: { pressed: boolean }[] }): string {
  const id = gamepad.id.toLowerCase()
  
  if (id.includes('xbox series')) {
    return 'xboxseries'
  } else if (id.includes('xbox one')) {
    return 'xboxone'
  } else if (id.includes('xbox 360')) {
    return 'xbox'
  } else if (id.includes('xbox')) {
    return 'xbox'
  }
  
  if (id.includes('sony') || id.includes('playstation') || id.includes('dualsense') || id.includes('dualshock') || id.includes('ps5') || id.includes('ps4')) {
    if (id.includes('dualsense') || id.includes('ps5')) {
      return 'dualsense'
    } else if (id.includes('dualshock') || id.includes('ps4')) {
      return 'dualshock4'
    }
    return 'playstation'
  }
  
  if (id.includes('nintendo') || id.includes('switch') || id.includes('joy-con') || id.includes('pro controller')) {
    return 'switch'
  }
  
  return 'generic'
}
