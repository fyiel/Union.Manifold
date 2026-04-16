import { useState, useEffect } from "react"
import { apiFetch } from "@/lib/api"

interface SystemRequirementsProps {
  appid: string
}

function stripLabel(html: string, label: string): string {
  return html.replace(new RegExp(`<strong>${label}:<\\/strong><br\\s*\\/?>`, "i"), "")
}

export function SystemRequirements({ appid }: SystemRequirementsProps) {
  const [reqs, setReqs] = useState<{ minimum?: string; recommended?: string } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    apiFetch(`/api/steam-details/${appid}`)
      .then(r => r.json())
      .then(json => {
        if (!mounted) return
        const r = json?.data?.requirements
        if (r && (r.minimum || r.recommended)) setReqs(r)
      })
      .catch(() => {})
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [appid])

  if (loading) {
    return (
      <div className="p-8 rounded-3xl bg-zinc-900/60 border border-white/[.07] backdrop-blur-md shadow-xl space-y-4">
        <div className="h-3 w-36 rounded bg-zinc-800 animate-pulse" />
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-2xl bg-zinc-800/50 border border-white/[.07] p-5 space-y-2">
            <div className="h-2.5 w-16 rounded bg-zinc-700 animate-pulse mb-3" />
            <div className="h-2.5 w-full rounded bg-zinc-700 animate-pulse" />
            <div className="h-2.5 w-5/6 rounded bg-zinc-700 animate-pulse" />
            <div className="h-2.5 w-4/6 rounded bg-zinc-700 animate-pulse" />
            <div className="h-2.5 w-full rounded bg-zinc-700 animate-pulse" />
            <div className="h-2.5 w-3/4 rounded bg-zinc-700 animate-pulse" />
          </div>
          <div className="rounded-2xl bg-zinc-800/50 border border-white/[.07] p-5 space-y-2">
            <div className="h-2.5 w-20 rounded bg-zinc-700 animate-pulse mb-3" />
            <div className="h-2.5 w-full rounded bg-zinc-700 animate-pulse" />
            <div className="h-2.5 w-5/6 rounded bg-zinc-700 animate-pulse" />
            <div className="h-2.5 w-4/6 rounded bg-zinc-700 animate-pulse" />
            <div className="h-2.5 w-full rounded bg-zinc-700 animate-pulse" />
            <div className="h-2.5 w-3/4 rounded bg-zinc-700 animate-pulse" />
          </div>
        </div>
      </div>
    )
  }

  if (!reqs) return null

  return (
    <div className="p-8 rounded-3xl bg-zinc-900/60 border border-white/[.07] backdrop-blur-md shadow-xl space-y-4">
      <h3 className="text-xs font-bold text-white uppercase tracking-widest">System Requirements</h3>
      <div className="grid md:grid-cols-2 gap-4">
        {reqs.minimum && (
          <div className="rounded-2xl bg-zinc-800/50 border border-white/[.07] p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-3">Minimum</p>
            <div
              className="text-xs text-zinc-400 leading-relaxed [&_strong]:text-zinc-200 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:mt-1 [&_li]:mt-1"
              dangerouslySetInnerHTML={{ __html: stripLabel(reqs.minimum, "Minimum") }}
            />
          </div>
        )}
        {reqs.recommended && (
          <div className="rounded-2xl bg-zinc-800/50 border border-white/[.07] p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-3">Recommended</p>
            <div
              className="text-xs text-zinc-400 leading-relaxed [&_strong]:text-zinc-200 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:mt-1 [&_li]:mt-1"
              dangerouslySetInnerHTML={{ __html: stripLabel(reqs.recommended, "Recommended") }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
