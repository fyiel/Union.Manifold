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

const SPEC_VERSION = 1

// PowerShell on Windows can be slow on cold starts; give each probe a
// generous budget but never block forever.
const WIN_PS_TIMEOUT_MS = 8000
const NIX_CMD_TIMEOUT_MS = 4000

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

async function runPS(script) {
  // -NoProfile keeps cold start fast; ConvertTo-Json gives us structured output.
  return runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    timeoutMs: WIN_PS_TIMEOUT_MS,
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

async function scanWindows() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$cs   = Get-CimInstance Win32_ComputerSystem
$os_  = Get-CimInstance Win32_OperatingSystem
$cpu  = Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed,Manufacturer,Architecture
$gpu  = Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion,DriverDate,VideoProcessor
$mem  = Get-CimInstance Win32_PhysicalMemory | Select-Object Capacity,Speed,ConfiguredClockSpeed,Manufacturer,PartNumber
$disk = Get-CimInstance Win32_DiskDrive | Select-Object Model,Size,MediaType,InterfaceType
$vol  = Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,Size,FreeSpace,FileSystem
# Storage-Spaces-aware drive-letter → physical-media map. Storage cmdlets are
# present on Win8+; we ignore failures so older systems still produce a result.
$volMedia = @()
try {
  $volMedia = Get-Partition -ErrorAction SilentlyContinue | Where-Object { $_.DriveLetter } | ForEach-Object {
    $disk = $_ | Get-Disk -ErrorAction SilentlyContinue
    $pdisk = $null
    if ($disk) { $pdisk = $disk | Get-PhysicalDisk -ErrorAction SilentlyContinue }
    @{
      Letter    = "$($_.DriveLetter):"
      MediaType = if ($pdisk) { $pdisk.MediaType } else { $null }
      BusType   = if ($pdisk) { $pdisk.BusType }   else { $null }
    }
  }
} catch { }
$mon  = Get-CimInstance Win32_VideoController | ForEach-Object { @{ Name=$_.Name; HRes=$_.CurrentHorizontalResolution; VRes=$_.CurrentVerticalResolution; Refresh=$_.CurrentRefreshRate } }
$out = @{
  cs=$cs; os=$os_; cpu=$cpu; gpu=$gpu; mem=$mem; disk=$disk; vol=$vol; display=$mon; volMedia=$volMedia
}
$out | ConvertTo-Json -Depth 5 -Compress
`
  const result = await runPS(script)
  const parsed = safeJsonParse(result.stdout) || {}

  const cpus = toArray(parsed.cpu)
  const cpu = cpus[0] || {}
  const archMap = { 0: 'x86', 5: 'arm', 6: 'ia64', 9: 'x64', 12: 'arm64' }

  const gpus = toArray(parsed.gpu).map((g) => ({
    name: g?.Name || null,
    vramBytes: Number(g?.AdapterRAM) || null,
    vendor: detectGpuVendor(g?.Name || ''),
    driverVersion: g?.DriverVersion || null,
    driverDate: g?.DriverDate || null,
    videoProcessor: g?.VideoProcessor || null,
  }))

  const memModules = toArray(parsed.mem)
  const ramTotalBytes = memModules.reduce((sum, m) => sum + (Number(m?.Capacity) || 0), 0)
    || (Number(parsed.cs?.TotalPhysicalMemory) || os.totalmem() || 0)
  const ramSpeedMhz = memModules.length
    ? Math.max(...memModules.map((m) => Number(m?.ConfiguredClockSpeed) || Number(m?.Speed) || 0))
    : null

  const drives = toArray(parsed.disk).map((d) => ({
    model: d?.Model || null,
    sizeBytes: Number(d?.Size) || null,
    mediaType: normalizeWindowsMediaType(d?.MediaType, d?.Model),
    interfaceType: d?.InterfaceType || null,
  }))

  const volMediaMap = new Map()
  for (const entry of toArray(parsed.volMedia)) {
    if (entry?.Letter) volMediaMap.set(String(entry.Letter).toUpperCase(), {
      mediaType: normalizeStorageMediaType(entry.MediaType),
      busType: entry.BusType || null,
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

  const displays = toArray(parsed.display)
    .filter((d) => d?.HRes && d?.VRes)
    .map((d) => ({
      label: d?.Name || null,
      width: Number(d.HRes) || null,
      height: Number(d.VRes) || null,
      refreshHz: Number(d.Refresh) || null,
    }))

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
      modules: memModules.length,
      speedMhz: ramSpeedMhz,
      channels: inferRamChannels(memModules.length),
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
 * canonical `'nvme' | 'ssd' | 'hdd' | 'unspecified' | null` tagging.
 * Get-PhysicalDisk's MediaType property uses numeric codes (3=HDD, 4=SSD,
 * 5=SCM) or strings depending on Windows version, so we accept both.
 */
function normalizeStorageMediaType(value) {
  if (value == null) return null
  const text = String(value).toLowerCase()
  if (text.includes('nvme')) return 'nvme'
  if (text === 'ssd' || text === '4' || text.includes('solid state')) return 'ssd'
  if (text === 'hdd' || text === '3' || text.includes('hard disk') || text.includes('rotational')) return 'hdd'
  if (text === '5' || text === 'scm') return 'scm'
  if (text === '0' || text === 'unspecified') return null
  return null
}

function normalizeWindowsMediaType(media, model) {
  const text = `${media || ''} ${model || ''}`.toLowerCase()
  if (text.includes('nvme')) return 'nvme'
  if (text.includes('ssd') || text.includes('solid state')) return 'ssd'
  if (text.includes('hdd') || text.includes('hard disk') || text.includes('fixed hard')) return 'hdd'
  if (text.includes('removable')) return 'removable'
  return media || null
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
  return {
    totalBytes: totalKb ? totalKb * 1024 : (os.totalmem() || 0),
    modules: null,
    speedMhz: null,
    channels: null,
  }
}

async function probeLinuxGpus() {
  const lspci = await runCommand('lspci', ['-mm'], {})
  if (!lspci.ok) return []
  const lines = lspci.stdout.split('\n')
  const gpus = []
  for (const line of lines) {
    if (!/VGA|3D|Display/i.test(line)) continue
    // Format: "00:02.0 "VGA compatible controller" "Intel Corporation" "Device Name" ...
    const parts = line.match(/"([^"]*)"/g)?.map((s) => s.slice(1, -1)) || []
    const vendor = parts[1] || null
    const name = parts[2] || null
    if (!name) continue
    gpus.push({
      name,
      vendor: detectGpuVendor(`${vendor} ${name}`),
      vramBytes: null,
      driverVersion: null,
      driverDate: null,
    })
  }
  return gpus
}

async function probeLinuxDrives() {
  const lsblk = await runCommand('lsblk', ['-bdJ', '-o', 'NAME,SIZE,ROTA,TYPE,MODEL,TRAN'], {})
  if (!lsblk.ok) return []
  const parsed = safeJsonParse(lsblk.stdout)
  if (!parsed?.blockdevices) return []
  return parsed.blockdevices
    .filter((d) => d.type === 'disk')
    .map((d) => ({
      model: d.model || null,
      sizeBytes: Number(d.size) || null,
      mediaType: d.tran === 'nvme' ? 'nvme' : (d.rota === '0' || d.rota === false) ? 'ssd' : 'hdd',
      interfaceType: d.tran || null,
    }))
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
  if (lower.includes('nvidia') || lower.includes('geforce') || lower.includes('quadro') || lower.includes('rtx') || lower.includes('gtx')) return 'nvidia'
  if (lower.includes('amd') || lower.includes('radeon') || lower.includes('ati')) return 'amd'
  if (lower.includes('intel') || lower.includes('arc ') || lower.includes('iris') || lower.includes('uhd')) return 'intel'
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
      ram: { totalBytes: os.totalmem(), modules: null, speedMhz: null, channels: null },
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
  const osName = s.os?.name || ''
  return `${gpu} · ${cpu} · ${ramGib}GB · ${osName}`.trim()
}

module.exports = {
  SPEC_VERSION,
  scanSystemProfile,
  readCachedProfile,
  writeCachedProfile,
  buildSummary,
  computeFingerprint,
}
