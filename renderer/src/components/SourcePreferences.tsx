import { useEffect, useState } from "react"
import { ChevronUp, ChevronDown, Check } from "lucide-react"
import {
  listSources,
  loadSourcePriority,
  loadDisabledSources,
  saveSourcePriority,
  saveDisabledSources,
  setSourceEnabled,
  sourceRank,
  sourceName,
} from "@/lib/sources"
import { cn } from "@/lib/utils"

type Row = { id: string; name: string; homepage: string; enabled: boolean }

// Download-sources preference, reorder backends (top = preferred) and toggle
// each on/off. The top enabled source that provides a title drives the single
// big Download button on the game page, the rest become "other links". Persisted
// via ucSettings (priority + disabled list) and pushed to the main registry so
// disabled sources drop out of browse/search.
export function SourcePreferences() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    void (async () => {
      const [list, priority, disabled] = await Promise.all([
        listSources(),
        loadSourcePriority(),
        loadDisabledSources(),
      ])
      if (!alive) return
      const ordered = [...list].sort((a, b) => sourceRank(a.id, priority) - sourceRank(b.id, priority))
      setRows(
        ordered.map((s) => ({ id: s.id, name: sourceName(s.id), homepage: s.homepage, enabled: !disabled.includes(s.id) }))
      )
      setLoading(false)
    })()
    return () => { alive = false }
  }, [])

  const persist = (next: Row[]) => {
    setRows(next)
    void saveSourcePriority(next.map((r) => r.id))
    void saveDisabledSources(next.filter((r) => !r.enabled).map((r) => r.id))
  }

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= rows.length) return
    const next = [...rows]
    ;[next[index], next[target]] = [next[target], next[index]]
    persist(next)
  }

  const toggle = (index: number) => {
    const next = rows.map((r, i) => (i === index ? { ...r, enabled: !r.enabled } : r))
    persist(next)
    void setSourceEnabled(next[index].id, next[index].enabled)
  }

  if (loading) {
    return <p className="font-mono text-sm text-muted-foreground">loading sources…</p>
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold text-foreground">Download Sources</h3>
        <p className="text-sm text-muted-foreground">
          Drag-rank your backends. The big Download button uses the highest enabled source that has the
          game; the rest appear as &ldquo;other links&rdquo;.
        </p>
      </div>

      <div className="overflow-hidden rounded-md border-2 border-border">
        {rows.map((row, i) => (
          <div
            key={row.id}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5",
              i > 0 && "border-t border-border",
              !row.enabled && "opacity-50"
            )}
          >
            {/* reorder */}
            <div className="flex flex-col">
              <button
                type="button"
                aria-label="Move up"
                disabled={i === 0}
                onClick={() => move(i, -1)}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Move down"
                disabled={i === rows.length - 1}
                onClick={() => move(i, 1)}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>

            <div className="w-6 text-center font-mono text-xs text-muted-foreground">{i + 1}</div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">{row.name}</span>
                {i === 0 && row.enabled && (
                  <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                    preferred
                  </span>
                )}
              </div>
              <div className="truncate font-mono text-[11px] text-muted-foreground">{row.homepage}</div>
            </div>

            {/* enable toggle */}
            <button
              type="button"
              role="switch"
              aria-checked={row.enabled}
              onClick={() => toggle(i)}
              className={cn(
                "flex h-6 w-11 shrink-0 items-center rounded-full border-2 px-0.5 transition-colors",
                row.enabled ? "justify-end border-white/30 bg-white/15" : "justify-start border-border bg-transparent"
              )}
            >
              <span className={cn("flex h-4 w-4 items-center justify-center rounded-full", row.enabled ? "bg-white text-black" : "bg-muted-foreground/60")}>
                {row.enabled && <Check className="h-3 w-3" />}
              </span>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
