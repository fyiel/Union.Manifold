// UC System Profile scanner.
//
// Collects a canonical hardware/OS spec for the local machine using only
// platform-native tools (no npm deps, no native rebuilds). The result is
// cached to userData and uploaded by the renderer to the UC backend when
// the user opts in. Shape is versioned via SPEC_VERSION so old snapshots
// stored against posts remain interpretable after we extend the scanner.

const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const child_process = require('node:child_process')

const SPEC_VERSION = 3

// PowerShell on Windows has a meaningful cold-start cost (CLR init + WMI
// service spin-up can easily blow past 5s on the first call after boot),
// so we budget generously. The previous 8s limit was tripping on cold
// boots and producing half-empty scans that the user "fixed" by retrying.
const WIN_PS_TIMEOUT_MS = 30000
const NIX_CMD_TIMEOUT_MS = 6000

function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let done = false
    let proc
    try {
      proc = child_process.spawn(cmd, args, { windowsHide: true, ...opts })
    } catch (err) {
      resolve({ ok: false, stdout: '', stderr: String(err?.message || err), code: -1 })
      return
    }
    const timeout = setTimeout(() => {
      if (done) return
      done = true
      try { proc.kill() } catch {}
      resolve({ ok: false, stdout, stderr: stderr + '\n[timeout]', code: -1 })
    }, opts.timeoutMs || NIX_CMD_TIMEOUT_MS)
    proc.stdout?.on('data', (d) => { stdout += d.toString() })
    proc.stderr?.on('data', (d) => { stderr += d.toString() })
    proc.on('error', (err) => {
      if (done) return
      done = true
      clearTimeout(timeout)
      resolve({ ok: false, stdout, stderr: String(err?.message || err), code: -1 })
    })
    proc.on('close', (code) => {
      if (done) return
      done = true
      clearTimeout(timeout)
      resolve({ ok: code === 0, stdout, stderr, code })
    })
  })
}

async function runPS(script, timeoutMs = WIN_PS_TIMEOUT_MS) {
  // -NoProfile keeps cold start fast; ConvertTo-Json gives us structured
  // output. We deliberately do NOT set $ErrorActionPreference globally —
  // letting individual probes throw lets a single bad query (e.g. Storage
  // Spaces cmdlets on Windows Server Core) fail without erasing the rest.
  return runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    timeoutMs,
  })
}

function safeJsonParse(text) {
  if (!text) return null
  try { return JSON.parse(text) } catch { return null }
}

function toArray(value) {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function readFileSafe(p) {
  try { return fs.readFileSync(p, 'utf8') } catch { return null }
}

// ── Windows probes ──────────────────────────────────────────────────────────

// Single comprehensive PS script. We correlate physical disks to logical
// disks server-side here (in PS) so we don't need a second round-trip. We
// also pull SMBIOSMemoryType so the renderer can show DDR4/DDR5 instead
// of a bare clock speed.
const WIN_SCAN_SCRIPT = `
$ProgressPreference = 'SilentlyContinue'
$WarningPreference  = 'SilentlyContinue'

function Try-CIM($class, $filter) {
  try {
    if ($filter) { Get-CimInstance -ClassName $class -Filter $filter -ErrorAction Stop }
    else         { Get-CimInstance -ClassName $class -ErrorAction Stop }
  } catch { @() }
}

$cs   = Try-CIM 'Win32_ComputerSystem' $null
$os_  = Try-CIM 'Win32_OperatingSystem' $null
$cpu  = Try-CIM 'Win32_Processor' $null | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed,Manufacturer,Architecture
$gpu  = Try-CIM 'Win32_VideoController' $null | Select-Object Name,AdapterRAM,DriverVersion,DriverDate,VideoProcessor,PNPDeviceID,CurrentHorizontalResolution,CurrentVerticalResolution,CurrentRefreshRate,Status,Availability,ConfigManagerErrorCode
$mem  = Try-CIM 'Win32_PhysicalMemory' $null | Select-Object Capacity,Speed,ConfiguredClockSpeed,Manufacturer,PartNumber,SMBIOSMemoryType,MemoryType,FormFactor,DeviceLocator
$disk = Try-CIM 'Win32_DiskDrive' $null | Select-Object Model,Size,MediaType,InterfaceType,SerialNumber,DeviceID,Index,PNPDeviceID
$vol  = Try-CIM 'Win32_LogicalDisk' 'DriveType=3' | Select-Object DeviceID,Size,FreeSpace,FileSystem,VolumeName

# Physical-disk metadata via Storage cmdlets (Win8+). Correlate by Number
# to Win32_DiskDrive.Index. Wrapped in try/catch so older systems still
# produce a result.
$pdisks = @()
try {
  $pdisks = Get-PhysicalDisk -ErrorAction Stop | ForEach-Object {
    @{
      Number     = $_.DeviceId
      MediaType  = "$($_.MediaType)"
      BusType    = "$($_.BusType)"
      Model      = $_.Model
      Size       = $_.Size
      FriendlyName = $_.FriendlyName
      SerialNumber = $_.SerialNumber
    }
  }
} catch { }

# Drive-letter → physical media. Same caveat re: Storage Spaces.
$volMedia = @()
try {
  $volMedia = Get-Partition -ErrorAction Stop | Where-Object { $_.DriveLetter } | ForEach-Object {
    $d = $null; $pd = $null
    try { $d = $_ | Get-Disk -ErrorAction Stop } catch { }
    if ($d) { try { $pd = $d | Get-PhysicalDisk -ErrorAction Stop } catch { } }
    @{
      Letter    = "$($_.DriveLetter):"
      DiskNumber = if ($d) { $d.Number } else { $null }
      MediaType = if ($pd) { "$($pd.MediaType)" } else { $null }
      BusType   = if ($pd) { "$($pd.BusType)" }   else { $null }
    }
  }
} catch { }

# Real VRAM via the display-adapter class key. Win32_VideoController.AdapterRAM
# is a DWORD and is capped at 4GB (and often outright wrong on modern cards);
# the kernel writes the 64-bit truth into HardwareInformation.qwMemorySize.
# We collect every adapter subkey and let the JS side correlate by PNPDeviceID
# (MatchingDeviceId) so we can attach VRAM to the right Win32_VideoController row.
$adapters = @()
try {
  $classRoot = 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}'
  if (Test-Path $classRoot) {
    $adapters = Get-ChildItem $classRoot -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -match '^\d{4}$' } | ForEach-Object {
      $vals = $null
      try { $vals = Get-ItemProperty -Path $_.PSPath -ErrorAction Stop } catch { }
      if ($vals) {
        @{
          subkey       = $_.PSChildName
          driverDesc   = "$($vals.DriverDesc)"
          matchingDevId = "$($vals.MatchingDeviceId)"
          # qwMemorySize is the 64-bit value; HardwareInformation.MemorySize is the
          # legacy DWORD. Prefer the QWORD when present.
          qwMemorySize = if ($vals.'HardwareInformation.qwMemorySize') { [int64]$vals.'HardwareInformation.qwMemorySize' } else { $null }
          dwMemorySize = if ($vals.'HardwareInformation.MemorySize')   { [int64]$vals.'HardwareInformation.MemorySize'   } else { $null }
        }
      }
    }
  }
} catch { }

# Physical monitors (panels actually attached) via the WMI monitor namespace.
# Win32_VideoController only knows about adapters; a single GPU can drive 1..N
# monitors. We pull EDID-derived manufacturer/product strings + the largest
# supported source mode (proxy for the panel's native resolution) so the
# scanner reports every attached monitor, not just "the GPU's primary".
$monitors = @()
try {
  $ids = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorID -ErrorAction Stop
  $modes = @()
  try { $modes = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorListedSupportedSourceModes -ErrorAction Stop } catch { }
  $modesByInstance = @{}
  foreach ($m in $modes) {
    $modesByInstance[$m.InstanceName] = $m
  }
  foreach ($id in $ids) {
    $name = ''
    if ($id.UserFriendlyName) {
      $name = -join ($id.UserFriendlyName | Where-Object { $_ -gt 0 } | ForEach-Object { [char]$_ })
    }
    $manuf = ''
    if ($id.ManufacturerName) {
      $manuf = -join ($id.ManufacturerName | Where-Object { $_ -gt 0 } | ForEach-Object { [char]$_ })
    }
    $product = ''
    if ($id.ProductCodeID) {
      $product = -join ($id.ProductCodeID | Where-Object { $_ -gt 0 } | ForEach-Object { [char]$_ })
    }
    $serial = ''
    if ($id.SerialNumberID) {
      $serial = -join ($id.SerialNumberID | Where-Object { $_ -gt 0 } | ForEach-Object { [char]$_ })
    }
    # Native mode = largest preferred mode. The list is unordered; pick the one
    # with the highest horizontal active pixels and matching vertical.
    $w = $null; $h = $null; $hz = $null
    $sm = $modesByInstance[$id.InstanceName]
    if ($sm -and $sm.MonitorSourceModes) {
      $best = $sm.MonitorSourceModes | Sort-Object -Property HorizontalActivePixels -Descending | Select-Object -First 1
      if ($best) {
        $w = [int]$best.HorizontalActivePixels
        $h = [int]$best.VerticalActivePixels
        if ($best.VerticalRefreshRateNumerator -and $best.VerticalRefreshRateDenominator) {
          $hz = [int][math]::Round($best.VerticalRefreshRateNumerator / $best.VerticalRefreshRateDenominator)
        }
      }
    }
    $monitors += @{
      instance = $id.InstanceName
      name     = $name
      manuf    = $manuf
      product  = $product
      serial   = $serial
      yearOfManufacture = $id.YearOfManufacture
      active   = [bool]$id.Active
      width    = $w
      height   = $h
      refreshHz = $hz
    }
  }
} catch { }

# DPI / current-mode pass: Win32_DesktopMonitor has the *current* (not native)
# resolution for whichever monitor each Win32_VideoController is currently
# driving. Useful as a fallback when WmiMonitor* isn't accessible (some
# locked-down corporate images).
$desktopMonitors = Try-CIM 'Win32_DesktopMonitor' $null | Select-Object Name,ScreenWidth,ScreenHeight,DeviceID,PNPDeviceID,MonitorManufacturer,MonitorType

$out = @{
  cs=$cs; os=$os_; cpu=$cpu; gpu=$gpu; mem=$mem; disk=$disk; vol=$vol; volMedia=$volMedia; pdisks=$pdisks; adapters=$adapters; monitors=$monitors; desktopMonitors=$desktopMonitors
}
$out | ConvertTo-Json -Depth 8 -Compress
`

async function runWinScanWithRetry() {
  // First attempt with full budget; if the result is structurally empty
  // (CPU or RAM missing — those should never legitimately be missing on
  // Windows), retry once. WMI sometimes returns nothing on the first call
  // after a cold boot while the service is still warming up.
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await runPS(WIN_SCAN_SCRIPT)
    const parsed = safeJsonParse(result.stdout)
    if (parsed && (toArray(parsed.cpu).length > 0 || parsed.cpu?.Name)) {
      return parsed
    }
    if (attempt === 0) {
      // small backoff before retry
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  // Last-resort empty shape so downstream code doesn't NPE.
  return {}
}

async function scanWindows() {
  const parsed = await runWinScanWithRetry()

  const cpus = toArray(parsed.cpu)
  const cpu = cpus[0] || {}
  const archMap = { 0: 'x86', 5: 'arm', 6: 'ia64', 9: 'x64', 12: 'arm64' }

  // Build a lookup of "real" VRAM from the registry. AdapterRAM (DWORD) is
  // capped at 4GB and outright wrong on most modern cards. The display class
  // key stores the 64-bit HardwareInformation.qwMemorySize that we trust over
  // the WMI value. Correlate by PNPDeviceID prefix.
  const vramByPnpPrefix = new Map()
  for (const a of toArray(parsed.adapters)) {
    const matching = String(a?.matchingDevId || '').toUpperCase()
    if (!matching) continue
    const bytes = Number(a?.qwMemorySize) || Number(a?.dwMemorySize) || 0
    if (!bytes) continue
    // Strip the subsys/rev suffix so we match "PCI\VEN_10DE&DEV_2786" against
    // both shortened PnP IDs and full ones.
    const key = matching.split('&').slice(0, 2).join('&')
    vramByPnpPrefix.set(key, bytes)
    vramByPnpPrefix.set(matching, bytes)
  }
  function lookupRealVram(pnp) {
    if (!pnp) return null
    const up = String(pnp).toUpperCase()
    if (vramByPnpPrefix.has(up)) return vramByPnpPrefix.get(up)
    const short = up.split('&').slice(0, 2).join('&')
    if (vramByPnpPrefix.has(short)) return vramByPnpPrefix.get(short)
    return null
  }

  // Rank GPUs so virtual / paravirtual adapters (Meta Oculus Virtual,
  // Parsec, Microsoft Basic Display, IddSampleDriver, RDP, Hyper-V) lose
  // to real silicon when the renderer reads `gpus[0]`.
  const rawGpus = toArray(parsed.gpu)
    .filter((g) => g && (g.Name || g.PNPDeviceID))
    .map((g) => ({
      name: g?.Name || null,
      vramBytes: lookupRealVram(g?.PNPDeviceID) || Number(g?.AdapterRAM) || null,
      vendor: detectGpuVendor(g?.Name || ''),
      driverVersion: g?.DriverVersion || null,
      driverDate: g?.DriverDate || null,
      videoProcessor: g?.VideoProcessor || null,
      isVirtual: isVirtualGpu(g?.Name || '', g?.PNPDeviceID || ''),
      isActive: Number(g?.ConfigManagerErrorCode) === 0 && (Number(g?.Availability) || 3) <= 8,
      currentRes: Number(g?.CurrentHorizontalResolution) || 0,
      pnp: g?.PNPDeviceID || null,
    }))

  // Sort: real before virtual; active before inactive; then by VRAM desc;
  // then by current resolution desc (the adapter actually driving a panel
  // is usually the one the user cares about). NVIDIA/AMD/Intel discrete-
  // class names get a small boost too.
  const gpus = [...rawGpus].sort((a, b) => {
    if (a.isVirtual !== b.isVirtual) return a.isVirtual ? 1 : -1
    const aReal = a.vendor === 'nvidia' || a.vendor === 'amd' || a.vendor === 'intel' || a.vendor === 'apple'
    const bReal = b.vendor === 'nvidia' || b.vendor === 'amd' || b.vendor === 'intel' || b.vendor === 'apple'
    if (aReal !== bReal) return aReal ? -1 : 1
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
    if ((b.vramBytes || 0) !== (a.vramBytes || 0)) return (b.vramBytes || 0) - (a.vramBytes || 0)
    return b.currentRes - a.currentRes
  }).map(({ isVirtual, isActive, currentRes, pnp, ...keep }) => keep)

  const memModules = toArray(parsed.mem)
  const ramTotalBytes = memModules.reduce((sum, m) => sum + (Number(m?.Capacity) || 0), 0)
    || (Number(parsed.cs?.TotalPhysicalMemory) || os.totalmem() || 0)
  const ramSpeedMhz = memModules.length
    ? Math.max(...memModules.map((m) => Number(m?.ConfiguredClockSpeed) || Number(m?.Speed) || 0)) || null
    : null
  const ramTypes = memModules.map((m) => decodeMemoryType(m?.SMBIOSMemoryType, m?.MemoryType)).filter(Boolean)
  // Take the most common DDR generation across slots — mixed-RAM rigs are
  // rare enough that this rounds to "the rig's RAM type".
  const ramType = pickMostCommon(ramTypes)
  const ramFormFactor = pickMostCommon(memModules.map((m) => decodeFormFactor(m?.FormFactor)).filter(Boolean))

  // Index physical disks by Number so we can enrich Win32_DiskDrive rows
  // (which lie about MediaType — every SSD reports "Fixed hard disk media").
  const pdiskByNumber = new Map()
  for (const pd of toArray(parsed.pdisks)) {
    if (pd?.Number != null) pdiskByNumber.set(Number(pd.Number), pd)
  }

  const drives = toArray(parsed.disk).map((d) => {
    const idx = Number(d?.Index)
    const pd = Number.isFinite(idx) ? pdiskByNumber.get(idx) : null
    const mediaType = normalizeStorageMediaType(pd?.MediaType) ?? normalizeWindowsMediaType(d?.MediaType, d?.Model)
    return {
      model: (d?.Model || pd?.FriendlyName || null)?.trim() || null,
      sizeBytes: Number(d?.Size) || Number(pd?.Size) || null,
      mediaType,
      interfaceType: d?.InterfaceType || normalizeBusType(pd?.BusType) || null,
      busType: normalizeBusType(pd?.BusType) || null,
      serial: (d?.SerialNumber || pd?.SerialNumber || '').trim() || null,
    }
  })

  const volMediaMap = new Map()
  for (const entry of toArray(parsed.volMedia)) {
    if (entry?.Letter) volMediaMap.set(String(entry.Letter).toUpperCase(), {
      mediaType: normalizeStorageMediaType(entry.MediaType),
      busType: normalizeBusType(entry.BusType),
    })
  }

  const volumes = toArray(parsed.vol).map((v) => {
    const mount = v?.DeviceID || null
    const mapped = mount ? volMediaMap.get(String(mount).toUpperCase()) : null
    return {
      mount,
      sizeBytes: Number(v?.Size) || null,
      freeBytes: Number(v?.FreeSpace) || null,
      fs: v?.FileSystem || null,
      mediaType: mapped?.mediaType ?? null,
      busType: mapped?.busType ?? null,
    }
  })

  // Enumerate every *physical* monitor attached to the machine. The previous
  // implementation derived displays from Win32_VideoController, which is
  // per-adapter and only ever reported one entry (the GPU's primary surface)
  // — multi-monitor setups appeared as a single 1080p panel. Now we use
  // root/wmi → WmiMonitorID for the panel list and WmiMonitorListedSupported-
  // SourceModes for the native resolution, falling back to Win32_DesktopMonitor
  // and finally Win32_VideoController for locked-down systems where the WMI
  // monitor namespace is blocked.
  const monitorRows = toArray(parsed.monitors).filter((m) => m && (m.name || m.product || m.manuf))
  let displays = monitorRows.map((m) => ({
    label: (m.name && m.name.trim()) || [m.manuf, m.product].filter(Boolean).join(' ').trim() || null,
    width: Number(m.width) || null,
    height: Number(m.height) || null,
    refreshHz: Number(m.refreshHz) || null,
    manufacturer: m.manuf || null,
    product: m.product || null,
    serial: m.serial || null,
    active: m.active !== false,
  }))

  if (displays.length === 0) {
    // Win32_DesktopMonitor fallback. Multiple rows per machine on multi-head
    // rigs; sometimes one ghost row with zero dimensions — filter those.
    displays = toArray(parsed.desktopMonitors)
      .filter((d) => Number(d?.ScreenWidth) && Number(d?.ScreenHeight))
      .map((d) => ({
        label: d?.Name || d?.MonitorType || null,
        width: Number(d.ScreenWidth) || null,
        height: Number(d.ScreenHeight) || null,
        refreshHz: null,
        manufacturer: d?.MonitorManufacturer || null,
        product: null,
        serial: null,
        active: true,
      }))
  }

  if (displays.length === 0) {
    // Last-resort fallback: the old per-adapter view. Only fires when both
    // monitor namespaces are unavailable (rare).
    displays = toArray(parsed.gpu)
      .filter((d) => d?.CurrentHorizontalResolution && d?.CurrentVerticalResolution)
      .map((d) => ({
        label: d?.Name || null,
        width: Number(d.CurrentHorizontalResolution) || null,
        height: Number(d.CurrentVerticalResolution) || null,
        refreshHz: Number(d.CurrentRefreshRate) || null,
        manufacturer: null,
        product: null,
        serial: null,
        active: true,
      }))
  }

  // Push virtual / inactive monitors to the back, and dedupe entries that
  // share width+height+label (Win32_DesktopMonitor sometimes lists the same
  // monitor twice once via DDC and once via EDID).
  const seen = new Set()
  displays = displays
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1
      const av = isVirtualGpu(a.label || '', '')
      const bv = isVirtualGpu(b.label || '', '')
      if (av !== bv) return av ? 1 : -1
      return (b.width || 0) - (a.width || 0)
    })
    .filter((d) => {
      const k = `${d.label}|${d.width}|${d.height}|${d.serial || ''}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })

  return {
    cpu: {
      model: cpu.Name?.trim() || null,
      vendor: cpu.Manufacturer || null,
      arch: archMap[Number(cpu.Architecture)] || os.arch(),
      cores: Number(cpu.NumberOfCores) || null,
      threads: Number(cpu.NumberOfLogicalProcessors) || null,
      baseClockMhz: Number(cpu.MaxClockSpeed) || null,
    },
    gpus,
    ram: {
      totalBytes: ramTotalBytes,
      modules: memModules.length || null,
      speedMhz: ramSpeedMhz,
      channels: inferRamChannels(memModules.length),
      type: ramType,
      formFactor: ramFormFactor,
    },
    storage: { drives, volumes },
    os: {
      platform: 'win32',
      name: parsed.os?.Caption?.trim() || 'Windows',
      version: parsed.os?.Version || os.release(),
      build: parsed.os?.BuildNumber || null,
      arch: parsed.os?.OSArchitecture || os.arch(),
      locale: parsed.os?.OSLanguage ? String(parsed.os.OSLanguage) : null,
    },
    displays,
    graphics: await detectGraphicsApisWindows(),
  }
}

/**
 * Map the value returned by Storage Spaces' Get-PhysicalDisk into our
 * canonical `'nvme' | 'ssd' | 'hdd' | 'scm' | null` tagging. The cmdlet's
 * MediaType property uses numeric codes (3=HDD, 4=SSD, 5=SCM) on older
 * Windows and strings on newer Windows, so we accept both.
 */
function normalizeStorageMediaType(value) {
  if (value == null) return null
  const text = String(value).toLowerCase().trim()
  if (!text || text === 'unspecified' || text === '0') return null
  if (text.includes('nvme')) return 'nvme'
  if (text === 'ssd' || text === '4' || text.includes('solid state')) return 'ssd'
  if (text === 'hdd' || text === '3' || text.includes('hard disk') || text.includes('rotational')) return 'hdd'
  if (text === '5' || text === 'scm') return 'scm'
  return null
}

function normalizeBusType(value) {
  if (value == null) return null
  const text = String(value).toLowerCase().trim()
  if (!text || text === 'unknown' || text === '0') return null
  // PowerShell sometimes returns numeric codes; map the common ones.
  const numMap = { '1': 'scsi', '3': 'ata', '7': 'usb', '8': 'raid', '11': 'sata', '17': 'nvme', '18': 'sas' }
  if (numMap[text]) return numMap[text]
  return text
}

function normalizeWindowsMediaType(media, model) {
  const text = `${media || ''} ${model || ''}`.toLowerCase()
  if (text.includes('nvme')) return 'nvme'
  if (text.includes('ssd') || text.includes('solid state')) return 'ssd'
  if (text.includes('hdd') || text.includes('hard disk') || text.includes('fixed hard')) return 'hdd'
  if (text.includes('removable')) return 'removable'
  return null
}

/**
 * SMBIOSMemoryType / MemoryType → human label. Codes per the DMTF SMBIOS
 * spec (and Microsoft's Win32_PhysicalMemory docs). We only label the
 * generations users actually run — anything older than DDR returns null.
 */
function decodeMemoryType(smbios, fallback) {
  const code = Number(smbios) || Number(fallback) || 0
  // SMBIOS codes
  if (code === 34) return 'DDR5'
  if (code === 35) return 'LPDDR5'
  if (code === 26) return 'DDR4'
  if (code === 30) return 'LPDDR4'
  if (code === 24) return 'DDR3'
  if (code === 29) return 'LPDDR3'
  if (code === 21 || code === 22) return 'DDR2'
  if (code === 20) return 'DDR'
  return null
}

function decodeFormFactor(code) {
  const n = Number(code) || 0
  if (n === 8) return 'DIMM'
  if (n === 12) return 'SODIMM'
  if (n === 13) return 'SRIMM'
  if (n === 11) return 'RIMM'
  return null
}

function pickMostCommon(arr) {
  if (!arr || arr.length === 0) return null
  const counts = new Map()
  for (const v of arr) counts.set(v, (counts.get(v) || 0) + 1)
  let best = null; let bestCount = 0
  for (const [v, c] of counts) {
    if (c > bestCount) { best = v; bestCount = c }
  }
  return best
}

/**
 * Identify virtual / paravirtual GPUs so the picker doesn't crown them
 * as primary. Catches Meta/Oculus Virtual, Parsec, Microsoft Basic
 * Display, IddSampleDriver, Hyper-V, RDP, VMware/VirtualBox, NVIDIA's
 * "USB-C/DisplayLink"-style virtual adapters, and anything tagged
 * obviously "virtual" / "remote".
 */
function isVirtualGpu(name, pnpId) {
  const text = `${name || ''} ${pnpId || ''}`.toLowerCase()
  if (!text.trim()) return false
  const needles = [
    'oculus', 'meta virtual', 'virtual desktop', 'parsec',
    'microsoft basic display', 'microsoft remote display',
    'iddsampledriver', 'idd ', 'usbmmidd', 'displaylink',
    'remote desktop', 'rdp', 'hyper-v', 'hyperv',
    'vmware', 'virtualbox', 'qxl', 'cirrus',
    'virtual display', 'virtual monitor', 'virtual audio',
    'spacedesk', 'duet display', 'air display', 'splashtop',
  ]
  return needles.some((n) => text.includes(n))
}

async function detectGraphicsApisWindows() {
  // dxdiag is the canonical source but is slow (~2-4s) and writes to a file.
  // We probe the cheap, common API versions: DX12 presence is implicit on
  // Win10+, Vulkan via the vulkaninfo binary if installed.
  const dx = process.platform === 'win32' ? '12' : null
  const vk = await runCommand('vulkaninfo', ['--summary'], { timeoutMs: 3000 })
  let vulkanVersion = null
  if (vk.ok) {
    const m = vk.stdout.match(/Vulkan Instance Version:\s*([\d.]+)/i)
    vulkanVersion = m ? m[1] : null
  }
  return {
    directx: dx,
    vulkan: vulkanVersion,
    opengl: null,
  }
}

// ── Linux probes ────────────────────────────────────────────────────────────

async function scanLinux() {
  const [cpuInfo, memInfo, gpus, drives, displays, vkVersion, glVersion, distro] = await Promise.all([
    probeLinuxCpu(),
    probeLinuxMemory(),
    probeLinuxGpus(),
    probeLinuxDrives(),
    probeLinuxDisplays(),
    probeLinuxVulkan(),
    probeLinuxOpenGL(),
    probeLinuxDistro(),
  ])

  return {
    cpu: cpuInfo,
    gpus,
    ram: memInfo,
    storage: { drives, volumes: probeLinuxVolumes() },
    os: {
      platform: 'linux',
      name: distro.name || 'Linux',
      version: distro.version || os.release(),
      build: os.release(),
      arch: os.arch(),
      locale: process.env.LANG || null,
    },
    displays,
    graphics: {
      directx: null,
      vulkan: vkVersion,
      opengl: glVersion,
    },
  }
}

async function probeLinuxCpu() {
  const cpuinfo = readFileSafe('/proc/cpuinfo') || ''
  const modelLine = cpuinfo.match(/^model name\s*:\s*(.+)$/m)
  const vendorLine = cpuinfo.match(/^vendor_id\s*:\s*(.+)$/m)
  const cpuCount = os.cpus().length
  let cores = null
  const cpuCoresLine = cpuinfo.match(/^cpu cores\s*:\s*(\d+)$/m)
  if (cpuCoresLine) cores = Number(cpuCoresLine[1])
  const baseClock = os.cpus()[0]?.speed || null
  return {
    model: modelLine ? modelLine[1].trim() : null,
    vendor: vendorLine ? vendorLine[1].trim() : null,
    arch: os.arch(),
    cores,
    threads: cpuCount,
    baseClockMhz: baseClock,
  }
}

async function probeLinuxMemory() {
  const meminfo = readFileSafe('/proc/meminfo') || ''
  const totalKb = Number((meminfo.match(/MemTotal:\s+(\d+)/) || [])[1] || 0)

  // Try dmidecode for DDR generation + speed. This needs root on most
  // distros; we run it best-effort and silently skip if it fails.
  let modules = null
  let speedMhz = null
  let type = null
  let formFactor = null
  const dmi = await runCommand('dmidecode', ['-t', 'memory'], { timeoutMs: 4000 })
  if (dmi.ok && dmi.stdout) {
    const blocks = dmi.stdout.split(/\n(?=Memory Device\b)/)
    const populated = blocks.filter((b) => /Size:\s*\d+\s*[KMG]B/i.test(b) && !/Size:\s*No Module/i.test(b))
    if (populated.length) {
      modules = populated.length
      const speeds = populated.map((b) => Number((b.match(/Configured (?:Memory|Clock) Speed:\s*(\d+)/i) || b.match(/Speed:\s*(\d+)/i) || [])[1]) || 0).filter(Boolean)
      if (speeds.length) speedMhz = Math.max(...speeds)
      const types = populated.map((b) => (b.match(/^\s*Type:\s*(\S+)/m) || [])[1]).filter((t) => t && t !== 'Unknown')
      type = pickMostCommon(types) || null
      const ffs = populated.map((b) => (b.match(/Form Factor:\s*(\S+)/) || [])[1]).filter(Boolean)
      formFactor = pickMostCommon(ffs) || null
    }
  }

  return {
    totalBytes: totalKb ? totalKb * 1024 : (os.totalmem() || 0),
    modules,
    speedMhz,
    channels: inferRamChannels(modules),
    type,
    formFactor,
  }
}

/**
 * Linux GPU detection. The previous implementation parsed `lspci -mm`,
 * which returns the *literal* "Device 1111" placeholder string when the
 * local pci.ids database doesn't have an entry for the silicon — this
 * happens routinely on rolling-release distros, fresh chromebooks, and
 * anything running a kernel newer than the installed pciutils package.
 *
 * We now do three things in order and pick the best name:
 *  1. `lspci -nn -mm` — gives us "Vendor [v:d]" + "Device [v:d]" with the
 *     vendor:device IDs alongside, so a stale pci.ids never strips the
 *     numeric fallback.
 *  2. /sys/class/drm/cardN/device — the kernel-resolved driver and PCI
 *     IDs are always available even when userspace pci.ids is stale.
 *  3. glxinfo / vulkaninfo renderer string — when both above produce
 *     only numeric IDs, this gives us the marketing name the GL/Vulkan
 *     loader resolved from the binary driver itself.
 */
async function probeLinuxGpus() {
  const gpus = []

  // 1. lspci with numeric IDs alongside names.
  const lspci = await runCommand('lspci', ['-nn', '-mm'], { timeoutMs: 4000 })
  if (lspci.ok) {
    for (const line of lspci.stdout.split('\n')) {
      if (!/VGA|3D|Display/i.test(line)) continue
      // "00:02.0 "VGA compatible controller [0300]" "Intel [8086]" "Device [9a49]" ..."
      const quoted = line.match(/"([^"]*)"/g)?.map((s) => s.slice(1, -1)) || []
      const slot = (line.match(/^(\S+)/) || [])[1] || null
      const vendorRaw = quoted[1] || ''
      const nameRaw = quoted[2] || ''
      const vendorIdMatch = vendorRaw.match(/\[([0-9a-f]{4})\]\s*$/i)
      const deviceIdMatch = nameRaw.match(/\[([0-9a-f]{4})\]\s*$/i)
      const vendorName = vendorRaw.replace(/\s*\[[0-9a-f]{4}\]\s*$/i, '').trim()
      let deviceName = nameRaw.replace(/\s*\[[0-9a-f]{4}\]\s*$/i, '').trim()
      // "Device 1111" → null, so the renderer falls through to other sources.
      if (/^Device$/i.test(deviceName) || /^Device\s+[0-9a-f]{4}$/i.test(deviceName)) deviceName = ''
      if (!vendorName && !deviceName) continue
      gpus.push({
        slot,
        name: deviceName || null,
        vendor: detectGpuVendor(`${vendorName} ${deviceName}`),
        vendorName: vendorName || null,
        vendorId: vendorIdMatch ? vendorIdMatch[1].toLowerCase() : null,
        deviceId: deviceIdMatch ? deviceIdMatch[1].toLowerCase() : null,
        vramBytes: null,
        driverVersion: null,
        driverDate: null,
      })
    }
  }

  // 2. Enrich from /sys/class/drm — kernel-resolved driver + PCI IDs.
  try {
    for (const entry of fs.readdirSync('/sys/class/drm')) {
      if (!/^card\d+$/.test(entry)) continue
      const devLink = `/sys/class/drm/${entry}/device`
      const uevent = readFileSafe(`${devLink}/uevent`) || ''
      const pciSlot = (uevent.match(/^PCI_SLOT_NAME=(.+)$/m) || [])[1] || null
      const pciId = (uevent.match(/^PCI_ID=([0-9A-F]{4}):([0-9A-F]{4})$/m) || [])
      const driver = (uevent.match(/^DRIVER=(.+)$/m) || [])[1] || null
      const vendor = pciId[1]?.toLowerCase() || null
      const device = pciId[2]?.toLowerCase() || null

      // Match to the lspci row by slot when possible.
      let target = gpus.find((g) => g.slot && pciSlot && g.slot === pciSlot)
      if (!target && vendor && device) target = gpus.find((g) => g.vendorId === vendor && g.deviceId === device)
      if (!target) {
        target = { slot: pciSlot, name: null, vendor: 'unknown', vendorName: null, vendorId: vendor, deviceId: device, vramBytes: null, driverVersion: null, driverDate: null }
        gpus.push(target)
      }
      if (!target.vendorId && vendor) target.vendorId = vendor
      if (!target.deviceId && device) target.deviceId = device
      if (!target.driver && driver) target.driver = driver

      // VRAM hint for AMD/Intel via debugfs-style files. Cheap if present.
      const vramTotalRaw = readFileSafe(`${devLink}/mem_info_vram_total`)
      const vram = vramTotalRaw ? Number(vramTotalRaw.trim()) : 0
      if (vram && !target.vramBytes) target.vramBytes = vram
    }
  } catch { /* /sys/class/drm absent — non-fatal */ }

  // 3. glxinfo renderer string for the actively-used GPU. Use this to
  // upgrade any "name: null" placeholder we still have.
  const gl = await runCommand('glxinfo', ['-B'], { timeoutMs: 3000 })
  let glRenderer = null
  if (gl.ok) {
    const m = gl.stdout.match(/OpenGL renderer string:\s*([^\n]+)/i)
    if (m) glRenderer = m[1].trim()
  }

  // 4. nvidia-smi for NVIDIA cards (gives proper marketing name + VRAM +
  // driver version even when pci.ids is stale).
  const nvsmi = await runCommand('nvidia-smi', ['--query-gpu=index,name,memory.total,driver_version,pci.bus_id', '--format=csv,noheader,nounits'], { timeoutMs: 3000 })
  const nvCards = []
  if (nvsmi.ok) {
    for (const line of nvsmi.stdout.split('\n')) {
      const parts = line.split(',').map((s) => s.trim())
      if (parts.length < 4 || !parts[1]) continue
      nvCards.push({
        name: parts[1],
        vramBytes: Number(parts[2]) ? Number(parts[2]) * 1024 * 1024 : null,
        driverVersion: parts[3] || null,
        pciBusId: (parts[4] || '').toLowerCase(),
      })
    }
  }

  // Stitch nvidia-smi names back to the matching slot.
  for (const nv of nvCards) {
    // nvidia-smi bus IDs look like "00000000:01:00.0" — strip the domain.
    const trimmed = nv.pciBusId.replace(/^0+:/, '').replace(/^([0-9a-f]{4}):/, '')
    let target = gpus.find((g) => g.slot && (g.slot === trimmed || trimmed.endsWith(g.slot)))
    if (!target) target = gpus.find((g) => g.vendor === 'nvidia' && !g.name)
    if (!target) target = gpus.find((g) => g.vendor === 'nvidia')
    if (!target) {
      target = { slot: null, name: nv.name, vendor: 'nvidia', vendorName: 'NVIDIA Corporation', vendorId: '10de', deviceId: null, vramBytes: nv.vramBytes, driverVersion: nv.driverVersion, driverDate: null }
      gpus.push(target)
    } else {
      target.name = nv.name
      if (!target.vramBytes) target.vramBytes = nv.vramBytes
      if (!target.driverVersion) target.driverVersion = nv.driverVersion
    }
  }

  // Fall back to glxinfo renderer when we still have placeholder names.
  for (const g of gpus) {
    if (!g.name && glRenderer && (g.vendor === detectGpuVendor(glRenderer) || g.vendor === 'unknown')) {
      g.name = glRenderer.replace(/\s*\(.*?\)\s*$/, '').trim() || glRenderer
    }
    // Last-resort label so the UI never has to print "Device 1111".
    if (!g.name) {
      if (g.vendorId && g.deviceId) g.name = `${g.vendorName || g.vendor || 'Unknown vendor'} [${g.vendorId}:${g.deviceId}]`
      else if (g.vendorName) g.name = `${g.vendorName} GPU`
    }
  }

  // Sort virtual / paravirtual GPUs to the back, real silicon first.
  return gpus
    .filter((g) => g.name || g.vendorId)
    .map(({ slot, vendorName, vendorId, deviceId, driver, ...keep }) => ({
      ...keep,
      vendorName: vendorName || null,
      vendorId: vendorId || null,
      deviceId: deviceId || null,
      driver: driver || null,
    }))
    .sort((a, b) => {
      const av = isVirtualGpu(a.name || '', '')
      const bv = isVirtualGpu(b.name || '', '')
      if (av !== bv) return av ? 1 : -1
      return 0
    })
}

async function probeLinuxDrives() {
  // First try lsblk JSON — fast and well-supported. Include SERIAL and
  // VENDOR so we can disambiguate identical models, and don't filter to
  // type=disk too aggressively (nvme namespaces are sometimes reported
  // as different types depending on lsblk version).
  const lsblk = await runCommand('lsblk', ['-bdJ', '-o', 'NAME,SIZE,ROTA,TYPE,MODEL,TRAN,VENDOR,SERIAL'], { timeoutMs: 4000 })
  const drives = []
  if (lsblk.ok) {
    const parsed = safeJsonParse(lsblk.stdout)
    if (parsed?.blockdevices) {
      for (const d of parsed.blockdevices) {
        if (d.type && d.type !== 'disk' && d.type !== 'rom' && !/^nvme/i.test(d.name || '')) continue
        if (d.type === 'rom') continue
        // Skip loop / ram / dm devices.
        if (/^(loop|ram|dm-|sr|fd)/.test(d.name || '')) continue
        const rota = d.rota === '0' || d.rota === false || d.rota === 0
        drives.push({
          model: (d.model || d.vendor || null)?.trim() || null,
          sizeBytes: Number(d.size) || null,
          mediaType: d.tran === 'nvme' ? 'nvme' : (rota ? 'hdd' : 'ssd'),
          interfaceType: d.tran || null,
          busType: d.tran || null,
          serial: (d.serial || '').trim() || null,
        })
      }
    }
  }

  // Cross-check with /sys/block — catches drives that lsblk hid (e.g.
  // mmcblk on chromebooks, virtio-blk, NVMe namespaces reported with an
  // unexpected type). We only add ones not already seen by serial+model.
  try {
    for (const name of fs.readdirSync('/sys/block')) {
      if (/^(loop|ram|dm-|sr|fd)/.test(name)) continue
      const sizeRaw = readFileSafe(`/sys/block/${name}/size`)
      const rotaRaw = readFileSafe(`/sys/block/${name}/queue/rotational`)
      const model = (readFileSafe(`/sys/block/${name}/device/model`) || '').trim()
      const vendor = (readFileSafe(`/sys/block/${name}/device/vendor`) || '').trim()
      const serial = (readFileSafe(`/sys/block/${name}/device/serial`) || '').trim()
      const isNvme = /^nvme/i.test(name)
      const sizeBytes = sizeRaw ? Number(sizeRaw.trim()) * 512 : null
      if (!sizeBytes) continue
      const already = drives.find((d) =>
        (serial && d.serial === serial)
        || (model && d.model === model && d.sizeBytes === sizeBytes)
      )
      if (already) continue
      drives.push({
        model: model || vendor || null,
        sizeBytes,
        mediaType: isNvme ? 'nvme' : (rotaRaw?.trim() === '0' ? 'ssd' : 'hdd'),
        interfaceType: isNvme ? 'nvme' : null,
        busType: isNvme ? 'nvme' : null,
        serial: serial || null,
      })
    }
  } catch { /* /sys/block missing — non-fatal */ }

  return drives
}

function probeLinuxVolumes() {
  // statfs each mount we know about; cheap enough.
  const mounts = readFileSafe('/proc/mounts') || ''
  const seen = new Set()
  const out = []
  for (const line of mounts.split('\n')) {
    const parts = line.split(/\s+/)
    const mount = parts[1]
    const fsType = parts[2]
    if (!mount || seen.has(mount)) continue
    if (!/^(ext|xfs|btrfs|f2fs|zfs|ntfs|vfat|exfat)/i.test(fsType || '')) continue
    seen.add(mount)
    try {
      const st = fs.statfsSync(mount)
      out.push({
        mount,
        sizeBytes: st.blocks * st.bsize,
        freeBytes: st.bavail * st.bsize,
        fs: fsType,
      })
    } catch {}
    if (out.length >= 16) break
  }
  return out
}

async function probeLinuxDisplays() {
  const xrandr = await runCommand('xrandr', ['--current'], { timeoutMs: 2000 })
  if (!xrandr.ok) return []
  const displays = []
  for (const line of xrandr.stdout.split('\n')) {
    const m = line.match(/^\s*(\d+)x(\d+)\s+([\d.]+)\*/)
    if (m) {
      displays.push({
        label: null,
        width: Number(m[1]),
        height: Number(m[2]),
        refreshHz: Math.round(Number(m[3])),
      })
    }
  }
  return displays
}

async function probeLinuxVulkan() {
  const vk = await runCommand('vulkaninfo', ['--summary'], { timeoutMs: 3000 })
  if (!vk.ok) return null
  const m = vk.stdout.match(/Vulkan Instance Version:\s*([\d.]+)/i)
  return m ? m[1] : null
}

async function probeLinuxOpenGL() {
  const gl = await runCommand('glxinfo', ['-B'], { timeoutMs: 3000 })
  if (!gl.ok) return null
  const m = gl.stdout.match(/OpenGL version string:\s*([^\n]+)/i)
  return m ? m[1].trim() : null
}

async function probeLinuxDistro() {
  const osRelease = readFileSafe('/etc/os-release') || ''
  const name = (osRelease.match(/^PRETTY_NAME="?([^"\n]+)"?/m) || [])[1] || null
  const version = (osRelease.match(/^VERSION_ID="?([^"\n]+)"?/m) || [])[1] || null
  return { name, version }
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function detectGpuVendor(name) {
  const lower = (name || '').toLowerCase()
  if (lower.includes('nvidia') || lower.includes('geforce') || lower.includes('quadro') || lower.includes('rtx') || lower.includes('gtx') || lower.includes('10de')) return 'nvidia'
  if (lower.includes('amd') || lower.includes('radeon') || lower.includes('ati') || lower.includes('1002')) return 'amd'
  if (lower.includes('intel') || lower.includes('arc ') || lower.includes('iris') || lower.includes('uhd') || lower.includes('8086')) return 'intel'
  if (lower.includes('apple')) return 'apple'
  return 'unknown'
}

function inferRamChannels(moduleCount) {
  if (!moduleCount) return null
  if (moduleCount === 1) return 'single'
  if (moduleCount === 2) return 'dual'
  if (moduleCount === 4) return 'quad'
  return `${moduleCount}-module`
}

function computeFingerprint(spec) {
  // Hash the *structurally meaningful* parts of the spec — anything whose
  // change should trigger a "PC has changed, rescan?" prompt. Driver/free-
  // space changes don't count.
  const stable = {
    cpu: spec?.cpu?.model || null,
    cores: spec?.cpu?.cores || null,
    gpus: (spec?.gpus || []).map((g) => g.name).sort(),
    ramTotal: roundToGib(spec?.ram?.totalBytes),
    drives: (spec?.storage?.drives || []).map((d) => `${d.model}|${d.mediaType}|${roundToGib(d.sizeBytes)}`).sort(),
    osName: spec?.os?.name || null,
  }
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 16)
}

function roundToGib(bytes) {
  if (!bytes) return 0
  return Math.round(bytes / (1024 ** 3))
}

// ── Public API ──────────────────────────────────────────────────────────────

async function scanSystemProfile() {
  const startedAt = Date.now()
  let spec
  if (process.platform === 'win32') {
    spec = await scanWindows()
  } else if (process.platform === 'linux') {
    spec = await scanLinux()
  } else {
    // macOS or other — minimal fallback from Node built-ins.
    spec = {
      cpu: { model: os.cpus()[0]?.model || null, vendor: null, arch: os.arch(), cores: null, threads: os.cpus().length, baseClockMhz: os.cpus()[0]?.speed || null },
      gpus: [],
      ram: { totalBytes: os.totalmem(), modules: null, speedMhz: null, channels: null, type: null, formFactor: null },
      storage: { drives: [], volumes: [] },
      os: { platform: process.platform, name: os.type(), version: os.release(), build: null, arch: os.arch(), locale: null },
      displays: [],
      graphics: { directx: null, vulkan: null, opengl: null },
    }
  }
  return {
    version: SPEC_VERSION,
    capturedAt: new Date().toISOString(),
    scanDurationMs: Date.now() - startedAt,
    fingerprint: computeFingerprint(spec),
    spec,
  }
}

function getCachePath(userDataDir) {
  return path.join(userDataDir, 'system-profile.json')
}

function readCachedProfile(userDataDir) {
  try {
    const raw = fs.readFileSync(getCachePath(userDataDir), 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function writeCachedProfile(userDataDir, profile) {
  try {
    fs.writeFileSync(getCachePath(userDataDir), JSON.stringify(profile, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

function buildSummary(profile) {
  // Short, human-friendly string for the comment/forum "summary" tier.
  if (!profile?.spec) return null
  const s = profile.spec
  const cpu = (s.cpu?.model || 'Unknown CPU').replace(/\s+/g, ' ').trim()
  const gpu = s.gpus?.[0]?.name?.replace(/\s+/g, ' ').trim() || 'Unknown GPU'
  const ramGib = Math.round((s.ram?.totalBytes || 0) / (1024 ** 3))
  const ramType = s.ram?.type ? ` ${s.ram.type}` : ''
  const osName = s.os?.name || ''
  return `${gpu} · ${cpu} · ${ramGib}GB${ramType} · ${osName}`.trim()
}

module.exports = {
  SPEC_VERSION,
  scanSystemProfile,
  readCachedProfile,
  writeCachedProfile,
  buildSummary,
  computeFingerprint,
}
