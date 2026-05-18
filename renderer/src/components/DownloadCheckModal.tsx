import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  checkAvailability,
  type AvailabilityResult,
  type DownloadConfig,
  type PreferredDownloadHost,
} from "@/lib/downloads"
import type { Game } from "@/lib/types"
import { apiFetch } from "@/lib/api"
import {
  AlertTriangle,
  CheckCircle2,
  CircleX,
  ExternalLink,
  FileArchive,
  Loader2,
  ShieldAlert,
  ArrowRightLeft,
  HardDrive,
  Cpu,
} from "lucide-react"
import { ArchiveInstallModal } from "@/components/ArchiveInstallModal"
import { compareToProfile, evaluateGpuDriver, type RequirementVerdict, type RequirementCheck, type DriverStatus } from "@/lib/system-requirements"

type HostOption = {
  key: PreferredDownloadHost
  label: string
  tag?: "beta" | "soon" | "retiring"
  supportsResume?: boolean
}

const HOST_OPTIONS: HostOption[] = [
  { key: "ucfiles", label: "UC.Files", supportsResume: true },
  { key: "pixeldrain", label: "Pixeldrain", supportsResume: true },
]

function hostLabel(key: string): string {
  return HOST_OPTIONS.find((h) => h.key === key)?.label || key
}

/** Compare a host key from the API (e.g. "UC.Files") against a local key (e.g. "ucfiles") */
function hostMatchesKey(apiHost: string, key: string): boolean {
  const a = apiHost.toLowerCase().replace(/[^a-z0-9]/g, "")
  const b = key.toLowerCase().replace(/[^a-z0-9]/g, "")
  return a.includes(b) || b.includes(a)
}

type Props = {
  open: boolean
  game: Game | null
  downloadToken: string | null
  defaultHost: PreferredDownloadHost
  onCheckingChange?: (checking: boolean) => void
  onConfirm: (config: DownloadConfig) => void
  onClose: () => void
}

type Phase = "loading" | "ready" | "unavailable" | "error"

function parseSizeStringToBytes(value: string | null | undefined): number {
  if (!value) return 0
  const m = String(value).trim().match(/([0-9]+(?:\.[0-9]+)?)\s*([kmgtp]?i?b)?/i)
  if (!m) return 0
  const n = Number(m[1])
  const unit = (m[2] || "b").toLowerCase()
  const mult: Record<string, number> = { b: 1, kb: 1024, kib: 1024, mb: 1024 ** 2, mib: 1024 ** 2, gb: 1024 ** 3, gib: 1024 ** 3, tb: 1024 ** 4, tib: 1024 ** 4 }
  return Math.round(n * (mult[unit] || 1))
}

export function DownloadCheckModal({ open, game, downloadToken, defaultHost, onCheckingChange, onConfirm, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("loading")
  const [selectedHost, setSelectedHost] = useState<PreferredDownloadHost>(defaultHost)
  const [errorMsg, setErrorMsg] = useState("")
  const [availability, setAvailability] = useState<AvailabilityResult | null>(null)
  const [partOverrides, setPartOverrides] = useState<Record<number, { host: string; url: string }>>({})
  const [deadLinksReported, setDeadLinksReported] = useState(false)
  const [showArchiveInstall, setShowArchiveInstall] = useState(false)
  const [storageCheck, setStorageCheck] = useState<StoragePrecheckResult | null>(null)
  const [storageHint, setStorageHint] = useState<{ targetMedia: string | null; hasFastAlternative: boolean; isLargeInstall: boolean } | null>(null)
  const [sysreqVerdict, setSysreqVerdict] = useState<RequirementVerdict | null>(null)
  const [sysreqProfileMissing, setSysreqProfileMissing] = useState(false)
  const [driverStatus, setDriverStatus] = useState<DriverStatus | null>(null)
  const reportSentRef = useRef(false)

  // Reset state when modal opens
  useEffect(() => {
    if (!open) return
    setPhase("loading")
    setSelectedHost(defaultHost)
    setErrorMsg("")
    setAvailability(null)
    setPartOverrides({})
    setDeadLinksReported(false)
    setShowArchiveInstall(false)
    reportSentRef.current = false
  }, [open, defaultHost])

  // Run availability check
  const runCheck = useCallback(
    async () => {
      if (!game || !downloadToken) return
      setPhase("loading")
      setPartOverrides({})

      try {
        const avail = await checkAvailability(game.appid, downloadToken)

        setAvailability(avail)

        if (!avail.gameAvailable) {
          setPhase("unavailable")
          return
        }

        // Auto-select the best host based on availability
        const hostEntries = Object.entries(avail.hosts)
        const preferredEntry = hostEntries.find(
          ([h]) => hostMatchesKey(h, selectedHost)
        )
        const preferredUsable = preferredEntry && preferredEntry[1].totalParts > 0

        if (preferredUsable && preferredEntry[1].allAlive) {
          // Preferred host is fully alive - great
          setPhase("ready")
          return
        }

        // Preferred host missing, has no parts, or all parts dead - switch to best alternative
        if (!preferredUsable || preferredEntry[1].aliveParts === 0) {
          const fullyAlive = hostEntries.find(([, h]) => h.allAlive && h.totalParts > 0)
          const partiallyAlive = !fullyAlive
            ? hostEntries.find(([, h]) => h.aliveParts > 0)
            : null
          const best = fullyAlive ?? partiallyAlive
          if (best) {
            const matchedOption = HOST_OPTIONS.find((o) =>
              hostMatchesKey(best[0], o.key)
            )
            if (matchedOption) setSelectedHost(matchedOption.key)
          }
        }

        setPhase("ready")
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Availability check failed")
        setPhase("error")
      }
    },
    [game, downloadToken, selectedHost]
  )

  useEffect(() => {
    if (open && game && downloadToken) {
      void runCheck()
    } else if (open && game && !downloadToken) {
      // Skip link check mode - show host picker immediately
      setPhase("ready")
    }
  }, [open, game, downloadToken]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onCheckingChange?.(Boolean(open && downloadToken && phase === "loading"))
  }, [open, downloadToken, phase, onCheckingChange])

  // Storage precheck + sysreq comparison. Runs whenever the modal opens
  // with a game so the user sees the verdict before clicking download.
  //
  // Storage reservation always runs (it's a functional safety net, not a
  // privacy feature). The sysreq comparison, driver warning, and storage-
  // type hint all *read the user's profile* and are gated on the
  // `systemProfileVisibility.sysreqCheck` setting so users who don't want
  // their PC inspected here can disable it from Settings → System Profile.
  useEffect(() => {
    if (!open || !game) {
      setStorageCheck(null)
      setSysreqVerdict(null)
      setSysreqProfileMissing(false)
      setStorageHint(null)
      setDriverStatus(null)
      return
    }
    let cancelled = false

    ;(async () => {
      const downloadBytes = game.sizeBytes || parseSizeStringToBytes(game.size)
      const declaredInstallBytes = game.installedSizeBytes || 0
      let precheckResult: StoragePrecheckResult | null = null
      if (downloadBytes > 0 && window.ucStorage?.precheck) {
        try {
          precheckResult = await window.ucStorage.precheck({ downloadBytes, declaredInstallBytes })
          if (!cancelled) setStorageCheck(precheckResult)
        } catch {
          /* ignore — pre-download check is best-effort */
        }
      }

      // Read the privacy setting once for all profile-derived panels below.
      let sysreqCheckEnabled = true
      try {
        const setting = await window.ucSettings?.get?.("systemProfileVisibility")
        if (setting && typeof setting === "object" && setting.sysreqCheck === "off") {
          sysreqCheckEnabled = false
        }
      } catch { /* default to enabled */ }

      if (!sysreqCheckEnabled) return

      // Storage-type hint: warn if the user is installing to a slow drive
      // when a faster one is available. Best-effort; depends on the scanner
      // having tagged volumes with mediaType (Windows: always; Linux: not yet).
      if (window.ucSystemProfile?.getCached && precheckResult?.mountRoot) {
        try {
          const profileRes = await window.ucSystemProfile.getCached()
          if (!cancelled && profileRes.ok && profileRes.profile) {
            const volumes = profileRes.profile.spec.storage?.volumes || []
            const targetRoot = precheckResult.mountRoot.replace(/\\$/, "").toUpperCase()
            const targetVol = volumes.find(
              (v) => v.mount && v.mount.toUpperCase().replace(/\\$/, "") === targetRoot
            )
            const targetMedia = targetVol?.mediaType ?? null
            const hasFastAlternative = volumes.some(
              (v) => v.mediaType === "ssd" || v.mediaType === "nvme"
            ) && targetMedia === "hdd"
            // Threshold: 30+ GB installed is when HDD load times start hurting.
            const isLargeInstall = (precheckResult.extractBytes || 0) > 30 * 1024 ** 3
            setStorageHint({ targetMedia, hasFastAlternative, isLargeInstall })
          }
        } catch {
          /* ignore */
        }
      }

      const hasReqs = game.minRequirements || game.recommendedRequirements
      if (window.ucSystemProfile?.getCached) {
        try {
          const res = await window.ucSystemProfile.getCached()
          if (cancelled) return
          if (!res.ok || !res.profile) {
            if (hasReqs) setSysreqProfileMissing(true)
            return
          }
          if (hasReqs) {
            const target = game.recommendedRequirements || game.minRequirements || null
            setSysreqVerdict(compareToProfile(res.profile.spec, target))
          }
          // Driver status is independent of game sysreq — we can warn even
          // for games whose specs aren't published yet.
          setDriverStatus(evaluateGpuDriver(res.profile.spec))
        } catch {
          /* ignore */
        }
      }
    })()

    return () => { cancelled = true }
  }, [open, game])

  // Auto-report dead links when game is fully unavailable
  useEffect(() => {
    if (phase !== "unavailable" || !availability || !game || reportSentRef.current) return
    const deadLines: string[] = []
    for (const [h, hostData] of Object.entries(availability.hosts)) {
      const deadParts = hostData.parts.filter((p) => p.status === 'dead')
      if (deadParts.length === 0) continue
      deadLines.push(`${h}: all ${hostData.totalParts} parts dead`)
    }
    if (deadLines.length > 0) {
      reportSentRef.current = true
      setDeadLinksReported(true)
      apiFetch('/api/reports/dead-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appid: game.appid,
          gameName: game.name,
          deadLinks: `Dead links found:\n${deadLines.join('\n')}`,
        }),
      }).catch(() => {})
    }
  }, [phase, availability, game])

  // Apply a cross-host alternative for a dead part
  const applyAlternative = (partIndex: number, fromHost: string) => {
    if (!availability) return
    const alt = availability.alternatives[String(partIndex)]
    if (!alt || alt.aliveOn.length === 0) return
    // Pick an alive host that is NOT the selected host
    const filteredAlive = alt.aliveOn.filter(
      (h) => !h.toLowerCase().includes(fromHost)
    )
    const aliveHost = filteredAlive[0]
    if (!aliveHost) return
    const hostAvail = availability.hosts[aliveHost]
    if (!hostAvail) return
    // Record the host/part mapping for startGameDownload to resolve.
    setPartOverrides((prev) => ({
      ...prev,
      [partIndex]: { host: aliveHost, url: "" }, // url filled by download engine
    }))
  }

  // Determine health for current selected host
  const currentHostAvail = availability
    ? Object.entries(availability.hosts).find(([h]) =>
        hostMatchesKey(h, selectedHost)
      )?.[1] ?? null
    : null

  const hasDeadParts = currentHostAvail
    ? currentHostAvail.parts.some(
        (p) => p.status === "dead" && !partOverrides[p.part]
      )
    : false

  const allPartsHandled = currentHostAvail
    ? currentHostAvail.parts.every(
        (p) => p.status === "alive" || partOverrides[p.part]
      )
    : false

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-[#09090b]/40 backdrop-blur-sm animate-in fade-in duration-300 ease-out" onClick={onClose} />
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-white/[.07] bg-zinc-900/95 p-5 text-zinc-100 shadow-2xl animate-in slide-in-from-top-4 duration-300 ease-out">
        {/* ── Loading Phase ── */}
        {phase === "loading" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-white" />
            <p className="text-sm text-zinc-400">Checking link availability…</p>
          </div>
        )}

        {/* ── Error Phase ── */}
        {phase === "error" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              Availability check failed
            </div>
            <p className="text-sm text-zinc-400">
              {errorMsg || "Could not verify link availability. You can still try downloading."}
            </p>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="outline" onClick={() => setShowArchiveInstall(true)}>
                <FileArchive className="mr-1.5 h-4 w-4" />
                Install from archive
              </Button>
              <Button
                onClick={() =>
                  onConfirm({
                    host: selectedHost,
                    partOverrides: {},
                  })
                }
              >
                Download anyway
              </Button>
            </div>
          </div>
        )}

        {/* ── Unavailable Phase ── */}
        {phase === "unavailable" && (() => {
          const webOnlyHostKeys = availability?.webOnlyHosts ? Object.keys(availability.webOnlyHosts) : []
          const hasWebOnly = webOnlyHostKeys.length > 0
          const hasDeadInApp = availability && Object.keys(availability.hosts).length > 0

          return (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <CircleX className="h-5 w-5 text-destructive" />
              {hasWebOnly ? "Not available in-app" : "Game not available"}
            </div>
            <p className="text-sm text-zinc-400">
              {hasWebOnly
                ? <>
                    <span className="font-medium text-zinc-100">{game?.name}</span> isn&apos;t
                    hosted on any in-app download host, but it&apos;s available on the web.
                  </>
                : <>
                    All download links for <span className="font-medium text-zinc-100">{game?.name}</span> are
                    currently dead on every host. The game cannot be downloaded right now.
                  </>
              }
            </p>
            {hasDeadInApp && availability.fullyDeadParts.length > 0 && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                Dead parts: {availability.fullyDeadParts.map((p) => `Part ${p}`).join(", ")}
              </div>
            )}
            {/* Web-only hosts guidance */}
            {(() => {
              const webOnlyHosts = availability?.webOnlyHosts
                ? Object.keys(availability.webOnlyHosts)
                : []
              if (webOnlyHosts.length === 0) return (
                <div className="rounded-lg border border-white/[.07] bg-zinc-800/30 px-3 py-2 text-xs text-zinc-400">
                  Please try <strong>downloading from the website</strong> where more hosts may be available.
                </div>
              )
              return (
                <div className="rounded-lg border border-zinc-700 bg-white/5 px-3 py-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-zinc-100">
                    <ExternalLink className="h-3.5 w-3.5 text-white" />
                    Available on the web
                  </div>
                  <p className="text-xs text-zinc-400">
                    This game has links alive on {webOnlyHosts.join(", ")} - these hosts don&apos;t work in the app, but you can download from the website and install here.
                  </p>
                  <ol className="text-xs text-zinc-400 space-y-1 pl-4 list-decimal">
                    <li>
                      <a
                        href={`https://union-crax.xyz/game/${game?.appid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-white underline hover:text-white/80"
                      >
                        Go to the game page on the website
                      </a>
                    </li>
                    <li>Download the archive using {webOnlyHosts[0]}</li>
                    <li>Come back and use <strong>Install from archive</strong> below</li>
                  </ol>
                </div>
              )
            })()}
            {deadLinksReported && (
              <p className="text-[11px] text-zinc-400/60 text-center">
                We detected dead links and have reported it for you.
              </p>
            )}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
              <Button variant="outline" onClick={() => setShowArchiveInstall(true)}>
                <FileArchive className="mr-1.5 h-4 w-4" />
                Install from archive
              </Button>
            </div>
          </div>
          )
        })()}

        {/* ── Ready Phase ── */}
        {phase === "ready" && (
          <div className="space-y-4">
            <div className="text-lg font-semibold">Download options</div>
            <p className="text-sm text-zinc-400">
              Choose a host for this download.
            </p>

            {/* Host selector + health */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-100">Host</label>
              <Select value={selectedHost} onValueChange={(v) => {
                setSelectedHost(v as PreferredDownloadHost)
                setPartOverrides({}) // reset overrides when host changes
              }}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOST_OPTIONS.map((h) => {
                    const hostAvail = availability
                      ? Object.entries(availability.hosts).find(([k]) =>
                          k.toLowerCase().includes(h.key)
                        )?.[1]
                      : undefined
                    const alive = hostAvail?.aliveParts ?? 0
                    const total = hostAvail?.totalParts ?? 0
                    const allGood = hostAvail?.allAlive
                    const noParts = !hostAvail || total === 0
                    const hasAvailData = Boolean(availability)

                    return (
                      <SelectItem key={h.key} value={h.key} disabled={hasAvailData && noParts}>
                        <div className="flex items-center gap-2 w-full">
                          <span>{h.label}</span>
                          {h.tag && (
                            <span
                              className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                                h.tag === "beta"
                                  ? "bg-amber-100 text-amber-800"
                                  : h.tag === "retiring"
                                    ? "bg-red-100 text-red-800"
                                    : "bg-slate-100 text-slate-800"
                              }`}
                            >
                              {h.tag}
                            </span>
                          )}
                          {hasAvailData && !noParts && (
                            <span className="ml-auto flex items-center gap-1 text-xs">
                              {allGood ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                              ) : alive === 0 ? (
                                <CircleX className="h-3.5 w-3.5 text-red-400" />
                              ) : (
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                              )}
                              <span className="text-zinc-400">
                                {alive}/{total}
                              </span>
                            </span>
                          )}
                          {hasAvailData && noParts && (
                            <span className="ml-auto text-xs text-zinc-400">
                              unavailable
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>

            {/* Host resume warning */}
            {HOST_OPTIONS.find((h) => h.key === selectedHost)?.supportsResume === false && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Download resuming is currently not supported for this host. Please do not close
                the app while downloading with {hostLabel(selectedHost)}.
              </div>
            )}

            {/* Dead parts + alternatives */}
            {availability && currentHostAvail && !currentHostAvail.allAlive && (
              <div className="space-y-2">
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  <div className="font-medium mb-1">Some parts are dead on {hostLabel(selectedHost)}</div>
                  {currentHostAvail.parts
                    .filter((p) => p.status === "dead")
                    .map((p) => {
                      const alt = availability.alternatives[String(p.part)]
                      const isOverridden = Boolean(partOverrides[p.part])
                      const overriddenHost = partOverrides[p.part]?.host
                      // Filter aliveOn to exclude the currently selected host
                      const filteredAliveOn = alt?.aliveOn.filter(
                        (h) => !h.toLowerCase().includes(selectedHost)
                      ) ?? []
                      const isFullyDead = filteredAliveOn.length === 0 && !isOverridden

                      return (
                        <div
                          key={p.part}
                          className="flex items-center justify-between gap-2 py-1 border-t border-amber-500/20 first:border-0"
                        >
                          <span className="flex items-center gap-1.5">
                            {isOverridden ? (
                              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                            ) : (
                              <CircleX className="h-3 w-3 text-red-400" />
                            )}
                            Part {p.part}
                            {isOverridden && overriddenHost && (
                              <span className="text-emerald-300">
                                → {hostLabel(overriddenHost)}
                              </span>
                            )}
                          </span>
                          {!isOverridden && filteredAliveOn.length > 0 && (
                            <button
                              onClick={() => applyAlternative(p.part, selectedHost)}
                              className="flex items-center gap-1 rounded-full border border-white/[.07] bg-[#09090b]/70 px-2 py-0.5 text-[10px] font-medium text-zinc-100 transition-colors hover:bg-foreground/5"
                            >
                              <ArrowRightLeft className="h-2.5 w-2.5" />
                              Use {hostLabel(filteredAliveOn[0])}
                            </button>
                          )}
                          {isFullyDead && (
                            <span className="text-[10px] text-red-300">dead on all hosts</span>
                          )}
                        </div>
                      )
                    })}
                </div>
                {/* Show report / web download tip when any part is dead on all hosts */}
                {currentHostAvail.parts.some((p) => {
                  if (p.status !== "dead" || partOverrides[p.part]) return false
                  const alt = availability.alternatives[String(p.part)]
                  const filteredAlive = alt?.aliveOn.filter(
                    (h) => !h.toLowerCase().includes(selectedHost)
                  ) ?? []
                  return filteredAlive.length === 0
                }) && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200 space-y-1.5">
                    <p>Some parts are dead on every host. Please try{" "}
                    <strong>downloading from the website</strong> where more hosts may be available.</p>
                    <button
                      onClick={() => setShowArchiveInstall(true)}
                      className="flex items-center gap-1 text-[10px] font-medium text-red-100 underline hover:text-red-50"
                    >
                      <FileArchive className="h-3 w-3" />
                      Or: install from archive
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* All-clear message */}
            {currentHostAvail?.allAlive && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                <CheckCircle2 className="h-3.5 w-3.5" />
                All {currentHostAvail.totalParts} part{currentHostAvail.totalParts === 1 ? "" : "s"} verified alive
              </div>
            )}

            {/* Storage reservation summary */}
            {storageCheck && (
              <div className={`rounded-lg border px-3 py-2 text-xs space-y-1.5 ${
                storageCheck.ok
                  ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-200"
                  : "border-red-500/30 bg-red-500/10 text-red-200"
              }`}>
                <div className="flex items-center gap-1.5 font-medium">
                  <HardDrive className="h-3.5 w-3.5" />
                  {storageCheck.ok
                    ? "Storage reserved"
                    : `Not enough free space — short ${storageCheck.humanShortfall}`}
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <div><span className="opacity-70">Download:</span> {storageCheck.humanRequired ? formatBytes(storageCheck.downloadBytes) : "—"}</div>
                  <div><span className="opacity-70">Extract:</span> {formatBytes(storageCheck.extractBytes)}</div>
                  <div><span className="opacity-70">Free:</span> {storageCheck.humanAvailable}</div>
                </div>
                {storageCheck.alreadyReservedBytes > 0 && (
                  <div className="text-[10px] opacity-70">
                    {formatBytes(storageCheck.alreadyReservedBytes)} already reserved by other in-flight downloads.
                  </div>
                )}
              </div>
            )}

            {/* Storage-type hint: HDD install with SSDs available, large install. */}
            {storageHint && storageHint.hasFastAlternative && storageHint.isLargeInstall && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 space-y-1">
                <div className="flex items-center gap-1.5 font-medium">
                  <HardDrive className="h-3.5 w-3.5" />
                  Slow install drive detected
                </div>
                <p className="text-[11px] opacity-80">
                  Your download drive is an HDD. Large games load noticeably faster from an SSD or NVMe — open Settings to switch the download path if you'd prefer.
                </p>
              </div>
            )}

            {/* System requirement comparison */}
            {sysreqProfileMissing && (game?.minRequirements || game?.recommendedRequirements) && (
              <div className="rounded-lg border border-white/[.07] bg-zinc-800/30 px-3 py-2 text-xs text-zinc-300">
                <div className="flex items-center gap-1.5 font-medium">
                  <Cpu className="h-3.5 w-3.5" />
                  Scan your PC to see if it meets the requirements
                </div>
                <div className="text-[11px] text-zinc-400 mt-1">
                  Settings → System Profile → Scan now.
                </div>
              </div>
            )}
            {sysreqVerdict && sysreqVerdict.checks.length > 0 && (
              <SysreqPanel verdict={sysreqVerdict} />
            )}

            {driverStatus?.status === "stale" && driverStatus.ageDays != null && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 space-y-1">
                <div className="flex items-center gap-1.5 font-medium">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  GPU driver is {Math.floor(driverStatus.ageDays / 30)} month{Math.floor(driverStatus.ageDays / 30) === 1 ? "" : "s"} old
                </div>
                <p className="text-[11px] opacity-80">
                  Older drivers can cause crashes or poor performance in new games. Consider updating before installing.
                </p>
                {driverStatus.driverPageUrl && (
                  <a
                    href={driverStatus.driverPageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      e.preventDefault()
                      window.ucSystem?.openExternal?.(driverStatus.driverPageUrl!)
                    }}
                    className="inline-flex items-center gap-1 text-[11px] underline hover:no-underline"
                  >
                    <ExternalLink className="h-2.5 w-2.5" />
                    {driverStatus.vendor ? `${driverStatus.vendor.toUpperCase()} drivers` : "Vendor drivers"}
                  </a>
                )}
              </div>
            )}

            {/* Dead links reported notice */}
            {deadLinksReported && (
              <p className="text-[11px] text-zinc-400/60 text-center">
                We detected dead links and have reported it for you.
              </p>
            )}

            {/* Actions */}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="outline" onClick={() => setShowArchiveInstall(true)}>
                <FileArchive className="mr-1.5 h-4 w-4" />
                Install from archive
              </Button>
              <Button
                disabled={
                  (hasDeadParts && !allPartsHandled) ||
                  !currentHostAvail ||
                  currentHostAvail.totalParts === 0 ||
                  (storageCheck != null && !storageCheck.ok)
                }
                onClick={() => {
                  // Auto-report dead links on download confirm
                  if (!reportSentRef.current && availability) {
                    const deadLines: string[] = []
                    for (const [h, hostData] of Object.entries(availability.hosts)) {
                      const deadParts = hostData.parts.filter((p) => p.status === 'dead')
                      if (deadParts.length === 0) continue
                      if (deadParts.length === hostData.totalParts) {
                        deadLines.push(`${h}: all ${hostData.totalParts} parts dead`)
                      } else {
                        deadLines.push(`${h}: part${deadParts.length > 1 ? 's' : ''} ${deadParts.map((p) => p.part).join(', ')} dead`)
                      }
                    }
                    if (deadLines.length > 0) {
                      reportSentRef.current = true
                      setDeadLinksReported(true)
                      apiFetch('/api/reports/dead-links', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          appid: game?.appid,
                          gameName: game?.name,
                          deadLinks: `Dead links found:\n${deadLines.join('\n')}`,
                        }),
                      }).catch(() => {})
                    }
                  }

                  onConfirm({
                    host: selectedHost,
                    partOverrides: Object.keys(partOverrides).length > 0 ? partOverrides : undefined,
                  })                }}
              >
                  {!currentHostAvail || currentHostAvail.totalParts === 0
                  ? "Host unavailable"
                  : hasDeadParts && !allPartsHandled
                    ? "Resolve dead parts first"
                    : storageCheck != null && !storageCheck.ok
                      ? "Free up space first"
                      : `Download with ${hostLabel(selectedHost)}`}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Archive Install overlay */}
      <ArchiveInstallModal
        open={showArchiveInstall}
        game={game}
        onClose={() => setShowArchiveInstall(false)}
      />
    </div>
  )
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || !Number.isFinite(bytes)) return "—"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = value >= 10 || unit === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unit]}`
}

function SysreqPanel({ verdict }: { verdict: RequirementVerdict }) {
  const containerColor =
    verdict.status === "pass" ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-200" :
    verdict.status === "warn" ? "border-amber-500/30 bg-amber-500/10 text-amber-200" :
    verdict.status === "fail" ? "border-red-500/30 bg-red-500/10 text-red-200" :
    "border-white/[.07] bg-zinc-800/30 text-zinc-300"

  const summary =
    verdict.status === "pass" ? "Your PC meets all checked requirements." :
    verdict.status === "warn" ? `${verdict.warnCount} requirement${verdict.warnCount === 1 ? " is" : "s are"} close to the minimum.` :
    verdict.status === "fail" ? `${verdict.failCount} requirement${verdict.failCount === 1 ? "" : "s"} not met.` :
    "Compared against your scanned hardware."

  return (
    <div className={`rounded-lg border px-3 py-2 text-xs space-y-1.5 ${containerColor}`}>
      <div className="flex items-center gap-1.5 font-medium">
        <Cpu className="h-3.5 w-3.5" />
        {summary}
      </div>
      <div className="space-y-0.5">
        {verdict.checks.map((c) => <SysreqRow key={c.component} check={c} />)}
      </div>
    </div>
  )
}

function SysreqRow({ check }: { check: RequirementCheck }) {
  const icon = check.status === "pass" ? <CheckCircle2 className="h-3 w-3 text-emerald-400" />
    : check.status === "warn" ? <AlertTriangle className="h-3 w-3 text-amber-400" />
    : check.status === "fail" ? <CircleX className="h-3 w-3 text-red-400" />
    : <span className="h-3 w-3 rounded-full bg-zinc-500/40 inline-block" />
  return (
    <div className="flex items-start gap-2 text-[11px] py-0.5">
      <span className="pt-0.5 shrink-0">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="uppercase text-[10px] opacity-70 mr-1">{check.component}</span>
        <span className="opacity-90">{check.have || "Unknown"}</span>
        <span className="opacity-50"> · needs </span>
        <span className="opacity-90">{check.required || "?"}</span>
      </span>
    </div>
  )
}

