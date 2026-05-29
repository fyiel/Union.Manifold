import { useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, Search, Download } from "lucide-react"
import { Globe } from "@/components/icons"
import { apiFetch } from "@/lib/api"
import { validateTheme } from "@/lib/themes/validate"
import type { ThemeDef } from "@/lib/themes/types"
import { useToast } from "@/context/toast-context"
import { cn } from "@/lib/utils"

type CommunityRow = {
  slug: string
  name: string
  authorDiscordId: string
  authorName?: string | null
  authorAvatarUrl?: string | null
  definition: ThemeDef
  installCount: number
  likeCount: number
  createdAt: string
}

const INSTALLED_LS_KEY = "uc_installed_community_themes"

function persistInstalled(themes: ThemeDef[]) {
  try { localStorage.setItem(INSTALLED_LS_KEY, JSON.stringify(themes)) } catch {}
  try { window.dispatchEvent(new Event("uc_installed_themes_pref")) } catch {}
  void window.ucSettings?.set?.("installedCommunityThemeIds", themes.map((t) => t.id))
  void window.ucSettings?.set?.("installedCommunityThemes", themes)
}

export function CommunityBrowser({
  open,
  onClose,
  onInstalled,
  currentlyActiveId,
}: {
  open: boolean
  onClose: () => void
  onInstalled: (theme: ThemeDef) => void
  currentlyActiveId: string
}) {
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<CommunityRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<"popular" | "new">("popular")
  const [installingSlug, setInstallingSlug] = useState<string | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const url = `/api/themes?sort=${sort}${search ? `&search=${encodeURIComponent(search)}` : ""}`
    void (async () => {
      try {
        const res = await apiFetch(url)
        if (!res.ok) throw new Error(`Server returned ${res.status}`)
        const data = await res.json()
        if (cancelled) return
        const list = Array.isArray(data?.themes) ? (data.themes as CommunityRow[]) : []
        setRows(list)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load themes")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, sort, search])

  const filtered = useMemo(() => rows, [rows])

  const install = async (row: CommunityRow) => {
    setInstallingSlug(row.slug)
    try {
      const res = await apiFetch(`/api/themes/${encodeURIComponent(row.slug)}/install`, { method: "POST" })
      if (!res.ok) {
        toast("Install failed.", "error")
        return
      }
      const data = await res.json()
      const candidate = data?.theme ?? row.definition
      const validated = validateTheme(candidate)
      if (!validated.ok) {
        toast(`Theme rejected: ${validated.error}`, "error")
        return
      }
      const stored = readInstalled()
      const next = [...stored.filter((t) => t.id !== validated.theme.id), validated.theme]
      persistInstalled(next)
      onInstalled(validated.theme)
      toast(`Installed "${validated.theme.name}".`, "success")
      onClose()
    } catch {
      toast("Install failed.", "error")
    } finally {
      setInstallingSlug(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Community themes
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or author"
              className="pl-8"
            />
          </div>
          <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
            {(["popular", "new"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSort(s)}
                className={cn(
                  "px-3 py-1 rounded text-xs font-medium transition-colors capitalize",
                  sort === s ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="uc-scrollbar max-h-[55vh] overflow-y-auto pr-2">
          {loading && (
            <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading themes…
            </div>
          )}

          {!loading && error && (
            <div className="text-center py-8 text-sm text-destructive">{error}</div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="text-center py-12 text-sm text-muted-foreground">
              No themes yet — be the first to publish one!
            </div>
          )}

          {!loading && !error && filtered.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filtered.map((row) => {
                const theme = row.definition
                const active = currentlyActiveId === theme.id
                return (
                  <div key={row.slug} className="rounded-xl border border-border p-3 flex flex-col gap-3">
                    <div
                      className="h-20 w-full rounded-lg border border-white/5 overflow-hidden relative"
                      style={{ background: theme.colors.background }}
                    >
                      <div
                        className="absolute left-3 top-3 h-9 w-2/3 rounded-md"
                        style={{ background: theme.colors.card, borderRadius: theme.radius }}
                      />
                      <div
                        className="absolute left-3 bottom-3 h-5 w-16 rounded-md flex items-center justify-center text-[10px] font-medium"
                        style={{
                          background: theme.colors.primary,
                          color: theme.colors["primary-foreground"],
                          borderRadius: theme.radius,
                        }}
                      >
                        Aa
                      </div>
                    </div>
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{row.name}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          by {row.authorName || row.authorDiscordId.slice(0, 8)} · {row.installCount} installs
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant={active ? "outline" : "default"}
                        disabled={installingSlug === row.slug || active}
                        onClick={() => install(row)}
                      >
                        {installingSlug === row.slug ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : active ? (
                          "Active"
                        ) : (
                          <>
                            <Download className="h-3 w-3" />
                            Install
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function readInstalled(): ThemeDef[] {
  try {
    const raw = localStorage.getItem(INSTALLED_LS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const out: ThemeDef[] = []
    for (const t of parsed) {
      const res = validateTheme(t)
      if (res.ok) out.push(res.theme)
    }
    return out
  } catch {
    return []
  }
}
