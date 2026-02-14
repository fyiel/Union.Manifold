import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  checkAvailability,
  fetchGameVersions,
  type AvailabilityResult,
  type DownloadConfig,
  type GameVersion,
  type PreferredDownloadHost,
} from "@/lib/downloads"
import type { Game } from "@/lib/types"
import { apiFetch } from "@/lib/api"
import {
  AlertTriangle,
  CheckCircle2,
  CircleX,
  Loader2,
  ShieldAlert,
  ArrowRightLeft,
} from "lucide-react"

type HostOption = {
  key: PreferredDownloadHost
  label: string
  tag?: "beta" | "soon" | "retiring"
}

const HOST_OPTIONS: HostOption[] = [
  { key: "pixeldrain", label: "Pixeldrain" },
  { key: "fileq", label: "FileQ", tag: "soon" },
  { key: "datavaults", label: "DataVaults", tag: "soon" },
  { key: "rootz", label: "Rootz", tag: "retiring" },
]

function hostLabel(key: string): string {
  return HOST_OPTIONS.find((h) => h.key === key)?.label || key
}

type Props = {
  open: boolean
  game: Game | null
  downloadToken: string | null
  defaultHost: PreferredDownloadHost
  defaultVersionId?: string
  onCheckingChange?: (checking: boolean) => void
  onConfirm: (config: DownloadConfig) => void
  onClose: () => void
}

type Phase = "loading" | "ready" | "unavailable" | "error"

export function DownloadCheckModal({ open, game, downloadToken, defaultHost, defaultVersionId, onCheckingChange, onConfirm, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("loading")
  const [selectedHost, setSelectedHost] = useState<PreferredDownloadHost>(defaultHost)
  const [errorMsg, setErrorMsg] = useState("")
  const [versions, setVersions] = useState<GameVersion[]>([])
  const [selectedVersion, setSelectedVersion] = useState<string | undefined>(undefined)
  const [availability, setAvailability] = useState<AvailabilityResult | null>(null)
  const [partOverrides, setPartOverrides] = useState<Record<number, { host: string; url: string }>>({})
  const [deadLinksReported, setDeadLinksReported] = useState(false)
  const reportSentRef = useRef(false)

  // Reset state when modal opens
  useEffect(() => {
    if (!open) return
    setPhase("loading")
    setSelectedHost(defaultHost)
    setErrorMsg("")
    setVersions([])
    setSelectedVersion(defaultVersionId || undefined)
    setAvailability(null)
    setPartOverrides({})
    setDeadLinksReported(false)
    reportSentRef.current = false
  }, [open, defaultHost])

  // Fetch versions + run availability check
  const runCheck = useCallback(
    async (versionId?: string) => {
      if (!game || !downloadToken) return
      setPhase("loading")
      setPartOverrides({})

      try {
        // Fetch versions in parallel with first availability check
        const [versionList, avail] = await Promise.all([
          versions.length > 0 ? Promise.resolve(versions) : fetchGameVersions(game.appid, downloadToken),
          checkAvailability(game.appid, downloadToken, versionId),
        ])

        if (versionList.length > 0 && versions.length === 0) {
          setVersions(versionList)
          if (!versionId && !selectedVersion) {
            const current = versionList.find((v) => v.is_current)
            if (current) setSelectedVersion(current.id)
          }
        }

        setAvailability(avail)

        if (!avail.gameAvailable) {
          setPhase("unavailable")
          return
        }

        // Auto-select the best host based on availability
        const hostEntries = Object.entries(avail.hosts)
        const preferredEntry = hostEntries.find(
          ([h]) => h.toLowerCase().includes(selectedHost)
        )

        if (preferredEntry && preferredEntry[1].allAlive) {
          // Preferred host is fully alive — great
          setPhase("ready")
          return
        }

        // If preferred host has dead parts, check if all parts are dead
        if (preferredEntry && preferredEntry[1].aliveParts === 0) {
          // All dead on preferred host — switch to first fully alive host
          const fullyAlive = hostEntries.find(([, h]) => h.allAlive)
          if (fullyAlive) {
            const matchedOption = HOST_OPTIONS.find((o) =>
              fullyAlive[0].toLowerCase().includes(o.key)
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
    [game, downloadToken, versions, selectedHost]
  )

  useEffect(() => {
    if (open && game && downloadToken) {
      void runCheck(defaultVersionId || selectedVersion)
    } else if (open && game && !downloadToken) {
      // Skip link check mode — show host picker immediately
      setPhase("ready")
    }
  }, [open, game, downloadToken]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onCheckingChange?.(Boolean(open && downloadToken && phase === "loading"))
  }, [open, downloadToken, phase, onCheckingChange])

  // Auto-report dead links when game is fully unavailable
  useEffect(() => {
    if (phase !== "unavailable" || !availability || !game || reportSentRef.current) return
    const deadLines: string[] = []
    for (const [h, hostData] of Object.entries(availability.hosts)) {
      if (h.toLowerCase().includes('rootz')) continue
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
          fingerprint: crypto.randomUUID?.() ?? undefined,
        }),
      }).catch(() => {})
    }
  }, [phase, availability, game])

  const handleVersionChange = (versionId: string) => {
    setSelectedVersion(versionId)
    void runCheck(versionId)
  }

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
        h.toLowerCase().includes(selectedHost)
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
      <div className="absolute inset-0 bg-background/40 backdrop-blur-sm animate-in fade-in duration-300 ease-out" onClick={onClose} />
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-border/60 bg-card/95 p-5 text-foreground shadow-2xl animate-in slide-in-from-top-4 duration-300 ease-out">
        {/* ── Loading Phase ── */}
        {phase === "loading" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Checking link availability…</p>
          </div>
        )}

        {/* ── Error Phase ── */}
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
              <Button
                onClick={() =>
                  onConfirm({
                    host: selectedHost,
                    versionId: selectedVersion,
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
        {phase === "unavailable" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <CircleX className="h-5 w-5 text-destructive" />
              Game not available
            </div>
            <p className="text-sm text-muted-foreground">
              All download links for <span className="font-medium text-foreground">{game?.name}</span> are
              currently dead on every host. The game cannot be downloaded right now.
            </p>
            {availability && availability.fullyDeadParts.length > 0 && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                Dead parts: {availability.fullyDeadParts.map((p) => `Part ${p}`).join(", ")}
              </div>
            )}
            <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Please try <strong>downloading from the website</strong> where more hosts may be available.
            </div>
            {deadLinksReported && (
              <p className="text-[11px] text-muted-foreground/60 text-center">
                We detected dead links and have reported it for you.
              </p>
            )}
            <div className="flex justify-end">
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        )}

        {/* ── Ready Phase ── */}
        {phase === "ready" && (
          <div className="space-y-4">
            <div className="text-lg font-semibold">Download options</div>
            <p className="text-sm text-muted-foreground">
              Choose a host {versions.length > 0 ? "and version " : ""}for this download.
            </p>

            {/* Version selector (only when multiple versions) */}
            {versions.length > 1 && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Version</label>
                <Select value={selectedVersion || ""} onValueChange={handleVersionChange}>
                  <SelectTrigger className="h-10 w-full">
                    <SelectValue placeholder="Select version" />
                  </SelectTrigger>
                  <SelectContent>
                    {versions.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        <div className="flex items-center gap-2">
                          <span>{v.label}</span>
                          {v.is_current && (
                            <span className="ml-1 inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/20 text-primary">
                              current
                            </span>
                          )}
                          {v.date && (
                            <span className="ml-auto text-[10px] text-muted-foreground">
                              {new Date(v.date).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Version metadata strip (shown even for single version) */}
            {(() => {
              const sel = versions.length > 0
                ? versions.find((v) => v.id === selectedVersion) || versions[0]
                : null
              const meta = sel?.metadata
              if (!meta || (!meta.size && !meta.source && !meta.comment)) return null
              return (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border/40 bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground">
                  {meta.size && <span><strong className="text-foreground/70">Size:</strong> {meta.size}</span>}
                  {meta.source && <span><strong className="text-foreground/70">Source:</strong> {meta.source}</span>}
                  {meta.comment && <span className="text-amber-300/80"><strong className="text-amber-400/80">Note:</strong> {meta.comment}</span>}
                </div>
              )
            })()}

            {/* Host selector + health */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Host</label>
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

            {/* Rootz Beta Warning */}
            {selectedHost === "rootz" && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Download resuming is currently not supported for this host. Please do not close
                the app while downloading with Rootz.
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
                              className="flex items-center gap-1 rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[10px] font-medium text-foreground transition-colors hover:bg-foreground/5"
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
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                    Some parts are dead on every host. Please try{" "}
                    <strong>downloading from the website</strong> where more hosts may be available.
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

            {/* Dead links reported notice */}
            {deadLinksReported && (
              <p className="text-[11px] text-muted-foreground/60 text-center">
                We detected dead links and have reported it for you.
              </p>
            )}

            {/* Actions */}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                disabled={hasDeadParts && !allPartsHandled}
                onClick={() => {
                  // Auto-report dead links (excluding rootz) on download confirm
                  if (!reportSentRef.current && availability && selectedHost !== 'rootz') {
                    const deadLines: string[] = []
                    for (const [h, hostData] of Object.entries(availability.hosts)) {
                      if (h.toLowerCase().includes('rootz')) continue
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
                          fingerprint: crypto.randomUUID?.() ?? undefined,
                        }),
                      }).catch(() => {})
                    }
                  }

                  const selectedVersionObj = versions.find((v) => v.id === selectedVersion)
                  onConfirm({
                    host: selectedHost,
                    versionId: selectedVersion,
                    versionLabel: selectedVersionObj?.label,
                    partOverrides: Object.keys(partOverrides).length > 0 ? partOverrides : undefined,
                  })
                }}
              >
                {hasDeadParts && !allPartsHandled
                  ? "Resolve dead parts first"
                  : `Download with ${hostLabel(selectedHost)}`}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
