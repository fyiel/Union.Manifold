/**
 * Rebuilds the native overlay addon against Electron's Node.js headers.
 * Must be run instead of plain `node-gyp rebuild` so the addon's ABI
 * matches the Electron version bundled in the packaged app.
 */
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const root = path.join(__dirname, '..')
const addonDir = path.join(root, 'electron', 'native')

const electronPkg = path.join(root, 'node_modules', 'electron', 'package.json')
if (!fs.existsSync(electronPkg)) {
  console.error('electron package not found – run pnpm install first')
  process.exit(1)
}

const electronVersion = require(electronPkg).version
console.log(`Building native addon for Electron ${electronVersion}`)

execSync(
  [
    'node-gyp', 'rebuild',
    `--target=${electronVersion}`,
    '--arch=x64',
    '--dist-url=https://electronjs.org/headers/',
  ].join(' '),
  { cwd: addonDir, stdio: 'inherit' }
)
