/**
 * fetch-gcpad.cjs
 *
 * Downloads gcpad libraries from the latest UnionCrax-Team/GCPad_API
 * GitHub release and places them in gcpad-lib/.
 *
 * Supports both Windows (.dll) and Linux (.so) assets.
 *
 * Usage:
 *   node ./scripts/fetch-gcpad.cjs
 *   node ./scripts/fetch-gcpad.cjs --tag v1.2.3   (specific release)
 *
 * Set GITHUB_TOKEN / GH_TOKEN to avoid rate limits.
 */

'use strict'

const https  = require('node:https')
const fs     = require('node:fs')
const path   = require('node:path')
const url    = require('node:url')
const { execSync } = require('node:child_process')

const REPO      = 'UnionCrax-Team/GCPad_API'
const OUT_DIR   = path.join(__dirname, '..', 'gcpad-lib')

// Platform-specific assets
const PLATFORM_ASSETS = {
  win32: [
    { name: 'gcpad-unioncrax-direct-win-x64.zip', out: ['gcpad.dll', 'SDL2.dll'] },
    { name: 'gcpad.dll', out: ['gcpad.dll'] },
    { name: 'SDL2.dll', out: ['SDL2.dll'] },
  ],
  linux: [
    { name: 'gcpad-unioncrax-direct-linux-x64.tar.gz', out: ['libgcpad.so', 'libSDL2-2.0.so.0'] },
    { name: 'libgcpad.so', out: ['libgcpad.so'] },
    { name: 'libSDL2-2.0.so.0', out: ['libSDL2-2.0.so.0'] },
  ],
  darwin: [
    { name: 'gcpad-unioncrax-direct-macos-x64.tar.gz', out: ['libgcpad.dylib'] },
    { name: 'libgcpad.dylib', out: ['libgcpad.dylib'] },
  ]
}

// ── CLI args ─────────────────────────────────────────────────────────────────

const tagArg = process.argv.includes('--tag')
  ? process.argv[process.argv.indexOf('--tag') + 1]
  : null

const platform = process.platform

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function makeHeaders() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  const headers = {
    'User-Agent': 'UnionCrax.Direct-build-script',
    'Accept':     'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

function httpGet(targetUrl, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new url.URL(targetUrl)
    const opts = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      headers:  headers || makeHeaders(),
    }
    https.get(opts, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(httpGet(res.headers.location, {
          'User-Agent': opts.headers['User-Agent'],
        }))
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} from ${targetUrl}`))
      }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end',  () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    }).on('error', reject)
  })
}

// ── Archive extraction ───────────────────────────────────────────────────────

function extractArchive(archivePath, destDir, isZip = false) {
  if (isZip) {
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Force -Path '${archivePath}' -DestinationPath '${destDir}'"`,
      { stdio: 'inherit' }
    )
  } else {
    execSync(`tar -xzf "${archivePath}" -C "${destDir}"`, { stdio: 'inherit' })
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const releaseEndpoint = tagArg
    ? `https://api.github.com/repos/${REPO}/releases/tags/${tagArg}`
    : `https://api.github.com/repos/${REPO}/releases/latest`

  console.log(`[fetch-gcpad] Querying ${REPO} releases...`)
  let release
  try {
    const body = await httpGet(releaseEndpoint)
    release = JSON.parse(body.toString('utf8'))
  } catch (err) {
    console.error(`[fetch-gcpad] Failed to fetch release metadata: ${err.message}`)
    console.error('  Is the GCPad_API repo public and does it have a release?')
    process.exit(1)
  }

  if (release.message === 'Not Found') {
    console.error(`[fetch-gcpad] No release found${tagArg ? ` for tag ${tagArg}` : ''}.`)
    process.exit(1)
  }

  console.log(`[fetch-gcpad] Using release: ${release.tag_name} — "${release.name}"`)

  const assets = PLATFORM_ASSETS[platform] || PLATFORM_ASSETS.linux
  let extracted = false

  for (const assetSpec of assets) {
    const asset = (release.assets || []).find(a => a.name === assetSpec.name)
    if (!asset) continue

    const sizeMB = (asset.size / 1024 / 1024).toFixed(2)
    process.stdout.write(`[fetch-gcpad] Downloading ${asset.name} (${sizeMB} MB)... `)

    const buf = await httpGet(asset.browser_download_url)
    const tmpPath = path.join(OUT_DIR, asset.name)
    fs.writeFileSync(tmpPath, buf)
    console.log('done')

    // Extract if archive
    if (asset.name.endsWith('.zip') || asset.name.endsWith('.tar.gz')) {
      console.log(`[fetch-gcpad] Extracting to ${OUT_DIR}...`)
      extractArchive(tmpPath, OUT_DIR, asset.name.endsWith('.zip'))
      fs.unlinkSync(tmpPath)
    } else {
      // Individual file - rename to expected output name if needed
      const outName = Array.isArray(assetSpec.out) ? assetSpec.out[0] : assetSpec.name
      if (outName !== asset.name) {
        fs.renameSync(tmpPath, path.join(OUT_DIR, outName))
      }
    }

    extracted = true
    break
  }

  if (!extracted) {
    console.error(`[fetch-gcpad] No matching assets found for platform ${platform}`)
    console.error(`  Available: ${(release.assets || []).map(a => a.name).join(', ') || '(none)'}`)
    process.exit(1)
  }

  console.log(`[fetch-gcpad] All assets written to gcpad-lib/`)
}

main().catch(err => {
  console.error('[fetch-gcpad] Unexpected error:', err)
  process.exit(1)
})