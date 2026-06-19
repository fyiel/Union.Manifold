/**
 * fetch-aria2.cjs
 *
 * Downloads `aria2c` binaries into
 *   assets/bin/aria2/<platform>-<arch>/aria2c[.exe]
 * so electron-builder can bundle them (see asarUnpack in package.json) and the
 * aria2 background downloader can use it at runtime.
 *
 * Usage:
 *   node ./scripts/fetch-aria2.cjs            # fetch for THIS host's platform
 *   node ./scripts/fetch-aria2.cjs --all      # fetch win + linux (for CI / one-host builds)
 *   node ./scripts/fetch-aria2.cjs win32-x64 linux-x64   # explicit targets
 *
 * The project ships Windows + Linux. Each target's binary name differs
 * (aria2c.exe vs aria2c), and extraction happens on the host doing the build —
 * the zips are cross-extractable (Expand-Archive / unzip), so a single Linux or
 * Windows CI host can produce binaries for both with `--all`.
 *
 * Best-effort and non-fatal: a failed/missing source prints guidance and exits
 * 0 so it never breaks `pnpm install`. Sources are overridable via env:
 *   ARIA2_WIN_URL, ARIA2_LINUX_URL, ARIA2_VERSION, ARIA2_LINUX_TAG
 */

'use strict'

const https = require('node:https')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execSync } = require('node:child_process')

const VERSION = process.env.ARIA2_VERSION || '1.37.0'        // aria2 release pinned for all targets
const ABCFY2_TAG = process.env.ARIA2_LINUX_TAG || '1.37.0'   // abcfy2 static musl builds (Linux)
// Mozilla CA bundle (curl distribution). aria2's OpenSSL build does NOT ship a
// trust store, so without this it fails every HTTPS handshake with "unable to
// get local issuer certificate". Bundled once, shared across platforms.
const CACERT_URL = process.env.ARIA2_CACERT_URL || 'https://curl.se/ca/cacert.pem'

// Each target maps to a release zip + the binary name inside it.
const TARGETS = {
  'win32-x64': {
    // IMPORTANT: this is the OpenSSL-linked Windows build, NOT the official
    // aria2 release. The official Windows build links Windows Schannel (WinTLS),
    // which fails the TLS handshake on some machines with
    //   "SSL/TLS handshake failure: The token supplied to the function is
    //    invalid (80090308)"  (SEC_E_INVALID_TOKEN)
    // — a cipher/protocol negotiation failure in the OS TLS stack — while
    // Chromium (the catalog) connects fine with its own BoringSSL. Switching to
    // an OpenSSL build moves TLS into aria2 itself (immune to the OS Schannel
    // state) and makes downloads work wherever browsing already does. OpenSSL
    // needs the bundled cacert.pem (see CACERT_URL + aria2-manager's
    // --ca-certificate). abcfy2 is NOT an option here: its mingw Windows builds
    // force WinTLS, so they'd reproduce the same bug.
    url: process.env.ARIA2_WIN_URL ||
      `https://github.com/zhengqwe/aria2-static-builds-with-patches/releases/download/v${VERSION}/aria2-${VERSION}-win-x86-64.zip`,
    bin: 'aria2c.exe',
  },
  'linux-x64': {
    url: process.env.ARIA2_LINUX_URL ||
      `https://github.com/abcfy2/aria2-static-build/releases/download/${ABCFY2_TAG}/aria2-x86_64-linux-musl_static.zip`,
    bin: 'aria2c',
  },
  'linux-arm64': {
    url: `https://github.com/abcfy2/aria2-static-build/releases/download/${ABCFY2_TAG}/aria2-aarch64-linux-musl_static.zip`,
    bin: 'aria2c',
  },
}

const HOST_PLATFORM = process.platform
const HOST_KEY = `${HOST_PLATFORM}-${process.arch}`

function log(msg) { console.log(`[fetch-aria2] ${msg}`) }

function selectedTargets() {
  const args = process.argv.slice(2)
  if (args.includes('--all')) return ['win32-x64', 'linux-x64']
  const explicit = args.filter((a) => TARGETS[a])
  if (explicit.length) return explicit
  return [HOST_KEY]
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) { reject(new Error('too many redirects')); return }
    const req = https.get(url, { headers: { 'User-Agent': 'UnionCrax.Direct-build' } }, (res) => {
      const status = res.statusCode || 0
      // Follow redirects WITHOUT touching `dest` — GitHub release URLs always
      // redirect to objects.githubusercontent.com.
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        resolve(download(new URL(res.headers.location, url).toString(), dest, redirects + 1))
        return
      }
      if (status !== 200) { res.resume(); reject(new Error(`HTTP ${status} for ${url}`)); return }
      const file = fs.createWriteStream(dest)
      res.pipe(file)
      file.on('finish', () => file.close((err) => (err ? reject(err) : resolve())))
      file.on('error', (err) => { try { fs.unlinkSync(dest) } catch { /* ignore */ } reject(err) })
    })
    req.on('error', reject)
  })
}

function extractTo(archivePath, destDir) {
  // Extraction runs on the build host. zips are cross-extractable on both OSes.
  if (archivePath.endsWith('.zip')) {
    if (HOST_PLATFORM === 'win32') {
      execSync(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${destDir}' -Force"`, { stdio: 'inherit' })
    } else {
      execSync(`unzip -o "${archivePath}" -d "${destDir}"`, { stdio: 'inherit' })
    }
  } else if (/\.tar\.(bz2|gz|xz)$/.test(archivePath)) {
    execSync(`tar -xf "${archivePath}" -C "${destDir}"`, { stdio: 'inherit' })
  } else {
    throw new Error(`don't know how to extract ${archivePath}`)
  }
}

/** Recursively find a file named `binName` under dir. */
function findBinary(dir, binName) {
  let found = null
  const walk = (d) => {
    if (found) return
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === binName) { found = full; return }
    }
  }
  try { walk(dir) } catch { /* ignore */ }
  return found
}

async function fetchTarget(key) {
  const target = TARGETS[key]
  if (!target || !target.url) {
    log(`no source configured for ${key} — skipping (the app will fall back / require a system aria2c).`)
    return
  }
  const outDir = path.join(__dirname, '..', 'assets', 'bin', 'aria2', key)
  const outBin = path.join(outDir, target.bin)
  if (fs.existsSync(outBin)) { log(`already present: ${outBin}`); return }
  fs.mkdirSync(outDir, { recursive: true })
  const tmp = path.join(os.tmpdir(), `aria2-${key}-${Date.now()}.zip`)
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `aria2-x-${key}-`))
  try {
    log(`[${key}] downloading ${target.url}`)
    await download(target.url, tmp)
    log(`[${key}] extracting`)
    extractTo(tmp, work)
    const bin = findBinary(work, target.bin)
    if (!bin) throw new Error(`${target.bin} not found in archive`)
    fs.copyFileSync(bin, outBin)
    if (!target.bin.endsWith('.exe')) fs.chmodSync(outBin, 0o755)
    log(`[${key}] installed → ${outBin}`)
  } finally {
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
    try { fs.rmSync(work, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

/**
 * Download the shared CA bundle into assets/bin/aria2/cacert.pem. aria2's
 * OpenSSL build (Windows) needs an explicit trust store; the daemon is started
 * with --ca-certificate pointing here (see aria2-manager.cjs). Best-effort: if
 * a copy already exists we keep it (offline installs / CI without curl.se).
 */
async function fetchCaCert() {
  const dest = path.join(__dirname, '..', 'assets', 'bin', 'aria2', 'cacert.pem')
  if (fs.existsSync(dest)) { log(`cacert already present: ${dest}`); return }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const tmp = path.join(os.tmpdir(), `cacert-${Date.now()}.pem`)
  try {
    log(`downloading CA bundle ${CACERT_URL}`)
    await download(CACERT_URL, tmp)
    // Sanity-check it looks like a PEM bundle before committing it.
    const head = fs.readFileSync(tmp, 'utf8').slice(0, 64)
    if (!head.includes('BEGIN CERTIFICATE') && !head.includes('##')) {
      throw new Error('downloaded cacert.pem does not look like a PEM bundle')
    }
    fs.copyFileSync(tmp, dest)
    log(`installed CA bundle → ${dest}`)
  } finally {
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  }
}

async function main() {
  const targets = selectedTargets()
  if (!targets.length || (targets.length === 1 && !TARGETS[targets[0]])) {
    log(`no aria2 source for ${HOST_KEY}. Pass explicit targets (win32-x64, linux-x64) or install aria2c on PATH.`)
    return
  }
  for (const key of targets) {
    // One target's failure shouldn't abort the others.
    try { await fetchTarget(key) } catch (err) { log(`[${key}] skipped (${err?.message || err})`) }
  }
  // CA bundle is platform-agnostic and required by the OpenSSL aria2 build.
  try { await fetchCaCert() } catch (err) { log(`cacert skipped (${err?.message || err})`) }
}

main().catch((err) => {
  // Never break install/packaging over this.
  log(`skipped (${err?.message || err}).`)
  process.exit(0)
})
