/**
 * fetch-7zip.cjs
 *
 * Downloads a MODERN 7-Zip console binary into
 *   assets/bin/7zip/<platform>-<arch>/7zz   (7za.exe on Windows)
 * so electron-builder can bundle it (see asarUnpack in package.json) and the
 * extractor prefers it over the ancient p7zip 16.02 that ships inside the
 * `7zip-bin` npm package. 16.02 (2016) cannot decode newer archive methods
 * (e.g. Zstandard-in-zip, added in 7-Zip 22.00) and silently extracts those
 * entries as 0-byte stubs, producing a broken game install.
 *
 * Usage:
 *   node ./scripts/fetch-7zip.cjs            # fetch for THIS host's platform
 *   node ./scripts/fetch-7zip.cjs --all      # fetch every target (CI / one-host)
 *   node ./scripts/fetch-7zip.cjs linux-x64 win32-x64   # explicit targets
 *
 * All targets are pinned to the same upstream release so behaviour is identical
 * across platforms. Best-effort and non-fatal: a failed/missing source prints
 * guidance and exits 0 so it never breaks `pnpm install`. Overridable via env:
 *   SEVENZIP_VERSION (default 2301), SEVENZIP_BASE_URL.
 */

'use strict'

const https = require('node:https')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const VERSION = process.env.SEVENZIP_VERSION || '2301' // 7-Zip 23.01 (last release with binaries for every platform)
const BASE = process.env.SEVENZIP_BASE_URL || 'https://www.7-zip.org/a'

// Each target maps to an upstream archive, the binary name inside it, and the
// name we install it as. `srcSub` narrows a recursive lookup (the Windows extra
// package ships both a 32-bit 7za.exe at the root and a 64-bit one under x64/).
const TARGETS = {
  'linux-x64': { url: `${BASE}/7z${VERSION}-linux-x64.tar.xz`, src: '7zzs', out: '7zz' },
  'linux-arm64': { url: `${BASE}/7z${VERSION}-linux-arm64.tar.xz`, src: '7zzs', out: '7zz' },
  'darwin-x64': { url: `${BASE}/7z${VERSION}-mac.tar.xz`, src: '7zz', out: '7zz' },
  'darwin-arm64': { url: `${BASE}/7z${VERSION}-mac.tar.xz`, src: '7zz', out: '7zz' },
  'win32-x64': { url: `${BASE}/7z${VERSION}-extra.7z`, src: '7za.exe', out: '7za.exe', srcSub: 'x64' },
}

const HOST_KEY = `${process.platform}-${process.arch}`

function log(msg) { console.log(`[fetch-7zip] ${msg}`) }

function selectedTargets() {
  const args = process.argv.slice(2)
  if (args.includes('--all')) return Object.keys(TARGETS)
  const explicit = args.filter((a) => TARGETS[a])
  if (explicit.length) return explicit
  return [HOST_KEY]
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) { reject(new Error('too many redirects')); return }
    const req = https.get(url, { headers: { 'User-Agent': 'Union.Manifold-build' } }, (res) => {
      const status = res.statusCode || 0
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

// The bundled p7zip 16.02 (7zip-bin) extracts standard-LZMA .7z packages fine —
// it only chokes on NEWER methods, which the upstream 7-Zip packages don't use.
function bundled7za() {
  try { return require('7zip-bin').path7za } catch { return null }
}

function extractTo(archivePath, destDir) {
  if (/\.tar\.(bz2|gz|xz)$/.test(archivePath)) {
    execFileSync('tar', ['-xf', archivePath, '-C', destDir], { stdio: 'inherit' })
  } else if (archivePath.endsWith('.7z')) {
    const seven = bundled7za()
    if (!seven) throw new Error('no 7z available to extract .7z (need 7zip-bin)')
    execFileSync(seven, ['x', archivePath, `-o${destDir}`, '-y'], { stdio: 'inherit' })
  } else {
    throw new Error(`don't know how to extract ${archivePath}`)
  }
}

/** Recursively find a file named `binName` under dir, preferring a path that
 *  contains `subHint` (e.g. "x64") when several match. */
function findBinary(dir, binName, subHint) {
  const matches = []
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === binName) matches.push(full)
    }
  }
  try { walk(dir) } catch { /* ignore */ }
  if (subHint) {
    const preferred = matches.find((m) => m.split(path.sep).includes(subHint))
    if (preferred) return preferred
  }
  return matches[0] || null
}

async function fetchTarget(key) {
  const target = TARGETS[key]
  if (!target || !target.url) { log(`no source for ${key} — skipping`); return }
  const outDir = path.join(__dirname, '..', 'assets', 'bin', '7zip', key)
  const outBin = path.join(outDir, target.out)
  if (fs.existsSync(outBin)) { log(`already present: ${outBin}`); return }
  fs.mkdirSync(outDir, { recursive: true })
  const ext = target.url.endsWith('.7z') ? '.7z' : '.tar.xz'
  const tmp = path.join(os.tmpdir(), `7zip-${key}-${Date.now()}${ext}`)
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `7zip-x-${key}-`))
  try {
    log(`[${key}] downloading ${target.url}`)
    await download(target.url, tmp)
    log(`[${key}] extracting`)
    extractTo(tmp, work)
    const bin = findBinary(work, target.src, target.srcSub)
    if (!bin) throw new Error(`${target.src} not found in archive`)
    fs.copyFileSync(bin, outBin)
    if (!target.out.endsWith('.exe')) fs.chmodSync(outBin, 0o755)
    log(`[${key}] installed → ${outBin}`)
  } finally {
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
    try { fs.rmSync(work, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

async function main() {
  const targets = selectedTargets()
  if (!targets.length || (targets.length === 1 && !TARGETS[targets[0]])) {
    log(`no 7-Zip source for ${HOST_KEY}. Pass explicit targets or install 7z on PATH.`)
    return
  }
  for (const key of targets) {
    try { await fetchTarget(key) } catch (err) { log(`[${key}] skipped (${err?.message || err})`) }
  }
}

main().catch((err) => {
  // Never break install/packaging over this — the runtime falls back to a system
  // 7z or the bundled 7zip-bin binary when nothing was fetched.
  log(`skipped (${err?.message || err}).`)
  process.exit(0)
})
