/**
 * Settings page constants
 * Centralized configuration for settings page keys, limits, and defaults
 */

// LocalStorage keys for settings
export const SETTINGS_KEYS = {
  MIKA: 'uc_hide_mika_all',
  NSFW: 'uc_show_nsfw',
  AVATAR: 'uc_profile_avatar',
  BANNER: 'uc_profile_banner',
  PUBLIC_PROFILE: 'uc_public_profile',
} as const

// Image constraints
export const IMAGE_CONSTRAINTS = {
  AVATAR_MAX_SIZE: 512,
  BANNER_MAX_WIDTH: 1600,
  BANNER_MAX_HEIGHT: 900,
  QUALITY: 0.82,
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
export type MirrorHost = 'rootz' | 'pixeldrain'
export type MirrorHostTag = 'beta' | 'soon'

export interface MirrorHostInfo {
  key: MirrorHost
  label: string
  tag?: MirrorHostTag
}

export const MIRROR_HOSTS: MirrorHostInfo[] = [
  { key: 'pixeldrain', label: 'Pixeldrain' },
  { key: 'rootz', label: 'Rootz', tag: 'beta' },
]

// Download speed limit presets (in bytes per second)
// 0 = unlimited
export type DownloadSpeedPreset = 'unlimited' | 'high' | 'normal' | 'slow' | 'ultra_slow'

export interface DownloadSpeedPresetInfo {
  key: DownloadSpeedPreset
  label: string
  bytesPerSecond: number // 0 = unlimited
}

export const DOWNLOAD_SPEED_PRESETS: DownloadSpeedPresetInfo[] = [
  { key: 'unlimited', label: 'High (Max Speed)', bytesPerSecond: 0 },
  { key: 'high', label: 'Normal (Not Prioritized)', bytesPerSecond: 10 * 1024 * 1024 }, // 10 MB/s
  { key: 'normal', label: 'Slow', bytesPerSecond: 5 * 1024 * 1024 }, // 5 MB/s
  { key: 'slow', label: 'Ultra Slow', bytesPerSecond: 1 * 1024 * 1024 }, // 1 MB/s
  { key: 'ultra_slow', label: 'Turtle Mode', bytesPerSecond: 256 * 1024 }, // 256 KB/s
]

export const DEFAULT_DOWNLOAD_SPEED_PRESET: DownloadSpeedPreset = 'unlimited'
