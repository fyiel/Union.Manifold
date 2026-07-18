import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'native', 'trainer-host', 'main.cpp')
const output = path.join(root, 'src-tauri', 'resources')

function findCompiler(names) {
  for (const name of names) {
    for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
      const candidate = path.join(directory, name)
      if (fs.existsSync(candidate)) return candidate
    }
  }
  throw new Error(`Missing MinGW compiler: ${names.join(' or ')}`)
}
const common = [
  '-std=c++17', '-Os', '-s', '-ffunction-sections', '-fdata-sections',
  '-Wall', '-Wextra', '-Werror', '-mwindows', source,
  '-static', '-static-libgcc', '-static-libstdc++', '-Wl,--gc-sections', '-lws2_32',
]
const targets = [
  [['x86_64-w64-mingw32-g++-posix', 'x86_64-w64-mingw32-g++'], 'trainer-host-x64.exe'],
  [['i686-w64-mingw32-g++-posix', 'i686-w64-mingw32-g++'], 'trainer-host-x86.exe'],
]

fs.mkdirSync(output, { recursive: true })
for (const [compilers, name] of targets) {
  const compiler = findCompiler(compilers)
  const destination = path.join(output, name)
  console.log(`[trainer-host] building ${name} with ${path.basename(compiler)}`)
  execFileSync(compiler, [...common, '-o', destination], { stdio: 'inherit' })
}
