const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')

const isDev = !app.isPackaged
const pendingDownloads = []
const activeDownloads = new Map()
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

function getDownloadRoot() {
  const settings = readSettings()
  if (settings.downloadPath && typeof settings.downloadPath === 'string') {
    return settings.downloadPath
  }
  const root = app.getPath('downloads')
  return path.join(root, downloadDirName)
}

function ensureDownloadDir() {
  const target = getDownloadRoot()
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true })
  return target
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

function setDownloadRoot(targetPath) {
  const settings = readSettings()
  settings.downloadPath = targetPath
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

  return total
}

function sendDownloadUpdate(win, payload) {
  if (!win || win.isDestroyed()) return
  win.webContents.send('uc:download-update', payload)
}

function createWindow() {
  const iconPath = resolveIcon()
  const win = new BrowserWindow({
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

  const defaultUserAgent = win.webContents.getUserAgent()
  win.webContents.setUserAgent(`${defaultUserAgent} UnionCrax.Direct/${app.getVersion()}`)

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '..', 'renderer', 'dist', 'index.html'))
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (!url) return
    if (url.startsWith('http://') || url.startsWith('https://')) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  win.webContents.session.on('will-download', (_event, item) => {
    const downloadRoot = ensureDownloadDir()
    const url = item.getURL()
    const matchIndex = pendingDownloads.findIndex((entry) => entry.url === url)
    const match = matchIndex >= 0 ? pendingDownloads.splice(matchIndex, 1)[0] : null
    const downloadId = match?.downloadId || `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const filename = match?.filename || item.getFilename()
    const gameFolder = safeFolderName(match?.gameName || match?.appid || downloadId)
    const installingRoot = ensureSubdir(path.join(downloadRoot, installingDirName), gameFolder)
    const savePath = path.join(installingRoot, filename)
    try {
      item.setSavePath(savePath)
    } catch {}

    const startedAt = Date.now()
    const state = { lastBytes: 0, lastTime: startedAt, speedBps: 0 }
    activeDownloads.set(downloadId, { item, state, appid: match?.appid, gameName: match?.gameName, url, savePath })

    sendDownloadUpdate(win, {
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
      url
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
        url
      })
    })

    item.once('done', (_event, state) => {
      const entry = activeDownloads.get(downloadId)
      activeDownloads.delete(downloadId)
      let finalPath = entry?.savePath
      if (state === 'completed' && entry?.savePath) {
        const installedRoot = ensureSubdir(path.join(downloadRoot, installedDirName), gameFolder)
        const targetPath = resolveUniquePath(installedRoot, path.basename(entry.savePath))
        try {
          fs.renameSync(entry.savePath, targetPath)
          finalPath = targetPath
        } catch (error) {
          console.error('[UC] Failed to move completed download:', error)
        }
        // update installed manifest in the installed folder
        try {
          const metadata = { appid: entry?.appid || null, name: entry?.gameName || null }
          // compute checksum of the file
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
              // If we have metadata saved earlier in installing folder, prefer that
              // updateInstalledManifest will merge metadata and file entries
              updateInstalledManifest(installedRoot, metadata, fileEntry)
            } catch (err) {
              console.error('[UC] Failed to write installed manifest (async):', err)
            }
          })()
        } catch (err) {
          console.error('[UC] Failed to write installed manifest:', err)
        }
      }
      sendDownloadUpdate(win, {
        downloadId,
        status: state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'failed',
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        speedBps: entry?.state.speedBps || 0,
        etaSeconds: 0,
        filename: path.basename(finalPath || entry?.savePath || filename),
        savePath: finalPath,
        appid: entry?.appid || null,
        gameName: entry?.gameName || null,
        url,
        error: state === 'completed' ? null : state
      })
    })
  })
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('uc:download-start', (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) return { ok: false }
  if (!payload || !payload.url || !payload.downloadId) return { ok: false }
  pendingDownloads.push({
    url: payload.url,
    downloadId: payload.downloadId,
    filename: payload.filename,
    appid: payload.appid,
    gameName: payload.gameName
  })
  win.webContents.downloadURL(payload.url)
  return { ok: true }
})

ipcMain.handle('uc:download-cancel', (_event, downloadId) => {
  const entry = activeDownloads.get(downloadId)
  if (!entry) return { ok: false }
  try {
    entry.item.cancel()
  } catch {}
  return { ok: true }
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
    try {
      manifest.metadataHash = computeObjectHash(metadata)
    } catch {}
    // mark as pending install
    manifest.installedAt = manifest.installedAt || null
    uc_writeJsonSync(manifestPath, manifest)
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
            uc_writeJsonSync(manifestPath, m)
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

// List installed manifests from installed folder
ipcMain.handle('uc:installed-list', (_event) => {
  try {
    const downloadRoot = ensureDownloadDir()
    const root = path.join(downloadRoot, installedDirName)
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
      } else {
        // try to infer from files
        const files = fs.readdirSync(folder).filter((f) => f !== INSTALLED_MANIFEST)
        if (files.length) {
          manifests.push({ appid: dirent.name, name: dirent.name, files: files.map((f) => ({ name: f })) })
        }
      }
    }
    return manifests
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
