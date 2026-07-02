import https from 'node:https'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const binDir = path.join(root, 'src-tauri', 'binaries')
const resDir = path.join(root, 'src-tauri', 'resources')

const ARIA2_VERSION = process.env.ARIA2_VERSION || '1.37.0'
const SEVENZIP_VERSION = process.env.SEVENZIP_VERSION || '2301'
const CACERT_URL = process.env.ARIA2_CACERT_URL || 'https://curl.se/ca/cacert.pem'

const TRIPLES = {
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'win32-x64': 'x86_64-pc-windows-msvc',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
}

const ARIA2 = {
  'win32-x64': { url: `https://github.com/zhengqwe/aria2-static-builds-with-patches/releases/download/v${ARIA2_VERSION}/aria2-${ARIA2_VERSION}-win-x86-64.zip`, bin: 'aria2c.exe' },
  'linux-x64': { url: `https://github.com/abcfy2/aria2-static-build/releases/download/${ARIA2_VERSION}/aria2-x86_64-linux-musl_static.zip`, bin: 'aria2c' },
  'linux-arm64': { url: `https://github.com/abcfy2/aria2-static-build/releases/download/${ARIA2_VERSION}/aria2-aarch64-linux-musl_static.zip`, bin: 'aria2c' },
}

const SEVENZIP = {
  'linux-x64': { url: `https://www.7-zip.org/a/7z${SEVENZIP_VERSION}-linux-x64.tar.xz`, src: '7zzs' },
  'linux-arm64': { url: `https://www.7-zip.org/a/7z${SEVENZIP_VERSION}-linux-arm64.tar.xz`, src: '7zzs' },
  'win32-x64': { url: `https://www.7-zip.org/a/7z${SEVENZIP_VERSION}-extra.7z`, src: '7za.exe', srcSub: 'x64' },
  'darwin-x64': { url: `https://www.7-zip.org/a/7z${SEVENZIP_VERSION}-mac.tar.xz`, src: '7zz' },
  'darwin-arm64': { url: `https://www.7-zip.org/a/7z${SEVENZIP_VERSION}-mac.tar.xz`, src: '7zz' },
}

const hostKey = `${process.platform}-${process.arch}`

function log(msg) {
  console.log(`[fetch-sidecars] ${msg}`)
}

function targets() {
  const args = process.argv.slice(2)
  if (args.includes('--all')) return ['linux-x64', 'win32-x64']
  const explicit = args.filter((a) => TRIPLES[a])
  return explicit.length ? explicit : [hostKey]
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('too many redirects'))
    https
      .get(url, { headers: { 'User-Agent': 'Union.Manifold-build' } }, (res) => {
        const status = res.statusCode || 0
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume()
          return resolve(download(new URL(res.headers.location, url).toString(), dest, redirects + 1))
        }
        if (status !== 200) {
          res.resume()
          return reject(new Error(`HTTP ${status} for ${url}`))
        }
        const file = fs.createWriteStream(dest)
        res.pipe(file)
        file.on('finish', () => file.close((err) => (err ? reject(err) : resolve())))
        file.on('error', (err) => {
          fs.rmSync(dest, { force: true })
          reject(err)
        })
      })
      .on('error', reject)
  })
}

function extract(archive, dir) {
  if (archive.endsWith('.zip')) {
    if (process.platform === 'win32') {
      execSync(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '${archive}' -DestinationPath '${dir}' -Force"`, { stdio: 'inherit' })
    } else {
      execSync(`unzip -o "${archive}" -d "${dir}"`, { stdio: 'inherit' })
    }
  } else if (/\.tar\.(xz|gz|bz2)$/.test(archive)) {
    execSync(`tar -xf "${archive}" -C "${dir}"`, { stdio: 'inherit' })
  } else if (archive.endsWith('.7z')) {
    execSync(`7z x -y -o"${dir}" "${archive}"`, { stdio: 'inherit' })
  } else {
    throw new Error(`cannot extract ${archive}`)
  }
}

function findFile(dir, name, sub) {
  let found = null
  const walk = (d) => {
    if (found) return
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === name && (!sub || full.includes(path.sep + sub + path.sep))) found = full
    }
  }
  walk(dir)
  return found
}

async function stage(spec, outName, triple, isWin) {
  const dest = path.join(binDir, `${outName}-${triple}${isWin ? '.exe' : ''}`)
  if (fs.existsSync(dest)) return log(`present ${path.basename(dest)}`)
  const tmp = path.join(os.tmpdir(), `sc-${Date.now()}-${path.basename(spec.url)}`)
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-'))
  try {
    log(`downloading ${spec.url}`)
    await download(spec.url, tmp)
    extract(tmp, work)
    const bin = findFile(work, spec.src ?? spec.bin, spec.srcSub)
    if (!bin) throw new Error(`${spec.src ?? spec.bin} not found`)
    fs.mkdirSync(binDir, { recursive: true })
    fs.copyFileSync(bin, dest)
    if (!isWin) fs.chmodSync(dest, 0o755)
    log(`installed ${path.basename(dest)}`)
  } finally {
    fs.rmSync(tmp, { force: true })
    fs.rmSync(work, { recursive: true, force: true })
  }
}

async function cacert() {
  const dest = path.join(resDir, 'cacert.pem')
  if (fs.existsSync(dest)) return log('cacert present')
  fs.mkdirSync(resDir, { recursive: true })
  const tmp = path.join(os.tmpdir(), `cacert-${Date.now()}.pem`)
  try {
    await download(CACERT_URL, tmp)
    if (!fs.readFileSync(tmp, 'utf8').includes('BEGIN CERTIFICATE')) throw new Error('not a PEM bundle')
    fs.copyFileSync(tmp, dest)
    log('installed cacert.pem')
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

async function main() {
  for (const key of targets()) {
    const triple = TRIPLES[key]
    const isWin = key.startsWith('win32')
    if (ARIA2[key]) {
      try {
        await stage(ARIA2[key], 'aria2c', triple, isWin)
      } catch (e) {
        log(`aria2 ${key} skipped (${e.message})`)
      }
    }
    if (SEVENZIP[key]) {
      try {
        await stage(SEVENZIP[key], '7z', triple, isWin)
      } catch (e) {
        log(`7z ${key} skipped (${e.message})`)
      }
    }
  }
  try {
    await cacert()
  } catch (e) {
    log(`cacert skipped (${e.message})`)
  }
}

main().catch((e) => {
  log(`skipped (${e.message})`)
  process.exit(0)
})
