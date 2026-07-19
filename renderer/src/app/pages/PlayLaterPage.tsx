import { useEffect, useState } from "react"
import { Bookmark, X } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { GameCard } from "@/app/manifold/GameCard"
import { CenterState, MONO } from "@/app/manifold/ui"
import { getPlayLater, onPlayLaterChanged, togglePlayLater, type PlayLaterEntry } from "@/lib/play-later"

export function PlayLaterPage() {
  const navigate = useNavigate()
  const [entries, setEntries] = useState<PlayLaterEntry[]>(getPlayLater)

  useEffect(() => onPlayLaterChanged(() => setEntries(getPlayLater())), [])

  return (
    <div className="mf-scroll" style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto", padding: "44px 36px 40px" }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 26 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 650, color: "var(--mf-t0)", letterSpacing: "-0.02em" }}>Play later</h1>
        <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--mf-t4)" }}>{entries.length} {entries.length === 1 ? "game" : "games"}</span>
      </header>

      {entries.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))", gap: 18, alignContent: "start" }}>
          {entries.map(({ game }) => (
            <div key={game.dedupKey} style={{ position: "relative" }}>
              <GameCard game={game} />
              <button
                type="button"
                title={`Remove ${game.title} from Play later`}
                aria-label={`Remove ${game.title} from Play later`}
                onClick={() => togglePlayLater(game)}
                className="mf-ghost"
                style={{ position: "absolute", top: 10, left: 10, zIndex: 2, display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 7, border: "1px solid color-mix(in srgb, var(--mf-t0) 14%, transparent)", background: "rgba(0,0,0,0.68)", color: "var(--mf-t1)", cursor: "pointer" }}
              >
                <X size={14} strokeWidth={1.8} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <CenterState>
          <Bookmark size={30} strokeWidth={1.4} color="var(--mf-t6)" />
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--mf-t2)" }}>Nothing saved for later</span>
          <span style={{ maxWidth: 320, textAlign: "center", fontFamily: MONO, fontSize: 11, lineHeight: 1.6, color: "var(--mf-t5)" }}>Save uninstalled games from their details page.</span>
          <button type="button" onClick={() => navigate("/")} className="mf-ghost" style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--mf-line-2)", background: "transparent", color: "var(--mf-t2)", fontSize: 12, fontWeight: 500, cursor: "pointer" }}>Browse games</button>
        </CenterState>
      )}
    </div>
  )
}
