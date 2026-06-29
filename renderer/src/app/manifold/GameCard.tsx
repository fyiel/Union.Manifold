import { useState } from "react"
import { Link } from "react-router-dom"
import { ArrowDownToLine } from "lucide-react"
import { sourceAbbr, sourceName, sourceIsDirect } from "@/lib/sources"
import { MONO, COVER_LINES, gbLabel, SmartImage, useGameImages } from "@/app/manifold/ui"

// The catalog card, a 3:4 cover (real art or striped placeholder), title,
// genre + year, install size, and a badge per contributing source (direct
// sources brighter). Used on Browse + Advanced Search.
export function GameCard({ game }: { game: UnifiedSourceGame }) {
  const candidates = useGameImages(game)
  const [imgOk, setImgOk] = useState(true)
  const hasImg = imgOk && candidates.length > 0
  const meta = [game.genres?.[0], game.releaseYear || undefined].filter(Boolean).join(" · ")
  const size = game.sizeText || gbLabel(game.sizeBytes)
  const resolvable = game.sources.some(sourceIsDirect)
  const n = game.sources.length

  return (
    <Link
      to={`/g/${encodeURIComponent(game.dedupKey)}`}
      state={{ game }}
      className="mf-card"
      style={{ display: "flex", flexDirection: "column", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, overflow: "hidden", background: "var(--mf-panel)", textDecoration: "none", cursor: "pointer" }}
    >
      <div style={{ position: "relative", aspectRatio: "3 / 4", background: hasImg ? "#0f0f0f" : COVER_LINES, display: "flex", alignItems: "flex-end", padding: 12 }}>
        {hasImg && (
          <SmartImage candidates={candidates} steamAppId={game.steamAppId} alt={game.title} lazy onAllFailed={() => setImgOk(false)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        )}
        {resolvable && (
          <span title="direct download available" style={{ position: "absolute", top: 10, right: 10, display: "flex", alignItems: "center", justifyContent: "center", width: 25, height: 25, borderRadius: 7, background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.14)", color: "var(--mf-t1)" }}>
            <ArrowDownToLine size={12} strokeWidth={1.6} />
          </span>
        )}
        {!hasImg && (
          <span style={{ fontFamily: MONO, fontSize: 11, lineHeight: 1.35, letterSpacing: "0.05em", textTransform: "uppercase", color: "#bdbdbd" }}>{game.title}</span>
        )}
      </div>
      <div style={{ padding: "11px 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--mf-t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{game.title}</span>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: MONO, fontSize: 10, color: "#6f6f6f", letterSpacing: "0.02em" }}>{meta || " "}</span>
          <span style={{ fontFamily: MONO, fontSize: 10, color: "var(--mf-t4)" }}>{size}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {game.sources.map((s) => {
            const direct = sourceIsDirect(s)
            return (
              <span key={s.sourceId} title={sourceName(s.sourceId)} style={{ display: "flex", alignItems: "center", justifyContent: "center", minWidth: 22, height: 17, padding: "0 5px", borderRadius: 5, border: `1px solid ${direct ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.10)"}`, background: direct ? "rgba(255,255,255,0.06)" : "transparent", fontFamily: MONO, fontSize: 9, fontWeight: 600, letterSpacing: "0.03em", color: direct ? "var(--mf-t2)" : "var(--mf-t4)" }}>{sourceAbbr(s.sourceId)}</span>
            )
          })}
          <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 9.5, color: "var(--mf-t5)" }}>{n + (n > 1 ? " sources" : " source")}</span>
        </div>
      </div>
    </Link>
  )
}
