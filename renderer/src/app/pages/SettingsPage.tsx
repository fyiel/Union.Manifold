import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { apiUrl, setApiBaseUrl, getApiBaseUrl } from "@/lib/api"
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
  const [discordRpcEnabled, setDiscordRpcEnabled] = useState(true)
  const [clearingData, setClearingData] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [clearDataFeedback, setClearDataFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [developerMode, setDeveloperMode] = useState(false)
  const [customBaseUrl, setCustomBaseUrl] = useState('')
  const [baseUrlInput, setBaseUrlInput] = useState('')
  const [copyingDiagnostics, setCopyingDiagnostics] = useState(false)
  const [diagnosticsFeedback, setDiagnosticsFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [verboseDownloadLogging, setVerboseDownloadLogging] = useState(false)
  const [networkTesting, setNetworkTesting] = useState(false)
  const [networkResults, setNetworkResults] = useState<Array<{ label: string; url: string; ok: boolean; status: number; elapsedMs: number; error?: string }> | null>(null)
  const [devActionFeedback, setDevActionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [clearingDownloadCache, setClearingDownloadCache] = useState(false)

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
        setDiscordRpcEnabled(enabled !== false)
      } catch {
        // ignore
      }
    }
    loadRpcSettings()
    const off = window.ucSettings?.onChanged?.((data: any) => {
      if (!data || !data.key) return
      if (data.key === '__CLEAR_ALL__') {
        setDiscordRpcEnabled(true)
        return
      }
      if (data.key === 'discordRpcEnabled') setDiscordRpcEnabled(data.value !== false)
    })
    return () => {
      mounted = false
      if (typeof off === 'function') off()
    }
  }, [])

  useEffect(() => {
    let mounted = true
    const loadDeveloperSettings = async () => {
      try {
        const devMode = await window.ucSettings?.get?.('developerMode')
        const baseUrl = await window.ucSettings?.get?.('customBaseUrl')
        const verbose = await window.ucSettings?.get?.('verboseDownloadLogging')
        if (!mounted) return
        setDeveloperMode(devMode || false)
        const url = (baseUrl || '').trim()
        setCustomBaseUrl(url)
        setBaseUrlInput(url)
        setVerboseDownloadLogging(Boolean(verbose))
        if (url) {
          setApiBaseUrl(url)
        }
      } catch {
        // ignore
      }
    }
    loadDeveloperSettings()
    const off = window.ucSettings?.onChanged?.((data: any) => {
      if (!data || !data.key) return
      if (data.key === '__CLEAR_ALL__') {
        setDeveloperMode(false)
        setCustomBaseUrl('')
        setBaseUrlInput('')
        setApiBaseUrl('https://union-crax.xyz')
        setVerboseDownloadLogging(false)
        return
      }
      if (data.key === 'developerMode') {
        setDeveloperMode(data.value || false)
      }
      if (data.key === 'customBaseUrl') {
        const url = (data.value || '').trim()
        setCustomBaseUrl(url)
        setBaseUrlInput(url)
        if (url) {
          setApiBaseUrl(url)
        }
      }
      if (data.key === 'verboseDownloadLogging') {
        setVerboseDownloadLogging(Boolean(data.value))
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

    const result = await window.ucDownloads.setDownloadPath(disk.path)
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

  const handleCopyDiagnostics = async () => {
    if (copyingDiagnostics) return
    setCopyingDiagnostics(true)
    setDiagnosticsFeedback(null)
    try {
      const version = await window.ucUpdater?.getVersion?.()
      const downloadPathResult = await window.ucDownloads?.getDownloadPath?.()
      const downloadPathValue = downloadPathResult?.path || downloadPath || 'unknown'
      const baseUrlValue = customBaseUrl || 'https://union-crax.xyz'
      const platformValue = typeof navigator !== 'undefined' ? navigator.platform : 'unknown'
      const userAgentValue = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'

      const diagnostics = [
        `Version: ${version || 'unknown'}`,
        `Platform: ${platformValue}`,
        `User Agent: ${userAgentValue}`,
        `API Base URL: ${baseUrlValue}`,
        `Download Path: ${downloadPathValue}`,
        `Developer Mode: ${developerMode ? 'enabled' : 'disabled'}`,
        `Verbose Download Logging: ${verboseDownloadLogging ? 'enabled' : 'disabled'}`,
      ].join('\n')

      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(diagnostics)
        setDiagnosticsFeedback({ type: 'success', message: 'Diagnostics copied to clipboard.' })
      } else {
        setDiagnosticsFeedback({ type: 'error', message: 'Clipboard API unavailable.' })
      }
    } catch (err) {
      setDiagnosticsFeedback({ type: 'error', message: 'Failed to copy diagnostics.' })
    } finally {
      setCopyingDiagnostics(false)
      setTimeout(() => setDiagnosticsFeedback(null), 3000)
    }
  }

  const handleRunNetworkTest = async () => {
    if (networkTesting) return
    setNetworkTesting(true)
    setNetworkResults(null)
    setDevActionFeedback(null)
    try {
      const baseUrlValue = customBaseUrl || 'https://union-crax.xyz'
      const result = await window.ucSettings?.runNetworkTest?.(baseUrlValue)
      if (result?.ok && Array.isArray(result.results)) {
        setNetworkResults(result.results)
        setDevActionFeedback({ type: 'success', message: 'Network test completed.' })
      } else {
        setDevActionFeedback({ type: 'error', message: result?.error || 'Network test failed.' })
      }
    } catch (err) {
      setDevActionFeedback({ type: 'error', message: 'Network test failed.' })
    } finally {
      setNetworkTesting(false)
      setTimeout(() => setDevActionFeedback(null), 4000)
    }
  }

  const handleClearDownloadCache = async () => {
    if (clearingDownloadCache) return
    setClearingDownloadCache(true)
    setDevActionFeedback(null)
    try {
      const result = await window.ucDownloads?.clearDownloadCache?.()
      if (result?.ok) {
        setDevActionFeedback({ type: 'success', message: 'Download cache cleared.' })
      } else if (result?.error === 'downloads-active') {
        setDevActionFeedback({ type: 'error', message: 'Stop active downloads before clearing cache.' })
      } else {
        setDevActionFeedback({ type: 'error', message: result?.error || 'Failed to clear download cache.' })
      }
    } catch (err) {
      setDevActionFeedback({ type: 'error', message: 'Failed to clear download cache.' })
    } finally {
      setClearingDownloadCache(false)
      setTimeout(() => setDevActionFeedback(null), 4000)
    }
  }

  const handleExportSettings = async () => {
    setDevActionFeedback(null)
    try {
      const result = await window.ucSettings?.exportSettings?.()
      if (!result?.ok || !result.data) {
        setDevActionFeedback({ type: 'error', message: result?.error || 'Failed to export settings.' })
        return
      }
      const blob = new Blob([result.data], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `unioncrax-direct-settings-${Date.now()}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      setDevActionFeedback({ type: 'success', message: 'Settings exported.' })
      setTimeout(() => setDevActionFeedback(null), 4000)
    } catch (err) {
      setDevActionFeedback({ type: 'error', message: 'Failed to export settings.' })
    }
  }

  const handleImportSettings = async () => {
    setDevActionFeedback(null)
    try {
      const result = await window.ucSettings?.importSettings?.()
      if (result?.ok) {
        setDevActionFeedback({ type: 'success', message: 'Settings imported.' })
      } else if (result?.error && result.error !== 'cancelled') {
        setDevActionFeedback({ type: 'error', message: result.error || 'Failed to import settings.' })
      }
    } catch (err) {
      setDevActionFeedback({ type: 'error', message: 'Failed to import settings.' })
    } finally {
      setTimeout(() => setDevActionFeedback(null), 4000)
    }
  }

  const handleOpenLogsFolder = async () => {
    setDevActionFeedback(null)
    try {
      const result = await (window.ucLogs as any)?.openLogsFolder?.()
      if (result?.ok) {
        setDevActionFeedback({ type: 'success', message: 'Opened logs folder.' })
      } else {
        setDevActionFeedback({ type: 'error', message: result?.error || 'Failed to open logs folder.' })
      }
    } catch (err) {
      setDevActionFeedback({ type: 'error', message: 'Failed to open logs folder.' })
    } finally {
      setTimeout(() => setDevActionFeedback(null), 4000)
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
            <label className="text-sm font-medium">Download location</label>
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
              Choose folder
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
                      setClearDataFeedback(null)
                      try {
                        const result = await window.ucSettings?.clearAll?.()
                        if (result?.ok) {
                          // Reset all local state to defaults
                          setRunGamesAsAdmin(false)
                          setAlwaysCreateDesktopShortcut(false)
                          setDefaultHost('pixeldrain')
                          setDiscordRpcEnabled(true)
                          setDeveloperMode(false)
                          setCustomBaseUrl('')
                          setBaseUrlInput('')
                          setApiBaseUrl('https://union-crax.xyz')
                          setVerboseDownloadLogging(false)
                          setClearDataFeedback({ type: 'success', message: 'User data cleared successfully.' })
                          // Show success message briefly
                          setTimeout(() => {
                            setShowClearConfirm(false)
                          }, 1500)
                          setTimeout(() => {
                            setClearDataFeedback(null)
                          }, 3000)
                        } else {
                          setClearDataFeedback({ type: 'error', message: 'Failed to clear user data. Please try again.' })
                        }
                      } catch (err) {
                        console.error('Failed to clear user data:', err)
                        setClearDataFeedback({ type: 'error', message: 'Failed to clear user data. Please try again.' })
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

            {clearDataFeedback && (
              <div className={`text-xs ${clearDataFeedback.type === 'success' ? 'text-emerald-400' : 'text-destructive'}`}>
                {clearDataFeedback.message}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-amber-500/40">
        <CardContent className="p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-amber-400">Developer Mode</h2>
            <p className="text-sm text-muted-foreground">
              Advanced settings for developers and power users.
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <label htmlFor="developer-mode-toggle" className="text-sm font-medium">
                  Enable Developer Mode
                </label>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Unlock advanced settings and customization options.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                id="developer-mode-toggle"
                type="checkbox"
                checked={developerMode}
                onChange={async (e) => {
                  const checked = e.target.checked
                  setDeveloperMode(checked)
                  await window.ucSettings?.set?.('developerMode', checked)
                }}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-ring rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>

          {developerMode && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 space-y-6">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-sm font-semibold text-foreground">Custom API Base URL</h3>
                </div>
                <p className="text-xs text-muted-foreground">
                  Override the default API base URL. Useful if you're proxying union-crax.xyz through your own domain 
                  (e.g., to bypass school/workplace restrictions). Leave empty to use the default URL.
                </p>
              </div>

              <div className="space-y-3">
                <Input
                  type="text"
                  placeholder="https://union-crax.xyz"
                  value={baseUrlInput}
                  onChange={(e) => setBaseUrlInput(e.target.value)}
                  className="bg-background"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={async () => {
                      const trimmed = baseUrlInput.trim()
                      if (trimmed && !trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
                        alert('Base URL must start with http:// or https://')
                        return
                      }
                      setCustomBaseUrl(trimmed)
                      await window.ucSettings?.set?.('customBaseUrl', trimmed)
                      if (trimmed) {
                        setApiBaseUrl(trimmed)
                      } else {
                        setApiBaseUrl('https://union-crax.xyz')
                      }
                    }}
                  >
                    Apply
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setBaseUrlInput(customBaseUrl)
                    }}
                  >
                    Reset
                  </Button>
                </div>
                {customBaseUrl && (
                  <div className="text-xs text-emerald-400">
                    Current API base URL: {customBaseUrl}
                  </div>
                )}
                {!customBaseUrl && (
                  <div className="text-xs text-muted-foreground">
                    Using default: https://union-crax.xyz
                  </div>
                )}
              </div>

              <div className="border-t border-amber-500/20 pt-4 space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Verbose download logging</h3>
                  <p className="text-xs text-muted-foreground">
                    Enable extra download logs for troubleshooting.
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Debug-level download logs</span>
                  <button
                    onClick={async () => {
                      const next = !verboseDownloadLogging
                      setVerboseDownloadLogging(next)
                      try {
                        await window.ucSettings?.set?.('verboseDownloadLogging', next)
                      } catch {}
                    }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      verboseDownloadLogging ? 'bg-primary' : 'bg-slate-700'
                    }`}
                    title="Toggle verbose download logging"
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        verboseDownloadLogging ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>

              <div className="border-t border-amber-500/20 pt-4 space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Network test</h3>
                  <p className="text-xs text-muted-foreground">
                    Check connectivity to the API and download mirrors.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={handleRunNetworkTest} disabled={networkTesting}>
                    {networkTesting ? 'Testing...' : 'Run network test'}
                  </Button>
                </div>
                {networkResults && (
                  <div className="space-y-2 text-xs">
                    {networkResults.map((result) => (
                      <div key={result.url} className="flex flex-col gap-1 rounded-md border border-border/60 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="font-medium text-foreground">{result.label}</div>
                        <div className={result.ok ? 'text-emerald-400' : 'text-destructive'}>
                          {result.ok ? `OK (${result.status})` : `Failed (${result.error || result.status})`}
                        </div>
                        <div className="text-muted-foreground">{result.elapsedMs} ms</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-amber-500/20 pt-4 space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Download cache</h3>
                  <p className="text-xs text-muted-foreground">
                    Clear temporary installing files and cached download parts.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={handleClearDownloadCache} disabled={clearingDownloadCache}>
                    {clearingDownloadCache ? 'Clearing...' : 'Clear download cache'}
                  </Button>
                </div>
              </div>

              <div className="border-t border-amber-500/20 pt-4 space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Settings JSON</h3>
                  <p className="text-xs text-muted-foreground">
                    Export or import your app settings.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={handleExportSettings}>
                    Export settings
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleImportSettings}>
                    Import settings
                  </Button>
                </div>
              </div>

              <div className="border-t border-amber-500/20 pt-4 space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Diagnostics</h3>
                  <p className="text-xs text-muted-foreground">
                    Copy system and app details for debugging reports.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={handleCopyDiagnostics} disabled={copyingDiagnostics}>
                    {copyingDiagnostics ? 'Copying...' : 'Copy diagnostics'}
                  </Button>
                </div>
                {diagnosticsFeedback && (
                  <div className={`text-xs ${diagnosticsFeedback.type === 'success' ? 'text-emerald-400' : 'text-destructive'}`}>
                    {diagnosticsFeedback.message}
                  </div>
                )}
              </div>

              <div className="border-t border-amber-500/20 pt-4 space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Application Logs</h3>
                  <p className="text-xs text-muted-foreground">
                    View and manage application logs for debugging and troubleshooting.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={handleOpenLogsFolder}>
                    Open logs folder
                  </Button>
                  <LogViewer />
                </div>
              </div>

              {devActionFeedback && (
                <div className={`text-xs ${devActionFeedback.type === 'success' ? 'text-emerald-400' : 'text-destructive'}`}>
                  {devActionFeedback.message}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}


