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
