/**
 * Auth types mirrored from union-crax.xyz
 * Ensures compatibility between frontend and backend schemas
 */

export interface AuthUser {
  id: string
  discordId: string
  username: string
  email: string | null
  emailVerifiedAt: string | null
  displayName: string | null
  avatarUrl: string | null
  bio: string | null
  createdAt: string
  updatedAt: string
}

export interface Identity {
  id: string
  userId: string
  provider: "discord" | "google"
  providerAccountId: string
  accessToken: string | null
  refreshToken: string | null
  providerProfile: Record<string, any> | null
  linkedAt: string
}

export interface AuthSession {
  tokenHash?: string
  discordId: string
  userId: string
  expiresAt: string
  createdAt: string
}

export interface CommentUser {
  discordId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  bio: string | null
}

/**
 * API Response types for common auth operations
 */

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  ok: boolean
  user?: AuthUser
  error?: string
}

export interface RegisterRequest {
  email: string
  username: string
  password: string
}

export interface RegisterResponse {
  ok: boolean
  user?: AuthUser
  error?: string
}

export interface VerifyEmailRequest {
  token: string
}

export interface VerifyEmailResponse {
  ok: boolean
  error?: string
}

export interface ForgotPasswordRequest {
  email: string
}

export interface ForgotPasswordResponse {
  ok: boolean
  message?: string
  error?: string
}

export interface ResetPasswordRequest {
  token: string
  password: string
}

export interface ResetPasswordResponse {
  ok: boolean
  error?: string
}

export interface GetMeResponse {
  ok: boolean
  user?: AuthUser
  linkedProviders?: Identity[]
  error?: string
}

export interface GetSessionResponse {
  ok: boolean
  discordId?: string
  userId?: string
  user?: AuthUser
  error?: string
}

export interface LogoutResponse {
  ok: boolean
  error?: string
}

export interface LinkProviderRequest {
  provider: "discord" | "google"
}

export interface UnlinkProviderRequest {
  provider: "discord" | "google"
}

export interface UnlinkProviderResponse {
  ok: boolean
  error?: string
}

export interface UpdateProfileRequest {
  displayName?: string
  bio?: string
  avatarUrl?: string
}

export interface UpdateProfileResponse {
  ok: boolean
  user?: AuthUser
  error?: string
}

export interface UpdatePasswordRequest {
  currentPassword: string
  newPassword: string
}

export interface UpdatePasswordResponse {
  ok: boolean
  error?: string
}

export interface OAuthConnectRequest {
  action?: "signin" | "register" | "link"
  next?: string
}

export interface OAuthCallbackRequest {
  code: string
  state: string
}

export interface OAuthCallbackResponse {
  ok: boolean
  user?: AuthUser
  identity?: Identity
  error?: string
}
