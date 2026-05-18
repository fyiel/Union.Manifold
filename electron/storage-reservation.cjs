// Storage reservation for concurrent downloads + extraction.
//
// A "reservation" represents bytes UC.D has committed to keep available
// for an in-flight download or extraction. Because we always extract the
// archive into the same drive after download completes, each reservation
// carries TWO numbers: downloadBytes (archive on disk) and extractBytes
// (extracted game). The total reserved equals their sum until the
// download finishes; once the archive is deleted post-extraction, the
// caller calls releaseDownload() so only extractBytes remains held; then
// the install completion calls release() to drop the whole reservation.
//
// Reservations are per-mount, identified by the drive root that contains
// the target path. We snapshot disk free space at reserve time and never
// trust subsequent fs.statfsSync(): freeBytes - reserved is what's
// actually available to a new download.

const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_EXTRACTION_RATIO = 2.0   // extracted ≈ archive * 2 unless metadata says otherwise
const DEFAULT_SAFETY_BUFFER = 2 * 1024 ** 3 // 2 GiB headroom on top of the estimate
const SAFETY_BUFFER_RATIO = 0.05       // or 5% of estimate, whichever is larger

const reservations = new Map() // id -> { mountRoot, downloadBytes, extractBytes, status }

function getMountRoot(targetPath) {
  if (!targetPath) return null
  if (process.platform === 'win32') {
    // C:\foo\bar -> C:\
    const match = String(targetPath).match(/^([A-Za-z]):/)
    return match ? `${match[1].toUpperCase()}:\\` : null
  }
  // POSIX: walk up until we find an existing parent. We'll use the
  // top-level filesystem boundary later via statfs, but for keying we
  // just normalize the absolute path's first segment.
  const abs = path.resolve(targetPath)
  return '/' // single-root reservation keying on Linux is fine for our use
}

function getFreeBytesAtPath(targetPath) {
  try {
    let current = targetPath
    while (current && !fs.existsSync(current)) {
      const parent = path.dirname(current)
      if (!parent || parent === current) return null
      current = parent
    }
    if (!current) return null
    const st = fs.statfsSync(current)
    return st.bavail * st.bsize
  } catch {
    return null
  }
}

function sumActiveReservations(mountRoot, excludeId = null) {
  let download = 0
  let extract = 0
  for (const [id, r] of reservations) {
    if (id === excludeId) continue
    if (r.mountRoot !== mountRoot) continue
    if (r.status === 'released') continue
    if (r.status !== 'extracting') download += r.downloadBytes || 0
    extract += r.extractBytes || 0
  }
  return { download, extract, total: download + extract }
}

function estimateExtractionBytes(downloadBytes, declaredInstallBytes) {
  // Prefer the declared installed size from the game's metadata when we
  // trust it; otherwise assume 2x the archive — that's the worst common
  // case for 7z/zip archives of games and what we already use elsewhere.
  const fromDeclared = Number(declaredInstallBytes) || 0
  const fromArchive = Math.round((Number(downloadBytes) || 0) * DEFAULT_EXTRACTION_RATIO)
  const estimate = Math.max(fromDeclared, fromArchive)
  const buffer = Math.max(DEFAULT_SAFETY_BUFFER, Math.round(estimate * SAFETY_BUFFER_RATIO))
  return estimate + buffer
}

/**
 * @param {object} opts
 * @param {string} opts.targetPath   Where the archive will be written
 * @param {number} opts.downloadBytes Expected archive size in bytes (best estimate)
 * @param {number} [opts.declaredInstallBytes] Optional installed size from game metadata
 * @returns {{ ok: boolean, requiredBytes: number, freeBytes: number, shortfallBytes: number,
 *            downloadBytes: number, extractBytes: number, alreadyReservedBytes: number,
 *            availableAfterReservation: number, mountRoot: string|null }}
 */
function precheck({ targetPath, downloadBytes, declaredInstallBytes }) {
  const mountRoot = getMountRoot(targetPath)
  const freeBytes = getFreeBytesAtPath(targetPath) || 0
  const extractBytes = estimateExtractionBytes(downloadBytes, declaredInstallBytes)
  const requiredBytes = (Number(downloadBytes) || 0) + extractBytes
  const existing = sumActiveReservations(mountRoot)
  const availableAfterReservation = freeBytes - existing.total
  const shortfallBytes = Math.max(0, requiredBytes - availableAfterReservation)
  return {
    ok: shortfallBytes === 0,
    requiredBytes,
    freeBytes,
    shortfallBytes,
    downloadBytes: Number(downloadBytes) || 0,
    extractBytes,
    alreadyReservedBytes: existing.total,
    availableAfterReservation,
    mountRoot,
  }
}

/**
 * Commit a reservation. Caller passes the same id (typically downloadId
 * or appid+version) for later transitions/release. Returns the same
 * check shape as precheck() but with ok=false if the reservation could
 * not be honored.
 */
function reserve(id, opts) {
  if (!id) throw new Error('reserve requires an id')
  if (reservations.has(id)) {
    // Idempotent: return the existing reservation summary.
    const existing = reservations.get(id)
    return {
      ok: true,
      already: true,
      requiredBytes: (existing.downloadBytes || 0) + (existing.extractBytes || 0),
      downloadBytes: existing.downloadBytes,
      extractBytes: existing.extractBytes,
      mountRoot: existing.mountRoot,
      freeBytes: getFreeBytesAtPath(opts.targetPath) || 0,
      shortfallBytes: 0,
      alreadyReservedBytes: sumActiveReservations(existing.mountRoot, id).total,
      availableAfterReservation: (getFreeBytesAtPath(opts.targetPath) || 0) - sumActiveReservations(existing.mountRoot, id).total,
    }
  }
  const check = precheck(opts)
  if (!check.ok) return { ...check, ok: false }
  reservations.set(id, {
    mountRoot: check.mountRoot,
    downloadBytes: check.downloadBytes,
    extractBytes: check.extractBytes,
    status: 'downloading',
    createdAt: Date.now(),
  })
  return { ...check, ok: true }
}

/** Transition: download is complete, extraction has started. Free the
 *  archive bytes (they'll be reused by the extracted output) but keep
 *  the extract bytes pinned. */
function markExtracting(id) {
  const r = reservations.get(id)
  if (!r) return false
  r.status = 'extracting'
  return true
}

/** Drop the entire reservation (download complete + archive deleted, or
 *  cancelled, or errored). */
function release(id) {
  return reservations.delete(id)
}

function get(id) {
  return reservations.get(id) || null
}

function snapshot() {
  return [...reservations.entries()].map(([id, r]) => ({ id, ...r }))
}

function summaryForPath(targetPath) {
  const mountRoot = getMountRoot(targetPath)
  const freeBytes = getFreeBytesAtPath(targetPath) || 0
  const existing = sumActiveReservations(mountRoot)
  return {
    mountRoot,
    freeBytes,
    reservedBytes: existing.total,
    reservedDownloadBytes: existing.download,
    reservedExtractBytes: existing.extract,
    availableBytes: freeBytes - existing.total,
  }
}

module.exports = {
  precheck,
  reserve,
  markExtracting,
  release,
  get,
  snapshot,
  summaryForPath,
  estimateExtractionBytes,
  getMountRoot,
}
