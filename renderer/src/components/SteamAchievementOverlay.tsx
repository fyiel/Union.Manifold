/**
 * Steam Achievement Overlay Integration
 *
 * Shows notifications when Steam achievements unlock during gameplay.
 * Works with Goldberg, SSE, and other Steam emulators.
 */

import { useState, useEffect } from 'react'
import { Trophy, Award } from 'lucide-react'
import type { SteamAchievement } from '@/lib/steam-achievements'

type Props = {
  className?: string
}

// Achievement notification toast
function AchievementToast({ 
  achievement, 
  onClose 
}: { 
  achievement: SteamAchievement, 
  onClose: () => void 
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000)
    return () => clearTimeout(timer)
  }, [onClose])

  return (
    <div className="fixed top-20 right-4 z-[9999] animate-in slide-in-from-right-full">
      <div className="bg-gradient-to-r from-yellow-500/20 to-orange-500/20 
                  backdrop-blur-md border border-yellow-500/30 rounded-lg p-4
                  shadow-lg shadow-yellow-500/10 max-w-xs">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">
            <Trophy className="w-6 h-6 text-yellow-400" />
          </div>
          <div>
            <h4 className="font-semibold text-sm text-yellow-200">Achievement Unlocked!</h4>
            <p className="text-xs text-white mt-1">{achievement.displayName}</p>
            {achievement.description && (
              <p className="text-xs text-zinc-400 mt-1">{achievement.description}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function SteamAchievementOverlay({ className = '' }: Props) {
  const [unlockedAchievements, setUnlockedAchievements] = useState<SteamAchievement[]>([])
  const [activeToast, setActiveToast] = useState<SteamAchievement | null>(null)

  // Listen for achievement unlock events from the main process
  useEffect(() => {
    const handler = (event: CustomEvent<SteamAchievement>) => {
      const achievement = event.detail
      setUnlockedAchievements(prev => [...prev, achievement])
      setActiveToast(achievement)
      // Record in user achievements for the achievements page
      import('@/lib/user-achievements').then(({ recordAchievementUnlock }) => {
        recordAchievementUnlock(achievement, achievement.appid)
      })
    }
    window.addEventListener('steam-achievement-unlock', handler as any)
    return () => window.removeEventListener('steam-achievement-unlock', handler as any)
  }, [])

  return activeToast ? (
    <AchievementToast 
      achievement={activeToast} 
      onClose={() => setActiveToast(null)} 
    />
  ) : null
}

// Hook to register achievement listener with the overlay system
export function useSteamAchievementListener() {
  useEffect(() => {
    // Listen for IPC messages from main process
    const removeListener = window.ucOverlay?.onAchievementUnlock?.((achievement) => {
      window.dispatchEvent(new CustomEvent('steam-achievement-unlock', { detail: achievement }))
    })
    return () => removeListener?.()
  }, [])
}