const fs = require('node:fs')
const path = require('node:path')

// For now, Electron main is plain CJS. This script exists so future TS main can be compiled without changing scripts.
const src = path.join(__dirname, '..', 'electron', 'main.cjs')
const outDir = path.join(__dirname, '..', 'electron')
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
if (!fs.existsSync(src)) {
  console.error('Missing electron/main.cjs')
  process.exit(1)
}

