// -- UC System Profile scanner - systeminformation backend.
//
// Collects a canonical hardware/OS spec for the local machine via the
// `systeminformation` npm package (cross-platform, no custom parsing).
// The spec shape, SPEC_VERSION, cache format, and module exports are
// identical to the old implementation so main.cjs and the renderer need
// no changes. Vulkan version is still probed via vulkaninfo because si
// does not expose graphics-API version strings.


'use strict'

const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const child_process = require('node:child_process')
const si = require('systeminformation')

const SPEC_VERSION = 3

// -- Helpers

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

function detectGpuVendor(name) {
  const lower = (name || '').toLowerCase()
  if (lower.includes('nvidia') || lower.includes('geforce') || lower.includes('quadro') || lower.includes('rtx') || lower.includes('gtx')) return 'nvidia'
  if (lower.includes('amd') || lower.includes('radeon') || lower.includes('ati')) return 'amd'
  if (lower.includes('intel') || lower.includes('arc ') || lower.includes('iris') || lower.includes('uhd')) return 'intel'
  if (lower.includes('apple')) return 'apple'
  return 'unknown'
}

function isVirtualGpu(name) {
  const text = (name || '').toLowerCase()
  if (!text) return false
  const needles = [
    'oculus', 'meta virtual', 'virtual desktop', 'parsec',
    'microsoft basic display', 'microsoft remote display',
    'iddsampledriver', 'idd ', 'usbmmidd', 'displaylink',
    'remote desktop', 'rdp', 'hyper-v', 'hyperv',
    'vmware', 'virtualbox', 'qxl', 'cirrus',
    'virtual display', 'virtual monitor',
    'spacedesk', 'duet display', 'air display', 'splashtop',
  ]
  return needles.some((n) => text.includes(n))
}

function inferRamChannels(moduleCount) {
  if (!moduleCount) return null
  if (moduleCount === 1) return 'single'
  if (moduleCount === 2) return 'dual'
  if (moduleCount === 4) return 'quad'
  return `${moduleCount}-module`
}

function roundToGib(bytes) {
  if (!bytes) return 0
  return Math.round(bytes / (1024 ** 3))
}

/**
 * Normalise the raw `type` string from si.diskLayout() into our canonical
 * 'nvme' | 'ssd' | 'hdd' | null tag.
 */
function normalizeMediaType(raw) {
  if (!raw) return null
  const lower = String(raw).toLowerCase().trim()
  if (lower === 'nvme' || lower.includes('nvme')) return 'nvme'
  if (lower === 'ssd' || lower.includes('ssd') || lower.includes('solid state')) return 'ssd'
  if (lower === 'hdd' || lower === 'hd' || lower.includes('hdd') || lower.includes('hard disk')) return 'hdd'
  return null
}

// -- Vulkan version probe
// systeminformation does not expose graphics-API version strings, so we keep
// a lightweight vulkaninfo probe (3 s budget, best-effort).

function probeVulkanVersion() {
  return new Promise((resolve) => {
    let stdout = ''
    let done = false
    let proc
    try { proc = child_process.spawn('vulkaninfo', ['--summary'], { windowsHide: true }) } catch { return resolve(null) }
    const timer = setTimeout(() => {
      if (done) return; done = true
      try { proc.kill() } catch {}
      resolve(null)
    }, 3000)
    proc.stdout?.on('data', (d) => { stdout += d })
    proc.on('error', () => { if (done) return; done = true; clearTimeout(timer); resolve(null) })
    proc.on('close', () => {
      if (done) return; done = true; clearTimeout(timer)
      const m = stdout.match(/Vulkan Instance Version:\s*([\d.]+)/i)
      resolve(m ? m[1] : null)
    })
  })
}

// -- Main scanner

async function scanSystemProfile() {
  const startedAt = Date.now()

  // All data-gathering in parallel for a single-pass fast scan.
  const [cpuData, graphicsData, memData, memLayoutData, diskLayoutData, fsSizeData, osInfoData, vulkanVersion] =
    await Promise.all([
      si.cpu().catch(() => ({})),
      si.graphics().catch(() => ({ controllers: [], displays: [] })),
      si.mem().catch(() => ({})),
      si.memLayout().catch(() => []),
      si.diskLayout().catch(() => []),
      si.fsSize().catch(() => []),
      si.osInfo().catch(() => ({})),
      probeVulkanVersion(),
    ])

  // -- CPU
  const cpu = {
    model: cpuData.brand || null,
    vendor: cpuData.manufacturer || null,
    arch: os.arch(),
    cores: cpuData.physicalCores || null,
    threads: cpuData.cores || null,
    // si returns speed in GHz; convert to MHz for the stored spec.
    baseClockMhz: cpuData.speed ? Math.round(cpuData.speed * 1000) : null,
  }

  // -- GPUs
  // Sort virtual / paravirtual adapters to the back; prefer real discrete
  // silicon at index 0 (the entry the renderer uses for "primary GPU").
  const gpus = (graphicsData.controllers || [])
    .filter((g) => g && (g.model || g.vendor))
    .map((g) => ({
      name: g.model || null,
      // si.graphics().controllers[].vram is in MiB; convert to bytes.
      vramBytes: (g.vram && g.vram > 0) ? g.vram * 1024 * 1024 : null,
      vendor: detectGpuVendor(`${g.vendor || ''} ${g.model || ''}`),
      driverVersion: g.driverVersion || null,
      driverDate: null,
      videoProcessor: null,
    }))
    .sort((a, b) => {
      const av = isVirtualGpu(a.name || '')
      const bv = isVirtualGpu(b.name || '')
      if (av !== bv) return av ? 1 : -1
      const aReal = a.vendor === 'nvidia' || a.vendor === 'amd' || a.vendor === 'intel'
      const bReal = b.vendor === 'nvidia' || b.vendor === 'amd' || b.vendor === 'intel'
      if (aReal !== bReal) return aReal ? -1 : 1
      return (b.vramBytes || 0) - (a.vramBytes || 0)
    })

  // -- RAM
  // Filter to populated slots (empty/absent slots report size 0).
  const populated = (memLayoutData || []).filter((m) => m && Number(m.size) > 0)
  const ramSpeedMhz = populated.length
    ? Math.max(...populated.map((m) => Number(m.clockSpeed) || 0)) || null
    : null
  const ramType = pickMostCommon(populated.map((m) => m.type || null).filter(Boolean))
  const ramFormFactor = pickMostCommon(populated.map((m) => m.formFactor || null).filter(Boolean))
  const ram = {
    totalBytes: Number(memData.total) || os.totalmem(),
    modules: populated.length || null,
    speedMhz: ramSpeedMhz,
    channels: inferRamChannels(populated.length),
    type: ramType,
    formFactor: ramFormFactor,
  }

  // -- Storage
  const drives = (diskLayoutData || []).map((d) => ({
    model: (d.name || d.vendor || null)?.trim() || null,
    sizeBytes: Number(d.size) || null,
    mediaType: normalizeMediaType(d.type),
    interfaceType: (d.interfaceType || null)?.toLowerCase() || null,
    busType: (d.interfaceType || null)?.toLowerCase() || null,
    serial: (d.serialNum || '').trim() || null,
  }))

  const volumes = (fsSizeData || [])
    .filter((v) => Number(v.size) > 0 && v.mount)
    .map((v) => ({
      mount: v.mount || null,
      sizeBytes: Number(v.size) || null,
      freeBytes: Number(v.available) || null,
      fs: v.type || null,
      mediaType: null,
      busType: null,
    }))

  // -- OS
  const osSpec = {
    platform: osInfoData.platform || process.platform,
    name: osInfoData.distro || os.type(),
    version: osInfoData.release || os.release(),
    build: osInfoData.build || null,
    arch: osInfoData.arch || os.arch(),
    locale: osInfoData.locale || process.env.LANG || null,
  }

  // -- Displays
  // si.graphics().displays lists currently connected monitors.
  // currentResX/Y is the active mode; resolutionX/Y is the panel max.
  const displays = (graphicsData.displays || [])
    .filter((d) => d && (d.currentResX || d.resolutionX))
    .map((d) => ({
      label: d.model || null,
      width: d.currentResX || d.resolutionX || null,
      height: d.currentResY || d.resolutionY || null,
      refreshHz: d.currentRefreshRate || null,
      manufacturer: d.vendor || null,
      product: d.model || null,
      serial: d.serial || null,
      active: true,
    }))

  // -- Graphics APIs
  // DirectX 12 is implicit on Windows 10+. Vulkan from vulkaninfo probe above.
  const graphics = {
    directx: process.platform === 'win32' ? '12' : null,
    vulkan: vulkanVersion,
    opengl: null,
  }

  const spec = { cpu, gpus, ram, storage: { drives, volumes }, os: osSpec, displays, graphics }

  return {
    version: SPEC_VERSION,
    capturedAt: new Date().toISOString(),
    scanDurationMs: Date.now() - startedAt,
    fingerprint: computeFingerprint(spec),
    spec,
  }
}

// -- Fingerprint

function computeFingerprint(spec) {
  // -- Hash the structurally meaningful parts  driver or free-space changes
  // should not trigger a "PC has changed" prompt.
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

// -- Cache

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
  if (!profile?.spec) return null
  const s = profile.spec
  const cpu = (s.cpu?.model || 'Unknown CPU').replace(/\s+/g, ' ').trim()
  const gpu = s.gpus?.[0]?.name?.replace(/\s+/g, ' ').trim() || 'Unknown GPU'
  const ramGib = Math.round((s.ram?.totalBytes || 0) / (1024 ** 3))
  const ramType = s.ram?.type ? ` ${s.ram.type}` : ''
  const osName = s.os?.name || ''
  // -- return `${gpu}  ${cpu}  ${ramGib}GB${ramType}  ${osName}`.trim()
}

// ---

module.exports = {
  SPEC_VERSION,
  scanSystemProfile,
  readCachedProfile,
  writeCachedProfile,
  buildSummary,
  computeFingerprint,
}
