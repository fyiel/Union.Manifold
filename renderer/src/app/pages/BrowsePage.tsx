import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { X } from "lucide-react"
import { querySources, rememberGames, sourcesAvailable, listSources, onSourcesChanged } from "@/lib/sources"
import { getBrowseCache, setBrowseCache, setBrowseScroll, consumeDiskRestore } from "@/lib/browse-cache"
import { GameCard } from "@/app/manifold/GameCard"
import { MONO, SearchIcon, SmartImage, Spinner, CenterState } from "@/app/manifold/ui"

type SortMode = "relevance" | "a-z" | "size" | "sources"
const SORT_CYCLE: SortMode[] = ["relevance", "a-z", "size", "sources"]
type SrcStatus = "idle" | "searching" | "done" | "failed"
const PAGE = 48
type ZoomedCover = { game: UnifiedSourceGame; candidates: string[] }

function mergeUnique(prev: UnifiedSourceGame[], next: UnifiedSourceGame[]): UnifiedSourceGame[] {
  const seen = new Set(prev.map((g) => g.dedupKey))
  return [...prev, ...next.filter((g) => !seen.has(g.dedupKey))]
}

export function BrowsePage() {
  const cached = getBrowseCache()
  const [query, setQuery] = useState(() => cached?.query ?? "")
  const [committed, setCommitted] = useState(() => cached?.committed ?? "")
  const [sortMode, setSortMode] = useState<SortMode>(() => (cached?.sortMode as SortMode) ?? "relevance")
  const [games, setGames] = useState<UnifiedSourceGame[]>(() => cached?.games ?? [])
  const [total, setTotal] = useState(() => cached?.total ?? 0)
  const [sources, setSources] = useState<SourceInfo[]>([])
  const [status, setStatus] = useState<Record<string, SrcStatus>>({})
  const [sourceCounts, setSourceCounts] = useState<Record<string, number>>(() => cached?.counts ?? {})
  const [loadingMore, setLoadingMore] = useState(false)
  const [sourcesErrored, setSourcesErrored] = useState(false)
  const [zoomedCover, setZoomedCover] = useState<ZoomedCover | null>(null)

  const reqId = useRef(0)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sourcesRef = useRef<SourceInfo[]>([])
  const bootedRef = useRef(false)
  const offsetRef = useRef(cached?.offset ?? 0)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const restoreScroll = useRef(cached?.scrollTop ?? 0)

  useEffect(() => {
    if (!restoreScroll.current) return
    const el = scrollerRef.current
    if (!el) return
    const top = restoreScroll.current
    requestAnimationFrame(() => { if (scrollerRef.current) scrollerRef.current.scrollTop = top })
  }, [])
  const loadingMoreRef = useRef(false)
  const appendReqRef = useRef<number | null>(null)
  const gamesRef = useRef(games)
  useEffect(() => { gamesRef.current = games }, [games])
  const available = sourcesAvailable()

  useEffect(() => {
    let alive = true
    void listSources().then((s) => {
      if (!alive) return
      const avail = s.filter((x) => x.available !== false)
      sourcesRef.current = avail
      setSources(avail)
    })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    setBrowseCache({ query, committed, games, counts: sourceCounts, sortMode, offset: offsetRef.current, total })
  }, [query, committed, games, sourceCounts, sortMode, total])

  useEffect(() => {
    if (!zoomedCover) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoomedCover(null)
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [zoomedCover])

  const openCover = useCallback((game: UnifiedSourceGame, candidates: string[]) => {
    setZoomedCover({ game, candidates })
  }, [])

  const runQuery = useCallback(async (text: string, append = false) => {
    const q = text.trim()
    const id = ++reqId.current
    appendReqRef.current = append ? id : null
    const srcs = sourcesRef.current
    const startOffset = append ? offsetRef.current : 0
    if (!append) {
      setCommitted(q)
      setStatus((prev) => {
        const next = { ...prev }
        for (const s of srcs) if (s.enabled) next[s.id] = "searching"
        return next
      })
    }
    try {
      const params: SourceQueryParams = q
        ? { text: q, sort: "relevance", offset: startOffset, limit: PAGE }
        : { sort: "latest", balanced: true, offset: startOffset, limit: PAGE }
      const res = await querySources(params, id)
      if (id !== reqId.current) return
      rememberGames(res.games)
      const nextGames = append ? mergeUnique(gamesRef.current, res.games) : res.games
      setGames(nextGames)
      offsetRef.current = startOffset + PAGE
      setTotal(append && res.games.length === 0 ? nextGames.length : res.total)
      setSourcesErrored("sourcesErrored" in res && res.sourcesErrored === true)
      const counts: Record<string, number> = {}
      for (const g of nextGames) for (const s of g.sources) counts[s.sourceId] = (counts[s.sourceId] || 0) + 1
      setSourceCounts(counts)
      setStatus((prev) => {
        const next = { ...prev }
        for (const s of srcs) if (s.enabled) next[s.id] = "done"
        return next
      })
    } catch {
      if (id !== reqId.current) return
      if (!append) setStatus((prev) => {
        const next = { ...prev }
        for (const s of srcs) if (s.enabled) next[s.id] = "failed"
        return next
      })
    }
  }, [])

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      await runQuery(committed, true)
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [runQuery, committed])

  useEffect(() => {
    if (!available || !sources.length) return
    if (!bootedRef.current) {
      bootedRef.current = true
      if (games.length && committed === query.trim()) {
        setStatus(() => {
          const next: Record<string, SrcStatus> = {}
          for (const s of sources) if (s.enabled) next[s.id] = "done"
          return next
        })
        if (!consumeDiskRestore()) return
      }
    }
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => void runQuery(query), query.trim() === committed ? 0 : 300)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [query, sources.length, available])

  useEffect(() => {
    return onSourcesChanged(() => {
      void listSources().then((s) => {
        const avail = s.filter((x) => x.available !== false)
        sourcesRef.current = avail
        setSources(avail)
        void runQuery(committed)
      })
    })
  }, [committed, runQuery])

  useEffect(() => {
    const off = window.ucSources?.onBrowsePartial?.((payload) => {
      if (!payload || payload.reqId !== reqId.current) return
      const isAppend = appendReqRef.current === payload.reqId
      const merged = isAppend ? mergeUnique(gamesRef.current, payload.games) : payload.games
      rememberGames(payload.games)
      setGames(merged)
      setTotal(payload.total)
      const counts: Record<string, number> = {}
      for (const g of merged) for (const s of g.sources) counts[s.sourceId] = (counts[s.sourceId] || 0) + 1
      setSourceCounts(counts)
      const done = new Set(payload.doneSources)
      setStatus((prev) => {
        const next = { ...prev }
        for (const s of sourcesRef.current) if (s.enabled) next[s.id] = done.has(s.id) ? "done" : "searching"
        return next
      })
    })
    return off
  }, [])

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (debounce.current) clearTimeout(debounce.current)
      void runQuery(query)
    }
    if (e.key === "Escape") setQuery("")
  }

  const hasQuery = committed.length > 0
  const searching = sources.some((s) => s.enabled && status[s.id] === "searching")
  const hasMore = games.length < total

  const sorted = useMemo(() => {
    const arr = [...games]
    if (sortMode === "a-z") arr.sort((a, b) => a.title.localeCompare(b.title))
    else if (sortMode === "size") arr.sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0))
    else if (sortMode === "sources") arr.sort((a, b) => b.sources.length - a.sources.length || (b.releaseYear || 0) - (a.releaseYear || 0))
    else if (hasQuery) {
      const q = committed.toLowerCase()
      arr.sort((a, b) => {
        const ra = a.title.toLowerCase().startsWith(q) ? 0 : 1
        const rb = b.title.toLowerCase().startsWith(q) ? 0 : 1
        return ra - rb || b.sources.length - a.sources.length || a.title.localeCompare(b.title)
      })
    }
    return arr
  }, [games, sortMode, hasQuery, committed])

  const mirrors = useMemo(() => sorted.reduce((n, g) => n + g.sources.length, 0), [sorted])
  const resultSummary = searching ? `${sorted.length} so far…` : `${sorted.length}${hasMore ? "+" : ""} titles · ${mirrors} mirrors`
  const sortLabel = { relevance: hasQuery ? "Relevance" : "Latest", "a-z": "A–Z", size: "Size", sources: "Most sources" }[sortMode]

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    setBrowseScroll(el.scrollTop)
    if (hasMore && !loadingMoreRef.current && !searching && el.scrollHeight - el.scrollTop - el.clientHeight < 700) {
      void loadMore()
    }
  }

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {}
      <header style={{ flexShrink: 0, padding: "26px 36px 0" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "var(--mf-t0)", letterSpacing: "-0.015em" }}>Browse</h1>
            <p style={{ margin: "6px 0 0", fontFamily: MONO, fontSize: 11.5, color: "var(--mf-t4)" }}>
              one search across {sources.length ? `${sources.length} ${sources.length === 1 ? "catalog" : "catalogs"}` : "every catalog"} · deduped into one library
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ position: "relative", width: 360 }}>
              <SearchIcon style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)" }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKey}
                placeholder="search every source…"
                style={{
                  width: "100%",
                  height: 42,
                  padding: "0 42px 0 37px",
                  borderRadius: 10,
                  border: `1px solid ${searching ? "color-mix(in srgb, var(--mf-t0) 28%, transparent)" : "var(--mf-line-2)"}`,
                  background: "var(--mf-panel)",
                  color: "var(--mf-t1)",
                  fontFamily: MONO,
                  fontSize: 12.5,
                  outline: "none",
                  transition: "border-color .15s",
                }}
              />
              {searching && (
                <Spinner size={15} stroke="var(--mf-t3)" style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)" }} />
              )}
              {query.length > 0 && !searching && (
                <button
                  type="button"
                  title="clear"
                  onClick={() => setQuery("")}
                  className="mf-iconbtn"
                  style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 6, border: "none", background: "color-mix(in srgb, var(--mf-t0) 7%, transparent)", color: "var(--mf-t3)", cursor: "pointer" }}
                >
                  <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" /></svg>
                </button>
              )}
            </div>

            <Link
              to="/advanced"
              title="Advanced search"
              className="mf-ghost"
              style={{ display: "flex", alignItems: "center", gap: 8, height: 42, padding: "0 15px", borderRadius: 10, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", color: "var(--mf-t2)", fontSize: 12.5, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap", textDecoration: "none" }}
            >
              <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><line x1="2.5" y1="4.5" x2="13.5" y2="4.5" /><line x1="2.5" y1="11.5" x2="13.5" y2="11.5" /><circle cx="10.5" cy="4.5" r="2.1" fill="var(--mf-panel)" /><circle cx="5.5" cy="11.5" r="2.1" fill="var(--mf-panel)" /></svg>
              Advanced
            </Link>
          </div>
        </div>

        {}
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 16, borderBottom: "1px solid var(--mf-line)" }}>
          {sources.map((s) => {
            const st: SrcStatus = status[s.id] || "idle"
            const isSearching = st === "searching"
            const isFailed = st === "failed"
            const searchOnly = !hasQuery && s.capabilities?.bulkBrowse === false
            return (
              <div
                key={s.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  height: 28,
                  padding: "0 11px",
                  borderRadius: 8,
                  border: `1px solid ${isFailed ? "rgba(200,128,128,0.25)" : "var(--mf-line)"}`,
                  background: isFailed ? "rgba(120,70,70,0.10)" : "var(--mf-panel-2)",
                  opacity: s.enabled ? 1 : 0.45,
                }}
              >
                <span className={isSearching ? "uc-pulse" : ""} style={{ width: 6, height: 6, borderRadius: 99, background: isFailed ? "#7a4a4a" : isSearching ? "var(--mf-t4)" : "var(--mf-t3)", flexShrink: 0 }} />
                <span style={{ fontSize: 11.5, fontWeight: 500, color: isFailed ? "var(--mf-t4)" : "var(--mf-t2)" }}>{s.name}</span>
                {isSearching && <Spinner size={11} stroke="var(--mf-t4)" />}
                {isFailed && (
                  <span onClick={() => void runQuery(committed)} style={{ fontFamily: MONO, fontSize: 10, color: "#c98080", cursor: "pointer", textDecoration: "underline" }}>retry</span>
                )}
                {!isSearching && !isFailed && (
                  <span style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--mf-t4)" }} title={searchOnly ? "browser-only source — appears in search, not the catalog listing" : undefined}>{searchOnly ? "search" : (sourceCounts[s.id] ?? 0)}</span>
                )}
              </div>
            )
          })}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--mf-t4)" }}>{resultSummary}</span>
            <button
              type="button"
              onClick={() => setSortMode((m) => SORT_CYCLE[(SORT_CYCLE.indexOf(m) + 1) % SORT_CYCLE.length])}
              className="mf-textbtn"
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 13px", borderRadius: 8, border: "1px solid color-mix(in srgb, var(--mf-t0) 9%, transparent)", background: "transparent", color: "var(--mf-t3)", fontFamily: MONO, fontSize: 11, cursor: "pointer" }}
            >
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="4.5" x2="13" y2="4.5" /><line x1="3" y1="8" x2="10" y2="8" /><line x1="3" y1="11.5" x2="7" y2="11.5" /></svg>
              {sortLabel}
            </button>
          </div>
        </div>
      </header>

      {}
      <div ref={scrollerRef} className="mf-scroll" onScroll={onScroll} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "22px 36px 40px" }}>
        {sourcesErrored && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, fontFamily: MONO, fontSize: 11, color: "var(--mf-t4)" }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: "#7a4a4a", flexShrink: 0 }} />
            Some sources unavailable
            <button type="button" onClick={() => void runQuery(committed)} style={{ fontFamily: MONO, fontSize: 10, color: "#c98080", cursor: "pointer", textDecoration: "underline", background: "none", border: "none", padding: 0 }}>retry</button>
          </div>
        )}
        {!available ? (
          <EmptyState text="source backend unavailable" />
        ) : sorted.length > 0 ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))", gap: 18, alignContent: "start" }}>
              {sorted.map((g) => (
                <GameCard key={g.dedupKey} game={g} onZoom={openCover} />
              ))}
            </div>
            {(loadingMore || hasMore) && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "26px 0 4px", gap: 10 }}>
                {loadingMore ? <Spinner size={16} stroke="var(--mf-t5)" /> : null}
                <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--mf-t5)" }}>{loadingMore ? "loading more…" : `scroll for more · ${sorted.length} of ${total}`}</span>
              </div>
            )}
          </>
        ) : searching ? (
          <CenterState>
            <Spinner size={26} stroke="var(--mf-t5)" />
            <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--mf-t4)" }}>querying {sources.length} sources{committed ? ` for “${committed}”` : ""}…</span>
          </CenterState>
        ) : hasQuery ? (
          <CenterState>
            <SearchIcon size={30} stroke="var(--mf-t6)" />
            <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--mf-t5)" }}>no source returned a match for “{committed}”</span>
          </CenterState>
        ) : (
          <EmptyState text="nothing here yet" />
        )}
      </div>
      {zoomedCover && (
        <BrowseCoverLightbox cover={zoomedCover} onClose={() => setZoomedCover(null)} />
      )}
    </div>
  )
}

function BrowseCoverLightbox({ cover, onClose }: { cover: ZoomedCover; onClose: () => void }) {
  const { game, candidates } = cover
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="browse-cover-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      style={{ position: "fixed", inset: 0, zIndex: 1000, display: "grid", placeItems: "center", padding: "clamp(16px, 4vw, 48px)", background: "rgba(5,5,5,0.9)", backdropFilter: "blur(12px)", cursor: "zoom-out" }}
    >
      <SmartImage
        candidates={candidates}
        steamAppId={game.steamAppId}
        alt={`${game.title} cover art`}
        style={{ display: "block", width: "auto", height: "auto", maxWidth: "calc(100vw - 64px)", maxHeight: "calc(100vh - 132px)", objectFit: "contain", borderRadius: 8, boxShadow: "0 24px 80px rgba(0,0,0,0.55)", cursor: "default" }}
      />
      <button
        type="button"
        autoFocus
        aria-label="Close cover preview"
        title="Close"
        onClick={onClose}
        style={{ position: "fixed", top: 22, right: 22, display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, padding: 0, borderRadius: 9, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(16,16,16,0.78)", color: "rgba(255,255,255,0.9)", cursor: "pointer", backdropFilter: "blur(8px)" }}
      >
        <X size={17} strokeWidth={1.7} />
      </button>
      <div style={{ position: "fixed", left: 24, right: 24, bottom: 20, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, pointerEvents: "none", textAlign: "center" }}>
        <span id="browse-cover-title" style={{ maxWidth: 720, fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.92)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{game.title}</span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: "rgba(255,255,255,0.48)", letterSpacing: "0.04em", textTransform: "uppercase" }}>cover preview · Esc to close</span>
      </div>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <CenterState>
      <SearchIcon size={30} stroke="var(--mf-t6)" />
      <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--mf-t5)" }}>{text}</span>
    </CenterState>
  )
}
