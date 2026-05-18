import { useCallback, useEffect, useRef, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Cpu, Loader2, RefreshCw, Monitor, HardDrive, Zap, MemoryStick, Trash2, ShieldCheck, CloudUpload, CloudOff, CheckCircle2, Laptop, Link2, X, Check, Pencil, TrendingUp } from "lucide-react"
import { Input } from "@/components/ui/input"
import { getApiBaseUrl } from "@/lib/api"

const DEFAULT_VISIBILITY: SystemProfileVisibility = {
  comments: "off",
  forums: "off",
  profilePublic: "off",
  sysreqCheck: "on",
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

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never"
  const ts = new Date(iso).getTime()
  if (!Number.isFinite(ts)) return "never"
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return "just now"
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hr ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`
  return new Date(iso).toLocaleDateString()
}

type VisibilityRowProps = {
  label: string
  description: string
  value: SystemProfileVisibilityTier
  onChange: (next: SystemProfileVisibilityTier) => void
  allowFull?: boolean
}

function VisibilityRow({ label, description, value, onChange, allowFull = true }: VisibilityRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-zinc-400 mt-0.5">{description}</div>
      </div>
      <Select value={value} onValueChange={(v) => onChange(v as SystemProfileVisibilityTier)}>
        <SelectTrigger className="w-32 h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="off">Off</SelectItem>
          <SelectItem value="summary">Summary</SelectItem>
          {allowFull && <SelectItem value="full">Full spec</SelectItem>}
        </SelectContent>
      </Select>
    </div>
  )
}

type SyncState = "idle" | "uploading" | "synced" | "error" | "offline"

type Props = {
  /** When true (e.g. deep-linked via `unioncrax://scan`), trigger a fresh scan
   *  as soon as the panel mounts. */
  autoScanOnMount?: boolean
  /** Called once after the auto-scan has been kicked off, so the parent can
   *  clear the triggering query param. */
  onAutoScanConsumed?: () => void
}

export function SystemProfilePanel({ autoScanOnMount = false, onAutoScanConsumed }: Props = {}) {
  const [profile, setProfile] = useState<SystemProfile | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [visibility, setVisibility] = useState<SystemProfileVisibility>(DEFAULT_VISIBILITY)
  const [sysreqCheck, setSysreqCheck] = useState<"on" | "off">("on")
  const [syncState, setSyncState] = useState<SyncState>("idle")
  const [syncError, setSyncError] = useState<string | null>(null)
  const baseUrlRef = useRef<string | undefined>(undefined)

  const loadCached = useCallback(async () => {
    if (!window.ucSystemProfile?.getCached) return
    try {
      const res = await window.ucSystemProfile.getCached()
      if (res.ok) setProfile(res.profile)
    } catch (err: any) {
      setError(err?.message || String(err))
    }
  }, [])

  const loadSettings = useCallback(async () => {
    try {
      const stored = await window.ucSettings?.get?.("systemProfileVisibility")
      if (stored && typeof stored === "object") {
        setVisibility({ ...DEFAULT_VISIBILITY, ...stored })
        if (stored.sysreqCheck) setSysreqCheck(stored.sysreqCheck)
      }
    } catch { }
  }, [])

  useEffect(() => {
    try { baseUrlRef.current = getApiBaseUrl() } catch { /* not configured yet */ }
    loadCached()
    loadSettings()
  }, [loadCached, loadSettings])

  // If we were opened via `unioncrax://scan`, fire a fresh scan immediately
  // and let the parent clear the URL flag so a page refresh doesn't repeat.
  const autoScanFiredRef = useRef(false)
  useEffect(() => {
    if (!autoScanOnMount || autoScanFiredRef.current) return
    if (!window.ucSystemProfile?.scan) return
    autoScanFiredRef.current = true
    void (async () => {
      try {
        setScanning(true)
        const res = await window.ucSystemProfile!.scan({ force: true })
        if (res.ok && res.profile) setProfile(res.profile)
      } catch (err: any) {
        setError(err?.message || String(err))
      } finally {
        setScanning(false)
        onAutoScanConsumed?.()
      }
    })()
  }, [autoScanOnMount, onAutoScanConsumed])

  // Compute whether any online surface is enabled — the gate for uploading.
  const anyOnlineSurfaceOn = useCallback((v: SystemProfileVisibility) => (
    v.comments !== "off" || v.forums !== "off" || v.profilePublic !== "off"
  ), [])

  const uploadIfOptedIn = useCallback(async (v: SystemProfileVisibility) => {
    if (!anyOnlineSurfaceOn(v)) {
      setSyncState("idle")
      return
    }
    if (!window.ucSystemProfile?.upload) {
      setSyncState("offline")
      return
    }
    setSyncState("uploading")
    setSyncError(null)
    try {
      const res = await window.ucSystemProfile.upload(baseUrlRef.current)
      if (!res.ok) {
        setSyncState("error")
        setSyncError(res.error || `Upload failed (HTTP ${res.status || "?"})`)
        return
      }
      setSyncState("synced")
    } catch (err: any) {
      setSyncState("error")
      setSyncError(err?.message || String(err))
    }
  }, [anyOnlineSurfaceOn])

  const runScan = useCallback(async (force: boolean) => {
    if (!window.ucSystemProfile?.scan) return
    setScanning(true)
    setError(null)
    try {
      const res = await window.ucSystemProfile.scan({ force })
      if (!res.ok) {
        setError(res.error || "Scan failed.")
        return
      }
      if (res.profile) {
        setProfile(res.profile)
        // Auto-upload if user has opted into any online surface. Otherwise
        // the spec stays purely local until they flip a switch.
        void uploadIfOptedIn(visibility)
      }
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setScanning(false)
    }
  }, [uploadIfOptedIn, visibility])

  const updateVisibility = useCallback(async (patch: Partial<SystemProfileVisibility>) => {
    const next = { ...visibility, ...patch }
    setVisibility(next)
    if (patch.sysreqCheck) setSysreqCheck(patch.sysreqCheck === "off" ? "off" : "on")
    try { await window.ucSettings?.set?.("systemProfileVisibility", next) } catch { }

    // Mirror to server: if any online surface is on, push tiers + spec.
    // If everything is now off, delete the server-side copy.
    if (anyOnlineSurfaceOn(next)) {
      if (window.ucSystemProfile?.serverSetVisibility) {
        try {
          await window.ucSystemProfile.serverSetVisibility(baseUrlRef.current, {
            comments: next.comments === "summary" ? "summary" : "off",
            forums: next.forums === "summary" ? "summary" : "off",
            profilePublic: next.profilePublic,
          })
        } catch { /* swallow, will retry on next scan/visibility change */ }
      }
      if (profile) void uploadIfOptedIn(next)
    } else if (!anyOnlineSurfaceOn(next) && anyOnlineSurfaceOn(visibility)) {
      // All surfaces just flipped off — remove the server-side spec.
      if (window.ucSystemProfile?.serverDelete) {
        try { await window.ucSystemProfile.serverDelete(baseUrlRef.current) } catch { }
      }
      setSyncState("idle")
    }
  }, [visibility, anyOnlineSurfaceOn, uploadIfOptedIn, profile])

  const clearProfile = useCallback(async () => {
    if (!window.ucSystemProfile?.clearCache) return
    try {
      await window.ucSystemProfile.clearCache()
      setProfile(null)
      // Also delete server copy so we don't have stale specs upstream.
      if (window.ucSystemProfile.serverDelete) {
        try { await window.ucSystemProfile.serverDelete(baseUrlRef.current) } catch { }
      }
      setSyncState("idle")
    } catch (err: any) {
      setError(err?.message || String(err))
    }
  }, [])

  const spec = profile?.spec
  const primaryGpu = spec?.gpus?.[0]
  const ramGib = spec ? Math.round((spec.ram.totalBytes || 0) / (1024 ** 3)) : null

  return (
    <div className="space-y-4">
      <Card className="border-white/[.07]">
        <CardContent className="p-6 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-semibold">System Profile</h2>
                {profile && <Badge className="bg-zinc-800 text-zinc-200 border-zinc-700 text-[10px]">fp:{profile.fingerprint.slice(0, 8)}</Badge>}
                <SyncStatusBadge state={syncState} error={syncError} />
              </div>
              <p className="text-sm text-zinc-400 mt-1">
                Scan your PC's hardware to power pre-download requirement checks, library filtering, and an opt-in spec badge on comments and your public profile. Nothing is uploaded unless you flip a sharing switch below.
              </p>
              <p className="text-[11px] text-zinc-500 mt-2">
                Last scan: <span className="text-zinc-300">{relativeTime(profile?.capturedAt)}</span>
                {profile && <> · took {profile.scanDurationMs}ms</>}
              </p>
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              <Button onClick={() => runScan(true)} disabled={scanning} size="sm">
                {scanning ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Scanning…</>
                ) : profile ? (
                  <><RefreshCw className="h-4 w-4 mr-2" /> Rescan</>
                ) : (
                  <><Cpu className="h-4 w-4 mr-2" /> Scan now</>
                )}
              </Button>
              {profile && (
                <Button onClick={clearProfile} size="sm" variant="outline">
                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Clear
                </Button>
              )}
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          {spec && (
            <div className="grid sm:grid-cols-2 gap-3">
              <SpecTile icon={<Cpu className="h-4 w-4" />} label="CPU" value={spec.cpu.model || "Unknown"}
                sub={spec.cpu.cores ? `${spec.cpu.cores} cores / ${spec.cpu.threads ?? "?"} threads · ${spec.cpu.baseClockMhz ? `${(spec.cpu.baseClockMhz / 1000).toFixed(2)} GHz` : ""}` : null} />
              <SpecTile icon={<Zap className="h-4 w-4" />} label="GPU" value={primaryGpu?.name || "Unknown"}
                sub={primaryGpu ? [
                  primaryGpu.vendor !== "unknown" ? primaryGpu.vendor.toUpperCase() : null,
                  primaryGpu.vramBytes ? `${formatBytes(primaryGpu.vramBytes)} VRAM` : null,
                  primaryGpu.driverVersion ? `driver ${primaryGpu.driverVersion}` : null,
                ].filter(Boolean).join(" · ") : null} />
              <SpecTile icon={<MemoryStick className="h-4 w-4" />} label="RAM" value={ramGib ? `${ramGib} GB` : "Unknown"}
                sub={spec.ram.speedMhz ? `${spec.ram.speedMhz} MHz · ${spec.ram.channels || ""}` : null} />
              <SpecTile icon={<Monitor className="h-4 w-4" />} label="OS" value={`${spec.os.name} ${spec.os.version || ""}`}
                sub={spec.os.build ? `build ${spec.os.build}` : null} />
              <SpecTile icon={<HardDrive className="h-4 w-4" />} label="Storage" value={`${spec.storage.drives.length} drive${spec.storage.drives.length === 1 ? "" : "s"}`}
                sub={spec.storage.drives.slice(0, 2).map((d) => `${d.mediaType?.toUpperCase() || ""} ${formatBytes(d.sizeBytes)}`).join(" · ") || null} />
              <SpecTile icon={<Monitor className="h-4 w-4" />} label="Display" value={spec.displays[0] ? `${spec.displays[0].width}×${spec.displays[0].height}` : "Unknown"}
                sub={spec.displays[0]?.refreshHz ? `${spec.displays[0].refreshHz} Hz · DX${spec.graphics.directx || "?"}${spec.graphics.vulkan ? ` · Vulkan ${spec.graphics.vulkan}` : ""}` : null} />
            </div>
          )}

          {spec && spec.gpus.length > 1 && (
            <div className="rounded-md border border-white/[.07] bg-zinc-900/40 px-3 py-2 text-xs text-zinc-400">
              <span className="font-medium text-zinc-300">Additional GPUs:</span> {spec.gpus.slice(1).map((g) => g.name).filter(Boolean).join(", ")}
            </div>
          )}

          {!profile && !scanning && (
            <div className="rounded-md border border-dashed border-white/10 bg-zinc-900/30 px-4 py-6 text-sm text-zinc-400 text-center">
              No scan yet. Click <span className="text-zinc-200 font-medium">Scan now</span> to detect your hardware.
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-white/[.07]">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-start gap-2">
            <ShieldCheck className="h-4 w-4 text-zinc-300 mt-1" />
            <div>
              <h2 className="text-lg font-semibold">Sharing &amp; visibility</h2>
              <p className="text-sm text-zinc-400 mt-1">
                Choose where your specs are visible. <b>Summary</b> shows a short string like &ldquo;RTX 4070 · 32GB · Win11&rdquo;. <b>Full spec</b> shows the detailed sheet. Existing comments and forum posts keep the specs they had when posted.
              </p>
            </div>
          </div>

          <div className="divide-y divide-white/[.06]">
            <VisibilityRow
              label="Comment badge"
              description="Show a spec chip next to your comments on game pages."
              value={visibility.comments}
              onChange={(v) => updateVisibility({ comments: v })}
              allowFull={false}
            />
            <VisibilityRow
              label="Forum posts"
              description="Show a spec chip on your forum posts."
              value={visibility.forums}
              onChange={(v) => updateVisibility({ forums: v })}
              allowFull={false}
            />
            <VisibilityRow
              label="Public profile"
              description="Show a spec card on your public UC profile."
              value={visibility.profilePublic}
              onChange={(v) => updateVisibility({ profilePublic: v })}
            />
            <div className="flex items-start justify-between gap-4 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">Pre-download requirement check</div>
                <div className="text-xs text-zinc-400 mt-0.5">
                  Compare a game's minimum and recommended specs to your hardware before downloading. Stays on your device.
                </div>
              </div>
              <Select value={sysreqCheck} onValueChange={(v) => updateVisibility({ sysreqCheck: v as "on" | "off" })}>
                <SelectTrigger className="w-32 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="on">On</SelectItem>
                  <SelectItem value="off">Off</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="text-[11px] text-zinc-500">
            Uploading specs to the UC server is opt-in and only happens when at least one online surface is set above &ldquo;Off&rdquo;.
          </p>
        </CardContent>
      </Card>

      {anyOnlineSurfaceOn(visibility) && <DevicesSection baseUrl={baseUrlRef.current} currentFingerprint={profile?.fingerprint ?? null} />}
      {anyOnlineSurfaceOn(visibility) && <SharesSection baseUrl={baseUrlRef.current} />}
      {profile && anyOnlineSurfaceOn(visibility) && <UpgradeSuggesterSection baseUrl={baseUrlRef.current} />}
    </div>
  )
}

// ─── Upgrade suggester ──────────────────────────────────────────────────────

type UpgradeReport = {
  considered: number
  smoothCount: number
  bottleneckedCount: number
  unknownCount: number
  primaryUnlockCount: number | null
  bottlenecks: Array<{
    component: "cpu" | "gpu" | "ram" | "storage" | "directx"
    gamesAffected: number
    suggestion: string | null
    examples: Array<{ appid: string; name: string | null }>
  }>
}

function UpgradeSuggesterSection({ baseUrl }: { baseUrl: string | undefined }) {
  const [report, setReport] = useState<UpgradeReport | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      if (!window.ucSystemProfile?.upgradeSuggest) {
        setLoading(false)
        return
      }
      try {
        const res = await window.ucSystemProfile.upgradeSuggest(baseUrl)
        if (res.ok && res.report) {
          setReport(res.report)
        } else if (res.ok && !res.report) {
          setReason(res.reason || "No wishlist games to evaluate yet.")
        } else if (!res.ok) {
          setReason(res.reason || res.error || null)
        }
      } catch (err: any) {
        setReason(err?.message || String(err))
      } finally {
        setLoading(false)
      }
    })()
  }, [baseUrl])

  if (loading) {
    return (
      <Card className="border-white/[.07]">
        <CardContent className="p-6 flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Analyzing your wishlist…
        </CardContent>
      </Card>
    )
  }

  // Don't render the card at all if we have nothing useful to say.
  if (!report && !reason) return null
  if (report && report.bottleneckedCount === 0 && report.considered > 0) {
    // Pure good-news state — show a small congrats card.
    return (
      <Card className="border-emerald-500/30 bg-emerald-500/[.04]">
        <CardContent className="p-6 space-y-1">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-300" />
            <h2 className="text-lg font-semibold">Your PC clears every game in your wishlist</h2>
          </div>
          <p className="text-sm text-zinc-400">
            {report.smoothCount} of {report.considered} game{report.considered === 1 ? "" : "s"} comfortable on your current rig.
            {report.unknownCount > 0 && ` ${report.unknownCount} game${report.unknownCount === 1 ? "" : "s"} we couldn't evaluate yet.`}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-white/[.07]">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-start gap-2">
          <TrendingUp className="h-4 w-4 text-zinc-300 mt-1" />
          <div>
            <h2 className="text-lg font-semibold">Upgrade suggestions</h2>
            <p className="text-sm text-zinc-400 mt-1">
              {report
                ? <>Based on your wishlist: {report.smoothCount} smooth · <span className="text-zinc-200">{report.bottleneckedCount} bottlenecked</span>{report.unknownCount > 0 && <> · {report.unknownCount} unknown</>}</>
                : (reason || "No data to evaluate yet.")}
            </p>
          </div>
        </div>

        {report?.bottlenecks && report.bottlenecks.length > 0 && (
          <div className="space-y-3">
            {report.bottlenecks.slice(0, 3).map((b, i) => (
              <div key={b.component} className={`rounded-lg border px-3 py-2 ${
                i === 0
                  ? "border-amber-500/40 bg-amber-500/[.05]"
                  : "border-white/[.07] bg-zinc-900/40"
              }`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500">{b.component}</span>
                    <Badge className="bg-zinc-800 text-zinc-200 border-zinc-700 text-[10px]">
                      {b.gamesAffected} game{b.gamesAffected === 1 ? "" : "s"}
                    </Badge>
                    {i === 0 && <Badge className="bg-amber-500/15 text-amber-200 border-amber-500/30 text-[10px]">biggest bottleneck</Badge>}
                  </div>
                </div>
                {b.suggestion && (
                  <p className="text-sm text-zinc-200 mt-1">{b.suggestion}</p>
                )}
                {b.examples.length > 0 && (
                  <p className="text-[11px] text-zinc-500 mt-1 truncate">
                    e.g. {b.examples.map((e) => e.name || e.appid).join(", ")}
                    {b.gamesAffected > b.examples.length && ` (+${b.gamesAffected - b.examples.length} more)`}
                  </p>
                )}
              </div>
            ))}
            {report.primaryUnlockCount != null && report.primaryUnlockCount > 0 && (
              <p className="text-xs text-zinc-400">
                Fixing the biggest bottleneck would unlock {report.primaryUnlockCount} wishlisted game{report.primaryUnlockCount === 1 ? "" : "s"} at smooth settings.
              </p>
            )}
          </div>
        )}

        <p className="text-[11px] text-zinc-500">
          Suggestions are a rough heuristic, not an authoritative benchmark. Games with no published requirements aren't considered.
        </p>
      </CardContent>
    </Card>
  )
}

// ─── Multi-rig devices ──────────────────────────────────────────────────────

type DeviceRow = { fingerprint: string; deviceName: string | null; summary: string | null; sourceAppVersion: string | null; capturedAt: string; isActive: boolean }

function DevicesSection({ baseUrl, currentFingerprint }: { baseUrl: string | undefined; currentFingerprint: string | null }) {
  const [devices, setDevices] = useState<DeviceRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [editingFp, setEditingFp] = useState<string | null>(null)
  const [editingName, setEditingName] = useState("")

  const reload = useCallback(async () => {
    if (!window.ucSystemProfile?.listDevices) return
    setLoading(true)
    try {
      const res = await window.ucSystemProfile.listDevices(baseUrl)
      setDevices(res.ok ? res.devices ?? [] : [])
    } finally {
      setLoading(false)
    }
  }, [baseUrl])

  useEffect(() => { void reload() }, [reload])

  if (!devices) return null
  if (devices.length <= 1) return null // only show when the user has multiple rigs

  return (
    <Card className="border-white/[.07]">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-start gap-2">
          <Laptop className="h-4 w-4 text-zinc-300 mt-1" />
          <div>
            <h2 className="text-lg font-semibold">My PCs</h2>
            <p className="text-sm text-zinc-400 mt-1">
              You&apos;ve scanned more than one device. Pick which one UnionCrax should treat as your active rig — that&apos;s what appears on comments, forums, and the &quot;Can my PC run&quot; filter.
            </p>
          </div>
        </div>
        <div className="divide-y divide-white/[.06]">
          {devices.map((d) => (
            <div key={d.fingerprint} className="flex items-center gap-3 py-2">
              <div className="flex-1 min-w-0">
                {editingFp === d.fingerprint ? (
                  <div className="flex items-center gap-2">
                    <Input value={editingName} onChange={(e) => setEditingName(e.target.value)} placeholder="Device name" className="h-7 text-xs" />
                    <Button size="sm" variant="ghost" onClick={async () => {
                      await window.ucSystemProfile?.renameDevice?.(baseUrl, d.fingerprint, editingName.trim() || null)
                      setEditingFp(null)
                      void reload()
                    }}>
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingFp(null)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-medium truncate">{d.deviceName || `PC ${d.fingerprint.slice(0, 6)}`}</span>
                    <button onClick={() => { setEditingFp(d.fingerprint); setEditingName(d.deviceName || "") }} className="opacity-50 hover:opacity-100" title="Rename">
                      <Pencil className="h-3 w-3" />
                    </button>
                    {d.isActive && <Badge className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30 text-[10px]">active</Badge>}
                    {d.fingerprint === currentFingerprint && !d.isActive && <Badge className="bg-zinc-800 text-zinc-300 border-zinc-700 text-[10px]">this PC</Badge>}
                  </div>
                )}
                <div className="text-[11px] text-zinc-400 mt-0.5 truncate">
                  {d.summary || "(no summary)"} · scanned {new Date(d.capturedAt).toLocaleDateString()}
                </div>
              </div>
              {!d.isActive && (
                <Button size="sm" variant="outline" disabled={loading} onClick={async () => {
                  await window.ucSystemProfile?.activateDevice?.(baseUrl, d.fingerprint)
                  void reload()
                }}>
                  Make active
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={loading} onClick={async () => {
                if (!confirm("Forget this PC's profile from UnionCrax? Old posts that snapshot this device keep their data.")) return
                await window.ucSystemProfile?.deleteDevice?.(baseUrl, d.fingerprint)
                void reload()
              }} title="Forget this device">
                <Trash2 className="h-3.5 w-3.5 text-red-400" />
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Share-a-spec ───────────────────────────────────────────────────────────

type ShareRow = { shortCode: string; tier: "summary" | "full"; viewCount: number; expiresAt: string | null; createdAt: string }

function SharesSection({ baseUrl }: { baseUrl: string | undefined }) {
  const [shares, setShares] = useState<ShareRow[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!window.ucSystemProfile?.listShares) return
    const res = await window.ucSystemProfile.listShares(baseUrl)
    setShares(res.ok ? res.shares ?? [] : [])
  }, [baseUrl])

  useEffect(() => { void reload() }, [reload])

  const create = useCallback(async (tier: "summary" | "full") => {
    setCreating(true)
    try {
      await window.ucSystemProfile?.createShare?.(baseUrl, { tier })
      await reload()
    } finally {
      setCreating(false)
    }
  }, [baseUrl, reload])

  const buildShareUrl = (code: string) => {
    const apiBase = baseUrl?.replace(/\/$/, "") || ""
    return apiBase ? `${apiBase}/specs/${code}` : `/specs/${code}`
  }

  return (
    <Card className="border-white/[.07]">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Link2 className="h-4 w-4 text-zinc-300 mt-1" />
            <div>
              <h2 className="text-lg font-semibold">Shared spec links</h2>
              <p className="text-sm text-zinc-400 mt-1">
                Mint a short URL anyone can open to see your specs (frozen at create time). Useful for &ldquo;can your friend&apos;s PC run this?&rdquo; conversations. Revokeable any time.
              </p>
            </div>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <Button size="sm" variant="outline" disabled={creating} onClick={() => create("summary")}>Summary</Button>
            <Button size="sm" disabled={creating} onClick={() => create("full")}>{creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Full spec"}</Button>
          </div>
        </div>

        {shares && shares.length === 0 && (
          <p className="text-xs text-zinc-500">No links yet. Click <span className="text-zinc-300">Summary</span> or <span className="text-zinc-300">Full spec</span> to create one.</p>
        )}

        {shares && shares.length > 0 && (
          <div className="divide-y divide-white/[.06]">
            {shares.map((s) => {
              const url = buildShareUrl(s.shortCode)
              return (
                <div key={s.shortCode} className="flex items-center gap-3 py-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-xs font-mono text-zinc-200">{url}</code>
                      <Badge className="bg-zinc-800 text-zinc-300 border-zinc-700 text-[10px]">{s.tier}</Badge>
                    </div>
                    <div className="text-[11px] text-zinc-400 mt-0.5">
                      {s.viewCount} view{s.viewCount === 1 ? "" : "s"} · created {new Date(s.createdAt).toLocaleDateString()}
                      {s.expiresAt && ` · expires ${new Date(s.expiresAt).toLocaleDateString()}`}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={async () => {
                    try { await navigator.clipboard.writeText(url); setCopied(s.shortCode); setTimeout(() => setCopied(null), 1500) } catch { /* swallow */ }
                  }}>
                    {copied === s.shortCode ? "Copied!" : "Copy"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={async () => {
                    if (!confirm("Revoke this share link? Anyone with it will get a 404.")) return
                    await window.ucSystemProfile?.revokeShare?.(baseUrl, s.shortCode)
                    void reload()
                  }} title="Revoke">
                    <Trash2 className="h-3.5 w-3.5 text-red-400" />
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SyncStatusBadge({ state, error }: { state: SyncState; error: string | null }) {
  if (state === "idle") {
    return (
      <Badge className="bg-zinc-900 text-zinc-400 border-zinc-800 text-[10px]" title="Profile is local only — flip a sharing switch below to publish.">
        <CloudOff className="h-2.5 w-2.5 mr-1" /> local only
      </Badge>
    )
  }
  if (state === "uploading") {
    return (
      <Badge className="bg-zinc-800 text-zinc-300 border-zinc-700 text-[10px]">
        <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" /> syncing
      </Badge>
    )
  }
  if (state === "synced") {
    return (
      <Badge className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30 text-[10px]" title="Profile published to UC ecosystem.">
        <CheckCircle2 className="h-2.5 w-2.5 mr-1" /> synced
      </Badge>
    )
  }
  if (state === "offline") {
    return (
      <Badge className="bg-zinc-900 text-zinc-500 border-zinc-800 text-[10px]" title="Sync API not available.">
        <CloudOff className="h-2.5 w-2.5 mr-1" /> offline
      </Badge>
    )
  }
  return (
    <Badge className="bg-red-500/10 text-red-300 border-red-500/30 text-[10px]" title={error || "Sync failed"}>
      <CloudUpload className="h-2.5 w-2.5 mr-1" /> sync error
    </Badge>
  )
}

function SpecTile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string | null }) {
  return (
    <div className="rounded-lg border border-white/[.07] bg-zinc-900/40 px-4 py-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-zinc-500">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-sm font-medium text-zinc-100 mt-1 truncate" title={value}>{value}</div>
      {sub && <div className="text-[11px] text-zinc-400 mt-1 truncate" title={sub}>{sub}</div>}
    </div>
  )
}
