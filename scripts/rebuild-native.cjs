/**
 * Rebuilds the native overlay addon against Electron's Node.js headers.
 * Must be run instead of plain `node-gyp rebuild` so the addon's ABI
 * matches the Electron version bundled in the packaged app.
 *
 * Automatically detects Visual Studio Build Tools / VC++ via vswhere and
 * runs node-gyp inside the correct developer environment. If the build
 * cannot proceed (no Electron install, no C++ build tools) it logs a
 * warning and exits 0 so downstream consumers (e.g. pnpm postinstall on
 * Windows) are not blocked.
 */
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const root = path.join(__dirname, '..')
const addonDir = path.join(root, 'electron', 'native')

try {
  const electronPkg = path.join(root, 'node_modules', 'electron', 'package.json')
  if (!fs.existsSync(electronPkg)) {
    console.warn('Native overlay addon build skipped – electron package not found (run pnpm install first)')
    process.exit(0)
  }

  const electronVersion = require(electronPkg).version
  console.log(`Building native addon for Electron ${electronVersion}`)

  // Locate Visual Studio Build Tools / VC++ via vswhere
  const vswhere = path.join(
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft Visual Studio\\Installer\\vswhere.exe'
  )

  let vcvarsPath = null
  if (fs.existsSync(vswhere)) {
    try {
      const vsInstallPath = execSync(
        `"${vswhere}" -latest -products Microsoft.VisualStudio.Product.BuildTools -property installationPath`,
        { encoding: 'utf-8', timeout: 10000 }
      ).trim()
      if (vsInstallPath) {
        const candidate = path.join(vsInstallPath, 'VC\\Auxiliary\\Build\\vcvars64.bat')
        if (fs.existsSync(candidate)) vcvarsPath = candidate
      }
    } catch {
      // vswhere failed — fall through
    }
  }

  const nodeGypCmd = [
    'node-gyp', 'rebuild',
    `--target=${electronVersion}`,
    '--arch=x64',
    '--dist-url=https://electronjs.org/headers/',
  ].join(' ')

  if (vcvarsPath) {
    // Run inside the VS developer command-prompt environment
    const psWrapper = [
      `$env:GYP_MSVS_VERSION='2022'`,
      `& "${vcvarsPath.replace(/\\/g, '\\\\')}" > $null 2>&1`,
      `& cd "${addonDir}"`,
      nodeGypCmd,
    ].join('; ')

    execSync(
      `powershell -NoProfile -Command "${psWrapper.replace(/"/g, '\\"')}"`,
      { cwd: addonDir, stdio: 'inherit', shell: true }
    )
  } else {
    // No VS found — try bare node-gyp (may work if already in a dev prompt)
    execSync(nodeGypCmd, { cwd: addonDir, stdio: 'inherit' })
  }
} catch (err) {
  console.warn(`Native overlay addon build skipped (install C++ build tools to enable): ${err.message}`)
  process.exit(0)
}
