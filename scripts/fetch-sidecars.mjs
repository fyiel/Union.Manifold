import https from 'node:https'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const binDir = path.join(root, 'src-tauri', 'binaries')
const resDir = path.join(root, 'src-tauri', 'resources')

const ARIA2_VERSION = process.env.ARIA2_VERSION || '1.37.0'
const SEVENZIP_VERSION = process.env.SEVENZIP_VERSION || '2301'
const CACERT_URL = process.env.ARIA2_CACERT_URL || 'https://curl.se/ca/cacert.pem'
const SEVENZR_URL = process.env.SEVENZR_URL || 'https://www.7-zip.org/a/7zr.exe'

const TRIPLES = {
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'win32-x64': 'x86_64-pc-windows-msvc',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
}

const ARIA2_SHA = ARIA2_VERSION === '1.37.0' ? {
  'win32-x64': '5e97ad1a2adafeeaa0ffce1bcbfd0e3e31cc054ad1c73797615a77e20a4f9e32',
  'linux-x64': 'e0a09b12ef67f35f8a8e4fdddbec851d235b7c31da549d0578bff459032b499a',
  'linux-arm64': '0c681a89a40e0f82d1f5137608e86257eb0af201459c002941ea098f2b8c26b6',
  'darwin-x64': '26ff72ce4a200b05cc077c18585a4dce90cca5e211a9c19f05dec62a3a00e747',
  'darwin-arm64': '3c5bc057abf7551b2b29b711a695993d6c74a3735b4c312f462e5241028c9b73',
} : {}

const SEVENZIP_SHA = SEVENZIP_VERSION === '2301' ? {
  'linux-x64': '23babcab045b78016e443f862363e4ab63c77d75bc715c0b3463f6134cbcf318',
  'linux-arm64': '34e938fc4ba8ca6a835239733d9c1542ad8442cc037f43ca143a119bdf322b63',
  'win32-x64': 'db3a1cbe57a26fac81b65c6a2d23feaecdeede3e4c1fe8fb93a7b91d72d1094c',
  'darwin-x64': '343eae9ccbbd8f68320adaaa3c87e0244cf39fad0fbec6b9d2cd3e5b0f8a5fbf',
  'darwin-arm64': '343eae9ccbbd8f68320adaaa3c87e0244cf39fad0fbec6b9d2cd3e5b0f8a5fbf',
} : {}

const ARIA2 = {
  'win32-x64': { url: `https://github.com/zhengqwe/aria2-static-builds-with-patches/releases/download/v${ARIA2_VERSION}/aria2-${ARIA2_VERSION}-win-x86-64.zip`, bin: 'aria2c.exe', sha256: ARIA2_SHA['win32-x64'] },
  'linux-x64': { url: `https://github.com/abcfy2/aria2-static-build/releases/download/${ARIA2_VERSION}/aria2-x86_64-linux-musl_static.zip`, bin: 'aria2c', sha256: ARIA2_SHA['linux-x64'] },
  'linux-arm64': { url: `https://github.com/abcfy2/aria2-static-build/releases/download/${ARIA2_VERSION}/aria2-aarch64-linux-musl_static.zip`, bin: 'aria2c', sha256: ARIA2_SHA['linux-arm64'] },
  'darwin-x64': { url: `https://github.com/Morton-Li/Aria2-MacOS-Builder/releases/download/release-${ARIA2_VERSION}/aria2c-macos-x86_64.tar.gz`, bin: 'aria2c-macos-x86_64', sha256: ARIA2_SHA['darwin-x64'] },
  'darwin-arm64': { url: `https://github.com/Morton-Li/Aria2-MacOS-Builder/releases/download/release-${ARIA2_VERSION}/aria2c-macos-arm64.tar.gz`, bin: 'aria2c-macos-arm64', sha256: ARIA2_SHA['darwin-arm64'] },
}

const SEVENZIP = {
  'linux-x64': { url: `https://www.7-zip.org/a/7z${SEVENZIP_VERSION}-linux-x64.tar.xz`, src: '7zzs', sha256: SEVENZIP_SHA['linux-x64'] },
  'linux-arm64': { url: `https://www.7-zip.org/a/7z${SEVENZIP_VERSION}-linux-arm64.tar.xz`, src: '7zzs', sha256: SEVENZIP_SHA['linux-arm64'] },
  'win32-x64': { url: `https://www.7-zip.org/a/7z${SEVENZIP_VERSION}-extra.7z`, src: '7za.exe', srcSub: 'x64', sha256: SEVENZIP_SHA['win32-x64'] },
  'darwin-x64': { url: `https://www.7-zip.org/a/7z${SEVENZIP_VERSION}-mac.tar.xz`, src: '7zz', sha256: SEVENZIP_SHA['darwin-x64'] },
  'darwin-arm64': { url: `https://www.7-zip.org/a/7z${SEVENZIP_VERSION}-mac.tar.xz`, src: '7zz', sha256: SEVENZIP_SHA['darwin-arm64'] },
}

const hostKey = `${process.platform}-${process.arch}`

function log(msg) {
  console.log(`[fetch-sidecars] ${msg}`)
}

function targets() {
  const args = process.argv.slice(2)
  if (args.includes('--all')) return Object.keys(TRIPLES)
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

function hasCmd(name) {
  try {
    execSync(process.platform === 'win32' ? `where ${name}` : `command -v ${name}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

let sevenZip = null
async function sevenZipCmd() {
  if (sevenZip) return sevenZip
  for (const c of ['7z', '7za', '7zz']) {
    if (hasCmd(c)) return (sevenZip = c)
  }
  if (process.platform === 'win32') {
    const zr = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sc-7zr-')), '7zr.exe')
    log(`bootstrapping ${SEVENZR_URL}`)
    await download(SEVENZR_URL, zr)
    return (sevenZip = zr)
  }
  throw new Error('no 7z extractor found, install p7zip')
}

async function extract(archive, dir) {
  if (archive.endsWith('.zip')) {
    if (process.platform === 'win32') {
      execFileSync('tar', ['-xf', archive, '-C', dir], { stdio: 'inherit' })
    } else {
      execFileSync('unzip', ['-o', archive, '-d', dir], { stdio: 'inherit' })
    }
  } else if (/\.tar\.(xz|gz|bz2)$/.test(archive)) {
    execFileSync('tar', ['-xf', archive, '-C', dir], { stdio: 'inherit' })
  } else if (archive.endsWith('.7z')) {
    const zip = await sevenZipCmd()
    execFileSync(zip, ['x', '-y', `-o${dir}`, archive], { stdio: 'inherit' })
  } else {
    throw new Error(`cannot extract ${archive}`)
  }
}

function verify(file, spec) {
  if (!spec.sha256) {
    if (process.env.SIDECAR_ALLOW_UNVERIFIED) {
      return log(`WARNING no pinned checksum for ${spec.url}, continuing unverified`)
    }
    throw new Error(`no pinned checksum for ${spec.url} (custom version?), set SIDECAR_ALLOW_UNVERIFIED=1 to bypass`)
  }
  const got = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  if (got !== spec.sha256) {
    throw new Error(`checksum mismatch for ${spec.url}\n  expected ${spec.sha256}\n  got      ${got}`)
  }
  log(`checksum ok ${path.basename(spec.url)}`)
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
  const stamp = `${dest}.src`
  if (fs.existsSync(dest) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === spec.url) {
    return log(`present ${path.basename(dest)}`)
  }
  const tmp = path.join(os.tmpdir(), `sc-${Date.now()}-${path.basename(spec.url)}`)
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-'))
  try {
    log(`downloading ${spec.url}`)
    await download(spec.url, tmp)
    verify(tmp, spec)
    await extract(tmp, work)
    const bin = findFile(work, spec.src ?? spec.bin, spec.srcSub)
    if (!bin) throw new Error(`${spec.src ?? spec.bin} not found`)
    fs.mkdirSync(binDir, { recursive: true })
    fs.copyFileSync(bin, dest)
    if (!isWin) fs.chmodSync(dest, 0o755)
    fs.writeFileSync(stamp, spec.url)
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
  const failures = []
  for (const key of targets()) {
    const triple = TRIPLES[key]
    const isWin = key.startsWith('win32')
    if (ARIA2[key]) {
      try {
        await stage(ARIA2[key], 'aria2c', triple, isWin)
      } catch (e) {
        failures.push(`aria2 ${key}: ${e.message}`)
      }
    }
    if (SEVENZIP[key]) {
      try {
        await stage(SEVENZIP[key], '7z', triple, isWin)
      } catch (e) {
        failures.push(`7z ${key}: ${e.message}`)
      }
    }
  }
  try {
    await cacert()
  } catch (e) {
    failures.push(`cacert: ${e.message}`)
  }
  if (failures.length) {
    for (const f of failures) log(`FAILED ${f}`)
    throw new Error(`${failures.length} sidecar target(s) failed to stage`)
  }
}

main().catch((e) => {
  log(`error: ${e.message}`)
  process.exit(1)
})
