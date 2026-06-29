import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { querySources, rememberGames, sourcesAvailable, listSources } from "@/lib/sources"
import { getBrowseCache, setBrowseCache, setBrowseScroll } from "@/lib/browse-cache"
import { GameCard } from "@/app/manifold/GameCard"
import { MONO, SearchIcon, Spinner, CenterState } from "@/app/manifold/ui"

// Browse, one search across every catalog, deduped into one grid, with endless
// scrolling. Results are cached (module scope, see browse-cache) so navigating
// away and back restores the exact view (including how far you'd scrolled)
// without refetching.

type SortMode = "relevance" | "a-z" | "size" | "sources"
const SORT_CYCLE: SortMode[] = ["relevance", "a-z", "size", "sources"]
type SrcStatus = "idle" | "searching" | "done" | "failed"
const PAGE = 48

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

  const reqId = useRef(0)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sourcesRef = useRef<SourceInfo[]>([])
  const bootedRef = useRef(false)
  const offsetRef = useRef(cached?.offset ?? 0) // next offset to fetch
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const restoreScroll = useRef(cached?.scrollTop ?? 0)

  // Restore the prior scroll position when returning from a detail page (the
  // cached games are already seeded above, so the content height is there).
  useEffect(() => {
    if (!restoreScroll.current) return
    const el = scrollerRef.current
    if (!el) return
    const top = restoreScroll.current
    requestAnimationFrame(() => { if (scrollerRef.current) scrollerRef.current.scrollTop = top })
  }, [])
  const loadingMoreRef = useRef(false)
  const available = sourcesAvailable()

  useEffect(() => {
    let alive = true
    void listSources().then((s) => {
      if (!alive) return
      sourcesRef.current = s
      setSources(s)
    })
    return () => { alive = false }
  }, [])

  // Persist the live view to the module cache (incl. how far we've paged).
  useEffect(() => {
    setBrowseCache({ query, committed, games, counts: sourceCounts, sortMode, offset: offsetRef.current, total })
  }, [query, committed, games, sourceCounts, sortMode, total])

  const runQuery = useCallback(async (text: string, append = false) => {
    const q = text.trim()
    const id = ++reqId.current
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
      const res = await querySources(params)
      if (id !== reqId.current) return
      rememberGames(res.games)
      const nextGames = append ? mergeUnique(games, res.games) : res.games
      setGames(nextGames)
      offsetRef.current = startOffset + PAGE
      setTotal(res.total)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games])

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

  // Fetch driver: wait for sources, restore from cache without refetching on the
  // first run, then re-query (debounced) when the query changes.
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
        return
      }
    }
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => void runQuery(query), query.trim() === committed ? 0 : 300)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, sources.length, available])

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
      {/* header */}
      <header style={{ flexShrink: 0, padding: "26px 36px 0" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "#ededed", letterSpacing: "-0.015em" }}>Browse</h1>
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
                  border: `1px solid ${searching ? "rgba(255,255,255,0.28)" : "var(--mf-line-2)"}`,
                  background: "var(--mf-panel)",
                  color: "var(--mf-t1)",
                  fontFamily: MONO,
                  fontSize: 12.5,
                  outline: "none",
                  transition: "border-color .15s",
                }}
              />
              {searching && (
                <Spinner size={15} stroke="#9a9a9a" style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)" }} />
              )}
              {query.length > 0 && !searching && (
                <button
                  type="button"
                  title="clear"
                  onClick={() => setQuery("")}
                  className="mf-iconbtn"
                  style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 6, border: "none", background: "rgba(255,255,255,0.07)", color: "var(--mf-t3)", cursor: "pointer" }}
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

        {/* source status strip */}
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
                <span className={isSearching ? "uc-pulse" : ""} style={{ width: 6, height: 6, borderRadius: 99, background: isFailed ? "#7a4a4a" : isSearching ? "#7d7d7d" : "#8a8a8a", flexShrink: 0 }} />
                <span style={{ fontSize: 11.5, fontWeight: 500, color: isFailed ? "var(--mf-t4)" : "var(--mf-t2)" }}>{s.name}</span>
                {isSearching && <Spinner size={11} stroke="#7d7d7d" />}
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
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 13px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.09)", background: "transparent", color: "var(--mf-t3)", fontFamily: MONO, fontSize: 11, cursor: "pointer" }}
            >
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="4.5" x2="13" y2="4.5" /><line x1="3" y1="8" x2="10" y2="8" /><line x1="3" y1="11.5" x2="7" y2="11.5" /></svg>
              {sortLabel}
            </button>
          </div>
        </div>
      </header>

      {/* grid scroller */}
      <div ref={scrollerRef} className="mf-scroll" onScroll={onScroll} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "22px 36px 40px" }}>
        {!available ? (
          <EmptyState text="source backend unavailable" />
        ) : sorted.length > 0 ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))", gap: 18, alignContent: "start" }}>
              {sorted.map((g) => (
                <GameCard key={g.dedupKey} game={g} />
              ))}
            </div>
            {(loadingMore || hasMore) && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "26px 0 4px", gap: 10 }}>
                {loadingMore ? <Spinner size={16} stroke="#5f5f5f" /> : null}
                <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--mf-t5)" }}>{loadingMore ? "loading more…" : `scroll for more · ${sorted.length} of ${total}`}</span>
              </div>
            )}
          </>
        ) : searching ? (
          <CenterState>
            <Spinner size={26} stroke="#5f5f5f" />
            <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--mf-t4)" }}>querying {sources.length} sources{committed ? ` for “${committed}”` : ""}…</span>
          </CenterState>
        ) : hasQuery ? (
          <CenterState>
            <SearchIcon size={30} stroke="#4a4a4a" />
            <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--mf-t5)" }}>no source returned a match for “{committed}”</span>
          </CenterState>
        ) : (
          <EmptyState text="nothing here yet" />
        )}
      </div>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <CenterState>
      <SearchIcon size={30} stroke="#4a4a4a" />
      <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--mf-t5)" }}>{text}</span>
    </CenterState>
  )
}
