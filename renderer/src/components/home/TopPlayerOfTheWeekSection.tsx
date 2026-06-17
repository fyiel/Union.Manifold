import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Trophy, Crown, ArrowUpRight } from "lucide-react"
import { Gamepad2 } from "@/components/icons"
import { proxyImageUrl } from "@/lib/utils"
import { formatPlaytime } from "@/lib/playtime-format"
import { UcPlusBadge } from "@/components/UcPlusBadge"
import { DiscordAvatar } from "@/components/DiscordAvatar"
import { apiFetch } from "@/lib/api"

type LeaderboardEntry = {
  rank: number
  userId: string
  discordId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  totalSeconds: number
  weekSeconds: number
  ucPlus?: boolean
  topGames: Array<{ appid: string; gameName: string | null; totalSeconds: number }>
}

export function TopPlayerOfTheWeekSection() {
  const [entry, setEntry] = useState<LeaderboardEntry | null>(null)
  const [runnersUp, setRunnersUp] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const res = await apiFetch("/api/playtime/leaderboard?scope=week&limit=5")
        if (!res.ok) {
          if (!cancelled) {
            setError(true)
            setLoading(false)
          }
          return
        }
        const data = await res.json()
        if (cancelled) return
        const entries: LeaderboardEntry[] = Array.isArray(data?.entries) ? data.entries : []
        setEntry(entries[0] ?? null)
        setRunnersUp(entries.slice(1, 4))
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <section className="py-8">
        <div className="h-32 rounded-3xl border border-white/[.07] udl-skeleton" />
      </section>
    )
  }

  if (error || !entry) {
    return null
  }

  const displayName = entry.displayName || entry.username
  const topGame = entry.topGames[0] ?? null

  return (
    <section className="py-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-300" />
          <span className="text-xs font-bold uppercase tracking-[0.24em] text-muted-foreground">
            Top this week
          </span>
        </div>
        <Button asChild variant="ghost" size="sm" className="rounded-full text-xs">
          <a
            href="https://union-crax.xyz/leaderboard"
            onClick={(e) => {
              e.preventDefault();
              (window as any).ucSystem?.openExternal?.("https://union-crax.xyz/leaderboard");
            }}
          >
            View full leaderboard
            <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
          </a>
        </Button>
      </div>

      <Card className="rounded-3xl border border-amber-400/15 bg-gradient-to-br from-amber-500/5 via-card/60 to-card/40 backdrop-blur-md">
        <CardContent className="p-6 sm:p-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <a
              href={`https://union-crax.xyz/user/${entry.username}`}
              onClick={(e) => {
                e.preventDefault();
                (window as any).ucSystem?.openExternal?.(`https://union-crax.xyz/user/${entry.username}`);
              }}
              className="group flex items-center gap-4"
            >
              <div className="relative">
                {entry.avatarUrl ? (
                  <img
                    src={proxyImageUrl(entry.avatarUrl)}
                    alt={displayName}
                    className="h-16 w-16 rounded-full border-2 border-amber-400/40 object-cover shadow-lg shadow-amber-500/20 transition-transform group-hover:scale-105 sm:h-20 sm:w-20"
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-amber-400/40 bg-secondary/60 text-lg font-bold sm:h-20 sm:w-20">
                    {displayName.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <span className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-background bg-gradient-to-br from-amber-300 to-amber-500 text-amber-950 shadow-md">
                  <Crown className="h-4 w-4" />
                </span>
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-lg font-semibold text-white group-hover:text-cyan-200 sm:text-xl">
                    {displayName}
                  </p>
                  {entry.ucPlus ? <UcPlusBadge compact /> : null}
                  <Badge className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">
                    #1 this week
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatPlaytime(entry.weekSeconds)} played in the last 7 days
                </p>
                {topGame ? (
                  <div className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground/80">
                    <Gamepad2 className="h-3.5 w-3.5" />
                    Top game: <span className="text-foreground/80">{topGame.gameName || `App ${topGame.appid}`}</span>
                  </div>
                ) : null}
              </div>
            </a>

            {runnersUp.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:justify-end">
                {runnersUp.map((runner) => {
                  const runnerName = runner.displayName || runner.username
                  return (
                    <a
                      key={runner.userId}
                      href={`https://union-crax.xyz/user/${runner.username}`}
                      onClick={(e) => {
                        e.preventDefault();
                        (window as any).ucSystem?.openExternal?.(`https://union-crax.xyz/user/${runner.username}`);
                      }}
                      className="flex items-center gap-2 rounded-full border border-white/[.07] bg-card/60 px-3 py-1.5 text-xs transition-colors hover:bg-secondary/70"
                      title={`${runnerName} · ${formatPlaytime(runner.weekSeconds)}`}
                    >
                      <span className="font-bold text-muted-foreground">#{runner.rank}</span>
                      {runner.avatarUrl ? (
                        <img
                          src={proxyImageUrl(runner.avatarUrl)}
                          alt={runnerName}
                          className="h-6 w-6 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary/70 text-[10px] font-bold">
                          {runnerName.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <span className="hidden sm:inline text-foreground/80">{runnerName}</span>
                      {runner.ucPlus ? <UcPlusBadge compact /> : null}
                      <span className="text-muted-foreground/80">{formatPlaytime(runner.weekSeconds)}</span>
                    </a>
                  )
                })}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
