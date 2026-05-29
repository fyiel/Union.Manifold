import { useCallback, useEffect, useRef, useState } from "react"
import { StickyNote, Cloud, CloudOff } from "lucide-react"
import { apiFetch } from "@/lib/api"

type Props = {
  appid: string
  className?: string
}

const SAVE_DEBOUNCE_MS = 600

/**
 * Per-game scratchpad. Persists locally to `libraryGameMeta[appid].notes`
 * for instant reads and offline access, and (when the user is signed in)
 * syncs to /api/account/game-notes so notes follow them across devices.
 *
 * Sync strategy:
 *   - On mount: load local, then GET remote and adopt the more recent of
 *     the two (server `updated_at` wins by default; if the user has typed
 *     a longer value locally we keep that until they next sync).
 *   - On change (debounced 600ms, also on blur): write local immediately,
 *     PUT remote in parallel. Errors fall back to local-only with a
 *     "couldn't sync" indicator instead of failing the save.
 */
export function GameNotesPanel({ appid, className }: Props) {
  const [value, setValue] = useState("")
  const [savedValue, setSavedValue] = useState("")
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [syncState, setSyncState] = useState<"unknown" | "synced" | "local-only" | "anonymous">("unknown")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadedRef = useRef(false)

  // Read+write local copy in libraryGameMeta. Keeps notes available offline
  // and during the brief window between typing and the server save landing.
  const readLocal = useCallback(async (): Promise<string> => {
    try {
      const meta = await window.ucSettings?.get?.("libraryGameMeta")
      if (!meta || typeof meta !== "object" || Array.isArray(meta)) return ""
      const entry = (meta as Record<string, { notes?: string }>)[appid]
      return typeof entry?.notes === "string" ? entry.notes : ""
    } catch {
      return ""
    }
  }, [appid])

  const writeLocal = useCallback(async (next: string) => {
    const meta = (await window.ucSettings?.get?.("libraryGameMeta")) || {}
    const map = meta && typeof meta === "object" && !Array.isArray(meta) ? meta as Record<string, any> : {}
    const entry = map[appid] && typeof map[appid] === "object" ? { ...map[appid] } : {}
    const trimmed = next.trim()
    if (trimmed) entry.notes = trimmed
    else delete entry.notes
    const updated = { ...map, [appid]: entry }
    await window.ucSettings?.set?.("libraryGameMeta", updated)
  }, [appid])

  // Hydrate from local + remote on mount / appid change.
  useEffect(() => {
    if (!appid) return
    let cancelled = false
    loadedRef.current = false
    setStatus("idle")
    setSyncState("unknown")
    void (async () => {
      const local = await readLocal()
      if (cancelled) return
      setValue(local)
      setSavedValue(local)

      // Try remote. If unauthenticated, mark anonymous; if reachable but the
      // remote is newer/different, prefer remote and write back to local.
      try {
        const res = await apiFetch(`/api/account/game-notes?appid=${encodeURIComponent(appid)}`)
        if (cancelled) return
        if (res.status === 401) {
          setSyncState("anonymous")
        } else if (res.ok) {
          const data = await res.json().catch(() => null)
          const remote = typeof data?.notes === "string" ? data.notes : ""
          if (remote && remote !== local) {
            setValue(remote)
            setSavedValue(remote)
            await writeLocal(remote)
          } else if (!remote && local) {
            // Push the existing local value up so a fresh device gets it.
            try {
              await apiFetch("/api/account/game-notes", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ appid, notes: local }),
              })
            } catch { /* fall through */ }
          }
          setSyncState("synced")
        } else {
          setSyncState("local-only")
        }
      } catch {
        if (!cancelled) setSyncState("local-only")
      } finally {
        if (!cancelled) loadedRef.current = true
      }
    })()
    return () => {
      cancelled = true
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [appid, readLocal, writeLocal])

  const flush = useCallback(async (next: string) => {
    try {
      setStatus("saving")
      await writeLocal(next)
      setSavedValue(next)
      // Sync to server when we know the user is signed in. Anonymous /
      // offline stays local-only — no UI shake every save.
      if (syncState !== "anonymous") {
        try {
          const res = await apiFetch("/api/account/game-notes", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ appid, notes: next }),
          })
          if (res.status === 401) {
            setSyncState("anonymous")
          } else if (res.ok) {
            setSyncState("synced")
          } else {
            setSyncState("local-only")
          }
        } catch {
          setSyncState("local-only")
        }
      }
      setStatus("saved")
    } catch {
      setStatus("error")
    }
  }, [appid, syncState, writeLocal])

  useEffect(() => {
    if (!loadedRef.current) return
    if (value === savedValue) return
    setStatus("saving")
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { void flush(value) }, SAVE_DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [value, savedValue, flush])

  let syncIcon = <StickyNote className="h-3 w-3" />
  let syncTitle = "Notes are stored locally."
  if (syncState === "synced") {
    syncIcon = <Cloud className="h-3 w-3 text-emerald-400" />
    syncTitle = "Synced to your UC account."
  } else if (syncState === "local-only") {
    syncIcon = <CloudOff className="h-3 w-3 text-muted-foreground/80" />
    syncTitle = "Couldn't reach the sync server — saved locally."
  } else if (syncState === "anonymous") {
    syncIcon = <CloudOff className="h-3 w-3 text-muted-foreground/80" />
    syncTitle = "Sign in to sync notes across devices."
  }

  return (
    <div className={`p-5 rounded-2xl bg-card/60 border border-white/[.07] backdrop-blur-md space-y-3 shadow-md ${className ?? ""}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground inline-flex items-center gap-1.5">
          <StickyNote className="h-3 w-3" />
          Your notes
        </h3>
        <span
          className={`text-[10px] inline-flex items-center gap-1 ${
            status === "saving" ? "text-muted-foreground/80"
            : status === "saved" ? "text-emerald-400/80"
            : status === "error" ? "text-destructive"
            : "text-muted-foreground/60"
          }`}
          title={syncTitle}
        >
          {syncIcon}
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "error" ? "Save failed" : ""}
        </span>
      </div>
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          if (debounceRef.current) clearTimeout(debounceRef.current)
          if (value !== savedValue) void flush(value)
        }}
        placeholder="Mods, save folder, key bindings, where you left off…"
        rows={5}
        spellCheck
        maxLength={4096}
        className="w-full rounded-xl border border-white/[.07] bg-white/[.02] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/80 leading-relaxed outline-none focus-visible:border-white/20 resize-y min-h-[6rem]"
      />
      <p className="text-[10px] text-muted-foreground/80">
        {syncState === "synced"
          ? "Synced to your UC account — notes follow you across devices."
          : syncState === "anonymous"
            ? "Sign in to sync these notes across devices."
            : syncState === "local-only"
              ? "Couldn't reach the sync server. Notes are saved locally."
              : "Saving…"}
      </p>
    </div>
  )
}
