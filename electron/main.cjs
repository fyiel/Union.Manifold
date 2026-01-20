const { app, BrowserWindow, shell, ipcMain, dialog, Tray, Menu, nativeImage } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')
const child_process = require('node:child_process')

const packageJson = require('../package.json')
const isDev = !app.isPackaged
const pendingDownloads = []
const activeDownloads = new Map()
const downloadQueues = new Map()
const globalDownloadQueue = []
const activeExtractions = new Set()
const runningGames = new Map()
const downloadDirName = 'UnionCrax.Direct'
const installingDirName = 'installing'
const installedDirName = 'installed'
const INSTALLED_MANIFEST = 'installed.json'
const INSTALLED_INDEX = 'installed-index.json'
const settingsPath = path.join(app.getPath('userData'), 'settings.json')
let cachedSettings = null

function resolveIcon() {
  const asset = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  return path.join(__dirname, '..', 'assets', asset)
}

function createTray() {
  const iconPath = resolveIcon()
  tray = new Tray(iconPath)
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show()
          mainWindow.focus()
        }
      }
    },
    {
      label: 'Quit',
      click: () => {
        app.quit()
      }
    }
  ])
  tray.setContextMenu(contextMenu)
  tray.on('double-click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

const DEFAULT_BASE_URL = 'https://union-crax.xyz'
let tray = null
let mainWindow = null

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl || typeof baseUrl !== 'string') return DEFAULT_BASE_URL
  try {
    const url = new URL(baseUrl)
    return url.origin
  } catch {
    return DEFAULT_BASE_URL
  }
}

function buildAuthUrl(baseUrl, nextPath) {
  const origin = normalizeBaseUrl(baseUrl)
  try {
    const url = new URL('/api/discord/connect', origin)
    if (nextPath) url.searchParams.set('next', nextPath)
    return url.toString()
  } catch {
    return `${DEFAULT_BASE_URL}/api/discord/connect?next=${encodeURIComponent(nextPath || '/settings')}`
  }
}

function parseAuthResult(urlString) {
  try {
    const url = new URL(urlString)
    const connected = url.searchParams.get('discord_connected')
    if (connected === 'true' || connected === '1') return { ok: true }
    const error = url.searchParams.get('error')
    if (error) return { ok: false, error }
  } catch {
    // ignore parse errors
  }
  return null
}

function openAuthWindow(parent, url) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (payload) => {
      if (settled) return
      settled = true
      try {
        if (authWin && !authWin.isDestroyed()) {
          setTimeout(() => {
            try {
              if (authWin && !authWin.isDestroyed()) authWin.close()
            } catch {}
          }, 50)
        }
      } catch {}
      resolve(payload)
    }

    const authWin = new BrowserWindow({
      width: 520,
      height: 720,
      resizable: false,
      minimizable: false,
      maximizable: false,
      parent,
      modal: false,
      show: false,
      backgroundColor: '#0b0b0b',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        session: parent.webContents.session
      },
      icon: resolveIcon()
    })

    try {
      authWin.setMenuBarVisibility(false)
      authWin.setAutoHideMenuBar(true)
    } catch {}

    const handleUrl = (nextUrl) => {
      const result = parseAuthResult(nextUrl)
      if (result) finish(result)
    }

    authWin.webContents.on('did-navigate', (_event, nextUrl) => handleUrl(nextUrl))
    authWin.webContents.on('did-redirect-navigation', (_event, nextUrl) => handleUrl(nextUrl))
    authWin.webContents.on('did-fail-load', () => finish({ ok: false, error: 'load_failed' }))
    authWin.webContents.on('render-process-gone', () => finish({ ok: false, error: 'render_gone' }))
    authWin.once('ready-to-show', () => authWin.show())
    authWin.on('closed', () => finish({ ok: false, error: 'closed' }))

    authWin.loadURL(url)
  })
}

function readSettings() {
  if (cachedSettings) return cachedSettings
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8')
    cachedSettings = JSON.parse(raw)
  } catch {
    cachedSettings = {}
  }
  return cachedSettings
}

function writeSettings(next) {
  cachedSettings = next
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2))
  } catch (error) {
    console.error('[UC] Failed to write settings:', error)
  }
}

async function getSessionCookies(session, baseUrl) {
  try {
    const origin = normalizeBaseUrl(baseUrl)
    return await session.cookies.get({ url: origin })
  } catch (e) {
    return []
  }
}

function buildCookieHeader(cookies) {
  if (!Array.isArray(cookies) || cookies.length === 0) return ''
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ')
}

async function fetchWithSession(session, baseUrl, path, init) {
  const origin = normalizeBaseUrl(baseUrl)
  const url = new URL(path, origin).toString()
  const cookies = await getSessionCookies(session, origin)
  const cookieHeader = buildCookieHeader(cookies)
  const headers = new Headers(init?.headers || {})
  if (!headers.has('user-agent')) {
    headers.set('User-Agent', `UnionCrax.Direct/${app.getVersion()}`)
  }
  if (typeof path === 'string' && path.startsWith('/api/downloads') && !headers.has('x-uc-client')) {
    headers.set('X-UC-Client', 'unioncrax-direct')
  }
  if (cookieHeader) headers.set('Cookie', cookieHeader)
  return fetch(url, { ...(init || {}), headers })
}

async function getDiscordSession(session, baseUrl) {
  try {
    const response = await fetchWithSession(session, baseUrl, '/api/discord/session', { method: 'GET' })
    if (!response.ok) return { discordId: null }
    return await response.json()
  } catch {
    return { discordId: null }
  }
}

// IPC: simple settings get/set with broadcast when changed
ipcMain.handle('uc:setting-get', (_event, key) => {
  try {
    const s = readSettings() || {}
    return s[key]
  } catch {
    return null
  }
})

ipcMain.handle('uc:setting-set', (_event, key, value) => {
  try {
    const s = readSettings() || {}
    s[key] = value
    writeSettings(s)
    // broadcast to all renderer windows
    for (const w of BrowserWindow.getAllWindows()) {
      if (w && !w.isDestroyed()) {
        w.webContents.send('uc:setting-changed', { key, value })
      }
    }
    return { ok: true }
  } catch (err) {
    console.error('[UC] Failed to set setting', key, err)
    return { ok: false }
  }
})

ipcMain.handle('uc:auth-login', async (event, baseUrl) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) return { ok: false, error: 'no_window' }
  const authUrl = buildAuthUrl(baseUrl, '/settings')
  const result = await openAuthWindow(win, authUrl)
  if (result?.ok) {
    const sessionData = await getDiscordSession(win.webContents.session, baseUrl)
    return { ok: true, ...sessionData }
  }
  return result || { ok: false, error: 'auth_failed' }
})

ipcMain.handle('uc:auth-session', async (event, baseUrl) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) return { discordId: null }
  return getDiscordSession(win.webContents.session, baseUrl)
})

ipcMain.handle('uc:auth-logout', async (event, baseUrl) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const session = win && !win.isDestroyed() ? win.webContents.session : null
  if (!session) return { ok: false, error: 'no_session' }
  const origin = normalizeBaseUrl(baseUrl)
  try {
    const cookies = await getSessionCookies(session, origin)
    await Promise.all(cookies.map((cookie) => session.cookies.remove(origin, cookie.name)))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: 'logout_failed' }
  }
})

ipcMain.handle('uc:auth-fetch', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) {
    return { ok: false, status: 0, statusText: 'no_window', headers: [], body: '' }
  }

  const baseUrl = payload?.baseUrl || DEFAULT_BASE_URL
  const path = payload?.path || '/'
  const init = payload?.init || {}

  try {
    const response = await fetchWithSession(win.webContents.session, baseUrl, path, init)
    const arrayBuffer = await response.arrayBuffer()
    const body = Buffer.from(arrayBuffer).toString('base64')
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: Array.from(response.headers.entries()),
      body,
    }
  } catch (error) {
    return { ok: false, status: 0, statusText: 'fetch_failed', headers: [], body: '' }
  }
})

function getDownloadRoot() {
  const settings = readSettings()
  if (settings.downloadPath && typeof settings.downloadPath === 'string') {
    const normalized = normalizeDownloadRoot(settings.downloadPath)
    if (normalized !== settings.downloadPath) {
      settings.downloadPath = normalized
      writeSettings(settings)
    }
    return normalized
  }
  if (process.platform === 'win32') {
    const drive = process.env.SystemDrive || 'C:'
    return path.join(drive, downloadDirName)
  }
  const root = app.getPath('documents')
  return path.join(root, downloadDirName)
}

function ensureDownloadDir() {
  let target = getDownloadRoot()
  try {
    if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true })
  } catch (err) {
    const fallback = path.join(app.getPath('documents'), downloadDirName)
    try {
      if (!fs.existsSync(fallback)) fs.mkdirSync(fallback, { recursive: true })
      const settings = readSettings() || {}
      if (!settings.downloadPath) {
        settings.downloadPath = fallback
        writeSettings(settings)
      }
      target = fallback
    } catch (fallbackErr) {
      console.error('[UC] Failed to create download folder:', fallbackErr)
    }
  }
  ensureSubdir(target, installingDirName)
  ensureSubdir(target, installedDirName)
  return target
}

function normalizeDownloadRoot(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') return targetPath
  const trimmed = targetPath.trim()
  if (!trimmed) return trimmed
  const normalized = trimmed.replace(/[\\/]+$/, '')
  const baseName = path.basename(normalized)
  const lowerBase = baseName.toLowerCase()
  const hasUnionName = lowerBase.includes('unioncrax.direct') || lowerBase.includes('unioncrax-direct')
  const hasAppSuffix = lowerBase.includes('unioncrax-direct.app') || lowerBase.endsWith('.app')

  if (hasUnionName && hasAppSuffix) {
    return path.join(path.dirname(normalized), downloadDirName)
  }

  return trimmed
}

function safeFolderName(name) {
  if (!name || typeof name !== 'string') return 'unioncrax-game'
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
  return cleaned || 'unioncrax-game'
}

function ensureSubdir(root, folder) {
  const target = path.join(root, folder)
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true })
  return target
}

function readJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function downloadToFile(url, destPath) {
  return new Promise((resolve) => {
    try {
      const proto = url.startsWith('https') ? require('https') : require('http')
      const req = proto.get(url, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          resolve(false)
          return
        }
        const file = fs.createWriteStream(destPath)
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve(true)))
        file.on('error', () => resolve(false))
      })
      req.on('error', () => resolve(false))
    } catch (err) {
      resolve(false)
    }
  })
}

async function fetchPixeldrainInfo(fileId) {
  // Try a few likely endpoints for Pixeldrain file info
  const candidates = [
    `https://pixeldrain.com/api/file/${encodeURIComponent(fileId)}/info`,
    `https://pixeldrain.com/file/${encodeURIComponent(fileId)}/info`,
    `https://pixeldrain.com/api/file/${encodeURIComponent(fileId)}`,
    `https://pixeldrain.com/file/${encodeURIComponent(fileId)}`,
  ]

  for (const url of candidates) {
    try {
      const proto = url.startsWith('https') ? require('https') : require('http')
      const res = await new Promise((resolve, reject) => {
        const req = proto.get(url, (r) => resolve(r))
        req.on('error', (e) => reject(e))
        req.setTimeout && req.setTimeout(5000, () => req.destroy())
      })

      if (!res || (res.statusCode && res.statusCode >= 400)) continue

      const chunks = []
      for await (const chunk of res) chunks.push(Buffer.from(chunk))
      const buf = Buffer.concat(chunks)
      const text = buf.toString('utf8')
      try {
        const json = JSON.parse(text)
        // Some endpoints return { success: true, ... } or direct object
        if (json && typeof json === 'object') return json
      } catch (e) {
        // not JSON
        continue
      }
    } catch (err) {
      // try next
      continue
    }
  }
  return null
}

function updateInstalledIndex(installedRoot) {
  try {
    if (!fs.existsSync(installedRoot)) return
    const entries = fs.readdirSync(installedRoot, { withFileTypes: true })
    const index = []
    for (const dirent of entries) {
      if (!dirent.isDirectory()) continue
      const folder = path.join(installedRoot, dirent.name)
      const manifestPath = path.join(folder, INSTALLED_MANIFEST)
      const manifest = readJsonFile(manifestPath)
      if (manifest && manifest.appid) {
        index.push({ appid: manifest.appid, name: manifest.name || dirent.name, folder: dirent.name, manifestPath: manifestPath })
      }
    }
    uc_writeJsonSync(path.join(installedRoot, INSTALLED_INDEX), index)
  } catch (err) {
    console.error('[UC] updateInstalledIndex failed', err)
  }
}

function uc_writeJsonSync(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
    return true
  } catch (err) {
    console.error('[UC] Failed to write json', filePath, err)
    return false
  }
}

function uc_log(msg) {
  try {
    const ud = app.getPath('userData')
    const logfile = path.join(ud, 'uc-extract.log')
    const line = `[${new Date().toISOString()}] ${String(msg)}\n`
    try {
      fs.appendFileSync(logfile, line)
    } catch (e) {
      // fallback to console if file write fails
      console.log('[UC LOG FAILED]', e)
    }
    console.log('[UC]', msg)
  } catch (e) {
    console.log('[UC LOG ERROR]', e)
  }
}

function updateInstalledManifest(installedFolder, metadata, fileEntry) {
  try {
    const manifestPath = path.join(installedFolder, INSTALLED_MANIFEST)
    let manifest = readJsonFile(manifestPath) || {}
    manifest.appid = metadata.appid || manifest.appid
    manifest.name = metadata.name || manifest.name
    // keep a full copy of metadata for offline viewing
    manifest.metadata = metadata || manifest.metadata
    // compute and store a hash of the metadata for integrity/versioning
    try {
      if (manifest.metadata) {
        manifest.metadataHash = computeObjectHash(manifest.metadata) || manifest.metadataHash
      }
    } catch (e) {
      // ignore
    }
    manifest.files = manifest.files || []
    if (fileEntry) {
      const exists = manifest.files.find((f) => f.path === fileEntry.path)
      if (!exists) manifest.files.push(fileEntry)
    }
    manifest.installedAt = manifest.installedAt || Date.now()
    uc_writeJsonSync(manifestPath, manifest)
    // update root installed index
    try {
      const installedRoot = path.dirname(installedFolder)
      updateInstalledIndex(installedRoot)
    } catch (e) {}
  } catch (err) {
    console.error('[UC] Failed to update installed manifest', err)
  }
}

function buildResumeData(item, savePath) {
  if (!item) return null
  try {
    return {
      urlChain: item.getURLChain ? item.getURLChain() : [],
      mimeType: item.getMimeType ? item.getMimeType() : '',
      etag: item.getETag ? item.getETag() : '',
      lastModified: item.getLastModifiedTime ? item.getLastModifiedTime() : '',
      startTime: item.getStartTime ? item.getStartTime() : 0,
      offset: item.getReceivedBytes ? item.getReceivedBytes() : 0,
      totalBytes: item.getTotalBytes ? item.getTotalBytes() : 0,
      savePath: savePath || (item.getSavePath ? item.getSavePath() : '')
    }
  } catch {
    return null
  }
}

function getInstallingMetadata(installingRoot, installedRoot, appid, gameName) {
  try {
    let meta = null
    if (installingRoot) {
      const manifestPath = path.join(installingRoot, INSTALLED_MANIFEST)
      const manifest = readJsonFile(manifestPath)
      meta = manifest && (manifest.metadata || manifest)
    }
    if (!meta || typeof meta !== 'object') {
      meta = { appid: appid || null, name: gameName || appid || null }
    }
    if (!meta.appid) meta.appid = appid || null
    if (!meta.name) meta.name = gameName || appid || null
    if (meta.localImage && installedRoot) {
      meta.localImage = path.join(installedRoot, path.basename(meta.localImage))
    }
    if (meta.metadata && meta.metadata.localImage && installedRoot) {
      meta.metadata.localImage = path.join(installedRoot, path.basename(meta.metadata.localImage))
    }
    return meta
  } catch (err) {
    return { appid: appid || null, name: gameName || appid || null }
  }
}

function migrateInstallingExtras(installingRoot, installedRoot, skipNames) {
  try {
    if (!fs.existsSync(installingRoot)) return
    const items = fs.readdirSync(installingRoot)
    const skip = skipNames instanceof Set ? skipNames : new Set()
    skip.add(INSTALLED_MANIFEST)
    skip.add(INSTALLED_INDEX)
    for (const itemName of items) {
      if (skip.has(itemName)) continue
      const src = path.join(installingRoot, itemName)
      const dest = resolveUniquePath(installedRoot, itemName)
      try { fs.renameSync(src, dest) } catch (err) {
        try { const data = fs.readFileSync(src); fs.writeFileSync(dest, data); try { fs.unlinkSync(src) } catch (e) {} } catch (e) {
          console.warn('[UC] Failed to move item from installing to installed:', src, e)
        }
      }
    }
  } catch (e) {
    console.warn('[UC] Failed to migrate installing folder contents:', e)
  }
}

function listManifestsFromRoot(root, allowFallback) {
  try {
    if (!fs.existsSync(root)) return []
    const entries = fs.readdirSync(root, { withFileTypes: true })
    const manifests = []
    for (const dirent of entries) {
      if (!dirent.isDirectory()) continue
      const folder = path.join(root, dirent.name)
      const manifestPath = path.join(folder, INSTALLED_MANIFEST)
      const manifest = readJsonFile(manifestPath)
      if (manifest && manifest.appid) {
        manifests.push(manifest)
        continue
      }
      if (allowFallback) {
        const files = fs.readdirSync(folder).filter((f) => f !== INSTALLED_MANIFEST)
        if (files.length) {
          manifests.push({ appid: dirent.name, name: dirent.name, files: files.map((f) => ({ name: f })) })
        }
      }
    }
    return manifests
  } catch (err) {
    console.error('[UC] listManifestsFromRoot failed', err)
    return []
  }
}

function listDownloadRoots() {
  const roots = new Set()
  try {
    const settings = readSettings() || {}
    if (settings.downloadPath && typeof settings.downloadPath === 'string') {
      roots.add(normalizeDownloadRoot(settings.downloadPath))
    }
  } catch {}
  try {
    const root = getDownloadRoot()
    if (root) roots.add(root)
  } catch {}
  try {
    const disks = listDisks()
    for (const disk of disks) {
      if (disk && disk.path) {
        roots.add(path.join(disk.path, downloadDirName))
      }
    }
  } catch {}
  return Array.from(roots).filter((root) => root && fs.existsSync(root))
}

function deleteFolderByAppId(root, appid) {
  try {
    if (!root || !appid || !fs.existsSync(root)) return false
    const entries = fs.readdirSync(root, { withFileTypes: true })
    for (const dirent of entries) {
      if (!dirent.isDirectory()) continue
      const folder = path.join(root, dirent.name)
      const manifestPath = path.join(folder, INSTALLED_MANIFEST)
      const manifest = readJsonFile(manifestPath)
      const match = (manifest && manifest.appid === appid) || dirent.name === appid
      if (!match) continue
      try {
        fs.rmSync(folder, { recursive: true, force: true })
      } catch (e) {}
      return true
    }
  } catch (err) {
    console.error('[UC] deleteFolderByAppId failed', err)
  }
  return false
}

function findInstalledFolderByAppid(appid) {
  try {
    if (!appid) return null
    const roots = listDownloadRoots()
    for (const root of roots) {
      const installedRoot = path.join(root, installedDirName)
      if (!fs.existsSync(installedRoot)) continue
      const entries = fs.readdirSync(installedRoot, { withFileTypes: true })
      for (const dirent of entries) {
        if (!dirent.isDirectory()) continue
        const folder = path.join(installedRoot, dirent.name)
        const manifestPath = path.join(folder, INSTALLED_MANIFEST)
        const manifest = readJsonFile(manifestPath)
        if (manifest && manifest.appid === appid) return folder
        if (dirent.name === appid) return folder
      }
    }
  } catch (err) {
    console.error('[UC] findInstalledFolderByAppid failed', err)
  }
  return null
}

function findInstallingFolderByAppid(appid) {
  try {
    if (!appid) return null
    const roots = listDownloadRoots()
    for (const root of roots) {
      const installingRoot = path.join(root, installingDirName)
      if (!fs.existsSync(installingRoot)) continue
      const entries = fs.readdirSync(installingRoot, { withFileTypes: true })
      for (const dirent of entries) {
        if (!dirent.isDirectory()) continue
        const folder = path.join(installingRoot, dirent.name)
        const manifestPath = path.join(folder, INSTALLED_MANIFEST)
        const manifest = readJsonFile(manifestPath)
        if (manifest && manifest.appid === appid) return folder
        if (dirent.name === appid) return folder
      }
    }
  } catch (err) {
    console.error('[UC] findInstallingFolderByAppid failed', err)
  }
  return null
}

function updateInstallingManifestStatus(appid, status, error) {
  try {
    if (!appid) return false
    const folder = findInstallingFolderByAppid(appid)
    if (!folder) return false
    const manifestPath = path.join(folder, INSTALLED_MANIFEST)
    const manifest = readJsonFile(manifestPath) || {}
    manifest.appid = manifest.appid || appid
    manifest.name = manifest.name || path.basename(folder)
    manifest.installStatus = status
    if (error) manifest.installError = String(error)
    manifest.updatedAt = Date.now()
    return uc_writeJsonSync(manifestPath, manifest)
  } catch (err) {
    console.error('[UC] updateInstallingManifestStatus failed', err)
    return false
  }
}

function listExecutables(rootDir, maxDepth, maxResults) {
  const results = []
  if (!rootDir || !fs.existsSync(rootDir)) return results
  const pending = [{ dir: rootDir, depth: 0 }]
  while (pending.length && results.length < maxResults) {
    const current = pending.pop()
    if (!current) continue
    let entries
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const fullPath = path.join(current.dir, entry.name)
      if (entry.isDirectory()) {
        if (current.depth < maxDepth) {
          pending.push({ dir: fullPath, depth: current.depth + 1 })
        }
        continue
      }
      if (!entry.isFile()) continue
      if (entry.name.toLowerCase().endsWith('.exe')) {
        results.push({ name: entry.name, path: fullPath })
        if (results.length >= maxResults) break
      }
    }
  }
  return results
}

function computeFileChecksum(filePath) {
  return new Promise((resolve) => {
    try {
      const hash = crypto.createHash('sha256')
      const stream = fs.createReadStream(filePath)
      stream.on('error', () => resolve(null))
      stream.on('data', (chunk) => hash.update(chunk))
      stream.on('end', () => resolve(hash.digest('hex')))
    } catch (err) {
      resolve(null)
    }
  })
}

function computeObjectHash(obj) {
  try {
    const raw = JSON.stringify(obj || {})
    return crypto.createHash('sha256').update(raw).digest('hex')
  } catch {
    return null
  }
}

function resolveUniquePath(dir, filename) {
  const ext = path.extname(filename)
  const base = path.basename(filename, ext)
  let candidate = path.join(dir, filename)
  if (!fs.existsSync(candidate)) return candidate
  for (let index = 1; index <= 999; index++) {
    candidate = path.join(dir, `${base}-${index}${ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`)
}

function isMultipartPartPath(filePath) {
  if (!filePath) return false
  return /\.[0-9]{3}$/i.test(filePath)
}

function getMultipartSetInfo(installingRoot, filePath, expectedParts) {
  try {
    if (!installingRoot || !filePath) return null
    const basePath = filePath.replace(/\.[0-9]{3}$/i, '')
    const baseName = path.basename(basePath)
    if (!fs.existsSync(installingRoot)) return null
    const entries = fs.readdirSync(installingRoot)
    const partFiles = []
    const partNumbers = []
    for (const entry of entries) {
      if (!entry.startsWith(`${baseName}.`)) continue
      const match = entry.match(/\.([0-9]{3})$/i)
      if (!match) continue
      const num = Number(match[1])
      if (!Number.isFinite(num)) continue
      partNumbers.push(num)
      partFiles.push(path.join(installingRoot, entry))
    }
    if (!partNumbers.length || !partNumbers.includes(1)) return null
    partNumbers.sort((a, b) => a - b)
    const max = partNumbers[partNumbers.length - 1]
    const expectedTotal = Number.isFinite(expectedParts) && expectedParts > 0 ? expectedParts : null
    const totalExpected = expectedTotal || max
    if (!expectedTotal && max < 2) return { ready: false, basePath }
    for (let i = 1; i <= totalExpected; i++) {
      if (!partNumbers.includes(i)) return { ready: false, basePath }
    }
    const totalBytes = partFiles.reduce((sum, p) => {
      try {
        const st = fs.statSync(p)
        return sum + (st.size || 0)
      } catch {
        return sum
      }
    }, 0)
    const firstPartPath = path.join(installingRoot, `${baseName}.001`)
    return { ready: true, basePath, firstPartPath, partFiles, totalBytes, expectedParts: totalExpected }
  } catch {
    return null
  }
}

function hasQueuedDownloadsForApp(appid) {
  if (!appid) return false
  const queue = downloadQueues.get(appid)
  return Array.isArray(queue) && queue.length > 0
}

function hasAnyActiveOrPendingDownloads() {
  return activeDownloads.size > 0 || pendingDownloads.length > 0
}

function hasActiveOrPendingDownloadsForApp(appid) {
  if (!appid) return false
  for (const entry of activeDownloads.values()) {
    if (entry && entry.appid === appid) return true
  }
  return pendingDownloads.some((entry) => entry.appid === appid)
}

function hasActiveDownloadsForApp(appid) {
  return hasActiveOrPendingDownloadsForApp(appid) || hasQueuedDownloadsForApp(appid)
}

function getWindowByWebContentsId(webContentsId) {
  if (!webContentsId) return null
  const windows = BrowserWindow.getAllWindows()
  return windows.find((win) => win.webContents && win.webContents.id === webContentsId) || null
}

function enqueueDownload(payload, webContentsId) {
  if (!payload || !payload.appid) return false
  const queue = downloadQueues.get(payload.appid) || []
  queue.push({ payload, webContentsId, queuedAt: Date.now() })
  downloadQueues.set(payload.appid, queue)
  return true
}

function enqueueGlobalDownload(payload, webContentsId) {
  if (!payload) return false
  globalDownloadQueue.push({ payload, webContentsId, queuedAt: Date.now() })
  return true
}

function startDownloadNow(win, payload) {
  if (!win || win.isDestroyed()) return { ok: false }
  pendingDownloads.push({
    url: payload.url,
    downloadId: payload.downloadId,
    filename: payload.filename,
    appid: payload.appid,
    gameName: payload.gameName,
    partIndex: payload.partIndex,
    partTotal: payload.partTotal
  })
  win.webContents.downloadURL(payload.url)
  return { ok: true }
}

function startNextQueuedDownload() {
  if (hasAnyActiveOrPendingDownloads()) return
  if (!globalDownloadQueue.length) return
  const next = globalDownloadQueue.shift()
  const win = getWindowByWebContentsId(next.webContentsId)
  if (!win || win.isDestroyed()) return
  startDownloadNow(win, next.payload)
}

function isDownloadIdKnown(downloadId) {
  if (!downloadId) return false
  if (activeDownloads.has(downloadId)) return true
  if (pendingDownloads.some((entry) => entry.downloadId === downloadId)) return true
  for (const queue of downloadQueues.values()) {
    if (queue.some((entry) => entry.payload && entry.payload.downloadId === downloadId)) return true
  }
  if (globalDownloadQueue.some((entry) => entry.payload && entry.payload.downloadId === downloadId)) return true
  return false
}

function flushQueuedDownloads(appid, status, error) {
  if (!appid) return
  const queue = downloadQueues.get(appid)
  if (!queue || !queue.length) return
  downloadQueues.delete(appid)
  for (const entry of queue) {
    try {
      const win = getWindowByWebContentsId(entry.webContentsId)
      if (!win || win.isDestroyed()) continue
      sendDownloadUpdate(win, {
        downloadId: entry.payload.downloadId,
        status,
        error: error || null,
        appid: entry.payload.appid || null,
        gameName: entry.payload.gameName || null,
        url: entry.payload.url
      })
    } catch (e) {}
  }
}

function setDownloadRoot(targetPath) {
  const settings = readSettings()
  settings.downloadPath = normalizeDownloadRoot(targetPath)
  writeSettings(settings)
  return ensureDownloadDir()
}

function listDisks() {
  const disks = []
  if (process.platform === 'win32') {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    for (const letter of letters) {
      const root = `${letter}:\\`
      if (!fs.existsSync(root)) continue
      try {
        const stats = fs.statfsSync(root)
        const totalBytes = stats.blocks * stats.bsize
        const freeBytes = stats.bavail * stats.bsize
        disks.push({
          id: letter,
          name: `${letter}:`,
          path: root,
          totalBytes,
          freeBytes
        })
      } catch {
        // ignore inaccessible drives
      }
    }
  } else {
    const root = app.getPath('downloads')
    try {
      const stats = fs.statfsSync(root)
      disks.push({
        id: 'downloads',
        name: 'Downloads',
        path: root,
        totalBytes: stats.blocks * stats.bsize,
        freeBytes: stats.bavail * stats.bsize
      })
    } catch {
      // ignore
    }
  }
  return disks
}

async function getDirectorySize(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') return 0
  try {
    const stats = await fs.promises.lstat(targetPath)
    if (!stats.isDirectory()) return stats.size || 0
  } catch {
    return 0
  }

  let total = 0
  const pending = [targetPath]

  while (pending.length) {
    const current = pending.pop()
    if (!current) continue
    let entries
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        pending.push(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      try {
        const fileStats = await fs.promises.stat(fullPath)
        total += fileStats.size || 0
      } catch {
        // ignore unreadable entries
    }
  }
}

function flushQueuedGlobalDownloads(appid, status, error) {
  if (!appid || !globalDownloadQueue.length) return
  const remaining = []
  for (const entry of globalDownloadQueue) {
    if (entry?.payload?.appid !== appid) {
      remaining.push(entry)
      continue
    }
    try {
      const win = getWindowByWebContentsId(entry.webContentsId)
      if (!win || win.isDestroyed()) continue
      sendDownloadUpdate(win, {
        downloadId: entry.payload.downloadId,
        status,
        error: error || null,
        appid: entry.payload.appid || null,
        gameName: entry.payload.gameName || null,
        url: entry.payload.url
      })
    } catch (e) {}
  }
  globalDownloadQueue.length = 0
  for (const entry of remaining) globalDownloadQueue.push(entry)
}

  return total
}

function snapshotFiles(rootDir) {
  const files = new Set()
  try {
    const pending = [rootDir]
    while (pending.length) {
      const cur = pending.pop()
      if (!cur) continue
      let entries
      try {
        entries = fs.readdirSync(cur, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of entries) {
        const full = path.join(cur, e.name)
        if (e.isDirectory()) {
          pending.push(full)
          continue
        }
        if (e.isFile()) files.add(full)
      }
    }
  } catch (e) {}
  return files
}

function run7zExtract(archivePath, destDir, onProgress) {
  return new Promise((resolve) => {
    try {
      // prefer bundled 7z binary from 7zip-bin if available, otherwise fall back to system `7z`
      let cmd = '7z'
      try {
        const seven = require('7zip-bin')
        // try several known exports
        cmd = seven.path7za || seven.path7z || seven.path7zip || cmd
        uc_log(`7zip binary resolved to: ${cmd}`)
      } catch (e) {
        // not available, use system `7z`
        uc_log(`7zip-bin not available, using system 7z: ${String(e)}`)
      }
      const before = snapshotFiles(destDir)
      const args = ['x', archivePath, `-o${destDir}`, '-y']
      const proc = child_process.spawn(cmd, args, { windowsHide: true })
      let stdout = ''
      let stderr = ''
      let lastPercent = -1
      let lastEmit = 0
      const emitProgress = (p) => {
        try {
          if (typeof onProgress === 'function') {
            const now = Date.now()
            // throttle updates to at most ~3 per second or when percent increases
            if (p !== lastPercent && (now - lastEmit > 300 || p > lastPercent)) {
              lastPercent = p
              lastEmit = now
              try {
                onProgress({ percent: p })
              } catch (e) {}
            }
          }
        } catch (e) {}
      }

      proc.stdout && proc.stdout.on('data', (d) => {
        try {
          const s = d.toString()
          stdout += s
          // parse percent tokens like "12%" that 7z emits
          const re = /(\d{1,3})%/g
          let m
          while ((m = re.exec(s)) !== null) {
            const p = Math.min(100, Math.max(0, Number(m[1] || 0)))
            emitProgress(p)
          }
        } catch (e) {
          stdout += String(d)
        }
      })
      proc.stderr && proc.stderr.on('data', (d) => {
        try {
          const s = d.toString()
          stderr += s
          const re = /(\d{1,3})%/g
          let m
          while ((m = re.exec(s)) !== null) {
            const p = Math.min(100, Math.max(0, Number(m[1] || 0)))
            emitProgress(p)
          }
        } catch (e) {
          stderr += String(d)
        }
      })
      proc.on('close', (code) => {
        if (code !== 0) {
          resolve({ ok: false, error: stderr || stdout })
          return
        }
        const after = snapshotFiles(destDir)
        const extracted = []
        for (const f of after) if (!before.has(f)) extracted.push(f)
        resolve({ ok: true, files: extracted })
      })
      proc.on('error', (err) => resolve({ ok: false, error: String(err) }))
    } catch (err) {
      resolve({ ok: false, error: String(err) })
    }
  })
}

function sendDownloadUpdate(win, payload) {
  if (!win || win.isDestroyed()) return
  win.webContents.send('uc:download-update', payload)
}

function registerRunningGame(appid, exePath, proc) {
  if (!proc || !proc.pid) return
  const payload = {
    appid: appid || null,
    exePath: exePath || null,
    pid: proc.pid,
    startedAt: Date.now()
  }
  if (appid) runningGames.set(appid, payload)
  if (exePath) runningGames.set(exePath, payload)
  proc.on('exit', () => {
    if (appid) runningGames.delete(appid)
    if (exePath) runningGames.delete(exePath)
  })
}

function getRunningGame(appid) {
  if (!appid) return null
  const byApp = runningGames.get(appid)
  if (byApp) return byApp
  return null
}

function killProcessTree(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve(false)
    if (process.platform === 'win32') {
      try {
        const killer = child_process.spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
        killer.on('close', (code) => resolve(code === 0))
        killer.on('error', () => resolve(false))
        return
      } catch {
        return resolve(false)
      }
    }
    try {
      process.kill(-pid, 'SIGTERM')
      return resolve(true)
    } catch {
      try {
        process.kill(pid, 'SIGTERM')
        return resolve(true)
      } catch {
        return resolve(false)
      }
    }
  })
}

function createWindow() {
  const iconPath = resolveIcon()
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    backgroundColor: '#121212',
    title: 'UnionCrax.Direct',
    webPreferences: {
      // This app needs to talk to a remote Next.js server; easiest path is to disable CORS in the desktop shell.
      webSecurity: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    },
    icon: iconPath
  })

  // Hide the menu bar
  mainWindow.setMenuBarVisibility(false)

  const defaultUserAgent = mainWindow.webContents.getUserAgent()
  mainWindow.webContents.setUserAgent(`${defaultUserAgent} UnionCrax.Direct/${app.getVersion()}`)

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'dist', 'index.html'))
  }

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault()
      mainWindow.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url) return
    if (url.startsWith('http://') || url.startsWith('https://')) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  mainWindow.webContents.session.on('will-download', (_event, item) => {
    const downloadRoot = ensureDownloadDir()
    const url = item.getURL()
    const matchIndex = pendingDownloads.findIndex((entry) => entry.url === url)
    const match = matchIndex >= 0 ? pendingDownloads.splice(matchIndex, 1)[0] : null
    const downloadId = match?.downloadId || `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const filename = match?.filename || item.getFilename()
    const partIndex = match?.partIndex
    const partTotal = match?.partTotal
    const gameFolder = safeFolderName(match?.gameName || match?.appid || downloadId)
    const installingRoot = ensureSubdir(path.join(downloadRoot, installingDirName), gameFolder)
    const savePath = match?.savePath || path.join(installingRoot, filename)
    try {
      item.setSavePath(savePath)
    } catch {}

    const startedAt = Date.now()
    const state = { lastBytes: 0, lastTime: startedAt, speedBps: 0 }
    activeDownloads.set(downloadId, { item, state, appid: match?.appid, gameName: match?.gameName, url, savePath, partIndex, partTotal })

    sendDownloadUpdate(mainWindow, {
      downloadId,
      status: 'downloading',
      receivedBytes: 0,
      totalBytes: item.getTotalBytes(),
      speedBps: 0,
      etaSeconds: null,
      filename,
      savePath,
      appid: match?.appid || null,
      gameName: match?.gameName || null,
      url,
      resumeData: buildResumeData(item, savePath),
      partIndex,
      partTotal
    })

    item.on('updated', () => {
      const entry = activeDownloads.get(downloadId)
      if (!entry) return
      const now = Date.now()
      const received = item.getReceivedBytes()
      const total = item.getTotalBytes()
      const deltaBytes = Math.max(0, received - entry.state.lastBytes)
      const deltaTime = Math.max(0.001, (now - entry.state.lastTime) / 1000)
      const instantSpeed = deltaBytes / deltaTime
      const speedBps = entry.state.speedBps > 0 ? entry.state.speedBps * 0.7 + instantSpeed * 0.3 : instantSpeed
      entry.state.lastBytes = received
      entry.state.lastTime = now
      entry.state.speedBps = speedBps
      const remaining = total > 0 ? Math.max(0, total - received) : 0
      const etaSeconds = speedBps > 0 && remaining > 0 ? remaining / speedBps : null
        sendDownloadUpdate(win, {
          downloadId,
          status: item.isPaused() ? 'paused' : 'downloading',
          receivedBytes: received,
          totalBytes: total,
          speedBps,
          etaSeconds,
          filename: path.basename(entry.savePath || filename),
          savePath: entry.savePath,
          appid: entry.appid || null,
          gameName: entry.gameName || null,
          url,
          resumeData: buildResumeData(item, entry.savePath),
          partIndex: entry.partIndex,
          partTotal: entry.partTotal
        })
      })

    item.once('done', async (_event, state) => {
      uc_log(`download done handler start — downloadId=${downloadId} state=${state} url=${url}`)
      const entry = activeDownloads.get(downloadId)
      activeDownloads.delete(downloadId)
      let finalPath = entry?.savePath
      let extractionFailed = false
      let extractionError = null
      if (state === 'completed' && entry?.savePath) {
        const folderName = safeFolderName(entry?.gameName || entry?.appid || downloadId)
        const installingRoot = path.join(downloadRoot, installingDirName, folderName)
        const installedRoot = ensureSubdir(path.join(downloadRoot, installedDirName), folderName)
        const metadataForInstall = getInstallingMetadata(installingRoot, installedRoot, entry?.appid, entry?.gameName)

        // If this was a Pixeldrain URL and filename lacks an extension, try to get original name first
        try {
          if (entry && entry.url && entry.url.includes('pixeldrain.com')) {
            const idMatch = (entry.url.match(/\/u\/([^/?#]+)/) || entry.url.match(/\/file\/([^/?#]+)/) || entry.url.split('/').pop())
            const fileId = Array.isArray(idMatch) ? idMatch[1] : idMatch
            if (fileId) {
              const info = await fetchPixeldrainInfo(fileId)
              if (info && info.name) {
                try {
                  // rename the file inside installing folder to the original name so we preserve extension
                  const desiredInInstalling = resolveUniquePath(installingRoot, info.name)
                  if (entry.savePath && path.resolve(entry.savePath) !== path.resolve(desiredInInstalling)) {
                    try {
                      fs.renameSync(entry.savePath, desiredInInstalling)
                      finalPath = desiredInInstalling
                      entry.savePath = desiredInInstalling
                      uc_log(`renamed installing file to ${desiredInInstalling} based on pixeldrain info`)
                    } catch (e) {
                      uc_log(`failed to rename installing file: ${String(e)}`)
                    }
                  }
                } catch (e) {}
              }
            }
          }
        } catch (e) {
          uc_log(`pixeldrain info fetch error: ${String(e)}`)
        }

        // Decide if the file is an archive and should be extracted
        try {
          const archExt = finalPath ? path.extname(finalPath).toLowerCase() : ''
          const installedFolder = installedRoot
          const isMultipart = Boolean(finalPath && isMultipartPartPath(finalPath))
          const maybeArchive = Boolean((archExt && ['.zip', '.7z', '.rar', '.tar', '.gz', '.tgz'].includes(archExt)) || isMultipart)
          const multipartInfo = isMultipart
            ? getMultipartSetInfo(installingRoot, finalPath, entry?.partTotal)
            : null
          const shouldExtractMultipart =
            Boolean(isMultipart && multipartInfo && multipartInfo.ready && entry?.appid && !hasActiveDownloadsForApp(entry.appid))
          const extractionKey = multipartInfo?.basePath || null
          uc_log(`checking for extraction - installingPath=${entry.savePath} finalPath=${finalPath} archExt=${archExt} maybeArchive=${maybeArchive}`)

          const extractArchive = async (archiveToExtract, partFiles, totalBytesOverride, extractionKeyOverride) => {
            try {
              const st = fs.existsSync(archiveToExtract) ? fs.statSync(archiveToExtract) : null
              const totalBytes = totalBytesOverride != null ? totalBytesOverride : st ? st.size : 0
              sendDownloadUpdate(win, { downloadId, status: 'extracting', receivedBytes: 0, totalBytes, speedBps: 0, etaSeconds: null, filename: path.basename(archiveToExtract), savePath: archiveToExtract, appid: entry?.appid || null })
            } catch (_) {
              sendDownloadUpdate(win, { downloadId, status: 'extracting', receivedBytes: 0, totalBytes: 0, speedBps: 0, etaSeconds: null, filename: path.basename(archiveToExtract), savePath: archiveToExtract, appid: entry?.appid || null })
            }
            uc_log(`starting extraction of ${archiveToExtract} to ${installedFolder}`)
            let _lastBytes = 0
            let _lastTime = Date.now()
            let _lastSpeed = 0
            let _pollTimer = null
            try {
              _pollTimer = setInterval(() => {
                try {
                  getDirectorySize(installedFolder).then((size) => {
                    try {
                      const now = Date.now()
                      const deltaBytes = Math.max(0, size - _lastBytes)
                      const deltaSec = Math.max(0.001, (now - _lastTime) / 1000)
                      const instSpeed = deltaBytes / deltaSec
                      const speedBps = _lastSpeed > 0 ? _lastSpeed * 0.7 + instSpeed * 0.3 : instSpeed
                      _lastSpeed = speedBps
                      _lastBytes = size
                      _lastTime = now
                      const st = fs.existsSync(archiveToExtract) ? fs.statSync(archiveToExtract) : null
                      const totalBytes = totalBytesOverride != null ? totalBytesOverride : st ? st.size : 0
                      const etaSeconds = speedBps > 0 ? Math.max(0, Math.round((totalBytes - size) / speedBps)) : null
                      sendDownloadUpdate(win, { downloadId, status: 'extracting', receivedBytes: size, totalBytes, speedBps: Math.round(speedBps), etaSeconds, filename: path.basename(archiveToExtract), savePath: archiveToExtract, appid: entry?.appid || null })
                    } catch (e) {}
                  }).catch(() => {})
                } catch (e) {}
              }, 500)
            } catch (e) {}

            const res = await run7zExtract(archiveToExtract, installedFolder, ({ percent }) => {
              try {
                const st = fs.existsSync(archiveToExtract) ? fs.statSync(archiveToExtract) : null
                const totalBytes = totalBytesOverride != null ? totalBytesOverride : st ? st.size : 0
                const received = Math.round((totalBytes * (percent || 0)) / 100)
                const now = Date.now()
                const deltaBytes = Math.max(0, received - _lastBytes)
                const deltaSec = Math.max(0.001, (now - _lastTime) / 1000)
                const instSpeed = deltaBytes / deltaSec
                const speedBps = _lastSpeed > 0 ? _lastSpeed * 0.7 + instSpeed * 0.3 : instSpeed
                _lastSpeed = speedBps
                _lastBytes = received
                _lastTime = now
                const etaSeconds = speedBps > 0 ? Math.max(0, Math.round((totalBytes - received) / speedBps)) : null
                sendDownloadUpdate(win, { downloadId, status: 'extracting', receivedBytes: received, totalBytes, speedBps: Math.round(speedBps), etaSeconds, filename: path.basename(archiveToExtract), savePath: archiveToExtract, appid: entry?.appid || null })
              } catch (e) {}
            })
            try { if (_pollTimer) clearInterval(_pollTimer) } catch (e) {}
            uc_log(`extraction result for ${archiveToExtract}: ${JSON.stringify(res && { ok: res.ok, error: res.error, files: (res.files || []).slice(0, 10) })}`)
            if (extractionKeyOverride) activeExtractions.delete(extractionKeyOverride)
            if (res && res.ok) {
              const extractedFiles = res.files || []
              for (const ef of extractedFiles) {
                try {
                  const stats = fs.existsSync(ef) ? fs.statSync(ef) : null
                  const checksum = ef ? await computeFileChecksum(ef) : null
                  const fileEntry = {
                    path: ef,
                    name: path.basename(ef),
                    size: stats ? stats.size : 0,
                    checksum: checksum,
                    addedAt: Date.now(),
                  }
                  updateInstalledManifest(installedRoot, metadataForInstall, fileEntry)
                } catch (e) {}
              }
              try {
                const skipNames = new Set()
                if (archiveToExtract) skipNames.add(path.basename(archiveToExtract))
                if (Array.isArray(partFiles)) {
                  for (const part of partFiles) skipNames.add(path.basename(part))
                }
                migrateInstallingExtras(installingRoot, installedRoot, skipNames)
              } catch (e) {}
              uc_log(`extraction success - files: ${extractedFiles.length}`)
              try {
                const st2 = fs.existsSync(archiveToExtract) ? fs.statSync(archiveToExtract) : null
                const totalBytes2 = totalBytesOverride != null ? totalBytesOverride : st2 ? st2.size : 0
                if (totalBytes2 > 0) sendDownloadUpdate(win, { downloadId, status: 'extracting', receivedBytes: totalBytes2, totalBytes: totalBytes2, speedBps: 0, etaSeconds: 0, filename: path.basename(archiveToExtract), savePath: archiveToExtract, appid: entry?.appid || null })
              } catch (e) {}
              try {
                if (partFiles && partFiles.length) {
                  for (const part of partFiles) {
                    try { if (fs.existsSync(part)) fs.unlinkSync(part) } catch (e) {}
                  }
                  uc_log(`deleted multipart parts for ${archiveToExtract}`)
                } else if (fs.existsSync(archiveToExtract)) {
                  try { fs.unlinkSync(archiveToExtract); uc_log(`deleted archive ${archiveToExtract} from installing folder`) } catch (e) { uc_log(`failed to delete archive: ${String(e)}`) }
                }
              } catch (e) {}
              try { fs.rmdirSync(installingRoot, { recursive: true }) } catch (e) {}

              sendDownloadUpdate(win, { downloadId, status: 'extracted', extracted: extractedFiles, savePath: null, appid: entry?.appid || null })
            } else {
              uc_log(`extraction failed for ${archiveToExtract}: ${res && res.error ? res.error : 'unknown'}`)
              extractionFailed = true
              extractionError = res && res.error ? res.error : 'extract_failed'
              updateInstallingManifestStatus(entry?.appid, 'failed', extractionError)
              sendDownloadUpdate(win, { downloadId, status: 'extract_failed', error: res && res.error ? res.error : 'unknown', savePath: finalPath, appid: entry?.appid || null })
            }
          }

          if (isMultipart) {
            if (!multipartInfo || !shouldExtractMultipart) {
              uc_log(`multipart not ready for ${multipartInfo ? multipartInfo.basePath : finalPath}`)
            } else if (extractionKey && activeExtractions.has(extractionKey)) {
              uc_log(`multipart extraction already running for ${multipartInfo ? multipartInfo.basePath : finalPath}`)
            } else if (finalPath && fs.existsSync(finalPath)) {
              if (extractionKey) activeExtractions.add(extractionKey)
              await extractArchive(multipartInfo.firstPartPath, multipartInfo.partFiles || [], multipartInfo.totalBytes || null, extractionKey)
            }
          } else if (maybeArchive && finalPath && fs.existsSync(finalPath)) {
            await extractArchive(finalPath, null, null, null)
          } else {
            // Not an archive - move file to installed folder like before
            try {
              const targetPath = resolveUniquePath(installedRoot, path.basename(finalPath))
              try {
                fs.renameSync(finalPath, targetPath)
                finalPath = targetPath
                uc_log(`moved file to ${targetPath}`)
              } catch (error) {
                uc_log(`failed to move file: ${String(error)}`)
                console.error('[UC] Failed to move completed download:', error)
              }
              // Move additional saved/installing data (images, metadata) from installing folder to installed folder
              try {
                const skipNames = new Set()
                const basenameFinal = finalPath ? path.basename(finalPath) : null
                if (basenameFinal) skipNames.add(basenameFinal)
                migrateInstallingExtras(installingRoot, installedRoot, skipNames)
                try { fs.rmdirSync(installingRoot, { recursive: true }) } catch (e) {}
              } catch (e) {}

              // update installed manifest in the installed folder
              try {
                ;(async () => {
                  try {
                    const checksum = finalPath ? await computeFileChecksum(finalPath) : null
                    const stats = finalPath && fs.existsSync(finalPath) ? fs.statSync(finalPath) : null
                    const fileEntry = {
                      path: finalPath,
                      name: path.basename(finalPath),
                      size: stats ? stats.size : 0,
                      checksum: checksum,
                      addedAt: Date.now(),
                    }
                    updateInstalledManifest(installedRoot, metadataForInstall, fileEntry)
                  } catch (err) {
                    console.error('[UC] Failed to write installed manifest (async):', err)
                  }
                })()
              } catch (err) { console.error('[UC] Failed to write installed manifest:', err) }
            } catch (err) {
              console.error('[UC] Error while moving/installing file:', err)
            }
          }
        } catch (e) {
          extractionFailed = true
          extractionError = e && e.message ? e.message : 'extract_failed'
          updateInstallingManifestStatus(entry?.appid, 'failed', extractionError)
          console.error('[UC] Extraction error:', e)
        }
      }
      const terminalStatus = extractionFailed
        ? 'failed'
        : state === 'completed'
          ? 'completed'
          : state === 'cancelled'
            ? 'cancelled'
            : 'failed'
      const terminalError = extractionFailed
        ? extractionError || 'extract_failed'
        : state === 'completed'
          ? null
          : state
      sendDownloadUpdate(win, {
        downloadId,
        status: terminalStatus,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        speedBps: entry?.state.speedBps || 0,
        etaSeconds: 0,
        filename: path.basename(finalPath || entry?.savePath || filename),
        savePath: finalPath,
        appid: entry?.appid || null,
        gameName: entry?.gameName || null,
        url,
        error: terminalError,
        partIndex: entry?.partIndex,
        partTotal: entry?.partTotal
      })
      if (entry?.appid && terminalStatus !== 'completed') {
        updateInstallingManifestStatus(entry.appid, terminalStatus, terminalError)
      }
      if (entry?.appid) {
        if (terminalStatus !== 'completed') {
          flushQueuedDownloads(entry.appid, terminalStatus, terminalError)
          flushQueuedGlobalDownloads(entry.appid, terminalStatus, terminalError)
        }
      }
      startNextQueuedDownload()
    })
  })
}

app.whenReady().then(() => {
  ensureDownloadDir()
  createWindow()
  createTray()
  
  // Auto-updater configuration
  if (!isDev) {
    autoUpdater.autoDownload = true
    autoUpdater.checkForUpdatesAndNotify()
    
    // Check for updates every hour
    setInterval(() => {
      autoUpdater.checkForUpdatesAndNotify()
    }, 60 * 60 * 1000)
  }
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Auto-updater event handlers
autoUpdater.on('update-available', (info) => {
  const currentVersion = app.getVersion()
  if (info.version === currentVersion) {
    console.log('[Update] Already on latest version:', info.version)
    const windows = BrowserWindow.getAllWindows()
    windows.forEach(win => {
      win.webContents.send('update-not-available', { message: 'Already on latest version' })
    })
    return
  }
  
  console.log('[Update] New version available:', info.version)
  const windows = BrowserWindow.getAllWindows()
  windows.forEach(win => {
    win.webContents.send('update-available', info)
  })
  try {
    autoUpdater.downloadUpdate()
  } catch (err) {
    console.error('[Update] Failed to start download:', err)
  }
})

autoUpdater.on('download-progress', (progress) => {
  const windows = BrowserWindow.getAllWindows()
  windows.forEach(win => {
    win.webContents.send('update-download-progress', progress)
  })
})

autoUpdater.on('update-downloaded', (info) => {
  console.log('[Update] Update downloaded:', info.version)
  const windows = BrowserWindow.getAllWindows()
  windows.forEach(win => {
    win.webContents.send('update-downloaded', info)
  })
})

autoUpdater.on('error', (err) => {
  console.error('[Update] Error:', err)
})

// IPC handler for manual update check
ipcMain.handle('uc:check-for-updates', async () => {
  if (isDev) return { available: false, message: 'Updates not available in dev mode' }
  try {
    const result = await autoUpdater.checkForUpdates()
    const availableVersion = result?.updateInfo?.version
    const currentVersion = app.getVersion()
    
    if (!availableVersion || availableVersion === currentVersion) {
      return { available: false, message: 'Already on latest version' }
    }
    
    return { available: true, version: availableVersion }
  } catch (err) {
    return { available: false, error: err.message }
  }
})

// IPC handler to get app version
ipcMain.handle('uc:get-version', () => {
  return packageJson.version
})

// IPC handler to install update
ipcMain.handle('uc:install-update', () => {
  autoUpdater.quitAndInstall(false, true)
})

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') app.quit()
})

app.on('before-quit', () => {
  app.isQuitting = true
})

ipcMain.handle('uc:download-start', (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) return { ok: false }
  if (!payload || !payload.url || !payload.downloadId) return { ok: false }
  if (isDownloadIdKnown(payload.downloadId)) {
    return { ok: false, error: 'already-downloading' }
  }

  const appid = payload.appid
  if (hasAnyActiveOrPendingDownloads() || globalDownloadQueue.length > 0) {
    enqueueGlobalDownload(payload, win.webContents.id)
    return { ok: true, queued: true }
  }

  return startDownloadNow(win, payload)
})

ipcMain.handle('uc:download-cancel', (_event, downloadId) => {
  const entry = activeDownloads.get(downloadId)
  if (entry) {
    try {
      entry.item.cancel()
    } catch {}
    return { ok: true }
  }
  if (downloadId) {
    for (const [appid, queue] of downloadQueues.entries()) {
      const idx = queue.findIndex((item) => item.payload && item.payload.downloadId === downloadId)
      if (idx >= 0) {
        queue.splice(idx, 1)
        if (!queue.length) downloadQueues.delete(appid)
        return { ok: true }
      }
    }
    const idx = globalDownloadQueue.findIndex((item) => item.payload && item.payload.downloadId === downloadId)
    if (idx >= 0) {
      globalDownloadQueue.splice(idx, 1)
      return { ok: true }
    }
  }
  return { ok: false }
})

ipcMain.handle('uc:download-pause', (event, downloadId) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const entry = activeDownloads.get(downloadId)
  if (!entry) return { ok: false }
  try {
    if (entry.item && typeof entry.item.pause === 'function') entry.item.pause()
    // emit an update to renderer
    sendDownloadUpdate(win, {
      downloadId,
      status: 'paused',
      receivedBytes: entry.item.getReceivedBytes(),
      totalBytes: entry.item.getTotalBytes(),
      speedBps: entry.state.speedBps || 0,
      etaSeconds: null,
      filename: path.basename(entry.savePath || ''),
      savePath: entry.savePath,
      appid: entry.appid || null,
      gameName: entry.gameName || null,
      url: entry.url,
      resumeData: buildResumeData(entry.item, entry.savePath),
      partIndex: entry.partIndex,
      partTotal: entry.partTotal
    })
  } catch (e) {}
  return { ok: true }
})

ipcMain.handle('uc:download-resume', (event, downloadId) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const entry = activeDownloads.get(downloadId)
  if (!entry) return { ok: false }
  try {
    if (entry.item && typeof entry.item.resume === 'function') entry.item.resume()
    // emit an update to renderer
    sendDownloadUpdate(win, {
      downloadId,
      status: 'downloading',
      receivedBytes: entry.item.getReceivedBytes(),
      totalBytes: entry.item.getTotalBytes(),
      speedBps: entry.state.speedBps || 0,
      etaSeconds: null,
      filename: path.basename(entry.savePath || ''),
      savePath: entry.savePath,
      appid: entry.appid || null,
      gameName: entry.gameName || null,
      url: entry.url,
      resumeData: buildResumeData(entry.item, entry.savePath),
      partIndex: entry.partIndex,
      partTotal: entry.partTotal
    })
  } catch (e) {}
  return { ok: true }
})

ipcMain.handle('uc:download-resume-interrupted', (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) return { ok: false }
  if (!payload || !payload.resumeData) return { ok: false, error: 'missing-resume-data' }
  const resume = payload.resumeData || {}
  const savePath = resume.savePath || payload.savePath
  if (!savePath || !fs.existsSync(savePath)) return { ok: false, error: 'missing-file' }
  const urlChain = Array.isArray(resume.urlChain) && resume.urlChain.length
    ? resume.urlChain
    : payload.url
      ? [payload.url]
      : []
  if (!urlChain.length) return { ok: false, error: 'missing-url' }

  pendingDownloads.push({
    url: urlChain[0],
    downloadId: payload.downloadId,
    filename: payload.filename || path.basename(savePath),
    appid: payload.appid,
    gameName: payload.gameName,
    partIndex: payload.partIndex,
    partTotal: payload.partTotal,
    savePath
  })

  try {
    win.webContents.session.createInterruptedDownload({
      path: savePath,
      urlChain,
      mimeType: resume.mimeType || '',
      offset: resume.offset || 0,
      length: resume.totalBytes || 0,
      lastModified: resume.lastModified || '',
      eTag: resume.etag || '',
      startTime: resume.startTime || 0
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

ipcMain.handle('uc:download-show', (_event, targetPath) => {
  if (typeof targetPath === 'string' && targetPath) {
    shell.showItemInFolder(targetPath)
  }
  return { ok: true }
})

ipcMain.handle('uc:download-open', async (_event, targetPath) => {
  if (typeof targetPath === 'string' && targetPath) {
    await shell.openPath(targetPath)
  }
  return { ok: true }
})

ipcMain.handle('uc:disk-list', () => {
  return listDisks()
})

ipcMain.handle('uc:download-path-get', () => {
  return { path: ensureDownloadDir() }
})

ipcMain.handle('uc:download-path-set', (_event, targetPath) => {
  if (typeof targetPath !== 'string' || !targetPath) {
    return { ok: false }
  }
  const resolved = setDownloadRoot(targetPath)
  return { ok: true, path: resolved }
})

ipcMain.handle('uc:download-path-pick', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
  })

  if (result.canceled || !result.filePaths?.length) {
    return { ok: false }
  }

  const selected = result.filePaths[0]
  const resolved = setDownloadRoot(selected)
  return { ok: true, path: resolved }
})

ipcMain.handle('uc:download-usage', async (_event, targetPath) => {
  const resolvedPath = typeof targetPath === 'string' && targetPath ? targetPath : ensureDownloadDir()
  const sizeBytes = await getDirectorySize(resolvedPath)
  return { ok: true, sizeBytes, path: resolvedPath }
})

// Save initial metadata for an installing download (renderer may call this when starting)
ipcMain.handle('uc:installed-save', (_event, appid, metadata) => {
  try {
    const downloadRoot = ensureDownloadDir()
    const folderName = safeFolderName((metadata && (metadata.name || metadata.gameName)) || appid || 'unknown')
    const installingRoot = ensureSubdir(path.join(downloadRoot, installingDirName), folderName)
    const manifestPath = path.join(installingRoot, INSTALLED_MANIFEST)
    const manifest = readJsonFile(manifestPath) || {}
    manifest.appid = appid
    manifest.name = metadata?.name || metadata?.gameName || manifest.name
    manifest.metadata = metadata
    manifest.installStatus = 'installing'
    try {
      manifest.metadataHash = computeObjectHash(metadata)
    } catch {}
    // mark as pending install
    manifest.installedAt = manifest.installedAt || null
    uc_writeJsonSync(manifestPath, manifest);
    // attempt to download and save the remote image locally into the installing folder
    (async () => {
      try {
        if (metadata && metadata.image && typeof metadata.image === 'string' && /^https?:\/\//.test(metadata.image)) {
          const ext = (metadata.image.split('?')[0].split('.').pop() || 'png').slice(0, 8)
          const imageName = `image.${ext}`
          const imagePath = path.join(installingRoot, imageName)
          const ok = await downloadToFile(metadata.image, imagePath)
          if (ok) {
            const checksum = await computeFileChecksum(imagePath)
            // update manifest with local image path
            const m = readJsonFile(manifestPath) || {}
            m.metadata = m.metadata || {}
            m.metadata.localImage = imagePath
            if (checksum) m.metadata.imageChecksum = checksum
            uc_writeJsonSync(manifestPath, m);
            // also update root installed index if present
            try { updateInstalledIndex(path.join(downloadRoot, installedDirName)) } catch {}
          }
        }
      } catch (err) {
        // ignore download failures
      }
    })()
    return { ok: true }
  } catch (err) {
    console.error('[UC] installed-save failed', err)
    return { ok: false }
  }
})

ipcMain.handle('uc:installing-status-set', (_event, appid, status, error) => {
  try {
    const ok = updateInstallingManifestStatus(appid, status, error)
    return { ok }
  } catch (err) {
    console.error('[UC] installing-status-set failed', err)
    return { ok: false }
  }
})

// List installed manifests from installed folder
ipcMain.handle('uc:installed-list', (_event) => {
  try {
    const downloadRoot = ensureDownloadDir()
    const root = path.join(downloadRoot, installedDirName)
    return listManifestsFromRoot(root, true)
  } catch (err) {
    console.error('[UC] installed-list failed', err)
    return []
  }
})

ipcMain.handle('uc:installed-get', (_event, appid) => {
  try {
    const downloadRoot = ensureDownloadDir()
    const root = path.join(downloadRoot, installedDirName)
    if (!fs.existsSync(root)) return null
    const entries = fs.readdirSync(root, { withFileTypes: true })
    for (const dirent of entries) {
      if (!dirent.isDirectory()) continue
      const folder = path.join(root, dirent.name)
      const manifestPath = path.join(folder, INSTALLED_MANIFEST)
      const manifest = readJsonFile(manifestPath)
      if (manifest && manifest.appid === appid) return manifest
    }
    return null
  } catch (err) {
    console.error('[UC] installed-get failed', err)
    return null
  }
})

ipcMain.handle('uc:installed-list-global', (_event) => {
  try {
    const roots = listDownloadRoots()
    const all = []
    for (const root of roots) {
      const installedRoot = path.join(root, installedDirName)
      const items = listManifestsFromRoot(installedRoot, true)
      for (const item of items) all.push(item)
    }
    const seen = new Set()
    return all.filter((item) => {
      const key = item && item.appid ? item.appid : null
      if (!key) return false
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  } catch (err) {
    console.error('[UC] installed-list-global failed', err)
    return []
  }
})

ipcMain.handle('uc:installed-get-global', (_event, appid) => {
  try {
    if (!appid) return null
    const roots = listDownloadRoots()
    for (const root of roots) {
      const installedRoot = path.join(root, installedDirName)
      if (!fs.existsSync(installedRoot)) continue
      const entries = fs.readdirSync(installedRoot, { withFileTypes: true })
      for (const dirent of entries) {
        if (!dirent.isDirectory()) continue
        const folder = path.join(installedRoot, dirent.name)
        const manifestPath = path.join(folder, INSTALLED_MANIFEST)
        const manifest = readJsonFile(manifestPath)
        if (manifest && manifest.appid === appid) return manifest
      }
    }
    return null
  } catch (err) {
    console.error('[UC] installed-get-global failed', err)
    return null
  }
})

// List installing manifests from installing folder
ipcMain.handle('uc:installing-list', (_event) => {
  try {
    const downloadRoot = ensureDownloadDir()
    const root = path.join(downloadRoot, installingDirName)
    return listManifestsFromRoot(root, false)
  } catch (err) {
    console.error('[UC] installing-list failed', err)
    return []
  }
})

ipcMain.handle('uc:installing-get', (_event, appid) => {
  try {
    const downloadRoot = ensureDownloadDir()
    const root = path.join(downloadRoot, installingDirName)
    if (!fs.existsSync(root)) return null
    const entries = fs.readdirSync(root, { withFileTypes: true })
    for (const dirent of entries) {
      if (!dirent.isDirectory()) continue
      const folder = path.join(root, dirent.name)
      const manifestPath = path.join(folder, INSTALLED_MANIFEST)
      const manifest = readJsonFile(manifestPath)
      if (manifest && manifest.appid === appid) return manifest
    }
    return null
  } catch (err) {
    console.error('[UC] installing-get failed', err)
    return null
  }
})

ipcMain.handle('uc:installing-list-global', (_event) => {
  try {
    const roots = listDownloadRoots()
    const all = []
    for (const root of roots) {
      const installingRoot = path.join(root, installingDirName)
      const items = listManifestsFromRoot(installingRoot, false)
      for (const item of items) all.push(item)
    }
    const seen = new Set()
    return all.filter((item) => {
      const key = item && item.appid ? item.appid : null
      if (!key) return false
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  } catch (err) {
    console.error('[UC] installing-list-global failed', err)
    return []
  }
})

ipcMain.handle('uc:installing-get-global', (_event, appid) => {
  try {
    if (!appid) return null
    const roots = listDownloadRoots()
    for (const root of roots) {
      const installingRoot = path.join(root, installingDirName)
      if (!fs.existsSync(installingRoot)) continue
      const entries = fs.readdirSync(installingRoot, { withFileTypes: true })
      for (const dirent of entries) {
        if (!dirent.isDirectory()) continue
        const folder = path.join(installingRoot, dirent.name)
        const manifestPath = path.join(folder, INSTALLED_MANIFEST)
        const manifest = readJsonFile(manifestPath)
        if (manifest && manifest.appid === appid) return manifest
      }
    }
    return null
  } catch (err) {
    console.error('[UC] installing-get-global failed', err)
    return null
  }
})

ipcMain.handle('uc:game-exe-list', (_event, appid) => {
  try {
    const folder = findInstalledFolderByAppid(appid)
    if (!folder) return { ok: false, error: 'not-found', exes: [] }
    const exes = listExecutables(folder, 4, 50)
    return { ok: true, folder, exes }
  } catch (err) {
    console.error('[UC] game-exe-list failed', err)
    return { ok: false, error: 'failed', exes: [] }
  }
})

ipcMain.handle('uc:game-exe-launch', async (_event, appid, exePath) => {
  try {
    if (!exePath || typeof exePath !== 'string') return { ok: false }
    try {
      const proc = child_process.spawn(exePath, [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      })
      proc.unref()
      registerRunningGame(appid, exePath, proc)
      return { ok: true, pid: proc.pid }
    } catch (err) {
      const res = await shell.openPath(exePath)
      if (res && typeof res === 'string' && res.length > 0) {
        return { ok: false, error: res }
      }
      return { ok: true }
    }
  } catch (err) {
    console.error('[UC] game-exe-launch failed', err)
    return { ok: false }
  }
})

ipcMain.handle('uc:game-exe-running', (_event, appid) => {
  try {
    const running = getRunningGame(appid)
    if (!running) return { ok: true, running: false }
    return { ok: true, running: true, pid: running.pid, exePath: running.exePath }
  } catch (err) {
    console.error('[UC] game-exe-running failed', err)
    return { ok: false, running: false }
  }
})

ipcMain.handle('uc:game-exe-quit', async (_event, appid) => {
  try {
    const running = getRunningGame(appid)
    if (!running) return { ok: true, stopped: false }
    const stopped = await killProcessTree(running.pid)
    if (stopped) {
      if (running.appid) runningGames.delete(running.appid)
      if (running.exePath) runningGames.delete(running.exePath)
    }
    return { ok: true, stopped }
  } catch (err) {
    console.error('[UC] game-exe-quit failed', err)
    return { ok: false, stopped: false }
  }
})

ipcMain.handle('uc:installed-delete', (_event, appid) => {
  try {
    const downloadRoot = ensureDownloadDir()
    const root = path.join(downloadRoot, installedDirName)
    const ok = deleteFolderByAppId(root, appid)
    if (ok) {
      try { updateInstalledIndex(root) } catch (e) {}
    }
    return { ok }
  } catch (err) {
    console.error('[UC] installed-delete failed', err)
    return { ok: false }
  }
})

ipcMain.handle('uc:installing-delete', (_event, appid) => {
  try {
    const downloadRoot = ensureDownloadDir()
    const root = path.join(downloadRoot, installingDirName)
    const ok = deleteFolderByAppId(root, appid)
    return { ok }
  } catch (err) {
    console.error('[UC] installing-delete failed', err)
    return { ok: false }
  }
})
