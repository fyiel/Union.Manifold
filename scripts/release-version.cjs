'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const readline = require('node:readline')
const { spawnSync } = require('node:child_process')

const rootDir = path.join(__dirname, '..')
const packageJsonPath = path.join(rootDir, 'package.json')
const dryRun = process.argv.includes('--dry-run')
const allowDirty = process.argv.includes('--allow-dirty') || dryRun

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = options.capture
      ? (result.stderr || result.stdout || '').trim()
      : ''
    throw new Error(detail || `${command} ${args.join(' ')} failed with exit code ${result.status}`)
  }

  return result
}

function commandExists(command) {
  const checker = process.platform === 'win32' ? 'where' : 'which'
  const result = spawnSync(checker, [command], {
    cwd: rootDir,
    stdio: 'ignore',
    encoding: 'utf8',
  })
  return result.status === 0
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) throw new Error(`Unsupported version format: ${version}`)
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

function nextVersion(currentVersion, bumpType) {
  const parsed = parseVersion(currentVersion)
  if (bumpType === 'patch') return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`
  if (bumpType === 'minor') return `${parsed.major}.${parsed.minor + 1}.0`
  if (bumpType === 'major') return `${parsed.major + 1}.0.0`
  throw new Error(`Unsupported bump type: ${bumpType}`)
}

function isValidVersion(version) {
  return /^\d+\.\d+\.\d+$/.test(version)
}

function printStep(message) {
  console.log(`\n[release] ${message}`)
}

async function prompt(question, fallback) {
  const suffix = fallback ? ` [${fallback}]` : ''
  const answer = await ask(`${question}${suffix}: `)
  return answer.trim() || fallback || ''
}

async function promptYesNo(question, defaultValue) {
  const hint = defaultValue ? 'Y/n' : 'y/N'
  const answer = (await ask(`${question} [${hint}]: `)).trim().toLowerCase()
  if (!answer) return defaultValue
  if (answer === 'y' || answer === 'yes') return true
  if (answer === 'n' || answer === 'no') return false
  console.log('Please answer y or n.')
  return promptYesNo(question, defaultValue)
}

async function promptMultiline(question) {
  printStep(question)
  console.log('Press Enter twice to finish. Single blank lines are kept in the description.')
  const lines = []
  let blankLineCount = 0
  for (;;) {
    const line = await ask('> ')
    if (!line) {
      blankLineCount += 1
      if (blankLineCount >= 2) break
      lines.push('')
      continue
    }
    blankLineCount = 0
    lines.push(line)
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }

  return lines.join('\n').trim()
}

function ensureCleanWorktree() {
  const result = run('git', ['status', '--porcelain'], { capture: true })
  const output = (result.stdout || '').trim()
  if (!output) return
  throw new Error(
    'Working tree is not clean. Commit or stash existing changes before running the release helper.\n\n' +
    output,
  )
}

function ensureGitHubCliIfNeeded(wantsRelease) {
  if (!wantsRelease) return
  if (!commandExists('gh')) {
    throw new Error('GitHub CLI (`gh`) is required to create or update the GitHub release metadata.')
  }
}

function updatePackageVersion(version) {
  const packageJson = readJson(packageJsonPath)
  packageJson.version = version
  writeJson(packageJsonPath, packageJson)
}

function writeTempNotes(content) {
  const filePath = path.join(os.tmpdir(), `ucd-release-${Date.now()}.md`)
  fs.writeFileSync(filePath, content, 'utf8')
  return filePath
}

function createCommit(version) {
  run('git', ['add', 'package.json'])
  run('git', ['commit', '-m', `chore(release): v${version}`])
}

function pushBranch() {
  run('git', ['push', 'origin', 'HEAD'])
}

function createTag(tagName, releaseName, releaseNotes) {
  const messageParts = [releaseName || tagName]
  if (releaseNotes) messageParts.push('', releaseNotes)
  run('git', ['tag', '-a', tagName, '-m', messageParts.join('\n')])
}

function pushTag(tagName) {
  run('git', ['push', 'origin', tagName])
}

function upsertGitHubRelease(tagName, releaseName, releaseNotes) {
  const notesFile = writeTempNotes(releaseNotes || releaseName || tagName)
  try {
    const existing = spawnSync('gh', ['release', 'view', tagName], {
      cwd: rootDir,
      stdio: 'ignore',
      encoding: 'utf8',
    })
    if (existing.status === 0) {
      run('gh', ['release', 'edit', tagName, '--title', releaseName, '--notes-file', notesFile])
      return
    }
    run('gh', ['release', 'create', tagName, '--title', releaseName, '--notes-file', notesFile])
  } finally {
    fs.unlinkSync(notesFile)
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve)
  })
}

async function chooseVersion(currentVersion) {
  for (;;) {
    printStep(`Current version: ${currentVersion}`)
    const answer = (await prompt('Choose bump type: patch, minor, major, custom, or keep', 'patch')).toLowerCase()
    if (answer === 'keep') return currentVersion
    if (answer === 'custom') {
      const customVersion = await prompt('Enter the new version', currentVersion)
      if (isValidVersion(customVersion)) return customVersion
      console.log('Version must look like 1.2.3.')
      continue
    }
    if (answer === 'patch' || answer === 'minor' || answer === 'major') {
      return nextVersion(currentVersion, answer)
    }
    console.log('Choose patch, minor, major, custom, or keep.')
  }
}

async function main() {
  try {
    if (!allowDirty) ensureCleanWorktree()

    const packageJson = readJson(packageJsonPath)
    const currentVersion = packageJson.version
    const selectedVersion = await chooseVersion(currentVersion)
    const tagName = `v${selectedVersion}`
    const shouldCreateRelease = await promptYesNo('Create or update a GitHub release after tagging', true)
    const releaseName = shouldCreateRelease
      ? await prompt('Release name', tagName)
      : tagName
    const releaseNotes = shouldCreateRelease
      ? await promptMultiline('Enter the release description')
      : ''
    const shouldPushBranch = await promptYesNo('Push the release commit to origin', true)
    const shouldPushTag = await promptYesNo('Push the release tag to origin', true)

    ensureGitHubCliIfNeeded(shouldCreateRelease)

    printStep('Summary')
    console.log(`Version: ${currentVersion} -> ${selectedVersion}`)
    console.log(`Tag: ${tagName}`)
    console.log(`GitHub release metadata: ${shouldCreateRelease ? 'yes' : 'no'}`)
    console.log(`Push commit: ${shouldPushBranch ? 'yes' : 'no'}`)
    console.log(`Push tag: ${shouldPushTag ? 'yes' : 'no'}`)
    if (dryRun) console.log('Dry run: no files or git refs will be changed.')

    const confirmed = await promptYesNo('Continue', true)
    if (!confirmed) {
      console.log('Cancelled.')
      return
    }

    if (dryRun) {
      console.log('Dry run complete.')
      return
    }

    updatePackageVersion(selectedVersion)
    createCommit(selectedVersion)
    if (shouldPushBranch) pushBranch()
    createTag(tagName, releaseName, releaseNotes)
    if (shouldPushTag) pushTag(tagName)
    if (shouldCreateRelease) upsertGitHubRelease(tagName, releaseName, releaseNotes)

    console.log(`Release flow complete for ${tagName}.`)
  } finally {
    rl.close()
  }
}

main().catch((error) => {
  console.error(`\n[release] ${error.message}`)
  process.exitCode = 1
})