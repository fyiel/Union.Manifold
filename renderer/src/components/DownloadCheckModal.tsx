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
import { fmtBytes } from "@/lib/utils"
import { apiFetch } from "@/lib/api"
import {
  CheckCircle2,
  CircleX,
  FileArchive,
  ShieldAlert,
  ArrowRightLeft,
  HardDrive,
} from "lucide-react"
import {
  AlertTriangle,
  ExternalLink,
  Loader2,
} from "@/components/icons"
import { ArchiveInstallModal } from "@/components/ArchiveInstallModal"

type HostOption = {
  key: PreferredDownloadHost
  label: string
  tag?: "beta" | "soon" | "retiring"
  supportsResume?: boolean
}

const HOST_OPTIONS: HostOption[] = [
  { key: "ucfiles", label: "UC.Files", supportsResume: true },
]

function hostLabel(key: string): string {
  return HOST_OPTIONS.find((h) => h.key === key)?.label || key
}

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
  autoConfirmIfGreen?: boolean
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

export function DownloadCheckModal({ open, game, downloadToken, defaultHost, autoConfirmIfGreen, onCheckingChange, onConfirm, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("loading")
  const [selectedHost, setSelectedHost] = useState<PreferredDownloadHost>(defaultHost)
  const [errorMsg, setErrorMsg] = useState("")
  const [availability, setAvailability] = useState<AvailabilityResult | null>(null)
  const [partOverrides, setPartOverrides] = useState<Record<number, { host: string; url: string }>>({})
  const [deadLinksReported, setDeadLinksReported] = useState(false)
  const [showArchiveInstall, setShowArchiveInstall] = useState(false)
  const [storageCheck, setStorageCheck] = useState<StoragePrecheckResult | null>(null)
  const reportSentRef = useRef(false)

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

        const hostEntries = Object.entries(avail.hosts)
        const preferredEntry = hostEntries.find(
          ([h]) => hostMatchesKey(h, selectedHost)
        )
        const preferredUsable = preferredEntry && preferredEntry[1].totalParts > 0

        if (preferredUsable && preferredEntry[1].allAlive) {
          setPhase("ready")
          return
        }

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
      setPhase("ready")
    }
  }, [open, game, downloadToken])

  useEffect(() => {
    onCheckingChange?.(Boolean(open && downloadToken && phase === "loading"))
  }, [open, downloadToken, phase, onCheckingChange])

  useEffect(() => {
    if (!open || !game) {
      setStorageCheck(null)
      return
    }
    let cancelled = false

    ;(async () => {
      const downloadBytes = game.sizeBytes || parseSizeStringToBytes(game.size)
      const declaredInstallBytes = game.installedSizeBytes || 0
      if (downloadBytes > 0 && window.ucStorage?.precheck) {
        try {
          const precheckResult = await window.ucStorage.precheck({ downloadBytes, declaredInstallBytes })
          if (!cancelled) setStorageCheck(precheckResult)
        } catch {
        }
      }
    })()

    return () => { cancelled = true }
  }, [open, game])

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

  const applyAlternative = (partIndex: number, fromHost: string) => {
    if (!availability) return
    const alt = availability.alternatives[String(partIndex)]
    if (!alt || alt.aliveOn.length === 0) return
    const filteredAlive = alt.aliveOn.filter(
      (h) => !h.toLowerCase().includes(fromHost)
    )
    const aliveHost = filteredAlive[0]
    if (!aliveHost) return
    const hostAvail = availability.hosts[aliveHost]
    if (!hostAvail) return
    setPartOverrides((prev) => ({
      ...prev,
      [partIndex]: { host: aliveHost, url: "" },
    }))
  }

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

  const autoConfirmEligible =
    autoConfirmIfGreen
    && phase === "ready"
    && Boolean(currentHostAvail?.allAlive)
    && Object.keys(partOverrides).length === 0
    && (storageCheck === null || storageCheck.ok)
    && !game?.hasHv
    && selectedHost === defaultHost
  const autoConfirmFiredRef = useRef(false)
  const onConfirmRef = useRef(onConfirm)
  const selectedHostRef = useRef(selectedHost)
  const autoConfirmEligibleRef = useRef(autoConfirmEligible)
  onConfirmRef.current = onConfirm
  selectedHostRef.current = selectedHost
  autoConfirmEligibleRef.current = autoConfirmEligible
  useEffect(() => {
    if (!open) {
      autoConfirmFiredRef.current = false
      return
    }
    if (!autoConfirmEligible || autoConfirmFiredRef.current) return
    autoConfirmFiredRef.current = true
    const timer = setTimeout(() => {
      if (!autoConfirmEligibleRef.current) {
        autoConfirmFiredRef.current = false
        return
      }
      onConfirmRef.current({ host: selectedHostRef.current, partOverrides: {} })
    }, 300)
    return () => clearTimeout(timer)
  }, [autoConfirmEligible, open])

  const hasConflict =
    phase === "unavailable" ||
    phase === "error" ||
    (phase === "ready" && !autoConfirmEligible)
  const visible = open && (!autoConfirmIfGreen || hasConflict)

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/72 backdrop-blur-md animate-in fade-in duration-300 ease-out" onClick={onClose} />
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-white/[.07] bg-background/88 backdrop-blur-2xl p-5 text-foreground shadow-[0_24px_80px_rgba(0,0,0,0.55)] animate-in slide-in-from-top-4 duration-300 ease-out">
        {}
        {phase === "loading" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-white" />
            <p className="text-sm text-muted-foreground">Checking link availability…</p>
          </div>
        )}

        {}
        {phase === "error" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              Availability check failed
            </div>
            <p className="text-sm text-muted-foreground">
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

        {}
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
            <p className="text-sm text-muted-foreground">
              {hasWebOnly
                ? <>
                    <span className="font-medium text-foreground">{game?.name}</span> isn&apos;t
                    hosted on any in-app download host, but it&apos;s available on the web.
                  </>
                : <>
                    All download links for <span className="font-medium text-foreground">{game?.name}</span> are
                    currently dead on every host. The game cannot be downloaded right now.
                  </>
              }
            </p>
            {hasDeadInApp && availability.fullyDeadParts.length > 0 && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                Dead links: {availability.fullyDeadParts.map((p) => `Link ${p}`).join(", ")}
              </div>
            )}
            {}
            {(() => {
              const webOnlyHosts = availability?.webOnlyHosts
                ? Object.keys(availability.webOnlyHosts)
                : []
              if (webOnlyHosts.length === 0) return (
                <div className="rounded-lg border border-white/[.07] bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
                  Please try <strong>downloading from the website</strong> where more hosts may be available.
                </div>
              )
              return (
                <div className="rounded-lg border border-border bg-white/5 px-3 py-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <ExternalLink className="h-3.5 w-3.5 text-white" />
                    Available on the web
                  </div>
                  <p className="text-xs text-muted-foreground">
                    This game has links alive on {webOnlyHosts.join(", ")} - these hosts don&apos;t work in the app, but you can download from the website and install here.
                  </p>
                  <ol className="text-xs text-muted-foreground space-y-1 pl-4 list-decimal">
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
              <p className="text-[11px] text-muted-foreground/60 text-center">
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

        {}
        {phase === "ready" && (
          <div className="space-y-4">
            <div className="text-lg font-semibold">Download options</div>
            <p className="text-sm text-muted-foreground">
              Choose a host for this download.
            </p>

            {}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Host</label>
              <Select value={selectedHost} onValueChange={(v) => {
                setSelectedHost(v as PreferredDownloadHost)
                setPartOverrides({})
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
                              <span className="text-muted-foreground">
                                {alive}/{total}
                              </span>
                            </span>
                          )}
                          {hasAvailData && noParts && (
                            <span className="ml-auto text-xs text-muted-foreground">
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

            {}
            {HOST_OPTIONS.find((h) => h.key === selectedHost)?.supportsResume === false && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Download resuming is currently not supported for this host. Please do not close
                the app while downloading with {hostLabel(selectedHost)}.
              </div>
            )}

            {}
            {availability && currentHostAvail && !currentHostAvail.allAlive && (
              <div className="space-y-2">
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  <div className="font-medium mb-1">Some links are dead on {hostLabel(selectedHost)}</div>
                  {currentHostAvail.parts
                    .filter((p) => p.status === "dead")
                    .map((p) => {
                      const alt = availability.alternatives[String(p.part)]
                      const isOverridden = Boolean(partOverrides[p.part])
                      const overriddenHost = partOverrides[p.part]?.host
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
                            Link {p.part}
                            {isOverridden && overriddenHost && (
                              <span className="text-emerald-300">
                                → {hostLabel(overriddenHost)}
                              </span>
                            )}
                          </span>
                          {!isOverridden && filteredAliveOn.length > 0 && (
                            <button
                              onClick={() => applyAlternative(p.part, selectedHost)}
                              className="flex items-center gap-1 rounded-full border border-white/[.07] bg-[#09090b]/70 px-2 py-0.5 text-[10px] font-medium text-foreground transition-colors hover:bg-foreground/5"
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
                {}
                {currentHostAvail.parts.some((p) => {
                  if (p.status !== "dead" || partOverrides[p.part]) return false
                  const alt = availability.alternatives[String(p.part)]
                  const filteredAlive = alt?.aliveOn.filter(
                    (h) => !h.toLowerCase().includes(selectedHost)
                  ) ?? []
                  return filteredAlive.length === 0
                }) && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200 space-y-1.5">
                    <p>Some links are dead on every host. Please try{" "}
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

            {currentHostAvail?.allAlive && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                <CheckCircle2 className="h-3.5 w-3.5" />
                All {currentHostAvail.totalParts} link{currentHostAvail.totalParts === 1 ? "" : "s"} verified alive
              </div>
            )}

            {}
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
                  <div><span className="opacity-70">Download:</span> {storageCheck.humanRequired ? fmtBytes(storageCheck.downloadBytes, "—") : "—"}</div>
                  <div><span className="opacity-70">Extract:</span> {fmtBytes(storageCheck.extractBytes, "—")}</div>
                  <div><span className="opacity-70">Free:</span> {storageCheck.humanAvailable}</div>
                </div>
                {storageCheck.alreadyReservedBytes > 0 && (
                  <div className="text-[10px] opacity-70">
                    {fmtBytes(storageCheck.alreadyReservedBytes, "—")} already reserved by other in-flight downloads.
                  </div>
                )}
              </div>
            )}

            {}
            {deadLinksReported && (
              <p className="text-[11px] text-muted-foreground/60 text-center">
                We detected dead links and have reported it for you.
              </p>
            )}

            {}
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
                  if (!reportSentRef.current && availability) {
                    const deadLines: string[] = []
                    for (const [h, hostData] of Object.entries(availability.hosts)) {
                      const deadParts = hostData.parts.filter((p) => p.status === 'dead')
                      if (deadParts.length === 0) continue
                      if (deadParts.length === hostData.totalParts) {
                        deadLines.push(`${h}: all ${hostData.totalParts} links dead`)
                      } else {
                        deadLines.push(`${h}: link${deadParts.length > 1 ? 's' : ''} ${deadParts.map((p) => p.part).join(', ')} dead`)
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

      {}
      <ArchiveInstallModal
        open={showArchiveInstall}
        game={game}
        onClose={() => setShowArchiveInstall(false)}
      />
    </div>
  )
}

