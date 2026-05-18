import type { GameRequirements } from "@/lib/types"

// ── GPU driver freshness ────────────────────────────────────────────────────

/** How old (in days) before we consider the driver stale enough to warn. */
const DRIVER_STALE_THRESHOLD_DAYS = 180

const VENDOR_DRIVER_URLS: Record<string, string> = {
  nvidia: "https://www.nvidia.com/Download/index.aspx",
  amd: "https://www.amd.com/en/support",
  intel: "https://www.intel.com/content/www/us/en/download-center/home.html",
  apple: "https://support.apple.com/en-us/HT213323",
}

/**
 * Parse the driver date string returned by the scanner. Windows WMI returns
 * a DMTF datetime (e.g. "20240115000000.000000-000") for the GPU's driver
 * date; ISO strings are also accepted.
 *
 * Returns null when the input can't be parsed — caller should treat that as
 * "unknown" and skip the warning.
 */
export function parseGpuDriverDate(raw: string | null | undefined): Date | null {
  if (!raw || typeof raw !== "string") return null
  // DMTF: YYYYMMDDHHmmss.ffffff±UUU
  const dmtf = raw.match(/^(\d{4})(\d{2})(\d{2})/)
  if (dmtf) {
    const year = Number(dmtf[1])
    const month = Number(dmtf[2]) - 1
    const day = Number(dmtf[3])
    if (year >= 1990 && year <= 2100 && month >= 0 && month < 12 && day >= 1 && day <= 31) {
      const date = new Date(Date.UTC(year, month, day))
      return Number.isNaN(date.getTime()) ? null : date
    }
  }
  // ISO 8601 or other Date-parsable input
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export type DriverStatus = {
  status: "fresh" | "stale" | "unknown"
  ageDays: number | null
  driverDate: Date | null
  vendor: string | null
  driverPageUrl: string | null
}

export function evaluateGpuDriver(spec: SystemProfile["spec"] | null | undefined): DriverStatus {
  const primary = spec?.gpus?.[0]
  if (!primary) return { status: "unknown", ageDays: null, driverDate: null, vendor: null, driverPageUrl: null }
  const driverDate = parseGpuDriverDate(primary.driverDate)
  const vendor = (primary.vendor || "").toLowerCase()
  const driverPageUrl = VENDOR_DRIVER_URLS[vendor] || null
  if (!driverDate) {
    return { status: "unknown", ageDays: null, driverDate: null, vendor: vendor || null, driverPageUrl }
  }
  const ageDays = Math.floor((Date.now() - driverDate.getTime()) / (1000 * 60 * 60 * 24))
  const status: DriverStatus["status"] = ageDays > DRIVER_STALE_THRESHOLD_DAYS ? "stale" : "fresh"
  return { status, ageDays, driverDate, vendor: vendor || null, driverPageUrl }
}


export type RequirementCheck = {
  component: "cpu" | "gpu" | "ram" | "storage" | "os" | "directx" | "vulkan"
  status: "pass" | "warn" | "fail" | "unknown"
  required: string | null
  have: string | null
  detail?: string
}

export type RequirementVerdict = {
  status: "pass" | "warn" | "fail" | "unknown"
  checks: RequirementCheck[]
  /** Number of hard failures. > 0 means the game won't run. */
  failCount: number
  /** Number of partial/warn matches. */
  warnCount: number
}

// Loose GPU-tier ranking. We don't try to be authoritative — this is a
// coarse "can probably run it" heuristic. A real comparator needs a
// benchmark dataset (Phase 5). Lower index = weaker.
const GPU_TIERS: Array<{ pattern: RegExp; tier: number }> = [
  // Intel iGPU / very old
  { pattern: /\b(hd graphics|uhd graphics|intel hd|intel uhd)\b/i, tier: 1 },
  { pattern: /\b(gt\s*7\d\d|gtx\s*[567]\d\d|hd\s*[567]\d\d\d|r7\s*\d\d\d)\b/i, tier: 2 },
  // Mid-range last-gen
  { pattern: /\b(gtx\s*9\d\d|gtx\s*10[56]0|rx\s*[45]\d\d|rx\s*560|rx\s*570)\b/i, tier: 3 },
  { pattern: /\b(gtx\s*1070|gtx\s*1080|rx\s*580|rx\s*590|rx\s*5[56]00)\b/i, tier: 4 },
  { pattern: /\b(rtx\s*20[567]0|gtx\s*16[567]0|rx\s*5700|rx\s*6[56]00|arc\s*a[35]\d\d)\b/i, tier: 5 },
  { pattern: /\b(rtx\s*30[567]0|rx\s*6[78]00|arc\s*a7\d\d)\b/i, tier: 6 },
  { pattern: /\b(rtx\s*3080|rtx\s*3090|rtx\s*40[67]0|rx\s*79\d\d|rx\s*7800)\b/i, tier: 7 },
  { pattern: /\b(rtx\s*40[89]0|rtx\s*50[89]0)\b/i, tier: 8 },
]

function gpuTier(name: string | null | undefined): number | null {
  if (!name) return null
  for (const entry of GPU_TIERS) {
    if (entry.pattern.test(name)) return entry.tier
  }
  return null
}

function compareCpus(have: string | null, required: string | null): "pass" | "warn" | "unknown" {
  if (!have || !required) return "unknown"
  // Very loose: same family + generation rough match. Without a benchmark
  // table this is mostly informational — we err on the side of "warn".
  const haveLower = have.toLowerCase()
  const reqLower = required.toLowerCase()
  // Intel core family
  const haveCore = haveLower.match(/i([3579])-(\d+)/)
  const reqCore = reqLower.match(/i([3579])-(\d+)/)
  if (haveCore && reqCore) {
    const haveGen = Number(String(haveCore[2]).slice(0, -3)) || 0
    const reqGen = Number(String(reqCore[2]).slice(0, -3)) || 0
    if (Number(haveCore[1]) > Number(reqCore[1])) return "pass"
    if (Number(haveCore[1]) === Number(reqCore[1]) && haveGen >= reqGen) return "pass"
    return "warn"
  }
  // AMD Ryzen
  const haveRyzen = haveLower.match(/ryzen\s*([3579])\s*(\d+)/)
  const reqRyzen = reqLower.match(/ryzen\s*([3579])\s*(\d+)/)
  if (haveRyzen && reqRyzen) {
    return Number(haveRyzen[1]) >= Number(reqRyzen[1]) ? "pass" : "warn"
  }
  return "unknown"
}

function gpuListToArray(value: string | string[] | null | undefined): string[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export function compareToProfile(
  spec: SystemProfile["spec"] | null | undefined,
  requirements: GameRequirements | null | undefined,
): RequirementVerdict {
  const checks: RequirementCheck[] = []
  if (!spec || !requirements) {
    return { status: "unknown", checks, failCount: 0, warnCount: 0 }
  }

  // CPU
  if (requirements.cpu) {
    const status = compareCpus(spec.cpu.model, requirements.cpu)
    checks.push({ component: "cpu", status, required: requirements.cpu, have: spec.cpu.model || null })
  }

  // GPU
  const reqGpus = gpuListToArray(requirements.gpu)
  if (reqGpus.length > 0) {
    const userGpu = spec.gpus[0]?.name || null
    const userTier = gpuTier(userGpu)
    const bestReqTier = Math.min(...reqGpus.map((g) => gpuTier(g) ?? 99))
    let status: RequirementCheck["status"] = "unknown"
    if (userTier != null && bestReqTier !== 99) {
      status = userTier >= bestReqTier ? "pass" : userTier === bestReqTier - 1 ? "warn" : "fail"
    }
    checks.push({
      component: "gpu",
      status,
      required: reqGpus.join(" / "),
      have: userGpu,
    })
  }

  // RAM
  if (requirements.ramGb) {
    const haveGb = (spec.ram.totalBytes || 0) / (1024 ** 3)
    const status: RequirementCheck["status"] =
      haveGb >= requirements.ramGb ? "pass" :
      haveGb >= requirements.ramGb * 0.85 ? "warn" : "fail"
    checks.push({
      component: "ram",
      status,
      required: `${requirements.ramGb} GB`,
      have: `${haveGb.toFixed(1)} GB`,
    })
  }

  // Storage: compared against the largest free volume.
  if (requirements.storageGb) {
    const maxFreeBytes = Math.max(0, ...spec.storage.volumes.map((v) => v.freeBytes || 0))
    const needBytes = requirements.storageGb * (1024 ** 3)
    const status: RequirementCheck["status"] = maxFreeBytes >= needBytes ? "pass" : "fail"
    checks.push({
      component: "storage",
      status,
      required: `${requirements.storageGb} GB free`,
      have: `${(maxFreeBytes / 1024 ** 3).toFixed(1)} GB free (largest drive)`,
    })
  }

  // OS
  if (requirements.os) {
    const reqOses = Array.isArray(requirements.os) ? requirements.os : [requirements.os]
    const haveOs = `${spec.os.name} ${spec.os.version || ""}`.trim()
    const status: RequirementCheck["status"] =
      reqOses.some((r) => haveOs.toLowerCase().includes(String(r).toLowerCase().split(" ")[0])) ? "pass" : "warn"
    checks.push({ component: "os", status, required: reqOses.join(" / "), have: haveOs })
  }

  // DirectX
  if (requirements.directx) {
    const haveDx = Number(spec.graphics.directx) || 0
    const reqDx = Number(requirements.directx.replace(/[^\d.]/g, "")) || 0
    const status: RequirementCheck["status"] =
      reqDx === 0 ? "unknown" : haveDx >= reqDx ? "pass" : "fail"
    checks.push({
      component: "directx",
      status,
      required: `DirectX ${requirements.directx}`,
      have: spec.graphics.directx ? `DirectX ${spec.graphics.directx}` : null,
    })
  }

  const failCount = checks.filter((c) => c.status === "fail").length
  const warnCount = checks.filter((c) => c.status === "warn").length
  const status: RequirementVerdict["status"] =
    failCount > 0 ? "fail" :
    warnCount > 0 ? "warn" :
    checks.length === 0 ? "unknown" : "pass"

  return { status, checks, failCount, warnCount }
}
