import { useEffect, useMemo, useState } from "react"
import { ChevronDown, FolderOpen, HardDrive, LogIn, LogOut, Plus, RefreshCw, UserRound, Terminal, Cpu, FlaskConical } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { DiscordAvatar } from "@/components/DiscordAvatar"
import { apiFetch, apiUrl, getApiBaseUrl } from "@/lib/api"
import {
  getPreferredDownloadHost,
  setPreferredDownloadHost,
} from "@/lib/downloads"
import { LogViewer } from "@/components/LogViewer"
import { useDiscordAccount } from "@/hooks/use-discord-account"
import {
  SETTINGS_KEYS,
  TEXT_CONSTRAINTS,
  APP_INFO,
  MIRROR_HOSTS,
  type MirrorHost,
  type MirrorHostInfo,
} from "@/lib/settings-constants"

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
  const { user: accountUser, loading: accountLoading, authenticated, refresh: refreshAccount } = useDiscordAccount()
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
  const [linuxWinePrefix, setLinuxWinePrefix] = useState('')
  const [linuxProtonPrefix, setLinuxProtonPrefix] = useState('')
  const [linuxSteamPath, setLinuxSteamPath] = useState('')
  const [linuxExtraEnv, setLinuxExtraEnv] = useState('')
  const [linuxWinetricksInput, setLinuxWinetricksInput] = useState('')
  const [linuxProtontricksAppId, setLinuxProtontricksAppId] = useState('')
  const [linuxProtontricksInput, setLinuxProtontricksInput] = useState('')
  const [linuxToolFeedback, setLinuxToolFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [linuxToolRunning, setLinuxToolRunning] = useState<string | null>(null)
  const [detectedProtonVersions, setDetectedProtonVersions] = useState<Array<{ label: string; path: string }>>([])
  const [detectedWineVersions, setDetectedWineVersions] = useState<Array<{ label: string; path: string }>>([])
  const [linuxToolAvailability, setLinuxToolAvailability] = useState<Record<string, boolean>>({})
  const [showLinuxAdvanced, setShowLinuxAdvanced] = useState(false)
  const [linuxPrefixArch, setLinuxPrefixArch] = useState<'win64' | 'win32'>('win64')
  // SteamVR / VR settings
  const [vrEnabled, setVrEnabled] = useState(false)
  const [vrSteamVrPath, setVrSteamVrPath] = useState('')
  const [vrXrRuntimeJson, setVrXrRuntimeJson] = useState('')
  const [vrSteamVrRuntime, setVrSteamVrRuntime] = useState('')
  const [vrExtraEnv, setVrExtraEnv] = useState('')
  const [vrAutoLaunchSteamVr, setVrAutoLaunchSteamVr] = useState(false)
  const [vrDetected, setVrDetected] = useState<{ found: boolean; dir?: string | null } | null>(null)
  const [vrOpenXrDetected, setVrOpenXrDetected] = useState<{ found: boolean; path?: string | null } | null>(null)
  const [vrToolFeedback, setVrToolFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [vrToolRunning, setVrToolRunning] = useState(false)
  const [showVrAdvanced, setShowVrAdvanced] = useState(false)
  const [discordRpcEnabled, setDiscordRpcEnabled] = useState(true)
  const [showRpcAdvanced, setShowRpcAdvanced] = useState(false)
  const [rpcHideNsfw, setRpcHideNsfw] = useState(true)
  const [rpcShowGameName, setRpcShowGameName] = useState(true)
  const [rpcShowStatus, setRpcShowStatus] = useState(true)
  const [rpcShowButtons, setRpcShowButtons] = useState(true)
  const [clearingData, setClearingData] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [clearDataFeedback, setClearDataFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [developerMode, setDeveloperMode] = useState(false)
  const [copyingDiagnostics, setCopyingDiagnostics] = useState(false)
  const [diagnosticsFeedback, setDiagnosticsFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [verboseDownloadLogging, setVerboseDownloadLogging] = useState(false)
  const [networkTesting, setNetworkTesting] = useState(false)
  const [networkResults, setNetworkResults] = useState<Array<{ label: string; url: string; ok: boolean; status: number; elapsedMs: number; error?: string }> | null>(null)
  const [devActionFeedback, setDevActionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [clearingDownloadCache, setClearingDownloadCache] = useState(false)
  const [accountSummaryLoaded, setAccountSummaryLoaded] = useState(false)
  const [accountError, setAccountError] = useState<string | null>(null)
  const [accountRefreshing, setAccountRefreshing] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [showMika, setShowMika] = useState(true)
  const [showNsfw, setShowNsfw] = useState(false)
  const [showPublicProfile, setShowPublicProfile] = useState(true)
  const [bioDraft, setBioDraft] = useState("")
  const [bioSaving, setBioSaving] = useState(false)
  const [bioSaved, setBioSaved] = useState(false)
  const [skipLinkCheck, setSkipLinkCheck] = useState(false)

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
        const winePrefix = await window.ucSettings?.get?.('linuxWinePrefix')
        const protonPrefix = await window.ucSettings?.get?.('linuxProtonPrefix')
        const steamPath = await window.ucSettings?.get?.('linuxSteamPath')
        const extraEnv = await window.ucSettings?.get?.('linuxExtraEnv')
        const prefixArch = await window.ucSettings?.get?.('linuxPrefixArch')
        if (!mounted) return
        if (mode && ['auto', 'native', 'wine', 'proton'].includes(String(mode))) {
          setLinuxLaunchMode(mode as 'auto' | 'native' | 'wine' | 'proton')
        }
        if (typeof winePath === 'string') setLinuxWinePath(winePath)
        if (typeof protonPath === 'string') setLinuxProtonPath(protonPath)
        if (typeof winePrefix === 'string') setLinuxWinePrefix(winePrefix)
        if (typeof protonPrefix === 'string') setLinuxProtonPrefix(protonPrefix)
        if (typeof steamPath === 'string') setLinuxSteamPath(steamPath)
        if (typeof extraEnv === 'string') setLinuxExtraEnv(extraEnv)
        if (prefixArch === 'win32') setLinuxPrefixArch('win32')
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
        setLinuxWinePrefix('')
        setLinuxProtonPrefix('')
        setLinuxSteamPath('')
        setLinuxExtraEnv('')
        setLinuxPrefixArch('win64')
        return
      }
      if (data.key === 'linuxLaunchMode' && data.value) {
        const next = String(data.value)
        if (['auto', 'native', 'wine', 'proton'].includes(next)) setLinuxLaunchMode(next as 'auto' | 'native' | 'wine' | 'proton')
      }
      if (data.key === 'linuxWinePath') setLinuxWinePath(data.value || '')
      if (data.key === 'linuxProtonPath') setLinuxProtonPath(data.value || '')
      if (data.key === 'linuxWinePrefix') setLinuxWinePrefix(data.value || '')
      if (data.key === 'linuxProtonPrefix') setLinuxProtonPrefix(data.value || '')
      if (data.key === 'linuxSteamPath') setLinuxSteamPath(data.value || '')
      if (data.key === 'linuxExtraEnv') setLinuxExtraEnv(data.value || '')
      if (data.key === 'linuxPrefixArch') setLinuxPrefixArch(data.value === 'win32' ? 'win32' : 'win64')
    })
    return () => {
      mounted = false
      if (typeof off === 'function') off()
    }
  }, [])

  // Load VR settings
  useEffect(() => {
    let mounted = true
    const loadVrSettings = async () => {
      try {
        const settings = await window.ucVR?.getSettings?.()
        if (!mounted || !settings?.ok) return
        setVrEnabled(Boolean(settings.vrEnabled))
        setVrSteamVrPath(settings.vrSteamVrPath || '')
        setVrXrRuntimeJson(settings.vrXrRuntimeJson || '')
        setVrSteamVrRuntime(settings.vrSteamVrRuntime || '')
        setVrExtraEnv(settings.vrExtraEnv || '')
        setVrAutoLaunchSteamVr(Boolean(settings.vrAutoLaunchSteamVr))
      } catch {}
    }
    loadVrSettings()
    const off = window.ucSettings?.onChanged?.((data: any) => {
      if (!data || !data.key) return
      if (data.key === '__CLEAR_ALL__') {
        setVrEnabled(false)
        setVrSteamVrPath('')
        setVrXrRuntimeJson('')
        setVrSteamVrRuntime('')
        setVrExtraEnv('')
        setVrAutoLaunchSteamVr(false)
        return
      }
      if (data.key === 'vrEnabled') setVrEnabled(Boolean(data.value))
      if (data.key === 'vrSteamVrPath') setVrSteamVrPath(data.value || '')
      if (data.key === 'vrXrRuntimeJson') setVrXrRuntimeJson(data.value || '')
      if (data.key === 'vrSteamVrRuntime') setVrSteamVrRuntime(data.value || '')
      if (data.key === 'vrExtraEnv') setVrExtraEnv(data.value || '')
      if (data.key === 'vrAutoLaunchSteamVr') setVrAutoLaunchSteamVr(Boolean(data.value))
    })
    return () => {
      mounted = false
      if (typeof off === 'function') off()
    }
  }, [])

  // Detect SteamVR and OpenXR on startup
  useEffect(() => {
    let mounted = true
    const detect = async () => {
      try {
        const [steamVrResult, openXrResult] = await Promise.allSettled([
          window.ucVR?.detectSteamVR?.(),
          window.ucVR?.detectOpenXR?.(),
        ])
        if (!mounted) return
        if (steamVrResult.status === 'fulfilled' && steamVrResult.value?.ok) {
          setVrDetected({ found: steamVrResult.value.found, dir: steamVrResult.value.dir })
          // Auto-fill SteamVR path if not set
          if (steamVrResult.value.found && steamVrResult.value.dir) {
            const stored = await window.ucSettings?.get?.('vrSteamVrPath')
            if (!stored && mounted) {
              setVrSteamVrPath(steamVrResult.value.dir)
            }
          }
        }
        if (openXrResult.status === 'fulfilled' && openXrResult.value?.ok) {
          setVrOpenXrDetected({ found: openXrResult.value.found, path: openXrResult.value.path })
          // Auto-fill XR runtime JSON if not set
          if (openXrResult.value.found && openXrResult.value.path) {
            const stored = await window.ucSettings?.get?.('vrXrRuntimeJson')
            if (!stored && mounted) {
              setVrXrRuntimeJson(openXrResult.value.path)
            }
          }
        }
      } catch {}
    }
    detect()
    return () => { mounted = false }
  }, [])

  // Detect Linux tools when on Linux
  useEffect(() => {
    if (!isLinux) return
    let mounted = true
    const detect = async () => {
      try {
        const [protonResult, wineResult, winetricksResult, protontricksResult, steamResult] = await Promise.allSettled([
          window.ucLinux?.detectProton?.(),
          window.ucLinux?.detectWine?.(),
          window.ucLinux?.checkTool?.('winetricks'),
          window.ucLinux?.checkTool?.('protontricks'),
          window.ucLinux?.getSteamPath?.(),
        ])
        if (!mounted) return
        if (protonResult.status === 'fulfilled' && protonResult.value?.ok) {
          setDetectedProtonVersions(protonResult.value.versions || [])
        }
        if (wineResult.status === 'fulfilled' && wineResult.value?.ok) {
          setDetectedWineVersions(wineResult.value.versions || [])
        }
        const availability: Record<string, boolean> = {}
        if (winetricksResult.status === 'fulfilled') availability.winetricks = Boolean(winetricksResult.value?.available)
        if (protontricksResult.status === 'fulfilled') availability.protontricks = Boolean(protontricksResult.value?.available)
        setLinuxToolAvailability(availability)
        if (steamResult.status === 'fulfilled' && steamResult.value?.ok && steamResult.value.path) {
          const storedSteam = await window.ucSettings?.get?.('linuxSteamPath')
          if (!storedSteam && mounted) {
            setLinuxSteamPath(steamResult.value.path)
          }
        }
      } catch {
        // ignore
      }
    }
    detect()
    return () => { mounted = false }
  }, [isLinux])

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
        const hideNsfw = await window.ucSettings?.get?.('rpcHideNsfw')
        const showGameName = await window.ucSettings?.get?.('rpcShowGameName')
        const showStatus = await window.ucSettings?.get?.('rpcShowStatus')
        const showButtons = await window.ucSettings?.get?.('rpcShowButtons')
        if (!mounted) return
        setDiscordRpcEnabled(enabled !== false)
        setRpcHideNsfw(hideNsfw !== false)
        setRpcShowGameName(showGameName !== false)
        setRpcShowStatus(showStatus !== false)
        setRpcShowButtons(showButtons !== false)
      } catch {
        // ignore
      }
    }
    loadRpcSettings()
    const off = window.ucSettings?.onChanged?.((data: any) => {
      if (!data || !data.key) return
      if (data.key === '__CLEAR_ALL__') {
        setDiscordRpcEnabled(true)
        setRpcHideNsfw(true)
        setRpcShowGameName(true)
        setRpcShowStatus(true)
        setRpcShowButtons(true)
        return
      }
      if (data.key === 'discordRpcEnabled') setDiscordRpcEnabled(data.value !== false)
      if (data.key === 'rpcHideNsfw') setRpcHideNsfw(data.value !== false)
      if (data.key === 'rpcShowGameName') setRpcShowGameName(data.value !== false)
      if (data.key === 'rpcShowStatus') setRpcShowStatus(data.value !== false)
      if (data.key === 'rpcShowButtons') setRpcShowButtons(data.value !== false)
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
        const verbose = await window.ucSettings?.get?.('verboseDownloadLogging')
        if (!mounted) return
        setDeveloperMode(devMode || false)
        setVerboseDownloadLogging(Boolean(verbose))
      } catch {
        // ignore
      }
    }
    loadDeveloperSettings()
    const off = window.ucSettings?.onChanged?.((data: any) => {
      if (!data || !data.key) return
      if (data.key === '__CLEAR_ALL__') {
        setDeveloperMode(false)
        setVerboseDownloadLogging(false)
        return
      }
      if (data.key === 'developerMode') {
        setDeveloperMode(data.value || false)
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

  useEffect(() => {
    let mounted = true
    const loadSkipLinkCheck = async () => {
      try {
        const value = await window.ucSettings?.get?.('skipLinkCheck')
        if (mounted) setSkipLinkCheck(Boolean(value))
      } catch {}
    }
    loadSkipLinkCheck()
    const off = window.ucSettings?.onChanged?.((data: any) => {
      if (!data || !data.key) return
      if (data.key === 'skipLinkCheck') setSkipLinkCheck(Boolean(data.value))
      if (data.key === '__CLEAR_ALL__') setSkipLinkCheck(false)
    })
    return () => {
      mounted = false
      if (typeof off === 'function') off()
    }
  }, [])

  const selectedDisk = useMemo((): DiskInfo | null => {
    const found = disks.find((d: DiskInfo) => d.id === selectedDiskId)
    return found || null
  }, [disks, selectedDiskId])
  const diskForUsage = useMemo((): DiskInfo | null => {
    if (selectedDisk) return selectedDisk
    if (!downloadPath) return null
    const found = disks.find((d: DiskInfo) => downloadPath.startsWith(d.path))
    return found || null
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
    const disk = disks.find((item: DiskInfo) => item.id === diskId)
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
      const platformValue = typeof navigator !== 'undefined' ? navigator.platform : 'unknown'
      const userAgentValue = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'

      const diagnostics = [
        `Version: ${version || 'unknown'}`,
        `Platform: ${platformValue}`,
        `User Agent: ${userAgentValue}`,
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
      const result = await window.ucSettings?.runNetworkTest?.(getApiBaseUrl())
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
      if (result?.ok) {
        setDevActionFeedback({ type: 'success', message: 'Settings exported.' })
      } else if (result?.error && result.error !== 'cancelled') {
        setDevActionFeedback({ type: 'error', message: result.error || 'Failed to export settings.' })
      }
    } catch (err) {
      setDevActionFeedback({ type: 'error', message: 'Failed to export settings.' })
    } finally {
      setTimeout(() => setDevActionFeedback(null), 4000)
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

  useEffect(() => {
    const syncPreferences = () => {
      try {
        setShowMika(localStorage.getItem(SETTINGS_KEYS.MIKA) !== "1")
        setShowNsfw(localStorage.getItem(SETTINGS_KEYS.NSFW) === "1")
        setShowPublicProfile(localStorage.getItem(SETTINGS_KEYS.PUBLIC_PROFILE) !== "0")
      } catch {
        // ignore
      }
    }

    syncPreferences()

    const onStorage = (event: StorageEvent) => {
      if ([SETTINGS_KEYS.MIKA, SETTINGS_KEYS.NSFW, SETTINGS_KEYS.PUBLIC_PROFILE].includes(event.key as any)) {
        syncPreferences()
      }
    }
    const onPreferenceChange = () => syncPreferences()

    window.addEventListener("storage", onStorage)
    window.addEventListener("uc_mika_pref", onPreferenceChange)
    window.addEventListener("uc_nsfw_pref", onPreferenceChange)

    return () => {
      window.removeEventListener("storage", onStorage)
      window.removeEventListener("uc_mika_pref", onPreferenceChange)
      window.removeEventListener("uc_nsfw_pref", onPreferenceChange)
    }
  }, [])

  useEffect(() => {
    if (!accountUser || !authenticated) return
    setBioDraft(accountUser.bio ?? "")
    setBioSaved(false)
  }, [accountUser, authenticated])

  useEffect(() => {
    if (accountUser && authenticated) return
    setAccountSummaryLoaded(false)
    setAccountError(null)
  }, [accountUser, authenticated])

  const loadAccountSummary = async (retrySession = true) => {
    if (!accountUser || !authenticated) return
    setAccountError(null)
    try {
      let res = await apiFetch("/api/account/summary")
      if (res.status === 401 && retrySession) {
        const sessionRes = await apiFetch("/api/comments/session", { method: "POST" })
        if (sessionRes.ok) {
          res = await apiFetch("/api/account/summary")
        }
      }
      if (!res.ok) {
        setAccountError("Unable to load account settings.")
        return
      }
      const data = await res.json()
      const prefs = data?.preferences || {}
      if (typeof prefs.showMika === "boolean") {
        setShowMika(prefs.showMika)
        try {
          localStorage.setItem(SETTINGS_KEYS.MIKA, prefs.showMika ? "0" : "1")
        } catch {}
        window.dispatchEvent(new Event("uc_mika_pref"))
      }
      if (typeof prefs.showNsfw === "boolean") {
        setShowNsfw(prefs.showNsfw)
        try {
          localStorage.setItem(SETTINGS_KEYS.NSFW, prefs.showNsfw ? "1" : "0")
        } catch {}
        window.dispatchEvent(new Event("uc_nsfw_pref"))
      }
      if (typeof prefs.showPublicProfile === "boolean") {
        setShowPublicProfile(prefs.showPublicProfile)
        try {
          localStorage.setItem(SETTINGS_KEYS.PUBLIC_PROFILE, prefs.showPublicProfile ? "1" : "0")
        } catch {}
      }
      
      // Load RPC preferences from account
      if (typeof prefs.rpcHideNsfw === "boolean") {
        setRpcHideNsfw(prefs.rpcHideNsfw)
        try {
          await window.ucSettings?.set?.('rpcHideNsfw', prefs.rpcHideNsfw)
        } catch {}
      }
      if (typeof prefs.rpcShowGameName === "boolean") {
        setRpcShowGameName(prefs.rpcShowGameName)
        try {
          await window.ucSettings?.set?.('rpcShowGameName', prefs.rpcShowGameName)
        } catch {}
      }
      if (typeof prefs.rpcShowStatus === "boolean") {
        setRpcShowStatus(prefs.rpcShowStatus)
        try {
          await window.ucSettings?.set?.('rpcShowStatus', prefs.rpcShowStatus)
        } catch {}
      }
      if (typeof prefs.rpcShowButtons === "boolean") {
        setRpcShowButtons(prefs.rpcShowButtons)
        try {
          await window.ucSettings?.set?.('rpcShowButtons', prefs.rpcShowButtons)
        } catch {}
      }

      const summaryUser = data?.user
      if (summaryUser?.bio !== undefined) {
        setBioDraft(summaryUser.bio ?? "")
        setBioSaved(false)
      }

      setAccountSummaryLoaded(true)
    } catch {
      setAccountError("Unable to load account settings.")
    }
  }

  useEffect(() => {
    if (!accountUser || !authenticated || accountSummaryLoaded) return
    void loadAccountSummary()
  }, [accountUser, authenticated, accountSummaryLoaded])

  const refreshAccountSummary = async () => {
    if (!accountUser || !authenticated) return
    setAccountRefreshing(true)
    await refreshAccount().catch(() => {})
    await loadAccountSummary().catch(() => {})
    setAccountRefreshing(false)
  }

  const handleAccountLogin = async () => {
    setLoggingIn(true)
    try {
      if (window.ucAuth?.login) {
        const result = await window.ucAuth.login(getApiBaseUrl())
        if (result?.ok) {
          await apiFetch("/api/comments/session", { method: "POST" })
          await refreshAccount().catch(() => {})
          await loadAccountSummary().catch(() => {})
        }
      } else {
        window.open(apiUrl("/api/discord/connect?next=/settings"), "_blank")
      }
    } finally {
      setLoggingIn(false)
    }
  }

  const handleAccountLogout = async () => {
    setLoggingOut(true)
    try {
      await apiFetch("/api/comments/session", { method: "DELETE" })
      await window.ucAuth?.logout?.(getApiBaseUrl())
      try {
        localStorage.removeItem("discord_id")
      } catch {}
      window.dispatchEvent(new Event("uc_discord_logout"))
      setAccountSummaryLoaded(false)
      setBioDraft("")
      setBioSaved(false)
    } catch {
      // keep current state if logout fails
    } finally {
      await refreshAccount().catch(() => {})
      setLoggingOut(false)
    }
  }

  const updateMikaVisibility = (checked: boolean) => {
    setShowMika(checked)
    try {
      localStorage.setItem(SETTINGS_KEYS.MIKA, checked ? "0" : "1")
    } catch {}
    window.dispatchEvent(new Event("uc_mika_pref"))
    apiFetch("/api/account/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showMika: checked }),
    }).catch(() => {})
  }

  const updateNsfwVisibility = (checked: boolean) => {
    setShowNsfw(checked)
    try {
      localStorage.setItem(SETTINGS_KEYS.NSFW, checked ? "1" : "0")
    } catch {}
    window.dispatchEvent(new Event("uc_nsfw_pref"))
    apiFetch("/api/account/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showNsfw: checked }),
    }).catch(() => {})
  }

  const updatePublicProfileVisibility = (checked: boolean) => {
    setShowPublicProfile(checked)
    try {
      localStorage.setItem(SETTINGS_KEYS.PUBLIC_PROFILE, checked ? "1" : "0")
    } catch {}
    apiFetch("/api/account/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showPublicProfile: checked }),
    }).catch(() => {})
  }

  const updateRpcHideNsfw = (checked: boolean) => {
    window.ucSettings?.set?.('rpcHideNsfw', checked).catch(() => {})
    apiFetch("/api/account/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rpcHideNsfw: checked }),
    }).catch(() => {})
  }

  const updateRpcShowGameName = (checked: boolean) => {
    window.ucSettings?.set?.('rpcShowGameName', checked).catch(() => {})
    apiFetch("/api/account/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rpcShowGameName: checked }),
    }).catch(() => {})
  }

  const updateRpcShowStatus = (checked: boolean) => {
    window.ucSettings?.set?.('rpcShowStatus', checked).catch(() => {})
    apiFetch("/api/account/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rpcShowStatus: checked }),
    }).catch(() => {})
  }

  const updateRpcShowButtons = (checked: boolean) => {
    window.ucSettings?.set?.('rpcShowButtons', checked).catch(() => {})
    apiFetch("/api/account/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rpcShowButtons: checked }),
    }).catch(() => {})
  }

  const saveBio = async () => {
    if (!accountUser) return
    setBioSaving(true)
    setBioSaved(false)
    try {
      const res = await apiFetch("/api/account/bio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bio: bioDraft.trim().slice(0, TEXT_CONSTRAINTS.MAX_BIO_LENGTH) }),
      })
      if (res.ok) {
        setBioSaved(true)
        await refreshAccount().catch(() => {})
      }
    } catch {
      // ignore
    } finally {
      setBioSaving(false)
    }
  }

  // Linux tool helpers
  const linuxToolFeedbackShow = (type: 'success' | 'error', message: string) => {
    setLinuxToolFeedback({ type, message })
    setTimeout(() => setLinuxToolFeedback(null), 4000)
  }

  const handleRunWinecfg = async () => {
    if (linuxToolRunning) return
    setLinuxToolRunning('winecfg')
    try {
      const result = await window.ucLinux?.runWinecfg?.()
      if (result?.ok) {
        linuxToolFeedbackShow('success', 'winecfg launched.')
      } else {
        linuxToolFeedbackShow('error', result?.error || 'Failed to launch winecfg.')
      }
    } catch {
      linuxToolFeedbackShow('error', 'Failed to launch winecfg.')
    } finally {
      setLinuxToolRunning(null)
    }
  }

  const handleRunWinetricks = async () => {
    if (linuxToolRunning) return
    setLinuxToolRunning('winetricks')
    try {
      const packages = linuxWinetricksInput.trim().split(/\s+/).filter(Boolean)
      const result = await window.ucLinux?.runWinetricks?.(packages.length ? packages : undefined)
      if (result?.ok) {
        linuxToolFeedbackShow('success', packages.length ? `winetricks launched with: ${packages.join(' ')}` : 'winetricks launched.')
      } else {
        linuxToolFeedbackShow('error', result?.error || 'Failed to launch winetricks.')
      }
    } catch {
      linuxToolFeedbackShow('error', 'Failed to launch winetricks.')
    } finally {
      setLinuxToolRunning(null)
    }
  }

  const handleRunProtontricks = async () => {
    if (linuxToolRunning) return
    setLinuxToolRunning('protontricks')
    try {
      const packages = linuxProtontricksInput.trim().split(/\s+/).filter(Boolean)
      const result = await window.ucLinux?.runProtontricks?.(linuxProtontricksAppId.trim() || undefined, packages.length ? packages : undefined)
      if (result?.ok) {
        linuxToolFeedbackShow('success', 'protontricks launched.')
      } else {
        linuxToolFeedbackShow('error', result?.error || 'Failed to launch protontricks.')
      }
    } catch {
      linuxToolFeedbackShow('error', 'Failed to launch protontricks.')
    } finally {
      setLinuxToolRunning(null)
    }
  }

  const handleCreateWinePrefix = async () => {
    if (linuxToolRunning) return
    if (!linuxWinePrefix.trim()) {
      linuxToolFeedbackShow('error', 'Set a WINEPREFIX path first.')
      return
    }
    setLinuxToolRunning('create-prefix')
    try {
      const result = await window.ucLinux?.createPrefix?.(linuxWinePrefix.trim(), linuxPrefixArch)
      if (result?.ok) {
        linuxToolFeedbackShow('success', `WINEPREFIX initialized at ${linuxWinePrefix.trim()}`)
      } else {
        linuxToolFeedbackShow('error', result?.error || 'Failed to initialize WINEPREFIX.')
      }
    } catch {
      linuxToolFeedbackShow('error', 'Failed to initialize WINEPREFIX.')
    } finally {
      setLinuxToolRunning(null)
    }
  }

  const handlePickWinePrefix = async () => {
    const result = await window.ucLinux?.pickPrefixDir?.()
    if (result?.ok && result.path) {
      setLinuxWinePrefix(result.path)
      await window.ucSettings?.set?.('linuxWinePrefix', result.path).catch(() => {})
    }
  }

  const handlePickProtonPrefix = async () => {
    const result = await window.ucLinux?.pickPrefixDir?.()
    if (result?.ok && result.path) {
      setLinuxProtonPrefix(result.path)
      await window.ucSettings?.set?.('linuxProtonPrefix', result.path).catch(() => {})
    }
  }

  const handlePickWineBinary = async () => {
    const result = await window.ucLinux?.pickBinary?.()
    if (result?.ok && result.path) {
      setLinuxWinePath(result.path)
      await window.ucSettings?.set?.('linuxWinePath', result.path).catch(() => {})
    }
  }

  const handlePickProtonBinary = async () => {
    const result = await window.ucLinux?.pickBinary?.()
    if (result?.ok && result.path) {
      setLinuxProtonPath(result.path)
      await window.ucSettings?.set?.('linuxProtonPath', result.path).catch(() => {})
    }
  }

  // VR helpers
  const vrToolFeedbackShow = (type: 'success' | 'error', message: string) => {
    setVrToolFeedback({ type, message })
    setTimeout(() => setVrToolFeedback(null), 4000)
  }

  const handleLaunchSteamVR = async () => {
    if (vrToolRunning) return
    setVrToolRunning(true)
    try {
      const result = await window.ucVR?.launchSteamVR?.()
      if (result?.ok) {
        vrToolFeedbackShow('success', 'SteamVR launched.')
      } else {
        vrToolFeedbackShow('error', result?.error || 'Failed to launch SteamVR.')
      }
    } catch {
      vrToolFeedbackShow('error', 'Failed to launch SteamVR.')
    } finally {
      setVrToolRunning(false)
    }
  }

  const handlePickSteamVRDir = async () => {
    const result = await window.ucVR?.pickSteamVRDir?.()
    if (result?.ok && result.path) {
      setVrSteamVrPath(result.path)
      await window.ucSettings?.set?.('vrSteamVrPath', result.path).catch(() => {})
    }
  }

  const handlePickXrRuntimeJson = async () => {
    const result = await window.ucVR?.pickRuntimeJson?.()
    if (result?.ok && result.path) {
      setVrXrRuntimeJson(result.path)
      await window.ucSettings?.set?.('vrXrRuntimeJson', result.path).catch(() => {})
    }
  }

  const accountLabel = accountUser ? accountUser.displayName || accountUser.username : "Account"
  const accountAvatarUrl = accountUser?.avatarUrl || null
  const showAccountControls = Boolean(accountUser && authenticated)
  const accountBusy = accountLoading || loggingIn || loggingOut || accountRefreshing

  return (
    <div className="container mx-auto max-w-5xl space-y-8">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl sm:text-3xl font-black font-montserrat">Settings</h1>
        <Badge className="rounded-full bg-primary/15 text-primary border-primary/20">UnionCrax.Direct</Badge>
      </div>

      <Card className="border-border/60">
        <CardContent className="p-6 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Account</h2>
              <p className="text-sm text-muted-foreground">
                Manage your Discord profile and preferences right inside the app.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {showAccountControls ? (
                <>
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={refreshAccountSummary}
                    disabled={accountBusy}
                  >
                    <RefreshCw className={`h-4 w-4 ${accountRefreshing ? "animate-spin" : ""}`} />
                    {accountRefreshing ? "Refreshing..." : "Refresh"}
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={handleAccountLogout}
                    disabled={accountBusy}
                  >
                    <LogOut className="h-4 w-4" />
                    {loggingOut ? "Signing out..." : "Logout"}
                  </Button>
                </>
              ) : (
                <Button className="gap-2" onClick={handleAccountLogin} disabled={accountBusy}>
                  <LogIn className="h-4 w-4" />
                  {loggingIn ? "Connecting..." : "Login with Discord"}
                </Button>
              )}
            </div>
          </div>

          {accountError && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {accountError}
            </div>
          )}

          <div className="flex items-center gap-4">
            <DiscordAvatar avatarUrl={accountAvatarUrl} alt="Account avatar" className="h-12 w-12 rounded-full" />
            <div>
              <div className="text-sm font-semibold text-foreground">{accountLabel}</div>
              <div className="text-xs text-muted-foreground">Discord account</div>
            </div>
          </div>

          {showAccountControls && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-border/60 bg-card/50 p-4 space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <UserRound className="h-4 w-4 text-primary" />
                  Preferences
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">NSFW hover reveal</div>
                      <div className="text-xs text-muted-foreground">Allow NSFW covers to unblur on hover.</div>
                    </div>
                    <Switch checked={showNsfw} onCheckedChange={updateNsfwVisibility} />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">Show Mika art</div>
                      <div className="text-xs text-muted-foreground">Hide the Mika mascot artwork.</div>
                    </div>
                    <Switch checked={showMika} onCheckedChange={updateMikaVisibility} />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">Public profile</div>
                      <div className="text-xs text-muted-foreground">Let others view your profile page.</div>
                    </div>
                    <Switch checked={showPublicProfile} onCheckedChange={updatePublicProfileVisibility} />
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border/60 bg-card/50 p-4 space-y-3 md:col-span-2">
                <div className="text-sm font-semibold">Profile bio</div>
                <Textarea
                  value={bioDraft}
                  onChange={(event) => {
                    const next = event.target.value.slice(0, TEXT_CONSTRAINTS.MAX_BIO_LENGTH)
                    setBioDraft(next)
                    setBioSaved(false)
                  }}
                  maxLength={TEXT_CONSTRAINTS.MAX_BIO_LENGTH}
                  rows={4}
                  placeholder={showAccountControls ? "Share something about you..." : "Login to edit your bio"}
                  disabled={!showAccountControls || accountBusy}
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{bioDraft.length}/{TEXT_CONSTRAINTS.MAX_BIO_LENGTH} characters</span>
                  {bioSaved ? <span className="text-primary">Saved</span> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2"
                    onClick={saveBio}
                    disabled={!showAccountControls || bioSaving || accountBusy}
                  >
                    {bioSaving ? "Saving..." : "Save bio"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="gap-2"
                    onClick={() => setBioDraft(accountUser?.bio ?? "")}
                    disabled={!showAccountControls || accountBusy}
                  >
                    Reset
                  </Button>
                </div>
              </div>


            </div>
          )}
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

            <button
              onClick={() => setShowRpcAdvanced(!showRpcAdvanced)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mt-4"
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${
                showRpcAdvanced ? 'rotate-180' : ''
              }`} />
              Advanced options
            </button>

            {showRpcAdvanced && discordRpcEnabled && (
              <div className="mt-4 space-y-3 rounded-lg border border-border/60 bg-card/50 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Hide NSFW content</div>
                    <div className="text-xs text-muted-foreground">Don't show RPC when viewing or downloading NSFW games</div>
                  </div>
                  <button
                    onClick={() => {
                      const newValue = !rpcHideNsfw
                      setRpcHideNsfw(newValue)
                      updateRpcHideNsfw(newValue)
                    }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      rpcHideNsfw ? 'bg-primary' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        rpcHideNsfw ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Show game name</div>
                    <div className="text-xs text-muted-foreground">Display the game title in your status</div>
                  </div>
                  <button
                    onClick={() => {
                      const newValue = !rpcShowGameName
                      setRpcShowGameName(newValue)
                      updateRpcShowGameName(newValue)
                    }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      rpcShowGameName ? 'bg-primary' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        rpcShowGameName ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Show activity status</div>
                    <div className="text-xs text-muted-foreground">Display what you're doing (downloading, playing, browsing)</div>
                  </div>
                  <button
                    onClick={() => {
                      const newValue = !rpcShowStatus
                      setRpcShowStatus(newValue)
                      updateRpcShowStatus(newValue)
                    }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      rpcShowStatus ? 'bg-primary' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        rpcShowStatus ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Show buttons</div>
                    <div className="text-xs text-muted-foreground">Display "Open on web" and "Download UC.D" buttons</div>
                  </div>
                  <button
                    onClick={() => {
                      const newValue = !rpcShowButtons
                      setRpcShowButtons(newValue)
                      updateRpcShowButtons(newValue)
                    }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      rpcShowButtons ? 'bg-primary' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        rpcShowButtons ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            )}

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
                            h.tag === 'beta' ? 'bg-amber-100 text-amber-800' : h.tag === 'retiring' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-800'
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
            {MIRROR_HOSTS.find((h) => h.key === defaultHost)?.supportsResume === false && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Download resuming is currently not supported for this host. Please do not close the app while
                downloading with {MIRROR_HOSTS.find((h) => h.key === defaultHost)?.label || defaultHost}.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardContent className="p-6 space-y-6">
          <div>
            <h2 className="text-lg font-semibold">Download checks</h2>
            <p className="text-sm text-muted-foreground">Configure pre-download link verification.</p>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium cursor-pointer">Skip link availability check</label>
                <p className="text-xs text-muted-foreground mt-1">
                  Download immediately without checking if links are alive first
                </p>
              </div>
              <button
                onClick={async () => {
                  const current = await window.ucSettings?.get?.('skipLinkCheck')
                  const newValue = !current
                  setSkipLinkCheck(newValue)
                  try {
                    await window.ucSettings?.set?.('skipLinkCheck', newValue)
                  } catch {}
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  skipLinkCheck ? 'bg-primary' : 'bg-slate-700'
                }`}
                title="Toggle skip link check"
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    skipLinkCheck ? 'translate-x-6' : 'translate-x-1'
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
              <div className="rounded-xl border border-border/60 bg-muted/30 p-4 space-y-4">
                {/* Header */}
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-primary" />
                  <div>
                    <div className="text-sm font-semibold">Linux Gaming</div>
                    <div className="text-xs text-muted-foreground">Configure Wine, Proton, and compatibility tools for running Windows games on Linux.</div>
                  </div>
                </div>

                {/* Launch Mode */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Launch Mode</label>
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
                      <SelectItem value="proton">Proton (Steam)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Wine Binary */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Wine Binary</label>
                  <div className="flex gap-2">
                    <Input
                      value={linuxWinePath}
                      onChange={(e) => setLinuxWinePath(e.target.value)}
                      onBlur={async () => {
                        try { await window.ucSettings?.set?.('linuxWinePath', linuxWinePath) } catch {}
                      }}
                      placeholder="wine"
                      className="flex-1"
                    />
                    <Button variant="outline" size="sm" onClick={handlePickWineBinary} title="Browse for wine binary">
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                  </div>
                  {detectedWineVersions.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {detectedWineVersions.slice(0, 4).map((v) => (
                        <button
                          key={v.path}
                          type="button"
                          onClick={async () => {
                            setLinuxWinePath(v.path)
                            await window.ucSettings?.set?.('linuxWinePath', v.path).catch(() => {})
                          }}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
                        >
                          {v.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Proton Binary */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Proton Script</label>
                  <div className="flex gap-2">
                    <Input
                      value={linuxProtonPath}
                      onChange={(e) => setLinuxProtonPath(e.target.value)}
                      onBlur={async () => {
                        try { await window.ucSettings?.set?.('linuxProtonPath', linuxProtonPath) } catch {}
                      }}
                      placeholder="~/.steam/steam/steamapps/common/Proton 9.0/proton"
                      className="flex-1"
                    />
                    <Button variant="outline" size="sm" onClick={handlePickProtonBinary} title="Browse for proton script">
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                  </div>
                  {detectedProtonVersions.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {detectedProtonVersions.map((v) => (
                        <button
                          key={v.path}
                          type="button"
                          onClick={async () => {
                            setLinuxProtonPath(v.path)
                            await window.ucSettings?.set?.('linuxProtonPath', v.path).catch(() => {})
                          }}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
                        >
                          {v.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* WINEPREFIX */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">WINEPREFIX</label>
                  <div className="flex gap-2">
                    <Input
                      value={linuxWinePrefix}
                      onChange={(e) => setLinuxWinePrefix(e.target.value)}
                      onBlur={async () => {
                        try { await window.ucSettings?.set?.('linuxWinePrefix', linuxWinePrefix) } catch {}
                      }}
                      placeholder="~/.wine  (leave empty for default)"
                      className="flex-1"
                    />
                    <Button variant="outline" size="sm" onClick={handlePickWinePrefix} title="Browse for WINEPREFIX directory">
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Select value={linuxPrefixArch} onValueChange={(v) => {
                      setLinuxPrefixArch(v as 'win64' | 'win32')
                      window.ucSettings?.set?.('linuxPrefixArch', v).catch(() => {})
                    }}>
                      <SelectTrigger className="h-7 w-24 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="win64">64-bit</SelectItem>
                        <SelectItem value="win32">32-bit</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={handleCreateWinePrefix}
                      disabled={linuxToolRunning === 'create-prefix' || !linuxWinePrefix.trim()}
                    >
                      {linuxToolRunning === 'create-prefix' ? 'Initializing...' : 'Initialize prefix'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={handleRunWinecfg}
                      disabled={linuxToolRunning === 'winecfg'}
                    >
                      {linuxToolRunning === 'winecfg' ? 'Opening...' : 'winecfg'}
                    </Button>
                  </div>
                </div>

                {/* Proton Prefix (STEAM_COMPAT_DATA_PATH) */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Proton Prefix <span className="normal-case">(STEAM_COMPAT_DATA_PATH)</span></label>
                  <div className="flex gap-2">
                    <Input
                      value={linuxProtonPrefix}
                      onChange={(e) => setLinuxProtonPrefix(e.target.value)}
                      onBlur={async () => {
                        try { await window.ucSettings?.set?.('linuxProtonPrefix', linuxProtonPrefix) } catch {}
                      }}
                      placeholder="~/.steam/steam/steamapps/compatdata/12345"
                      className="flex-1"
                    />
                    <Button variant="outline" size="sm" onClick={handlePickProtonPrefix} title="Browse for Proton prefix directory">
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Steam Path */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Steam Install Path <span className="normal-case">(STEAM_COMPAT_CLIENT_INSTALL_PATH)</span></label>
                  <Input
                    value={linuxSteamPath}
                    onChange={(e) => setLinuxSteamPath(e.target.value)}
                    onBlur={async () => {
                      try { await window.ucSettings?.set?.('linuxSteamPath', linuxSteamPath) } catch {}
                    }}
                    placeholder="~/.steam/steam"
                  />
                </div>

                {/* Advanced toggle */}
                <button
                  onClick={() => setShowLinuxAdvanced(!showLinuxAdvanced)}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronDown className={`h-4 w-4 transition-transform ${showLinuxAdvanced ? 'rotate-180' : ''}`} />
                  Advanced tools & environment
                </button>

                {showLinuxAdvanced && (
                  <div className="space-y-4 rounded-lg border border-border/60 bg-card/50 p-4">

                    {/* Extra environment variables */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
                        <label className="text-xs font-medium">Extra environment variables</label>
                      </div>
                      <p className="text-xs text-muted-foreground">One per line, format: <code className="font-mono bg-muted/50 px-1 rounded">KEY=VALUE</code>. Applied to every game launch.</p>
                      <textarea
                        value={linuxExtraEnv}
                        onChange={(e) => setLinuxExtraEnv(e.target.value)}
                        onBlur={async () => {
                          try { await window.ucSettings?.set?.('linuxExtraEnv', linuxExtraEnv) } catch {}
                        }}
                        rows={4}
                        placeholder={"DXVK_HUD=fps\nMESA_GL_VERSION_OVERRIDE=4.5\n# WINEDEBUG=-all"}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y"
                      />
                    </div>

                    {/* Winetricks */}
                    <div className="space-y-2 border-t border-border/40 pt-4">
                      <div className="flex items-center gap-2">
                        <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />
                        <label className="text-xs font-medium">winetricks</label>
                        {linuxToolAvailability.winetricks === false && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/20 text-destructive border border-destructive/30">not found</span>
                        )}
                        {linuxToolAvailability.winetricks === true && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">available</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">Install Windows components into your WINEPREFIX (e.g. <code className="font-mono bg-muted/50 px-1 rounded">vcrun2019 d3dx9</code>).</p>
                      <div className="flex gap-2">
                        <Input
                          value={linuxWinetricksInput}
                          onChange={(e) => setLinuxWinetricksInput(e.target.value)}
                          placeholder="vcrun2019 d3dx9 dotnet48 ..."
                          className="flex-1 text-xs"
                          onKeyDown={(e) => { if (e.key === 'Enter') handleRunWinetricks() }}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleRunWinetricks}
                          disabled={linuxToolRunning === 'winetricks'}
                        >
                          {linuxToolRunning === 'winetricks' ? 'Running...' : 'Run'}
                        </Button>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs h-7"
                        onClick={async () => {
                          setLinuxWinetricksInput('')
                          setLinuxToolRunning('winetricks')
                          try {
                            const result = await window.ucLinux?.runWinetricks?.([])
                            if (result?.ok) linuxToolFeedbackShow('success', 'winetricks GUI launched.')
                            else linuxToolFeedbackShow('error', result?.error || 'Failed to launch winetricks.')
                          } catch { linuxToolFeedbackShow('error', 'Failed to launch winetricks.') }
                          finally { setLinuxToolRunning(null) }
                        }}
                        disabled={linuxToolRunning === 'winetricks'}
                      >
                        Open winetricks GUI
                      </Button>
                    </div>

                    {/* Protontricks */}
                    <div className="space-y-2 border-t border-border/40 pt-4">
                      <div className="flex items-center gap-2">
                        <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />
                        <label className="text-xs font-medium">protontricks</label>
                        {linuxToolAvailability.protontricks === false && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/20 text-destructive border border-destructive/30">not found</span>
                        )}
                        {linuxToolAvailability.protontricks === true && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">available</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">Install components into a Proton prefix by Steam App ID (e.g. <code className="font-mono bg-muted/50 px-1 rounded">12345 vcrun2019</code>).</p>
                      <div className="flex gap-2">
                        <Input
                          value={linuxProtontricksAppId}
                          onChange={(e) => setLinuxProtontricksAppId(e.target.value)}
                          placeholder="Steam App ID"
                          className="w-32 text-xs"
                        />
                        <Input
                          value={linuxProtontricksInput}
                          onChange={(e) => setLinuxProtontricksInput(e.target.value)}
                          placeholder="vcrun2019 d3dx9 ..."
                          className="flex-1 text-xs"
                          onKeyDown={(e) => { if (e.key === 'Enter') handleRunProtontricks() }}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleRunProtontricks}
                          disabled={linuxToolRunning === 'protontricks'}
                        >
                          {linuxToolRunning === 'protontricks' ? 'Running...' : 'Run'}
                        </Button>
                      </div>
                    </div>

                    {/* Tool feedback */}
                    {linuxToolFeedback && (
                      <div className={`text-xs rounded-md px-3 py-2 ${linuxToolFeedback.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-destructive/10 text-destructive border border-destructive/30'}`}>
                        {linuxToolFeedback.message}
                      </div>
                    )}
                  </div>
                )}

                {/* Inline feedback when advanced is closed */}
                {!showLinuxAdvanced && linuxToolFeedback && (
                  <div className={`text-xs rounded-md px-3 py-2 ${linuxToolFeedback.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-destructive/10 text-destructive border border-destructive/30'}`}>
                    {linuxToolFeedback.message}
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardContent className="p-6 space-y-6">
          <div>
            <h2 className="text-lg font-semibold">VR / SteamVR</h2>
            <p className="text-sm text-muted-foreground">
              Configure SteamVR and OpenXR settings for VR game launches.
            </p>
          </div>

          {/* Enable VR toggle */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium cursor-pointer">Enable VR support</label>
              <p className="text-xs text-muted-foreground mt-1">
                Apply VR environment variables (XR_RUNTIME_JSON, STEAM_VR_RUNTIME) when launching games.
              </p>
            </div>
            <button
              onClick={async () => {
                const newValue = !vrEnabled
                setVrEnabled(newValue)
                try { await window.ucSettings?.set?.('vrEnabled', newValue) } catch {}
              }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${vrEnabled ? 'bg-primary' : 'bg-slate-700'}`}
              title="Toggle VR support"
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${vrEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          {/* Detection status */}
          <div className="flex flex-wrap gap-2">
            {vrDetected !== null && (
              <span className={`text-[11px] px-2 py-1 rounded-full border ${vrDetected.found ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-muted/30 text-muted-foreground border-border/40'}`}>
                SteamVR: {vrDetected.found ? `found${vrDetected.dir ? ` (${vrDetected.dir.split('/').pop()})` : ''}` : 'not found'}
              </span>
            )}
            {vrOpenXrDetected !== null && (
              <span className={`text-[11px] px-2 py-1 rounded-full border ${vrOpenXrDetected.found ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-muted/30 text-muted-foreground border-border/40'}`}>
                OpenXR: {vrOpenXrDetected.found ? 'runtime found' : 'not found'}
              </span>
            )}
          </div>

          {/* Launch SteamVR button */}
          <div className="flex flex-wrap gap-2 items-center">
            <Button
              variant="outline"
              className="gap-2"
              onClick={handleLaunchSteamVR}
              disabled={vrToolRunning}
            >
              {vrToolRunning ? 'Launching...' : 'Launch SteamVR'}
            </Button>
            {vrToolFeedback && (
              <span className={`text-xs ${vrToolFeedback.type === 'success' ? 'text-emerald-400' : 'text-destructive'}`}>
                {vrToolFeedback.message}
              </span>
            )}
          </div>

          {/* Auto-launch SteamVR toggle */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium cursor-pointer">Auto-launch SteamVR with VR games</label>
              <p className="text-xs text-muted-foreground mt-1">
                Automatically start SteamVR before launching a VR game.
              </p>
            </div>
            <button
              onClick={async () => {
                const newValue = !vrAutoLaunchSteamVr
                setVrAutoLaunchSteamVr(newValue)
                try { await window.ucSettings?.set?.('vrAutoLaunchSteamVr', newValue) } catch {}
              }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${vrAutoLaunchSteamVr ? 'bg-primary' : 'bg-slate-700'}`}
              title="Toggle auto-launch SteamVR"
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${vrAutoLaunchSteamVr ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          {/* Advanced toggle */}
          <button
            onClick={() => setShowVrAdvanced(!showVrAdvanced)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${showVrAdvanced ? 'rotate-180' : ''}`} />
            Advanced VR settings
          </button>

          {showVrAdvanced && (
            <div className="space-y-4 rounded-lg border border-border/60 bg-card/50 p-4">

              {/* SteamVR directory */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">SteamVR Directory</label>
                <div className="flex gap-2">
                  <Input
                    value={vrSteamVrPath}
                    onChange={(e) => setVrSteamVrPath(e.target.value)}
                    onBlur={async () => {
                      try { await window.ucSettings?.set?.('vrSteamVrPath', vrSteamVrPath) } catch {}
                    }}
                    placeholder="~/.steam/steam/steamapps/common/SteamVR"
                    className="flex-1"
                  />
                  <Button variant="outline" size="sm" onClick={handlePickSteamVRDir} title="Browse for SteamVR directory">
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </div>
                {vrDetected?.found && vrDetected.dir && (
                  <button
                    type="button"
                    onClick={async () => {
                      setVrSteamVrPath(vrDetected.dir!)
                      await window.ucSettings?.set?.('vrSteamVrPath', vrDetected.dir).catch(() => {})
                    }}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
                  >
                    Use detected: {vrDetected.dir}
                  </button>
                )}
              </div>

              {/* XR_RUNTIME_JSON */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  XR_RUNTIME_JSON <span className="normal-case">(OpenXR runtime)</span>
                </label>
                <div className="flex gap-2">
                  <Input
                    value={vrXrRuntimeJson}
                    onChange={(e) => setVrXrRuntimeJson(e.target.value)}
                    onBlur={async () => {
                      try { await window.ucSettings?.set?.('vrXrRuntimeJson', vrXrRuntimeJson) } catch {}
                    }}
                    placeholder="/path/to/steamxr_linux64.json"
                    className="flex-1"
                  />
                  <Button variant="outline" size="sm" onClick={handlePickXrRuntimeJson} title="Browse for OpenXR runtime JSON">
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </div>
                {vrOpenXrDetected?.found && vrOpenXrDetected.path && (
                  <button
                    type="button"
                    onClick={async () => {
                      setVrXrRuntimeJson(vrOpenXrDetected.path!)
                      await window.ucSettings?.set?.('vrXrRuntimeJson', vrOpenXrDetected.path).catch(() => {})
                    }}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
                  >
                    Use detected: {vrOpenXrDetected.path}
                  </button>
                )}
              </div>

              {/* STEAM_VR_RUNTIME */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  STEAM_VR_RUNTIME
                </label>
                <Input
                  value={vrSteamVrRuntime}
                  onChange={(e) => setVrSteamVrRuntime(e.target.value)}
                  onBlur={async () => {
                    try { await window.ucSettings?.set?.('vrSteamVrRuntime', vrSteamVrRuntime) } catch {}
                  }}
                  placeholder="~/.steam/steam/steamapps/common/SteamVR"
                />
              </div>

              {/* VR extra env vars */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">VR extra environment variables</label>
                <p className="text-xs text-muted-foreground">One per line, format: <code className="font-mono bg-muted/50 px-1 rounded">KEY=VALUE</code>. Applied in addition to the Linux gaming env vars.</p>
                <textarea
                  value={vrExtraEnv}
                  onChange={(e) => setVrExtraEnv(e.target.value)}
                  onBlur={async () => {
                    try { await window.ucSettings?.set?.('vrExtraEnv', vrExtraEnv) } catch {}
                  }}
                  rows={3}
                  placeholder={"ENABLE_VK_LAYER_VALVE_steam_overlay_1=1\n# VR_OVERRIDE=1"}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y"
                />
              </div>

              <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-200">
                <strong>Tip:</strong> For SteamVR on Linux, set <code className="font-mono">XR_RUNTIME_JSON</code> to the SteamVR OpenXR runtime JSON (e.g. <code className="font-mono">steamxr_linux64.json</code>). For Monado or WiVRn, point it to their respective runtime JSON files.
              </div>
            </div>
          )}
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
              <div className="space-y-3">
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


