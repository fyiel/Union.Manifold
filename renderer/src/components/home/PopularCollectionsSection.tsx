import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DiscordAvatar } from "@/components/DiscordAvatar"
import { UcPlusBadge } from "@/components/UcPlusBadge"
import { GitFork, Layers3, Users } from "@/components/icons"
import { proxyImageUrl } from "@/lib/utils"
import { apiFetch } from "@/lib/api"

type Item = {
  id: string
  name: string
  shareToken: string
  followerCount: number
  forkCount: number
  gameCount: number
  previewAppids: string[]
  previewCoverUrls?: (string | null)[]
  owner: { username: string | null; displayName: string | null; avatarUrl: string | null; ucPlus?: boolean }
}

export function PopularCollectionsSection() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await apiFetch("/api/collections/public?limit=8&offset=0")
        if (!res.ok) throw new Error("bad")
        const data = await res.json()
        const list: Item[] = Array.isArray(data?.items) ? data.items : []
        if (!cancelled) setItems(list)
      } catch {
        if (!cancelled) setItems([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!loading && items.length === 0) return null

  return (
    <section className="py-8 sm:py-10 border-t border-white/[.06]">
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <p className="section-label mb-2">Community</p>
            <h2 className="text-2xl font-light tracking-tight text-white flex items-center gap-2">
              <Layers3 className="h-6 w-6 text-muted-foreground/80" />
              Popular collections
            </h2>
            <p className="text-sm text-muted-foreground/80 mt-1">Public lists people follow most.</p>
          </div>
          <Button asChild variant="outline" size="sm" className="rounded-full border-border shrink-0">
            <Link to="/collections/browse">Browse all</Link>
          </Button>
        </div>

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-36 rounded-2xl udl-skeleton" />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {items.map((c) => (
              <Card
                key={c.id}
                className="rounded-2xl border-white/[.07] bg-background/50 overflow-hidden hover:border-primary/40 transition-colors"
              >
                <CardContent className="p-0">
                  <Link to={`/collections/view/${encodeURIComponent(c.id)}`} className="block p-4 space-y-2">
                    <div className="flex gap-0.5 h-10">
                      {c.previewAppids.slice(0, 6).map((appid, idx) => {
                        const src = c.previewCoverUrls?.[idx] ?? null
                        return (
                          <div
                            key={`${c.id}-${appid}`}
                            className="flex-1 rounded bg-card overflow-hidden border border-white/[.06]"
                          >
                            {src ? (
                              <img src={proxyImageUrl(src)} alt="" className="h-full w-full object-cover" />
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                    <div className="font-medium text-white line-clamp-2 text-sm">{c.name}</div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground/80">
                      <span className="inline-flex items-center gap-0.5">
                        <Users className="h-3 w-3" />
                        {c.followerCount}
                      </span>
                      <span className="inline-flex items-center gap-0.5">
                        <GitFork className="h-3 w-3" />
                        {c.forkCount}
                      </span>
                      <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                        {c.gameCount} games
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <div className="h-6 w-6 rounded-full overflow-hidden bg-secondary shrink-0">
                        <DiscordAvatar avatarUrl={c.owner.avatarUrl} alt="" className="h-full w-full" />
                      </div>
                      <span className="text-xs text-muted-foreground/80 truncate">
                        {c.owner.displayName || c.owner.username || "Member"}
                      </span>
                      {c.owner.ucPlus ? <UcPlusBadge compact /> : null}
                    </div>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
