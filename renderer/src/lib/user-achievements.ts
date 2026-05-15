/**
 * User Achievement Tracking
 *
 * Tracks achievements unlocked by the signed-in user across all games.
 * Locally stored in localStorage, designed to sync with server when available.
 */

import type { SteamAchievement } from './steam-achievements'

const USER_ACHIEVEMENTS_KEY = 'uc-user-achievements'
const UNLOCKED_ACHIEVEMENTS_KEY = 'uc-unlocked-achievements'

export type UserAchievement = {
  id: string
  appid: string
  name: string
  displayName: string
  description?: string
  icon?: string
  achieved: boolean
  unlockTime: number
  playtimeAtUnlock?: number
}

export type AchievementStats = {
  totalUnlocked: number
  totalAchievements: number
  gamesWithAchievements: Set<string>
  completionPercentage: number
}

// Get all user achievements
export function getUserAchievements(): UserAchievement[] {
  try {
    const stored = localStorage.getItem(USER_ACHIEVEMENTS_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

// Save user achievements
export function saveUserAchievements(achievements: UserAchievement[]): void {
  try {
    localStorage.setItem(USER_ACHIEVEMENTS_KEY, JSON.stringify(achievements))
  } catch {
    // ignore storage errors
  }
}

// Record an achievement unlock
export function recordAchievementUnlock(
  achievement: SteamAchievement,
  appid: string,
  playtimeAtUnlock?: number
): UserAchievement {
  const userAchievement: UserAchievement = {
    id: achievement.id,
    appid,
    name: achievement.name,
    displayName: achievement.displayName,
    description: achievement.description,
    icon: achievement.icon,
    achieved: true,
    unlockTime: achievement.unlockTime || Date.now(),
    playtimeAtUnlock,
  }

  const current = getUserAchievements()
  const filtered = current.filter(a => !(a.id === achievement.id && a.appid === appid))
  const updated = [...filtered, userAchievement]
  saveUserAchievements(updated)

  // Also track in the unlocked set for quick lookup
  const unlocked = getUnlockedAchievementIds()
  const key = `${appid}:${achievement.id}`
  unlocked.add(key)
  try {
    localStorage.setItem(UNLOCKED_ACHIEVEMENTS_KEY, JSON.stringify(Array.from(unlocked)))
  } catch { }

  return userAchievement
}

// Get unlocked achievement IDs as a set
export function getUnlockedAchievementIds(): Set<string> {
  try {
    const stored = localStorage.getItem(UNLOCKED_ACHIEVEMENTS_KEY)
    return new Set(stored ? JSON.parse(stored) : [])
  } catch {
    return new Set()
  }
}

// Check if achievement is unlocked
export function isAchievementUnlocked(appid: string, achievementId: string): boolean {
  return getUnlockedAchievementIds().has(`${appid}:${achievementId}`)
}

// Get achievements for a specific game
export function getGameAchievements(appid: string): UserAchievement[] {
  return getUserAchievements().filter(a => a.appid === appid)
}

// Calculate user stats
export function getUserAchievementStats(): AchievementStats {
  const achievements = getUserAchievements()
  const games = new Set(achievements.map(a => a.appid))

  return {
    totalUnlocked: achievements.length,
    totalAchievements: achievements.length, // Same since these are unlocked
    gamesWithAchievements: games,
    completionPercentage: 100, // Since this is unlocked set
  }
}

// Clear all achievements (for testing)
export function clearUserAchievements(): void {
  try {
    localStorage.removeItem(USER_ACHIEVEMENTS_KEY)
    localStorage.removeItem(UNLOCKED_ACHIEVEMENTS_KEY)
  } catch { }
}

// Export achievements to JSON
export function exportAchievements(): string {
  return JSON.stringify({
    unlocked: getUserAchievements(),
    stats: getUserAchievementStats(),
    exportedAt: new Date().toISOString(),
  }, null, 2)
}