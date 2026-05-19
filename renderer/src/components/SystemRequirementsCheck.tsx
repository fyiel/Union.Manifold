import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { AlertTriangle, CheckCircle2, CircleX, Cpu, HelpCircle } from "lucide-react"
import { compareToProfile, type RequirementVerdict, type RequirementCheck } from "@/lib/system-requirements"
import type { GameRequirements } from "@/lib/types"

type Props = {
  minRequirements?: GameRequirements | null
  recommendedRequirements?: GameRequirements | null
}

type State =
  | { kind: "loading" }
  | { kind: "no-profile" }
  | { kind: "no-requirements" }
  | { kind: "ready"; verdict: RequirementVerdict; tier: "minimum" | "recommended" }

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
  return <HelpCircle className="h-4 w-4 text-zinc-500" />
}

export function SystemRequirementsCheck({ minRequirements, recommendedRequirements }: Props) {
  const navigate = useNavigate()
  const [state, setState] = useState<State>({ kind: "loading" })

  useEffect(() => {
    let cancelled = false
    const target = recommendedRequirements || minRequirements
    const tier: "minimum" | "recommended" = recommendedRequirements ? "recommended" : "minimum"
    if (!target) {
      setState({ kind: "no-requirements" })
      return
    }

    void (async () => {
      try {
        const res = await window.ucSystemProfile?.getCached?.()
        if (cancelled) return
        const profile = res?.ok ? res.profile : null
        if (!profile?.spec) {
          setState({ kind: "no-profile" })
          return
        }
        const verdict = compareToProfile(profile.spec, target)
        setState({ kind: "ready", verdict, tier })
      } catch {
        if (!cancelled) setState({ kind: "no-profile" })
      }
    })()

    return () => { cancelled = true }
  }, [minRequirements, recommendedRequirements])

  if (state.kind === "loading" || state.kind === "no-requirements") return null

  if (state.kind === "no-profile") {
    return (
      <div className="p-6 rounded-3xl bg-zinc-900/60 border border-white/[.07] backdrop-blur-md shadow-xl">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-2xl bg-white/[.05] border border-white/[.07] flex items-center justify-center shrink-0">
            <Cpu className="h-5 w-5 text-zinc-300" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-white">Can my PC run this?</h3>
            <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
              Scan your hardware once and we'll compare your PC against every game's requirements automatically.
            </p>
            <button
              type="button"
              onClick={() => navigate("/settings?section=system&autoScan=1")}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white text-black px-3 py-1.5 text-xs font-semibold hover:bg-zinc-200 transition-colors"
            >
              <Cpu className="h-3.5 w-3.5" /> Scan my PC
            </button>
          </div>
        </div>
      </div>
    )
  }

  const { verdict, tier } = state
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
    <div className="p-6 rounded-3xl bg-zinc-900/60 border border-white/[.07] backdrop-blur-md shadow-xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-bold text-white uppercase tracking-widest">Will it run on my PC?</h3>
        <span className={
          "rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider " +
          (verdictTone === "emerald" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" :
           verdictTone === "amber"   ? "border-amber-500/40 bg-amber-500/10 text-amber-300" :
           verdictTone === "rose"    ? "border-rose-500/40 bg-rose-500/10 text-rose-300" :
                                       "border-white/10 bg-white/[.04] text-zinc-300")
        }>
          {tier}
        </span>
      </div>
      <p className={
        "text-sm font-medium " +
        (verdictTone === "emerald" ? "text-emerald-300" :
         verdictTone === "amber"   ? "text-amber-300" :
         verdictTone === "rose"    ? "text-rose-300" :
                                     "text-zinc-300")
      }>
        {verdictLabel}
      </p>
      {verdict.checks.length > 0 && (
        <ul className="grid sm:grid-cols-2 gap-2">
          {verdict.checks.map((check) => (
            <li
              key={check.component}
              className="flex items-start gap-2.5 rounded-2xl bg-zinc-800/40 border border-white/[.06] px-3 py-2"
            >
              <span className="shrink-0 mt-0.5">{statusIcon(check.status)}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  {COMPONENT_LABEL[check.component]}
                </p>
                <p className="text-xs text-zinc-300 truncate" title={check.have || ""}>
                  {check.have || "—"}
                </p>
                {check.required && (
                  <p className="text-[10px] text-zinc-500 truncate" title={check.required}>
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
