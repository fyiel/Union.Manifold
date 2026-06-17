import { memo, useMemo } from "react"
import { Link } from "react-router-dom"
import { Calendar, Clock, CheckCircle2 } from "lucide-react"
import { ExternalLink } from "@/components/icons"
import { LoadingAnimated, UCStatic } from "@/components/brand/brand-assets"
import { Progress } from "@/components/ui/progress"
import { proxyImageUrl } from "@/lib/utils"
import { GameArtAura } from "@/components/game-art-aura"

interface PendingGame {
  appid: string
  name: string
  version?: string
  header_image?: string
  release_date?: string
  genres: string[]
  developers?: string
  mirror_status: string          // 'pending' | 'partial'
  current_mirror_info: {
    status?: string              // 'uploading' | 'mirroring' | 'done'
    host?: string
    part?: number
    completedHosts?: string[]
    selectedHosts?: string[]
    parts?: Record<string, {
      host?: string
      activeHosts?: string[]
      filename?: string
      phase?: string
      bytesUploaded?: number
      bytesTotal?: number
      bytesPerSecond?: number
    }>
    vikingfile?: {
      queued: number
      running: number
      done: number
      failed: number
      latestStatus: string | null
      attempts: number | null
      nextAttemptAt: string | null
      updatedAt: string | null
    }
  } | null
  store_link?: string
  online_fix?: boolean
}

interface PendingGameCardProps {
  game: PendingGame
}

const HOST_LABELS: Record<string, string> = {
  pixeldrain: 'Pixeldrain',
  datavaults: 'DataVaults',
  fileq: 'FileQ',
  vikingfile: 'VikingFile',
  ucfiles: 'UC Files',
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatEta(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null
  if (seconds < 60) return `${seconds}s left`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m left`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return `${h}h ${m}m left`
}

function computeProgress(info: PendingGame['current_mirror_info']) {
  if (!info?.parts) return null
  let bytesUploaded = 0
  let bytesTotal = 0
  let bytesPerSecond = 0
  for (const part of Object.values(info.parts)) {
    const u = Number(part?.bytesUploaded || 0)
    const t = Number(part?.bytesTotal || 0)
    const bps = Number(part?.bytesPerSecond || 0)
    if (u > 0) bytesUploaded += u
    if (t > 0) bytesTotal += t
    if (bps > 0) bytesPerSecond += bps
  }
  if (bytesTotal === 0) return null
  const percent = Math.min(100, Math.round((bytesUploaded / bytesTotal) * 100))
  const etaSeconds = bytesPerSecond > 0 ? Math.max(0, Math.round((bytesTotal - bytesUploaded) / bytesPerSecond)) : null
  return { bytesUploaded, bytesTotal, percent, bytesPerSecond, etaSeconds }
}

function getMirrorStatusLabel(info: PendingGame["current_mirror_info"], mirrorStatus: string, progressPercent: number | null) {
  if (!info) return mirrorStatus === "partial" ? "Partially Available" : "Processing"
  if (info.status === "uploading") {
    return progressPercent !== null ? `Uploading · ${progressPercent}%` : "Uploading"
  }
  if (info.status === "mirroring") {
    const completedSet = new Set(info.completedHosts || [])
    const activeParts = info.parts ? Object.values(info.parts) : []
    const activeHostNames = [...new Set(
      activeParts.flatMap((p: any) =>
        Array.isArray(p?.activeHosts) ? p.activeHosts : (p?.host ? [p.host] : [])
      ).filter((h: string) => !completedSet.has(h))
    )].map(h => HOST_LABELS[h] || h)

    if (activeHostNames.length > 0) {
      return `Mirroring → ${activeHostNames.join(", ")}`
    }
    return "Mirroring"
  }
  if (info.status === "done") return "Complete"
  return mirrorStatus === "partial" ? "Partially Available" : "Processing"
}

function getMirrorStatusBg(info: PendingGame["current_mirror_info"], mirrorStatus: string) {
  if (info?.status === "uploading") return "bg-amber-500/15 border-amber-500/30 text-amber-300"
  if (info?.status === "mirroring") return "bg-sky-500/15 border-sky-500/30 text-sky-300"
  if (info?.status === "done") return "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
  if (mirrorStatus === "partial") return "bg-white/10 border-white/20 text-white backdrop-blur-sm"
  return "bg-secondary/50 border-white/[.07] text-muted-foreground"
}

function getMirrorIcon(info: PendingGame["current_mirror_info"], _mirrorStatus: string) {
  if (info?.status === "mirroring" || info?.status === "uploading")
    return <LoadingAnimated className="w-3 h-3" alt="Processing" />
  if (info?.status === "done")
    return <CheckCircle2 className="w-3 h-3 text-emerald-300" />
  return <UCStatic className="w-3 h-3" alt="Queue" />
}

export const PendingGameCard = memo(function PendingGameCard({ game }: PendingGameCardProps) {
  const allGenres = Array.isArray(game.genres)
    ? game.genres.filter((g) => String(g).toLowerCase() !== "nsfw")
    : []

  const progress = useMemo(() => computeProgress(game.current_mirror_info), [game.current_mirror_info])
  const statusLabel = getMirrorStatusLabel(game.current_mirror_info, game.mirror_status, progress?.percent ?? null)
  const statusBadge = getMirrorStatusBg(game.current_mirror_info, game.mirror_status)
  const statusIcon = getMirrorIcon(game.current_mirror_info, game.mirror_status)
  const completedHosts = game.current_mirror_info?.completedHosts || []
  const isUploading = game.current_mirror_info?.status === "uploading"
  const isMirroring = game.current_mirror_info?.status === "mirroring"
  const isActive = isUploading || isMirroring
  const vikingSummary = game.current_mirror_info?.vikingfile || null

  const statusDescription = isUploading
    ? "Streaming to UC.Files. Mirror queue starts as each part finishes."
    : isMirroring
      ? "Mirroring to alternate hosts server-side. No upload bandwidth on your end."
      : game.mirror_status === "partial"
        ? "Some hosts are already ready while the rest finish processing."
        : "Still being processed before release."

  const etaLine = formatEta(progress?.etaSeconds ?? null)
  const heroSrc = proxyImageUrl(game.header_image || "") || "./fallbacks/game-hero-16x9.svg"

  return (
    <GameArtAura src={heroSrc} scopeKey={String(game.appid)} borderRadius="1.5rem" className="h-full">
      <Link
        to={`/game/${game.appid}`}
        className="block select-none group h-full"
      >
        <div className="relative h-full overflow-hidden rounded-3xl bg-card/60 backdrop-blur-md border border-white/[.07] transition-all duration-300 group-hover:-translate-y-1 group-hover:border-white/[.14] active:scale-[0.98] flex flex-col">

          {/* Image area */}
          <div className="relative h-[180px] overflow-hidden rounded-t-3xl shrink-0">
            <img
              src={proxyImageUrl(game.header_image || "") || "./fallbacks/game-hero-16x9.svg"}
              alt={game.name}
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-black/10 z-[1]" />

            <div className="absolute top-0 left-0 right-0 z-[2] flex items-start justify-between p-3 gap-2">
              <div className={`flex items-center gap-1.5 rounded-full backdrop-blur-md px-3 py-1 border text-[11px] font-semibold uppercase tracking-wider ${statusBadge}`}>
                {statusIcon}
                <span>{statusLabel}</span>
              </div>
            </div>

          <div className="absolute bottom-0 left-0 right-0 z-[2] p-3.5 flex flex-col gap-1.5">
            <h3 className="text-base font-bold tracking-tight text-white leading-tight line-clamp-2">
              {game.name}
            </h3>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground font-medium">
                <Calendar className="w-3 h-3" />
                {game.release_date
                  ? new Date(game.release_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                  : "TBA"}
              </span>
            </div>
          </div>
        </div>

        {/* Info panel */}
        <div className="px-5 pb-5 pt-4 space-y-3 flex-1 flex flex-col">

          {/* Progress bar (only when uploading with real bytes) */}
          {progress && isUploading && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{formatBytes(progress.bytesUploaded)} / {formatBytes(progress.bytesTotal)}</span>
                <span className="font-mono text-foreground/80">{progress.percent}%</span>
              </div>
              <Progress value={progress.percent} className="h-1.5 bg-white/[.04]" />
              {etaLine && (
                <div className="text-[11px] text-muted-foreground/80 text-right">{etaLine}</div>
              )}
            </div>
          )}

          {/* Status card */}
          <div className={`rounded-2xl border border-white/[.07] p-3 flex items-start gap-2.5 ${isActive ? 'bg-amber-500/5' : 'bg-secondary/40'}`}>
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${isActive ? 'bg-amber-500/15' : 'bg-secondary/80'}`}>
              {isActive ? (
                <LoadingAnimated className="w-4 h-4" alt="Processing" />
              ) : (
                <UCStatic className="w-4 h-4 text-muted-foreground" alt="Queue" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80 mb-0.5">Queue Status</p>
              <p className="text-sm font-semibold leading-tight text-white">{statusLabel}</p>
              <p className="text-[11px] text-muted-foreground/80 mt-0.5 leading-snug line-clamp-2">{statusDescription}</p>
            </div>
          </div>

          {/* Host badges row */}
          {(completedHosts.length > 0 || isActive) && (
            <div className="flex flex-wrap gap-1.5">
              {['ucfiles', 'vikingfile'].map((host) => {
                const done = completedHosts.includes(host)
                const active = !done && (
                  game.current_mirror_info?.parts
                    ? Object.values(game.current_mirror_info.parts).some((p: any) =>
                        p?.host === host || (Array.isArray(p?.activeHosts) && p.activeHosts.includes(host))
                      )
                    : false
                )
                const queued = host === 'vikingfile' && !done && !active && vikingSummary?.latestStatus === 'queued'
                const failed = host === 'vikingfile' && !done && vikingSummary?.latestStatus === 'failed'
                return (
                  <span
                    key={host}
                    className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
                      done
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                        : active
                          ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                          : queued
                            ? 'bg-sky-500/15 border-sky-500/30 text-sky-300'
                            : failed
                              ? 'bg-red-500/15 border-red-500/30 text-red-300'
                          : 'bg-secondary/40 border-white/[.07] text-muted-foreground/80'
                    }`}
                  >
                    {done && <CheckCircle2 className="w-2.5 h-2.5 text-emerald-300" />}
                    {HOST_LABELS[host]}
                  </span>
                )
              })}
            </div>
          )}

          {/* Genres */}
          {allGenres.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {allGenres.slice(0, 3).map((genre) => (
                <span key={genre} className="text-[11px] font-medium text-foreground/80 bg-secondary/60 px-2.5 py-0.5 rounded-full">
                  {genre}
                </span>
              ))}
              {allGenres.length > 3 && (
                <span className="text-[11px] font-medium text-muted-foreground/80 bg-secondary/30 border border-white/[.07] px-2.5 py-0.5 rounded-full">
                  +{allGenres.length - 3}
                </span>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="mt-auto flex items-center justify-between border-t border-white/[.07] pt-3">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
              <Clock className="w-3 h-3" />
              {game.version || 'Processing'}
            </div>
            {game.store_link && (
              <a
                href={game.store_link}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-white transition-colors duration-200"
              >
                <ExternalLink className="w-3 h-3" />
                Store
              </a>
            )}
          </div>
        </div>
      </div>
    </Link>
    </GameArtAura>
  )
})
