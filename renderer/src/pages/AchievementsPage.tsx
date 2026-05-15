import { useMemo } from 'react'
import { Trophy, Gamepad2, Calendar, Clock } from 'lucide-react'
import { getUserAchievements, getUserAchievementStats, type UserAchievement } from '@/lib/user-achievements'

type Props = {
  className?: string
}

export function AchievementsPage({ className = '' }: Props) {
  const achievements = useMemo(() => getUserAchievements(), [])
  const stats = useMemo(() => getUserAchievementStats(), [achievements])

  // Group achievements by game (appid)
  const byGame = useMemo(() => {
    const groups: Record<string, UserAchievement[]> = {}
    achievements.forEach(ach => {
      if (!groups[ach.appid]) groups[ach.appid] = []
      groups[ach.appid].push(ach)
    })
    return groups
  }, [achievements])

  if (achievements.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center min-h-[60vh] ${className}`}>
        <Trophy className="w-16 h-16 text-zinc-600 mb-4" />
        <h2 className="text-xl font-semibold mb-2">No Achievements Yet</h2>
        <p className="text-zinc-400 text-center max-w-sm">
          Start playing games with Steam emulators (Goldberg, SSE) to unlock achievements.
          They'll appear here once you earn them!
        </p>
      </div>
    )
  }

  return (
    <div className={`flex flex-col gap-6 ${className}`}>
      {/* Stats Header */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 text-center">
          <Trophy className="w-6 h-6 text-yellow-400 mx-auto mb-2" />
          <div className="text-2xl font-bold">{stats.totalUnlocked}</div>
          <div className="text-xs text-zinc-400">Achievements Unlocked</div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 text-center">
          <Gamepad2 className="w-6 h-6 text-green-400 mx-auto mb-2" />
          <div className="text-2xl font-bold">{stats.gamesWithAchievements.size}</div>
          <div className="text-xs text-zinc-400">Games Played</div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 text-center">
          <Calendar className="w-6 h-6 text-blue-400 mx-auto mb-2" />
          <div className="text-2xl font-bold">{new Date().getFullYear()}</div>
          <div className="text-xs text-zinc-400">Year</div>
        </div>
      </div>

      {/* Achievements by Game */}
      <div className="space-y-6">
        {Object.entries(byGame).map(([appid, gameAchievements]) => (
          <div key={appid}>
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Gamepad2 className="w-4 h-4" />
              AppID: {appid} ({gameAchievements.length} achievements)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {gameAchievements.map(ach => (
                <div
                  key={`${appid}-${ach.id}`}
                  className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3 hover:bg-zinc-900/70 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5">
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-yellow-500/20 to-orange-500/20 flex items-center justify-center">
                        <Trophy className="w-5 h-5 text-yellow-400" />
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="font-medium text-sm">{ach.displayName}</h4>
                      {ach.description && (
                        <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{ach.description}</p>
                      )}
                      <div className="flex items-center gap-3 mt-2 text-xs text-zinc-600">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(ach.unlockTime).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}