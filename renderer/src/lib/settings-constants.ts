/**
 * Settings page constants
 * Centralized configuration for settings page keys, limits, and defaults
 */

// LocalStorage keys for settings
export const SETTINGS_KEYS = {
  MIKA: 'uc_hide_mika_all',
  NSFW: 'uc_show_nsfw',
  PUBLIC_PROFILE: 'uc_public_profile',
} as const

/**
 * Electron store (ucSettings) keys for Linux gaming configuration.
 * These are persisted in the main process settings.json file.
 */
export const LINUX_SETTINGS_KEYS = {
  /** Launch mode: 'auto' | 'native' | 'wine' | 'proton' */
  LAUNCH_MODE: 'linuxLaunchMode',
  /** Path to the wine binary (e.g. /usr/bin/wine or wine) */
  WINE_PATH: 'linuxWinePath',
  /** Path to the Proton script (e.g. ~/.steam/steam/steamapps/common/Proton 9.0/proton) */
  PROTON_PATH: 'linuxProtonPath',
  /** WINEPREFIX directory path */
  WINE_PREFIX: 'linuxWinePrefix',
  /** Proton prefix directory (STEAM_COMPAT_DATA_PATH) */
  PROTON_PREFIX: 'linuxProtonPrefix',
  /** Steam install path (STEAM_COMPAT_CLIENT_INSTALL_PATH) */
  STEAM_PATH: 'linuxSteamPath',
  /** Extra environment variables (newline-separated KEY=VALUE pairs) */
  EXTRA_ENV: 'linuxExtraEnv',
  /** WINEPREFIX architecture: 'win64' | 'win32' */
  PREFIX_ARCH: 'linuxPrefixArch',
} as const

// Text constraints
export const TEXT_CONSTRAINTS = {
  MAX_BIO_LENGTH: 240,
} as const

// Application info
export const APP_INFO = {
  DOWNLOAD_DIR_NAME: 'UnionCrax.Direct',
} as const

// Mirror host configuration
export type MirrorHost = 'rootz' | 'pixeldrain' | 'fileq' | 'datavaults'
export type MirrorHostTag = 'beta' | 'soon' | 'retiring'

export interface MirrorHostInfo {
  key: MirrorHost
  label: string
  tag?: MirrorHostTag
  supportsResume?: boolean
}

export const MIRROR_HOSTS: MirrorHostInfo[] = [
  { key: 'pixeldrain', label: 'Pixeldrain', supportsResume: true },
  { key: 'fileq', label: 'FileQ', supportsResume: false },
  { key: 'datavaults', label: 'DataVaults', tag: 'soon', supportsResume: false },
  { key: 'rootz', label: 'Rootz', tag: 'retiring', supportsResume: false },
]
