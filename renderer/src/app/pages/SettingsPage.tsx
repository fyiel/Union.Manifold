import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { apiUrl } from "@/lib/api"
import {
  getPreferredDownloadHost,
  setPreferredDownloadHost,
} from "@/lib/downloads"
type MirrorHost = 'rootz' | 'pixeldrain'

type MirrorHostTag = 'beta' | 'soon'

type MirrorHostInfo = {
  key: MirrorHost
  label: string
  tag?: MirrorHostTag
}

const MIRROR_HOSTS: MirrorHostInfo[] = [
  { key: 'rootz', label: 'Rootz', tag: 'beta' },
  { key: 'pixeldrain', label: 'Pixeldrain' }
]
import { ExternalLink, FolderOpen, HardDrive, Plus } from "lucide-react"

const downloadDirName = "UnionCrax.Direct"

type DiskInfo = {
  id: string
  name: string
  path: string
  totalBytes: number
  freeBytes: number
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let index = 0
  let value = bytes
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index++
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`
}

function joinPath(root: string, folder: string) {
  if (root.endsWith("/") || root.endsWith("\\")) {
    return `${root}${folder}`
  }
  const separator = root.includes("\\") ? "\\" : "/"
  return `${root}${separator}${folder}`
}

export function SettingsPage() {
  const [disks, setDisks] = useState<DiskInfo[]>([])
  const [downloadPath, setDownloadPath] = useState("")
  const [selectedDiskId, setSelectedDiskId] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ucSizeBytes, setUcSizeBytes] = useState<number | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const [defaultHost, setDefaultHost] = useState<MirrorHost>('rootz')

  useEffect(() => {
    const load = async () => {
      try {
        const diskList = (await window.ucDownloads?.listDisks?.()) || []
        const pathResult = await window.ucDownloads?.getDownloadPath?.()
        const currentPath = pathResult?.path || ""

        setDisks(diskList)
        setDownloadPath(currentPath)

        const match = diskList.find((disk) => currentPath && currentPath.startsWith(disk.path))
        setSelectedDiskId(match?.id || (currentPath ? "custom" : ""))
      } catch (err) {
        console.error("[UC] Failed to load disk info:", err)
        setError("Unable to load disk settings.")
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  useEffect(() => {
    let mounted = true
    const loadDefault = async () => {
      try {
        const v = await getPreferredDownloadHost()
        if (!mounted) return
        if (v && MIRROR_HOSTS.some((h) => h.key === v)) setDefaultHost(v as MirrorHost)
      } catch {
        // ignore
      }
    }
    loadDefault()
    const off = window.ucSettings?.onChanged?.((data: any) => {
      if (!data || !data.key) return
      if (data.key === 'defaultMirrorHost' && data.value && MIRROR_HOSTS.some((h) => h.key === data.value)) {
        setDefaultHost(data.value)
      }
    })
    return () => {
      mounted = false
      if (typeof off === 'function') off()
    }
  }, [])

  const selectedDisk = useMemo(() => disks.find((disk) => disk.id === selectedDiskId) || null, [disks, selectedDiskId])
  const diskForUsage = useMemo(() => {
    if (selectedDisk) return selectedDisk
    if (!downloadPath) return null
    return disks.find((disk) => downloadPath.startsWith(disk.path)) || null
  }, [selectedDisk, downloadPath, disks])

  const usagePercent = useMemo(() => {
    if (!selectedDisk || selectedDisk.totalBytes <= 0) return 0
    const used = selectedDisk.totalBytes - selectedDisk.freeBytes
    return Math.min(100, Math.max(0, (used / selectedDisk.totalBytes) * 100))
  }, [selectedDisk])

  const usageBreakdown = useMemo(() => {
    if (!diskForUsage || diskForUsage.totalBytes <= 0) return null
    const total = diskForUsage.totalBytes
    const free = Math.max(0, diskForUsage.freeBytes)
    const ucRaw = Math.max(0, ucSizeBytes ?? 0)
    const maxUc = Math.max(0, total - free)
    const uc = Math.min(ucRaw, maxUc)
    const other = Math.max(0, total - free - uc)

    const percent = (value: number) => Math.min(100, Math.max(0, (value / total) * 100))

    return {
      total,
      freeBytes: free,
      ucBytes: uc,
      otherBytes: other,
      freePercent: percent(free),
      ucPercent: percent(uc),
      otherPercent: percent(other),
    }
  }, [diskForUsage, ucSizeBytes])

  useEffect(() => {
    let active = true
    let timer: number | null = null

    const loadUsage = async () => {
      if (!downloadPath || !window.ucDownloads?.getDownloadUsage) {
        setUcSizeBytes(null)
        return
      }
      setUsageLoading(true)
      try {
        const result = await window.ucDownloads.getDownloadUsage(downloadPath)
        if (!active) return
        setUcSizeBytes(result?.ok ? result.sizeBytes : null)
      } catch (err) {
        if (active) {
          console.error("[UC] Failed to load download usage:", err)
          setUcSizeBytes(null)
        }
      } finally {
        if (active) setUsageLoading(false)
      }
    }

    loadUsage()
    timer = window.setInterval(loadUsage, 5000)

    return () => {
      active = false
      if (timer) window.clearInterval(timer)
    }
  }, [downloadPath])

  const handleDiskSelect = async (diskId: string) => {
    setSelectedDiskId(diskId)
    const disk = disks.find((item) => item.id === diskId)
    if (!disk || !window.ucDownloads?.setDownloadPath) return

    const targetPath = joinPath(disk.path, downloadDirName)
    const result = await window.ucDownloads.setDownloadPath(targetPath)
    if (result?.ok && result.path) {
      setDownloadPath(result.path)
    }
  }

  const handleAddDrive = async () => {
    if (!window.ucDownloads?.pickDownloadPath) return
    const result = await window.ucDownloads.pickDownloadPath()
    if (result?.ok && result.path) {
      setDownloadPath(result.path)
      setSelectedDiskId("custom")
    }
  }

  return (
    <div className="container mx-auto max-w-5xl space-y-8">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl sm:text-3xl font-black font-montserrat">Settings</h1>
        <Badge className="rounded-full bg-primary/15 text-primary border-primary/20">UnionCrax.Direct</Badge>
      </div>

      <Card className="border-border/60">
        <CardContent className="p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Account</h2>
            <p className="text-sm text-muted-foreground">
              Manage your Discord profile and requests on the web dashboard.
            </p>
          </div>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => window.open(apiUrl("/settings"), "_blank")}
          >
            <ExternalLink className="h-4 w-4" />
            Manage account on web
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardContent className="p-6 space-y-6">
          <div>
            <h2 className="text-lg font-semibold">Manage disk</h2>
            <p className="text-sm text-muted-foreground">
              Choose where UnionCrax.Direct stores downloaded games.
            </p>
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-3">
            <label className="text-sm font-medium">Download drive</label>
            <Select value={selectedDiskId} onValueChange={handleDiskSelect}>
              <SelectTrigger className="h-12">
                <SelectValue placeholder={loading ? "Loading drives..." : "Select a drive"} />
              </SelectTrigger>
              <SelectContent>
                {disks.map((disk) => (
                  <SelectItem key={disk.id} value={disk.id}>
                    {disk.name} - {formatBytes(disk.freeBytes)} free of {formatBytes(disk.totalBytes)}
                  </SelectItem>
                ))}
                {downloadPath && selectedDiskId === "custom" && (
                  <SelectItem value="custom">Custom location</SelectItem>
                )}
              </SelectContent>
            </Select>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Current path</span>
              <span className="truncate max-w-[280px] text-right">{downloadPath || "Not set"}</span>
            </div>
          </div>

          {selectedDisk && (
            <div className="rounded-xl border border-border/60 bg-card/50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold">{selectedDisk.name}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatBytes(selectedDisk.freeBytes)} free of {formatBytes(selectedDisk.totalBytes)}
                </span>
              </div>
              {usageBreakdown ? (
                <div className="space-y-3">
                  <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted/40">
                    <div className="h-full bg-primary" style={{ width: `${usageBreakdown.ucPercent}%` }} />
                    <div className="h-full bg-amber-400/80" style={{ width: `${usageBreakdown.otherPercent}%` }} />
                    <div className="h-full bg-emerald-400/60" style={{ width: `${usageBreakdown.freePercent}%` }} />
                  </div>
                  <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-primary" />
                      <span>UC games {usageLoading && ucSizeBytes === null ? "..." : formatBytes(usageBreakdown.ucBytes)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-amber-400/80" />
                      <span>Other {formatBytes(usageBreakdown.otherBytes)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-400/60" />
                      <span>Free {formatBytes(usageBreakdown.freeBytes)}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted/40">
                    <div className="h-full bg-primary/50" style={{ width: `${usagePercent}%` }} />
                  </div>
                  <div className="text-xs text-muted-foreground">Usage breakdown unavailable.</div>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <Button variant="outline" className="gap-2" onClick={handleAddDrive}>
              <Plus className="h-4 w-4" />
              Add Drive
            </Button>
            <Button
              variant="ghost"
              className="gap-2 justify-start"
              onClick={() => downloadPath && window.ucDownloads?.openPath?.(downloadPath)}
              disabled={!downloadPath}
            >
              <FolderOpen className="h-4 w-4" />
              Open download folder
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardContent className="p-6 space-y-6">
          <div>
            <h2 className="text-lg font-semibold">Mirror host</h2>
            <p className="text-sm text-muted-foreground">Choose the default mirror host for downloads.</p>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium">Default host</label>
            <Select
              value={defaultHost}
              onValueChange={async (v) => {
                setDefaultHost(v as MirrorHost)
                try {
                  setPreferredDownloadHost(v as MirrorHost)
                } catch {}
              }}
            >
              <SelectTrigger className="h-12">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MIRROR_HOSTS.map((h) => (
                  <SelectItem key={h.key} value={h.key}>
                    <div className="flex items-center justify-between w-full">
                      <span>{h.label}</span>
                      {h.tag ? (
                        <span
                          className={`ml-2 inline-block text-[10px] font-medium px-2 py-0.5 rounded-full ${
                            h.tag === 'beta' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-800'
                          }`}
                        >
                          {h.tag}
                        </span>
                      ) : null}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {defaultHost === "rootz" && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Download resuming is currently not supported for this host. Please do not close the app while
                downloading with Rootz.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
