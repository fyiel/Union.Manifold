/**
 * fetch-gcpad.cjs
 *
 * Downloads the appropriate GCPad binaries from the latest
 * UnionCrax-Team/GCPad_API GitHub release and extracts them to gcpad-dll/.
 *
 * Usage:
 *   node ./scripts/fetch-gcpad.cjs
 *   node ./scripts/fetch-gcpad.cjs --tag v1.2.3   (specific release)
 *
 * Respects GITHUB_TOKEN / GH_TOKEN env vars to avoid rate limits.
 */

'use strict'

const https  = require('node:https')
const fs     = require('node:fs')
const path   = require('node:path')
const url    = require('node:url')
const { execSync } = require('node:child_process')

const REPO      = 'UnionCrax-Team/GCPad_API'
const OUT_DIR   = path.join(__dirname, '..', 'gcpad-dll')

const IS_WINDOWS = process.platform === 'win32'
const IS_LINUX   = process.platform === 'linux'

const ZIP_ASSET_WINDOWS = 'gcpad-unioncrax-direct.zip'
const ZIP_ASSET_LINUX   = 'gcpad-unioncrax-direct.tar.gz'

const WINDOWS_FALLBACK  = ['gcpad.dll', 'SDL2.dll']
const LINUX_FALLBACK    = ['libgcpad.so.1.0.0', 'libgcpad.so.1', 'libgcpad.so']

// ── CLI args ─────────────────────────────────────────────────────────────────

const tagArg = process.argv.includes('--tag')
  ? process.argv[process.argv.indexOf('--tag') + 1]
  : null

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

// ── Zip extraction (uses PowerShell on Windows, unzip on Linux) ──────────────

function extractZip(zipPath, destDir, isTarGz = false) {
  if (process.platform === 'win32') {
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${destDir}'"`,
      { stdio: 'inherit' }
    )
  } else {
    const cmd = isTarGz ? `tar -xzf "${zipPath}" -C "${destDir}"` : `unzip -o "${zipPath}" -d "${destDir}"`
    execSync(cmd, { stdio: 'inherit' })
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
    console.error(`  Push a version tag (e.g. v1.0.0) to UnionCrax-Team/GCPad_API to create one.`)
    process.exit(1)
  }

  console.log(`[fetch-gcpad] Using release: ${release.tag_name} — "${release.name}"`)

  if (IS_WINDOWS) {
    const zipAsset = (release.assets || []).find(a => a.name === ZIP_ASSET_WINDOWS)

    if (zipAsset) {
      const sizeMB = (zipAsset.size / 1024 / 1024).toFixed(2)
      process.stdout.write(`[fetch-gcpad] Downloading ${ZIP_ASSET_WINDOWS} (${sizeMB} MB)... `)

      const buf = await httpGet(zipAsset.browser_download_url)
      const tmpZip = path.join(OUT_DIR, ZIP_ASSET_WINDOWS)
      fs.writeFileSync(tmpZip, buf)
      console.log('done')

      console.log(`[fetch-gcpad] Extracting to ${OUT_DIR}...`)
      extractZip(tmpZip, OUT_DIR, false)
      fs.unlinkSync(tmpZip)
      console.log(`[fetch-gcpad] Extracted successfully`)
    } else {
      console.log(`[fetch-gcpad] ${ZIP_ASSET_WINDOWS} not found, falling back to individual assets`)
      for (const assetName of WINDOWS_FALLBACK) {
        const asset = (release.assets || []).find(a => a.name === assetName)
        if (!asset) {
          console.error(`[fetch-gcpad] Asset "${assetName}" not found in release ${release.tag_name}.`)
          console.error(`  Available: ${(release.assets || []).map(a => a.name).join(', ') || '(none)'}`)
          process.exit(1)
        }

        const outPath = path.join(OUT_DIR, assetName)
        const sizeMB = (asset.size / 1024 / 1024).toFixed(2)
        process.stdout.write(`[fetch-gcpad] Downloading ${assetName} (${sizeMB} MB)... `)

        const buf = await httpGet(asset.browser_download_url)
        fs.writeFileSync(outPath, buf)
        console.log('done')
      }
    }
  } else if (IS_LINUX) {
    const zipAsset = (release.assets || []).find(a => a.name === ZIP_ASSET_LINUX)

    if (zipAsset) {
      const sizeMB = (zipAsset.size / 1024 / 1024).toFixed(2)
      process.stdout.write(`[fetch-gcpad] Downloading ${ZIP_ASSET_LINUX} (${sizeMB} MB)... `)

      const buf = await httpGet(zipAsset.browser_download_url)
      const tmpZip = path.join(OUT_DIR, ZIP_ASSET_LINUX)
      fs.writeFileSync(tmpZip, buf)
      console.log('done')

      console.log(`[fetch-gcpad] Extracting to ${OUT_DIR}...`)
      extractZip(tmpZip, OUT_DIR, true)
      fs.unlinkSync(tmpZip)
      console.log(`[fetch-gcpad] Extracted successfully`)
    } else {
      console.log(`[fetch-gcpad] ${ZIP_ASSET_LINUX} not found, falling back to individual assets`)
      for (const assetName of LINUX_FALLBACK) {
        const asset = (release.assets || []).find(a => a.name === assetName)
        if (!asset) {
          console.error(`[fetch-gcpad] Asset "${assetName}" not found in release ${release.tag_name}.`)
          console.error(`  Available: ${(release.assets || []).map(a => a.name).join(', ') || '(none)'}`)
          process.exit(1)
        }

        const outPath = path.join(OUT_DIR, assetName)
        const sizeMB = (asset.size / 1024 / 1024).toFixed(2)
        process.stdout.write(`[fetch-gcpad] Downloading ${assetName} (${sizeMB} MB)... `)

        const buf = await httpGet(asset.browser_download_url)
        fs.writeFileSync(outPath, buf)
        console.log('done')
      }
    }
  } else {
    console.log(`[fetch-gcpad] Platform ${process.platform} not supported for GCPad`)
    process.exit(0)
  }

  console.log(`[fetch-gcpad] All assets written to gcpad-dll/`)
}

main().catch(err => {
  console.error('[fetch-gcpad] Unexpected error:', err)
  process.exit(1)
})
