const { spawn } = require('node:child_process')

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('Usage: node scripts/run-electron.cjs <main-script>')
  process.exit(1)
}

// Electron runs in "node mode" when ELECTRON_RUN_AS_NODE is present (even if "0"),
// and some environments set it globally. Remove it for the spawned Electron process.
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const electronPath = require('electron')
const child = spawn(electronPath, args, { stdio: 'inherit', env })
child.on('exit', (code, signal) => {
  if (signal) process.exit(1)
  process.exit(code ?? 0)
})
