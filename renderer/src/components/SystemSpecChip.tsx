import { Cpu } from "lucide-react"

/**
 * Small "RTX 4070 · 32GB · Win11" chip rendered next to a commenter's name
 * when they've opted into hardware visibility for the post. Shape comes
 * pre-rendered from the server (user_system_snapshots.summary).
 */
type Props = {
  summary: string | null | undefined
  fingerprint?: string | null
  className?: string
}

export function SystemSpecChip({ summary, fingerprint, className }: Props) {
  if (!summary) return null
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full border border-white/10 bg-zinc-900/60 px-1.5 py-px text-[10px] font-medium text-zinc-300 " +
        (className || "")
      }
      title={fingerprint ? `Author's PC (fingerprint ${fingerprint.slice(0, 8)})` : "Author's PC"}
    >
      <Cpu className="h-2.5 w-2.5 text-zinc-400" />
      <span className="truncate max-w-[260px]">{summary}</span>
    </span>
  )
}
