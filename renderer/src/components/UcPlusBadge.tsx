import { Badge } from "@/components/ui/badge"

export function UcPlusBadge({ compact = false }: { compact?: boolean }) {
  return (
    <Badge
      variant="secondary"
      className={compact
        ? "rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300"
        : "rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300"
      }
    >
      UC+
    </Badge>
  )
}
