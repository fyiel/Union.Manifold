import type { ReactNode } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Cpu, HardDrive, Monitor, MemoryStick, Zap } from "lucide-react"

/**
 * Renders another user's hardware spec — either a single-line summary
 * (tier='summary') or a tiled breakdown (tier='full'). Visibility is
 * enforced server-side; the client just renders whatever the share-view
 * API returned.
 */

type Tier = "summary" | "full"

type Spec = {
  cpu?: { model?: string | null; cores?: number | null; threads?: number | null; baseClockMhz?: number | null } | null
  gpus?: Array<{ name?: string | null; vendor?: string; vramBytes?: number | null; driverVersion?: string | null }> | null
  ram?: { totalBytes?: number; modules?: number | null; speedMhz?: number | null; channels?: string | null } | null
  storage?: { drives?: Array<{ model?: string | null; sizeBytes?: number | null; mediaType?: string | null }> | null } | null
  os?: { name?: string; version?: string; build?: string | null } | null
  displays?: Array<{ width?: number | null; height?: number | null; refreshHz?: number | null }> | null
  graphics?: { directx?: string | null; vulkan?: string | null } | null
}

type Props = {
  tier: Tier
  summary: string | null
  spec: Spec | null
  fingerprint: string
  capturedAt: string
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || !Number.isFinite(bytes)) return "—"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
  const digits = value >= 10 || unit === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unit]}`
}

export function SystemProfileCard({ tier, summary, spec, fingerprint, capturedAt }: Props) {
  const capturedDate = (() => {
    try { return new Date(capturedAt).toLocaleDateString() } catch { return null }
  })()

  return (
    <Card className="border-white/[.07] bg-zinc-900/40 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Cpu className="h-4 w-4 text-zinc-400" />
          PC Specs
          <span className="ml-auto text-[10px] font-mono text-zinc-500" title={`fingerprint ${fingerprint}`}>
            {capturedDate ? `scanned ${capturedDate}` : ""}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {tier === "summary" || !spec ? (
          <p className="text-sm text-zinc-300 truncate" title={summary || undefined}>
            {summary || "(no summary)"}
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-2">
            <Tile
              icon={<Cpu className="h-3.5 w-3.5" />}
              label="CPU"
              value={spec.cpu?.model || "Unknown"}
              sub={spec.cpu?.cores
                ? `${spec.cpu.cores} cores / ${spec.cpu.threads ?? "?"} threads${spec.cpu.baseClockMhz ? ` · ${(spec.cpu.baseClockMhz / 1000).toFixed(2)} GHz` : ""}`
                : null}
            />
            <Tile
              icon={<Zap className="h-3.5 w-3.5" />}
              label="GPU"
              value={spec.gpus?.[0]?.name || "Unknown"}
              sub={spec.gpus?.[0]
                ? [
                    spec.gpus[0].vramBytes ? `${formatBytes(spec.gpus[0].vramBytes)} VRAM` : null,
                    spec.gpus[0].driverVersion ? `driver ${spec.gpus[0].driverVersion}` : null,
                  ].filter(Boolean).join(" · ") || null
                : null}
            />
            <Tile
              icon={<MemoryStick className="h-3.5 w-3.5" />}
              label="RAM"
              value={spec.ram?.totalBytes ? `${Math.round(spec.ram.totalBytes / 1024 ** 3)} GB` : "Unknown"}
              sub={spec.ram?.speedMhz ? `${spec.ram.speedMhz} MHz${spec.ram.channels ? ` · ${spec.ram.channels}` : ""}` : null}
            />
            <Tile
              icon={<Monitor className="h-3.5 w-3.5" />}
              label="OS"
              value={`${spec.os?.name || ""} ${spec.os?.version || ""}`.trim() || "Unknown"}
              sub={spec.os?.build ? `build ${spec.os.build}` : null}
            />
            {spec.storage?.drives && spec.storage.drives.length > 0 && (
              <Tile
                icon={<HardDrive className="h-3.5 w-3.5" />}
                label="Storage"
                value={`${spec.storage.drives.length} drive${spec.storage.drives.length === 1 ? "" : "s"}`}
                sub={spec.storage.drives.slice(0, 2).map((d) => `${(d.mediaType || "").toUpperCase()} ${formatBytes(d.sizeBytes)}`).join(" · ") || null}
              />
            )}
            {spec.displays?.[0] && (
              <Tile
                icon={<Monitor className="h-3.5 w-3.5" />}
                label="Display"
                value={`${spec.displays[0].width}×${spec.displays[0].height}`}
                sub={[
                  spec.displays[0].refreshHz ? `${spec.displays[0].refreshHz} Hz` : null,
                  spec.graphics?.directx ? `DX${spec.graphics.directx}` : null,
                  spec.graphics?.vulkan ? `Vulkan ${spec.graphics.vulkan}` : null,
                ].filter(Boolean).join(" · ") || null}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Tile({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string; sub: string | null }) {
  return (
    <div className="rounded-lg border border-white/[.07] bg-zinc-900/60 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-500">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-xs font-medium text-zinc-100 mt-0.5 truncate" title={value}>{value}</div>
      {sub && <div className="text-[10px] text-zinc-400 mt-0.5 truncate" title={sub}>{sub}</div>}
    </div>
  )
}
