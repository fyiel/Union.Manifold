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
  // aria2's per-download control file lives next to the partial — never the archive.
  '.aria2',
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
     * The aria2 background daemon (Hydra-style) is the engine's sole download
     * backend. All byte-pumping + disk I/O happens in that separate process, so
     * the Electron main thread (and any game the user is playing) stays
     * responsive. aria2 writes straight to installing/<game>/<file>, gives
     * multi-connection transfers, and resumes natively via --continue + its
     * .aria2 control files. _kickOff awaits the daemon if it isn't up yet.
     * @type {import('./aria2-manager.cjs').Aria2Manager | null}
     */
    this.aria2 = aria2
    /** aria2 gid -> downloadId, for routing poll results back to a Download. */
    this._gidToId = new Map()
    /** Handle for the shared aria2 status poller (one timer for all downloads). */
    this._aria2PollTimer = null

    /** Bandwidth cap in bytes/sec (0 = unlimited). Applied to aria2 globally. */
    this.bandwidthLimitBps = 0

    /** @type {Map<string, Download>} */ this.byId = new Map()
    /** @type {string[]} */ this.queue = []
    /** @type {string|null} */ this.activeId = null

    /** Cancelled ids so a late status poll doesn't get misread. */
    this.cancelledIds = new Set()

    /**
     * CDN failover. Some networks (school/ISP DPI) block our download host by
     * its TLS SNI, so aria2 dies at the handshake even though the catalog still
     * loads via an API mirror. `cdnHosts` is an ordered list of interchangeable
     * CDN domains (all fronting the same object storage); on a TLS/transport
     * failure we rewrite the download URL's host to the next one and retry.
     * `preferredCdnHost` is the one we've seen working this session, so later
     * downloads start there instead of re-hitting a blocked host. Populated by
     * main via setCdnHosts() once hydrated from /api/cdn-mirrors. Empty = the
     * feature is inert and downloads behave exactly as before.
     * @type {string[]}
     */
    this.cdnHosts = []
    /** @type {string|null} */ this.preferredCdnHost = null
    /**
     * The host we've actually seen deliver bytes this session. Distinct from
     * preferredCdnHost (which is optimistic — set the instant we fail over).
     * main persists this so a blocked user starts straight on the working mirror
     * next launch instead of re-probing the blocked primary. Once set, an
     * explicit restored `preferred` no longer overrides it.
     * @type {string|null}
     */
    this._confirmedCdnHost = null
  }

  /**
   * Set the ordered CDN failover hosts (lowercased, de-duped). `preferred` is an
   * optional restored "last-working host" (from settings); it's used as the
   * start host only when valid AND we haven't already confirmed a working host
   * this session. Otherwise the current preferred is kept if still valid, else
   * the first host wins.
   */
  setCdnHosts(hosts, preferred) {
    const list = Array.isArray(hosts)
      ? hosts.map((h) => String(h || '').trim().toLowerCase()).filter(Boolean)
      : []
    this.cdnHosts = [...new Set(list)]
    const seed = String(preferred || '').trim().toLowerCase()
    if (!this._confirmedCdnHost && seed && this.cdnHosts.includes(seed)) {
      this.preferredCdnHost = seed
    } else if (this.cdnHosts.length && (!this.preferredCdnHost || !this.cdnHosts.includes(this.preferredCdnHost))) {
      this.preferredCdnHost = this.cdnHosts[0]
    }
  }

  /**
   * Called when a download is actively receiving bytes: the host in its URL is
   * proven reachable on this network. Records it and emits 'cdn-host' (once per
   * new host) so main can persist it. No-op for non-CDN hosts.
   */
  _confirmCdnHost(dl) {
    const host = this._urlHost(dl && dl.url)
    if (!host || !this.cdnHosts.includes(host) || this._confirmedCdnHost === host) return
    this._confirmedCdnHost = host
    this.preferredCdnHost = host
    this.log('info', `[engine] CDN host confirmed working: ${host}`)
    this.emit('cdn-host', host)
  }

  /** Lowercased host of a URL, or '' if unparseable. */
  _urlHost(url) {
    try { return new NodeURL(url).host.toLowerCase() } catch { return '' }
  }

  /** Return `url` with its host swapped to `host` (keeps path/query/scheme). */
  _withHost(url, host) {
    try { const u = new NodeURL(url); u.host = host; return u.toString() } catch { return url }
  }

  /** No-op: aria2 downloads don't use the Electron DownloadManager session.
   *  Kept so existing callers in main.cjs don't need to change. */
  attachSession(_session) { /* aria2 backend — nothing to attach */ }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Enqueue a download. Returns the assigned downloadId.
   * `webContents` is accepted for backwards-compatibility but unused — the
   * aria2 daemon downloads headlessly, so a window isn't required.
   */
  enqueue({ webContents, appid, gameName, url, filename, totalBytes, id, headers }) {
    void webContents
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
      // Optional per-download request headers (e.g. a Referer required by a
      // source's file host). Plain object of name->value; null when unused.
      headers: headers && typeof headers === 'object' ? headers : null,
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
    }

    this.byId.set(downloadId, dl)

    // If this is a CDN download and we've already locked onto a reachable CDN
    // mirror this session, start there — so a user whose network blocks the
    // primary host doesn't eat a failed first attempt on every new download.
    if (this.preferredCdnHost) {
      const host = this._urlHost(dl.url)
      if (host && this.cdnHosts.includes(host) && host !== this.preferredCdnHost) {
        dl.url = this._withHost(dl.url, this.preferredCdnHost)
        this.log('info', `[engine] CDN: starting ${dl.id} on preferred mirror ${this.preferredCdnHost}`)
      }
    }

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
    // Pause via aria2 RPC. The poller reflects the paused status; set it
    // optimistically so the UI flips immediately.
    if (dl._gid && this.aria2) {
      try { this.aria2.pause(dl._gid).catch(() => {}) } catch { /* ignore */ }
    }
    dl.status = 'paused'
    dl.speedBps = 0
    dl.etaSeconds = null
    this.emit('update', this._publicView(dl))
    this._writeManifestSnapshot(dl)
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

    // No live gid (e.g. after a restart — the daemon is fresh): re-kick.
    // _kickOff promotes the on-disk partial and aria2 continues from it.
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
      // Also remove aria2's segment control file. Without this, a future
      // download of the same file would resume against stale .aria2 control
      // data describing a file we just deleted, producing a corrupt result.
      safeUnlink(dl.savePath + '.aria2')
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

    // aria2 is the only download backend. It continues from the on-disk
    // partial (--continue), so the actualOffset promotion above is all the prep
    // it needs. No webContents required — downloads keep running even if the
    // window is gone. If the daemon isn't up yet (first download after launch),
    // start it then kick off; if it can't start (binary missing), fail with an
    // actionable message rather than silently stalling.
    dl.status = 'downloading'
    dl.startedAt = Date.now()
    dl.error = null
    if (actualOffset > 0) dl.receivedBytes = actualOffset
    this.emit('update', this._publicView(dl))

    const begin = () => this._startAria2(dl, actualOffset).catch((err) => {
      this._fail(dl, `aria2 download failed: ${err?.message || err}`)
    })
    if (this.aria2 && this.aria2.isReady()) {
      begin()
    } else if (this.aria2 && typeof this.aria2.ensureStarted === 'function') {
      this.aria2.ensureStarted().then((ok) => {
        if (ok && this.aria2.isReady()) begin()
        else this._fail(dl, 'aria2 downloader unavailable (aria2c binary not found). Run `pnpm fetch-aria2` to bundle it.')
      }).catch((err) => this._fail(dl, `aria2 unavailable: ${err?.message || err}`))
    } else {
      this._fail(dl, 'aria2 downloader is not configured')
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
    const headerLines = []
    if (dl.authHeader) headerLines.push(`Authorization: ${dl.authHeader}`)
    if (dl.headers && typeof dl.headers === 'object') {
      for (const [name, value] of Object.entries(dl.headers)) {
        if (name && value != null) headerLines.push(`${name}: ${value}`)
      }
    }
    if (headerLines.length) options.header = headerLines
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
    // Re-entrancy guard: the driving setInterval fires every 700ms regardless of
    // whether the previous (async) poll finished. Under RPC latency or many
    // concurrent gids a tick can exceed 700ms; overlapping ticks would issue
    // concurrent tellStatus calls and race manifest writes / double-fire
    // completion (_finishAria2) for the same gid. Skip if a poll is in flight.
    if (this._polling) return
    this._polling = true
    try {
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
          // Bytes are flowing → the current CDN host works on this network.
          if (speed > 0) this._confirmCdnHost(dl)
          this.emit('update', this._publicView(dl))
          this._writeManifestSnapshotThrottled(dl)
        }
      }
    } finally {
      this._polling = false
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
    // Before giving up, try the next CDN mirror — covers SNI/DPI blocks where
    // the handshake to one host fails but an interchangeable domain works.
    if (this._tryCdnFailover(dl, errorMsg)) return
    // Failover was unavailable (no mirror loaded) or exhausted (every mirror
    // also blocked). If this was a transport/TLS shape against a CDN host it's a
    // network-level block — almost always school/ISP DPI rejecting the TLS
    // ClientHello by its SNI (cdn.union-crax.xyz). No aria2/cert change can beat
    // that; only a different hostname can. Tell main: it will (re)hydrate the
    // mirror list and retry, and if there's still nothing reachable, surface a
    // clear popup explaining the block instead of looping silently.
    if (this._isTransportError(errorMsg)) {
      const blockedHost = this._urlHost(dl.url)
      if (blockedHost && this.cdnHosts.includes(blockedHost)) {
        dl._cdnTransportBlocked = true
        this.emit('cdn-blocked', {
          id: dl.id,
          appid: dl.appid,
          gameName: dl.gameName || null,
          host: blockedHost,
          error: String(errorMsg || ''),
          // True when we have no alternate mirror to even try — main should
          // re-fetch /api/cdn-mirrors before deciding the user is stuck.
          noMirrorLoaded: this.cdnHosts.length < 2,
        })
      }
    }
    this._fail(dl, errorMsg || 'aria2 download failed')
  }

  /** True for network/TLS-shaped errors that another interchangeable host might
   *  survive (handshake/SNI blocks, connect failures, timeouts). False for HTTP
   *  status errors (404/403/5xx) and the like, where swapping hosts only masks a
   *  real problem. */
  _isTransportError(errorMsg) {
    return /handshake|protocol error|\bssl\b|\btls\b|timed?\s*out|timeout|connection|reset|refused|unreachable|could ?n.t? connect|resolve|name resolution|network|EOF/i.test(String(errorMsg || ''))
  }

  /**
   * After the mirror list is (re)hydrated, retry any download that previously
   * failed at the TLS/transport layer against a CDN host — moving it onto an
   * untried mirror. No-op until we actually have an alternate mirror. Returns
   * the number of downloads re-queued. Called by main once a fresh
   * /api/cdn-mirrors fetch lands (see main's 'cdn-blocked' handler).
   */
  retryCdnBlocked() {
    if (this.cdnHosts.length < 2) return 0
    let requeued = 0
    for (const dl of this.byId.values()) {
      if (!dl || !dl._cdnTransportBlocked || dl.status !== 'failed') continue
      if (this._tryCdnFailover(dl, dl.error || 'protocol error')) {
        dl._cdnTransportBlocked = false
        requeued++
      }
    }
    if (requeued) this.log('info', `[engine] re-queued ${requeued} CDN-blocked download(s) on a mirror after refresh`)
    return requeued
  }

  /**
   * On a transport/TLS failure against a CDN host, re-queue the download against
   * the next untried CDN mirror. Returns true if a failover was started (caller
   * must NOT then mark the download failed). Only fires for network-shaped
   * errors — a 404 / auth / disk error means the file or setup is wrong, and
   * swapping hosts would just mask it.
   */
  _tryCdnFailover(dl, errorMsg) {
    if (!dl || this.cdnHosts.length < 2) return false
    const msg = String(errorMsg || '')
    // Transport/TLS shapes only. aria2 surfaces SNI/DPI blocks as
    // "SSL/TLS handshake failure: protocol error", plus the usual connect-level
    // failures; never fail over on HTTP status errors (404/403/5xx) — those are
    // forwarded verbatim and the next host would fail identically.
    if (!this._isTransportError(msg)) return false
    const host = this._urlHost(dl.url)
    if (!host || !this.cdnHosts.includes(host)) return false // not a CDN download

    if (!dl._triedCdnHosts) dl._triedCdnHosts = new Set()
    dl._triedCdnHosts.add(host)
    const next = this.cdnHosts.find((h) => !dl._triedCdnHosts.has(h))
    if (!next) {
      this.log('warn', `[engine] CDN failover exhausted for ${dl.id} (tried ${[...dl._triedCdnHosts].join(', ')})`)
      return false
    }

    this.log('warn', `[engine] CDN ${host} unreachable for ${dl.id} (${msg}); failing over to ${next}`)
    // Remember the new host for the rest of the session so other downloads skip
    // the blocked one. (Cleared back if it also fails on a later failover.)
    this.preferredCdnHost = next
    dl.url = this._withHost(dl.url, next)
    dl._gid = null
    dl.error = null
    dl.speedBps = 0
    dl.etaSeconds = null
    // The blocked attempt left no usable bytes (it died at the handshake); drop
    // any stray partial/control file so the new host starts clean.
    safeUnlink(dl.savePath + '.aria2')
    dl.status = 'queued'
    if (this.activeId === dl.id) this.activeId = null
    if (!this.queue.includes(dl.id)) this.queue.unshift(dl.id)
    this.emit('update', this._publicView(dl))
    this._maybeStartNext()
    return true
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
      // Atomic write: temp file + rename. The previous direct-overwrite fallback
      // on rename failure reintroduced exactly the torn-write corruption the
      // temp+rename was meant to prevent. If the rename fails, leave the
      // existing manifest intact (a stale-but-valid manifest is recoverable; a
      // half-written one is not) and clean up the temp file.
      const tmp = manifestPath + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2))
      try {
        fs.renameSync(tmp, manifestPath)
      } catch (renameErr) {
        try { fs.unlinkSync(tmp) } catch { /* ignore */ }
        this.log('warn', `[engine] manifest rename failed for ${dl.id}: ${renameErr?.message || renameErr}`)
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
  // aria2 enforces the cap in the daemon (global option), so it applies to the
  // active and all future downloads immediately.
  try {
    if (this.aria2 && typeof this.aria2.setMaxOverallDownloadLimit === 'function') {
      this.aria2.setMaxOverallDownloadLimit(this.bandwidthLimitBps)
    }
  } catch { /* ignore */ }
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
