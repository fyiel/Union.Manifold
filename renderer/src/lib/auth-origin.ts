const MAIN_WEBSITE_ORIGIN = "https://union-crax.xyz"

export const MIRROR_AUTH_BLOCK_MESSAGE = "Please login on the main website union-crax.xyz"
export const MAIN_WEBSITE_LOGIN_URL = `${MAIN_WEBSITE_ORIGIN}/login`

export function normalizeAuthBaseUrl(value: string): string {
  const trimmed = String(value || "").trim()
  if (!trimmed) return ""

  try {
    return new URL(trimmed).origin
  } catch {
    return ""
  }
}

export function isMainWebsiteBaseUrl(baseUrl: string): boolean {
  return normalizeAuthBaseUrl(baseUrl) === MAIN_WEBSITE_ORIGIN
}

export function isMirrorAuthBlocked(baseUrl: string): boolean {
  return !isMainWebsiteBaseUrl(baseUrl)
}