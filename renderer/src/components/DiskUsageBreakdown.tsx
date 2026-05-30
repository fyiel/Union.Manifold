import { useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronRight } from "@/components/icons"
import { HardDrive } from "lucide-react"

type InstalledEntry = {
  appid: string
  name?: string
  metadata?: { name?: string; size?: string; sizeBytes?: number }
  size?: string
  sizeBytes?: number
}

function parseSizeStringToBytes(value: string | null | undefined): number {
  if (!value) return 0
  const match = String(value).trim().match(/([0-9]+(?:\.[0-9]+)?)\s*([kmgtp]?i?b)?/i)
  if (!match) return 0
  const n = Number(match[1])
  const unit = (match[2] || "b").toLowerCase()
  const mult: Record<string, number> = {
    b: 1, kb: 1024, kib: 1024, mb: 1024 ** 2, mib: 1024 ** 2,
    gb: 1024 ** 3, gib: 1024 ** 3, tb: 1024 ** 4, tib: 1024 ** 4,
  }
  return Math.round(n * (mult[unit] || 1))
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"]
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)))
  return `${(bytes / Math.pow(k, i)).toFixed(i >= 3 ? 1 : 0)} ${sizes[i]}`
}

type Row = { appid: string; name: string; bytes: number }

/**
 * Disk usage breakdown — shows total bytes used by all installed games and a
 * sorted list of the biggest contributors with proportional bars. Driven by
 * the manifest `sizeBytes` (or parsed `size` string) so it's read-only and
 * doesn't trigger a filesystem walk.
 *
 * Mountable anywhere (Library footer / Settings → Downloads / Library
 * sidebar). The component fetches once on mount and re-fetches whenever the
 * `uc_game_installed` event fires so the breakdown stays current after
 * installs and deletes.
 */
export function DiskUsageBreakdown({ compact = false }: { compact?: boolean } = {}) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [loadKey, setLoadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = (await window.ucDownloads?.listInstalledGlobal?.()
          || await window.ucDownloads?.listInstalled?.()
          || []) as InstalledEntry[]
        if (cancelled) return
        const next: Row[] = list.map((entry) => {
          const meta = entry?.metadata || entry
          const name = (meta?.name && typeof meta.name === "string" && meta.name)
            || entry.appid
            || "Unknown"
          const bytesFromMeta = Number((meta as any)?.sizeBytes) || Number(entry?.sizeBytes) || 0
          const bytes = bytesFromMeta > 0
            ? bytesFromMeta
            : parseSizeStringToBytes(((meta as any)?.size as string) || entry?.size)
          return { appid: entry.appid, name, bytes }
        })
        next.sort((a, b) => b.bytes - a.bytes)
        setRows(next)
      } catch {
        if (!cancelled) setRows([])
      }
    })()
    return () => { cancelled = true }
  }, [loadKey])

  useEffect(() => {
    if (typeof window === "undefined") return
    const refresh = () => setLoadKey((value) => value + 1)
    window.addEventListener("uc_game_installed", refresh)
    return () => window.removeEventListener("uc_game_installed", refresh)
  }, [])

  const total = useMemo(() => (rows || []).reduce((sum, row) => sum + row.bytes, 0), [rows])
  const knownCount = useMemo(() => (rows || []).filter((row) => row.bytes > 0).length, [rows])
  const unknownCount = useMemo(() => (rows || []).filter((row) => row.bytes === 0).length, [rows])
  const visible = useMemo(() => {
    const filtered = (rows || []).filter((row) => row.bytes > 0)
    return expanded ? filtered : filtered.slice(0, compact ? 3 : 6)
  }, [rows, expanded, compact])

  if (rows === null) {
    return (
      <div className="rounded-2xl border border-white/[.07] bg-card/40 p-4">
        <div className="udl-skeleton h-4 w-32 rounded mb-3" />
        <div className="udl-skeleton h-3 w-full rounded mb-1.5" />
        <div className="udl-skeleton h-3 w-full rounded mb-1.5" />
        <div className="udl-skeleton h-3 w-2/3 rounded" />
      </div>
    )
  }

  if (rows.length === 0) {
    return null
  }

  return (
    <div className="rounded-2xl border border-white/[.07] bg-card/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-muted-foreground shrink-0" />
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Disk usage</div>
            <div className="text-sm font-semibold text-white tabular-nums">
              {formatBytes(total)} <span className="text-muted-foreground/80 font-normal">across {rows.length} game{rows.length === 1 ? "" : "s"}</span>
            </div>
          </div>
        </div>
        {unknownCount > 0 && (
          <span className="text-[10px] text-muted-foreground/80">{unknownCount} unknown</span>
        )}
      </div>

      <ul className="space-y-1.5">
        {visible.map((row) => {
          const pct = total > 0 ? (row.bytes / total) * 100 : 0
          return (
            <li key={row.appid} className="space-y-0.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-foreground/90 truncate">{row.name}</span>
                <span className="text-muted-foreground/80 tabular-nums shrink-0">{formatBytes(row.bytes)}</span>
              </div>
              <div className="h-1 rounded-full bg-white/[.05] overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-white/70 to-white/30"
                  style={{ width: `${Math.max(2, pct)}%` }}
                />
              </div>
            </li>
          )
        })}
      </ul>

      {knownCount > visible.length && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-white transition-colors"
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {expanded ? "Show fewer" : `Show all ${knownCount} games`}
        </button>
      )}
    </div>
  )
}
