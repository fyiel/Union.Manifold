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
