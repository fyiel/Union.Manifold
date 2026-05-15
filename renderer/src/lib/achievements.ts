export type AchievementCategory = 'playtime' | 'games' | 'downloads' | 'milestones'

export type Achievement = {
  id: string
  name: string
  description: string
  category: AchievementCategory
  icon?: string
  target: number
  unit?: string
}

export type UserAchievement = {
  id: string
  earnedAt: number
  progress?: number
}

export type AchievementProgress = {
  [id: string]: { progress: number; earned: boolean }
}

// Achievement definitions
export const ACHIEVEMENTS: Achievement[] = [
  // Playtime achievements
  { id: 'playtime_1', name: 'First Hour', description: 'Play for 1 hour total', category: 'playtime', target: 3600 },
  { id: 'playtime_10', name: 'Ten Hours', description: 'Play for 10 hours total', category: 'playtime', target: 36000 },
  { id: 'playtime_100', name: 'Centurion', description: 'Play for 100 hours total', category: 'playtime', target: 360000 },
  { id: 'playtime_500', name: 'Veteran', description: 'Play for 500 hours total', category: 'playtime', target: 1800000 },

  // Game count achievements
  { id: 'games_1', name: 'First Game', description: 'Install your first game', category: 'games', target: 1 },
  { id: 'games_5', name: 'Collector', description: 'Install 5 games', category: 'games', target: 5 },
  { id: 'games_25', name: 'Curator', description: 'Install 25 games', category: 'games', target: 25 },
  { id: 'games_100', name: 'Archivist', description: 'Install 100 games', category: 'games', target: 100 },

  // Download achievements
  { id: 'downloads_1', name: 'First Download', description: 'Complete your first download', category: 'downloads', target: 1 },
  { id: 'downloads_50', name: 'Downloader', description: 'Complete 50 downloads', category: 'downloads', target: 50 },
  { id: 'downloads_500', name: 'Bandwidth Beast', description: 'Complete 500 downloads', category: 'downloads', target: 500 },

  // Milestones
  { id: 'launch_1', name: 'Getting Started', description: 'Launch your first game', category: 'milestones', target: 1 },
  { id: 'launch_100', name: 'Regular', description: 'Launch games 100 times', category: 'milestones', target: 100 },
  { id: 'days_7', name: 'Weekly Warrior', description: 'Use UC.D for 7 consecutive days', category: 'milestones', target: 7 },
]

const STORAGE_KEY = 'uc_achievements_progress'

// Load progress from localStorage
export function loadAchievementProgress(): AchievementProgress {
  if (typeof window === 'undefined') return {}
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored) return JSON.parse(stored)
  } catch {}
  return {}
}

// Save progress to localStorage
export function saveAchievementProgress(progress: AchievementProgress): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress))
  } catch {}
}

// Get earned achievements
export function getEarnedAchievements(progress: AchievementProgress): UserAchievement[] {
  const earned: UserAchievement[] = []
  for (const [id, data] of Object.entries(progress)) {
    if (data.earned) {
      earned.push({ id, earnedAt: data.earnedAt || Date.now() })
    }
  }
  return earned
}

// Update progress for an achievement and check if earned
export function updateAchievementProgress(
  progress: AchievementProgress,
  achievementId: string,
  increment: number = 1
): { progress: AchievementProgress; newlyEarned: Achievement[] } {
  const achievement = ACHIEVEMENTS.find(a => a.id === achievementId)
  if (!achievement) return { progress, newlyEarned: [] }

  const current = progress[achievementId] || { progress: 0, earned: false }
  
  if (current.earned) return { progress, newlyEarned: [] }

  const newProgress = Math.min(achievement.target, current.progress + increment)
  const newlyEarned = newProgress >= achievement.target && !current.earned ? [achievement] : []

  const updated = {
    ...progress,
    [achievementId]: {
      progress: newProgress,
      earned: newProgress >= achievement.target,
      ...(newlyEarned.length > 0 ? { earnedAt: Date.now() } : {})
    }
  }

  saveAchievementProgress(updated)
  return { progress: updated, newlyEarned }
}

// Check and update statistics-based achievements
export function checkStatAchievements(
  stats: {
    totalPlaytime?: number
    installedGames?: number
    totalDownloads?: number
    gameLaunches?: number
    consecutiveDays?: number
  },
  progress: AchievementProgress
): { progress: AchievementProgress; newlyEarned: Achievement[] } {
  let updated = progress
  let allNewlyEarned: Achievement[] = []

  // Playtime achievements
  if (stats.totalPlaytime) {
    for (const ach of ACHIEVEMENTS.filter(a => a.category === 'playtime')) {
      const result = updateAchievementProgress(updated, ach.id, 0)
      updated = result.progress
      if (stats.totalPlaytime >= ach.target) {
        const current = updated[ach.id]
        if (!current.earned) {
          updated[ach.id] = { progress: ach.target, earned: true, earnedAt: Date.now() }
          allNewlyEarned.push(ach)
        }
      }
    }
  }

  // Game count achievements
  if (stats.installedGames) {
    for (const ach of ACHIEVEMENTS.filter(a => a.category === 'games')) {
      const current = updated[ach.id] || { progress: 0, earned: false }
      if (!current.earned && stats.installedGames >= ach.target) {
        updated[ach.id] = { progress: ach.target, earned: true, earnedAt: Date.now() }
        allNewlyEarned.push(ach)
      }
    }
  }

  // Download achievements
  if (stats.totalDownloads) {
    for (const ach of ACHIEVEMENTS.filter(a => a.category === 'downloads')) {
      const current = updated[ach.id] || { progress: 0, earned: false }
      if (!current.earned && stats.totalDownloads >= ach.target) {
        updated[ach.id] = { progress: ach.target, earned: true, earnedAt: Date.now() }
        allNewlyEarned.push(ach)
      }
    }
  }

  // Launch achievements
  if (stats.gameLaunches) {
    for (const ach of ACHIEVEMENTS.filter(a => a.category === 'milestones' && ach.id.startsWith('launch'))) {
      const current = updated[ach.id] || { progress: 0, earned: false }
      if (!current.earned && stats.gameLaunches >= ach.target) {
        updated[ach.id] = { progress: ach.target, earned: true, earnedAt: Date.now() }
        allNewlyEarned.push(ach)
      }
    }
  }

  saveAchievementProgress(updated)
  return { progress: updated, newlyEarned: allNewlyEarned }
}