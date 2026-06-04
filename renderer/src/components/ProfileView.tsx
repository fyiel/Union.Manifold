import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { DiscordAvatar } from "@/components/DiscordAvatar"
import { SystemProfileCard } from "@/components/SystemProfileCard"
import { MyRequests } from "@/components/MyRequests"
import { CommentMarkdown } from "@/components/CommentMarkdown"
import { proxyImageUrl, formatNumber, timeAgo } from "@/lib/utils"
import {
  HeartHandshake, MessageSquare, Repeat2, ArrowRight, Clock3, Trophy, Calendar,
  MessageCircle, Activity as ActivityIcon, Sparkles, Heart, Layers3, Gamepad2, Crown,
} from "lucide-react"

// ── Types: mirror lib/public-profile.ts (web) + the /api/profile/[username] route ──
export type ProfilePayload = {
  user: { discordId: string; username: string; displayName: string | null; avatarUrl: string | null; bannerUrl?: string | null; bio?: string | null; createdAt?: string | null }
  systemProfile: { tier: "summary" | "full"; summary: string | null; spec: any; fingerprint: string; capturedAt: string } | null
  playtime: {
    totalSeconds: number; weekSeconds: number; sessionCount: number; lastPlayedAt: string | null
    rank: { rank: number; outOf: number } | null
    weekRank: { rank: number; outOf: number } | null
    topGames: Array<{ appid: string; gameName: string | null; totalSeconds: number; sessionCount: number }>
    activity: Array<{ day: string; seconds: number; sessions: number }>
  } | null
  stats: { commentCount: number; likeCount: number; forumTopicCount: number; forumPostCount: number; wishlistCount: number; lastActiveAt: string | null }
  recentComments: Array<{ id: string; appid: string; body: string; createdAt: string; gameName: string | null }>
  topGames: Array<{ appid: string; name: string | null; count: number }>
  recentRequests: Array<{ id: string; type: string; title: string; message: string | null; status: string; createdAt: string; link: string | null }>
  wishlist: Array<{ appid: string; name: string | null; createdAt: string }>
  collections: Array<{ id: string; name: string; shareToken: string | null; gameCount: number; previewCovers: Array<{ appid: string; image: string | null; name: string | null }>; updatedAt: string }>
  forumTopics: Array<{ id: string; title: string; categoryId: string; categorySlug: string; createdAt: string }>
  forumPosts: Array<{ id: string; topicId: string; topicTitle: string; categorySlug: string; content: string; createdAt: string }>
  role: string | null
  hasUcPlus: boolean
  supporterDonations: Array<{ name?: string; amount: string | number | null; currency?: string | null; message?: string | null; tierName?: string | null; isSubscriptionPayment?: boolean; donatedAt?: string | null; createdAt?: string | null }>
  requestQuota: { dailyLimit: number | null; usedToday: number; remainingToday: number | null } | null
  isOwner: boolean
}

function formatPlaytime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`
}

function UcPlusBadge() {
  return (
    <Badge variant="secondary" className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300">
      <Sparkles className="h-3 w-3" /> UC+
    </Badge>
  )
}

function StaffRoleBadge({ role }: { role: string | null }) {
  if (!role) return null
  const lower = role.toLowerCase()
  const cls = lower.includes("head")
    ? "border-amber-400/30 bg-amber-500/10 text-amber-200"
    : "border-violet-400/30 bg-violet-500/10 text-violet-200"
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] ${cls}`}>
      <Crown className="h-3 w-3" />
      {role}
    </span>
  )
}

const CARD = "rounded-3xl bg-card/80 border border-border/50 backdrop-blur-md shadow-[0_8px_30px_rgb(0,0,0,0.12)]"

// Sections that only exist on the website (forums, leaderboard, public
// collection share links) open in the user's browser rather than 404'ing
// inside the launcher.
const WEBSITE_ORIGIN = "https://union-crax.xyz"
function openWebsite(path: string) {
  try { window.ucSystem?.openExternal?.(`${WEBSITE_ORIGIN}${path}`) } catch { /* ignore */ }
}

/**
 * Desktop port of the web user profile (union-crax.xyz/app/user/[username]).
 * Fed by /api/profile/[username] so it stays 1:1 with the site. `heroActions`
 * is the slot the website uses for the report button; on the desktop "My
 * Profile" page it carries the owner controls (Edit Profile / Logout).
 */
export function ProfileView({ data, heroActions }: { data: ProfilePayload; heroActions?: ReactNode }) {
  const { user, stats, recentComments, topGames, recentRequests, wishlist, collections, forumTopics, forumPosts, systemProfile, playtime } = data
  const displayName = user.displayName || user.username
  const joinedAt = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "Unknown"
  const lastActiveDate = stats.lastActiveAt ? new Date(stats.lastActiveAt) : null
  const lastActiveAbsolute = lastActiveDate ? lastActiveDate.toLocaleDateString() : "Unknown"
  const lastActiveRelative = stats.lastActiveAt ? (timeAgo(stats.lastActiveAt) || lastActiveAbsolute) : "Never"
  const hasMonthlySupport = (data.supporterDonations || []).some((d) => d.isSubscriptionPayment)
  const bannerUrl = user.bannerUrl ?? null
  const requestQuota = data.requestQuota

  const statItems = [
    { label: "Comments", value: stats.commentCount, icon: MessageCircle, accent: "text-sky-400" },
    { label: "Likes earned", value: stats.likeCount, icon: Heart, accent: "text-rose-400" },
    { label: "Forum topics", value: stats.forumTopicCount, icon: MessageSquare, accent: "text-emerald-400" },
    { label: "Forum replies", value: stats.forumPostCount, icon: MessageSquare, accent: "text-emerald-400/80" },
    { label: "Wishlisted", value: stats.wishlistCount, icon: Heart, accent: "text-yellow-400" },
  ]

  type ActivityItem =
    | { kind: "comment"; id: string; createdAt: string; appid: string; body: string; gameName: string | null }
    | { kind: "topic"; id: string; createdAt: string; title: string; categorySlug: string }
    | { kind: "reply"; id: string; createdAt: string; topicId: string; topicTitle: string; content: string; categorySlug: string }
  const activityItems: ActivityItem[] = [
    ...recentComments.map((c) => ({ kind: "comment" as const, id: c.id, createdAt: c.createdAt, appid: c.appid, body: c.body, gameName: c.gameName })),
    ...forumTopics.map((t) => ({ kind: "topic" as const, id: t.id, createdAt: t.createdAt, title: t.title, categorySlug: t.categorySlug })),
    ...forumPosts.map((p) => ({ kind: "reply" as const, id: p.id, createdAt: p.createdAt, topicId: p.topicId, topicTitle: p.topicTitle, content: p.content, categorySlug: p.categorySlug })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return (
    <>
      {/* Profile hero */}
      <section className="mb-8 overflow-hidden rounded-3xl border border-border/50 bg-background/70 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
        <div className="relative w-full aspect-[3/1] bg-card">
          {bannerUrl ? (
            <img src={proxyImageUrl(bannerUrl)} alt={`${displayName} banner`} className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.20),transparent_40%),radial-gradient(circle_at_80%_30%,rgba(99,102,241,0.18),transparent_40%),linear-gradient(to_bottom_right,rgba(24,24,27,0.92),rgba(9,9,11,0.98))]" />
          )}
        </div>
        <div className="px-5 pb-5 pt-2 sm:px-7 sm:pb-7 sm:pt-3 md:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex min-w-0 items-end gap-4 -mt-10 sm:-mt-14">
              <DiscordAvatar
                avatarUrl={user.avatarUrl}
                alt={`${displayName} avatar`}
                className="h-20 w-20 rounded-2xl border-4 border-zinc-950 ring-1 ring-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.5)] sm:h-28 sm:w-28"
              />
              <div className="min-w-0 pb-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-2xl font-black text-white sm:text-3xl md:text-4xl">{displayName}</h1>
                  {data.hasUcPlus ? <UcPlusBadge /> : null}
                  <StaffRoleBadge role={data.role} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground sm:text-base">@{user.username}</p>
              </div>
            </div>
            {heroActions ? <div className="flex items-center gap-2">{heroActions}</div> : null}
          </div>
          <p className="mt-4 max-w-4xl text-sm leading-relaxed text-foreground/90 sm:text-base">
            {user.bio || "No bio yet."}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-foreground/80">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground/80" />
              <span className="text-muted-foreground/80">Joined</span>
              <span className="font-semibold text-foreground/90">{joinedAt}</span>
            </span>
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-foreground/80"
              title={lastActiveDate ? `Last active ${lastActiveAbsolute}` : "No activity yet"}
            >
              <ActivityIcon className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-muted-foreground/80">Active</span>
              <span className="font-semibold text-foreground/90">{lastActiveRelative}</span>
            </span>
            {hasMonthlySupport ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/30 bg-rose-500/10 px-3 py-1.5 text-rose-200">
                <HeartHandshake className="h-3.5 w-3.5" />
                <span className="font-semibold">Monthly supporter</span>
              </span>
            ) : null}
            {requestQuota ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1.5 text-cyan-200">
                <MessageSquare className="h-3.5 w-3.5" />
                <span className="text-cyan-300/70">Requests left</span>
                <span className="font-semibold">{requestQuota.remainingToday === null ? "Unlimited" : requestQuota.remainingToday}</span>
              </span>
            ) : null}
          </div>
        </div>
      </section>

      {/* Stats strip */}
      <section className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
        {statItems.map((item) => (
          <div key={item.label} className="rounded-2xl border border-border/50 bg-card/60 px-4 py-3 backdrop-blur-md shadow-[0_4px_20px_rgba(0,0,0,0.2)]">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/80 font-semibold">
              <item.icon className={`h-3 w-3 ${item.accent}`} />
              {item.label}
            </div>
            <p className="mt-1 text-xl font-bold tabular-nums text-foreground">{formatNumber(item.value || 0)}</p>
          </div>
        ))}
      </section>

      {/* Public support (Ko-fi) */}
      {data.supporterDonations && data.supporterDonations.length > 0 ? (
        <div className="mt-4">
          <Card className={CARD}>
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <HeartHandshake className="h-5 w-5 text-primary" />
                  Public support
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {data.supporterDonations.length} public Ko-fi donation{data.supporterDonations.length === 1 ? "" : "s"}
                </p>
              </div>
              {hasMonthlySupport ? (
                <Badge variant="secondary" className="w-fit gap-1 rounded-full">
                  <Repeat2 className="h-3.5 w-3.5" />
                  Monthly supporter
                </Badge>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-3">
              {data.supporterDonations.slice(0, 3).map((donation, index) => (
                <div key={`${donation.name}-${donation.createdAt || donation.donatedAt || index}`} className="rounded-2xl border border-border/50 bg-secondary/50 px-4 py-3 backdrop-blur-md">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {typeof donation.amount === "number" ? `${donation.amount} ${donation.currency ?? ""}`.trim() : (donation.amount || "Donation")}
                      </p>
                      {donation.donatedAt || donation.createdAt ? (
                        <p className="text-xs text-muted-foreground">{new Date((donation.donatedAt || donation.createdAt) as string).toLocaleDateString()}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {donation.isSubscriptionPayment ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-white/[.07] bg-white/[.03] px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-foreground/80">
                          <Repeat2 className="h-3.5 w-3.5" />
                          Monthly
                        </span>
                      ) : null}
                      {donation.tierName ? (
                        <span className="rounded-full border border-white/[.07] bg-white/[.03] px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{donation.tierName}</span>
                      ) : null}
                    </div>
                  </div>
                  {donation.message ? <p className="mt-2 text-sm leading-relaxed text-muted-foreground">"{donation.message}"</p> : null}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* System profile */}
      {systemProfile && (
        <div className="mt-4">
          <SystemProfileCard
            tier={systemProfile.tier}
            summary={systemProfile.summary}
            spec={systemProfile.spec}
            fingerprint={systemProfile.fingerprint}
            capturedAt={systemProfile.capturedAt}
          />
        </div>
      )}

      {/* Playtime */}
      {playtime && (
        <div className="mt-4">
          <Card className={CARD}>
            <CardHeader className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <Clock3 className="h-5 w-5 text-primary" />
                Playtime
              </CardTitle>
              <button type="button" onClick={() => openWebsite("/leaderboard?tab=playtime")} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                Leaderboard <ArrowRight className="h-3 w-3" />
              </button>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-2xl border border-border/50 bg-secondary/50 px-4 py-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/80 font-semibold">All-time</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-foreground">{formatPlaytime(playtime.totalSeconds)}</p>
                  {playtime.rank && (
                    <p className="text-[10px] text-amber-300/80 inline-flex items-center gap-1 mt-0.5">
                      <Trophy className="h-3 w-3" />Rank #{playtime.rank.rank} of {playtime.rank.outOf}
                    </p>
                  )}
                </div>
                <div className="rounded-2xl border border-border/50 bg-secondary/50 px-4 py-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/80 font-semibold">This week</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-foreground">{formatPlaytime(playtime.weekSeconds)}</p>
                  {playtime.weekRank && (
                    <p className="text-[10px] text-cyan-300/80 inline-flex items-center gap-1 mt-0.5">
                      <Trophy className="h-3 w-3" />Rank #{playtime.weekRank.rank} of {playtime.weekRank.outOf}
                    </p>
                  )}
                </div>
                <div className="rounded-2xl border border-border/50 bg-secondary/50 px-4 py-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/80 font-semibold">Sessions</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-foreground">{playtime.sessionCount.toLocaleString()}</p>
                </div>
                <div className="rounded-2xl border border-border/50 bg-secondary/50 px-4 py-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/80 font-semibold">Last session</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{playtime.lastPlayedAt ? new Date(playtime.lastPlayedAt).toLocaleDateString() : "—"}</p>
                </div>
              </div>

              {playtime.activity && playtime.activity.length > 0 && (() => {
                const max = playtime.activity.reduce((m, b) => (b.seconds > m ? b.seconds : m), 0)
                if (max <= 0) return null
                const totalThirty = playtime.activity.reduce((s, b) => s + b.seconds, 0)
                const activeDays = playtime.activity.filter((b) => b.seconds > 0).length
                return (
                  <div className="rounded-2xl border border-border/50 bg-secondary/40 px-4 py-3">
                    <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-semibold mb-2">
                      <span className="text-muted-foreground/80">Last 30 days</span>
                      <span className="text-muted-foreground tabular-nums">{formatPlaytime(totalThirty)} · {activeDays} active day{activeDays === 1 ? "" : "s"}</span>
                    </div>
                    <div className="flex items-end gap-[2px] h-12">
                      {playtime.activity.map((bucket) => {
                        const pct = (bucket.seconds / max) * 100
                        const active = bucket.seconds > 0
                        return (
                          <div key={bucket.day} className="flex-1 flex flex-col justify-end h-full min-w-0" title={`${bucket.day} · ${formatPlaytime(bucket.seconds)}`}>
                            <div className={`w-full rounded-sm ${active ? "bg-emerald-500/70" : "bg-white/[.05]"}`} style={{ height: `${Math.max(active ? 6 : 2, pct)}%` }} />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}

              {playtime.topGames.length > 0 && (
                <div>
                  <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground/80 font-semibold flex items-center gap-1.5">
                    <Gamepad2 className="h-3.5 w-3.5" />
                    Most played
                  </p>
                  <ul className="space-y-2">
                    {playtime.topGames.map((g, i) => {
                      const maxSeconds = playtime.topGames[0]?.totalSeconds || 0
                      const widthPct = maxSeconds > 0 ? Math.max(3, Math.min(100, Math.round((g.totalSeconds / maxSeconds) * 100))) : 0
                      return (
                        <li key={g.appid}>
                          <Link to={`/game/${encodeURIComponent(g.appid)}`} className="flex items-center justify-between gap-3 rounded-2xl border border-border/50 bg-secondary/50 px-4 py-2.5 hover:bg-white/10 transition-colors">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="text-xs text-muted-foreground/80 tabular-nums shrink-0 w-4">{i + 1}</span>
                              <span className="truncate text-sm font-semibold text-foreground">{g.gameName || `App ${g.appid}`}</span>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-bold tabular-nums text-foreground">{formatPlaytime(g.totalSeconds)}</p>
                              <p className="text-[10px] text-muted-foreground/80 tabular-nums">{g.sessionCount} session{g.sessionCount === 1 ? "" : "s"}</p>
                            </div>
                          </Link>
                          <div className="mt-1 ml-7 h-1 w-[calc(100%-1.75rem)] overflow-hidden rounded-full bg-secondary">
                            <div className="h-full bg-primary" style={{ width: `${widthPct}%` }} />
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Top commented games */}
      <div className="mt-8">
        <Card className={CARD}>
          <CardHeader className="flex flex-row items-center gap-2">
            <MessageCircle className="h-5 w-5 text-primary" />
            <CardTitle className="text-base font-semibold">Top commented games</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {topGames.length === 0 ? (
              <p className="text-sm text-muted-foreground">No games yet.</p>
            ) : (
              topGames.map((game) => (
                <Link key={game.appid} to={`/game/${encodeURIComponent(game.appid)}`} className="flex items-center justify-between rounded-2xl border border-border/50 bg-secondary/50 px-4 py-3 backdrop-blur-md hover:bg-white/10 transition-colors">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{game.name ?? `App ${game.appid}`}</p>
                    <p className="text-xs text-muted-foreground">App ID: {game.appid}</p>
                  </div>
                  <span className="text-sm font-semibold text-foreground">{game.count}</span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Wishlist highlights */}
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Card className={CARD}>
          <CardHeader className="flex flex-row items-center gap-2">
            <Heart className="h-5 w-5 text-primary" />
            <CardTitle className="text-base font-semibold">Wishlist highlights</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {wishlist.length === 0 ? (
              <p className="text-sm text-muted-foreground">No wishlisted games yet.</p>
            ) : (
              wishlist.map((item) => (
                <Link key={item.appid} to={`/game/${encodeURIComponent(item.appid)}`} className="flex items-center justify-between rounded-2xl border border-border/50 bg-secondary/50 px-4 py-3 hover:bg-white/15 backdrop-blur-md transition-colors">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{item.name ?? `App ${item.appid}`}</p>
                    <p className="text-xs text-muted-foreground">Wishlisted {new Date(item.createdAt).toLocaleDateString()}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">View</span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        {recentRequests.length > 0 ? (
          <Card className={CARD}>
            <CardHeader className="flex flex-row items-center gap-2">
              <MessageCircle className="h-5 w-5 text-primary" />
              <CardTitle className="text-base font-semibold">Requests</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentRequests.map((request) => (
                <div key={request.id} className="rounded-2xl border border-border/50 bg-secondary/50 px-4 py-3 backdrop-blur-md">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground line-clamp-2">{request.title || "Request"}</p>
                    <span className="text-xs text-muted-foreground">#{request.id}</span>
                  </div>
                  {request.message && request.message !== "None" ? (
                    <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{request.message}</p>
                  ) : null}
                  <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-2">
                    <span className="uppercase">{request.type.replace(/-/g, " ")}</span>
                    <span>·</span>
                    <span>{request.status}</span>
                    <span>·</span>
                    <span>{new Date(request.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* Public collections */}
      {collections.length > 0 && (
        <div className="mt-8">
          <Card className={CARD}>
            <CardHeader className="flex flex-row items-center gap-2">
              <Layers3 className="h-5 w-5 text-primary" />
              <CardTitle className="text-base font-semibold">Public collections</CardTitle>
              <span className="ml-auto text-xs text-muted-foreground mr-2">{collections.length}</span>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {collections.map((collection) => (
                  <div
                    key={collection.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => collection.shareToken && openWebsite(`/collection/${collection.shareToken}`)}
                    onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && collection.shareToken) openWebsite(`/collection/${collection.shareToken}`) }}
                    className="group flex flex-col rounded-2xl border border-border/50 bg-secondary/40 overflow-hidden hover:border-border transition-colors cursor-pointer"
                  >
                    <div className="relative aspect-[16/10] w-full overflow-hidden bg-card">
                      {collection.previewCovers.length === 0 ? (
                        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40">
                          <Layers3 className="h-10 w-10" />
                        </div>
                      ) : (
                        <div className="absolute inset-0 grid grid-cols-3 grid-rows-2 gap-px bg-background">
                          {collection.previewCovers.slice(0, 6).map((tile, idx) => (
                            <div key={`${tile.appid}-${idx}`} className="relative overflow-hidden">
                              {tile.image ? (
                                <img src={proxyImageUrl(tile.image)} alt={tile.name ?? ""} className="h-full w-full object-cover" loading="lazy" />
                              ) : (
                                <div className="h-full w-full bg-card" />
                              )}
                            </div>
                          ))}
                          {Array.from({ length: Math.max(0, 6 - collection.previewCovers.length) }).map((_, idx) => (
                            <div key={`empty-${idx}`} className="bg-card" />
                          ))}
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                      <div className="absolute bottom-2 left-3 right-3 flex items-end justify-between gap-2">
                        <span className="rounded-full border border-white/10 bg-black/60 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold text-foreground">
                          {collection.gameCount} {collection.gameCount === 1 ? "game" : "games"}
                        </span>
                        <span className="rounded-full border border-white/10 bg-black/60 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold text-foreground opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1">
                          Open <ArrowRight className="h-2.5 w-2.5" />
                        </span>
                      </div>
                    </div>
                    <div className="px-4 py-3 border-t border-border/50">
                      <p className="truncate text-sm font-semibold text-foreground">{collection.name}</p>
                      <p className="text-[11px] text-muted-foreground">Updated {new Date(collection.updatedAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {data.isOwner && (
        <div className="mt-8">
          <MyRequests title="Requests" showUnauthedHelp={false} />
        </div>
      )}

      {/* Recent activity timeline */}
      <div className="mt-8">
        <Card className={CARD}>
          <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <CardTitle className="text-xl font-bold flex items-center gap-2">
              <ActivityIcon className="h-5 w-5 text-primary" />
              Recent activity
            </CardTitle>
            {activityItems.length > 0 ? (
              <span className="text-xs text-muted-foreground/80">Last 16 actions across comments, forums and topics</span>
            ) : null}
          </CardHeader>
          <CardContent>
            {activityItems.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/60 bg-secondary/20 px-6 py-10 text-center">
                <Sparkles className="mx-auto h-6 w-6 text-muted-foreground/60" />
                <p className="mt-2 text-sm text-muted-foreground font-medium">No public activity yet.</p>
                <p className="text-xs text-muted-foreground/80">When this user comments on a game, starts a forum topic, or replies in the forums, it'll show up here.</p>
              </div>
            ) : (
              <ol className="relative space-y-3 border-l border-border/60 pl-5">
                {activityItems.slice(0, 16).map((item) => {
                  const when = timeAgo(item.createdAt) || new Date(item.createdAt).toLocaleDateString()
                  const whenAbs = new Date(item.createdAt).toLocaleString()
                  if (item.kind === "comment") {
                    return (
                      <li key={`comment-${item.id}`} className="group relative">
                        <span className="absolute -left-[27px] top-3 flex h-4 w-4 items-center justify-center rounded-full bg-sky-500/15 ring-2 ring-zinc-950" aria-hidden>
                          <MessageCircle className="h-2.5 w-2.5 text-sky-400" />
                        </span>
                        <Link to={`/game/${encodeURIComponent(item.appid)}#comment-${item.id}`} className="block rounded-2xl border border-border/50 bg-secondary/40 p-4 backdrop-blur-md transition-colors hover:bg-secondary/70">
                          <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                            <span className="text-muted-foreground">Commented on <span className="font-semibold text-primary">{item.gameName ?? `App ${item.appid}`}</span></span>
                            <span title={whenAbs} className="text-muted-foreground/80 tabular-nums shrink-0">{when}</span>
                          </div>
                          <CommentMarkdown text={item.body} className="max-h-20 overflow-hidden text-sm text-foreground/90" />
                        </Link>
                      </li>
                    )
                  }
                  if (item.kind === "topic") {
                    return (
                      <li key={`topic-${item.id}`} className="group relative">
                        <span className="absolute -left-[27px] top-3 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/15 ring-2 ring-zinc-950" aria-hidden>
                          <MessageSquare className="h-2.5 w-2.5 text-emerald-400" />
                        </span>
                        <button type="button" onClick={() => openWebsite(`/forums/${item.categorySlug}/${item.id}`)} className="block w-full text-left rounded-2xl border border-border/50 bg-secondary/40 p-4 backdrop-blur-md transition-colors hover:bg-secondary/70">
                          <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                            <span className="text-muted-foreground">Started a topic</span>
                            <span title={whenAbs} className="text-muted-foreground/80 tabular-nums shrink-0">{when}</span>
                          </div>
                          <p className="text-sm font-semibold text-primary line-clamp-2">{item.title}</p>
                        </button>
                      </li>
                    )
                  }
                  return (
                    <li key={`reply-${item.id}`} className="group relative">
                      <span className="absolute -left-[27px] top-3 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/10 ring-2 ring-zinc-950" aria-hidden>
                        <MessageSquare className="h-2.5 w-2.5 text-emerald-400/80" />
                      </span>
                      <button type="button" onClick={() => openWebsite(`/forums/${item.categorySlug}/${item.topicId}`)} className="block w-full text-left rounded-2xl border border-border/50 bg-secondary/40 p-4 backdrop-blur-md transition-colors hover:bg-secondary/70">
                        <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                          <span className="text-muted-foreground">Replied to <span className="font-semibold text-primary">{item.topicTitle}</span></span>
                          <span title={whenAbs} className="text-muted-foreground/80 tabular-nums shrink-0">{when}</span>
                        </div>
                        <p className="text-sm text-foreground/90 line-clamp-2 leading-relaxed">{item.content}</p>
                      </button>
                    </li>
                  )
                })}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
