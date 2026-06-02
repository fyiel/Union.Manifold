'use strict'

/**
 * UC.Direct download engine.
 *
 * One job: download a file (one URL, one file on disk) with queue + resume.
 *
 * Resume strategy is dead-simple:
 *   1. Caller hands us { appid, gameName, url, filename, totalBytes }.
 *   2. We compute a canonical savePath under installing/<folder>/<filename>.
 *   3. Before starting, look for any partial on disk (live file, .crdownload,
 *      or the .ucresume hardlink). If found, rename to canonical savePath and
 *      use createInterruptedDownload from its size. Otherwise, plain
 *      downloadURL from byte 0.
 *
 * The engine owns the will-download listener on whatever session we're given.
 * It does NOT extract archives — when a download completes, it emits a
 * 'complete' event that main.cjs hooks to drive the existing extraction code.
 *
 * No multipart, no auth headers, no per-host special casing. UC.Files only.
 */

const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')
const { URL: NodeURL } = require('url')
const EventEmitter = require('events')

const RESUME_BACKUP_EXT = '.ucresume'

// Filenames that the metadata cacher writes alongside the archive. Matched by
// stem so any extension (jpg/png/webp/avif/gif/svg/…) is treated as a sidecar.
const SIDECAR_STEMS = new Set([
  'image',
  'splash',
  'hero-image',
  'hero-animated',
  'hero-logo',
  'background-image',
])
const SIDECAR_DIRS = new Set(['screenshots'])
// Image/video/document extensions a download archive never has. Anything with
// these extensions in the installing folder is sidecar metadata, never a
// resumable partial — even if its byte count happens to be the largest.
const NON_ARCHIVE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.svg', '.bmp', '.ico',
  '.mp4', '.webm', '.mov', '.mkv',
  '.json', '.txt', '.md', '.log', '.html', '.htm', '.css', '.js',
])

function isSidecar(name, manifestName) {
  const lower = String(name || '').toLowerCase()
  if (lower === manifestName.toLowerCase()) return true
  if (SIDECAR_DIRS.has(lower)) return true
  const dot = lower.lastIndexOf('.')
  const stem = dot >= 0 ? lower.slice(0, dot) : lower
  const ext = dot >= 0 ? lower.slice(dot) : ''
  if (SIDECAR_STEMS.has(stem)) return true
  // Catalog assets the main process caches use this stem prefix too, e.g.
  // "image@2x.jpg" or "hero-logo-light.png".
  for (const s of SIDECAR_STEMS) {
    if (stem === s || stem.startsWith(s + '-') || stem.startsWith(s + '@')) return true
  }
  // Anything with a clearly non-archive extension can't be the partial.
  if (NON_ARCHIVE_EXTS.has(ext)) return true
  return false
}

function statOrNull(p) {
  try { return fs.statSync(p) } catch { return null }
}

function safeUnlink(p) {
  try { if (fs.existsSync(p)) fs.unlinkSync(p) } catch { /* ignore */ }
}

function safeRename(from, to) {
  try { fs.renameSync(from, to); return true } catch { return false }
}

class DownloadEngine extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.installingRoot   - absolute path of installing folder root
   * @param {string} opts.manifestName     - basename of the installing manifest (installed.json)
   * @param {function} opts.safeFolderName - main's `safeFolderName` helper
   * @param {function} [opts.log]          - logger (level: 'info'|'warn'|'error', message)
   * @param {boolean} [opts.singleActive]  - serialise downloads (default: true)
   */
  constructor({ installingRoot, manifestName, safeFolderName, log, singleActive = true, aria2 = null }) {
    super()
    if (!installingRoot) throw new Error('installingRoot required')
    if (!manifestName) throw new Error('manifestName required')
    if (!safeFolderName) throw new Error('safeFolderName helper required')

    this.installingRoot = installingRoot
    this.manifestName = manifestName
    this.safeFolderName = safeFolderName
    this.log = typeof log === 'function' ? log : () => {}
    this.singleActive = singleActive

    /**
     * Optional aria2 backend (Hydra-style). When present AND ready, downloads
     * are handed to a background aria2c daemon over RPC instead of being pumped
     * through this (main-process) Node code — keeping the UI responsive while a
     * game runs. aria2 writes to the very same installing/<game>/<file> path, so
     * partial adoption, extraction handoff, queue, and events are all unchanged.
     * If it's null or not ready we transparently fall back to the in-process
     * downloader, so nothing regresses when the binary isn't bundled.
     * @type {import('./aria2-manager.cjs').Aria2Manager | null}
     */
    this.aria2 = aria2
    /** aria2 gid -> downloadId, for routing poll results back to a Download. */
    this._gidToId = new Map()
    /** Handle for the shared aria2 status poller (one timer for all downloads). */
    this._aria2PollTimer = null

    /**
     * Bandwidth cap in bytes per second (0 / null = unlimited). Settable at
     * runtime via setBandwidthLimit() so the user can toggle a cap from
     * Settings without restarting the launcher. Used to pause the active
     * response stream when we exceed the cap over a 1s sliding window.
     */
    this.bandwidthLimitBps = 0

    /** @type {Map<string, Download>} */ this.byId = new Map()
    /** @type {string[]} */ this.queue = []
    /** @type {string|null} */ this.activeId = null

    /** Cancelled ids so a late `done` event doesn't get treated as a quit-cancel. */
    this.cancelledIds = new Set()

    /** url string -> downloadId. Lets will-download find which Download we just kicked off. */
    this._pendingByUrl = new Map()
    /** downloadId -> Electron DownloadItem (in-memory while running) */
    this._itemById = new Map()
    /** downloadId -> { lastBytes, lastTime, speedBps } */
    this._stateById = new Map()

    /** Sessions we've attached our will-download listener to. */
    this._attachedSessions = new WeakSet()
  }

  /** Attach the will-download listener on a session. Idempotent per session. */
  attachSession(session) {
    if (!session || this._attachedSessions.has(session)) return
    this._attachedSessions.add(session)
    session.on('will-download', (event, item) => this._onWillDownload(item))
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Enqueue a download. Returns the assigned downloadId.
   * `webContents` is the page that should host the download (usually mainWindow).
   */
  enqueue({ webContents, appid, gameName, url, filename, totalBytes, id }) {
    if (!webContents) throw new Error('webContents required')
    if (!appid) throw new Error('appid required')
    if (!url || typeof url !== 'string') throw new Error('url required')

    const downloadId = id || `${appid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}-0`
    if (this.byId.has(downloadId)) {
      this.log('warn', `[engine] enqueue: id ${downloadId} already exists`)
      return downloadId
    }

    const installingDir = this._ensureInstallingDir(gameName, appid)
    const resolvedFilename = this._resolveFilename({ installingDir, filename, url, gameName, appid })
    const savePath = path.join(installingDir, resolvedFilename)

    /** @type {Download} */
    const dl = {
      id: downloadId,
      appid,
      gameName: gameName || null,
      url,
      filename: resolvedFilename,
      savePath,
      installingDir,
      totalBytes: Number(totalBytes) > 0 ? Number(totalBytes) : 0,
      receivedBytes: 0,
      speedBps: 0,
      etaSeconds: null,
      status: 'queued',
      error: null,
      createdAt: Date.now(),
      startedAt: null,
      webContents,
    }

    this.byId.set(downloadId, dl)

    // Adopt any partial already on disk *now*, before the download is queued or
    // _kickOff runs. _kickOff also locates the partial, but only once it
    // actually starts — and a resume that lands behind another active download
    // stays queued, so its offset would be reported as 0. The renderer's resume
    // cascade then mistakes that for a fresh start and the ~GB partial is thrown
    // away, restarting from byte 0 (and often racing into a fail→cancel). By
    // promoting the partial here, receivedBytes is correct the instant we
    // enqueue, regardless of when _kickOff fires.
    try {
      const partial = this._findPartial(dl)
      if (partial) {
        if (partial.path !== dl.savePath) safeRename(partial.path, dl.savePath)
        const st = statOrNull(dl.savePath)
        if (st && st.isFile()) dl.receivedBytes = st.size
      }
    } catch { /* ignore — _kickOff will retry the same discovery */ }

    this.queue.push(downloadId)
    this.emit('update', this._publicView(dl))
    this._writeManifestSnapshot(dl)
    this._maybeStartNext()
    return downloadId
  }

  pause(downloadId) {
    const dl = this.byId.get(downloadId)
    if (!dl) return false
    if (dl.status === 'queued') {
      dl.status = 'paused'
      this.queue = this.queue.filter((x) => x !== downloadId)
      this.emit('update', this._publicView(dl))
      this._writeManifestSnapshot(dl)
      return true
    }
    if (dl.status !== 'downloading') return false
    // aria2-owned download: pause via RPC. The poller will reflect the paused
    // status; set it optimistically so the UI flips immediately.
    if (dl._gid && this.aria2) {
      try { this.aria2.pause(dl._gid).catch(() => {}) } catch { /* ignore */ }
      dl.status = 'paused'
      dl.speedBps = 0
      dl.etaSeconds = null
      this.emit('update', this._publicView(dl))
      this._writeManifestSnapshot(dl)
      return true
    }
    const item = this._itemById.get(downloadId)
    if (item && typeof item.pause === 'function') {
      try { item.pause() } catch { /* ignore */ }
    }
    // If this download is running via the manual Range-resume code path,
    // there's no Electron DownloadItem to pause — abort the HTTP stream
    // directly. The handler in _startRangeResume will flip status to paused
    // and emit the update.
    if (typeof dl._rangeAbort === 'function') {
      try { dl._rangeAbort('pause') } catch { /* ignore */ }
    } else {
      dl.status = 'paused'
      dl.speedBps = 0
      dl.etaSeconds = null
      this.emit('update', this._publicView(dl))
      this._writeManifestSnapshot(dl)
    }
    return true
  }

  resume(downloadId) {
    const dl = this.byId.get(downloadId)
    if (!dl) return false

    // Already live in the engine — re-emit current state and report success
    // instead of re-kicking. This guards the Ctrl+R case: the renderer reloads
    // and restores the download as "paused" even though the main-process stream
    // never stopped, then walks its resume cascade. Without this, resume()
    // returns false for a still-"downloading" item, the renderer escalates to
    // the re-resolve / fresh-start path, that races the live stream, and a
    // follow-up cancel wipes the partial — forcing a restart from byte 0.
    if (dl.status === 'downloading' || dl.status === 'queued') {
      this.emit('update', this._publicView(dl))
      return true
    }

    if (dl.status !== 'paused' && dl.status !== 'failed' && dl.status !== 'cancelled') return false

    // aria2-owned download with a live gid (same session): just unpause.
    if (dl._gid && this.aria2 && this.aria2.isReady()) {
      try { this.aria2.unpause(dl._gid).catch(() => {}) } catch { /* ignore */ }
      dl.status = 'downloading'
      dl.startedAt = Date.now()
      this.emit('update', this._publicView(dl))
      this._ensureAria2Poller()
      return true
    }

    const item = this._itemById.get(downloadId)
    if (item && typeof item.resume === 'function' && typeof item.isPaused === 'function' && item.isPaused()) {
      // In-memory resume — the Chromium DownloadItem is still alive.
      try { item.resume() } catch { /* ignore */ }
      dl.status = 'downloading'
      dl.startedAt = Date.now()
      this.emit('update', this._publicView(dl))
      return true
    }

    // No in-memory item — re-kick. _kickOff inspects disk and picks resume-from-partial
    // vs fresh-start automatically.
    dl.status = 'queued'
    if (!this.queue.includes(downloadId)) this.queue.unshift(downloadId)
    this.emit('update', this._publicView(dl))
    this._maybeStartNext()
    return true
  }

  cancel(downloadId, { keepFile = false } = {}) {
    const dl = this.byId.get(downloadId)
    if (!dl) return false
    this.cancelledIds.add(downloadId)
    // Auto-clean cancellation marker after 5 minutes
    setTimeout(() => this.cancelledIds.delete(downloadId), 5 * 60 * 1000)

    const item = this._itemById.get(downloadId)
    if (item && typeof item.cancel === 'function') {
      try { item.cancel() } catch { /* ignore */ }
    }
    this._itemById.delete(downloadId)
    // Abort the manual Range stream too, if this is a resume-in-progress.
    if (typeof dl._rangeAbort === 'function') {
      try { dl._rangeAbort('cancel') } catch { /* ignore */ }
    }
    // aria2-owned download: remove it from the daemon so it stops writing.
    if (dl._gid && this.aria2) {
      const gid = dl._gid
      dl._gid = null
      this._gidToId.delete(gid)
      try { this.aria2.forceRemove(gid).catch(() => {}) } catch { /* ignore */ }
      try { this.aria2.removeDownloadResult(gid).catch(() => {}) } catch { /* ignore */ }
    }

    if (!keepFile && dl.savePath) {
      safeUnlink(dl.savePath)
      safeUnlink(dl.savePath + '.crdownload')
      safeUnlink(dl.savePath + RESUME_BACKUP_EXT)
    }

    dl.status = 'cancelled'
    dl.speedBps = 0
    dl.etaSeconds = null
    dl.error = null

    this.queue = this.queue.filter((x) => x !== downloadId)
    if (this.activeId === downloadId) this.activeId = null

    this.emit('update', this._publicView(dl))
    this.emit('cancel', this._publicView(dl))
    this._maybeStartNext()
    return true
  }

  get(downloadId) {
    const dl = this.byId.get(downloadId)
    return dl ? this._publicView(dl) : null
  }

  list() {
    return Array.from(this.byId.values()).map((dl) => this._publicView(dl))
  }

  /** Look up the active in-memory Electron DownloadItem (for graceful-quit preservation). */
  getItem(downloadId) {
    return this._itemById.get(downloadId) || null
  }

  /** True if this download was cancelled via the cancel() API (vs. quit-induced cancel). */
  wasUserCancelled(downloadId) {
    return this.cancelledIds.has(downloadId)
  }

  /** Mark a download as paused without touching Chromium — used during graceful quit. */
  markPausedForShutdown(downloadId, reason) {
    const dl = this.byId.get(downloadId)
    if (!dl) return false
    dl.status = 'paused'
    dl.error = reason || 'App closed. Resume to continue downloading.'
    dl.speedBps = 0
    dl.etaSeconds = null
    this._writeManifestSnapshot(dl)
    return true
  }

  // ── Internals ───────────────────────────────────────────────────────────

  _ensureInstallingDir(gameName, appid) {
    const folder = this.safeFolderName(gameName || appid || 'unknown')
    const dir = path.join(this.installingRoot, folder)
    try { fs.mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
    return dir
  }

  _resolveFilename({ installingDir, filename, url, gameName, appid }) {
    if (filename && typeof filename === 'string' && filename.trim()) return filename.trim()
    // Try the manifest snapshot (we may have written one during a prior session).
    try {
      const manifestPath = path.join(installingDir, this.manifestName)
      if (fs.existsSync(manifestPath)) {
        const raw = fs.readFileSync(manifestPath, 'utf8')
        const parsed = JSON.parse(raw)
        const snap = parsed && parsed.downloadSnapshot
        if (snap && typeof snap.filename === 'string' && snap.filename) return snap.filename
      }
    } catch { /* ignore */ }
    // Derive from the URL path.
    try {
      const parsed = new URL(url)
      const last = decodeURIComponent(parsed.pathname.split('/').pop() || '')
      if (last && /\.[a-z0-9]{1,6}$/i.test(last)) return last
    } catch { /* ignore */ }
    // Last resort.
    return `${this.safeFolderName(gameName || appid || 'download')}.archive`
  }

  _findPartial(dl) {
    // Order of preference: live file → .crdownload → .ucresume → any other non-sidecar file.
    const candidates = [
      dl.savePath,
      dl.savePath + '.crdownload',
      dl.savePath + RESUME_BACKUP_EXT,
    ]
    for (const candidate of candidates) {
      const st = statOrNull(candidate)
      if (st && st.isFile() && st.size > 0) return { path: candidate, size: st.size }
    }
    // Anything else? (filename mismatch from earlier builds, e.g. content-disposition diff)
    try {
      const entries = fs.readdirSync(dl.installingDir)
      let best = null
      for (const entry of entries) {
        if (isSidecar(entry, this.manifestName)) continue
        const full = path.join(dl.installingDir, entry)
        const st = statOrNull(full)
        if (!st || !st.isFile() || st.size <= 0) continue
        if (!best || st.size > best.size) best = { path: full, size: st.size, name: entry }
      }
      if (best) {
        // Strip partial suffixes for the canonical name.
        const canonicalName = best.name
          .replace(/\.crdownload$/, '')
          .replace(new RegExp(RESUME_BACKUP_EXT.replace('.', '\\.') + '$'), '')
        return { path: best.path, size: best.size, canonicalName }
      }
    } catch { /* ignore */ }
    return null
  }

  _maybeStartNext() {
    if (this.singleActive && this.activeId) return
    while (this.queue.length) {
      const nextId = this.queue.shift()
      const dl = this.byId.get(nextId)
      if (!dl) continue
      if (dl.status === 'cancelled') continue
      if (dl.status !== 'queued' && dl.status !== 'paused' && dl.status !== 'failed') continue
      this.activeId = nextId
      this._kickOff(dl)
      return
    }
  }

  _kickOff(dl) {
    const partial = this._findPartial(dl)
    if (partial && partial.path !== dl.savePath) {
      // Rename whatever we found to the canonical savePath so Chromium / aria2
      // pick it up as the resume target.
      if (!safeRename(partial.path, dl.savePath)) {
        this.log('warn', `[engine] failed to rename partial ${partial.path} → ${dl.savePath}`)
        // Fall through to fresh start.
      } else {
        this.log('info', `[engine] promoted partial: ${partial.path} → ${dl.savePath}`)
      }
    }

    const st = statOrNull(dl.savePath)
    const actualOffset = st && st.isFile() ? st.size : 0

    if (actualOffset > 0 && dl.totalBytes > 0 && actualOffset >= dl.totalBytes) {
      // File looks complete on disk.
      dl.receivedBytes = actualOffset
      dl.status = 'completed'
      this.log('info', `[engine] file already complete: ${dl.savePath}`)
      this.emit('update', this._publicView(dl))
      this.emit('complete', this._publicView(dl))
      this._writeManifestSnapshot(dl)
      this.activeId = null
      this._maybeStartNext()
      return
    }

    // Hydra-style background path: hand the byte-pumping to the aria2 daemon
    // when it's ready. aria2 continues from the on-disk partial (--continue),
    // so the actualOffset promotion above is all the prep it needs. No
    // webContents required — downloads keep running even if the window is gone.
    if (this.aria2 && this.aria2.isReady()) {
      dl.status = 'downloading'
      dl.startedAt = Date.now()
      dl.error = null
      if (actualOffset > 0) dl.receivedBytes = actualOffset
      this.emit('update', this._publicView(dl))
      this._startAria2(dl, actualOffset).catch((err) => {
        this.log('warn', `[engine] aria2 start failed for ${dl.id}, falling back to in-process: ${err?.message || err}`)
        // Fall back to the in-process downloader for this item.
        if (dl.webContents && !dl.webContents.isDestroyed()) {
          this._kickOffInProcess(dl, actualOffset)
        } else {
          this._fail(dl, String(err?.message || err))
        }
      })
      return
    }

    if (!dl.webContents || dl.webContents.isDestroyed()) {
      this._fail(dl, 'webContents destroyed')
      return
    }
    this._kickOffInProcess(dl, actualOffset)
  }

  /** In-process (Electron DownloadManager / manual Range) download path. */
  _kickOffInProcess(dl, actualOffset) {
    if (!dl.webContents || dl.webContents.isDestroyed()) {
      this._fail(dl, 'webContents destroyed')
      return
    }
    dl.status = 'downloading'
    dl.startedAt = Date.now()
    dl.error = null
    // For resume: show the existing partial size immediately so the bar
    // doesn't snap back to 0 while Chromium's first 'updated' tick arrives.
    if (actualOffset > 0) dl.receivedBytes = actualOffset
    this._stateById.set(dl.id, { lastBytes: actualOffset, lastTime: Date.now(), speedBps: 0 })
    this._pendingByUrl.set(dl.url, dl.id)
    this.emit('update', this._publicView(dl))

    try {
      if (actualOffset > 0) {
        // Resume from disk via a manual Range request. Electron 33's
        // session.createInterruptedDownload() pre-populates the item's
        // current_path, then Chromium's DownloadItemImpl::ResumeInterruptedDownload
        // LOG(ERROR)s "Download full path should be empty before resumption"
        // and bails — we can't unset that path from outside Electron. So we
        // bypass Chromium's download manager entirely for resumes and stream
        // the bytes ourselves. Fresh downloads still go through downloadURL
        // because that's where Chromium's redirect/cookie handling matters.
        this._pendingByUrl.delete(dl.url) // not going through will-download
        this.log('info', `[engine] resume from disk (manual range): id=${dl.id} offset=${actualOffset} savePath=${dl.savePath}`)
        this._startRangeResume(dl, actualOffset).catch((err) => {
          this.log('warn', `[engine] manual range resume failed for ${dl.id}: ${err?.message || err}`)
          this._fail(dl, String(err?.message || err))
        })
      } else {
        // Fresh download.
        dl._isResuming = false
        dl.webContents.downloadURL(dl.url)
        this.log('info', `[engine] fresh download: id=${dl.id} url=${dl.url}`)
      }
    } catch (err) {
      this._pendingByUrl.delete(dl.url)
      this._fail(dl, String(err?.message || err))
    }
  }

  // ── aria2 backend ─────────────────────────────────────────────────────────

  /** Hand a download to the aria2 daemon and begin polling its status. */
  async _startAria2(dl, actualOffset) {
    const options = {
      dir: dl.installingDir,
      out: dl.filename,
      continue: 'true',
      'auto-file-renaming': 'false',
      'allow-overwrite': 'true',
    }
    if (dl.authHeader) options.header = [`Authorization: ${dl.authHeader}`]
    const gid = await this.aria2.addUri([dl.url], options)
    dl._gid = gid
    this._gidToId.set(gid, dl.id)
    this.log('info', `[engine] aria2 download: id=${dl.id} gid=${gid} offset=${actualOffset} out=${dl.filename}`)
    this._ensureAria2Poller()
  }

  _ensureAria2Poller() {
    if (this._aria2PollTimer) return
    this._aria2PollTimer = setInterval(() => { this._pollAria2() }, 700)
    if (typeof this._aria2PollTimer.unref === 'function') this._aria2PollTimer.unref()
  }

  _stopAria2PollerIfIdle() {
    // Stop the timer once no download is owned by aria2 anymore.
    let anyActive = false
    for (const dl of this.byId.values()) {
      if (dl._gid && (dl.status === 'downloading' || dl.status === 'queued' || dl.status === 'paused')) {
        anyActive = true
        break
      }
    }
    if (!anyActive && this._aria2PollTimer) {
      clearInterval(this._aria2PollTimer)
      this._aria2PollTimer = null
    }
  }

  async _pollAria2() {
    if (!this.aria2 || !this.aria2.isReady()) return
    // Snapshot the gids we currently track so concurrent mutation is safe.
    const entries = []
    for (const dl of this.byId.values()) {
      if (dl._gid && dl.status !== 'completed' && dl.status !== 'failed' && dl.status !== 'cancelled') {
        entries.push(dl)
      }
    }
    if (entries.length === 0) { this._stopAria2PollerIfIdle(); return }
    for (const dl of entries) {
      let status
      try {
        status = await this.aria2.tellStatus(dl._gid)
      } catch (err) {
        // Transient RPC hiccup — leave state as-is and try again next tick.
        continue
      }
      const completed = Number(status.completedLength) || 0
      const total = Number(status.totalLength) || 0
      const speed = Number(status.downloadSpeed) || 0
      if (total > 0) dl.totalBytes = total
      if (completed > 0) dl.receivedBytes = completed

      if (status.status === 'complete') {
        this._finishAria2(dl, 'complete')
      } else if (status.status === 'error') {
        const msg = status.errorMessage || `aria2 error ${status.errorCode || ''}`.trim()
        this._finishAria2(dl, 'error', msg)
      } else if (status.status === 'removed') {
        // We initiated this via cancel(); cleanup already handled there.
        this._gidToId.delete(dl._gid)
        dl._gid = null
      } else {
        // active / waiting / paused
        dl.status = status.status === 'paused' ? 'paused' : 'downloading'
        dl.speedBps = dl.status === 'paused' ? 0 : speed
        const remaining = total > 0 ? Math.max(0, total - completed) : 0
        dl.etaSeconds = speed > 0 && remaining > 0 ? Math.round(remaining / speed) : null
        this.emit('update', this._publicView(dl))
        this._writeManifestSnapshotThrottled(dl)
      }
    }
  }

  _finishAria2(dl, kind, errorMsg) {
    const gid = dl._gid
    dl._gid = null
    if (gid) {
      this._gidToId.delete(gid)
      // Let aria2 forget the finished download so its memory + .aria2 file are
      // cleaned up. Best-effort.
      try { this.aria2.removeDownloadResult(gid).catch(() => {}) } catch { /* ignore */ }
    }
    if (kind === 'complete') {
      // Trust the on-disk size as the source of truth.
      try {
        const st = statOrNull(dl.savePath)
        if (st && st.isFile()) dl.receivedBytes = st.size
      } catch { /* ignore */ }
      dl.status = 'completed'
      dl.speedBps = 0
      dl.etaSeconds = null
      try { safeUnlink(dl.savePath + RESUME_BACKUP_EXT) } catch { /* ignore */ }
      this._writeManifestSnapshot(dl)
      this.emit('update', this._publicView(dl))
      this.emit('complete', this._publicView(dl))
      this.activeId = null
      this._stopAria2PollerIfIdle()
      this._maybeStartNext()
      return
    }
    // error
    this._stopAria2PollerIfIdle()
    this._fail(dl, errorMsg || 'aria2 download failed')
  }

  // Manual Range-based resume. Bypasses Electron's DownloadManager entirely
  // because createInterruptedDownload + resume() is broken in Electron 33
  // (LOG(ERROR) "Download full path should be empty before resumption" makes
  // the resume silently bail). Streams bytes from offset to the end of the
  // file into `dl.savePath` in append mode and emits the same 'update' /
  // 'complete' / 'fail' events as the Chromium path so the rest of the
  // pipeline doesn't notice the difference.
  async _startRangeResume(dl, offset) {
    // Pause/cancel cooperatively from outside via dl._rangeAbort.
    let abortRequested = false
    let response = null
    let fileStream = null
    let bytesReceivedThisRun = 0
    const t0 = Date.now()
    let lastTickAt = t0
    let lastTickBytes = 0
    let smoothedSpeed = 0

    dl._rangeAbort = (reason = 'aborted') => {
      abortRequested = true
      try { response?.destroy?.() } catch { /* ignore */ }
      try { fileStream?.close?.() } catch { /* ignore */ }
      this.log('info', `[engine] range resume aborted (${reason}) id=${dl.id}`)
    }

    const followRedirects = (urlStr, attemptsRemaining = 5) => new Promise((resolve, reject) => {
      let parsed
      try { parsed = new NodeURL(urlStr) } catch (err) { reject(err); return }
      const mod = parsed.protocol === 'http:' ? http : https
      const options = {
        method: 'GET',
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
        path: `${parsed.pathname || '/'}${parsed.search || ''}`,
        headers: {
          'Range': `bytes=${offset}-`,
          'User-Agent': 'UnionCrax.Direct/Electron',
          // Some CDNs strip Range when the request is also asking for compression.
          'Accept-Encoding': 'identity',
        },
      }
      const req = mod.request(options, (res) => {
        const status = res.statusCode || 0
        if (status >= 300 && status < 400 && res.headers.location && attemptsRemaining > 0) {
          // Resolve relative redirect locations against the request URL.
          let nextUrl
          try { nextUrl = new NodeURL(res.headers.location, urlStr).toString() } catch { nextUrl = res.headers.location }
          res.destroy()
          followRedirects(nextUrl, attemptsRemaining - 1).then(resolve, reject)
          return
        }
        if (status !== 206 && status !== 200) {
          res.destroy()
          reject(new Error(`Range request returned HTTP ${status}`))
          return
        }
        resolve(res)
      })
      req.on('error', reject)
      req.end()
    })

    try {
      response = await followRedirects(dl.url)

      // If the server ignored Range and returned 200 with the whole file,
      // we'd corrupt our partial by appending. Truncate the existing file
      // and start fresh in that case.
      const statusCode = response.statusCode || 0
      let appendMode = true
      if (statusCode === 200) {
        appendMode = false
        offset = 0
        try { fs.truncateSync(dl.savePath, 0) } catch { /* ignore */ }
        dl.receivedBytes = 0
      }

      // Total bytes — prefer Content-Range "bytes a-b/c" then Content-Length
      // (which on 206 is the remainder, on 200 is the whole file).
      let resolvedTotal = dl.totalBytes
      const contentRange = response.headers['content-range']
      if (typeof contentRange === 'string') {
        const m = contentRange.match(/\/(\d+)$/)
        if (m) resolvedTotal = Number(m[1]) || resolvedTotal
      }
      const contentLength = Number(response.headers['content-length']) || 0
      if (!resolvedTotal && contentLength > 0) {
        resolvedTotal = appendMode ? offset + contentLength : contentLength
      }
      if (resolvedTotal > 0) dl.totalBytes = resolvedTotal

      fileStream = fs.createWriteStream(dl.savePath, { flags: appendMode ? 'a' : 'w' })

      // Bandwidth throttle window state — sliding 1-second token bucket.
      // When bandwidthLimitBps is 0 the gate stays open.
      let throttleWindowStart = Date.now()
      let bytesInThrottleWindow = 0
      let resumeTimer = null

      response.on('data', (chunk) => {
        if (abortRequested) return
        bytesReceivedThisRun += chunk.length
        const now = Date.now()

        // Read the cap fresh on each chunk so live setting changes take
        // effect mid-download. We only act when a positive cap is set.
        const cap = Number(this.bandwidthLimitBps) || 0
        if (cap > 0) {
          if (now - throttleWindowStart >= 1000) {
            // New 1-second window — reset counters.
            throttleWindowStart = now
            bytesInThrottleWindow = chunk.length
          } else {
            bytesInThrottleWindow += chunk.length
          }
          if (bytesInThrottleWindow >= cap && !resumeTimer) {
            // We've eaten our allowance for this window — pause until the
            // window rolls over. response.pause() backpressures the socket;
            // setTimeout fires response.resume() at the next window start.
            const waitMs = Math.max(0, 1000 - (now - throttleWindowStart))
            try { response.pause() } catch { /* ignore */ }
            resumeTimer = setTimeout(() => {
              resumeTimer = null
              throttleWindowStart = Date.now()
              bytesInThrottleWindow = 0
              try { response.resume() } catch { /* ignore */ }
            }, waitMs)
          }
        }

        // Smoothed speed over a ~250ms window.
        if (now - lastTickAt >= 250) {
          const deltaSec = (now - lastTickAt) / 1000
          const deltaBytes = bytesReceivedThisRun - lastTickBytes
          const instant = deltaBytes / deltaSec
          smoothedSpeed = smoothedSpeed > 0 ? smoothedSpeed * 0.7 + instant * 0.3 : instant
          lastTickAt = now
          lastTickBytes = bytesReceivedThisRun
          const cumulative = (appendMode ? offset : 0) + bytesReceivedThisRun
          dl.receivedBytes = cumulative
          dl.speedBps = Math.round(smoothedSpeed)
          if (dl.totalBytes > 0 && smoothedSpeed > 0) {
            const remaining = Math.max(0, dl.totalBytes - cumulative)
            dl.etaSeconds = remaining / smoothedSpeed
          }
          dl.status = 'downloading'
          this.emit('update', this._publicView(dl))
          this._writeManifestSnapshotThrottled(dl)
        }
      })

      await new Promise((resolve, reject) => {
        response.pipe(fileStream)
        const cleanup = () => {
          if (resumeTimer) {
            clearTimeout(resumeTimer)
            resumeTimer = null
          }
        }
        fileStream.on('finish', () => { cleanup(); resolve() })
        fileStream.on('error', (err) => { cleanup(); reject(err) })
        response.on('error', (err) => { cleanup(); reject(err) })
      })

      if (abortRequested) {
        // Treat as paused — partial is on disk, will resume next time.
        dl.status = 'paused'
        dl.speedBps = 0
        dl.etaSeconds = null
        try { dl.receivedBytes = fs.statSync(dl.savePath).size } catch { /* ignore */ }
        this._writeManifestSnapshot(dl)
        this.emit('update', this._publicView(dl))
        this.activeId = null
        this._maybeStartNext()
        return
      }

      // Final byte count from disk — the writeStream flushed everything.
      try { dl.receivedBytes = fs.statSync(dl.savePath).size } catch { /* ignore */ }
      dl.speedBps = 0
      dl.etaSeconds = null
      dl.status = 'completed'
      // Clean up any stale .ucresume backup — the live file is the truth.
      try { fs.unlinkSync(dl.savePath + RESUME_BACKUP_EXT) } catch { /* ignore */ }
      this._writeManifestSnapshot(dl)
      this.emit('update', this._publicView(dl))
      this.emit('complete', this._publicView(dl))
      this.activeId = null
      this._maybeStartNext()
    } catch (err) {
      if (abortRequested) return // already handled above
      throw err
    } finally {
      try { response?.destroy?.() } catch { /* ignore */ }
      try { fileStream?.close?.() } catch { /* ignore */ }
      dl._rangeAbort = null
    }
  }

  _onWillDownload(item) {
    // The url we passed to downloadURL() may have redirected before this fires
    // (UC.Files share links → backblaze CDN, for example). Match against the
    // entire URL chain, not just the final URL, so we still recognise our own
    // download after a redirect hop.
    const finalUrl = item.getURL()
    let urlChain
    try { urlChain = typeof item.getURLChain === 'function' ? item.getURLChain() : [finalUrl] } catch { urlChain = [finalUrl] }
    let downloadId = this._pendingByUrl.get(finalUrl)
    if (!downloadId && Array.isArray(urlChain)) {
      for (const u of urlChain) {
        if (this._pendingByUrl.has(u)) { downloadId = this._pendingByUrl.get(u); break }
      }
    }
    if (!downloadId) return // Not one of ours.
    const dl = this.byId.get(downloadId)
    if (!dl) return
    // Clear every URL we registered for this download from the pending map so
    // a follow-up will-download (e.g. for a retried part) doesn't latch onto it.
    this._pendingByUrl.delete(dl.url)
    if (Array.isArray(urlChain)) for (const u of urlChain) this._pendingByUrl.delete(u)

    // For interrupted items (created via createInterruptedDownload) Chromium
    // has already set the item's internal full_path from our options — calling
    // setSavePath again leaves that field set when resume() runs, tripping
    // Chromium's "Download full path should be empty before resumption" DCHECK
    // and silently aborting the resume. We can't rely on item.getState() to
    // detect this because the state can transition before this handler runs,
    // so use an explicit flag we set right before createInterruptedDownload.
    const isResuming = dl._isResuming === true
    dl._isResuming = false
    if (!isResuming) {
      try { item.setSavePath(dl.savePath) } catch { /* ignore */ }
    } else {
      this.log('info', `[engine] will-download for resume: id=${dl.id} state=${typeof item.getState === 'function' ? item.getState() : '?'}`)
    }

    this._itemById.set(downloadId, item)

    item.on('updated', () => this._onItemUpdated(dl, item))
    item.once('done', (_e, state) => this._onItemDone(dl, item, state))

    // createInterruptedDownload arrives here in 'interrupted' state and needs
    // an explicit resume() to actually start fetching bytes.
    if (isResuming || (typeof item.getState === 'function' && item.getState() === 'interrupted')) {
      try { item.resume() } catch (err) {
        this.log('warn', `[engine] resume() on interrupted item failed: ${err?.message || err}`)
      }
    } else if (typeof item.isPaused === 'function' && item.isPaused()) {
      try { item.resume() } catch { /* ignore */ }
    }
  }

  _onItemUpdated(dl, item) {
    const now = Date.now()
    let received = 0
    let total = 0
    try { received = item.getReceivedBytes() } catch { /* ignore */ }
    try { total = item.getTotalBytes() } catch { /* ignore */ }

    const state = this._stateById.get(dl.id) || { lastBytes: received, lastTime: now, speedBps: 0 }
    const deltaBytes = Math.max(0, received - state.lastBytes)
    const deltaTime = Math.max(0.001, (now - state.lastTime) / 1000)
    const instantSpeed = deltaBytes / deltaTime
    const smoothed = state.speedBps > 0 ? state.speedBps * 0.7 + instantSpeed * 0.3 : instantSpeed
    state.lastBytes = received
    state.lastTime = now
    state.speedBps = smoothed
    this._stateById.set(dl.id, state)

    const remaining = total > 0 ? Math.max(0, total - received) : 0
    const finalSpeed = (total > 0 && received >= total) ? 0 : smoothed
    const etaSeconds = finalSpeed > 0 && remaining > 0 ? remaining / finalSpeed : null

    const isPaused = typeof item.isPaused === 'function' && item.isPaused()
    // Never regress the displayed progress: if Chromium emits a stale 0-byte
    // update mid-resume (it sometimes does right after createInterruptedDownload
    // before the first range response arrives), keep the previous count.
    if (received > 0 || dl.receivedBytes === 0) {
      dl.receivedBytes = received
    }
    if (total > 0) dl.totalBytes = total
    dl.speedBps = isPaused ? 0 : Math.round(finalSpeed)
    dl.etaSeconds = etaSeconds
    dl.status = isPaused ? 'paused' : 'downloading'

    this.emit('update', this._publicView(dl))
    // Throttled manifest writes so a hard kill leaves recent progress on disk.
    this._writeManifestSnapshotThrottled(dl)
  }

  _onItemDone(dl, item, state) {
    this._itemById.delete(dl.id)
    this._stateById.delete(dl.id)

    // Quit-induced cancellation: we never told the user to cancel, the OS just
    // killed us mid-download. Preserve the partial file via hardlink so the
    // next launch can find it, and don't propagate the cancel to the renderer.
    const isQuitCancel =
      (state === 'cancelled' || state === 'interrupted') &&
      !this.cancelledIds.has(dl.id)

    if (isQuitCancel) {
      this.log('warn', `[engine] done during shutdown — preserving partial for ${dl.id}`)
      try {
        if (dl.savePath && fs.existsSync(dl.savePath)) {
          const backupPath = dl.savePath + RESUME_BACKUP_EXT
          safeUnlink(backupPath)
          fs.linkSync(dl.savePath, backupPath)
          this.log('info', `[engine] hardlinked ${dl.savePath} → ${backupPath}`)
        }
      } catch (err) {
        this.log('warn', `[engine] hardlink preserve failed: ${err?.message || err}`)
      }
      dl.status = 'paused'
      dl.error = 'App closed. Resume to continue downloading.'
      dl.speedBps = 0
      dl.etaSeconds = null
      // Read final byte counts off the item before it's gone.
      try { dl.receivedBytes = item.getReceivedBytes() } catch { /* ignore */ }
      try {
        const t = item.getTotalBytes()
        if (t > 0) dl.totalBytes = t
      } catch { /* ignore */ }
      this._writeManifestSnapshot(dl)
      // Don't emit 'update' — we want the renderer to see this as paused on
      // next launch via the manifest reconcile, not as a transient cancel now.
      this.activeId = null
      return
    }

    if (state === 'completed') {
      dl.status = 'completed'
      dl.speedBps = 0
      dl.etaSeconds = null
      try { dl.receivedBytes = item.getReceivedBytes() } catch { /* ignore */ }
      try {
        const t = item.getTotalBytes()
        if (t > 0) dl.totalBytes = t
      } catch { /* ignore */ }
      // Clean up the hardlink backup — the live file is the truth now.
      try { safeUnlink(dl.savePath + RESUME_BACKUP_EXT) } catch { /* ignore */ }
      this._writeManifestSnapshot(dl)
      this.emit('update', this._publicView(dl))
      this.emit('complete', this._publicView(dl))
      this.activeId = null
      this._maybeStartNext()
      return
    }

    if (state === 'cancelled' || state === 'interrupted') {
      // User-initiated cancel reaches here too. cancel() already updated state
      // and called emit('cancel'); just clear active and continue.
      if (dl.status !== 'cancelled') {
        dl.status = 'failed'
        dl.error = `Download ${state}`
        this.emit('update', this._publicView(dl))
        this._writeManifestSnapshot(dl)
      }
      this.activeId = null
      this._maybeStartNext()
      return
    }

    // Unknown terminal state — treat as failed.
    this._fail(dl, `unknown done state: ${state}`)
  }

  _fail(dl, error) {
    dl.status = 'failed'
    dl.error = error
    dl.speedBps = 0
    dl.etaSeconds = null
    this.emit('update', this._publicView(dl))
    this.emit('fail', this._publicView(dl))
    this._writeManifestSnapshot(dl)
    if (this.activeId === dl.id) this.activeId = null
    this._maybeStartNext()
  }

  _publicView(dl) {
    return {
      id: dl.id,
      appid: dl.appid,
      gameName: dl.gameName,
      url: dl.url,
      filename: dl.filename,
      savePath: dl.savePath,
      totalBytes: dl.totalBytes,
      receivedBytes: dl.receivedBytes,
      speedBps: dl.speedBps,
      etaSeconds: dl.etaSeconds,
      status: dl.status,
      error: dl.error,
      host: 'ucfiles',
    }
  }

  // ── Manifest persistence (every progress tick, throttled) ───────────────
  //
  // The engine writes resume metadata to the installing manifest on every
  // tick so a hard kill (taskkill, Ctrl+C, OS crash) still leaves enough on
  // disk for the next launch to resume. Throttled to once per 1500ms.

  _writeManifestSnapshotThrottled(dl) {
    const now = Date.now()
    const last = dl._lastSnapshotWrite || 0
    if (now - last < 1500) return
    dl._lastSnapshotWrite = now
    this._writeManifestSnapshot(dl)
  }

  _writeManifestSnapshot(dl) {
    try {
      const manifestPath = path.join(dl.installingDir, this.manifestName)
      let manifest = {}
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      } catch { /* will create */ }
      manifest.appid = manifest.appid || dl.appid
      manifest.name = manifest.name || dl.gameName || dl.appid
      manifest.installStatus = this._manifestStatusFor(dl.status)
      if (dl.error) manifest.installError = dl.error
      else delete manifest.installError
      manifest.updatedAt = Date.now()
      manifest.downloadSnapshot = {
        url: dl.url,
        savePath: dl.savePath,
        filename: dl.filename,
        downloadId: dl.id,
        totalBytes: dl.totalBytes,
        receivedBytes: dl.receivedBytes,
        host: 'ucfiles',
        updatedAt: Date.now(),
      }
      // Atomic-ish write.
      const tmp = manifestPath + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2))
      try { fs.renameSync(tmp, manifestPath) } catch {
        try { fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2)) } catch { /* ignore */ }
      }
    } catch (err) {
      this.log('warn', `[engine] manifest write failed for ${dl.id}: ${err?.message || err}`)
    }
  }

  _manifestStatusFor(status) {
    switch (status) {
      case 'completed': return 'downloaded'
      case 'cancelled': return 'cancelled'
      case 'failed': return 'failed'
      case 'paused': return 'paused'
      case 'queued': return 'installing'
      case 'downloading':
      default:
        return 'installing'
    }
  }
}

/**
 * Apply / update the global bandwidth limit for in-flight + future downloads.
 * Accepts a value in bytes-per-second; pass 0 (or anything non-positive) to
 * remove the cap. Takes effect on the next data chunk.
 */
DownloadEngine.prototype.setBandwidthLimit = function setBandwidthLimit(bytesPerSecond) {
  const next = Number(bytesPerSecond) || 0
  this.bandwidthLimitBps = next > 0 ? Math.floor(next) : 0
}

module.exports = { DownloadEngine, RESUME_BACKUP_EXT }

/**
 * @typedef {Object} Download
 * @property {string} id
 * @property {string} appid
 * @property {?string} gameName
 * @property {string} url
 * @property {string} filename
 * @property {string} savePath
 * @property {string} installingDir
 * @property {number} totalBytes
 * @property {number} receivedBytes
 * @property {number} speedBps
 * @property {?number} etaSeconds
 * @property {'queued'|'downloading'|'paused'|'completed'|'cancelled'|'failed'} status
 * @property {?string} error
 * @property {number} createdAt
 * @property {?number} startedAt
 * @property {*} webContents - Electron WebContents
 * @property {number} [_lastSnapshotWrite]
 */
