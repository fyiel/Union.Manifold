/**
 * aria2-manager.cjs
 *
 * Spawns and talks to a bundled `aria2c` as a background download daemon over
 * JSON-RPC — the same architecture Hydra uses. The point is to get the byte
 * pumping and disk writes OUT of the Electron main process so the UI (and any
 * game the user is playing) stays responsive while a download runs.
 *
 * aria2 also gives us, for free:
 *   - native resume (`--continue=true` continues a plain-HTTP file from its
 *     on-disk size; the `.aria2` control file makes segmented resume exact),
 *   - multi-connection segmented downloads (faster), and
 *   - real pause/unpause.
 *
 * This module is intentionally dependency-free (node http/child_process/net/
 * crypto only) and fails soft: if the binary can't be found or the daemon
 * won't start, `isReady()` stays false and the DownloadEngine falls back to its
 * in-process downloader. Nothing here throws into the main process on startup.
 */

'use strict'

const http = require('node:http')
const net = require('node:net')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

/** Resolve the aria2c binary path for this platform, or null if not found.
 *  Looks first in the bundled assets dir (packaged + dev), then falls back to
 *  whatever `aria2c` is on PATH so power users / Linux distros can supply it. */
function resolveAria2Binary({ appRoot, resourcesPath } = {}) {
  const platform = process.platform // 'win32' | 'darwin' | 'linux'
  const arch = process.arch // 'x64' | 'arm64' | ...
  const exe = platform === 'win32' ? 'aria2c.exe' : 'aria2c'
  // Candidate roots, in priority order. `assets/bin/aria2/<platform>-<arch>/`
  // is where scripts/fetch-aria2.cjs drops the binary.
  const roots = []
  // Packaged apps run from an asar archive, but native binaries can't be
  // executed from inside asar — electron-builder's asarUnpack drops them under
  // resources/app.asar.unpacked/. Check that first.
  if (resourcesPath) {
    roots.push(path.join(resourcesPath, 'app.asar.unpacked', 'assets', 'bin', 'aria2'))
    roots.push(path.join(resourcesPath, 'assets', 'bin', 'aria2'))
  }
  if (appRoot) {
    if (appRoot.includes('app.asar')) {
      roots.push(path.join(appRoot.replace('app.asar', 'app.asar.unpacked'), 'assets', 'bin', 'aria2'))
    }
    roots.push(path.join(appRoot, 'assets', 'bin', 'aria2'))
  }
  roots.push(path.join(__dirname, '..', 'assets', 'bin', 'aria2'))
  const subdirs = [`${platform}-${arch}`, platform, '']
  for (const root of roots) {
    for (const sub of subdirs) {
      const candidate = path.join(root, sub, exe)
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
      } catch { /* ignore */ }
    }
  }
  // PATH fallback — only meaningful on platforms where it's commonly installed.
  return exe === 'aria2c' ? 'aria2c' : null
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
  })
}

class Aria2Manager {
  /**
   * @param {object} opts
   * @param {string} [opts.binaryPath]  explicit aria2c path (else auto-resolve)
   * @param {string} [opts.appRoot]     app dir for binary resolution
   * @param {string} [opts.resourcesPath] process.resourcesPath for packaged apps
   * @param {(level:string,msg:string)=>void} [opts.log]
   */
  constructor({ binaryPath, appRoot, resourcesPath, log } = {}) {
    this.binaryPath = binaryPath || resolveAria2Binary({ appRoot, resourcesPath })
    this.log = typeof log === 'function' ? log : () => {}
    this.proc = null
    this.port = 0
    this.secret = crypto.randomBytes(16).toString('hex')
    this._ready = false
    this._startPromise = null
    this._rpcId = 0
  }

  isReady() {
    return this._ready && this.proc != null && !this.proc.killed
  }

  /** Idempotent start. Resolves true once the RPC endpoint answers, false on
   *  any failure (missing binary, spawn error, readiness timeout). Never throws. */
  async ensureStarted() {
    if (this.isReady()) return true
    if (this._startPromise) return this._startPromise
    this._startPromise = this._start().catch((err) => {
      this.log('warn', `[aria2] start failed: ${err?.message || err}`)
      this._ready = false
      return false
    })
    const ok = await this._startPromise
    if (!ok) this._startPromise = null // allow a later retry
    return ok
  }

  async _start() {
    if (!this.binaryPath) {
      this.log('warn', '[aria2] no binary found (bundle it via scripts/fetch-aria2.cjs); using in-process downloader')
      return false
    }
    this.port = await getFreePort()
    const args = [
      '--enable-rpc',
      '--rpc-listen-all=false',
      `--rpc-listen-port=${this.port}`,
      `--rpc-secret=${this.secret}`,
      '--continue=true',
      '--auto-file-renaming=false',
      '--allow-overwrite=true',
      // Don't preallocate — preallocation can stall the FS for seconds on big
      // files, which is exactly the kind of hitch we're trying to remove.
      '--file-allocation=none',
      '--max-connection-per-server=8',
      '--split=8',
      '--min-split-size=8M',
      '--summary-interval=0',
      '--console-log-level=warn',
      '--quiet=true',
    ]
    this.log('info', `[aria2] spawning ${this.binaryPath} on rpc port ${this.port}`)
    this.proc = spawn(this.binaryPath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    this.proc.on('exit', (code, signal) => {
      this.log('warn', `[aria2] daemon exited code=${code} signal=${signal}`)
      this._ready = false
      this.proc = null
      this._startPromise = null
    })
    this.proc.on('error', (err) => {
      this.log('warn', `[aria2] daemon error: ${err?.message || err}`)
      this._ready = false
    })
    if (this.proc.stderr) {
      this.proc.stderr.on('data', (d) => {
        const s = String(d).trim()
        if (s) this.log('warn', `[aria2] ${s}`)
      })
    }
    // Wait for the RPC endpoint to answer getVersion.
    const deadline = Date.now() + 6000
    while (Date.now() < deadline) {
      if (!this.proc) return false
      try {
        await this._rpc('aria2.getVersion', [])
        this._ready = true
        this.log('info', '[aria2] daemon ready')
        return true
      } catch {
        await new Promise((r) => setTimeout(r, 150))
      }
    }
    this.log('warn', '[aria2] daemon did not become ready in time')
    return false
  }

  stop() {
    this._ready = false
    if (this.proc) {
      try {
        // Ask aria2 to shut down cleanly so it flushes .aria2 control files
        // (needed for exact resume next launch); fall back to kill.
        this._rpc('aria2.forceShutdown', []).catch(() => {})
      } catch { /* ignore */ }
      const proc = this.proc
      this.proc = null
      setTimeout(() => { try { if (!proc.killed) proc.kill() } catch { /* ignore */ } }, 1500)
    }
  }

  /** Low-level JSON-RPC call over HTTP. Rejects on transport/RPC error. */
  _rpc(method, params = []) {
    return new Promise((resolve, reject) => {
      if (!this.port) { reject(new Error('aria2 not started')); return }
      const id = `uc-${++this._rpcId}`
      const body = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params: [`token:${this.secret}`, ...params],
      })
      const req = http.request({
        host: '127.0.0.1',
        port: this.port,
        path: '/jsonrpc',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 8000,
      }, (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (c) => { data += c })
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            if (parsed.error) reject(new Error(parsed.error.message || 'aria2 rpc error'))
            else resolve(parsed.result)
          } catch (e) { reject(e) }
        })
      })
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(new Error('aria2 rpc timeout')) })
      req.end(body)
    })
  }

  // ── High-level helpers ────────────────────────────────────────────────────

  /** Start (or resume-from-disk) a download. Returns the aria2 gid. */
  async addUri(uris, options = {}) {
    const gid = await this._rpc('aria2.addUri', [uris, options])
    return gid
  }

  /** Set the global download speed cap in bytes/sec (0 = unlimited). */
  setMaxOverallDownloadLimit(bytesPerSec) {
    const v = Number(bytesPerSec) > 0 ? String(Math.floor(bytesPerSec)) : '0'
    return this._rpc('aria2.changeGlobalOption', [{ 'max-overall-download-limit': v }]).catch(() => {})
  }

  pause(gid) { return this._rpc('aria2.pause', [gid]) }
  forcePause(gid) { return this._rpc('aria2.forcePause', [gid]) }
  unpause(gid) { return this._rpc('aria2.unpause', [gid]) }
  remove(gid) { return this._rpc('aria2.remove', [gid]) }
  forceRemove(gid) { return this._rpc('aria2.forceRemove', [gid]) }
  removeDownloadResult(gid) { return this._rpc('aria2.removeDownloadResult', [gid]) }

  /** tellStatus with a small field projection to keep the RPC payload tiny. */
  tellStatus(gid) {
    return this._rpc('aria2.tellStatus', [gid, [
      'gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'errorCode', 'errorMessage', 'files',
    ]])
  }
}

module.exports = { Aria2Manager, resolveAria2Binary }
