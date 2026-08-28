import { memo, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowDownToLine, Maximize2 } from "lucide-react"
import { sourceAbbr, sourceName, sourceIsDirect } from "@/lib/sources"
import { MONO, COVER_LINES, gbLabel, SmartImage, useGameImages } from "@/app/manifold/ui"
import { preloadSourceGamePage } from "@/app/route-loaders"

export const GameCard = memo(function GameCard({
  game,
  onZoom,
}: {
  game: UnifiedSourceGame
  onZoom?: (game: UnifiedSourceGame, candidates: string[]) => void
}) {
  const candidates = useGameImages(game)
  const [imgOk, setImgOk] = useState(true)
  const hasImg = imgOk && candidates.length > 0
  const meta = [game.genres?.[0], game.releaseYear || undefined].filter(Boolean).join(" · ")
  const size = game.sizeText || gbLabel(game.sizeBytes)
  const resolvable = game.sources.some(sourceIsDirect)
  const n = game.sources.length
  const detailUrl = `/g/${encodeURIComponent(game.dedupKey)}`
  const detailState = { game }

  return (
    <div
      className="mf-card"
      style={{ display: "flex", flexDirection: "column", border: "1px solid color-mix(in srgb, var(--mf-t0) 7%, transparent)", borderRadius: 10, overflow: "hidden", background: "var(--mf-panel)" }}
    >
      <div style={{ position: "relative", aspectRatio: "3 / 4", background: hasImg ? "var(--mf-well)" : COVER_LINES }}>
        <Link
          to={detailUrl}
          state={detailState}
          aria-label={`Open ${game.title}`}
          onPointerEnter={preloadSourceGamePage}
          onFocus={preloadSourceGamePage}
          onPointerDown={preloadSourceGamePage}
          style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", padding: 12, color: "inherit", textDecoration: "none", cursor: "pointer" }}
        >
          {hasImg && (
            <SmartImage candidates={candidates} steamAppId={game.steamAppId} alt={game.title} lazy onAllFailed={() => setImgOk(false)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
          )}
          {!hasImg && (
            <span style={{ fontFamily: MONO, fontSize: 11, lineHeight: 1.35, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--mf-t2)" }}>{game.title}</span>
          )}
        </Link>
        {resolvable && (
          <span title="Direct Download Available" style={{ position: "absolute", top: 10, right: 10, display: "flex", alignItems: "center", justifyContent: "center", width: 25, height: 25, borderRadius: 7, background: "rgba(0,0,0,0.55)", border: "1px solid color-mix(in srgb, var(--mf-t0) 14%, transparent)", color: "var(--mf-t1)", pointerEvents: "none" }}>
            <ArrowDownToLine size={12} strokeWidth={1.6} />
          </span>
        )}
        {hasImg && onZoom && (
          <button
            type="button"
            title="Enlarge cover art"
            aria-label={`Enlarge cover art for ${game.title}`}
            onClick={() => onZoom(game, candidates)}
            style={{ position: "absolute", right: 10, bottom: 10, display: "flex", alignItems: "center", justifyContent: "center", width: 29, height: 29, padding: 0, borderRadius: 7, border: "1px solid color-mix(in srgb, white 24%, transparent)", background: "rgba(0,0,0,0.68)", color: "rgba(255,255,255,0.9)", cursor: "zoom-in", backdropFilter: "blur(8px)" }}
          >
            <Maximize2 size={13} strokeWidth={1.7} />
          </button>
        )}
      </div>
      <Link to={detailUrl} state={detailState} onPointerEnter={preloadSourceGamePage} onFocus={preloadSourceGamePage} onPointerDown={preloadSourceGamePage} style={{ padding: "11px 12px 12px", display: "flex", flexDirection: "column", gap: 8, color: "inherit", textDecoration: "none" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--mf-t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{game.title}</span>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontFamily: MONO, fontSize: 10, color: "var(--mf-t4)", letterSpacing: "0.02em", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{meta || " "}</span>
          <span style={{ fontFamily: MONO, fontSize: 10, color: "var(--mf-t4)", whiteSpace: "nowrap", flexShrink: 0 }}>{size}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {game.sources.map((s) => {
            const direct = sourceIsDirect(s)
            return (
              <span key={s.sourceId} title={sourceName(s.sourceId)} style={{ display: "flex", alignItems: "center", justifyContent: "center", minWidth: 22, height: 17, padding: "0 5px", borderRadius: 5, border: `1px solid ${direct ? "color-mix(in srgb, var(--mf-t0) 14%, transparent)" : "color-mix(in srgb, var(--mf-t0) 10%, transparent)"}`, background: direct ? "color-mix(in srgb, var(--mf-t0) 6%, transparent)" : "transparent", fontFamily: MONO, fontSize: 9, fontWeight: 600, letterSpacing: "0.03em", color: direct ? "var(--mf-t2)" : "var(--mf-t4)" }}>{sourceAbbr(s.sourceId)}</span>
            )
          })}
          <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 9.5, color: "var(--mf-t5)" }}>{n + (n > 1 ? " sources" : " source")}</span>
        </div>
      </Link>
    </div>
  )
})
