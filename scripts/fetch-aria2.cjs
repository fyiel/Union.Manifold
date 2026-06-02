/**
 * fetch-aria2.cjs
 *
 * Downloads an `aria2c` binary for the HOST platform into
 *   assets/bin/aria2/<platform>-<arch>/aria2c[.exe]
 * so electron-builder can bundle it (see asarUnpack in package.json) and the
 * Hydra-style background downloader can use it at runtime.
 *
 * This is build tooling — run it on the machine/CI that packages each OS:
 *   node ./scripts/fetch-aria2.cjs
 *
 * It is intentionally best-effort and non-fatal: if a download fails or no
 * source is known for the platform, it prints guidance and exits 0 so it never
 * breaks `pnpm install`. The app falls back to its in-process downloader when
 * the binary is absent.
 *
 * Sources (override with env vars if these ever drift):
 *   ARIA2_WIN_URL    — zip containing aria2c.exe (default: official aria2 release)
 *   ARIA2_LINUX_URL  — tar.* containing aria2c   (default: q3aql static build)
 *   ARIA2_MAC_URL    — archive containing aria2c (no stable default; see notes)
 */

'use strict'

const https = require('node:https')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execSync } = require('node:child_process')

const VERSION = process.env.ARIA2_VERSION || '1.37.0'
const DEFAULTS = {
  win32: process.env.ARIA2_WIN_URL ||
    `https://github.com/aria2/aria2/releases/download/release-${VERSION}/aria2-${VERSION}-win-64bit-build1.zip`,
  linux: process.env.ARIA2_LINUX_URL ||
    `https://github.com/q3aql/aria2-static-builds/releases/download/v${VERSION}/aria2-${VERSION}-linux-gnu-64bit-build1.tar.bz2`,
  darwin: process.env.ARIA2_MAC_URL || '',
}

const platform = process.platform
const arch = process.arch
const exe = platform === 'win32' ? 'aria2c.exe' : 'aria2c'
const outDir = path.join(__dirname, '..', 'assets', 'bin', 'aria2', `${platform}-${arch}`)
const outBin = path.join(outDir, exe)

function log(msg) { console.log(`[fetch-aria2] ${msg}`) }

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) { reject(new Error('too many redirects')); return }
    const file = fs.createWriteStream(dest)
    https.get(url, { headers: { 'User-Agent': 'UnionCrax.Direct-build' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close(() => fs.unlink(dest, () => {}))
        const next = new URL(res.headers.location, url).toString()
        resolve(download(next, dest, redirects + 1))
        return
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode} for ${url}`)); return }
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
    }).on('error', (err) => { file.close(() => fs.unlink(dest, () => {})); reject(err) })
  })
}

function extractTo(archivePath, destDir) {
  // Use system tools so we don't add an unzip dependency. Runs on the OS doing
  // the packaging, which has the right tools available.
  if (archivePath.endsWith('.zip')) {
    if (platform === 'win32') {
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

/** Recursively find the aria2c binary under dir. */
function findBinary(dir) {
  let found = null
  const walk = (d) => {
    if (found) return
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === exe) { found = full; return }
    }
  }
  try { walk(dir) } catch { /* ignore */ }
  return found
}

async function main() {
  if (fs.existsSync(outBin)) { log(`already present: ${outBin}`); return }
  const url = DEFAULTS[platform]
  if (!url) {
    log(`no default aria2 source for ${platform}. Set ARIA2_${platform === 'darwin' ? 'MAC' : platform.toUpperCase()}_URL, or install aria2c on PATH (e.g. \`brew install aria2\`). Skipping — app will use the in-process downloader.`)
    return
  }
  fs.mkdirSync(outDir, { recursive: true })
  const tmp = path.join(os.tmpdir(), `aria2-dl-${Date.now()}${path.extname(url) || '.bin'}`)
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-x-'))
  try {
    log(`downloading ${url}`)
    await download(url, tmp)
    log(`extracting`)
    extractTo(tmp, work)
    const bin = findBinary(work)
    if (!bin) throw new Error('aria2c not found in archive')
    fs.copyFileSync(bin, outBin)
    if (platform !== 'win32') fs.chmodSync(outBin, 0o755)
    log(`installed → ${outBin}`)
  } finally {
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
    try { fs.rmSync(work, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

main().catch((err) => {
  // Non-fatal: never break install/packaging over this.
  log(`skipped (${err?.message || err}). The app will use its in-process downloader.`)
  process.exit(0)
})
