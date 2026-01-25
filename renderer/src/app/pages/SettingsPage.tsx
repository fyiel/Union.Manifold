import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { apiUrl } from "@/lib/api"
import {
  getPreferredDownloadHost,
  setPreferredDownloadHost,
} from "@/lib/downloads"
import { LogViewer } from "@/components/LogViewer"
type MirrorHost = 'rootz' | 'pixeldrain'

type MirrorHostTag = 'beta' | 'soon'

type MirrorHostInfo = {
  key: MirrorHost
  label: string
  tag?: MirrorHostTag
}

const MIRROR_HOSTS: MirrorHostInfo[] = [
  { key: 'pixeldrain', label: 'Pixeldrain' },
  { key: 'rootz', label: 'Rootz', tag: 'beta' }
]
import { ExternalLink, FolderOpen, HardDrive, Plus, RefreshCw } from "lucide-react"

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
  const isWindows = typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent)
  const isLinux = typeof navigator !== 'undefined' && /linux/i.test(navigator.userAgent)
  const [disks, setDisks] = useState<DiskInfo[]>([])
  const [downloadPath, setDownloadPath] = useState("")
  const [selectedDiskId, setSelectedDiskId] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ucSizeBytes, setUcSizeBytes] = useState<number | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const [defaultHost, setDefaultHost] = useState<MirrorHost>('pixeldrain')
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [appVersion, setAppVersion] = useState<string>("")
  const [updateCheckResult, setUpdateCheckResult] = useState<string | null>(null)
  const [runGamesAsAdmin, setRunGamesAsAdmin] = useState(false)
  const [alwaysCreateDesktopShortcut, setAlwaysCreateDesktopShortcut] = useState(false)
  const [linuxLaunchMode, setLinuxLaunchMode] = useState<'auto' | 'native' | 'wine' | 'proton'>('auto')
  const [linuxWinePath, setLinuxWinePath] = useState('')
  const [linuxProtonPath, setLinuxProtonPath] = useState('')
  const [discordRpcEnabled, setDiscordRpcEnabled] = useState(false)
  const [clearingData, setClearingData] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  useEffect(() => {
    const loadVersion = async () => {
      const version = await window.ucUpdater?.getVersion?.()
      if (version) setAppVersion(version)
    }
    loadVersion()
  }, [])

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

  useEffect(() => {
    let mounted = true
    const loadLinuxLaunchSettings = async () => {
      try {
        const mode = await window.ucSettings?.get?.('linuxLaunchMode')
        const winePath = await window.ucSettings?.get?.('linuxWinePath')
        const protonPath = await window.ucSettings?.get?.('linuxProtonPath')
        if (!mounted) return
        if (mode && ['auto', 'native', 'wine', 'proton'].includes(String(mode))) {
          setLinuxLaunchMode(mode as 'auto' | 'native' | 'wine' | 'proton')
        }
        if (typeof winePath === 'string') setLinuxWinePath(winePath)
        if (typeof protonPath === 'string') setLinuxProtonPath(protonPath)
      } catch {
        // ignore
      }
    }
    loadLinuxLaunchSettings()
    const off = window.ucSettings?.onChanged?.((data: any) => {
      if (!data || !data.key) return
      if (data.key === '__CLEAR_ALL__') {
        setLinuxLaunchMode('auto')
        setLinuxWinePath('')
        setLinuxProtonPath('')
        return
      }
      if (data.key === 'linuxLaunchMode' && data.value) {
        const next = String(data.value)
        if (['auto', 'native', 'wine', 'proton'].includes(next)) setLinuxLaunchMode(next as 'auto' | 'native' | 'wine' | 'proton')
      }
      if (data.key === 'linuxWinePath') setLinuxWinePath(data.value || '')
      if (data.key === 'linuxProtonPath') setLinuxProtonPath(data.value || '')
    })
    return () => {
      mounted = false
      if (typeof off === 'function') off()
    }
  }, [])

  useEffect(() => {
    let mounted = true
    const loadAdminSetting = async () => {
      try {
        const value = await window.ucSettings?.get?.('runGamesAsAdmin')
        if (mounted) {
          setRunGamesAsAdmin(value || false)
        }
      } catch {
        // ignore
      }
    }
    loadAdminSetting()
    const off = window.ucSettings?.onChanged?.((data: any) => {
      if (!data || !data.key) return
      if (data.key === 'runGamesAsAdmin') {
        setRunGamesAsAdmin(data.value || false)
      }
    })
    return () => {
      mounted = false
      if (typeof off === 'function') off()
    }
  }, [])

  useEffect(() => {
    let mounted = true
    const loadShortcutSetting = async () => {
      try {
        const value = await window.ucSettings?.get?.('alwaysCreateDesktopShortcut')
        if (mounted) {
          setAlwaysCreateDesktopShortcut(value || false)
        }
      } catch {
        // ignore
      }
    }
    loadShortcutSetting()
    const off = window.ucSettings?.onChanged?.((data: any) => {
      if (!data || !data.key) return
      if (data.key === 'alwaysCreateDesktopShortcut') {
        setAlwaysCreateDesktopShortcut(data.value || false)
      }
    })
    return () => {
      mounted = false
      if (typeof off === 'function') off()
    }
  }, [])

  useEffect(() => {
    let mounted = true
    const loadRpcSettings = async () => {
      try {
        const enabled = await window.ucSettings?.get?.('discordRpcEnabled')
        if (!mounted) return
        setDiscordRpcEnabled(Boolean(enabled))
      } catch {
        // ignore
      }
    }
    loadRpcSettings()
    const off = window.ucSettings?.onChanged?.((data: any) => {
      if (!data || !data.key) return
      if (data.key === '__CLEAR_ALL__') {
        setDiscordRpcEnabled(false)
        return
      }
      if (data.key === 'discordRpcEnabled') setDiscordRpcEnabled(Boolean(data.value))
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
const handleCheckForUpdates = async () => {
    if (checkingUpdate) return
    setCheckingUpdate(true)
    setUpdateCheckResult(null)
    try {
      const result = await window.ucUpdater?.checkForUpdates()
      if (result?.available) {
        setUpdateCheckResult(`Update available: v${result.version}`)
      } else if (result?.message) {
        setUpdateCheckResult(result.message)
      } else {
        setUpdateCheckResult("You're up to date!")
      }
    } catch (err) {
      console.error("[UC] Failed to check for updates:", err)
      setUpdateCheckResult("Failed to check for updates")
    } finally {
      setTimeout(() => {
        setCheckingUpdate(false)
        setTimeout(() => setUpdateCheckResult(null), 5000)
      }, 1000)
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
            <h2 className="text-lg font-semibold">Discord Rich Presence</h2>
            <p className="text-sm text-muted-foreground">
              Show your UnionCrax.Direct activity on Discord.
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium cursor-pointer">Enable Discord RPC</label>
                <p className="text-xs text-muted-foreground mt-1">
                  Requires the Discord desktop app running in the background.
                </p>
              </div>
              <button
                onClick={async () => {
                  const newValue = !discordRpcEnabled
                  setDiscordRpcEnabled(newValue)
                  try {
                    await window.ucSettings?.set?.('discordRpcEnabled', newValue)
                  } catch {}
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  discordRpcEnabled ? 'bg-primary' : 'bg-slate-700'
                }`}
                title="Toggle Discord Rich Presence"
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    discordRpcEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <p className="text-xs text-muted-foreground">
              Discord application: UnionCrax.Direct.
            </p>
          </div>
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
        <CardContent className="p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Updates</h2>
            <p className="text-sm text-muted-foreground">
              Check for new versions of UnionCrax.Direct.
            </p>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Current version</span>
            <span className="font-mono font-medium">{appVersion ? `v${appVersion}` : 'Loading...'}</span>
          </div>
          {updateCheckResult && (
            <div className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-primary">
              {updateCheckResult}
            </div>
          )}
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleCheckForUpdates}
            disabled={checkingUpdate}
          >
            <RefreshCw className={`h-4 w-4 ${checkingUpdate ? 'animate-spin' : ''}`} />
            {checkingUpdate ? 'Checking...' : 'Check for Updates'}
          </Button>
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

      <Card className="border-border/60">
        <CardContent className="p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Game Launch</h2>
            <p className="text-sm text-muted-foreground">
              Configure how games are launched on your system.
            </p>
          </div>

          <div className="space-y-4">
            {isWindows && (
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium cursor-pointer">Run games as Administrator</label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Automatically launch games with admin privileges
                  </p>
                </div>
                <button
                  onClick={async () => {
                    const newValue = !runGamesAsAdmin
                    setRunGamesAsAdmin(newValue)
                    try {
                      await window.ucSettings?.set?.('runGamesAsAdmin', newValue)
                    } catch {}
                  }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    runGamesAsAdmin ? 'bg-primary' : 'bg-slate-700'
                  }`}
                  title="Toggle run games as admin"
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      runGamesAsAdmin ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            )}

            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium cursor-pointer">Always create desktop shortcuts</label>
                <p className="text-xs text-muted-foreground mt-1">
                  Automatically create desktop shortcuts when launching games for the first time
                </p>
              </div>
              <button
                onClick={async () => {
                  const newValue = !alwaysCreateDesktopShortcut
                  setAlwaysCreateDesktopShortcut(newValue)
                  try {
                    await window.ucSettings?.set?.('alwaysCreateDesktopShortcut', newValue)
                  } catch {}
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  alwaysCreateDesktopShortcut ? 'bg-primary' : 'bg-slate-700'
                }`}
                title="Toggle always create desktop shortcuts"
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    alwaysCreateDesktopShortcut ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {isWindows && (
              <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-200">
                The admin prompt appears only once on your first game launch.
              </div>
            )}

            {isLinux && (
              <div className="rounded-xl border border-border/60 bg-muted/30 p-4 space-y-3">
                <div>
                  <div className="text-sm font-semibold">Linux launch mode</div>
                  <div className="text-xs text-muted-foreground">Choose how Windows games are started on Linux.</div>
                </div>
                <Select
                  value={linuxLaunchMode}
                  onValueChange={async (value) => {
                    const next = value as 'auto' | 'native' | 'wine' | 'proton'
                    setLinuxLaunchMode(next)
                    try {
                      await window.ucSettings?.set?.('linuxLaunchMode', next)
                    } catch {}
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a launch mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto (native or Wine)</SelectItem>
                    <SelectItem value="native">Native only</SelectItem>
                    <SelectItem value="wine">Wine</SelectItem>
                    <SelectItem value="proton">Proton</SelectItem>
                  </SelectContent>
                </Select>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">Wine binary path (optional)</label>
                    <Input
                      value={linuxWinePath}
                      onChange={(e) => setLinuxWinePath(e.target.value)}
                      onBlur={async () => {
                        try {
                          await window.ucSettings?.set?.('linuxWinePath', linuxWinePath)
                        } catch {}
                      }}
                      placeholder="wine"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">Proton script path (optional)</label>
                    <Input
                      value={linuxProtonPath}
                      onChange={(e) => setLinuxProtonPath(e.target.value)}
                      onBlur={async () => {
                        try {
                          await window.ucSettings?.set?.('linuxProtonPath', linuxProtonPath)
                        } catch {}
                      }}
                      placeholder="/home/user/.steam/steam/steamapps/common/Proton*/proton"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardContent className="p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Application Logs</h2>
            <p className="text-sm text-muted-foreground">
              View and manage application logs for debugging and troubleshooting.
            </p>
          </div>
          <LogViewer />
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardContent className="p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-destructive">Danger Zone</h2>
            <p className="text-sm text-muted-foreground">
              Irreversible actions that will reset your application data.
            </p>
          </div>

          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-1">Clear All User Data</h3>
              <p className="text-xs text-muted-foreground">
                This will reset all settings to defaults, including download preferences, game launch settings, 
                saved game executables, and desktop shortcut preferences. Your downloaded games and files will not be affected.
              </p>
            </div>

            {!showClearConfirm ? (
              <Button
                variant="destructive"
                onClick={() => setShowClearConfirm(true)}
                disabled={clearingData}
              >
                Clear User Data
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  Are you sure? This action cannot be undone. Click "Confirm" to proceed or "Cancel" to abort.
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    onClick={async () => {
                      setClearingData(true)
                      try {
                        const result = await window.ucSettings?.clearAll?.()
                        if (result?.ok) {
                          // Reset all local state to defaults
                          setRunGamesAsAdmin(false)
                          setAlwaysCreateDesktopShortcut(false)
                          setDefaultHost('pixeldrain')
                          setDiscordRpcEnabled(false)
                          // Show success message briefly
                          setTimeout(() => {
                            setShowClearConfirm(false)
                          }, 1500)
                        }
                      } catch (err) {
                        console.error('Failed to clear user data:', err)
                      } finally {
                        setClearingData(false)
                      }
                    }}
                    disabled={clearingData}
                  >
                    {clearingData ? 'Clearing...' : 'Confirm Clear Data'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowClearConfirm(false)}
                    disabled={clearingData}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}


