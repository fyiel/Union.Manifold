import { useEffect, useRef, useState } from "react"
import { Check, Trophy } from "lucide-react"
import { MONO, SmartImage } from "@/app/manifold/ui"
import { proxyImageUrl } from "@/lib/utils"

export default function AchievementToastWindow() {
  const [payload, setPayload] = useState<LocalAchievementUnlock | null>(null)
  const [shown, setShown] = useState(false)
  const timers = useRef<number[]>([])

  useEffect(() => {
    const htmlBackground = document.documentElement.style.background
    const bodyBackground = document.body.style.background
    document.documentElement.style.background = "transparent"
    document.body.style.background = "transparent"
    document.body.style.overflow = "hidden"

    const off = window.ucAchievements?.onToast?.((next) => {
      timers.current.forEach(window.clearTimeout)
      timers.current = []
      setPayload(next)
      setShown(false)
      requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)))
      timers.current.push(window.setTimeout(() => setShown(false), 4_450))
      timers.current.push(window.setTimeout(() => void window.ucAchievements?.hideToast?.(), 5_000))
    })

    return () => {
      off?.()
      timers.current.forEach(window.clearTimeout)
      document.documentElement.style.background = htmlBackground
      document.body.style.background = bodyBackground
    }
  }, [])

  if (!payload) return <div style={{ width: "100vw", height: "100vh", background: "transparent" }} />

  const achievement = payload.achievement
  const icon = achievement.icon || achievement.iconLocked || ""

  return (
    <main
      onClick={() => {
        setShown(false)
        window.setTimeout(() => void window.ucAchievements?.hideToast?.(), 220)
      }}
      style={{ width: "100vw", height: "100vh", padding: 6, background: "transparent", cursor: "pointer", overflow: "hidden" }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 13,
          width: "100%",
          height: "100%",
          padding: "11px 14px 11px 11px",
          overflow: "hidden",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.13)",
          background: "linear-gradient(135deg, rgba(29,32,35,0.98), rgba(14,16,18,0.98))",
          boxShadow: "0 16px 42px rgba(0,0,0,0.62), inset 0 1px 0 rgba(255,255,255,0.04)",
          opacity: shown ? 1 : 0,
          transform: shown ? "translateY(0) scale(1)" : "translateY(10px) scale(0.985)",
          transition: "opacity 220ms ease, transform 260ms cubic-bezier(.2,.8,.2,1)",
        }}
      >
        <div style={{ position: "relative", width: 72, height: 72, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", borderRadius: 6, border: "1px solid rgba(255,255,255,0.14)", background: "repeating-linear-gradient(135deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 10px), #111416" }}>
          {icon
            ? <SmartImage candidates={[proxyImageUrl(icon)]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            : <Trophy size={27} strokeWidth={1.35} color="rgba(255,255,255,0.5)" />}
          <span style={{ position: "absolute", right: 4, bottom: 4, display: "flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: 99, background: "#66c0f4", color: "#101416", boxShadow: "0 2px 8px rgba(0,0,0,0.45)" }}>
            <Check size={11} strokeWidth={2.8} />
          </span>
        </div>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
            <span style={{ width: 5, height: 5, borderRadius: 99, background: "#66c0f4", boxShadow: "0 0 10px rgba(102,192,244,0.8)" }} />
            <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 650, letterSpacing: "0.14em", color: "#8bcff5" }}>ACHIEVEMENT UNLOCKED</span>
          </div>
          <div style={{ fontSize: 15, lineHeight: 1.15, fontWeight: 650, letterSpacing: "-0.015em", color: "rgba(255,255,255,0.94)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{achievement.displayName}</div>
          {achievement.description && <div style={{ marginTop: 4, fontFamily: MONO, fontSize: 9.5, lineHeight: 1.35, color: "rgba(255,255,255,0.52)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{achievement.description}</div>}
          <div style={{ marginTop: 7, fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.04em", color: "rgba(255,255,255,0.34)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{payload.gameTitle}</div>
        </div>

        <span style={{ position: "absolute", left: 0, bottom: 0, height: 2, width: shown ? "100%" : "0%", background: "linear-gradient(90deg, #66c0f4, rgba(102,192,244,0.15))", transition: shown ? "width 4.45s linear" : "none" }} />
      </div>
    </main>
  )
}
