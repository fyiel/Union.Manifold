import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { querySources, nextSourceRequestId, sourceCapabilities, rememberGames, sourcesAvailable, listSources, sourceDirect, sourceIsDirect, mergeUnique, countMirrors, nextSortMode, sortModeLabel, SORT_NOUNS, type SourceSortMode, sortUnifiedGames } from "@/lib/sources"
import { getAdvancedCache, setAdvancedCache } from "@/lib/advanced-cache"
import { GameCard } from "@/app/manifold/GameCard"
import { MONO, SearchIcon, Spinner, CenterState } from "@/app/manifold/ui"

type AdvSort = SourceSortMode
const SIZE_MIN = 0, SIZE_MAX = 130, YEAR_MIN = 2010, YEAR_MAX = 2026
const ADV_PAGE = 60

function capKeyForSort(sort: AdvSort): "title" | "size" | null {
  if (sort === "a-z") return "title"
    return null
}
export function advancedBackendSort(sort: AdvSort, hasText: boolean): SourceSortKey {
  if (sort === "a-z") return "title"
  return hasText ? "relevance" : "latest"
}

type AdvancedQuerySignatureInput = {
  query: string
  enabledIds: string[]
  cats: string[]
  sLo: number
  sHi: number
  yLo: number
  yHi: number
  sort: AdvSort
}

export function advancedQuerySignature(input: AdvancedQuerySignatureInput): string {
  const { query, enabledIds, cats, sLo, sHi, yLo, yHi, sort } = input
  const text = query.trim()
  return JSON.stringify({
    q: text,
    enabledIds,
    cats: [...cats].sort(),
    sLo,
    sHi,
    yLo,
    yHi,
    backendSort: advancedBackendSort(sort, Boolean(text)),
  })
}

export function AdvancedSearchPage() {
  const cached = getAdvancedCache()
  const available = sourcesAvailable()
  const [sources, setSources] = useState<SourceInfo[]>([])
  const [caps, setCaps] = useState<SourceCapabilityReport | null>(null)
  const [genreOptions, setGenreOptions] = useState<string[]>(() => cached?.genreOptions ?? [])

  const [query, setQuery] = useState(() => cached?.query ?? "")
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => cached?.enabled ?? {})
  const [cats, setCats] = useState<Set<string>>(() => new Set(cached?.cats ?? []))
  const [sizeMin, setSizeMin] = useState(() => cached?.sizeMin ?? SIZE_MIN)
  const [sizeMax, setSizeMax] = useState(() => cached?.sizeMax ?? SIZE_MAX)
  const [yearFrom, setYearFrom] = useState(() => cached?.yearFrom ?? YEAR_MIN)
  const [yearTo, setYearTo] = useState(() => cached?.yearTo ?? YEAR_MAX)
  const [directOnly, setDirectOnly] = useState(() => cached?.directOnly ?? false)
  const [sort, setSort] = useState<AdvSort>(() => (cached?.sort as AdvSort) ?? "relevance")

  const [games, setGames] = useState<UnifiedSourceGame[]>(() => cached?.games ?? [])
  const [total, setTotal] = useState(() => cached?.total ?? 0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [sourceNotice, setSourceNotice] = useState<"partial" | "failed" | null>(null)
  const [retryToken, setRetryToken] = useState(0)
  const gamesRef = useRef(games)
  useEffect(() => { gamesRef.current = games }, [games])
  const reqId = useRef(0)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const genresLocked = useRef(Boolean(cached?.genreOptions?.length))
  const offsetRef = useRef(cached?.offset ?? 0)
  const loadingMoreRef = useRef(false)
  const appendReqRef = useRef<number | null>(null)
  const bootedRef = useRef(false)

  useEffect(() => {
    let alive = true
    void listSources().then((s) => {
      if (!alive) return
      const avail = s.filter((x) => x.available !== false)
      setSources(avail)
      setEnabled((prev) => (Object.keys(prev).length ? prev : Object.fromEntries(avail.map((x) => [x.id, true]))))
    })
    void sourceCapabilities().then((c) => { if (alive) setCaps(c) })
    return () => { alive = false }
  }, [])

  const enabledIds = useMemo(() => sources.filter((s) => enabled[s.id]).map((s) => s.id), [sources, enabled])

  const sLo = Math.min(sizeMin, sizeMax), sHi = Math.max(sizeMin, sizeMax)
  const yLo = Math.min(yearFrom, yearTo), yHi = Math.max(yearFrom, yearTo)

  const paramsKey = advancedQuerySignature({ query, enabledIds, cats: [...cats], sLo, sHi, yLo, yHi, sort })
  const slowParamsKey = JSON.stringify({ query: query.trim(), sLo, sHi, yLo, yHi })
  const previousSlowParamsKey = useRef(slowParamsKey)
  const backendSort = advancedBackendSort(sort, Boolean(query.trim()))

  const buildParams = useCallback((offset: number): SourceQueryParams => {
    const text = query.trim()
    const params: SourceQueryParams = { sort: backendSort, sources: enabledIds, offset, limit: ADV_PAGE }
    if (!text) params.balanced = true
    if (text) params.text = text
    if (cats.size) { params.tags = [...cats]; params.tagMode = "or" }
    if (sLo > SIZE_MIN) params.minSizeBytes = sLo * 1e9
    if (sHi < SIZE_MAX) params.maxSizeBytes = sHi * 1e9
    if (yLo > YEAR_MIN) params.minYear = yLo
    if (yHi < YEAR_MAX) params.maxYear = yHi
    return params
  }, [query, backendSort, enabledIds, cats, sLo, sHi, yLo, yHi])

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    const id = nextSourceRequestId()
    reqId.current = id
    appendReqRef.current = null
    setLoadingMore(false)
    loadingMoreRef.current = false
    if (!available || !sources.length) {
      setLoading(false)
      return
    }
    if (!bootedRef.current) {
      bootedRef.current = true
      if (cached && cached.paramsKey === paramsKey && cached.games.length) return
    }
    offsetRef.current = 0
    setSourceNotice(null)
    const slowChanged = previousSlowParamsKey.current !== slowParamsKey
    previousSlowParamsKey.current = slowParamsKey
    if (!enabledIds.length) {
      gamesRef.current = []
      setGames([])
      setTotal(0)
      setLoading(false)
      return
    }
    setLoading(true)
    const run = () => {
      void querySources(buildParams(0), id)
        .then((res) => {
          if (id !== reqId.current) return
          if (!res.ok) {
            setSourceNotice("failed")
            setLoading(false)
            return
          }
          rememberGames(res.games)
          gamesRef.current = res.games
          setGames(res.games)
          setTotal(res.total)
          setSourceNotice(res.sourcesErrored ? "partial" : null)
          offsetRef.current = ADV_PAGE
          if (!genresLocked.current && res.facets.tags.length) {
            genresLocked.current = true
            setGenreOptions(res.facets.tags.map((t) => t.tag))
          }
          setLoading(false)
        })
        .catch(() => {
          if (id !== reqId.current) return
          setSourceNotice("failed")
          setLoading(false)
        })
    }
    debounce.current = setTimeout(run, slowChanged ? 280 : 0)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [paramsKey, slowParamsKey, available, sources.length, retryToken])

  useEffect(() => {
    return window.ucSources?.onBrowsePartial?.((payload) => {
      if (!payload || payload.reqId !== reqId.current) return
      rememberGames(payload.games)
      const nextGames = appendReqRef.current === payload.reqId ? mergeUnique(gamesRef.current, payload.games) : payload.games
      gamesRef.current = nextGames
      setGames(nextGames)
      setTotal(payload.total)
      if (payload.failedSources.length) setSourceNotice("partial")
    })
  }, [])

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    const id = reqId.current
    appendReqRef.current = id
    try {
      const res = await querySources(buildParams(offsetRef.current), id)
      if (id !== reqId.current) return
      if (!res.ok) {
        setSourceNotice("failed")
        return
      }
      rememberGames(res.games)
      const nextGames = mergeUnique(gamesRef.current, res.games)
      gamesRef.current = nextGames
      setGames(nextGames)
      setTotal(res.games.length === 0 ? nextGames.length : Math.max(res.total, nextGames.length))
      setSourceNotice(res.sourcesErrored ? "partial" : null)
      if (res.games.length > 0) offsetRef.current += ADV_PAGE
    } catch {
      if (id === reqId.current) setSourceNotice("failed")
    } finally {
      if (id === reqId.current) {
        appendReqRef.current = null
        loadingMoreRef.current = false
        setLoadingMore(false)
      }
    }
  }, [buildParams])

  useEffect(() => {
    setAdvancedCache({
      query, enabled, cats: [...cats], sizeMin, sizeMax, yearFrom, yearTo, directOnly, sort,
      games, total, genreOptions, offset: offsetRef.current, paramsKey,
    })
  }, [query, enabled, cats, sizeMin, sizeMax, yearFrom, yearTo, directOnly, sort, games, total, genreOptions, paramsKey])

  const sorted = useMemo(() => {
    const arr = directOnly ? games.filter((g) => g.sources.some(sourceIsDirect)) : games
    return sortUnifiedGames(arr, sort, { query, fallbackLatest: true })
  }, [games, directOnly, sort, query])

  const { perSource: sourceCounts } = useMemo(() => countMirrors(sorted), [sorted])

  const capBy = useMemo(() => {
    const m: Record<string, string[]> = {}
    for (const p of caps?.perSource || []) m[p.id] = (p.sort || [])
    return m
  }, [caps])
  const capKey = capKeyForSort(sort)
  const sortUnsupported = (id: string) => capKey != null && !(capBy[id] || []).includes(capKey)

  const allOn = sources.length > 0 && sources.every((s) => enabled[s.id])
  const activeFilterCount = [
    query.trim().length > 0,
    sources.length > 0 && !allOn,
    cats.size > 0,
    sLo > SIZE_MIN || sHi < SIZE_MAX,
    yLo > YEAR_MIN || yHi < YEAR_MAX,
    directOnly,
  ].filter(Boolean).length
  const sizeLabel = sLo <= SIZE_MIN && sHi >= SIZE_MAX ? "Any" : `${sLo}–${sHi} GB`
  const yearLabel = yLo <= YEAR_MIN && yHi >= YEAR_MAX ? "Any" : `${yLo}–${yHi}`
  const genreHint = cats.size ? `${cats.size} selected` : "any"
  const sortLabel = sortModeLabel(sort, query.trim().length > 0)
  const mirrors = useMemo(() => countMirrors(sorted).total, [sorted])
  const hasMore = games.length < total

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (hasMore && !loadingMoreRef.current && !loading && el.scrollHeight - el.scrollTop - el.clientHeight < 700) {
      void loadMore()
    }
  }

  const toggleSource = (id: string) => setEnabled((e) => ({ ...e, [id]: !e[id] }))
  const toggleCat = (c: string) => setCats((prev) => {
    const next = new Set(prev)
    if (next.has(c)) next.delete(c); else next.add(c)
    return next
  })
  const reset = () => {
    setQuery("")
    setEnabled(Object.fromEntries(sources.map((s) => [s.id, true])))
    setCats(new Set())
    setSizeMin(SIZE_MIN); setSizeMax(SIZE_MAX)
    setYearFrom(YEAR_MIN); setYearTo(YEAR_MAX)
    setDirectOnly(false)
  }
  const cycleSort = () => setSort((s) => nextSortMode(s))

  const SECTION_LABEL: React.CSSProperties = { fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--mf-t5)" }

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex" }}>
      {}
      <div className="mf-scroll" style={{ width: 272, flexShrink: 0, borderRight: "1px solid var(--mf-line)", overflowY: "auto", padding: "22px 22px 40px" }}>
        <Link to="/" className="mf-textbtn" style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: MONO, fontSize: 11, color: "var(--mf-t3)", textDecoration: "none", marginBottom: 18 }}>
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 3 4 8 9 13" /><line x1="4" y1="8" x2="13" y2="8" /></svg>
          back to browse
        </Link>
        <h1 style={{ margin: "0 0 22px", fontSize: 18, fontWeight: 600, color: "var(--mf-t0)", letterSpacing: "-0.01em" }}>Advanced search</h1>

        {}
        <div style={{ position: "relative", marginBottom: 24 }}>
          <SearchIcon size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="title or keyword…"
            style={{ width: "100%", height: 38, padding: "0 12px 0 34px", borderRadius: 9, border: "1px solid var(--mf-line-2)", background: "var(--mf-panel)", color: "var(--mf-t1)", fontFamily: MONO, fontSize: 12, outline: "none" }}
          />
        </div>

        {}
        <div style={{ marginBottom: 24 }}>
          <div style={{ ...SECTION_LABEL, marginBottom: 11 }}>Include sources</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {sources.map((s) => {
              const on = Boolean(enabled[s.id])
              const browserOnly = !sourceDirect(s.id)
              const unsupported = sortUnsupported(s.id)
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleSource(s.id)}
                  className="mf-ghost"
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 9, border: `1px solid ${on ? "var(--mf-line-2)" : "var(--mf-line)"}`, background: on ? "color-mix(in srgb, var(--mf-t0) 4%, transparent)" : "var(--mf-panel-2)", cursor: "pointer", textAlign: "left" }}
                >
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 17, height: 17, borderRadius: 5, border: `1.5px solid ${on ? "var(--mf-t1)" : "color-mix(in srgb, var(--mf-t0) 22%, transparent)"}`, background: on ? "var(--mf-t1)" : "transparent", flexShrink: 0 }}>
                    <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke={on ? "var(--mf-accent-ink)" : "transparent"} strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 8.5 6.5 12 13 4" /></svg>
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: on ? "var(--mf-t1)" : "var(--mf-t4)" }}>{s.name}</span>
                  {unsupported && (
                    <span title={`${s.name} can't order by ${SORT_NOUNS[sort]} — results from this source fall back to relevance`} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 7px", borderRadius: 6, background: "rgba(190,90,90,0.13)", border: "1px solid rgba(200,120,120,0.32)" }}>
                      <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="#dd8a8a" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M8 1.8 1.5 13.5h13L8 1.8z" /><line x1="8" y1="6.5" x2="8" y2="9.5" /><circle cx="8" cy="11.4" r="0.6" fill="#dd8a8a" stroke="none" /></svg>
                      <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.04em", color: "#dd8a8a", whiteSpace: "nowrap" }}>no {SORT_NOUNS[sort]}</span>
                    </span>
                  )}
                  <span style={{ flex: 1 }} />
                  {browserOnly && (
                    <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--mf-t4)" }}>browser</span>
                  )}
                  <span style={{ fontFamily: MONO, fontSize: 10, color: "var(--mf-t5)" }}>{sourceCounts[s.id] ?? 0}</span>
                </button>
              )
            })}
          </div>
        </div>

        {}
        {genreOptions.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 11 }}>
              <span style={SECTION_LABEL}>Genre</span>
              <span style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--mf-t5)" }}>{genreHint}</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <Chip label="All" active={cats.size === 0} onClick={() => setCats(new Set())} />
              {genreOptions.map((c) => (
                <Chip key={c} label={c} active={cats.has(c)} onClick={() => toggleCat(c)} />
              ))}
            </div>
          </div>
        )}

        {}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 13 }}>
            <span style={SECTION_LABEL}>Install size</span>
            <span style={{ fontFamily: MONO, fontSize: 11.5, color: "var(--mf-t2)" }}>{sizeLabel}</span>
          </div>
          <RangeRow label="min" min={SIZE_MIN} max={SIZE_MAX} value={sizeMin} onChange={setSizeMin} />
          <RangeRow label="max" min={SIZE_MIN} max={SIZE_MAX} value={sizeMax} onChange={setSizeMax} />
        </div>

        {}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 13 }}>
            <span style={SECTION_LABEL}>Release year</span>
            <span style={{ fontFamily: MONO, fontSize: 11.5, color: "var(--mf-t2)" }}>{yearLabel}</span>
          </div>
          <RangeRow label="from" min={YEAR_MIN} max={YEAR_MAX} value={yearFrom} onChange={setYearFrom} />
          <RangeRow label="to" min={YEAR_MIN} max={YEAR_MAX} value={yearTo} onChange={setYearTo} />
        </div>

        {}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 0", borderTop: "1px solid var(--mf-line)", borderBottom: "1px solid var(--mf-line)" }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--mf-t1)" }}>Direct downloads only</div>
            <div style={{ fontFamily: MONO, fontSize: 10, color: "var(--mf-t4)", marginTop: 2 }}>Hide browser-resolve-only titles</div>
          </div>
          <button type="button" onClick={() => setDirectOnly((v) => !v)} style={{ position: "relative", width: 40, height: 23, borderRadius: 99, border: "none", cursor: "pointer", background: directOnly ? "var(--mf-t1)" : "color-mix(in srgb, var(--mf-t0) 13%, transparent)", transition: "background .15s", flexShrink: 0 }}>
            <span style={{ position: "absolute", top: 3, left: directOnly ? 20 : 3, width: 17, height: 17, borderRadius: 99, background: directOnly ? "var(--mf-accent-ink)" : "var(--mf-t2)", transition: "left .15s" }} />
          </button>
        </div>

        <button type="button" onClick={reset} className="mf-ghost" style={{ marginTop: 18, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 38, borderRadius: 9, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t3)", fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}>
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M13 8a5 5 0 1 1-1.5-3.5" /><polyline points="13 2.5 13 5 10.5 5" /></svg>
          Reset all filters
        </button>
      </div>

      {}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {}
        <header style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "24px 104px 24px 36px", borderBottom: "1px solid var(--mf-line)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span style={{ fontSize: 16, fontWeight: 600, color: "var(--mf-t0)" }}>{sorted.length} {sorted.length === 1 ? "title" : "titles"}</span>
            <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--mf-t4)" }}>{mirrors} mirrors across selected sources</span>
            {loading && <Spinner size={12} stroke="var(--mf-t4)" />}
            {activeFilterCount > 0 && (
              <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--mf-t3)", padding: "3px 9px", borderRadius: 99, border: "1px solid var(--mf-line-2)" }}>{activeFilterCount} filters</span>
            )}
          </div>
          <button type="button" onClick={cycleSort} className="mf-textbtn" style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 8, border: "1px solid color-mix(in srgb, var(--mf-t0) 9%, transparent)", background: "transparent", color: "var(--mf-t3)", fontFamily: MONO, fontSize: 11, cursor: "pointer" }}>
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="4.5" x2="13" y2="4.5" /><line x1="3" y1="8" x2="10" y2="8" /><line x1="3" y1="11.5" x2="7" y2="11.5" /></svg>
            {sortLabel}
          </button>
        </header>

        <div className="mf-scroll" onScroll={onScroll} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "24px 36px 40px" }}>
          {sourceNotice && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, fontFamily: MONO, fontSize: 11, color: "var(--mf-t4)" }}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: "#7a4a4a", flexShrink: 0 }} />
              {sourceNotice === "partial" ? "Some sources unavailable" : "Sources unavailable — showing previous results"}
              <button type="button" onClick={() => setRetryToken((value) => value + 1)} style={{ fontFamily: MONO, fontSize: 10, color: "#c98080", cursor: "pointer", textDecoration: "underline", background: "none", border: "none", padding: 0 }}>retry</button>
            </div>
          )}
          {!available ? (
            <CenterState>
              <SearchIcon size={30} stroke="var(--mf-t6)" />
              <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--mf-t5)" }}>source backend unavailable</span>
            </CenterState>
          ) : sorted.length > 0 ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))", gap: 18, alignContent: "start" }}>
                {sorted.map((g) => (
                  <GameCard key={g.dedupKey} game={g} />
                ))}
              </div>
              {(loadingMore || hasMore) && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "26px 0 4px", gap: 10 }}>
                  {loadingMore ? <Spinner size={16} stroke="var(--mf-t5)" /> : null}
                  <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--mf-t5)" }}>{loadingMore ? "loading more…" : `scroll for more · ${games.length} of ${total}`}</span>
                </div>
              )}
            </>
          ) : loading ? (
            <CenterState>
              <Spinner size={26} stroke="var(--mf-t5)" />
              <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--mf-t4)" }}>querying sources…</span>
            </CenterState>
          ) : (
            <CenterState>
              <SearchIcon size={30} stroke="var(--mf-t6)" />
              <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--mf-t4)" }}>{sourceNotice === "failed" ? "sources unavailable — retry above" : "no titles match these filters"}</span>
              <button type="button" onClick={reset} className="mf-ghost" style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t2)", fontSize: 12, fontWeight: 500, cursor: "pointer" }}>Reset filters</button>
            </CenterState>
          )}
        </div>
      </div>
    </div>
  )
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ padding: "6px 12px", borderRadius: 999, fontSize: 11.5, fontWeight: 500, border: `1px solid ${active ? "var(--mf-line-2)" : "var(--mf-line)"}`, background: active ? "color-mix(in srgb, var(--mf-t0) 12%, transparent)" : "transparent", color: active ? "var(--mf-t0)" : "var(--mf-t4)", cursor: "pointer" }}
    >
      {label}
    </button>
  )
}

function RangeRow({ label, min, max, value, onChange }: { label: string; min: number; max: number; value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, marginTop: label === "min" || label === "from" ? 0 : 12 }}>
      <span style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--mf-t4)", width: 26 }}>{label}</span>
      <input type="range" className="uc-range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ flex: 1 }} />
    </div>
  )
}
