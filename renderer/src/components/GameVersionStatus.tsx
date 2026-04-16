import { useState, useEffect } from "react"
import { RefreshCw, ExternalLink, LogIn } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { apiFetch } from "@/lib/api"

interface SteamData {
  buildId: string | null
  updateDate: string | null
  requirements: Record<string, unknown> | null
}

interface GameVersionStatusProps {
  appid: string
  gameName: string
  localVersionString?: string
  isAuthed: boolean
  onSteamDataLoaded?: (data: SteamData) => void
}

export function GameVersionStatus({ appid, gameName, localVersionString, isAuthed, onSteamDataLoaded }: GameVersionStatusProps) {
  const [steamData, setSteamData] = useState<SteamData | null>(null)
  const [resolvedSteamAppId, setResolvedSteamAppId] = useState<string | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const [hadExplicitCheck, setHadExplicitCheck] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    let mounted = true
    apiFetch(`/api/steam-details/${appid}`)
      .then(res => res.json())
      .then(json => {
        if (!mounted) return
        if (json.success) {
          const hasBuildData = json.data?.buildId != null
          if (hasBuildData || json.data?.requirements != null) {
            setSteamData(json.data)
            setResolvedSteamAppId(json.resolvedSteamAppId ?? null)
            if (onSteamDataLoaded) onSteamDataLoaded(json.data)
          }
        }
      })
      .catch(() => {})
      .finally(() => { if (mounted) setInitialLoading(false) })
    return () => { mounted = false }
  }, [appid])

  const handleCheck = async () => {
    if (!isAuthed) {
      navigate("/login")
      return
    }
    setChecking(true)
    try {
      const res = await apiFetch(`/api/steam-details/${appid}`, { method: "POST" })
      if (res.status === 401) { navigate("/login"); return }
      const json = await res.json()
      if (json.success) {
        setSteamData(json.data)
        setResolvedSteamAppId(json.resolvedSteamAppId ?? null)
        setLastChecked(new Date())
        if (onSteamDataLoaded) onSteamDataLoaded(json.data)
      }
    } catch { /* silent */ } finally {
      setHadExplicitCheck(true)
      setChecking(false)
    }
  }

  // Parse local version/build
  let localVersion: string | null = null
  let localBuild: string | null = null
  if (localVersionString) {
    const v = localVersionString.trim()
    const buildMatch = v.match(/^[bB](\d+)/)
    if (buildMatch) localBuild = buildMatch[1]
    else if (/^\d+/.test(v)) localBuild = v.match(/^\d+/)![0]
    else localVersion = v
  }

  const latestBuild = steamData?.buildId
  const updateDate = steamData?.updateDate
    ? new Date(steamData.updateDate).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
    : null

  const hasChecked = hadExplicitCheck || steamData?.buildId != null

  let statusText = ""
  let statusColorClass = "text-zinc-500"

  if (hasChecked) {
    if (!resolvedSteamAppId && !latestBuild) {
      statusText = "Could not find game on Steam"
      statusColorClass = "text-zinc-600"
    } else if (localBuild && latestBuild) {
      const upToDate = localBuild === latestBuild
      statusText = upToDate ? "Game version is up to date" : "A newer build is available on Steam"
      statusColorClass = upToDate ? "text-emerald-400" : "text-amber-400"
    } else if (localVersion && latestBuild) {
      statusText = "No BuildID stored. Version comparing disabled."
      statusColorClass = "text-sky-400"
    } else {
      statusText = "Steam build ID not available"
      statusColorClass = "text-zinc-500"
    }
  }

  const requestUpdateHref = `/request?${new URLSearchParams({ type: "update", game: gameName }).toString()}`

  return (
    <div className="rounded-2xl bg-zinc-900/60 border border-white/[.07] backdrop-blur-md shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[.07]">
        <h3 className="text-xs font-bold text-white uppercase tracking-widest">Version Status</h3>
        <button
          onClick={() => void handleCheck()}
          disabled={initialLoading || checking}
          title={isAuthed ? (hasChecked ? "Refresh Steam data" : "Check Steam data") : "Log in to check"}
          className="w-8 h-8 rounded-full flex items-center justify-center bg-zinc-800/50 border border-white/[.07] text-zinc-400 hover:text-white hover:bg-zinc-700 transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {checking
            ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            : isAuthed
              ? <RefreshCw className="w-3.5 h-3.5" />
              : <LogIn className="w-3.5 h-3.5" />
          }
        </button>
      </div>

      {/* Body */}
      <div className="p-5 space-y-4">

        {/* Data rows — blurred when unchecked */}
        <div className={`space-y-3 text-sm transition-all duration-300 ${!hasChecked && !initialLoading ? "blur-sm select-none pointer-events-none opacity-50" : ""}`}>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Current Version</span>
            <span className="font-semibold text-zinc-200">{localVersion ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Current Build</span>
            <span className="font-semibold text-zinc-400">
              {localBuild ?? <span className="text-zinc-600 italic text-xs">Not stored</span>}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Latest Build</span>
            <span className="font-semibold text-emerald-400">
              {initialLoading
                ? <span className="inline-block h-3.5 w-16 rounded bg-zinc-700 animate-pulse" />
                : (hasChecked ? (latestBuild ?? "—") : "—")}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Last Steam Update</span>
            <span className="text-zinc-400">
              {initialLoading
                ? <span className="inline-block h-3.5 w-24 rounded bg-zinc-700 animate-pulse" />
                : (hasChecked ? (updateDate ?? "—") : "—")}
            </span>
          </div>
        </div>

        {/* Unchecked prompt */}
        {!initialLoading && !hasChecked && (
          <button
            onClick={() => void handleCheck()}
            disabled={checking}
            className="w-full py-2 rounded-xl bg-zinc-800/60 border border-white/[.07] text-zinc-300 text-xs font-medium hover:bg-zinc-700 hover:text-white transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isAuthed
              ? <><RefreshCw className={`w-3.5 h-3.5 ${checking ? "animate-spin" : ""}`} /> {checking ? "Checking..." : "Check version status"}</>
              : <><LogIn className="w-3.5 h-3.5" /> Log in to check version status</>
            }
          </button>
        )}

        {/* Status line — only after checked */}
        {hasChecked && (
          <div className="pt-3 border-t border-white/[.07] space-y-1">
            <p className={`text-sm font-medium ${statusColorClass}`}>{statusText}</p>
            {lastChecked && (
              <p className="text-xs text-zinc-600">
                Last checked: {lastChecked.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <a
            href={requestUpdateHref}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-full border border-white/[.07] bg-zinc-800/50 text-zinc-200 text-sm font-semibold hover:bg-zinc-700 hover:border-zinc-600 transition-all active:scale-95"
          >
            Request Update
          </a>
          {resolvedSteamAppId && (
            <a
              href={`https://steamdb.info/app/${resolvedSteamAppId}/patchnotes/`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-full border border-white/[.07] text-zinc-400 text-sm font-medium hover:text-white hover:border-zinc-600 transition-all active:scale-95"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              View on SteamDB
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
