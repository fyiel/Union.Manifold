import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  CheckCircle2,
  CircleX,
  Cpu,
  HelpCircle,
} from "lucide-react"
import { AlertTriangle } from "@/components/icons"
import { compareToProfile, type RequirementVerdict, type RequirementCheck } from "@/lib/system-requirements"
import type { GameRequirements } from "@/lib/types"

type Platform = "windows" | "linux"

type Props = {
  /** Windows. */
  minRequirements?: GameRequirements | null
  recommendedRequirements?: GameRequirements | null
  /** Linux peers — null for Windows-only titles. */
  linuxMinRequirements?: GameRequirements | null
  linuxRecommendedRequirements?: GameRequirements | null
}

type State =
  | { kind: "loading" }
  | { kind: "no-profile"; defaultPlatform: Platform }
  | { kind: "no-requirements" }
  | { kind: "ready"; spec: any; defaultPlatform: Platform }

function hasMeaningfulText(value: unknown): boolean {
  if (typeof value !== "string") return false
  const text = value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").trim()
  return text.length > 0
}

function hasMeaningfulReq(req: GameRequirements | null | undefined): boolean {
  if (!req) return false
  if (hasMeaningfulText(req.raw)) return true
  if (hasMeaningfulText(req.cpu)) return true
  if (hasMeaningfulText(req.directx)) return true
  if (hasMeaningfulText(req.vulkan)) return true
  if (hasMeaningfulText(req.notes)) return true
  if (typeof req.ramGb === "number" && Number.isFinite(req.ramGb) && req.ramGb > 0) return true
  if (typeof req.storageGb === "number" && Number.isFinite(req.storageGb) && req.storageGb > 0) return true

  const osList = Array.isArray(req.os) ? req.os : req.os ? [req.os] : []
  if (osList.some(entry => hasMeaningfulText(entry))) return true

  const gpuList = Array.isArray(req.gpu) ? req.gpu : req.gpu ? [req.gpu] : []
  if (gpuList.some(entry => hasMeaningfulText(entry))) return true

  return false
}

const COMPONENT_LABEL: Record<RequirementCheck["component"], string> = {
  cpu: "CPU",
  gpu: "GPU",
  ram: "RAM",
  storage: "Storage",
  os: "OS",
  directx: "DirectX",
  vulkan: "Vulkan",
}

function statusIcon(status: RequirementCheck["status"]) {
  if (status === "pass") return <CheckCircle2 className="h-4 w-4 text-emerald-400" />
  if (status === "warn") return <AlertTriangle className="h-4 w-4 text-amber-400" />
  if (status === "fail") return <CircleX className="h-4 w-4 text-rose-400" />
  return <HelpCircle className="h-4 w-4 text-muted-foreground/80" />
}

function detectPlatformFromSpec(spec: any): Platform {
  // Prefer the scanned profile's OS — that's the same machine the user is
  // currently sitting at. Falls back to the renderer-side process.platform
  // if the spec didn't capture it (very old caches).
  const p = String(spec?.os?.platform || "").toLowerCase()
  if (p === "linux") return "linux"
  if (p === "win32" || p === "darwin") return "windows"
  // Last resort: read window.process if available (Electron renderer).
  try {
    const w = window as unknown as { process?: { platform?: string } }
    if (w.process?.platform === "linux") return "linux"
  } catch { /* not Electron */ }
  return "windows"
}

export function SystemRequirementsCheck({
  minRequirements,
  recommendedRequirements,
  linuxMinRequirements,
  linuxRecommendedRequirements,
}: Props) {
  const navigate = useNavigate()
  const [state, setState] = useState<State>({ kind: "loading" })
  /** User's manual override. Null = OS-detected default. */
  const [overridePlatform, setOverridePlatform] = useState<Platform | null>(null)

  const hasWindows = hasMeaningfulReq(minRequirements) || hasMeaningfulReq(recommendedRequirements)
  const hasLinux = hasMeaningfulReq(linuxMinRequirements) || hasMeaningfulReq(linuxRecommendedRequirements)

  useEffect(() => {
    let cancelled = false
    if (!hasWindows && !hasLinux) {
      setState({ kind: "no-requirements" })
      return
    }

    void (async () => {
      try {
        const res = await window.ucSystemProfile?.getCached?.()
        if (cancelled) return
        const profile = res?.ok ? res.profile : null
        if (!profile?.spec) {
          setState({ kind: "no-profile", defaultPlatform: detectPlatformFromSpec(null) })
          return
        }
        setState({ kind: "ready", spec: profile.spec, defaultPlatform: detectPlatformFromSpec(profile.spec) })
      } catch {
        if (!cancelled) setState({ kind: "no-profile", defaultPlatform: detectPlatformFromSpec(null) })
      }
    })()

    return () => { cancelled = true }
  }, [hasWindows, hasLinux])

  /** Resolved platform: explicit override, else OS-detected default, with
   *  a cross-platform fallback if the preferred one publishes nothing. */
  const selectedPlatform: Platform = useMemo(() => {
    const def = state.kind === "ready" || state.kind === "no-profile" ? state.defaultPlatform : "windows"
    const requested = overridePlatform ?? def
    if (requested === "linux" && !hasLinux && hasWindows) return "windows"
    if (requested === "windows" && !hasWindows && hasLinux) return "linux"
    return requested
  }, [state, overridePlatform, hasWindows, hasLinux])

  const verdictData = useMemo<{ verdict: RequirementVerdict; tier: "minimum" | "recommended" } | null>(() => {
    if (state.kind !== "ready") return null
    const windowsRecommended = hasMeaningfulReq(recommendedRequirements) ? recommendedRequirements : null
    const windowsMinimum = hasMeaningfulReq(minRequirements) ? minRequirements : null
    const linuxRecommended = hasMeaningfulReq(linuxRecommendedRequirements) ? linuxRecommendedRequirements : null
    const linuxMinimum = hasMeaningfulReq(linuxMinRequirements) ? linuxMinRequirements : null
    const target = selectedPlatform === "linux"
      ? (linuxRecommended || linuxMinimum)
      : (windowsRecommended || windowsMinimum)
    if (!target) return null
    const tier: "minimum" | "recommended" =
      (selectedPlatform === "linux" ? linuxRecommended : windowsRecommended) ? "recommended" : "minimum"
    return { verdict: compareToProfile(state.spec, target), tier }
  }, [state, selectedPlatform, minRequirements, recommendedRequirements, linuxMinRequirements, linuxRecommendedRequirements])

  if (state.kind === "loading" || state.kind === "no-requirements") return null

  // Pill is rendered whenever the game publishes both platforms. When only
  // one is available, we still display a static label so the user knows
  // which OS the comparison is against — important on Linux where reqs
  // sometimes differ markedly from Windows.
  const platformLabel = (
    <>
      {(hasWindows && hasLinux) ? (
        <div className="inline-flex items-center gap-0.5 rounded-full border border-white/[.07] bg-card/60 p-0.5 text-[10px]">
          <button
            type="button"
            onClick={() => setOverridePlatform("windows")}
            className={`px-2 py-0.5 rounded-full transition ${selectedPlatform === "windows" ? "bg-zinc-700 text-white" : "text-muted-foreground hover:text-foreground/90"}`}
            title="Compare against Windows requirements"
          >Windows</button>
          <button
            type="button"
            onClick={() => setOverridePlatform("linux")}
            className={`px-2 py-0.5 rounded-full transition ${selectedPlatform === "linux" ? "bg-zinc-700 text-white" : "text-muted-foreground hover:text-foreground/90"}`}
            title="Compare against Linux requirements"
          >Linux</button>
        </div>
      ) : (
        <span className="rounded-full border border-white/10 bg-white/[.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {selectedPlatform === "linux" ? "Linux" : "Windows"}
        </span>
      )}
    </>
  )

  if (state.kind === "no-profile") {
    return (
      <div className="p-6 rounded-3xl bg-card/60 border border-white/[.07] backdrop-blur-md shadow-xl">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-2xl bg-white/[.05] border border-white/[.07] flex items-center justify-center shrink-0">
            <Cpu className="h-5 w-5 text-foreground/80" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-white">Can my PC run this?</h3>
              {platformLabel}
            </div>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Scan your hardware once and we'll compare your PC against every game's requirements automatically.
            </p>
            <button
              type="button"
              onClick={() => navigate("/settings?section=system&autoScan=1")}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-xs font-semibold hover:brightness-110 transition-colors"
            >
              <Cpu className="h-3.5 w-3.5" /> Scan my PC
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!verdictData) return null
  const { verdict, tier } = verdictData
  const verdictTone =
    verdict.status === "pass" ? "emerald" :
    verdict.status === "warn" ? "amber" :
    verdict.status === "fail" ? "rose" : "zinc"
  const verdictLabel =
    verdict.status === "pass" ? `Your PC meets the ${tier} requirements` :
    verdict.status === "warn" ? `Your PC is close to the ${tier} requirements` :
    verdict.status === "fail" ? `Your PC may not meet the ${tier} requirements` :
    "We couldn't fully compare your PC against the requirements"

  return (
    <div className="p-6 rounded-3xl bg-card/60 border border-white/[.07] backdrop-blur-md shadow-xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-bold text-white uppercase tracking-widest">Will it run on my PC?</h3>
        <div className="flex items-center gap-2">
          {platformLabel}
          <span className={
            "rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider " +
            (verdictTone === "emerald" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" :
             verdictTone === "amber"   ? "border-amber-500/40 bg-amber-500/10 text-amber-300" :
             verdictTone === "rose"    ? "border-rose-500/40 bg-rose-500/10 text-rose-300" :
                                         "border-white/10 bg-white/[.04] text-foreground/80")
          }>
            {tier}
          </span>
        </div>
      </div>
      <p className={
        "text-sm font-medium " +
        (verdictTone === "emerald" ? "text-emerald-300" :
         verdictTone === "amber"   ? "text-amber-300" :
         verdictTone === "rose"    ? "text-rose-300" :
                                     "text-foreground/80")
      }>
        {verdictLabel}
      </p>
      {verdict.checks.length > 0 && (
        <ul className="grid sm:grid-cols-2 gap-2">
          {verdict.checks.map((check) => (
            <li
              key={check.component}
              className="flex items-start gap-2.5 rounded-2xl bg-secondary/40 border border-white/[.06] px-3 py-2"
            >
              <span className="shrink-0 mt-0.5">{statusIcon(check.status)}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">
                  {COMPONENT_LABEL[check.component]}
                </p>
                <p className="text-xs text-foreground/80 truncate" title={check.have || ""}>
                  {check.have || "—"}
                </p>
                {check.required && (
                  <p className="text-[10px] text-muted-foreground/80 truncate" title={check.required}>
                    needs {check.required}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
