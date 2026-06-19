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
const { spawn, spawnSync } = require('node:child_process')

/** The bundle roots that hold the aria2 binary + its sidecar files
 *  (cacert.pem), in priority order. `assets/bin/aria2/` is where
 *  scripts/fetch-aria2.cjs drops everything. */
function aria2BundleRoots({ appRoot, resourcesPath } = {}) {
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
  return roots
}

/** Resolve the aria2c binary path for this platform, or null if not found.
 *  Looks first in the bundled assets dir (packaged + dev), then falls back to
 *  whatever `aria2c` is on PATH so power users / Linux distros can supply it. */
function resolveAria2Binary({ appRoot, resourcesPath } = {}) {
  const platform = process.platform // 'win32' | 'darwin' | 'linux'
  const arch = process.arch // 'x64' | 'arm64' | ...
  const exe = platform === 'win32' ? 'aria2c.exe' : 'aria2c'
  const subdirs = [`${platform}-${arch}`, platform, '']
  for (const root of aria2BundleRoots({ appRoot, resourcesPath })) {
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

/** Resolve the bundled CA bundle (cacert.pem), or null if absent.
 *  The Windows aria2 build links OpenSSL, which has no built-in trust store —
 *  every HTTPS handshake fails with "unable to get local issuer certificate"
 *  unless we point it at this bundle via --ca-certificate. Lives at the root of
 *  assets/bin/aria2/ (shared across platforms). */
function resolveAria2CaCert({ appRoot, resourcesPath } = {}) {
  for (const root of aria2BundleRoots({ appRoot, resourcesPath })) {
    const candidate = path.join(root, 'cacert.pem')
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
    } catch { /* ignore */ }
  }
  return null
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
   * @param {string} [opts.userDataPath] writable dir to stage an executable copy
   *   of the binary when the bundled location is read-only (AppImage squashfs).
   * @param {(level:string,msg:string)=>void} [opts.log]
   */
  constructor({ binaryPath, appRoot, resourcesPath, userDataPath, log } = {}) {
    this.binaryPath = binaryPath || resolveAria2Binary({ appRoot, resourcesPath })
    // CA bundle for the OpenSSL build's certificate verification (see
    // resolveAria2CaCert). null on a build that didn't ship one — we then leave
    // verification to whatever default store aria2 finds (Linux system certs).
    this.caCertPath = resolveAria2CaCert({ appRoot, resourcesPath })
    this.userDataPath = userDataPath || null
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

  /**
   * Return a path to an aria2c binary we can actually exec on this OS.
   *
   * The bundled Linux/macOS binary frequently arrives WITHOUT the exec bit:
   * it's fetched/packaged on a Windows CI host (which has no Unix mode bits),
   * and even a correctly-chmod'd binary ends up inside the AppImage's
   * read-only squashfs mount (`/tmp/.mount_*`) where we can't chmod it at
   * runtime. The symptom is `spawn … aria2c EACCES`.
   *
   * Strategy, cheapest first:
   *   1. Already executable → use as-is.
   *   2. chmod +x in place → works for dev / writable installs.
   *   3. Copy into a writable dir (userData) and chmod the copy → the
   *      read-only-mount (AppImage) case.
   * Falls back to the original path if all of that fails; spawn will then
   * surface the real error and we degrade to the in-process downloader.
   */
  _ensureExecutable(binPath) {
    if (process.platform === 'win32' || !binPath) return binPath
    // Bare command (e.g. 'aria2c' from PATH) — let the OS resolve + exec it.
    if (!path.isAbsolute(binPath)) return binPath
    try { if (!fs.statSync(binPath).isFile()) return binPath } catch { return binPath }

    // 1. Already executable.
    try { fs.accessSync(binPath, fs.constants.X_OK); return binPath } catch { /* not yet */ }

    // 2. chmod in place (writable install).
    try {
      fs.chmodSync(binPath, 0o755)
      fs.accessSync(binPath, fs.constants.X_OK)
      this.log('info', `[aria2] marked bundled binary executable: ${binPath}`)
      return binPath
    } catch (err) {
      this.log('warn', `[aria2] cannot chmod bundled binary in place (${err?.code || err?.message || err}); staging a writable copy`)
    }

    // 3. Stage an executable copy in a writable location.
    if (!this.userDataPath) {
      this.log('warn', '[aria2] no userData path to stage an executable copy from a read-only bundle')
      return binPath
    }
    try {
      const exe = path.basename(binPath)
      const destDir = path.join(this.userDataPath, 'bin', 'aria2', `${process.platform}-${process.arch}`)
      const dest = path.join(destDir, exe)
      // Reuse a prior good copy: present, same size as the source, executable.
      let reuse = false
      try {
        const src = fs.statSync(binPath)
        const dst = fs.statSync(dest)
        if (dst.isFile() && dst.size === src.size) {
          fs.accessSync(dest, fs.constants.X_OK)
          reuse = true
        }
      } catch { /* missing / not executable → (re)copy */ }
      if (!reuse) {
        fs.mkdirSync(destDir, { recursive: true })
        fs.copyFileSync(binPath, dest)
        fs.chmodSync(dest, 0o755)
        fs.accessSync(dest, fs.constants.X_OK)
        this.log('info', `[aria2] staged executable copy at ${dest}`)
      }
      return dest
    } catch (err) {
      this.log('warn', `[aria2] failed to stage executable copy: ${err?.message || err}`)
      return binPath
    }
  }

  async _start() {
    if (!this.binaryPath) {
      this.log('warn', '[aria2] no binary found (bundle it via scripts/fetch-aria2.cjs); using in-process downloader')
      return false
    }
    // Make sure we have an executable path before spawning — the bundled
    // binary may not have the exec bit (Windows build host / read-only mount).
    const runBin = this._ensureExecutable(this.binaryPath)
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
      // Retry on transient network errors (WSAENETUNREACH, connection reset, etc.)
      '--max-tries=10',
      '--retry-wait=5',
      '--connect-timeout=30',
      '--timeout=60',
      // aria2 does not implement Happy Eyeballs (RFC 6555). On Windows machines
      // that have an IPv6 interface but no routable IPv6 path, connecting to a
      // dual-stack host returns WSAENETUNREACH immediately on the IPv6 socket
      // instead of falling back to IPv4 — Chromium handles this transparently
      // but aria2 does not. Force IPv4 to avoid spurious failures.
      '--disable-ipv6=true',
    ]
    // TLS verification. The Windows aria2 build links OpenSSL (chosen so the
    // handshake doesn't depend on the OS Schannel state — see fetch-aria2.cjs),
    // but OpenSSL ships no trust store, so we hand it the bundled CA bundle.
    // Without --ca-certificate every HTTPS download dies with
    // "SSL/TLS handshake failure: unable to get local issuer certificate".
    if (this.caCertPath) {
      args.push('--check-certificate=true')
      args.push(`--ca-certificate=${this.caCertPath}`)
      this.log('info', `[aria2] using CA bundle ${this.caCertPath}`)
    } else {
      this.log('warn', '[aria2] no bundled cacert.pem found — relying on system trust store (HTTPS may fail on the OpenSSL Windows build)')
    }
    this.log('info', `[aria2] spawning ${runBin} on rpc port ${this.port}`)
    this.proc = spawn(runBin, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
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
    this._startPromise = null
    const proc = this.proc
    this.proc = null
    if (!proc) return
    try {
      // Best-effort clean shutdown so aria2 flushes its .aria2 control files
      // (helps exact segmented resume next launch).
      this._rpc('aria2.forceShutdown', []).catch(() => {})
    } catch { /* ignore */ }
    // Then kill DETERMINISTICALLY. stop() runs inside Electron's 'will-quit',
    // which does not keep the event loop alive for a deferred timer — the old
    // setTimeout(..., 1500) kill never fired, orphaning aria2c (it kept holding
    // the RPC port and writing partial files to disk). On Windows kill the whole
    // process tree synchronously via taskkill; elsewhere SIGTERM. spawnSync
    // blocks will-quit only for the few ms taskkill needs.
    try {
      if (process.platform === 'win32' && proc.pid) {
        spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, timeout: 4000 })
      } else {
        proc.kill('SIGTERM')
      }
    } catch {
      try { proc.kill() } catch { /* ignore */ }
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
