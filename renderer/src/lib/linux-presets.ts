export type LinuxLaunchMode = 'auto' | 'native' | 'wine' | 'proton'
export type LinuxPerGameLaunchMode = LinuxLaunchMode | 'inherit'

export type LinuxDetectionOption = {
  label: string
  path: string
}

export type LinuxGlobalSettings = {
  linuxLaunchMode: LinuxLaunchMode
  linuxWinePath: string
  linuxProtonPath: string
  linuxWinePrefix: string
  linuxProtonPrefix: string
  linuxSteamPath: string
  linuxExtraEnv: string
}

export type LinuxGameConfig = {
  launchMode?: LinuxPerGameLaunchMode
  winePath?: string
  protonPath?: string
  winePrefix?: string
  protonPrefix?: string
  extraEnv?: string
  vrEnabled?: boolean
  vrXrRuntimeJson?: string
  slsSteamAppId?: string
  slsSteamEnabled?: boolean
}

export type LinuxPresetId = 'auto' | 'native' | 'wine-recommended' | 'proton-recommended'

export const LINUX_PRESETS: Array<{ id: LinuxPresetId; label: string; description: string }> = [
  { id: 'auto', label: 'Auto Detect', description: 'Prefer native launches, then fall back to Wine when needed.' },
  { id: 'native', label: 'Native Only', description: 'Never route launches through Wine or Proton.' },
  { id: 'wine-recommended', label: 'Wine Setup', description: 'Use Wine with your current or detected binary.' },
  { id: 'proton-recommended', label: 'Proton Setup', description: 'Use Proton with your current or detected Steam script.' },
]

function pickBinary(currentValue: string, detected: LinuxDetectionOption[]) {
  const trimmed = currentValue.trim()
  if (trimmed) return trimmed
  return detected[0]?.path || ''
}

export function applyGlobalLinuxPreset(
  presetId: LinuxPresetId,
  current: LinuxGlobalSettings,
  detectedWineVersions: LinuxDetectionOption[],
  detectedProtonVersions: LinuxDetectionOption[]
): LinuxGlobalSettings {
  if (presetId === 'native') {
    return {
      ...current,
      linuxLaunchMode: 'native',
    }
  }

  if (presetId === 'wine-recommended') {
    return {
      ...current,
      linuxLaunchMode: 'wine',
      linuxWinePath: pickBinary(current.linuxWinePath, detectedWineVersions),
    }
  }

  if (presetId === 'proton-recommended') {
    return {
      ...current,
      linuxLaunchMode: 'proton',
      linuxProtonPath: pickBinary(current.linuxProtonPath, detectedProtonVersions),
    }
  }

  return {
    ...current,
    linuxLaunchMode: 'auto',
  }
}

export function applyGameLinuxPreset(
  presetId: LinuxPresetId,
  current: LinuxGameConfig,
  detectedWineVersions: LinuxDetectionOption[],
  detectedProtonVersions: LinuxDetectionOption[]
): LinuxGameConfig {
  if (presetId === 'native') {
    return {
      ...current,
      launchMode: 'native',
      winePath: '',
      protonPath: '',
      winePrefix: '',
      protonPrefix: '',
    }
  }

  if (presetId === 'wine-recommended') {
    return {
      ...current,
      launchMode: 'wine',
      winePath: pickBinary(current.winePath || '', detectedWineVersions),
    }
  }

  if (presetId === 'proton-recommended') {
    return {
      ...current,
      launchMode: 'proton',
      protonPath: pickBinary(current.protonPath || '', detectedProtonVersions),
    }
  }

  return {
    ...current,
    launchMode: 'inherit',
    winePath: '',
    protonPath: '',
    winePrefix: '',
    protonPrefix: '',
  }
}