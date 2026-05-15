import { Trophy, Award, Target, Download, Clock, Gamepad2 } from 'lucide-react'
import { useMemo } from 'react'
import { ACHIEVEMENTS, getEarnedAchievements, loadAchievementProgress, Achievement } from '@/lib/achievements'

type Props = {
  className?: string
}

const categoryIcons = {
  playtime: Clock,
  games: Gamepad2,
  downloads: Download,
  milestones: Trophy,
}

const categoryColors = {
  playtime: 'text-blue-400',
  games: 'text-green-400',
  downloads: 'text-purple-400',
  milestones: 'text-yellow-400',
}

export function AchievementsPanel({ className = '' }: Props) {
  const progress = useMemo(() => loadAchievementProgress(), [])
  const earned = useMemo(() => getEarnedAchievements(progress), [progress])

  // Group achievements by category
  const byCategory = useMemo(() => {
    const groups: Record<string, Achievement[]> = {
      playtime: [],
      games: [],
      downloads: [],
      milestones: [],
    }
    earned.forEach(ach => {
      const full = ACHIEVEMENTS.find(a => a.id === ach.id)
      if (full) groups[full.category].push(full)
    })
    return groups
  }, [earned])

  const totalEarned = earned.length
  const totalPossible = ACHIEVEMENTS.length

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Trophy className="w-5 h-5 text-yellow-400" />
          Achievements
        </h2>
        <span className="text-sm text-zinc-400">
          {totalEarned} / {totalPossible}
        </span>
      </div>

      {totalEarned === 0 ? (
        <div className="text-center py-8 text-zinc-500">
          <Trophy className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No achievements earned yet.</p>
          <p className="text-sm mt-1">Keep playing to unlock them!</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(byCategory).map(([category, achievements]) => {
            if (achievements.length === 0) return null
            const Icon = categoryIcons[category as keyof typeof categoryIcons]
            const color = categoryColors[category as keyof typeof categoryColors]

            return (
              <div key={category}>
                <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Icon className={`w-4 h-4 ${color}`} />
                  {category}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {achievements.map(ach => {
                    const earnedData = earned.find(e => e.id === ach.id)
                    const date = earnedData ? new Date(earnedData.earnedAt) : null

                    return (
                      <div
                        key={ach.id}
                        className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3 flex items-start gap-3
                                 hover:bg-zinc-900/70 transition-colors"
                      >
                        <div className="flex-shrink-0 mt-0.5">
                          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-yellow-500/20 to-orange-500/20 
                                      flex items-center justify-center">
                            <Award className="w-5 h-5 text-yellow-400" />
                          </div>
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-medium text-sm">{ach.name}</h4>
                          <p className="text-xs text-zinc-500 mt-0.5">{ach.description}</p>
                          {date && (
                            <p className="text-xs text-zinc-600 mt-1.5">
                              Earned {date.toLocaleDateString(undefined, { 
                                month: 'short', 
                                day: 'numeric', 
                                year: 'numeric' 
                              })}
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}