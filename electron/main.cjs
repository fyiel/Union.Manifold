const { app, BrowserWindow, shell, ipcMain, dialog, Tray, Menu, nativeImage, globalShortcut } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')
const child_process = require('node:child_process')
const https = require('node:https')
const http = require('node:http')
const DiscordRPC = require('discord-rpc')
const { autoUpdater } = require('electron-updater')

const packageJson = require('../package.json')
const isDev = !app.isPackaged
const UPDATE_PROVIDER = packageJson?.build?.publish?.[0] || {}
const UPDATE_OWNER = UPDATE_PROVIDER.owner || 'Union-Crax'
const UPDATE_REPO = UPDATE_PROVIDER.repo || 'UnionCrax.Direct'

const updateState = {
  enabled: !isDev,
  state: isDev ? 'disabled' : 'idle',
  currentVersion: String(packageJson?.version || app.getVersion?.() || ''),
  version: null,
  available: false,
  downloaded: false,
  progress: 0,
  error: null,
  checkedAt: null,
}

function getUpdateStatusSnapshot() {
  return {
    ...updateState,
    currentVersion: String(packageJson?.version || app.getVersion?.() || ''),
  }
}

function broadcastUpdateStatus() {
  const payload = getUpdateStatusSnapshot()
  const windows = BrowserWindow.getAllWindows()
  windows.forEach((win) => {
    try { win.webContents.send('uc:update-status-changed', payload) } catch { }
  })
}

function setUpdateStatus(patch) {
  Object.assign(updateState, patch)
  broadcastUpdateStatus()
}

// Helper: compare semantic versions a vs b; returns 1 if a>b, -1 if a<b, 0 if equal
function compareVersions(a, b) {
  const pa = String(a || '').split('.').map((n) => parseInt(n || '0', 10))
  const pb = String(b || '').split('.').map((n) => parseInt(n || '0', 10))
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0
    const db = pb[i] || 0
    if (da > db) return 1
    if (da < db) return -1
  }
  return 0
}

// Helper: fetch latest release info from GitHub
async function fetchLatestReleaseInfo() {
  const resp = await fetch(`https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`, {
    headers: { 'Accept': 'application/vnd.github+json' }
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const data = await resp.json()
  const tag = (data && (data.tag_name || data.name)) || ''
  const url = (data && data.html_url) || `https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`
  const latest = String(tag).replace(/^v/i, '')
  return { latest, url }
}
if (process.platform === 'win32') {
  try {
    app.setAppUserModelId(packageJson?.build?.appId || 'xyz.unioncrax.direct')
  } catch { }
}
try {
  if (typeof app.setName === 'function') app.setName('UnionCrax.Direct')
  else app.name = 'UnionCrax.Direct'
} catch { }
const pendingDownloads = []
let lastPixeldrainDownloadTime = 0
const PIXELDRAIN_DELAY_MS = 2000 // 2 second delay between pixeldrain downloads to avoid rate limiting
// Map of pixeldrain file IDs to auth headers for authenticated downloads
const pixeldrainAuthHeaders = new Map()

function normalizeDownloadUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl
  try {
    const parsed = new URL(rawUrl)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return rawUrl
  }
}

function extractPixeldrainFileIdFromUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null
  try {
    const parsed = new URL(rawUrl)
    const apiMatch = parsed.pathname.match(/\/api\/file\/([^/?#]+)/)
    if (apiMatch && apiMatch[1]) return apiMatch[1]
    const fileMatch = parsed.pathname.match(/\/file\/([^/?#]+)/)
    if (fileMatch && fileMatch[1]) return fileMatch[1]
    const uMatch = parsed.pathname.match(/\/u\/([^/?#]+)/)
    if (uMatch && uMatch[1]) return uMatch[1]
    const parts = parsed.pathname.split('/').filter(Boolean)
    if (parts.length === 1) return parts[0]
    return null
  } catch {
    return null
  }
}
const activeDownloads = new Map()
const downloadQueues = new Map()
const globalDownloadQueue = []
const cancelledDownloadIds = new Set()
const activeExtractions = new Set()
const deferredArchives = new Map() // appid → archivePath[] waiting for all parts to finish
const runningGames = new Map()
const WINDOWS_GAME_HANDOFF_GRACE_MS = 12000
const WINDOWS_GAME_HANDOFF_POLL_MS = 1000
const GAME_PID_POLL_MS = 3000

// ============================================================
// In-Game Overlay System (Steam-like)
// ============================================================

let overlayWindow = null
let overlayEnabled = true
let overlayHotkey = 'Ctrl+Shift+Tab'
let currentOverlayAppid = null
let overlayAutoShow = true
let overlayPosition = 'left'
let overlayMode = 'hidden' // 'hidden' | 'toast' | 'panel'
let overlayToastTimer = null
let overlayReady = false // true once overlay webContents finishes loading
let overlayDeferredToastAppid = undefined // set when toast requested before overlay ready
let overlayLastEvent = 'not-initialized'
let overlayLastError = null

function setOverlayEvent(event) {
  overlayLastEvent = `${new Date().toISOString()} ${event}`
}

function setOverlayError(error) {
  overlayLastError = error ? String(error) : null
  if (overlayLastError) setOverlayEvent(`error: ${overlayLastError}`)
}

function getOverlayDiagnostics() {
  const visible = Boolean(overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible())
  const hotkeyRegistered = Boolean(overlayEnabled && overlayHotkey && globalShortcut.isRegistered(overlayHotkey))
  const dllPath = getDllPath()
  const injections = Array.from(overlayInjections.keys()).map((pid) => {
    const runningEntry = Array.from(runningGames.values()).find((entry) => entry?.pid === pid)
    return {
      pid,
      appid: runningEntry?.appid || null,
      gameName: runningEntry?.gameName || null,
    }
  })

  return {
    enabled: overlayEnabled,
    autoShow: overlayAutoShow,
    hotkey: overlayHotkey,
    hotkeyRegistered,
    position: overlayPosition,
    currentMode: overlayMode,
    currentAppid: currentOverlayAppid,
    overlayWindowCreated: Boolean(overlayWindow && !overlayWindow.isDestroyed()),
    overlayWindowReady: overlayReady,
    overlayWindowVisible: visible,
    nativeAddonAvailable: Boolean(nativeOverlay),
    dllPath,
    dllExists: fs.existsSync(dllPath),
    injectionCount: overlayInjections.size,
    injections,
    runningGameCount: runningGames.size,
    lastEvent: overlayLastEvent,
    lastError: overlayLastError,
  }
}

function configureAutoUpdater() {
  if (isDev) {
    setUpdateStatus({ enabled: false, state: 'disabled' })
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: UPDATE_OWNER,
    repo: UPDATE_REPO,
  })

  autoUpdater.on('checking-for-update', () => {
    ucLog('Checking for app updates')
    setUpdateStatus({ state: 'checking', error: null, checkedAt: Date.now() })
  })

  autoUpdater.on('update-available', (info) => {
    const version = String(info?.version || '').replace(/^v/i, '') || null
    ucLog(`Update available: ${version || 'unknown version'}`)
    setUpdateStatus({
      state: 'available',
      version,
      available: true,
      downloaded: false,
      progress: 0,
      error: null,
      checkedAt: Date.now(),
    })
  })

  autoUpdater.on('update-not-available', () => {
    ucLog('No app update available')
    setUpdateStatus({
      state: 'not-available',
      version: null,
      available: false,
      downloaded: false,
      progress: 0,
      error: null,
      checkedAt: Date.now(),
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    setUpdateStatus({
      state: 'downloading',
      available: true,
      downloaded: false,
      progress: Math.max(0, Math.min(100, Number(progress?.percent || 0))),
      error: null,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    const version = String(info?.version || updateState.version || '').replace(/^v/i, '') || updateState.version
    ucLog(`Update downloaded: ${version || 'unknown version'}`)
    setUpdateStatus({
      state: 'downloaded',
      version,
      available: true,
      downloaded: true,
      progress: 100,
      error: null,
    })
  })

  autoUpdater.on('error', (err) => {
    const message = err?.message || String(err)
    ucLog(`Auto-update failed: ${message}`, 'warn')
    setUpdateStatus({ state: 'error', error: message })
  })
}

async function triggerAutoUpdateCheck() {
  if (isDev) {
    setUpdateStatus({ enabled: false, state: 'disabled', error: null })
    return getUpdateStatusSnapshot()
  }
  if (updateState.state === 'checking' || updateState.state === 'downloading') {
    return getUpdateStatusSnapshot()
  }

  try {
    await autoUpdater.checkForUpdates()
    return getUpdateStatusSnapshot()
  } catch (err) {
    const message = err?.message || String(err)
    setUpdateStatus({ state: 'error', error: message, checkedAt: Date.now() })
    return getUpdateStatusSnapshot()
  }
}

async function retryAutoUpdate() {
  if (isDev) {
    setUpdateStatus({ enabled: false, state: 'disabled', error: null })
    return getUpdateStatusSnapshot()
  }
  if (updateState.state === 'downloaded') return getUpdateStatusSnapshot()

  try {
    if (updateState.available && !updateState.downloaded) {
      setUpdateStatus({ state: 'downloading', error: null })
      await autoUpdater.downloadUpdate()
      return getUpdateStatusSnapshot()
    }
    return await triggerAutoUpdateCheck()
  } catch (err) {
    const message = err?.message || String(err)
    setUpdateStatus({ state: 'error', error: message, checkedAt: Date.now() })
    return getUpdateStatusSnapshot()
  }
}

// Create the overlay window (transparent, always on top, click-through capable)
function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow
  }
  setOverlayEvent('creating overlay window')

  // Get primary display dimensions - use full size (not workAreaSize) so the
  // overlay covers fullscreen/exclusive games that extend under the taskbar.
  const primaryDisplay = require('electron').screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.size

  overlayWindow = new BrowserWindow({
    width: width,
    height: height,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: true,
    fullscreenable: false,
    show: false,
    type: 'toolbar', // 'toolbar' type helps overlay appear on top of fullscreen games on Windows
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      webSecurity: true
    }
  })

  // Load the overlay page
  if (isDev) {
    overlayWindow.loadURL('http://localhost:5173/#/overlay')
  } else {
    overlayWindow.loadFile(path.join(__dirname, '..', 'renderer', 'dist', 'index.html'), { hash: '/overlay' })
  }

  // Make the overlay transparent and ignore mouse events when hidden
  overlayWindow.setIgnoreMouseEvents(true, { forward: true })
  overlayWindow.setVisibleOnAllWorkspaces(true)
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')

  overlayWindow.webContents.once('did-finish-load', () => {
    overlayReady = true
    setOverlayEvent('overlay renderer ready')
    ucLog('Overlay renderer loaded and ready')
    // If a toast was requested while the page was loading, fire it now
    if (overlayDeferredToastAppid !== undefined) {
      const deferred = overlayDeferredToastAppid
      overlayDeferredToastAppid = undefined
      showOverlayToast(deferred)
    }
  })

  overlayWindow.on('closed', () => {
    overlayWindow = null
    overlayReady = false
    currentOverlayAppid = null
    setOverlayEvent('overlay window closed')
  })

  setOverlayError(null)
  ucLog('Overlay window created')
  return overlayWindow
}

// Show the overlay window (full panel mode)
function showOverlay(appid = null) {
  if (!overlayEnabled) return
  // If no appid given, use current overlay appid or fall back to first running game
  if (!appid) {
    appid = currentOverlayAppid || (runningGames.size > 0 ? [...runningGames.values()].find(g => g.appid)?.appid || null : null)
  }
  if (!overlayWindow || overlayWindow.isDestroyed()) createOverlayWindow()
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    clearTimeout(overlayToastTimer)
    overlayMode = 'panel'
    currentOverlayAppid = appid
    overlayWindow.setIgnoreMouseEvents(false)
    overlayWindow.show()
    overlayWindow.focus()
    setOverlayEvent(`overlay panel shown for ${appid || 'unknown'}`)
    overlayWindow.webContents.send('uc:overlay-show', { appid })
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('uc:overlay-state-changed', { visible: true, appid })
    }
    ucLog(`Overlay panel shown for game: ${appid || 'unknown'}`)
  }
}

// Show a transient toast notification when a game launches (auto-dismisses)
function showOverlayToast(appid = null) {
  if (!overlayEnabled) {
    ucLog(`Overlay toast skipped (disabled) for game: ${appid || 'unknown'}`)
    return
  }
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayReady = false
    createOverlayWindow()
  }
  // If the overlay page hasn't finished loading yet, defer the toast
  if (!overlayReady) {
    ucLog(`Overlay toast deferred (page loading) for game: ${appid || 'unknown'}`)
    setOverlayEvent(`overlay toast deferred for ${appid || 'unknown'}`)
    overlayDeferredToastAppid = appid
    return
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayMode = 'toast'
    currentOverlayAppid = appid
    overlayWindow.setIgnoreMouseEvents(true, { forward: true })
    // Re-assert always-on-top so the overlay is above fullscreen games
    overlayWindow.setAlwaysOnTop(true, 'screen-saver')
    overlayWindow.showInactive()
    setOverlayEvent(`overlay toast shown for ${appid || 'unknown'}`)
    overlayWindow.webContents.send('uc:overlay-toast', { appid })
    clearTimeout(overlayToastTimer)
    overlayToastTimer = setTimeout(() => {
      if (overlayMode === 'toast') hideOverlay()
    }, 5500)
    ucLog(`Overlay toast shown for game: ${appid || 'unknown'}`)
  }
}

// Hide the overlay window
function hideOverlay() {
  ucLog(`[Overlay] hideOverlay called (current mode: ${overlayMode})`)
  clearTimeout(overlayToastTimer)
  const wasPanel = overlayMode === 'panel'
  overlayMode = 'hidden'
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true })
    try { overlayWindow.blur() } catch { }
    overlayWindow.hide()

    // On Windows, actively return focus to the game window.
    // overlayWindow.blur() alone does not refocus fullscreen games.
    if (wasPanel && process.platform === 'win32') {
      const gamePid = currentOverlayAppid ? getRunningGame(currentOverlayAppid)?.pid : null
      if (gamePid) {
        try {
          child_process.exec(
            `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "$p = Get-Process -Id ${gamePid} -ErrorAction SilentlyContinue; if ($p -and $p.MainWindowHandle -ne 0) { Add-Type -Name WinAPI -Namespace UC -MemberDefinition '[DllImport(\\\"user32.dll\\\")] public static extern bool SetForegroundWindow(IntPtr hWnd);'; [UC.WinAPI]::SetForegroundWindow($p.MainWindowHandle) }"`,
            { windowsHide: true, timeout: 3000 },
            () => {}
          )
        } catch { }
      }
    }
    
    // Notify renderer
    overlayWindow.webContents.send('uc:overlay-hide', {})
    
    // Notify main window
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('uc:overlay-state-changed', { visible: false, appid: currentOverlayAppid })
    }
    
    ucLog('Overlay hidden')
    setOverlayEvent('overlay hidden')
  }
}

// Toggle the overlay visibility
function toggleOverlay(appid = null) {
  // Toggle injected overlays for all running games
  for (const [pid] of overlayInjections) {
    toggleInjectedOverlay(pid)
  }

  // Mode-aware toggle: upgrade toast → panel, hide panel, or open panel
  if (overlayMode === 'toast') {
    showOverlay(appid || currentOverlayAppid)
  } else if (overlayMode === 'panel') {
    hideOverlay()
  } else {
    showOverlay(appid || currentOverlayAppid)
  }
}

// Register global hotkey for overlay
function registerOverlayHotkey() {
  // Unregister existing hotkey first
  globalShortcut.unregisterAll()
  
  if (overlayEnabled && overlayHotkey) {
    const success = globalShortcut.register(overlayHotkey, () => {
      ucLog(`Overlay hotkey pressed: ${overlayHotkey}`)
      toggleOverlay(currentOverlayAppid)
    })
    
    if (success) {
      ucLog(`Overlay hotkey registered: ${overlayHotkey}`)
      setOverlayError(null)
      setOverlayEvent(`overlay hotkey registered: ${overlayHotkey}`)
    } else {
      ucLog(`Failed to register overlay hotkey: ${overlayHotkey}`, 'warn')
      setOverlayError(`Failed to register hotkey: ${overlayHotkey}`)
    }
  }
}

// Update overlay settings
function updateOverlaySettings(settings) {
  const newEnabled = settings.overlayEnabled !== undefined ? settings.overlayEnabled : overlayEnabled
  const newHotkey = settings.overlayHotkey || overlayHotkey
  const newAutoShow = settings.overlayAutoShow !== undefined ? settings.overlayAutoShow : overlayAutoShow
  const newPosition = settings.overlayPosition || overlayPosition
  
  let changed = false
  
  if (newEnabled !== overlayEnabled) {
    overlayEnabled = newEnabled
    changed = true
    if (!overlayEnabled) {
      hideOverlay()
      globalShortcut.unregisterAll()
    }
  }
  
  if (newHotkey !== overlayHotkey) {
    overlayHotkey = newHotkey
    changed = true
  }
  
  if (newAutoShow !== overlayAutoShow) {
    overlayAutoShow = newAutoShow
    changed = true
  }

  if (newPosition !== overlayPosition) {
    overlayPosition = newPosition
    changed = true
  }
  
  if (changed && overlayEnabled) {
    registerOverlayHotkey()
  }

  // Broadcast position to overlay window so the UI can update
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('uc:overlay-position-changed', { position: overlayPosition })
  }
}

// Check if a game is running and auto-show overlay toast if enabled
function checkAndShowOverlayForGame(appid) {
  if (overlayAutoShow && overlayEnabled && runningGames.has(appid)) {
    showOverlayToast(appid)
  } else {
    ucLog(`[Overlay] checkAndShowOverlayForGame(${appid}): skipped (autoShow=${overlayAutoShow}, enabled=${overlayEnabled}, tracked=${runningGames.has(appid)})`)
  }
}

// ============================================================
// Native Overlay Injection System
// ============================================================
// Loads the C++ native addon for DLL injection, shared memory,
// and named pipes. Falls back gracefully to transparent-window-only mode.

let nativeOverlay = null
try {
  nativeOverlay = require('./native/build/Release/uc_overlay_native.node')
  console.log('[UC] [INFO] Native overlay addon loaded')
} catch (e) {
  console.warn('[UC] [WARN] Native overlay addon not available - using window-only overlay:', e.message)
}

// Per-game injection state: pid -> { shmemHandle, pipeHandle, offscreenWindow }
const overlayInjections = new Map()

const OVERLAY_FRAME_WIDTH = 1920
const OVERLAY_FRAME_HEIGHT = 1080

function getDllPath() {
  if (isDev) {
    return path.join(__dirname, '..', 'build', 'Release', 'uc-overlay-x64.dll')
  }
  return path.join(process.resourcesPath, 'uc-overlay-x64.dll')
}

/**
 * Inject the overlay DLL into a running game process.
 * Creates shared memory, pipe server, and an offscreen BrowserWindow
 * that paints the overlay UI into the shared memory region.
 */
function injectOverlayIntoGame(pid, appid) {
  if (!nativeOverlay || !overlayEnabled) return
  if (overlayInjections.has(pid)) return

  const dllPath = getDllPath()
  if (!fs.existsSync(dllPath)) {
    ucLog(`Overlay DLL not found at ${dllPath} - skipping injection`, 'warn')
    setOverlayError(`Overlay DLL not found at ${dllPath}`)
    return
  }

  try {
    // 1. Create shared memory for frame data
    const shmemHandle = nativeOverlay.createSharedFrame(pid, OVERLAY_FRAME_WIDTH, OVERLAY_FRAME_HEIGHT)

    // 2. Create pipe server to receive input from DLL
    const pipeHandle = nativeOverlay.createPipeServer(pid, (msg) => {
      handleDllMessage(pid, msg)
    })

    // 3. Create offscreen BrowserWindow for rendering overlay
    const offscreenWin = new BrowserWindow({
      width: OVERLAY_FRAME_WIDTH,
      height: OVERLAY_FRAME_HEIGHT,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, 'preload.cjs'),
        offscreen: true
      }
    })

    // When the offscreen window paints, write pixels to shared memory
    offscreenWin.webContents.on('paint', (event, dirty, image) => {
      const injection = overlayInjections.get(pid)
      if (!injection) return
      const bitmap = image.toBitmap()
      const size = image.getSize()
      // Only write if dimensions match (or close enough)
      if (size.width === OVERLAY_FRAME_WIDTH && size.height === OVERLAY_FRAME_HEIGHT) {
        try {
          nativeOverlay.writeSharedFrame(injection.shmemHandle, Buffer.from(bitmap), injection.visible)
        } catch {}
      }
    })

    offscreenWin.webContents.setFrameRate(60)

    // Load overlay page
    if (isDev) {
      offscreenWin.loadURL('http://localhost:5173/#/overlay')
    } else {
      offscreenWin.loadFile(path.join(__dirname, '..', 'renderer', 'dist', 'index.html'), { hash: '/overlay' })
    }

    // Show the overlay initially if auto-show is on
    offscreenWin.webContents.on('did-finish-load', () => {
      if (overlayAutoShow) {
        offscreenWin.webContents.send('uc:overlay-show', { appid })
      }
    })

    const injection = {
      shmemHandle,
      pipeHandle,
      offscreenWindow: offscreenWin,
      pid,
      appid,
      visible: overlayAutoShow
    }
    overlayInjections.set(pid, injection)

    // 4. Inject the DLL - do this after everything else is ready
    // Small delay to let pipe server start listening
    setTimeout(() => {
      try {
        const success = nativeOverlay.injectDll(pid, dllPath)
        if (success) {
          ucLog(`Overlay DLL injected into PID ${pid} for game ${appid}`)
          setOverlayError(null)
          setOverlayEvent(`overlay injected into pid ${pid} (${appid || 'unknown'})`)
        } else {
          ucLog(`Failed to inject overlay DLL into PID ${pid}`, 'warn')
          setOverlayError(`Failed to inject overlay DLL into PID ${pid}`)
          cleanupOverlayInjection(pid)
        }
      } catch (e) {
        ucLog(`Error injecting overlay DLL: ${e.message}`, 'error')
        setOverlayError(`Error injecting overlay DLL into PID ${pid}: ${e.message}`)
        cleanupOverlayInjection(pid)
      }
    }, 500)

  } catch (e) {
    ucLog(`Error setting up overlay injection for PID ${pid}: ${e.message}`, 'error')
    setOverlayError(`Error setting up overlay injection for PID ${pid}: ${e.message}`)
    cleanupOverlayInjection(pid)
  }
}

/**
 * Handle input messages coming from the injected DLL via pipe.
 */
function handleDllMessage(pid, msg) {
  const injection = overlayInjections.get(pid)
  if (!injection || !injection.offscreenWindow || injection.offscreenWindow.isDestroyed()) return

  const wc = injection.offscreenWindow.webContents

  switch (msg.type) {
    case 'connected':
      ucLog(`Overlay DLL connected from PID ${pid}`)
      break

    case 'key': {
      // Forward key event to offscreen renderer
      const keyEvent = {
        type: msg.down ? 'keyDown' : 'keyUp',
        keyCode: msg.key || ''
      }
      wc.sendInputEvent(keyEvent)
      break
    }

    case 'mouseClick': {
      const button = msg.button === 1 ? 'right' : msg.button === 2 ? 'middle' : 'left'
      wc.sendInputEvent({
        type: msg.clickType === 0 ? 'mouseDown' : 'mouseUp',
        x: msg.x || 0,
        y: msg.y || 0,
        button,
        clickCount: 1
      })
      break
    }

    case 'mouseMove': {
      wc.sendInputEvent({
        type: 'mouseMove',
        x: msg.x || 0,
        y: msg.y || 0
      })
      break
    }
  }
}

/**
 * Toggle the injected overlay visibility for a specific game.
 */
function toggleInjectedOverlay(pid) {
  const injection = overlayInjections.get(pid)
  if (!injection) return

  injection.visible = !injection.visible
  const wc = injection.offscreenWindow?.webContents
  if (wc && !injection.offscreenWindow.isDestroyed()) {
    if (injection.visible) {
      wc.send('uc:overlay-show', { appid: injection.appid })
    } else {
      wc.send('uc:overlay-hide', {})
    }
  }

  // Send visibility command to DLL via pipe
  if (nativeOverlay && injection.pipeHandle) {
    const cmd = Buffer.alloc(4)
    cmd[0] = 0x10 // show/hide command
    cmd.writeUInt16LE(1, 1) // payload length
    cmd[3] = injection.visible ? 1 : 0
    try {
      nativeOverlay.sendPipeMessage(injection.pipeHandle, cmd)
    } catch {}
  }
}

/**
 * Clean up overlay injection state for a game process.
 */
function cleanupOverlayInjection(pid) {
  const injection = overlayInjections.get(pid)
  if (!injection) return

  try {
    // Eject DLL
    if (nativeOverlay) {
      try { nativeOverlay.ejectDll(pid, getDllPath()) } catch {}
    }
    // Destroy pipe server
    if (nativeOverlay && injection.pipeHandle) {
      try { nativeOverlay.destroyPipeServer(injection.pipeHandle) } catch {}
    }
    // Destroy shared memory
    if (nativeOverlay && injection.shmemHandle) {
      try { nativeOverlay.destroySharedFrame(injection.shmemHandle) } catch {}
    }
    // Close offscreen window
    if (injection.offscreenWindow && !injection.offscreenWindow.isDestroyed()) {
      injection.offscreenWindow.close()
    }
  } catch (e) {
    ucLog(`Error cleaning up overlay for PID ${pid}: ${e.message}`, 'warn')
  }

  overlayInjections.delete(pid)
  ucLog(`Overlay injection cleaned up for PID ${pid}`)
  setOverlayEvent(`overlay injection cleaned up for pid ${pid}`)
}

const downloadDirName = 'UnionCrax.Direct'
const installingDirName = 'installing'
const installedDirName = 'installed'
const INSTALLED_MANIFEST = 'installed.json'
const INSTALLED_INDEX = 'installed-index.json'
const settingsPath = path.join(app.getPath('userData'), 'settings.json')
const appLogsPath = path.join(app.getPath('userData'), 'app-logs.txt')
const LOG_SESSION_ID = crypto.randomBytes(6).toString('hex')
let cachedSettings = null

function getAppVersion() {
  return packageJson?.version || (typeof app.getVersion === 'function' ? app.getVersion() : null) || process.env.npm_package_version || '0.0.0'
}

function applySettingsDefaults(settings) {
  const next = settings && typeof settings === 'object' ? { ...settings } : {}
  if (typeof next.discordRpcEnabled !== 'boolean') next.discordRpcEnabled = true
  if (typeof next.verboseDownloadLogging !== 'boolean') next.verboseDownloadLogging = false
  return next
}

function broadcastSettingsChanges(nextSettings, prevSettings) {
  const next = nextSettings && typeof nextSettings === 'object' ? nextSettings : {}
  const prev = prevSettings && typeof prevSettings === 'object' ? prevSettings : {}
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
  for (const key of keys) {
    if (next[key] === prev[key]) continue
    for (const w of BrowserWindow.getAllWindows()) {
      if (w && !w.isDestroyed()) {
        w.webContents.send('uc:setting-changed', { key, value: next[key] })
      }
    }
  }
}

// === Global Logging System ===
function safeStringify(value) {
  try {
    const seen = new WeakSet()
    return JSON.stringify(value, (key, val) => {
      if (typeof val === 'bigint') return val.toString()
      if (val instanceof Error) {
        return { name: val.name, message: val.message, stack: val.stack }
      }
      if (val && typeof val === 'object') {
        if (seen.has(val)) return '[Circular]'
        seen.add(val)
      }
      return val
    })
  } catch (err) {
    try { return String(value) } catch { return '[Unserializable]' }
  }
}

function normalizeLogData(data) {
  if (!data) return data
  if (data instanceof Error) return { name: data.name, message: data.message, stack: data.stack }
  if (data && typeof data === 'object' && data.name && data.message && data.stack) return data
  return data
}

function ucLog(message, level = 'info', data = null) {
  const timestamp = new Date().toISOString()
  const levelTag = level.toUpperCase().padEnd(5)
  const normalized = normalizeLogData(data)
  const dataStr = normalized ? ` | Data: ${safeStringify(normalized)}` : ''
  const logLine = `[${timestamp}] [${levelTag}] ${message}${dataStr}\n`
  try {
    fs.appendFileSync(appLogsPath, logLine)
  } catch (err) {
    console.error('[UC] Failed to write log:', err)
  }
  const consoleMethod = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  consoleMethod(`[UC] [${level.toUpperCase()}]`, message, data || '')
}

function getLogs() {
  try {
    return fs.readFileSync(appLogsPath, 'utf8')
  } catch (err) {
    ucLog(`Failed to read logs: ${err.message}`, 'error')
    return ''
  }
}

function clearLogs() {
  try {
    fs.writeFileSync(appLogsPath, `[${new Date().toISOString()}] [INFO ] === App Log Started (session ${LOG_SESSION_ID}, pid ${process.pid}) ===\n`)
    ucLog('Logs cleared')
  } catch (err) {
    console.error('[UC] Failed to clear logs:', err)
  }
}

function attachWindowLogging(win, label = 'window') {
  if (!win) return
  const wc = win.webContents
  ucLog(`Window created: ${label}`)
  win.on('show', () => {
    ucLog(`Window show: ${label}`)
    restoreRpcActivity()
  })
  win.on('hide', () => {
    ucLog(`Window hide: ${label}`)
    hideRpcActivity()
  })
  win.on('minimize', () => {
    ucLog(`Window minimize: ${label}`)
    hideRpcActivity()
  })
  win.on('restore', () => {
    ucLog(`Window restore: ${label}`)
    restoreRpcActivity()
  })
  win.on('closed', () => ucLog(`Window closed: ${label}`))

  wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    ucLog(`Renderer failed to load: ${label}`, 'warn', { errorCode, errorDescription, validatedURL, isMainFrame })
  })
  wc.on('render-process-gone', (_event, details) => {
    ucLog(`Renderer process gone: ${label}`, 'error', details)
  })
  wc.on('unresponsive', () => ucLog(`Window unresponsive: ${label}`, 'warn'))
  wc.on('responsive', () => ucLog(`Window responsive: ${label}`))
  wc.on('crashed', () => ucLog(`WebContents crashed: ${label}`, 'error'))
  wc.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 1) {
      const mappedLevel = level >= 2 ? 'error' : 'warn'
      ucLog(`Renderer console (${label})`, mappedLevel, { level, message, line, sourceId })
    }
  })
}

function registerProcessLogging() {
  process.on('uncaughtException', (err) => ucLog('Uncaught exception', 'error', err))
  process.on('unhandledRejection', (reason) => ucLog('Unhandled rejection', 'error', reason))
  process.on('warning', (warning) => ucLog('Process warning', 'warn', warning))
  process.on('beforeExit', (code) => ucLog('Process beforeExit', 'info', { code }))
  process.on('exit', (code) => ucLog('Process exit', 'info', { code }))

  app.on('before-quit', () => {
    app.isQuitting = true
    ucLog('App before-quit')
  })
  app.on('will-quit', () => ucLog('App will-quit'))
  app.on('quit', (_event, exitCode) => ucLog('App quit', 'info', { exitCode }))
  app.on('window-all-closed', () => ucLog('All windows closed'))
  app.on('activate', () => ucLog('App activate'))
  app.on('render-process-gone', (_event, _webContents, details) => ucLog('Render process gone (app)', 'error', details))
  app.on('child-process-gone', (_event, details) => ucLog('Child process gone', 'error', details))
  app.on('gpu-process-crashed', (_event, killed) => ucLog('GPU process crashed', 'error', { killed }))
}

// === Discord Rich Presence ===
let rpcClient = null
let rpcReady = false
let rpcEnabled = false
const RPC_CLIENT_ID_DEFAULT = '1464971744199839928'
let rpcClientId = RPC_CLIENT_ID_DEFAULT
let rpcActiveClientId = null
let rpcStartTimestamp = Math.floor(Date.now() / 1000)
let rpcLastRendererActivity = null
let rpcGameActivity = null
let rpcCurrentActivity = null
let rpcWindowHidden = false

function normalizeRpcActivity(payload) {
  if (!payload || typeof payload !== 'object') return null
  const activity = {}
  if (payload.details && typeof payload.details === 'string') activity.details = payload.details
  if (payload.state && typeof payload.state === 'string') activity.state = payload.state
  if (payload.startTimestamp && Number.isFinite(Number(payload.startTimestamp))) {
    activity.startTimestamp = Number(payload.startTimestamp)
  }
  if (payload.endTimestamp && Number.isFinite(Number(payload.endTimestamp))) {
    activity.endTimestamp = Number(payload.endTimestamp)
  }
  if (payload.largeImageKey && typeof payload.largeImageKey === 'string') activity.largeImageKey = payload.largeImageKey
  if (payload.largeImageText && typeof payload.largeImageText === 'string') activity.largeImageText = payload.largeImageText
  if (payload.smallImageKey && typeof payload.smallImageKey === 'string') activity.smallImageKey = payload.smallImageKey
  if (payload.smallImageText && typeof payload.smallImageText === 'string') activity.smallImageText = payload.smallImageText
  if (Array.isArray(payload.buttons)) activity.buttons = payload.buttons
  return Object.keys(activity).length ? activity : null
}

async function applyRpcActivity(activity) {
  if (!rpcClient || !rpcReady || !activity || rpcWindowHidden) return
  try {
    rpcCurrentActivity = activity
    await rpcClient.setActivity(activity)
  } catch (err) {
    ucLog(`RPC setActivity failed: ${err?.message || String(err)}`, 'warn')
  }
}

function clearRpcActivity() {
  if (!rpcClient || !rpcReady) return
  try {
    rpcCurrentActivity = null
    rpcClient.clearActivity()
  } catch (err) {
    ucLog(`RPC clearActivity failed: ${err?.message || String(err)}`, 'warn')
  }
}

function hideRpcActivity() {
  rpcWindowHidden = true
  clearRpcActivity()
}

function restoreRpcActivity() {
  if (!rpcWindowHidden) return
  rpcWindowHidden = false
  const activity = rpcGameActivity || rpcLastRendererActivity || rpcCurrentActivity
  if (activity) {
    applyRpcActivity(activity)
  }
}
function shutdownRpcClient() {
  if (!rpcClient) return
  try { rpcClient.clearActivity() } catch { }
  try { rpcClient.destroy() } catch { }
  rpcClient = null
  rpcReady = false
  rpcCurrentActivity = null
  rpcActiveClientId = null
}

async function ensureRpcClient() {
  if (!rpcEnabled || !rpcClientId) return
  if (rpcClient && rpcActiveClientId === rpcClientId) return
  shutdownRpcClient()
  try {
    rpcClient = new DiscordRPC.Client({ transport: 'ipc' })
    rpcActiveClientId = rpcClientId
    rpcClient.on('ready', () => {
      rpcReady = true
      ucLog('Discord RPC connected')
      const activity = rpcGameActivity || rpcLastRendererActivity || rpcCurrentActivity
      if (activity) applyRpcActivity(activity)
    })
    rpcClient.on('disconnected', () => {
      rpcReady = false
      ucLog('Discord RPC disconnected', 'warn')
    })
    rpcClient.on('error', (err) => {
      ucLog(`Discord RPC error: ${err?.message || String(err)}`, 'warn')
    })
    await rpcClient.login({ clientId: rpcClientId })
  } catch (err) {
    rpcReady = false
    ucLog(`Discord RPC login failed: ${err?.message || String(err)}`, 'warn')
  }
}

async function updateRpcSettings(nextSettings) {
  const enabled = nextSettings?.discordRpcEnabled !== false
  rpcEnabled = enabled
  rpcClientId = RPC_CLIENT_ID_DEFAULT

  if (!rpcEnabled) {
    shutdownRpcClient()
    return
  }
  await ensureRpcClient()
}

async function setRendererRpcActivity(payload) {
  const activity = normalizeRpcActivity(payload)
  rpcLastRendererActivity = activity
  if (!rpcGameActivity && activity) {
    await applyRpcActivity(activity)
  }
}

async function setGameRpcActivity(payload) {
  const activity = normalizeRpcActivity(payload)
  rpcGameActivity = activity
  if (activity) {
    await applyRpcActivity(activity)
  }
}

function clearGameRpcActivity() {
  rpcGameActivity = null
  if (rpcLastRendererActivity) {
    applyRpcActivity(rpcLastRendererActivity)
  } else {
    clearRpcActivity()
  }
}

// Initialize logging
clearLogs()
ucLog('UnionCrax.Direct starting...', 'info')
ucLog(`Version: ${packageJson.version}`, 'info')
ucLog(`Platform: ${process.platform} ${process.arch}`, 'info')
ucLog(`Electron: ${process.versions.electron}`, 'info')
ucLog(`Node: ${process.versions.node}`, 'info')
registerProcessLogging()

function resolveIcon() {
  const asset = process.platform === 'win32' ? 'icon.ico' : 'icon.png'

  // For packaged apps, try to resolve from resources first
  if (app.isPackaged) {
    const packagedPath = path.join(process.resourcesPath, 'assets', asset)
    if (fs.existsSync(packagedPath)) return packagedPath
  }

  // Fallback to development path
  return path.join(__dirname, '..', 'assets', asset)
}

function resolveTrayIcon() {
  // Use the same resolution logic as resolveIcon
  return resolveIcon()
}

function createTray() {
  if (tray) return
  const iconPath = resolveTrayIcon()
  const image = nativeImage.createFromPath(iconPath)
  tray = new Tray(image.isEmpty() ? resolveIcon() : image)
  tray.setToolTip('UnionCrax.Direct')
  tray.setTitle('UnionCrax.Direct')
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show UnionCrax.Direct',
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
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isVisible()) {
        mainWindow.hide()
      } else {
        mainWindow.show()
        mainWindow.focus()
      }
    }
  })
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

// In development, allow multiple instances so `pnpm dev` is not blocked by a
// hidden tray instance from a prior run.
const enforceSingleInstance = !isDev
const gotTheLock = enforceSingleInstance ? app.requestSingleInstanceLock() : true
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event, argv) => {
    // Check if this second instance is from the setup/installer
    let isSetupRun = false
    if (argv && Array.isArray(argv)) {
      for (const arg of argv) {
        const lower = String(arg).toLowerCase()
        // Detect installer/update invocations only; do not treat generic .exe
        // args as setup runs, otherwise normal second-instance events can quit
        // the app unexpectedly.
        if (
          lower.includes('setup') ||
          lower.includes('installer') ||
          lower.includes('nsis') ||
          lower.includes('squirrel') ||
          lower.includes('--squirrel')
        ) {
          isSetupRun = true
          break
        }
      }
    }

    if (isSetupRun) {
      // If setup is being run, close the current app to allow proper update
      ucLog('Setup detected during second-instance, closing app for update...')
      app.quit()
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        // Bring the app to focus
        if (mainWindow.isMinimized()) {
          mainWindow.restore()
        }
        // Always show the window
        mainWindow.show()
        // Use setImmediate to ensure the window is fully ready before focusing
        setImmediate(() => {
          try {
            mainWindow.focus()
          } catch (e) {
            ucLog(`Failed to focus window: ${e && e.message ? e.message : String(e)}`, 'warn')
          }
        })
      } catch (e) {
        ucLog(`Error handling second-instance: ${e && e.message ? e.message : String(e)}`, 'warn')
        // If something goes wrong, try creating a new window
        if (!BrowserWindow.getAllWindows().some(w => !w.isDestroyed())) {
          createWindow()
        }
      }
    } else {
      // If there's no valid window, create one
      createWindow()
    }
  })
}

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
            } catch { }
          }, 50)
        }
      } catch { }
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
    } catch { }

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
  const withDefaults = applySettingsDefaults(cachedSettings)
  const defaultsApplied = JSON.stringify(withDefaults) !== JSON.stringify(cachedSettings)
  cachedSettings = withDefaults
  if (defaultsApplied) {
    try { writeSettings(withDefaults) } catch { }
  }
  return cachedSettings
}

function writeSettings(next) {
  cachedSettings = next
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2))
  } catch (error) {
    ucLog(`Failed to write settings: ${error.message}`, 'error')
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
    headers.set('User-Agent', `UnionCrax.Direct/${getAppVersion()}`)
  }
  if (
    typeof path === 'string' &&
    (path.startsWith('/api/downloads') || path.startsWith('/api/ucfiles')) &&
    !headers.has('x-uc-client')
  ) {
    headers.set('X-UC-Client', 'unioncrax-direct')
  }
  if (cookieHeader) headers.set('Cookie', cookieHeader)

  return await fetch(url, { ...(init || {}), headers })
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
  } catch (err) {
    ucLog(`Setting get failed for ${key}: ${err.message}`, 'error')
    return null
  }
})

ipcMain.handle('uc:setting-set', (_event, key, value) => {
  try {
    const s = readSettings() || {}
    const prev = { ...s }
    s[key] = value
    writeSettings(s)
    if (key === 'discordRpcEnabled') {
      updateRpcSettings(s).catch(() => { })
    }
    broadcastSettingsChanges(s, prev)
    ucLog(`Setting set: ${key}`)
    return { ok: true }
  } catch (err) {
    console.error('[UC] Failed to set setting', key, err)
    ucLog(`Setting set failed for ${key}: ${err.message}`, 'error')
    return { ok: false }
  }
})

ipcMain.handle('uc:setting-clear-all', () => {
  ucLog('Clearing all user data and resetting to defaults')
  try {
    // Reset settings to defaults
    const defaults = applySettingsDefaults({})
    writeSettings(defaults)
    updateRpcSettings(defaults).catch(() => { })
    // broadcast to all renderer windows that settings were cleared
    for (const w of BrowserWindow.getAllWindows()) {
      if (w && !w.isDestroyed()) {
        w.webContents.send('uc:setting-changed', { key: '__CLEAR_ALL__', value: null })
      }
    }
    ucLog('User data cleared successfully')
    return { ok: true }
  } catch (err) {
    console.error('[UC] Failed to clear settings', err)
    ucLog(`Failed to clear user data: ${err.message}`, 'error')
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('uc:settings-export', async () => {
  try {
    const settings = readSettings() || {}
    const defaultName = `unioncrax-direct-settings-${Date.now()}.json`
    const docsPath = app.getPath('documents') || app.getPath('downloads')
    const result = await dialog.showSaveDialog({
      title: 'Export Settings',
      defaultPath: path.join(docsPath, defaultName),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })

    if (result.canceled || !result.filePath) {
      return { ok: false, error: 'cancelled' }
    }

    fs.writeFileSync(result.filePath, JSON.stringify(settings, null, 2), 'utf8')
    return { ok: true, path: result.filePath }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

ipcMain.handle('uc:settings-import', async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })

    if (result.canceled || !result.filePaths?.length) {
      return { ok: false, error: 'cancelled' }
    }

    const filePath = result.filePaths[0]
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    const prev = readSettings() || {}
    const next = applySettingsDefaults(parsed)
    writeSettings(next)
    updateRpcSettings(next).catch(() => { })
    broadcastSettingsChanges(next, prev)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

// IPC: Logging handlers
ipcMain.handle('uc:log', async (_event, level, message, data) => {
  try {
    const settings = readSettings() || {}
    if (level === 'debug' && !settings.verboseDownloadLogging) return { ok: true, skipped: true }
  } catch { }
  ucLog(message, level, data)
})

ipcMain.handle('uc:logs-get', async () => {
  return getLogs()
})

ipcMain.handle('uc:logs-clear', async () => {
  clearLogs()
  return { ok: true }
})

ipcMain.handle('uc:logs-open-folder', async () => {
  try {
    const folder = path.dirname(appLogsPath)
    await shell.openPath(folder)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

async function probeUrl(url, timeoutMs = 6000) {
  const start = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'manual', signal: controller.signal })
    clearTimeout(timeout)
    return { url, ok: res.ok, status: res.status, elapsedMs: Date.now() - start }
  } catch (err) {
    clearTimeout(timeout)
    const error = err && err.name === 'AbortError' ? 'timeout' : String(err)
    return { url, ok: false, status: 0, error, elapsedMs: Date.now() - start }
  }
}

ipcMain.handle('uc:network-test', async (_event, baseUrl) => {
  try {
    const origin = normalizeBaseUrl(baseUrl || DEFAULT_BASE_URL)
    const targets = [
      { label: 'API base', url: origin },
      { label: 'API downloads', url: new URL('/api/downloads/all', origin).toString() },
      { label: 'UC-Files', url: 'https://files.union-crax.xyz' }
    ]
    const results = await Promise.all(
      targets.map(async (target) => ({ label: target.label, ...(await probeUrl(target.url)) }))
    )
    return { ok: true, results }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

ipcMain.handle('uc:rpc-set-activity', async (_event, payload) => {
  await ensureRpcClient()
  await setRendererRpcActivity(payload)
  return { ok: true }
})

ipcMain.handle('uc:rpc-clear', async () => {
  rpcLastRendererActivity = null
  if (rpcGameActivity) return { ok: true }
  clearRpcActivity()
  return { ok: true }
})

ipcMain.handle('uc:rpc-status', async () => {
  return { ok: true, enabled: rpcEnabled, ready: rpcReady, clientId: rpcClientId }
})

ipcMain.handle('uc:auth-login', async (event, baseUrl) => {
  ucLog('Auth login initiated')
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) return { ok: false, error: 'no_window' }
  const authUrl = buildAuthUrl(baseUrl, '/settings')
  const result = await openAuthWindow(win, authUrl)
  if (result?.ok) {
    const sessionData = await getDiscordSession(win.webContents.session, baseUrl)
    ucLog('Auth login success')
    return { ok: true, ...sessionData }
  }
  ucLog(`Auth login failed: ${result?.error || 'auth_failed'}`, 'warn')
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

function getDefaultDownloadRoot() {
  if (process.platform === 'win32') {
    const systemDrive = process.env.SystemDrive || 'C:'
    return path.join(`${systemDrive}\\`, downloadDirName)
  }
  const home = app.getPath('home')
  return path.join(home, downloadDirName)
}

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
  return getDefaultDownloadRoot()
}

function ensureDownloadDir() {
  let target = getDownloadRoot()
  try {
    if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true })
  } catch (err) {
    // Fallback to system drive (Windows) or home directory (others)
    const fallbackRoot = process.platform === 'win32'
      ? `${process.env.SystemDrive || 'C:'}\\`
      : app.getPath('home')
    const fallback = path.join(fallbackRoot, downloadDirName)
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
  ensureInstalledFolderReadme(target)
  return target
}

function ensureInstalledFolderReadme(downloadRoot) {
  try {
    const installedRoot = path.join(downloadRoot, installedDirName)
    const readmePath = path.join(installedRoot, 'README.txt')
    if (fs.existsSync(readmePath)) return

    const content = [
      'UnionCrax.Direct Installed Games Folder',
      '',
      'Do not drag and drop game folders into this directory manually.',
      'Games added this way will be missing required metadata (installed.json) and may not work correctly in the app.',
      '',
      'To add games correctly, use one of these methods inside UnionCrax.Direct:',
      '- Install from the app download flow',
      '- Add External Game',
      '- Install from Archive',
      '',
      'This file is generated automatically by UnionCrax.Direct.'
    ].join('\n')

    fs.writeFileSync(readmePath, content, 'utf8')
  } catch (err) {
    ucLog(`ensureInstalledFolderReadme failed: ${err.message}`, 'warn')
  }
}

function normalizeDownloadRoot(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') return targetPath
  let trimmed = targetPath.trim()
  if (!trimmed) return trimmed

  trimmed = trimmed.replace(/[\\/]+$/, '')

  const baseName = path.basename(trimmed)
  const lowerBase = baseName.toLowerCase()

  if (lowerBase === installingDirName || lowerBase === installedDirName) {
    trimmed = path.dirname(trimmed)
  }

  const hasUnionName = lowerBase.includes('unioncrax.direct') || lowerBase.includes('unioncrax-direct')
  const hasAppSuffix = lowerBase.includes('unioncrax-direct.app') || lowerBase.endsWith('.app')

  if (hasUnionName && hasAppSuffix) {
    trimmed = path.dirname(trimmed)
  }

  const finalBase = path.basename(trimmed)
  if (finalBase.toLowerCase() !== downloadDirName.toLowerCase()) {
    return path.join(trimmed, downloadDirName)
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

// Iterate game folders in a root directory
function* iterateGameFolders(root) {
  if (!root || !fs.existsSync(root)) return
  let entries
  try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch { return }
  for (const dirent of entries) {
    if (!dirent.isDirectory()) continue
    const folder = path.join(root, dirent.name)
    yield { folder, name: dirent.name }
  }
}

function clearDownloadCache() {
  if (activeDownloads.size > 0 || pendingDownloads.length > 0 || globalDownloadQueue.length > 0 || downloadQueues.size > 0) {
    return { ok: false, error: 'downloads-active' }
  }
  try {
    const downloadRoot = ensureDownloadDir()
    const installingRoot = path.join(downloadRoot, installingDirName)
    if (fs.existsSync(installingRoot)) {
      fs.rmSync(installingRoot, { recursive: true, force: true })
    }
    ensureSubdir(downloadRoot, installingDirName)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

function readJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function readJsonFileAsync(filePath) {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const IMAGE_DOWNLOAD_HEADERS = {
  'User-Agent': 'UnionCrax.Direct/1.0',
  'Accept': 'image/*',
}

function downloadToFile(url, destPath, options = {}, depth = 0) {
  return new Promise((resolve) => {
    try {
      const proto = url.startsWith('https') ? require('https') : require('http')
      const headers = options.headers || {}
      const req = proto.get(url, { headers }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers?.location && depth < 3) {
          const nextUrl = new URL(res.headers.location, url).toString()
          res.resume()
          downloadToFile(nextUrl, destPath, options, depth + 1).then(resolve)
          return
        }
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

function hashString(value) {
  try {
    return crypto.createHash('sha1').update(String(value || '')).digest('hex')
  } catch {
    return null
  }
}

function getUrlExtension(url, fallback = 'jpg') {
  try {
    const parsed = new URL(url)
    const ext = path.extname(parsed.pathname || '').replace('.', '').toLowerCase()
    if (ext && /^[a-z0-9]{1,6}$/.test(ext)) return ext
  } catch { }
  return fallback
}

async function cacheRemoteImage(url, targetFolder, baseName) {
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null
  const ext = getUrlExtension(url)
  const filename = `${baseName}.${ext}`
  const destPath = path.join(targetFolder, filename)
  if (fs.existsSync(destPath)) return destPath
  const ok = await downloadToFile(url, destPath, { headers: IMAGE_DOWNLOAD_HEADERS })
  return ok ? destPath : null
}

async function cacheRemoteScreenshots(urls, targetFolder) {
  if (!Array.isArray(urls) || urls.length === 0) return null
  const shotsFolder = ensureSubdir(targetFolder, 'screenshots')
  const results = []
  for (const url of urls) {
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      results.push(null)
      continue
    }
    const hash = hashString(url)
    const ext = getUrlExtension(url)
    const filename = `shot-${(hash || 'unknown').slice(0, 12)}.${ext}`
    const destPath = path.join(shotsFolder, filename)
    if (!fs.existsSync(destPath)) {
      const ok = await downloadToFile(url, destPath, { headers: IMAGE_DOWNLOAD_HEADERS })
      if (!ok) {
        results.push(null)
        continue
      }
    }
    results.push(destPath)
  }
  return results
}

async function cacheMetadataAssets(metadata, targetFolder, manifestPath, downloadRoot) {
  if (!metadata || typeof metadata !== 'object') return false
  let updated = false
  const nextMeta = { ...metadata }

  const localImage = await cacheRemoteImage(metadata.image, targetFolder, 'image')
  if (localImage) {
    nextMeta.localImage = localImage
    updated = true
  }

  const localSplash = await cacheRemoteImage(metadata.splash, targetFolder, 'splash')
  if (localSplash) {
    nextMeta.localSplash = localSplash
    updated = true
  }

  if (Array.isArray(metadata.screenshots) && metadata.screenshots.length > 0) {
    const localScreenshots = await cacheRemoteScreenshots(metadata.screenshots, targetFolder)
    if (localScreenshots && localScreenshots.some(Boolean)) {
      nextMeta.localScreenshots = localScreenshots
      updated = true
    }
  }

  if (!updated || !manifestPath) return updated
  try {
    // Guard: if the target folder was deleted (e.g. installing cleanup raced ahead), skip the write
    if (!fs.existsSync(path.dirname(manifestPath))) return updated
    const manifest = readJsonFile(manifestPath) || {}
    manifest.metadata = { ...(manifest.metadata || {}), ...nextMeta }
    try { manifest.metadataHash = computeObjectHash(manifest.metadata) } catch { }
    uc_writeJsonSync(manifestPath, manifest)
    if (downloadRoot) {
      try { updateInstalledIndex(path.join(downloadRoot, installedDirName)) } catch { }
    }
  } catch { }
  return updated
}

function needsMediaCache(metadata) {
  if (!metadata || typeof metadata !== 'object') return false
  const hasRemoteImage = typeof metadata.image === 'string' && /^https?:\/\//i.test(metadata.image)
  const hasRemoteSplash = typeof metadata.splash === 'string' && /^https?:\/\//i.test(metadata.splash)
  const hasRemoteScreens = Array.isArray(metadata.screenshots) && metadata.screenshots.some((s) => typeof s === 'string' && /^https?:\/\//i.test(s))
  const hasLocalScreens = Array.isArray(metadata.localScreenshots) && metadata.localScreenshots.some(Boolean)
  return (hasRemoteImage && !metadata.localImage) || (hasRemoteSplash && !metadata.localSplash) || (hasRemoteScreens && !hasLocalScreens)
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
    const index = []
    const seenAppids = new Set()
    for (const { folder, name } of iterateGameFolders(installedRoot)) {
      const manifestPath = path.join(folder, INSTALLED_MANIFEST)
      const manifest = readJsonFile(manifestPath)
      if (manifest && manifest.appid && !seenAppids.has(manifest.appid)) {
        seenAppids.add(manifest.appid)
        index.push({ appid: manifest.appid, name: manifest.name || name, folder: path.relative(installedRoot, folder), manifestPath: manifestPath })
      }
    }
    uc_writeJsonSync(path.join(installedRoot, INSTALLED_INDEX), index)
  } catch (err) {
    ucLog(`updateInstalledIndex failed: ${err.message}`, 'error')
  }
}

function uc_writeJsonSync(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
    return true
  } catch (err) {
    ucLog(`Failed to write json ${filePath}: ${err.message}`, 'error')
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
    try {
      ucLog(`[extract] ${String(msg)}`, 'debug')
    } catch (e) { }
  } catch (e) {
    console.log('[UC LOG ERROR]', e)
  }
}

function updateInstalledManifest(installedFolder, metadata, fileEntry) {
  return updateInstalledManifestBulk(installedFolder, metadata, fileEntry ? [fileEntry] : [])
}

function updateInstalledManifestBulk(installedFolder, metadata, fileEntries) {
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
    if (Array.isArray(fileEntries) && fileEntries.length > 0) {
      const existingPaths = new Set(manifest.files.map((f) => f.path))
      for (const entry of fileEntries) {
        if (!entry || !entry.path) continue
        if (!existingPaths.has(entry.path)) {
          manifest.files.push(entry)
          existingPaths.add(entry.path)
        }
      }
    }
    manifest.installedAt = manifest.installedAt || Date.now()
    uc_writeJsonSync(manifestPath, manifest)
    // update root installed index
    try {
      const installedRoot = path.dirname(installedFolder)
      updateInstalledIndex(installedRoot)
    } catch (e) { }
  } catch (err) {
    ucLog(`Failed to update installed manifest: ${err.message}`, 'error')
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

const RESUME_BACKUP_EXT = '.ucresume'

/**
 * Restore a partial download file that was preserved during app quit.
 * When Electron quits, Chromium cancels all active DownloadItems and deletes
 * their partial files from disk. To survive this, before-quit creates a hardlink
 * (.ucresume) to the same file data. This function checks for that backup and
 * restores it if the original was deleted.
 * @param {string} savePath - the original file path
 * @returns {boolean} true if the file exists (either originally or after restore)
 */
function restorePreservedFile(savePath) {
  if (!savePath) return false
  const backupPath = savePath + RESUME_BACKUP_EXT
  if (fs.existsSync(savePath)) {
    // Original still exists - clean up the backup if present
    if (fs.existsSync(backupPath)) {
      try { fs.unlinkSync(backupPath) } catch { }
    }
    return true
  }
  if (fs.existsSync(backupPath)) {
    try {
      fs.renameSync(backupPath, savePath)
      ucLog(`Restored preserved partial download: ${savePath}`, 'info')
      return true
    } catch (e) {
      ucLog(`Failed to restore preserved partial download: ${e.message}`, 'warn')
    }
  }
  return false
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
    const remapLocalPath = (value) => {
      if (!value || !installedRoot || !installingRoot) return value
      const rel = path.relative(installingRoot, value)
      if (!rel || rel.startsWith('..')) return path.join(installedRoot, path.basename(value))
      return path.join(installedRoot, rel)
    }

    if (meta.localImage) meta.localImage = remapLocalPath(meta.localImage)
    if (meta.localSplash) meta.localSplash = remapLocalPath(meta.localSplash)
    if (Array.isArray(meta.localScreenshots)) {
      meta.localScreenshots = meta.localScreenshots.map((p) => remapLocalPath(p))
    }

    if (meta.metadata && meta.metadata.localImage) {
      meta.metadata.localImage = remapLocalPath(meta.metadata.localImage)
    }
    if (meta.metadata && meta.metadata.localSplash) {
      meta.metadata.localSplash = remapLocalPath(meta.metadata.localSplash)
    }
    if (meta.metadata && Array.isArray(meta.metadata.localScreenshots)) {
      meta.metadata.localScreenshots = meta.metadata.localScreenshots.map((p) => remapLocalPath(p))
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
        try { const data = fs.readFileSync(src); fs.writeFileSync(dest, data); try { fs.unlinkSync(src) } catch (e) { } } catch (e) {
          console.warn('[UC] Failed to move item from installing to installed:', src, e)
        }
      }
    }
  } catch (e) {
    console.warn('[UC] Failed to migrate installing folder contents:', e)
  }
}

function manifestRichness(m) {
  if (!m) return 0
  let s = 0
  if (m.metadata) s += 4
  if (m.source && m.source !== 'local') s += 3
  if (m.name && m.name !== m.appid) s += 1
  if (m.description) s += 1
  if (m.image && m.image !== '/banner.png') s += 1
  if (m.release_date) s += 1
  if (m.size) s += 1
  if (m.genres && m.genres.length > 0) s += 1
  if (m.developer) s += 1
  return s
}

function listManifestsFromRoot(root, allowFallback) {
  try {
    if (!fs.existsSync(root)) return []
    const manifests = []
    const seenAppids = new Map() // appid -> index in manifests
    for (const { folder, name } of iterateGameFolders(root)) {
      const manifestPath = path.join(folder, INSTALLED_MANIFEST)
      const manifest = readJsonFile(manifestPath)
      if (manifest && manifest.appid) {
        if (!seenAppids.has(manifest.appid)) {
          seenAppids.set(manifest.appid, manifests.length)
          manifests.push(manifest)
        } else {
          // Replace if the new manifest has richer metadata
          const idx = seenAppids.get(manifest.appid)
          if (manifestRichness(manifest) > manifestRichness(manifests[idx])) {
            manifests[idx] = manifest
          }
        }
        continue
      }
      if (allowFallback) {
        const files = fs.readdirSync(folder).filter((f) => f !== INSTALLED_MANIFEST)
        if (files.length && !seenAppids.has(name)) {
          seenAppids.set(name, manifests.length)
          manifests.push({ appid: name, name: name, files: files.map((f) => ({ name: f })) })
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
  } catch { }
  try {
    const root = getDownloadRoot()
    if (root) roots.add(root)
  } catch { }
  try {
    const disks = listDisks()
    for (const disk of disks) {
      if (disk && disk.path) {
        roots.add(path.join(disk.path, downloadDirName))
      }
    }
  } catch { }
  return Array.from(roots).filter((root) => root && fs.existsSync(root))
}

function deleteFolderByAppId(root, appid) {
  try {
    if (!root || !appid || !fs.existsSync(root)) return false
    for (const { folder, name } of iterateGameFolders(root)) {
      const manifestPath = path.join(folder, INSTALLED_MANIFEST)
      const manifest = readJsonFile(manifestPath)
      const match = (manifest && manifest.appid === appid) || name === appid
      if (!match) continue
      try {
        fs.rmSync(folder, { recursive: true, force: true })
      } catch (e) { }
      return true
    }
  } catch (err) {
    console.error('[UC] deleteFolderByAppId failed', err)
  }
  return false
}

async function deleteFolderByAppIdAsync(root, appid) {
  try {
    if (!root || !appid || !fs.existsSync(root)) return false
    for (const { folder, name } of iterateGameFolders(root)) {
      const manifestPath = path.join(folder, INSTALLED_MANIFEST)
      const manifest = readJsonFile(manifestPath)
      const match = (manifest && manifest.appid === appid) || name === appid
      if (!match) continue
      try {
        await fs.promises.rm(folder, { recursive: true, force: true })
      } catch (e) { }
      return true
    }
  } catch (err) {
    console.error('[UC] deleteFolderByAppIdAsync failed', err)
  }
  return false
}

function findInstalledFolderByAppid(appid) {
  try {
    if (!appid) return null
    const roots = listDownloadRoots()
    for (const root of roots) {
      const installedRoot = path.join(root, installedDirName)
      for (const { folder, name } of iterateGameFolders(installedRoot)) {
        const manifestPath = path.join(folder, INSTALLED_MANIFEST)
        const manifest = readJsonFile(manifestPath)
        if (manifest && manifest.appid === appid) return folder
        if (name === appid) return folder
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
      for (const { folder, name } of iterateGameFolders(installingRoot)) {
        const manifestPath = path.join(folder, INSTALLED_MANIFEST)
        const manifest = readJsonFile(manifestPath)
        if (manifest && manifest.appid === appid) return folder
        if (name === appid) return folder
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

function isLinuxExecutableCandidate(entry, fullPath) {
  if (!entry || !entry.isFile || !entry.isFile()) return false
  const lower = entry.name.toLowerCase()
  if (lower.endsWith('.desktop')) return false
  if (lower.endsWith('.dll') || lower.endsWith('.so')) return false
  if (lower.endsWith('.appimage') || lower.endsWith('.sh') || lower.endsWith('.run') || lower.endsWith('.bin')) return true
  if (lower.endsWith('.x86_64') || lower.endsWith('.x86')) return true
  if (lower.endsWith('.exe')) return true
  try {
    fs.accessSync(fullPath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function listExecutables(rootDir, maxDepth, maxResults) {
  const results = []
  if (!rootDir || !fs.existsSync(rootDir)) return results
  const pending = [{ dir: rootDir, depth: 0 }]
  const visitedPaths = new Set()
  while (pending.length) {
    const current = pending.shift() // BFS: process shallowest directories first
    if (!current) continue
    let entries
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const fullPath = path.join(current.dir, entry.name)

      // Avoid revisiting paths (symlink loops, junctions)
      const normalizedPath = fullPath.toLowerCase()
      if (visitedPaths.has(normalizedPath)) continue
      visitedPaths.add(normalizedPath)

      // Follow symlinks and junctions (readdirSync withFileTypes reports them as symlinks, not dirs)
      const isDir = entry.isDirectory() || (entry.isSymbolicLink() && (() => { try { return fs.statSync(fullPath).isDirectory() } catch { return false } })())
      if (isDir) {
        // Skip known junk directories
        const dirLower = entry.name.toLowerCase()
        if (['_redist', '__redist', '_commonredist', 'directx', '$pluginsdir', '__support', 'mono', '.mono'].includes(dirLower)) continue
        if (current.depth < maxDepth) {
          pending.push({ dir: fullPath, depth: current.depth + 1 })
        }
        continue
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) continue

      const lowerName = entry.name.toLowerCase()
      const relative = path.relative(rootDir, fullPath)
      const depth = relative.split(/[\\/]/).length - 1
      let size = 0
      try {
        size = fs.statSync(fullPath).size
      } catch {
        size = 0
      }

      if (process.platform === 'win32') {
        if (lowerName.endsWith('.exe')) {
          results.push({ name: entry.name, path: fullPath, depth, size })
        }
        continue
      }
      if (isLinuxExecutableCandidate(entry, fullPath)) {
        results.push({ name: entry.name, path: fullPath, depth, size })
      }
    }
  }

  results.sort((a, b) => {
    const depthA = typeof a.depth === 'number' ? a.depth : 0
    const depthB = typeof b.depth === 'number' ? b.depth : 0
    if (depthA !== depthB) return depthA - depthB
    const sizeA = typeof a.size === 'number' ? a.size : 0
    const sizeB = typeof b.size === 'number' ? b.size : 0
    if (sizeA !== sizeB) return sizeB - sizeA
    return String(a.name).localeCompare(String(b.name))
  })

  return results.slice(0, Math.max(1, maxResults || 50))
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
    uc_log(`getMultipartSetInfo: basePath=${basePath} baseName=${baseName} expectedParts=${expectedParts}`)
    if (!fs.existsSync(installingRoot)) return null
    const entries = fs.readdirSync(installingRoot)
    uc_log(`getMultipartSetInfo: entries=${JSON.stringify(entries)}`)
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
    uc_log(`getMultipartSetInfo: partNumbers=${JSON.stringify(partNumbers)}`)
    if (!partNumbers.length || !partNumbers.includes(1)) return null
    partNumbers.sort((a, b) => a - b)
    const max = partNumbers[partNumbers.length - 1]
    const expectedTotal = Number.isFinite(expectedParts) && expectedParts > 0 ? expectedParts : null
    const totalExpected = expectedTotal || max
    if (!expectedTotal && max < 2) return { ready: false, basePath }
    for (let i = 1; i <= totalExpected; i++) {
      if (!partNumbers.includes(i)) {
        uc_log(`getMultipartSetInfo: part ${i} missing`)
        return { ready: false, basePath }
      }
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
  // Check Chromium active downloads (exclude paused ones)
  for (const entry of activeDownloads.values()) {
    if (entry && entry.item) {
      const isPaused = (typeof entry.item.isPaused === 'function' && entry.item.isPaused())
        || entry.item.getState?.() === 'interrupted'
      if (!isPaused) return true
    }
  }
  // Check UC Files active downloads (exclude paused ones)
  for (const entry of ucfilesActiveDownloads.values()) {
    if (entry && entry.state && !entry.state.paused) return true
  }
  // Only count non-stale pending entries
  const now = Date.now()
  return pendingDownloads.some((entry) => !entry._addedAt || (now - entry._addedAt) < 60000)
}

function hasActiveOrPendingDownloadsForApp(appid) {
  if (!appid) return false
  for (const entry of activeDownloads.values()) {
    if (entry && entry.appid === appid) return true
  }
  // Only count pending entries that are recent (< 60s old) to avoid stale entries blocking
  const now = Date.now()
  return pendingDownloads.some((entry) => {
    if (entry.appid !== appid) return false
    // If the pending entry has been sitting for more than 60s, it's stale - ignore it
    if (entry._addedAt && (now - entry._addedAt) > 60000) return false
    return true
  })
}

function hasActiveDownloadsForApp(appid) {
  return hasActiveOrPendingDownloadsForApp(appid) || hasQueuedDownloadsForApp(appid)
}

function hasPendingInGlobalQueueForApp(appid) {
  if (!appid) return false
  return globalDownloadQueue.some(entry => entry?.payload?.appid === appid)
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

async function visitPixeldrainViewerPage(fileId) {
  // Visit the /u/{id} page to register a view and bypass hotlink protection
  const viewerUrl = `https://pixeldrain.com/u/${fileId}`
  try {
    const https = require('https')
    await new Promise((resolve, reject) => {
      const req = https.get(viewerUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Referer': 'https://pixeldrain.com/'
        }
      }, (res) => {
        // Just consume the response, we don't need the data
        res.on('data', () => { })
        res.on('end', () => {
          uc_log(`[Pixeldrain] Visited viewer page for ${fileId} to bypass hotlink protection (status: ${res.statusCode})`)
          resolve()
        })
      })
      req.on('error', (err) => {
        uc_log(`[Pixeldrain] Failed to visit viewer page: ${err.message}`)
        resolve() // Don't reject, just continue with download attempt
      })
      req.setTimeout(5000, () => {
        req.destroy()
        resolve()
      })
    })
  } catch (err) {
    uc_log(`[Pixeldrain] Error visiting viewer page: ${err.message}`)
  }
}

// ── UC.Files parallel range download engine ──
// Downloads a UC.Files /dl/ URL using multiple concurrent HTTP connections
// with Range headers to multiply throughput (Telegram CDN serves ~5-20 MB/s per connection).

const UCFILES_CONNECTIONS = 4
const UCFILES_CHUNK_SIZE = 20 * 1024 * 1024 // 20 MB per range chunk

// HTTP/1.1 Range request using Node.js networking (not Chromium's fetch).
// Chromium's fetch multiplexes concurrent requests over a single HTTP/2 connection,
// which can intermittently deliver data frames to the wrong response stream under load,
// causing silent data corruption (correct byte count, wrong content).
// Node.js https creates independent TCP connections per request, eliminating this.
function ucfilesRangeRequest(url, start, end, signal) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const mod = parsed.protocol === 'https:' ? https : http
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { Range: `bytes=${start}-${end}`, Connection: 'close' },
      agent: false, // Disable keep-alive - fresh TCP connection per range to prevent stale data corruption
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        ucfilesRangeRequest(res.headers.location, start, end, signal).then(resolve, reject)
        return
      }
      resolve({ statusCode: res.statusCode, headers: res.headers, stream: res })
    })
    req.on('error', (err) => {
      if (signal?.aborted) reject(new Error('Aborted'))
      else reject(err)
    })
    if (signal) {
      if (signal.aborted) { req.destroy(); reject(new Error('Aborted')); return }
      const onAbort = () => req.destroy()
      signal.addEventListener('abort', onAbort, { once: true })
      req.on('close', () => signal.removeEventListener('abort', onAbort))
    }
    req.end()
  })
}

/** Map<downloadId, { abort: AbortController, state: { paused: boolean, pauseResolvers: Function[] } }> */
const ucfilesActiveDownloads = new Map()

function isUCFilesHostName(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')

  if (!normalized) return false
  if (normalized === 'files.union-crax.xyz' || normalized === 'ucfiles' || normalized === 'uc.files') {
    return true
  }
  return normalized.startsWith('files') && normalized.endsWith('.union-crax.xyz')
}

function isUCFilesUrl(url) {
  try {
    return typeof url === 'string' && isUCFilesHostName(new URL(url).hostname)
  } catch { return false }
}

/**
 * Re-read downloaded chunks from disk and compare SHA-256 against the hashes
 * computed during download. Returns array of chunk indices that don't match
 * (i.e. bytes on disk differ from bytes received over the network).
 */
function verifyChunkHashes(filePath, chunks) {
  const READ_BUF_SIZE = 4 * 1024 * 1024 // 4 MB
  const readBuf = Buffer.alloc(READ_BUF_SIZE)
  const verifyFd = fs.openSync(filePath, 'r')
  const bad = []
  try {
    for (let i = 0; i < chunks.length; i++) {
      if (!chunks[i].sha256) continue
      const c = chunks[i]
      const hasher = crypto.createHash('sha256')
      let pos = c.start
      let left = c.end - c.start + 1
      while (left > 0) {
        const n = fs.readSync(verifyFd, readBuf, 0, Math.min(readBuf.length, left), pos)
        if (n === 0) break
        hasher.update(readBuf.subarray(0, n))
        pos += n
        left -= n
      }
      if (hasher.digest('hex') !== c.sha256) bad.push(i)
    }
  } finally {
    fs.closeSync(verifyFd)
  }
  return bad
}

async function ucfilesParallelDownload(win, payload, _retryCount = 0) {
  const { url, downloadId, filename, appid, gameName, partIndex, partTotal } = payload
  const downloadRoot = ensureDownloadDir()
  const gameFolder = safeFolderName(gameName || appid || downloadId)
  const installingRoot = ensureSubdir(path.join(downloadRoot, installingDirName), gameFolder)
  const savePath = payload.savePath || path.join(installingRoot, filename || 'download')

  const ctrl = new AbortController()
  const state = { paused: false, pauseResolvers: [] }
  ucfilesActiveDownloads.set(downloadId, { abort: ctrl, state })

  // Unblock paused workers on abort so they exit cleanly instead of hanging
  ctrl.signal.addEventListener('abort', () => {
    state.pauseResolvers.splice(0).forEach(r => r())
  }, { once: true })

  // finalSavePath is determined after HEAD (may get filename from Content-Disposition)
  let resolvedSavePath = savePath

  const sendUpdate = (data) => {
    sendDownloadUpdate(win, {
      downloadId, appid: appid || null, gameName: gameName || null, url,
      filename: path.basename(resolvedSavePath), savePath: resolvedSavePath,
      partIndex, partTotal,
      resumeData: null,
      ...data,
    })
  }

  let fd = null
  let progressInterval = null
  try {
    // 1. HEAD request to get total size (with retry on transient server errors)
    // cache: 'no-store' prevents Chromium's networking stack from caching/reusing responses
    let headRes
    for (let headAttempt = 0; headAttempt < 3; headAttempt++) {
      headRes = await fetch(url, { method: 'HEAD', signal: ctrl.signal, redirect: 'follow', cache: 'no-store' })
      if (headRes.ok || headRes.status < 500) break
      ucLog(`[UC.Files] HEAD attempt ${headAttempt + 1}/3 failed: ${headRes.status} ${headRes.statusText}, retrying in 3s...`, 'warn')
      await new Promise(r => setTimeout(r, 3000))
    }
    if (!headRes.ok) {
      throw new Error(`HEAD failed: ${headRes.status} ${headRes.statusText}`)
    }
    const totalBytes = parseInt(headRes.headers.get('content-length') || '0', 10)
    const acceptsRanges = (headRes.headers.get('accept-ranges') || '').toLowerCase().includes('bytes')
    const expectedSHA256 = (headRes.headers.get('x-file-sha256') || '').toLowerCase().trim() || null
    if (expectedSHA256) ucLog(`[UC.Files] Server hash: ${expectedSHA256}`)

    if (!totalBytes || !acceptsRanges) {
      // Fallback: single-connection download (server doesn't support ranges or unknown size)
      ucfilesActiveDownloads.delete(downloadId)
      return null // signal caller to use default Chromium downloader
    }

    // Derive filename from Content-Disposition if we don't have one
    let finalFilename = filename
    if (!finalFilename) {
      const cd = headRes.headers.get('content-disposition') || ''
      const m = cd.match(/filename\*?=(?:UTF-8''|"?)([^";]+)"?/i)
      if (m?.[1]) finalFilename = decodeURIComponent(m[1])
    }
    if (!finalFilename) finalFilename = 'download'
    const finalSavePath = payload.savePath || path.join(installingRoot, finalFilename)
    resolvedSavePath = finalSavePath

    sendUpdate({ status: 'downloading', receivedBytes: 0, totalBytes, speedBps: 0, etaSeconds: null })

    // 2. Build chunk list
    const chunks = []
    for (let offset = 0; offset < totalBytes; offset += UCFILES_CHUNK_SIZE) {
      const end = Math.min(offset + UCFILES_CHUNK_SIZE - 1, totalBytes - 1)
      chunks.push({ start: offset, end, done: false })
    }

    // 3. Pre-allocate output file
    fd = fs.openSync(finalSavePath, 'w')
    fs.ftruncateSync(fd, totalBytes)

    // 4. Progress tracking
    let totalReceived = 0
    let lastProgressTime = Date.now()
    let lastProgressBytes = 0
    let smoothSpeed = 0

    let pausedUpdateSent = false
    const reportProgress = () => {
      if (state.paused) {
        // When paused, send one update then go silent until resumed
        if (!pausedUpdateSent) {
          pausedUpdateSent = true
          smoothSpeed = 0
          sendUpdate({ status: 'paused', receivedBytes: totalReceived, totalBytes, speedBps: 0, etaSeconds: null })
        }
        return
      }
      pausedUpdateSent = false
      const now = Date.now()
      const dt = Math.max(0.001, (now - lastProgressTime) / 1000)
      const db = totalReceived - lastProgressBytes
      const instantSpeed = db / dt
      smoothSpeed = smoothSpeed > 0 ? smoothSpeed * 0.7 + instantSpeed * 0.3 : instantSpeed
      lastProgressTime = now
      lastProgressBytes = totalReceived
      const remaining = Math.max(0, totalBytes - totalReceived)
      const finalSpeed = (totalReceived >= totalBytes) ? 0 : smoothSpeed
      const etaSeconds = finalSpeed > 0 && remaining > 0 ? remaining / finalSpeed : null
      sendUpdate({
        status: 'downloading',
        receivedBytes: totalReceived,
        totalBytes,
        speedBps: finalSpeed,
        etaSeconds,
      })
    }

    progressInterval = setInterval(reportProgress, 500)
    const MAX_CHUNK_RETRIES = 3

    // 5. Worker: download one chunk with retry on short/broken reads
    // Uses Node.js https (HTTP/1.1, independent TCP connections) instead of
    // Chromium's fetch (HTTP/2 multiplexed) to prevent data corruption.
    const downloadChunk = async (chunk) => {
      const chunkHasher = crypto.createHash('sha256')
      const expectedBytes = chunk.end - chunk.start + 1
      const chunkLimit = chunk.end + 1 // exclusive upper bound
      let offset = chunk.start
      let retries = 0

      // Outer loop: re-request from current offset on short reads or stream errors
      while (offset < chunkLimit) {
        while (state.paused) {
          await new Promise(resolve => { state.pauseResolvers.push(resolve) })
        }
        if (ctrl.signal.aborted) return

        const rangeEnd = chunk.end
        const { statusCode, headers, stream } = await ucfilesRangeRequest(url, offset, rangeEnd, ctrl.signal)

        // Strict status validation: MUST be 206 for range requests
        if (statusCode !== 206) {
          stream.resume() // drain
          throw new Error(`Expected 206 Partial Content, got ${statusCode} for range ${offset}-${rangeEnd}`)
        }

        // Validate Content-Range header matches our request
        const contentRange = headers['content-range'] || ''
        const crMatch = contentRange.match(/bytes (\d+)-(\d+)\/(\d+)/)
        if (crMatch) {
          const actualStart = parseInt(crMatch[1], 10)
          const actualEnd = parseInt(crMatch[2], 10)
          if (actualStart !== offset || actualEnd !== rangeEnd) {
            stream.destroy()
            throw new Error(`Content-Range mismatch: requested ${offset}-${rangeEnd}, got ${actualStart}-${actualEnd}`)
          }
        }

        // Validate Content-Length matches expected range size
        const expectedRangeBytes = rangeEnd - offset + 1
        const clHeader = parseInt(headers['content-length'] || '0', 10)
        if (clHeader > 0 && clHeader !== expectedRangeBytes) {
          stream.destroy()
          throw new Error(`Content-Length mismatch: expected ${expectedRangeBytes}, got ${clHeader} for range ${offset}-${rangeEnd}`)
        }

        let chunkBytesWritten = 0
        try {
          for await (const value of stream) {
            while (state.paused) {
              await new Promise(resolve => { state.pauseResolvers.push(resolve) })
            }
            if (ctrl.signal.aborted) return

            const buf = Buffer.isBuffer(value) ? value : Buffer.from(value)
            // Cap write to never overflow past this chunk's boundary
            const remaining = chunkLimit - offset
            const writeLen = Math.min(buf.length, remaining)
            if (writeLen > 0) {
              // Check abort before write - fd may have been invalidated by another worker's failure
              if (ctrl.signal.aborted) return
              fs.writeSync(fd, buf, 0, writeLen, offset)
              chunkHasher.update(buf.subarray(0, writeLen))
              offset += writeLen
              totalReceived += writeLen
              chunkBytesWritten += writeLen
            }
            if (offset >= chunkLimit) break
          }
        } catch (streamErr) {
          if (ctrl.signal.aborted) return
          ucLog(`[UC.Files] Stream error in chunk ${chunk.start}-${chunk.end} at offset ${offset}: ${streamErr.message}`, 'warn')
        }

        // If we haven't received all bytes, retry from current offset
        if (offset < chunkLimit) {
          retries++
          if (retries > MAX_CHUNK_RETRIES) {
            throw new Error(`Chunk ${chunk.start}-${chunk.end}: only received ${offset - chunk.start}/${expectedBytes} bytes after ${MAX_CHUNK_RETRIES} retries`)
          }
          ucLog(`[UC.Files] Chunk ${chunk.start}-${chunk.end}: short read (${offset - chunk.start}/${expectedBytes} bytes), retry ${retries}/${MAX_CHUNK_RETRIES} from offset ${offset}`)
        }
      }
      chunk.done = true
      chunk.sha256 = chunkHasher.digest('hex')
    }

    // 6. Run workers in parallel (pool of UCFILES_CONNECTIONS)
    // Each worker catches errors internally and aborts others, so we can
    // safely wait for ALL workers to finish before closing the file descriptor.
    let chunkIndex = 0
    let firstWorkerError = null
    const workers = []
    for (let i = 0; i < Math.min(UCFILES_CONNECTIONS, chunks.length); i++) {
      workers.push((async () => {
        try {
          while (chunkIndex < chunks.length) {
            if (ctrl.signal.aborted) return
            const ci = chunkIndex++
            if (ci >= chunks.length) return
            await downloadChunk(chunks[ci])
          }
        } catch (workerErr) {
          if (!firstWorkerError) firstWorkerError = workerErr
          ctrl.abort() // Signal all other workers to stop immediately
        }
      })())
    }

    await Promise.allSettled(workers) // Wait for ALL workers to exit before touching fd
    clearInterval(progressInterval)
    // Flush all writes to disk before closing
    try { fs.fsyncSync(fd) } catch { }
    try { fs.closeSync(fd) } catch { }
    fd = null

    // If a worker error occurred, throw it now (fd is safely closed)
    if (firstWorkerError) {
      throw firstWorkerError
    }

    if (ctrl.signal.aborted) {
      ucfilesActiveDownloads.delete(downloadId)
      return { ok: false, cancelled: true }
    }

    // Verify file integrity: actual size on disk must match expected
    try {
      const stat = fs.statSync(finalSavePath)
      if (stat.size !== totalBytes) {
        throw new Error(`File size mismatch: expected ${totalBytes}, got ${stat.size}`)
      }
    } catch (verifyErr) {
      if (verifyErr.message.includes('File size mismatch')) throw verifyErr
      // stat failed - file might have been deleted, let post-handler deal with it
    }

    // Compute SHA-256 of the downloaded file and compare against server hash
    let downloadSHA256 = null
    let fileVerifiedByHash = false
    try {
      const fileHash = crypto.createHash('sha256')
      const hashStream = fs.createReadStream(finalSavePath)
      await new Promise((resolve, reject) => {
        hashStream.on('data', (chunk) => fileHash.update(chunk))
        hashStream.on('end', resolve)
        hashStream.on('error', reject)
      })
      downloadSHA256 = fileHash.digest('hex')
      ucLog(`[UC.Files] Download SHA-256: ${downloadSHA256} | ${path.basename(finalSavePath)} (${totalBytes} bytes)`)
    } catch (hashErr) {
      ucLog(`[UC.Files] SHA-256 computation failed: ${hashErr.message}`, 'warn')
    }

    // If the server provided its known-good hash, compare - verifies ALL file types
    if (expectedSHA256 && downloadSHA256) {
      if (downloadSHA256 === expectedSHA256) {
        ucLog('[UC.Files] SHA-256 matches server hash - file integrity confirmed, skipping archive test')
        fileVerifiedByHash = true
      } else {
        ucLog(`[UC.Files] SHA-256 MISMATCH! Server: ${expectedSHA256}, Downloaded: ${downloadSHA256}`, 'error')
      }
    }

    // 7. Verify chunk write integrity: re-read each chunk from disk and compare
    //    SHA-256 against the hash computed during download. Detects OS/filesystem
    //    write corruption (bytes received correctly but written incorrectly).
    //    Skipped when the whole-file hash already matches the server.
    if (!fileVerifiedByHash) {
      ucLog('[UC.Files] Verifying chunk write integrity...')
      sendUpdate({ status: 'verifying', receivedBytes: totalBytes, totalBytes, speedBps: 0, etaSeconds: null })
      const badChunks = verifyChunkHashes(finalSavePath, chunks)
      if (badChunks.length > 0) {
        ucLog(`[UC.Files] WRITE CORRUPTION: ${badChunks.length}/${chunks.length} chunks differ on disk! Indices: [${badChunks.join(', ')}]`, 'error')
        for (const ci of badChunks) {
          const c = chunks[ci]
          ucLog(`[UC.Files]   Chunk ${ci}: bytes ${c.start}-${c.end} (${c.end - c.start + 1} bytes)`, 'error')
        }
      } else {
        ucLog(`[UC.Files] All ${chunks.length} chunks verified - disk matches network bytes`)
      }
    }

    // 8. Archive integrity test: run `7z t` to validate the archive before extraction.
    //    This catches ALL corruption sources (server, network, write) regardless of
    //    whether the per-chunk hashes matched - the server could have sent wrong bytes.
    //    Skipped when the whole-file hash already matches the server.
    const archiveExt = path.extname(finalSavePath).toLowerCase()
    const isDownloadedArchive = ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.tgz'].includes(archiveExt)
    if (!fileVerifiedByHash && isDownloadedArchive) {
      ucLog('[UC.Files] Testing archive integrity with 7z...')
      const testResult = await run7zTest(finalSavePath)
      if (!testResult.ok) {
        ucLog(`[UC.Files] Archive FAILED integrity test: ${testResult.error}`, 'error')

        // --- Smart chunk-level repair ---
        // Instead of deleting the entire file and re-downloading ~1 GB, re-fetch
        // each chunk individually and compare its hash against the original.
        // Chunks whose hash differs were served corrupt data by the CDN; overwrite
        // only those chunks and re-test the archive.  This typically saves 90%+ of
        // the bandwidth compared to a full re-download.
        if (_retryCount < 2) {
          ucLog(`[UC.Files] Starting targeted chunk repair (attempt ${_retryCount + 1}/3)...`)
          sendUpdate({ status: 'retrying', receivedBytes: totalBytes, totalBytes, speedBps: 0, etaSeconds: null, error: `Verification failed - repairing corrupt chunks (attempt ${_retryCount + 1}/3)` })
          // Brief delay - gives CDN caches a moment to rotate
          await new Promise(r => setTimeout(r, 3000))

          let patchedCount = 0
          const repairFd = fs.openSync(finalSavePath, 'r+')
          try {
            for (let ci = 0; ci < chunks.length; ci++) {
              const chunk = chunks[ci]
              if (!chunk.sha256) continue
              const chunkBytes = chunk.end - chunk.start + 1

              // Re-download the full chunk into memory and compute hash
              let freshBuf = Buffer.alloc(chunkBytes)
              let freshOffset = 0
              let freshRetries = 0
              const freshHasher = crypto.createHash('sha256')
              while (freshOffset < chunkBytes) {
                try {
                  const { statusCode, stream } = await ucfilesRangeRequest(
                    url, chunk.start + freshOffset, chunk.end, ctrl.signal)
                  if (statusCode !== 206) { stream.resume(); break }
                  for await (const data of stream) {
                    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
                    const copyLen = Math.min(buf.length, chunkBytes - freshOffset)
                    buf.copy(freshBuf, freshOffset, 0, copyLen)
                    freshHasher.update(buf.subarray(0, copyLen))
                    freshOffset += copyLen
                    if (freshOffset >= chunkBytes) break
                  }
                } catch (e) {
                  if (ctrl.signal.aborted) break
                  freshRetries++
                  if (freshRetries > 3) break
                }
              }
              if (freshOffset < chunkBytes) {
                ucLog(`[UC.Files] Chunk repair: chunk ${ci} re-download incomplete (${freshOffset}/${chunkBytes}), skipping`, 'warn')
                continue
              }

              const freshHash = freshHasher.digest('hex')
              if (freshHash !== chunk.sha256) {
                // The fresh download differs from the original - the original was corrupt.
                // Overwrite with the fresh (hopefully correct) data.
                ucLog(`[UC.Files] Chunk ${ci} (${chunk.start}-${chunk.end}): hash CHANGED - patching disk`)
                fs.writeSync(repairFd, freshBuf, 0, chunkBytes, chunk.start)
                chunk.sha256 = freshHash
                patchedCount++
              }
              // Report progress: show which chunk we're verifying
              sendUpdate({ status: 'retrying', receivedBytes: totalBytes, totalBytes, speedBps: 0, etaSeconds: null,
                error: `Repairing chunks: ${ci + 1}/${chunks.length} checked, ${patchedCount} patched` })
            }
          } finally {
            try { fs.fsyncSync(repairFd) } catch {}
            try { fs.closeSync(repairFd) } catch {}
          }

          if (patchedCount > 0) {
            ucLog(`[UC.Files] Chunk repair: patched ${patchedCount}/${chunks.length} chunks - re-testing archive`)
            const reTestResult = await run7zTest(finalSavePath)
            if (reTestResult.ok) {
              ucLog('[UC.Files] Archive integrity test PASSED after chunk repair')
              // Fall through to the success path below
            } else {
              ucLog(`[UC.Files] Archive STILL corrupt after chunk repair: ${reTestResult.error}`, 'error')
              // Fall back to full re-download for the next attempt
              sendUpdate({ status: 'retrying', receivedBytes: 0, totalBytes: 0, speedBps: 0, etaSeconds: null,
                error: `Chunk repair failed - full re-download (attempt ${_retryCount + 1}/3)` })
              try { fs.unlinkSync(finalSavePath) } catch {}
              ucfilesActiveDownloads.delete(downloadId)
              await new Promise(r => setTimeout(r, 3000))
              return ucfilesParallelDownload(win, payload, _retryCount + 1)
            }
          } else {
            // No chunks changed - the CDN served the same (corrupt) data again.
            // Fall back to full re-download which creates fresh TCP connections.
            ucLog('[UC.Files] Chunk repair: no chunks changed - CDN is consistently corrupt, full re-download')
            sendUpdate({ status: 'retrying', receivedBytes: 0, totalBytes: 0, speedBps: 0, etaSeconds: null,
              error: `Same corrupt data from server - full re-download (attempt ${_retryCount + 1}/3)` })
            try { fs.unlinkSync(finalSavePath) } catch {}
            ucfilesActiveDownloads.delete(downloadId)
            await new Promise(r => setTimeout(r, 3000))
            return ucfilesParallelDownload(win, payload, _retryCount + 1)
          }
        } else {
          sendUpdate({ status: 'failed', receivedBytes: 0, totalBytes: 0, speedBps: 0, etaSeconds: null, error: `Archive corrupt after ${_retryCount + 1} download attempts. The file on the server may be damaged.` })
          throw new Error(`Archive corrupt after ${_retryCount + 1} download attempts. The file on the server may be damaged.`)
        }
      }
      if (testResult.ok) ucLog('[UC.Files] Archive integrity test PASSED')
    }

    // 9. Done - mimic the will-download 'done' event flow
    totalReceived = totalBytes
    reportProgress()

    ucfilesActiveDownloads.delete(downloadId)

    // Trigger extraction / completion like the normal Chromium download path
    sendUpdate({ status: 'completed', receivedBytes: totalBytes, totalBytes, speedBps: 0, etaSeconds: null })

    // Run the post-download handler (extract archive, move to installed, etc.)
    await handleUCFilesDownloadComplete(win, {
      downloadId, savePath: finalSavePath, appid, gameName, url, partIndex, partTotal,
    })

    return { ok: true }
  } catch (err) {
    // Always close the file descriptor on error/cancel
    if (fd !== null) { try { fs.closeSync(fd) } catch { } }
    clearInterval(progressInterval)
    ucfilesActiveDownloads.delete(downloadId)
    if (ctrl.signal.aborted) return { ok: false, cancelled: true }
    const errMsg = (err && err.message) || String(err) || 'Unknown download error'
    ucLog(`[UC.Files] Parallel download error: ${errMsg}`, 'error')
    sendUpdate({ status: 'failed', error: errMsg, receivedBytes: 0, totalBytes: 0, speedBps: 0, etaSeconds: null })
    return { ok: false, error: errMsg }
  }
}

async function handleUCFilesDownloadComplete(win, info) {
  const { downloadId, savePath, appid, gameName, url, partIndex, partTotal } = info
  const downloadRoot = ensureDownloadDir()
  const folderName = safeFolderName(gameName || appid || downloadId)
  const installingRoot = path.join(downloadRoot, installingDirName, folderName)
  const installedRoot = ensureSubdir(path.join(downloadRoot, installedDirName), folderName)
  const metadataForInstall = getInstallingMetadata(installingRoot, installedRoot, appid, gameName)

  const ext = path.extname(savePath).toLowerCase()
  const isArchive = ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.tgz'].includes(ext)

  const makeUpdate = (extra) => ({
    downloadId, filename: path.basename(savePath), savePath,
    appid: appid || null, gameName: gameName || null, url,
    receivedBytes: 0, totalBytes: 0, speedBps: 0, etaSeconds: null,
    partIndex, partTotal, resumeData: null,
    ...extra,
  })

  if (isArchive) {
    try {
      // Migrate cached metadata images (splash, screenshots) from installing → installed BEFORE extraction
      // The renderer's saveInstalledMetadata call caches them into installingRoot earlier
      try {
        migrateInstallingExtras(installingRoot, installedRoot, new Set([path.basename(savePath)]))
      } catch (migErr) {
        ucLog(`[UC.Files] migrateInstallingExtras warning: ${migErr.message}`, 'warn')
      }

      sendDownloadUpdate(win, makeUpdate({ status: 'extracting' }))
      const result = await run7zExtract(savePath, installedRoot, ({ percent }) => {
        sendDownloadUpdate(win, makeUpdate({ status: 'extracting', extractProgress: percent }))
      })
      if (!result.ok) throw new Error(result.error || 'Extraction failed')
      // Remove the archive after extraction
      try { fs.unlinkSync(savePath) } catch { }
      // Clean up installing folder
      try {
        if (fs.existsSync(installingRoot)) fs.rmSync(installingRoot, { recursive: true, force: true })
      } catch { }
      // Update manifest
      updateInstalledManifest(installedRoot, metadataForInstall, null)
      sendDownloadUpdate(win, makeUpdate({ status: 'completed', savePath: installedRoot }))
    } catch (err) {
      ucLog(`[UC.Files] Extraction failed: ${err.message}`, 'error')
      sendDownloadUpdate(win, makeUpdate({ status: 'failed', error: `Extraction failed: ${err.message}` }))
    }
  } else {
    // Non-archive: move to installed folder
    const destPath = path.join(installedRoot, path.basename(savePath))
    try {
      try { fs.renameSync(savePath, destPath) } catch {
        fs.copyFileSync(savePath, destPath); try { fs.unlinkSync(savePath) } catch { }
      }
      migrateInstallingExtras(installingRoot, installedRoot, new Set([path.basename(destPath)]))
      try {
        if (fs.existsSync(installingRoot)) fs.rmSync(installingRoot, { recursive: true, force: true })
      } catch { }
      // Update manifest with file entry
      const stats = fs.existsSync(destPath) ? fs.statSync(destPath) : null
      updateInstalledManifest(installedRoot, metadataForInstall, {
        path: destPath, name: path.basename(destPath),
        size: stats ? stats.size : 0, addedAt: Date.now(),
      })
      sendDownloadUpdate(win, makeUpdate({ status: 'completed', filename: path.basename(destPath), savePath: destPath }))
    } catch (err) {
      ucLog(`[UC.Files] Post-download move failed: ${err.message}`, 'error')
      sendDownloadUpdate(win, makeUpdate({ status: 'failed', error: err.message }))
    }
  }
  startNextQueuedDownload(appid)
}

async function startDownloadNow(win, payload) {
  if (!win || win.isDestroyed()) return { ok: false }

  // Defensive coerce: renderer may pass a DownloadHostEntry object ({url, part})
  // instead of a plain string when running an old build against the new API format.
  if (payload && payload.url && typeof payload.url !== 'string') {
    const extracted = (payload.url && typeof payload.url.url === 'string') ? payload.url.url : String(payload.url)
    ucLog(`startDownloadNow: coercing non-string url to string (was ${typeof payload.url})`, 'warn')
    payload = { ...payload, url: extracted }
  }

  if (!payload || typeof payload.url !== 'string' || !payload.url) {
    ucLog(`startDownloadNow: invalid url in payload`, 'warn')
    return { ok: false, error: 'invalid-url' }
  }

  // If this download was already cancelled (e.g. by user during pixeldrain delay), bail out
  if (cancelledDownloadIds.has(payload.downloadId)) {
    ucLog(`startDownloadNow: skipping cancelled download ${payload.downloadId}`)
    return { ok: false, cancelled: true }
  }

  // Add to pendingDownloads FIRST to prevent race conditions
  pendingDownloads.push({
    url: payload.url,
    normalizedUrl: normalizeDownloadUrl(payload.url),
    downloadId: payload.downloadId,
    filename: payload.filename,
    appid: payload.appid,
    gameName: payload.gameName,
    partIndex: payload.partIndex,
    partTotal: payload.partTotal,
    authHeader: payload.authHeader,
    savePath: payload.savePath,
    _addedAt: Date.now()
  })

  // Check if this is a pixeldrain URL and if we need to delay
  const isPixeldrain = payload.url && payload.url.includes('pixeldrain.com')
  const hasAuth = Boolean(payload.authHeader)

  if (isPixeldrain) {
    // Register auth header for the onBeforeSendHeaders interceptor
    if (hasAuth) {
      const fileId = extractPixeldrainFileIdFromUrl(payload.url)
      if (fileId) {
        pixeldrainAuthHeaders.set(fileId, payload.authHeader)
      }
    }

    if (!hasAuth) {
      // Unauthenticated: apply delay and visit viewer page (existing behavior)
      const timeSinceLastPixeldrain = Date.now() - lastPixeldrainDownloadTime
      if (timeSinceLastPixeldrain < PIXELDRAIN_DELAY_MS) {
        // Need to delay this download
        const delayNeeded = PIXELDRAIN_DELAY_MS - timeSinceLastPixeldrain
        uc_log(`Delaying pixeldrain download by ${delayNeeded}ms to avoid rate limiting`)
        setTimeout(() => {
          // Remove from pending before re-adding to avoid duplicates
          const idx = pendingDownloads.findIndex(p => p.downloadId === payload.downloadId)
          if (idx >= 0) pendingDownloads.splice(idx, 1)
          // Check if cancelled during the delay
          if (cancelledDownloadIds.has(payload.downloadId)) {
            ucLog(`Pixeldrain delayed download was cancelled: ${payload.downloadId}`)
            return
          }
          startDownloadNow(win, payload)
        }, delayNeeded)
        return { ok: true, delayed: true }
      }

      // Extract file ID and visit viewer page to bypass hotlink protection
      const fileId = extractPixeldrainFileIdFromUrl(payload.url)
      if (fileId) {
        await visitPixeldrainViewerPage(fileId)
        // Small delay after visiting to ensure view is registered
        await new Promise(resolve => setTimeout(resolve, 500))
      }

      lastPixeldrainDownloadTime = Date.now()
    } else {
      // Authenticated: skip viewer page visit and delay entirely
      uc_log(`Pixeldrain download authenticated - skipping viewer page visit and delay`)
    }
  }

  // UC.Files parallel download engine - bypass Chromium single-connection downloader
  if (isUCFilesUrl(payload.url)) {
    uc_log(`startDownloadNow: using UC.Files parallel engine - downloadId=${payload.downloadId}`)
    // Remove from pending since we're handling it directly (won't hit will-download)
    const pendIdx = pendingDownloads.findIndex(p => p.downloadId === payload.downloadId)
    if (pendIdx >= 0) pendingDownloads.splice(pendIdx, 1)

    // Immediately notify the renderer that this download is active, before the async
    // parallel download starts. Without this, the renderer sees the item as still "queued"
    // and may call startNextQueuedPart again, causing a double-resolve.
    sendDownloadUpdate(win, {
      downloadId: payload.downloadId,
      status: 'downloading',
      receivedBytes: 0,
      totalBytes: 0,
      speedBps: 0,
      etaSeconds: null,
      filename: payload.filename || null,
      savePath: null,
      appid: payload.appid || null,
      gameName: payload.gameName || null,
      url: payload.url,
      partIndex: payload.partIndex,
      partTotal: payload.partTotal,
      resumeData: null,
    })

    ucfilesParallelDownload(win, payload).then(result => {
      if (!result) {
        // Fallback: server didn't support ranges, use Chromium
        uc_log(`[UC.Files] Range not supported, falling back to Chromium downloader`)
        pendingDownloads.push({
          url: payload.url, normalizedUrl: normalizeDownloadUrl(payload.url),
          downloadId: payload.downloadId, filename: payload.filename,
          appid: payload.appid, gameName: payload.gameName,
          partIndex: payload.partIndex, partTotal: payload.partTotal,
          authHeader: payload.authHeader, savePath: payload.savePath,
          _addedAt: Date.now()
        })
        win.webContents.downloadURL(payload.url)
      }
    }).catch(err => {
      ucLog(`[UC.Files] Parallel download unexpected error: ${err.message}`, 'error')
    })
    return { ok: true }
  }

  uc_log(`startDownloadNow: calling downloadURL - downloadId=${payload.downloadId} url=${payload.url}`)
  win.webContents.downloadURL(payload.url)
  return { ok: true }
}

// Pause the currently-active download (if any), excluding `excludeId`.
// Returns the downloadId that was paused, or null.
function pauseActiveDownload(excludeId) {
  // Check UC Files downloads
  for (const [dlId, ucEntry] of ucfilesActiveDownloads) {
    if (dlId === excludeId) continue
    if (ucEntry && ucEntry.state && !ucEntry.state.paused) {
      ucEntry.state.paused = true
      ucLog(`[Queue] Auto-paused UC.Files download for swap: ${dlId}`)
      // Send paused update so both windows see the change
      const snap = latestDownloadState.get(dlId)
      sendDownloadUpdate(mainWindow, {
        downloadId: dlId,
        status: 'paused',
        receivedBytes: snap?.receivedBytes || 0,
        totalBytes: snap?.totalBytes || 0,
        speedBps: 0,
        etaSeconds: null,
        filename: snap?.filename || '',
        savePath: snap?.savePath || '',
        appid: snap?.appid || null,
        gameName: snap?.gameName || null,
        url: snap?.url || '',
        resumeData: null,
        partIndex: snap?.partIndex,
        partTotal: snap?.partTotal,
      })
      return dlId
    }
  }
  // Check Chromium downloads
  for (const [dlId, entry] of activeDownloads) {
    if (dlId === excludeId) continue
    if (!entry || !entry.item) continue
    const isPaused = (typeof entry.item.isPaused === 'function' && entry.item.isPaused())
      || entry.item.getState?.() === 'interrupted'
    if (!isPaused) {
      if (entry.speedLimitResumeTimer) {
        clearTimeout(entry.speedLimitResumeTimer)
        delete entry.speedLimitResumeTimer
      }
      entry.speedLimitPaused = false
      if (typeof entry.item.pause === 'function') entry.item.pause()
      ucLog(`[Queue] Auto-paused Chromium download for swap: ${dlId}`)
      sendDownloadUpdate(mainWindow, {
        downloadId: dlId,
        status: 'paused',
        receivedBytes: entry.item.getReceivedBytes(),
        totalBytes: entry.item.getTotalBytes(),
        speedBps: 0,
        etaSeconds: null,
        filename: path.basename(entry.savePath || ''),
        savePath: entry.savePath,
        appid: entry.appid || null,
        gameName: entry.gameName || null,
        url: entry.url,
        resumeData: buildResumeData(entry.item, entry.savePath),
        partIndex: entry.partIndex,
        partTotal: entry.partTotal,
      })
      return dlId
    }
  }
  return null
}

// Auto-resume the first paused download (called when nothing else is active/queued)
function autoResumeNextPaused() {
  // UC Files paused downloads first
  for (const [dlId, ucEntry] of ucfilesActiveDownloads) {
    if (ucEntry && ucEntry.state && ucEntry.state.paused) {
      ucEntry.state.paused = false
      for (const resolve of ucEntry.state.pauseResolvers) resolve()
      ucEntry.state.pauseResolvers = []
      ucLog(`[Queue] Auto-resumed paused UC.Files download: ${dlId}`)
      const snap = latestDownloadState.get(dlId)
      sendDownloadUpdate(mainWindow, {
        downloadId: dlId,
        status: 'downloading',
        receivedBytes: snap?.receivedBytes || 0,
        totalBytes: snap?.totalBytes || 0,
        speedBps: 0,
        etaSeconds: null,
        filename: snap?.filename || '',
        savePath: snap?.savePath || '',
        appid: snap?.appid || null,
        gameName: snap?.gameName || null,
        url: snap?.url || '',
        resumeData: null,
        partIndex: snap?.partIndex,
        partTotal: snap?.partTotal,
      })
      return true
    }
  }
  // Chromium paused downloads
  for (const [dlId, entry] of activeDownloads) {
    if (!entry || !entry.item) continue
    const isPaused = (typeof entry.item.isPaused === 'function' && entry.item.isPaused())
      || entry.item.getState?.() === 'interrupted'
    if (isPaused) {
      entry.speedLimitPaused = false
      if (entry.speedLimitResumeTimer) {
        clearTimeout(entry.speedLimitResumeTimer)
        delete entry.speedLimitResumeTimer
      }
      const nowMs = Date.now()
      entry.speedLimitWindow = { startTime: nowMs, startBytes: entry.item.getReceivedBytes() }
      entry.state.speedBps = 0
      if (typeof entry.item.resume === 'function') entry.item.resume()
      ucLog(`[Queue] Auto-resumed paused Chromium download: ${dlId}`)
      sendDownloadUpdate(mainWindow, {
        downloadId: dlId,
        status: 'downloading',
        receivedBytes: entry.item.getReceivedBytes(),
        totalBytes: entry.item.getTotalBytes(),
        speedBps: 0,
        etaSeconds: null,
        filename: path.basename(entry.savePath || ''),
        savePath: entry.savePath,
        appid: entry.appid || null,
        gameName: entry.gameName || null,
        url: entry.url,
        resumeData: buildResumeData(entry.item, entry.savePath),
        partIndex: entry.partIndex,
        partTotal: entry.partTotal,
      })
      return true
    }
  }
  return false
}

function startNextQueuedDownload(lastCompletedAppid) {
  uc_log(`=== startNextQueuedDownload ===`)
  uc_log(`lastCompletedAppid: ${lastCompletedAppid}`)
  uc_log(`hasAnyActiveOrPendingDownloads: ${hasAnyActiveOrPendingDownloads()}`)
  uc_log(`globalDownloadQueue.length: ${globalDownloadQueue.length}`)
  if (hasAnyActiveOrPendingDownloads()) return

  if (globalDownloadQueue.length) {
    // If we have a lastCompletedAppid, prioritize remaining parts of the same game
    // Note: findIndex is O(n) but typical queue sizes are small (< 20 items)
    let nextIndex = 0
    if (lastCompletedAppid) {
      // Find the next download for the same appid (multi-part downloads)
      nextIndex = globalDownloadQueue.findIndex(entry => entry?.payload?.appid === lastCompletedAppid)
      // If not found, default to first item (FIFO for different games)
      if (nextIndex === -1) nextIndex = 0
    }

    const next = globalDownloadQueue.splice(nextIndex, 1)[0]
    if (!next) return // Safety check in case queue was modified concurrently

    const win = getWindowByWebContentsId(next.webContentsId)
    if (!win || win.isDestroyed()) return
    startDownloadNow(win, next.payload)
    return
  }

  // No queued downloads - auto-resume the next paused download
  autoResumeNextPaused()
}

function isDownloadIdKnown(downloadId) {
  if (!downloadId) return false
  if (activeDownloads.has(downloadId)) return true
  const now = Date.now()
  if (pendingDownloads.some((entry) => entry.downloadId === downloadId && (!entry._addedAt || (now - entry._addedAt) < 30000))) return true
  for (const queue of downloadQueues.values()) {
    if (queue.some((entry) => entry.payload && entry.payload.downloadId === downloadId)) return true
  }
  if (globalDownloadQueue.some((entry) => entry.payload && entry.payload.downloadId === downloadId)) return true
  return false
}

function getKnownDownloadState(downloadId) {
  if (!downloadId) return null
  if (activeDownloads.has(downloadId)) return 'active'
  const now = Date.now()
  const pendingIdx = pendingDownloads.findIndex((entry) => entry.downloadId === downloadId)
  if (pendingIdx >= 0) {
    const entry = pendingDownloads[pendingIdx]
    // If pending entry is stale (>30s without will-download firing), clean it up
    if (entry._addedAt && (now - entry._addedAt) > 30000) {
      pendingDownloads.splice(pendingIdx, 1)
      ucLog(`Cleaned stale pending entry in getKnownDownloadState: ${downloadId}`)
      // Fall through to return null so the download can be retried
    } else {
      return 'pending'
    }
  }
  for (const queue of downloadQueues.values()) {
    if (queue.some((entry) => entry.payload && entry.payload.downloadId === downloadId)) return 'queued'
  }
  if (globalDownloadQueue.some((entry) => entry.payload && entry.payload.downloadId === downloadId)) return 'queued'
  return null
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
    } catch (e) { }
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
    } catch (e) { }
  }
  globalDownloadQueue.length = 0
  for (const entry of remaining) globalDownloadQueue.push(entry)
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
    // Linux/macOS: list home directory and common mount points
    const home = app.getPath('home')
    const candidates = [home, '/home', '/mnt', '/media']
    for (const root of candidates) {
      try {
        if (!fs.existsSync(root)) continue
        const stats = fs.statfsSync(root)
        const id = root === home ? 'home' : root.replace(/\//g, '_')
        const name = root === home ? 'Home' : root
        disks.push({
          id,
          name,
          path: root,
          totalBytes: stats.blocks * stats.bsize,
          freeBytes: stats.bavail * stats.bsize
        })
      } catch {
        // ignore inaccessible paths
      }
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
  } catch (e) { }
  return files
}
function resolve7zipBinary() {
  const candidates = []

  try {
    const seven = require('7zip-bin')
    let resolvedPath = seven.path7za || seven.path7z || seven.path7zip || ''

    if (resolvedPath) {
      // If packaged, the path might sit inside the ASAR; prefer the unpacked location.
      if (app.isPackaged && resolvedPath.includes('.asar')) {
        resolvedPath = resolvedPath.replace(/\.asar([\\/])/, `.asar.unpacked$1`)
        uc_log(`Adjusted 7zip path for packaged app: ${resolvedPath}`)
      }
      candidates.push(resolvedPath)
    }
  } catch (e) {
    uc_log(`7zip-bin not available, will try system 7z: ${String(e)}`)
  }

  // System fallbacks (most distros ship 7z or 7za via p7zip-full)
  if (process.platform === 'win32') {
    candidates.push('7z.exe', '7za.exe', '7z')
  } else {
    candidates.push('7z', '7za')
  }

  for (const candidate of candidates) {
    const looksLikePath = candidate.includes(path.sep) || candidate.includes('/') || candidate.includes('\\')
    if (looksLikePath) {
      if (fs.existsSync(candidate)) {
        uc_log(`7zip binary resolved to: ${candidate}`)
        return candidate
      }
      uc_log(`7zip candidate missing: ${candidate}`)
      continue
    }

    // Command without a path; assume it is available on PATH and let spawn handle failures.
    uc_log(`Using system 7zip command: ${candidate}`)
    return candidate
  }

  return null
}

function run7zExtract(archivePath, destDir, onProgress) {
  return new Promise((resolve) => {
    try {
      const cmd = resolve7zipBinary()
      if (!cmd) {
        const error = '7zip binary not found. Please install p7zip (7z) on this system or reinstall the app with bundled binaries.'
        uc_log(error)
        resolve({ ok: false, error })
        return
      }

      const before = snapshotFiles(destDir)
      const args = ['x', archivePath, `-o${destDir}`, '-y']
      uc_log(`spawning 7zip with command: ${cmd} ${args.join(' ')}`)

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
              } catch (e) { }
            }
          }
        } catch (e) { }
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
          const errorMsg = stderr || stdout || `7zip exited with code ${code}`
          uc_log(`7zip extraction failed: ${errorMsg}`)
          resolve({ ok: false, error: errorMsg })
          return
        }
        const after = snapshotFiles(destDir)
        const extracted = []
        for (const f of after) if (!before.has(f)) extracted.push(f)
        resolve({ ok: true, files: extracted })
      })
      proc.on('error', (err) => {
        const errorMsg = `7zip process error: ${String(err)}`
        uc_log(errorMsg)
        resolve({ ok: false, error: errorMsg })
      })
    } catch (err) {
      resolve({ ok: false, error: String(err) })
    }
  })
}

/**
 * Test archive integrity without extracting (7z t).
 * Returns { ok: true } if the archive is valid, or { ok: false, error } if corrupt.
 */
function run7zTest(archivePath) {
  return new Promise((resolve) => {
    try {
      const cmd = resolve7zipBinary()
      if (!cmd) {
        resolve({ ok: false, error: '7zip binary not found' })
        return
      }
      const args = ['t', archivePath, '-y']
      uc_log(`[UC.Files] 7z test: ${cmd} ${args.join(' ')}`)
      const proc = child_process.spawn(cmd, args, { windowsHide: true })
      let stdout = ''
      let stderr = ''
      proc.stdout && proc.stdout.on('data', (d) => { stdout += d.toString() })
      proc.stderr && proc.stderr.on('data', (d) => { stderr += d.toString() })
      proc.on('close', (code) => {
        if (code !== 0) {
          const errorMsg = stderr || stdout || `7z test exited with code ${code}`
          uc_log(`[UC.Files] 7z test FAILED: ${errorMsg}`)
          resolve({ ok: false, error: errorMsg })
        } else {
          resolve({ ok: true })
        }
      })
      proc.on('error', (err) => {
        resolve({ ok: false, error: `7z test process error: ${String(err)}` })
      })
    } catch (err) {
      resolve({ ok: false, error: String(err) })
    }
  })
}

// Snapshot of the last-seen state per downloadId - used by uc:overlay-get-downloads
// for an accurate initial panel load regardless of which downloader is active.
const latestDownloadState = new Map()

function sendDownloadUpdate(win, payload) {
  try {
    const settings = readSettings() || {}
    const isProgressUpdate = payload.status === 'downloading' || payload.status === 'paused'
    if (settings.verboseDownloadLogging) {
      ucLog(`[Download] ${payload.downloadId} | ${payload.status} | ${payload.receivedBytes || 0}/${payload.totalBytes || 0} | ${Math.round(payload.speedBps || 0)} B/s | ${payload.filename || ''}`)
    } else if (!isProgressUpdate) {
      ucLog(`[Download] ${payload.downloadId} → ${payload.status}${payload.error ? ' (' + payload.error + ')' : ''} | ${payload.filename || ''} | appid=${payload.appid || 'unknown'}`)
    }
    // Keep a live snapshot for the overlay's initial panel load
    if (payload.downloadId) {
      if (['completed', 'failed', 'cancelled'].includes(payload.status)) {
        latestDownloadState.delete(payload.downloadId)
      } else {
        latestDownloadState.set(payload.downloadId, payload)
      }
    }
    // Send to main window (always)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('uc:download-update', payload)
    }
    // Send to the caller's window if it's different from mainWindow
    if (win && !win.isDestroyed() && win !== mainWindow) {
      win.webContents.send('uc:download-update', payload)
    }
    // Forward to overlay window
    if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow !== win) {
      overlayWindow.webContents.send('uc:download-update', payload)
    }
  } catch (error) {
    ucLog(`[Download] Failed to send update: ${String(error)}`, 'error')
  }
}

function registerRunningGame(appid, exePath, proc, gameName, showGameName = true) {
  if (!proc || !proc.pid) return
  const payload = {
    appid: appid || null,
    exePath: exePath || null,
    gameName: gameName || null,
    pid: proc.pid,
    startedAt: Date.now()
  }
  if (appid) runningGames.set(appid, payload)
  if (exePath) runningGames.set(exePath, payload)
  if (gameName || appid) {
    const buttons = appid
      ? [
        { label: 'Open on web', url: `https://union-crax.xyz/game/${appid}` },
        { label: 'Download UC.D', url: 'https://union-crax.xyz/direct' }
      ]
      : [
        { label: 'Open on web', url: 'https://union-crax.xyz/direct' },
        { label: 'Download UC.D', url: 'https://union-crax.xyz/direct' }
      ]
    const displayName = showGameName ? (gameName || appid) : 'A game'
    setGameRpcActivity({
      details: `Playing ${displayName}`,
      state: 'Playing',
      startTimestamp: Math.floor(payload.startedAt / 1000),
      buttons
    }).catch(() => { })
  }

  function isTrackedPayloadCurrent() {
    if (payload.appid && runningGames.get(payload.appid) === payload) return true
    if (payload.exePath && runningGames.get(payload.exePath) === payload) return true
    return false
  }

  function clearTrackedPayload() {
    if (payload.appid) runningGames.delete(payload.appid)
    if (payload.exePath) runningGames.delete(payload.exePath)
    payload.handoffPendingUntil = 0
  }

  function finalizeTrackedExit(exitedPid) {
    if (!isTrackedPayloadCurrent()) return
    const elapsed = Date.now() - payload.startedAt
    ucLog(`[Game] ${payload.appid || 'unknown'} exited (PID ${exitedPid}, elapsed=${elapsed}ms)`)
    clearTrackedPayload()
    if (runningGames.size === 0) clearGameRpcActivity()
    if (exitedPid) cleanupOverlayInjection(exitedPid)
    if (runningGames.size === 0) hideOverlay()
    if (elapsed < 5000) {
      ucLog(`Game quick-exit detected: ${payload.appid} (elapsed=${elapsed}ms)`, 'warn')
      for (const win of BrowserWindow.getAllWindows()) {
        try {
          if (!win.isDestroyed()) {
            win.webContents.send('uc:game-quick-exit', {
              appid: payload.appid || null,
              exePath: payload.exePath || null,
              elapsed
            })
          }
        } catch {}
      }
    }
  }

  function runHiddenPowerShell(script, timeout = 8000) {
    return new Promise((resolve) => {
      const encoded = Buffer.from(script, 'utf16le').toString('base64')
      child_process.execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
        { windowsHide: true, timeout },
        (_err, stdout) => resolve(String(stdout || ''))
      )
    })
  }

  async function findWindowsSuccessorPids(rootPid) {
    if (process.platform !== 'win32' || !rootPid) return []
    const gameDir = payload.exePath ? path.dirname(payload.exePath) : ''
    const escapedDir = gameDir.replace(/'/g, "''")
    const psScript = `$rootPid = ${Number(rootPid)}
$gameDir = '${escapedDir}'
$processes = @()
try {
  $processes = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, ExecutablePath, CreationDate)
} catch {}
$queue = New-Object System.Collections.Queue
$seen = New-Object 'System.Collections.Generic.HashSet[int]'
$descendants = New-Object System.Collections.ArrayList
$queue.Enqueue([int]$rootPid)
[void]$seen.Add([int]$rootPid)
while ($queue.Count -gt 0) {
  $parentPid = [int]$queue.Dequeue()
  foreach ($proc in @($processes | Where-Object { [int]$_.ParentProcessId -eq $parentPid })) {
    $pid = [int]$proc.ProcessId
    if ($pid -gt 0 -and $seen.Add($pid)) {
      [void]$descendants.Add($proc)
      $queue.Enqueue($pid)
    }
  }
}
$candidates = @($descendants)
if ($candidates.Count -eq 0 -and $gameDir) {
  $candidates = @($processes | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($gameDir + '\\', [StringComparison]::OrdinalIgnoreCase) })
}
$candidates | Sort-Object CreationDate | ForEach-Object { $_.ProcessId }`
    const stdout = await runHiddenPowerShell(psScript)
    return stdout
      .trim()
      .split(/\r?\n/)
      .map((value) => Number(value.trim()))
      .filter((candidatePid) => candidatePid > 0 && candidatePid !== Number(rootPid))
  }

  function monitorTrackedPid(trackedPid) {
    const numericPid = Number(trackedPid)
    if (!numericPid) return
    let checking = false
    const pidPollInterval = setInterval(async () => {
      if (checking) return
      checking = true
      try {
        const alive = await isProcessRunning(numericPid)
        if (alive) return
        clearInterval(pidPollInterval)
        if (payload.pid !== numericPid) return
        handleTrackedExit(numericPid)
      } finally {
        checking = false
      }
    }, GAME_PID_POLL_MS)
  }

  function handleTrackedExit(exitedPid) {
    if (process.platform !== 'win32' || !payload.exePath) {
      finalizeTrackedExit(exitedPid)
      return
    }

    const handoffDeadline = Date.now() + WINDOWS_GAME_HANDOFF_GRACE_MS
    payload.handoffPendingUntil = handoffDeadline

    const tryAdoptSuccessor = async () => {
      if (!isTrackedPayloadCurrent()) return
      if (payload.pid !== exitedPid) return

      const successorPids = await findWindowsSuccessorPids(exitedPid)
      if (!isTrackedPayloadCurrent()) return
      if (payload.pid !== exitedPid) return

      if (successorPids.length > 0) {
        const adoptedPid = successorPids[successorPids.length - 1]
        ucLog(`[Game] ${payload.appid || 'unknown'} launcher exited (PID ${exitedPid}), adopting child PID ${adoptedPid}`)
        payload.pid = adoptedPid
        payload.handoffPendingUntil = 0
        if (payload.appid) runningGames.set(payload.appid, payload)
        if (payload.exePath) runningGames.set(payload.exePath, payload)
        cleanupOverlayInjection(exitedPid)
        if (payload.appid && overlayAutoShow && overlayEnabled && overlayMode !== 'panel') {
          showOverlayToast(payload.appid)
        }
        monitorTrackedPid(adoptedPid)
        return
      }

      if (Date.now() >= handoffDeadline) {
        finalizeTrackedExit(exitedPid)
        return
      }

      setTimeout(tryAdoptSuccessor, WINDOWS_GAME_HANDOFF_POLL_MS)
    }

    setTimeout(tryAdoptSuccessor, 500)
  }

  // Auto-show overlay when game launches
  if (appid) checkAndShowOverlayForGame(appid)

  // Native DLL injection is disabled - the transparent window overlay works without it.
  // The offscreen-rendering + shared-memory pipeline (~480 MB/s memcpy at 60fps) blocks
  // the main process event loop, causing Electron to stop responding.
  // TODO: move frame writing to a worker thread before re-enabling.
  // if (nativeOverlay && proc.pid) {
  //   setTimeout(() => injectOverlayIntoGame(proc.pid, appid), 2000)
  // }

  proc.on('exit', () => {
    handleTrackedExit(proc.pid)
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

function isProcessRunning(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve(false)
    try {
      process.kill(pid, 0)
      return resolve(true)
    } catch (err) {
      if (err && err.code === 'ESRCH') return resolve(false)
      // On Windows, elevated processes may throw EPERM; fall back to tasklist.
      if (process.platform !== 'win32') return resolve(true)
    }

    try {
      const task = child_process.spawn('tasklist', ['/FI', `PID eq ${pid}`], { windowsHide: true })
      let out = ''
      task.stdout?.on('data', (data) => {
        out += String(data)
      })
      task.on('close', () => {
        resolve(out.includes(String(pid)))
      })
      task.on('error', () => resolve(false))
    } catch {
      resolve(false)
    }
  })
}

async function pruneRunningGames() {
  if (runningGames.size === 0) return
  const seenPids = new Set()
  const payloads = []
  for (const payload of runningGames.values()) {
    if (!payload || !payload.pid || seenPids.has(payload.pid)) continue
    seenPids.add(payload.pid)
    payloads.push(payload)
  }

  for (const payload of payloads) {
    if (payload.handoffPendingUntil && payload.handoffPendingUntil > Date.now()) {
      continue
    }
    const alive = await isProcessRunning(payload.pid)
    if (!alive) {
      if (payload.appid) runningGames.delete(payload.appid)
      if (payload.exePath) runningGames.delete(payload.exePath)
    }
  }

  if (runningGames.size === 0 && rpcGameActivity) {
    clearGameRpcActivity()
  }
}

function createWindow() {
  ucLog('Creating main window')
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

  attachWindowLogging(mainWindow, 'main')

  // Hide the menu bar
  mainWindow.setMenuBarVisibility(false)

  const defaultUserAgent = mainWindow.webContents.getUserAgent()
  mainWindow.webContents.setUserAgent(`${defaultUserAgent} UnionCrax.Direct/${getAppVersion()}`)

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

  // Add headers for Pixeldrain downloads to prevent 403 errors
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ['https://pixeldrain.com/api/file/*'] },
    (details, callback) => {
      details.requestHeaders['Referer'] = 'https://pixeldrain.com/'
      details.requestHeaders['Origin'] = 'https://pixeldrain.com'
      // Keep existing User-Agent or add one
      if (!details.requestHeaders['User-Agent']) {
        details.requestHeaders['User-Agent'] = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36`
      }
      // Inject Authorization header if we have one for this pixeldrain file
      if (!details.requestHeaders['Authorization']) {
        try {
          const parsed = new URL(details.url)
          const fileIdMatch = parsed.pathname.match(/\/api\/file\/([^/?#]+)/)
          if (fileIdMatch?.[1] && pixeldrainAuthHeaders.has(fileIdMatch[1])) {
            details.requestHeaders['Authorization'] = pixeldrainAuthHeaders.get(fileIdMatch[1])
          }
        } catch { }
      }
      callback({ requestHeaders: details.requestHeaders })
    }
  )

  mainWindow.webContents.session.on('will-download', (_event, item) => {
    const downloadRoot = ensureDownloadDir()
    const url = item.getURL()
    const normalizedUrl = normalizeDownloadUrl(url)
    const itemFilename = item.getFilename()
    const matchIndex = pendingDownloads.findIndex((entry) =>
      entry.url === url ||
      (entry.normalizedUrl && entry.normalizedUrl === normalizedUrl) ||
      (entry.filename && entry.filename === itemFilename) ||
      (Array.isArray(entry.urlChain) && entry.urlChain.includes(url))
    )
    const match = matchIndex >= 0 ? pendingDownloads.splice(matchIndex, 1)[0] : null
    const downloadId = match?.downloadId || `${Date.now()}-${Math.random().toString(16).slice(2)}`

    // If this download was cancelled while it was pending, cancel it immediately
    if (cancelledDownloadIds.has(downloadId)) {
      ucLog(`will-download: immediately cancelling download that was cancelled while pending: ${downloadId}`)
      try { item.cancel() } catch { }
      return
    }

    // Always use match.filename if available to ensure consistency with parser logic, even if server sends different Content-Disposition
    const filename = match?.filename ? match.filename : itemFilename
    uc_log(`will-download - url=${item.getURL()}`)
    uc_log(`will-download - match.filename=${match?.filename}, item.getFilename()=${item.getFilename()}, final filename=${filename}`)
    const partIndex = match?.partIndex
    const partTotal = match?.partTotal
    const gameFolder = safeFolderName(match?.gameName || match?.appid || downloadId)
    const installingRoot = ensureSubdir(path.join(downloadRoot, installingDirName), gameFolder)
    const savePath = match?.savePath || path.join(installingRoot, filename)
    try {
      item.setSavePath(savePath)
    } catch { }

    const startedAt = Date.now()
    const state = { lastBytes: 0, lastTime: startedAt, speedBps: 0 }
    uc_log(`activeDownloads.set - partIndex=${partIndex} partTotal=${partTotal}`)
    activeDownloads.set(downloadId, {
      item, state, appid: match?.appid, gameName: match?.gameName, url, savePath, partIndex, partTotal,
    })

    // For interrupted downloads (created by createInterruptedDownload), the item starts
    // in 'interrupted' state and requires an explicit resume() call to begin downloading.
    const isInterruptedResume = item.getState() === 'interrupted' || (item.isPaused() && match?.savePath)
    const initialReceivedBytes = item.getReceivedBytes() || 0

    if (isInterruptedResume) {
      uc_log(`will-download: interrupted download detected, calling item.resume() - offset=${initialReceivedBytes}`)
      // Initialize speed tracking from the offset so delta calculations are correct
      state.lastBytes = initialReceivedBytes
    }

    sendDownloadUpdate(mainWindow, {
      downloadId,
      status: 'downloading',
      receivedBytes: initialReceivedBytes,
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

    // Resume interrupted downloads AFTER registering in activeDownloads and sending initial update
    if (isInterruptedResume) {
      try { item.resume() } catch (e) {
        uc_log(`will-download: resume() failed: ${e}`)
      }
    }

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
      // When download is fully received, zero out speed so the UI doesn't show stale bars
      const finalSpeed = (total > 0 && received >= total) ? 0 : speedBps
      const etaSeconds = finalSpeed > 0 && remaining > 0 ? remaining / finalSpeed : null
      sendDownloadUpdate(mainWindow, {
        downloadId,
        status: item.isPaused() ? 'paused' : 'downloading',
        receivedBytes: received,
        totalBytes: total,
        speedBps: finalSpeed,
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
      uc_log(`download done handler start - downloadId=${downloadId} state=${state} url=${url}`)

      // When the app is quitting, Electron cancels all active/paused DownloadItems and fires
      // done with state='cancelled'. Don't propagate this to the renderer - the download
      // was not cancelled by the user. On next startup the renderer will restore it as 'paused'.
      if (app.isQuitting && state === 'cancelled') {
        uc_log(`download done during quit - suppressing cancelled status for ${downloadId}`)
        activeDownloads.delete(downloadId)
        return
      }

      // Clean up .ucresume backup file if present (no longer needed)
      const entry = activeDownloads.get(downloadId)
      if (entry?.savePath) {
        const backupPath = entry.savePath + RESUME_BACKUP_EXT
        if (fs.existsSync(backupPath)) {
          try { fs.unlinkSync(backupPath) } catch { }
        }
      }

      activeDownloads.delete(downloadId)
      // Clean up pixeldrain auth header for this file
      try {
        const fileId = extractPixeldrainFileIdFromUrl(url)
        if (fileId) pixeldrainAuthHeaders.delete(fileId)
      } catch { }
      // Safety: also remove this downloadId from pendingDownloads in case will-download
      // didn't match it (URL normalization mismatch, redirects, etc.)
      const pendingIdx = pendingDownloads.findIndex(p => p.downloadId === downloadId)
      if (pendingIdx >= 0) {
        uc_log(`cleaning stale pendingDownloads entry for ${downloadId}`)
        pendingDownloads.splice(pendingIdx, 1)
      }
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
                } catch (e) { }
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
          uc_log(`entry.partIndex=${entry?.partIndex}, entry.partTotal=${entry?.partTotal}`)
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
              sendDownloadUpdate(mainWindow, { downloadId, status: 'extracting', receivedBytes: 0, totalBytes, speedBps: 0, etaSeconds: null, filename: path.basename(archiveToExtract), savePath: archiveToExtract, appid: entry?.appid || null })
            } catch (_) {
              sendDownloadUpdate(mainWindow, { downloadId, status: 'extracting', receivedBytes: 0, totalBytes: 0, speedBps: 0, etaSeconds: null, filename: path.basename(archiveToExtract), savePath: archiveToExtract, appid: entry?.appid || null })
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
                      sendDownloadUpdate(mainWindow, { downloadId, status: 'extracting', receivedBytes: size, totalBytes, speedBps: Math.round(speedBps), etaSeconds, filename: path.basename(archiveToExtract), savePath: archiveToExtract, appid: entry?.appid || null })
                    } catch (e) { }
                  }).catch(() => { })
                } catch (e) { }
              }, 500)
            } catch (e) { }

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
                sendDownloadUpdate(mainWindow, { downloadId, status: 'extracting', receivedBytes: received, totalBytes, speedBps: Math.round(speedBps), etaSeconds, filename: path.basename(archiveToExtract), savePath: archiveToExtract, appid: entry?.appid || null })
              } catch (e) { }
            })
            try { if (_pollTimer) clearInterval(_pollTimer) } catch (e) { }
            uc_log(`extraction result for ${archiveToExtract}: ${JSON.stringify(res && { ok: res.ok, error: res.error, files: (res.files || []).slice(0, 10) })}`)
            if (extractionKeyOverride) activeExtractions.delete(extractionKeyOverride)
            if (res && res.ok) {
              const extractedFiles = res.files || []
              const fileEntries = []
              for (const ef of extractedFiles) {
                try {
                  const stats = fs.existsSync(ef) ? fs.statSync(ef) : null
                  // Skip checksum calculation for now to prevent stalling the main process during extraction.
                  // Checksums are slow (especially on many small files) and block the completion event.
                  const fileEntry = {
                    path: ef,
                    name: path.basename(ef),
                    size: stats ? stats.size : 0,
                    checksum: null,
                    addedAt: Date.now(),
                  }
                  fileEntries.push(fileEntry)
                } catch (e) { }
              }

              // Update the manifest in a single bulk operation
              if (fileEntries.length > 0) {
                updateInstalledManifestBulk(installedRoot, metadataForInstall, fileEntries)
              } else {
                updateInstalledManifest(installedRoot, metadataForInstall, null)
              }

              try {
                const skipNames = new Set()
                if (archiveToExtract) skipNames.add(path.basename(archiveToExtract))
                if (Array.isArray(partFiles)) {
                  for (const part of partFiles) skipNames.add(path.basename(part))
                }
                migrateInstallingExtras(installingRoot, installedRoot, skipNames)
              } catch (e) { }
              uc_log(`extraction success - files: ${extractedFiles.length}`)
              try {
                const st2 = fs.existsSync(archiveToExtract) ? fs.statSync(archiveToExtract) : null
                const totalBytes2 = totalBytesOverride != null ? totalBytesOverride : st2 ? st2.size : 0
                if (totalBytes2 > 0) sendDownloadUpdate(mainWindow, { downloadId, status: 'extracting', receivedBytes: totalBytes2, totalBytes: totalBytes2, speedBps: 0, etaSeconds: 0, filename: path.basename(archiveToExtract), savePath: archiveToExtract, appid: entry?.appid || null })
              } catch (e) { }
              // Clean up archives first (delete the archive files)
              try {
                if (partFiles && partFiles.length) {
                  for (const part of partFiles) {
                    try { if (fs.existsSync(part)) fs.unlinkSync(part) } catch (e) { }
                  }
                  uc_log(`deleted multipart parts for ${archiveToExtract}`)
                } else if (archiveToExtract && fs.existsSync(archiveToExtract)) {
                  try { fs.unlinkSync(archiveToExtract); uc_log(`deleted archive ${archiveToExtract} from installing folder`) } catch (e) { uc_log(`failed to delete archive: ${String(e)}`) }
                }
              } catch (e) {
                uc_log(`error deleting archive: ${String(e)}`)
              }

              // Move extracted files from installing folder to installed folder
              try {
                const skipNames = new Set()
                if (archiveToExtract) skipNames.add(path.basename(archiveToExtract))
                migrateInstallingExtras(installingRoot, installedRoot, skipNames)
                uc_log(`moved extracted files to installed folder for ${entry?.appid}`)
              } catch (e) {
                uc_log(`failed to migrate extracted files: ${String(e)}`)
              }

              // Update manifest status BEFORE deleting the installing folder to ensure it's saved
              try {
                if (entry?.appid) updateInstallingManifestStatus(entry.appid, 'completed', null)
              } catch (e) {
                uc_log(`failed to update installing manifest status: ${String(e)}`)
              }

              // Use async rm with timeout to prevent hanging on Windows file locks
              // The folder will be cleaned up on next app restart if deletion fails
              const deleteInstallingFolder = () => {
                return new Promise((resolve) => {
                  if (!fs.existsSync(installingRoot)) {
                    uc_log(`installing folder already gone for ${entry?.appid}`)
                    resolve()
                    return
                  }
                  // Try quick delete first
                  try {
                    fs.rmSync(installingRoot, { recursive: true, force: true })
                    uc_log(`deleted installing folder for ${entry?.appid}`)
                    resolve()
                  } catch (e) {
                    uc_log(`initial rmSync failed, trying async: ${String(e)}`)
                    // Fall back to async with timeout
                    fs.promises.rm(installingRoot, { recursive: true, force: true, maxRetries: 3, retryDelayMs: 500 })
                      .then(() => {
                        uc_log(`deleted installing folder async for ${entry?.appid}`)
                        resolve()
                      })
                      .catch((err) => {
                        uc_log(`failed to delete installing folder (non-fatal): ${String(err)}`)
                        // Don't reject - this is not fatal, folder will persist until next restart
                        resolve()
                      })
                  }
                })
              }

              // Execute async folder deletion without blocking
              deleteInstallingFolder()

              sendDownloadUpdate(mainWindow, { downloadId, status: 'extracted', extracted: extractedFiles, savePath: null, appid: entry?.appid || null })
              try {
                const stDone = archiveToExtract && fs.existsSync(archiveToExtract) ? fs.statSync(archiveToExtract) : null
                const totalBytesDone = totalBytesOverride != null ? totalBytesOverride : stDone ? stDone.size : 0
                sendDownloadUpdate(mainWindow, {
                  downloadId,
                  status: 'completed',
                  receivedBytes: totalBytesDone,
                  totalBytes: totalBytesDone,
                  speedBps: 0,
                  etaSeconds: 0,
                  filename: archiveToExtract ? path.basename(archiveToExtract) : null,
                  savePath: null,
                  appid: entry?.appid || null,
                  gameName: entry?.gameName || null,
                  url: entry?.url || null,
                  partIndex: entry?.partIndex,
                  partTotal: entry?.partTotal
                })
                uc_log(`emitted final completed status for ${entry?.appid}`)
              } catch (e) {
                uc_log(`failed to emit final completed status: ${String(e)}`)
              }
            } else {
              uc_log(`extraction failed for ${archiveToExtract}: ${res && res.error ? res.error : 'unknown'}`)
              extractionFailed = true
              extractionError = res && res.error ? res.error : 'extract_failed'
              updateInstallingManifestStatus(entry?.appid, 'failed', extractionError)
              sendDownloadUpdate(mainWindow, { downloadId, status: 'extract_failed', error: res && res.error ? res.error : 'unknown', savePath: finalPath, appid: entry?.appid || null })
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
            if (entry?.appid && hasPendingInGlobalQueueForApp(entry.appid)) {
              // More parts are queued - defer extraction until all downloads for this game finish
              const prev = deferredArchives.get(entry.appid) || []
              deferredArchives.set(entry.appid, [...prev, finalPath])
              uc_log(`deferred archive extraction for ${entry.appid}: ${path.basename(finalPath)} (other downloads still queued)`)
            } else {
              // Process any previously-deferred archives first, then extract this one
              const deferred = entry?.appid ? (deferredArchives.get(entry.appid) || []) : []
              if (deferred.length) deferredArchives.delete(entry.appid)
              for (const dPath of deferred) {
                if (fs.existsSync(dPath)) {
                  uc_log(`running deferred archive for ${entry.appid}: ${path.basename(dPath)}`)
                  await extractArchive(dPath, null, null, null)
                }
              }
              await extractArchive(finalPath, null, null, null)
            }
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
              } catch (e) {
                uc_log(`failed to migrate non-archive extras: ${String(e)}`)  
              }

              // If this was the last download for the game, process any deferred archive extractions
              if (entry?.appid && !hasPendingInGlobalQueueForApp(entry.appid)) {
                const deferred = deferredArchives.get(entry.appid) || []
                if (deferred.length) {
                  deferredArchives.delete(entry.appid)
                  for (const dPath of deferred) {
                    if (fs.existsSync(dPath)) {
                      uc_log(`processing deferred archive after non-archive download for ${entry.appid}: ${path.basename(dPath)}`)
                      await extractArchive(dPath, null, null, null)
                    }
                  }
                }
              }

              // Update manifest status BEFORE deleting the installing folder
              try {
                if (entry?.appid) updateInstallingManifestStatus(entry.appid, 'completed', null)
              } catch (e) { }

              // Clean up installing folder after moving to installed (async to prevent hanging)
              const deleteInstallingFolderNonArchive = () => {
                return new Promise((resolve) => {
                  if (!fs.existsSync(installingRoot)) {
                    uc_log(`installing folder already gone for non-archive ${entry?.appid}`)
                    resolve()
                    return
                  }
                  try {
                    fs.rmSync(installingRoot, { recursive: true, force: true })
                    uc_log(`deleted installing folder for non-archive ${entry?.appid}`)
                    resolve()
                  } catch (e) {
                    uc_log(`initial rmSync failed for non-archive, trying async: ${String(e)}`)
                    fs.promises.rm(installingRoot, { recursive: true, force: true, maxRetries: 3, retryDelayMs: 500 })
                      .then(() => {
                        uc_log(`deleted installing folder async for non-archive ${entry?.appid}`)
                        resolve()
                      })
                      .catch((err) => {
                        uc_log(`failed to delete installing folder for non-archive (non-fatal): ${String(err)}`)
                        resolve()
                      })
                  }
                })
              }
              deleteInstallingFolderNonArchive()

              // update installed manifest in the installed folder
              try {
                ; (async () => {
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
          ucLog(`Extraction error: ${e.message}`, 'error')
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
      sendDownloadUpdate(mainWindow, {
        downloadId,
        status: terminalStatus,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        speedBps: 0,
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
      // Update manifest for failed downloads only - completed downloads are moved to installed folder
      if (entry?.appid && terminalStatus !== 'completed') {
        updateInstallingManifestStatus(entry.appid, terminalStatus, terminalError)
      }
      if (entry?.appid) {
        if (terminalStatus !== 'completed') {
          flushQueuedDownloads(entry.appid, terminalStatus, terminalError)
          flushQueuedGlobalDownloads(entry.appid, terminalStatus, terminalError)
        }
      }
      startNextQueuedDownload(entry?.appid)
    })
  })
}

app.whenReady().then(() => {
  ensureDownloadDir()
  createWindow()
  createTray()
  configureAutoUpdater()
  
  // Initialize overlay system
  const settings = readSettings()
  if (settings.overlayEnabled !== false) {
    overlayEnabled = settings.overlayEnabled !== false
    overlayHotkey = settings.overlayHotkey || 'Ctrl+Shift+Tab'
    overlayAutoShow = settings.overlayAutoShow !== false
    overlayPosition = settings.overlayPosition || 'left'
    createOverlayWindow()
    registerOverlayHotkey()
  }
  
  updateRpcSettings(readSettings()).catch(() => { })

  ucLog(`App ready. Version: ${getAppVersion()}`)

  setInterval(() => {
    pruneRunningGames().catch(() => { })
  }, 15000)

  // Periodically clean stale pending downloads (entries where will-download never fired)
  setInterval(() => {
    const now = Date.now()
    const staleThreshold = 45000 // 45 seconds
    let cleaned = false
    for (let i = pendingDownloads.length - 1; i >= 0; i--) {
      const entry = pendingDownloads[i]
      if (entry._addedAt && (now - entry._addedAt) > staleThreshold) {
        ucLog(`Cleaning stale pending download: ${entry.downloadId} (age: ${Math.round((now - entry._addedAt) / 1000)}s)`)
        pendingDownloads.splice(i, 1)
        // Notify renderer that this download failed so it doesn't stay stuck
        const windows = BrowserWindow.getAllWindows()
        for (const win of windows) {
          try {
            sendDownloadUpdate(win, {
              downloadId: entry.downloadId,
              status: 'failed',
              error: 'Download timed out waiting for server response',
              speedBps: 0,
              etaSeconds: null,
              filename: entry.filename || '',
            })
          } catch (e) { }
        }
        cleaned = true
      }
    }
    // If we cleaned stale entries, try to start queued downloads that may have been blocked
    if (cleaned && globalDownloadQueue.length > 0 && !hasAnyActiveOrPendingDownloads()) {
      startNextQueuedDownload(null)
    }
  }, 15000)

  if (!isDev) {
    setTimeout(() => {
      triggerAutoUpdateCheck().catch(() => { })
    }, 10000)
    setInterval(() => {
      triggerAutoUpdateCheck().catch(() => { })
    }, 60 * 60 * 1000)
  } else {
    ucLog('DEV mode - automatic update checks disabled.')
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

ipcMain.handle('uc:check-for-updates', async () => {
  return await triggerAutoUpdateCheck()
})

ipcMain.handle('uc:update-retry', async () => {
  return await retryAutoUpdate()
})

ipcMain.handle('uc:install-update', () => {
  if (isDev) return { ok: false, error: 'updates-disabled-in-dev' }
  if (!updateState.downloaded) return { ok: false, error: 'update-not-downloaded' }
  try {
    setUpdateStatus({ state: 'installing', error: null })
    setImmediate(() => {
      try {
        autoUpdater.quitAndInstall(false, true)
      } catch (err) {
        setUpdateStatus({ state: 'error', error: err?.message || String(err) })
      }
    })
    return { ok: true }
  } catch (err) {
    setUpdateStatus({ state: 'error', error: err?.message || String(err) })
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('uc:get-update-status', () => {
  return getUpdateStatusSnapshot()
})

ipcMain.handle('uc:get-version', () => {
  return packageJson.version
})

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') app.quit()
})

app.on('before-quit', () => {
  app.isQuitting = true
  shutdownRpcClient()

  // Preserve partial download files before Chromium deletes them.
  // When Electron quits it cancels all active/paused DownloadItems, and Chromium's
  // cancel handler deletes the partially-written file from disk. Creating a hardlink
  // is instant (no data copy, even for 10 GB files) - the hardlink survives the
  // original's deletion because both point to the same inode on disk.
  for (const [downloadId, entry] of activeDownloads) {
    if (entry.savePath) {
      try {
        const backupPath = entry.savePath + RESUME_BACKUP_EXT
        if (fs.existsSync(entry.savePath)) {
          if (fs.existsSync(backupPath)) { try { fs.unlinkSync(backupPath) } catch { } }
          fs.linkSync(entry.savePath, backupPath)
          ucLog(`Preserved partial download via hardlink: ${backupPath} (downloadId=${downloadId})`)
        }
      } catch (e) {
        ucLog(`Failed to preserve partial download ${entry.savePath}: ${e.message}`, 'warn')
      }
    }
  }
})

ipcMain.handle('uc:download-start', (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) return { ok: false }
  // Coerce DownloadHostEntry objects to string URL (safety net for old renderer builds)
  if (payload && payload.url && typeof payload.url !== 'string') {
    const extracted = (typeof payload.url.url === 'string') ? payload.url.url : String(payload.url)
    ucLog('uc:download-start: coercing non-string url', 'warn')
    payload = { ...payload, url: extracted }
  }
  if (!payload || !payload.url || typeof payload.url !== 'string' || !payload.downloadId) {
    ucLog('Download start failed: invalid payload', 'warn')
    return { ok: false }
  }
  const knownState = getKnownDownloadState(payload.downloadId)
  if (knownState) {
    ucLog(`Download already exists: ${payload.downloadId} (state=${knownState})`, 'warn')
    return { ok: true, already: true, queued: knownState === 'queued', state: knownState }
  }

  const appid = payload.appid
  ucLog(`Download start: ${appid} (${payload.downloadId})`)
  if (hasAnyActiveOrPendingDownloads() || globalDownloadQueue.length > 0) {
    enqueueGlobalDownload(payload, win.webContents.id)
    ucLog(`Download queued: ${appid}`)
    // Notify overlay/renderer that this download exists (in queued state)
    sendDownloadUpdate(win, {
      downloadId: payload.downloadId,
      status: 'queued',
      receivedBytes: 0,
      totalBytes: 0,
      speedBps: 0,
      etaSeconds: null,
      filename: payload.filename || null,
      appid: payload.appid || null,
      gameName: payload.gameName || null,
      url: payload.url,
      partIndex: payload.partIndex,
      partTotal: payload.partTotal,
      resumeData: null,
    })
    return { ok: true, queued: true }
  }

  return startDownloadNow(win, payload)
})

ipcMain.handle('uc:download-cancel', (_event, downloadId) => {
  if (!downloadId) return { ok: false }
  // Track this ID as cancelled so delayed/pending downloads can't resurrect
  cancelledDownloadIds.add(downloadId)
  // Auto-clean after 5 minutes to avoid memory leak
  setTimeout(() => cancelledDownloadIds.delete(downloadId), 5 * 60 * 1000)

  // Helper: broadcast cancelled status so overlay/renderer remove the item
  const broadcastCancelled = () => {
    latestDownloadState.delete(downloadId)
    const cancelPayload = { downloadId, status: 'cancelled', receivedBytes: 0, totalBytes: 0, speedBps: 0, etaSeconds: null, filename: '', savePath: '', appid: null, gameName: null, url: '' }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('uc:download-update', cancelPayload)
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.send('uc:download-update', cancelPayload)
  }

  // UC.Files parallel download cancel
  const ucEntry = ucfilesActiveDownloads.get(downloadId)
  if (ucEntry) {
    ucEntry.abort.abort()
    ucfilesActiveDownloads.delete(downloadId)
    ucLog(`Download cancelled (UC.Files parallel): ${downloadId}`)
    broadcastCancelled()
    return { ok: true }
  }

  const entry = activeDownloads.get(downloadId)
  if (entry) {
    // Clean up speed limit timer
    if (entry.speedLimitResumeTimer) {
      clearTimeout(entry.speedLimitResumeTimer)
      delete entry.speedLimitResumeTimer
    }
    try {
      entry.item.cancel()
    } catch { }
    ucLog(`Download cancelled (active): ${downloadId}`)
    broadcastCancelled()
    return { ok: true }
  }
  // Check pendingDownloads (between downloadURL() call and will-download firing)
  const pendingIdx = pendingDownloads.findIndex((p) => p.downloadId === downloadId)
  if (pendingIdx >= 0) {
    pendingDownloads.splice(pendingIdx, 1)
    ucLog(`Download cancelled (pending): ${downloadId}`)
    broadcastCancelled()
    return { ok: true }
  }
  // Check per-app download queues
  for (const [appid, queue] of downloadQueues.entries()) {
    const idx = queue.findIndex((item) => item.payload && item.payload.downloadId === downloadId)
    if (idx >= 0) {
      queue.splice(idx, 1)
      if (!queue.length) downloadQueues.delete(appid)
      ucLog(`Download cancelled (app queue): ${downloadId}`)
      broadcastCancelled()
      return { ok: true }
    }
  }
  // Check global download queue
  const idx = globalDownloadQueue.findIndex((item) => item.payload && item.payload.downloadId === downloadId)
  if (idx >= 0) {
    globalDownloadQueue.splice(idx, 1)
    ucLog(`Download cancelled (global queue): ${downloadId}`)
    broadcastCancelled()
    return { ok: true }
  }
  ucLog(`Download cancel: ${downloadId} not found in any queue`, 'warn')
  broadcastCancelled()
  return { ok: false }
})

ipcMain.handle('uc:download-pause', (event, downloadId) => {
  const win = BrowserWindow.fromWebContents(event.sender)

  // UC.Files parallel download pause
  const ucEntry = ucfilesActiveDownloads.get(downloadId)
  if (ucEntry) {
    ucEntry.state.paused = true
    ucLog(`Download paused (UC.Files parallel): ${downloadId}`)
    // Send explicit paused update (reportProgress will skip while paused)
    const snap = latestDownloadState.get(downloadId)
    sendDownloadUpdate(win, {
      downloadId,
      status: 'paused',
      receivedBytes: snap?.receivedBytes || 0,
      totalBytes: snap?.totalBytes || 0,
      speedBps: 0,
      etaSeconds: null,
      filename: snap?.filename || '',
      savePath: snap?.savePath || '',
      appid: snap?.appid || null,
      gameName: snap?.gameName || null,
      url: snap?.url || '',
      resumeData: null,
      partIndex: snap?.partIndex,
      partTotal: snap?.partTotal,
    })
    // A paused download no longer blocks the queue - start the next one
    if (globalDownloadQueue.length > 0 && !hasAnyActiveOrPendingDownloads()) {
      startNextQueuedDownload(null)
    }
    return { ok: true }
  }

  const entry = activeDownloads.get(downloadId)
  if (!entry) return { ok: false }
  try {
    // Clear any speed-limit timer so it doesn't auto-resume a user-paused download
    if (entry.speedLimitResumeTimer) {
      clearTimeout(entry.speedLimitResumeTimer)
      delete entry.speedLimitResumeTimer
    }
    entry.speedLimitPaused = false
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
  } catch (e) { }
  // A paused download no longer blocks the queue - start the next one
  if (globalDownloadQueue.length > 0 && !hasAnyActiveOrPendingDownloads()) {
    startNextQueuedDownload(null)
  }
  return { ok: true }
})

ipcMain.handle('uc:download-resume', (event, downloadId) => {
  const win = BrowserWindow.fromWebContents(event.sender)

  // UC.Files parallel download resume
  const ucEntry = ucfilesActiveDownloads.get(downloadId)
  if (ucEntry && ucEntry.state.paused) {
    // Swap: pause whatever is currently active, then resume this one
    if (hasAnyActiveOrPendingDownloads()) {
      pauseActiveDownload(downloadId)
    }
    ucEntry.state.paused = false
    for (const resolve of ucEntry.state.pauseResolvers) resolve()
    ucEntry.state.pauseResolvers = []
    ucLog(`Download resumed (UC.Files parallel): ${downloadId}`)
    const snap = latestDownloadState.get(downloadId)
    sendDownloadUpdate(win, {
      downloadId,
      status: 'downloading',
      receivedBytes: snap?.receivedBytes || 0,
      totalBytes: snap?.totalBytes || 0,
      speedBps: 0,
      etaSeconds: null,
      filename: snap?.filename || '',
      savePath: snap?.savePath || '',
      appid: snap?.appid || null,
      gameName: snap?.gameName || null,
      url: snap?.url || '',
      resumeData: null,
      partIndex: snap?.partIndex,
      partTotal: snap?.partTotal,
    })
    return { ok: true }
  }

  const entry = activeDownloads.get(downloadId)
  if (!entry) return { ok: false }
  // Swap: pause whatever is currently active, then resume this one
  if (hasAnyActiveOrPendingDownloads()) {
    pauseActiveDownload(downloadId)
  }
  try {
    // Reset speed-limit state so measurement starts fresh after manual resume
    entry.speedLimitPaused = false
    if (entry.speedLimitResumeTimer) {
      clearTimeout(entry.speedLimitResumeTimer)
      delete entry.speedLimitResumeTimer
    }
    const nowMs = Date.now()
    entry.speedLimitWindow = { startTime: nowMs, startBytes: entry.item.getReceivedBytes() }
    entry.state.speedBps = 0
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
  } catch (e) { }
  return { ok: true }
})

ipcMain.handle('uc:download-resume-interrupted', (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) return { ok: false }
  if (!payload || !payload.resumeData) return { ok: false, error: 'missing-resume-data' }
  const resume = payload.resumeData || {}
  const savePath = resume.savePath || payload.savePath
  // Attempt to restore the partial file if Chromium deleted it during a previous quit
  if (!savePath || !restorePreservedFile(savePath)) return { ok: false, error: 'missing-file' }
  const urlChain = Array.isArray(resume.urlChain) && resume.urlChain.length
    ? resume.urlChain
    : payload.url
      ? [payload.url]
      : []
  if (!urlChain.length) return { ok: false, error: 'missing-url' }

  // Register auth header for pixeldrain authenticated downloads
  if (payload.authHeader && urlChain[0] && urlChain[0].includes('pixeldrain.com')) {
    const fileId = extractPixeldrainFileIdFromUrl(urlChain[0])
    if (fileId) pixeldrainAuthHeaders.set(fileId, payload.authHeader)
  }

  pendingDownloads.push({
    url: urlChain[0],
    downloadId: payload.downloadId,
    filename: payload.filename || path.basename(savePath),
    appid: payload.appid,
    gameName: payload.gameName,
    partIndex: payload.partIndex,
    partTotal: payload.partTotal,
    urlChain,
    authHeader: payload.authHeader,
    savePath
  })

  // Use the actual file size on disk as the offset - the stored resumeData.offset
  // can be stale if the app was closed before localStorage caught up to the actual
  // bytes written to disk (updates arrive ~1/sec, disk writes are continuous).
  let actualOffset = resume.offset || 0
  try {
    const stat = fs.statSync(savePath)
    if (stat.size > 0) {
      if (stat.size !== actualOffset) {
        ucLog(`resume-interrupted: correcting offset ${actualOffset} → ${stat.size} (actual file size)`, 'info')
      }
      actualOffset = stat.size
    }
  } catch { }

  try {
    win.webContents.session.createInterruptedDownload({
      path: savePath,
      urlChain,
      mimeType: resume.mimeType || '',
      offset: actualOffset,
      length: resume.totalBytes || 0,
      lastModified: resume.lastModified || '',
      eTag: resume.etag || '',
      startTime: resume.startTime || 0
    })
    return { ok: true, actualOffset }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

// Level 3 resume: re-resolve produced a fresh URL but we still have a partial file on disk.
// Use createInterruptedDownload with the fresh URL + actual file offset so the download
// resumes from where it left off instead of restarting from byte 0.
ipcMain.handle('uc:download-resume-with-fresh-url', (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) return { ok: false }
  // Coerce DownloadHostEntry objects to string URL (safety net for old renderer builds)
  if (payload && payload.url && typeof payload.url !== 'string') {
    const extracted = (typeof payload.url.url === 'string') ? payload.url.url : String(payload.url)
    ucLog('uc:download-resume-with-fresh-url: coercing non-string url', 'warn')
    payload = { ...payload, url: extracted }
  }
  if (!payload || !payload.url || typeof payload.url !== 'string') return { ok: false, error: 'missing-url' }

  const savePath = payload.savePath
  // Attempt to restore the partial file if Chromium deleted it during a previous quit
  if (!savePath || !restorePreservedFile(savePath)) {
    // No partial file on disk - caller should fall back to a from-scratch download
    return { ok: false, error: 'missing-file' }
  }

  let actualOffset = 0
  try {
    const stat = fs.statSync(savePath)
    actualOffset = stat.size
  } catch { }

  if (actualOffset <= 0) {
    return { ok: false, error: 'empty-file' }
  }

  // If the file on disk is already the expected size (or larger), the download
  // is actually complete.  Chromium's createInterruptedDownload rejects
  // offset >= length, so tell the renderer the file is already done so it can
  // skip straight to verification/extraction.
  if (payload.totalBytes && actualOffset >= payload.totalBytes) {
    ucLog(`resume-with-fresh-url: file already complete (offset=${actualOffset}, totalBytes=${payload.totalBytes}), skipping re-download`, 'info')
    return { ok: false, error: 'file-already-complete' }
  }

  ucLog(`resume-with-fresh-url: downloadId=${payload.downloadId} url=${payload.url} offset=${actualOffset} savePath=${savePath}`, 'info')

  // Register auth header for pixeldrain authenticated downloads
  if (payload.authHeader && payload.url.includes('pixeldrain.com')) {
    const fileId = extractPixeldrainFileIdFromUrl(payload.url)
    if (fileId) pixeldrainAuthHeaders.set(fileId, payload.authHeader)
  }

  pendingDownloads.push({
    url: payload.url,
    normalizedUrl: normalizeDownloadUrl(payload.url),
    downloadId: payload.downloadId,
    filename: payload.filename || path.basename(savePath),
    appid: payload.appid,
    gameName: payload.gameName,
    partIndex: payload.partIndex,
    partTotal: payload.partTotal,
    authHeader: payload.authHeader,
    savePath,
    urlChain: [payload.url]
  })

  try {
    // Use createInterruptedDownload with the fresh URL. We intentionally pass empty
    // eTag/lastModified because this is a brand-new URL - stale metadata from the
    // original session would cause the server to reject the Range request.
    win.webContents.session.createInterruptedDownload({
      path: savePath,
      urlChain: [payload.url],
      mimeType: '',
      offset: actualOffset,
      length: payload.totalBytes || 0,
      lastModified: '',
      eTag: '',
      startTime: Date.now()
    })
    return { ok: true, actualOffset }
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

ipcMain.handle('uc:download-cache-clear', async () => {
  return clearDownloadCache()
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
    } catch { }
    // mark as pending install
    manifest.installedAt = manifest.installedAt || null
    uc_writeJsonSync(manifestPath, manifest);
    // attempt to download and save remote media locally into the installing folder
    ;(async () => {
      try {
        const updated = await cacheMetadataAssets(metadata, installingRoot, manifestPath, downloadRoot)
        if (updated) {
          const imagePath = readJsonFile(manifestPath)?.metadata?.localImage
          if (imagePath) {
            const checksum = await computeFileChecksum(imagePath)
            if (checksum) {
              const m = readJsonFile(manifestPath) || {}
              m.metadata = m.metadata || {}
              m.metadata.imageChecksum = checksum
              uc_writeJsonSync(manifestPath, m)
            }
          }
        }
      } catch {
        // ignore download failures
      }
    })()
    return { ok: true }
  } catch (err) {
    console.error('[UC] installed-save failed', err)
    return { ok: false }
  }
})

// Update metadata for an already-installed game (used by Edit Details for external games)
ipcMain.handle('uc:installed-update-metadata', async (_event, appid, updates) => {
  try {
    if (!appid || !updates) return { ok: false, error: 'Missing parameters' }
    const roots = listDownloadRoots()
    for (const baseRoot of roots) {
      const root = path.join(baseRoot, installedDirName)
      for (const { folder } of iterateGameFolders(root)) {
        const manifestPath = path.join(folder, INSTALLED_MANIFEST)
        const manifest = readJsonFile(manifestPath)
        if (!manifest || manifest.appid !== appid) continue

        // Merge updates into metadata
        manifest.metadata = manifest.metadata || {}
        for (const key of Object.keys(updates)) {
          if (updates[key] !== undefined) {
            manifest.metadata[key] = updates[key]
          }
        }
        // Also update top-level name if changed
        if (updates.name) manifest.name = updates.name

        try { manifest.metadataHash = computeObjectHash(manifest.metadata) } catch { }
        uc_writeJsonSync(manifestPath, manifest)

        // Cache image/splash/screenshots if present in metadata updates
        try {
          await cacheMetadataAssets(manifest.metadata, folder, manifestPath, baseRoot)
        } catch { }

        try { updateInstalledIndex(root) } catch { }
        return { ok: true }
      }
    }
    return { ok: false, error: 'Game not found in installed manifests' }
  } catch (err) {
    console.error('[UC] installed-update-metadata failed', err)
    return { ok: false, error: err.message || 'Failed to update metadata' }
  }
})

// Add an external game (downloaded outside UC.Direct or from the web version)
ipcMain.handle('uc:add-external-game', async (_event, appid, metadata, gamePath) => {
  try {
    if (!appid || !metadata || !gamePath) {
      return { ok: false, error: 'Missing required parameters' }
    }

    // Validate the path exists
    if (!fs.existsSync(gamePath)) {
      return { ok: false, error: 'The selected folder does not exist' }
    }

    const downloadRoot = ensureDownloadDir()
    const folderName = safeFolderName((metadata && (metadata.name || metadata.gameName)) || appid || 'external')
    const installedRoot = path.join(downloadRoot, installedDirName)
    if (!fs.existsSync(installedRoot)) {
      fs.mkdirSync(installedRoot, { recursive: true })
    }

    const gameFolder = path.join(installedRoot, folderName)
    if (!fs.existsSync(gameFolder)) {
      fs.mkdirSync(gameFolder, { recursive: true })
    }

    const manifestPath = path.join(gameFolder, INSTALLED_MANIFEST)
    const manifest = {
      appid: appid,
      name: metadata.name || metadata.gameName || appid,
      metadata: metadata,
      installStatus: 'installed',
      installedAt: Date.now(),
      addedAt: Date.now(),
      externalPath: gamePath,
      isExternal: true,
    }

    // Compute metadata hash
    try {
      manifest.metadataHash = computeObjectHash(metadata)
    } catch { }

    uc_writeJsonSync(manifestPath, manifest)

    // Create a symlink or junction to the external game folder so exe discovery works
    const linkPath = path.join(gameFolder, 'game')
    try {
      // Remove existing link/dir if present
      if (fs.existsSync(linkPath)) {
        const stat = fs.lstatSync(linkPath)
        if (stat.isSymbolicLink() || stat.isDirectory()) {
          try { fs.unlinkSync(linkPath) } catch { try { fs.rmdirSync(linkPath) } catch { } }
        }
      }
      // Use junction on Windows (no admin needed), symlink on others
      if (process.platform === 'win32') {
        fs.symlinkSync(gamePath, linkPath, 'junction')
      } else {
        fs.symlinkSync(gamePath, linkPath, 'dir')
      }
    } catch (linkErr) {
      console.warn('[UC] Could not create link to external game folder:', linkErr.message)
      // Not fatal - the externalPath in manifest can still be used
    }

    // Attempt to download and save remote media locally
    try {
      await cacheMetadataAssets(metadata, gameFolder, manifestPath, downloadRoot)
    } catch (imgErr) {
      console.warn('[UC] Could not download media for external game:', imgErr.message)
    }

    // Update installed index
    try { updateInstalledIndex(installedRoot) } catch { }

    return { ok: true }
  } catch (err) {
    console.error('[UC] add-external-game failed', err)
    return { ok: false, error: err.message || 'Failed to add external game' }
  }
})

// Pick folder dialog for external game
ipcMain.handle('uc:pick-external-game-folder', async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Select Game Folder',
      properties: ['openDirectory'],
      buttonLabel: 'Select Folder'
    })
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  } catch (err) {
    console.error('[UC] pick-external-game-folder failed', err)
    return null
  }
})

// Pick an image file for game metadata
ipcMain.handle('uc:pick-image', async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Select Image',
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      buttonLabel: 'Select Image'
    })
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  } catch (err) {
    console.error('[UC] pick-image failed', err)
    return null
  }
})

// Pick archive files for manual game installation
ipcMain.handle('uc:pick-archive-files', async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Select Archive Files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Archives', extensions: ['7z', 'tar', 'gz', 'tgz', '001', '002', '003', '004', '005', '006', '007', '008', '009', '010'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      buttonLabel: 'Select Archives'
    })
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { ok: false, cancelled: true }
    }
    // Return file info for each selected file
    const files = []
    for (const fp of result.filePaths) {
      try {
        const st = fs.statSync(fp)
        files.push({ path: fp, name: path.basename(fp), size: st.size })
      } catch {
        files.push({ path: fp, name: path.basename(fp), size: 0 })
      }
    }
    return { ok: true, files }
  } catch (err) {
    console.error('[UC] pick-archive-files failed', err)
    return { ok: false, error: String(err) }
  }
})

// Install a game from user-provided archive files (single or multipart)
ipcMain.handle('uc:install-from-archive', async (_event, payload) => {
  const win = mainWindow
  if (!win || win.isDestroyed()) return { ok: false, error: 'no_window' }
  if (!payload || !Array.isArray(payload.archivePaths) || payload.archivePaths.length === 0) {
    return { ok: false, error: 'missing_archive_paths' }
  }

  const appid = payload.appid || 'manual-install'
  const gameName = payload.gameName || appid
  const archivePaths = payload.archivePaths
  const metadata = payload.metadata || { appid, name: gameName }
  const downloadId = payload.downloadId || `archive-install-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`

  // Validate all paths exist
  for (const fp of archivePaths) {
    if (!fs.existsSync(fp)) {
      return { ok: false, error: `File not found: ${path.basename(fp)}` }
    }
  }

  // For multipart: verify all parts are in the same directory
  const dirs = new Set(archivePaths.map(fp => path.dirname(fp)))
  if (dirs.size > 1) {
    return { ok: false, error: 'All archive parts must be in the same folder. Please move them together and try again.' }
  }

  // Determine the archive to extract
  // For multipart (.001, .002, etc.), sort and use .001 as the entry point
  const isMultipart = archivePaths.length > 1 || archivePaths.some(fp => isMultipartPartPath(fp))
  let archiveToExtract
  let partFiles = null

  if (isMultipart) {
    // Sort parts numerically
    const sorted = [...archivePaths].sort((a, b) => {
      const numA = parseInt((a.match(/\.(\d{3})$/) || ['', '0'])[1], 10)
      const numB = parseInt((b.match(/\.(\d{3})$/) || ['', '0'])[1], 10)
      return numA - numB
    })
    // If user only selected .001, scan the folder for sibling parts
    if (sorted.length === 1 && isMultipartPartPath(sorted[0])) {
      const dir = path.dirname(sorted[0])
      const baseName = path.basename(sorted[0]).replace(/\.\d{3}$/, '')
      try {
        const entries = fs.readdirSync(dir)
        const siblingParts = entries
          .filter(e => e.startsWith(baseName + '.') && /\.\d{3}$/.test(e))
          .map(e => path.join(dir, e))
          .sort()
        if (siblingParts.length > 1) {
          partFiles = siblingParts
          archiveToExtract = siblingParts[0]
        } else {
          archiveToExtract = sorted[0]
          partFiles = sorted
        }
      } catch {
        archiveToExtract = sorted[0]
        partFiles = sorted
      }
    } else {
      archiveToExtract = sorted[0]
      partFiles = sorted
    }
  } else {
    archiveToExtract = archivePaths[0]
  }

  // Calculate total size
  const allFiles = partFiles || [archiveToExtract]
  let totalBytes = 0
  for (const fp of allFiles) {
    try { totalBytes += fs.statSync(fp).size } catch { }
  }

  // Prepare installed folder
  const downloadRoot = ensureDownloadDir()
  const folderName = safeFolderName(gameName || appid)
  const installedRoot = ensureSubdir(path.join(downloadRoot, installedDirName), folderName)

  ucLog(`[Archive Install] Starting: appid=${appid} gameName=${gameName} files=${allFiles.length} totalBytes=${totalBytes} dest=${installedRoot}`)

  // Send initial extracting status
  sendDownloadUpdate(win, {
    downloadId,
    status: 'extracting',
    receivedBytes: 0,
    totalBytes,
    speedBps: 0,
    etaSeconds: null,
    filename: path.basename(archiveToExtract),
    savePath: archiveToExtract,
    appid,
    gameName
  })

  // Run extraction
  let _lastBytes = 0
  let _lastTime = Date.now()
  let _lastSpeed = 0
  let _pollTimer = null

  try {
    _pollTimer = setInterval(() => {
      getDirectorySize(installedRoot).then((size) => {
        try {
          const now = Date.now()
          const deltaBytes = Math.max(0, size - _lastBytes)
          const deltaSec = Math.max(0.001, (now - _lastTime) / 1000)
          const instSpeed = deltaBytes / deltaSec
          const speedBps = _lastSpeed > 0 ? _lastSpeed * 0.7 + instSpeed * 0.3 : instSpeed
          _lastSpeed = speedBps
          _lastBytes = size
          _lastTime = now
          const etaSeconds = speedBps > 0 ? Math.max(0, Math.round((totalBytes - size) / speedBps)) : null
          sendDownloadUpdate(win, {
            downloadId, status: 'extracting', receivedBytes: size, totalBytes,
            speedBps: Math.round(speedBps), etaSeconds,
            filename: path.basename(archiveToExtract), savePath: archiveToExtract, appid, gameName
          })
        } catch { }
      }).catch(() => { })
    }, 500)
  } catch { }

  const res = await run7zExtract(archiveToExtract, installedRoot, ({ percent }) => {
    try {
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
      sendDownloadUpdate(win, {
        downloadId, status: 'extracting', receivedBytes: received, totalBytes,
        speedBps: Math.round(speedBps), etaSeconds,
        filename: path.basename(archiveToExtract), savePath: archiveToExtract, appid, gameName
      })
    } catch { }
  })

  try { if (_pollTimer) clearInterval(_pollTimer) } catch { }

  if (res && res.ok) {
    ucLog(`[Archive Install] Extraction succeeded: ${(res.files || []).length} files`)
    const extractedFiles = res.files || []
    const fileEntries = []
    for (const ef of extractedFiles) {
      try {
        const stats = fs.existsSync(ef) ? fs.statSync(ef) : null
        fileEntries.push({
          path: ef, name: path.basename(ef),
          size: stats ? stats.size : 0, checksum: null, addedAt: Date.now()
        })
      } catch { }
    }

    // Ensure metadata has appid and name
    const metaForManifest = { ...metadata, appid, name: gameName }
    if (fileEntries.length > 0) {
      updateInstalledManifestBulk(installedRoot, metaForManifest, fileEntries)
    } else {
      updateInstalledManifest(installedRoot, metaForManifest, null)
    }

    // Send completion
    sendDownloadUpdate(win, {
      downloadId, status: 'extracted', extracted: extractedFiles,
      savePath: null, appid, gameName
    })
    sendDownloadUpdate(win, {
      downloadId, status: 'completed',
      receivedBytes: totalBytes, totalBytes, speedBps: 0, etaSeconds: 0,
      filename: path.basename(archiveToExtract), savePath: null, appid, gameName
    })

    return { ok: true, downloadId, extracted: extractedFiles.length }
  } else {
    const errorMsg = res && res.error ? res.error : 'Extraction failed'
    ucLog(`[Archive Install] Extraction failed: ${errorMsg}`, 'error')
    sendDownloadUpdate(win, {
      downloadId, status: 'extract_failed', error: errorMsg,
      savePath: archiveToExtract, appid, gameName
    })
    return { ok: false, downloadId, error: errorMsg }
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

// Check whether an appid currently has an active extraction running in the main process, or
// an active/pending download.  The renderer uses this after a page reload to decide whether
// a "paused" item is really still being processed on the backend and should not be resumed.
ipcMain.handle('uc:download-active-status', (_event, appid) => {
  if (!appid) return { extracting: false, downloading: false }
  const extracting = [...activeExtractions].some((key) => {
    // activeExtractions stores archive paths; fall back to checking if the appid folder name matches
    const lower = String(key).toLowerCase()
    return lower.includes(String(appid).toLowerCase())
  })
  const downloading = hasActiveDownloadsForApp(appid)
  return { extracting, downloading }
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
    for (const { folder } of iterateGameFolders(root)) {
      const manifestPath = path.join(folder, INSTALLED_MANIFEST)
      const manifest = readJsonFile(manifestPath)
      if (manifest && manifest.appid === appid) {
        if (needsMediaCache(manifest.metadata || manifest)) {
          ;(async () => {
            try {
              await cacheMetadataAssets(manifest.metadata || manifest, folder, manifestPath, downloadRoot)
            } catch { }
          })()
        }
        return manifest
      }
    }
    return null
  } catch (err) {
    console.error('[UC] installed-get failed', err)
    return null
  }
})

ipcMain.handle('uc:installed-list-by-appid', (_event, appid) => {
  try {
    if (!appid) return []
    const roots = listDownloadRoots()
    const items = []
    const seen = new Set()
    for (const root of roots) {
      const installedRoot = path.join(root, installedDirName)
      for (const { folder } of iterateGameFolders(installedRoot)) {
        const manifestPath = path.join(folder, INSTALLED_MANIFEST)
        const manifest = readJsonFile(manifestPath)
        if (!manifest || manifest.appid !== appid) continue
        if (seen.has(manifestPath)) continue
        seen.add(manifestPath)
        items.push({ ...manifest, installedFolder: folder })
      }
    }
    return items
  } catch (err) {
    console.error('[UC] installed-list-by-appid failed', err)
    return []
  }
})

ipcMain.handle('uc:installed-list-global', (_event) => {
  try {
    const roots = listDownloadRoots()
    const bestByAppid = new Map() // appid -> manifest (keep richest)
    for (const root of roots) {
      const installedRoot = path.join(root, installedDirName)
      const items = listManifestsFromRoot(installedRoot, true)
      for (const item of items) {
        const key = item && item.appid ? item.appid : null
        if (!key) continue
        const existing = bestByAppid.get(key)
        if (!existing || manifestRichness(item) > manifestRichness(existing)) {
          bestByAppid.set(key, item)
        }
      }
    }
    return Array.from(bestByAppid.values())
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
      for (const { folder } of iterateGameFolders(installedRoot)) {
        const manifestPath = path.join(folder, INSTALLED_MANIFEST)
        const manifest = readJsonFile(manifestPath)
        if (manifest && manifest.appid === appid) {
          if (needsMediaCache(manifest.metadata || manifest)) {
            ;(async () => {
              try {
                await cacheMetadataAssets(manifest.metadata || manifest, folder, manifestPath, root)
              } catch { }
            })()
          }
          return manifest
        }
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
    const items = listManifestsFromRoot(root, false)
    return items.filter((item) => {
      const status = item && typeof item.installStatus === 'string' ? item.installStatus : null
      return status !== 'completed' && status !== 'extracted' && status !== 'cancelled'
    })
  } catch (err) {
    console.error('[UC] installing-list failed', err)
    return []
  }
})

ipcMain.handle('uc:installing-get', (_event, appid) => {
  try {
    const downloadRoot = ensureDownloadDir()
    const root = path.join(downloadRoot, installingDirName)
    for (const { folder } of iterateGameFolders(root)) {
      const manifestPath = path.join(folder, INSTALLED_MANIFEST)
      const manifest = readJsonFile(manifestPath)
      if (manifest && manifest.appid === appid) {
        const status = manifest.installStatus
        if (status === 'cancelled' || status === 'completed' || status === 'extracted') return null
        return manifest
      }
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
    const bestByAppid = new Map() // appid -> manifest (keep richest)
    for (const root of roots) {
      const installingRoot = path.join(root, installingDirName)
      const items = listManifestsFromRoot(installingRoot, false)
      for (const item of items) {
        const status = item && typeof item.installStatus === 'string' ? item.installStatus : null
        if (status === 'completed' || status === 'extracted' || status === 'cancelled') continue
        const key = item && item.appid ? item.appid : null
        if (!key) continue
        const existing = bestByAppid.get(key)
        if (!existing || manifestRichness(item) > manifestRichness(existing)) {
          bestByAppid.set(key, item)
        }
      }
    }
    return Array.from(bestByAppid.values())
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
      for (const { folder } of iterateGameFolders(installingRoot)) {
        const manifestPath = path.join(folder, INSTALLED_MANIFEST)
        const manifest = readJsonFile(manifestPath)
        if (manifest && manifest.appid === appid) {
          const status = manifest.installStatus
          if (status === 'cancelled' || status === 'completed' || status === 'extracted') return null
          return manifest
        }
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
    const resolvedFolder = findInstalledFolderByAppid(appid)
    if (!resolvedFolder) return { ok: false, error: 'not-found', exes: [] }

    // Try listing from the game folder - use depth 6 to handle deeply nested structures
    let exes = listExecutables(resolvedFolder, 6, 100)
    let effectiveFolder = resolvedFolder

    // If no exes found, check if there's a single subfolder wrapper (common after extraction)
    if (exes.length === 0) {
      try {
        const entries = fs.readdirSync(resolvedFolder, { withFileTypes: true })
        const subdirs = entries.filter(e => e.isDirectory())
        const files = entries.filter(e => e.isFile())
        // If there's only installed.json and one subdirectory, scan inside that
        if (subdirs.length === 1 && files.every(f => f.name === INSTALLED_MANIFEST)) {
          const subPath = path.join(resolvedFolder, subdirs[0].name)
          exes = listExecutables(subPath, 6, 100)
          if (exes.length > 0) effectiveFolder = subPath
        }
      } catch { }
    }

    // For external games, if no exes found via junction, try the externalPath directly
    if (exes.length === 0) {
      try {
        const manifestPath = path.join(resolvedFolder, INSTALLED_MANIFEST)
        const manifest = readJsonFile(manifestPath)
        const extPath = manifest?.externalPath || (manifest?.metadata?.externalPath)
        if (extPath && fs.existsSync(extPath)) {
          exes = listExecutables(extPath, 6, 100)
          return { ok: true, folder: extPath, exes }
        }
      } catch { }
    }

    return { ok: true, folder: effectiveFolder, exes }
  } catch (err) {
    console.error('[UC] game-exe-list failed', err)
    return { ok: false, error: 'failed', exes: [] }
  }
})

ipcMain.handle('uc:game-subfolder-find', (_event, folder) => {
  try {
    if (!folder || !fs.existsSync(folder)) return null

    // Check if folder only has installed.json and one subdirectory
    const entries = fs.readdirSync(folder, { withFileTypes: true })
    const subdirs = entries.filter(e => e.isDirectory())
    const files = entries.filter(e => e.isFile())

    // If there's only installed.json and one subdirectory, return that subdirectory
    if (files.length === 1 && files[0].name === INSTALLED_MANIFEST && subdirs.length === 1) {
      return path.join(folder, subdirs[0].name)
    }

    return null
  } catch (err) {
    console.error('[UC] game-subfolder-find failed', err)
    return null
  }
})

ipcMain.handle('uc:game-browse-exe', async (_event, defaultPath) => {
  try {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const filters = process.platform === 'win32'
      ? [{ name: 'Executables', extensions: ['exe'] }, { name: 'All files', extensions: ['*'] }]
      : [{ name: 'All files', extensions: ['*'] }]
    const result = await dialog.showOpenDialog(win, {
      title: 'Select game executable',
      defaultPath: defaultPath || undefined,
      filters,
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths?.length) return { ok: false }
    return { ok: true, path: result.filePaths[0] }
  } catch (err) {
    console.error('[UC] game-browse-exe failed', err)
    return { ok: false, error: String(err) }
  }
})

function normalizeRunnerPath(candidate, fallback) {
  if (!candidate || typeof candidate !== 'string') return fallback
  const trimmed = candidate.trim()
  if (!trimmed) return fallback
  // Only reject absolute paths that don't exist - relative/bare commands (e.g. 'wine', 'proton')
  // are resolved via PATH at spawn time, so we should not reject them here.
  if (path.isAbsolute(trimmed) && !fs.existsSync(trimmed)) {
    ucLog(`normalizeRunnerPath: absolute path not found: ${trimmed}, falling back to ${fallback}`, 'warn')
    return fallback
  }
  return trimmed
}

/**
 * Ensure the Proton environment is properly set up.
 * Proton requires STEAM_COMPAT_DATA_PATH and STEAM_COMPAT_CLIENT_INSTALL_PATH.
 * If not set, auto-detect from Steam installation.
 * 
 * @param {object} env - The environment object to modify
 * @param {string} [appid] - Optional game appid for per-game prefix (like Steam's compatdata)
 */
function ensureProtonEnv(env, appid) {
  if (process.platform !== 'linux') return env
  const result = { ...env }

  // Auto-detect Steam path if not set
  if (!result.STEAM_COMPAT_CLIENT_INSTALL_PATH) {
    const home = app.getPath('home')
    const steamCandidates = [
      path.join(home, '.steam', 'steam'),
      path.join(home, '.local', 'share', 'Steam'),
    ]
    for (const c of steamCandidates) {
      if (fs.existsSync(c)) {
        result.STEAM_COMPAT_CLIENT_INSTALL_PATH = c
        ucLog(`Proton: auto-set STEAM_COMPAT_CLIENT_INSTALL_PATH=${c}`)
        break
      }
    }
  }

  // Auto-create STEAM_COMPAT_DATA_PATH - use per-game prefix if appid provided
  // This mimics Steam's compatdata/{appid} structure
  if (!result.STEAM_COMPAT_DATA_PATH) {
    const home = app.getPath('home')
    let prefixPath
    if (appid) {
      // Per-game prefix: ~/.local/share/uc-proton/{appid}
      prefixPath = path.join(home, '.local', 'share', 'uc-proton', String(appid))
    } else {
      // Default prefix: ~/.local/share/uc-proton/default
      prefixPath = path.join(home, '.local', 'share', 'uc-proton', 'default')
    }
    try {
      if (!fs.existsSync(prefixPath)) {
        fs.mkdirSync(prefixPath, { recursive: true })
      }
    } catch {}
    result.STEAM_COMPAT_DATA_PATH = prefixPath
    ucLog(`Proton: auto-set STEAM_COMPAT_DATA_PATH=${prefixPath}${appid ? ' (per-game)' : ''}`)
  }

  return result
}

function resolveLaunchCommand(exePath) {
  const cwd = path.dirname(exePath)
  if (process.platform !== 'linux') {
    return { command: exePath, args: [], cwd }
  }

  const settings = readSettings() || {}
  const mode = String(settings.linuxLaunchMode || 'auto').toLowerCase()
  const winePath = normalizeRunnerPath(settings.linuxWinePath, 'wine')
  const protonPath = normalizeRunnerPath(settings.linuxProtonPath, '')
  const isExe = exePath.toLowerCase().endsWith('.exe')

  if (mode === 'native') {
    return { command: exePath, args: [], cwd }
  }

  if (isExe) {
    if (mode === 'proton') {
      if (!protonPath) {
        ucLog('Proton mode selected but no proton path configured - falling back to wine', 'warn')
        return { command: winePath, args: [exePath], cwd }
      }
      
      // Validate proton executable exists
      const protonExists = protonPath.includes('/') || protonPath.includes('\\') 
        ? fs.existsSync(protonPath) 
        : true // Bare command will be resolved at spawn time
      
      if (!protonExists) {
        ucLog(`Proton executable not found: ${protonPath}, falling back to wine`, 'error')
        return { command: winePath, args: [exePath], cwd }
      }
      
      ucLog(`Proton launch (global): path=${protonPath} exe=${exePath}`)
      return { command: protonPath, args: ['run', exePath], cwd, needsProtonEnv: true }
    }
    if (mode === 'wine' || mode === 'auto') {
      return { command: winePath, args: [exePath], cwd }
    }
  }

  return { command: exePath, args: [], cwd }
}

// ============================================================
// Linux Gaming Helpers
// ============================================================

/**
 * Build the environment object for Wine/Proton launches, merging in
 * WINEPREFIX, STEAM_COMPAT_DATA_PATH, STEAM_COMPAT_CLIENT_INSTALL_PATH,
 * and any user-defined extra env vars from settings.
 */
function buildLinuxGameEnv(baseEnv) {
  const settings = readSettings() || {}
  const env = { ...(baseEnv || process.env) }

  // WINEPREFIX
  const winePrefix = typeof settings.linuxWinePrefix === 'string' ? settings.linuxWinePrefix.trim() : ''
  if (winePrefix) env.WINEPREFIX = winePrefix

  // Proton prefix (STEAM_COMPAT_DATA_PATH)
  const protonPrefix = typeof settings.linuxProtonPrefix === 'string' ? settings.linuxProtonPrefix.trim() : ''
  if (protonPrefix) {
    env.STEAM_COMPAT_DATA_PATH = protonPrefix
  }

  // STEAM_COMPAT_CLIENT_INSTALL_PATH - needed by Proton
  const steamPath = typeof settings.linuxSteamPath === 'string' ? settings.linuxSteamPath.trim() : ''
  if (steamPath && !env.STEAM_COMPAT_CLIENT_INSTALL_PATH) {
    env.STEAM_COMPAT_CLIENT_INSTALL_PATH = steamPath
  }

  // If Proton mode is active, ensure required env vars are set
  // Note: appid is not available in global context, will use default prefix
  const mode = String(settings.linuxLaunchMode || 'auto').toLowerCase()
  if (mode === 'proton') {
    const withProton = ensureProtonEnv(env)
    Object.assign(env, withProton)
  }

  // Extra environment variables (stored as "KEY=VALUE\nKEY2=VALUE2")
  const extraEnv = typeof settings.linuxExtraEnv === 'string' ? settings.linuxExtraEnv.trim() : ''
  if (extraEnv) {
    for (const line of extraEnv.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx < 1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const value = trimmed.slice(eqIdx + 1).trim()
      if (key) env[key] = value
    }
  }

  // SLSsteam integration: inject LD_AUDIT when enabled
  if (settings.slsSteamEnabled && process.platform === 'linux') {
    const home = app.getPath('home')
    const defaultSlsDir = path.join(home, '.local', 'share', 'SLSsteam')
    const slsSteamPath = typeof settings.slsSteamPath === 'string' && settings.slsSteamPath.trim()
      ? settings.slsSteamPath.trim()
      : path.join(defaultSlsDir, 'SLSsteam.so')
    const slsInjectPath = typeof settings.slsInjectPath === 'string' && settings.slsInjectPath.trim()
      ? settings.slsInjectPath.trim()
      : path.join(defaultSlsDir, 'library-inject.so')

    if (fs.existsSync(slsSteamPath) && fs.existsSync(slsInjectPath)) {
      const ldAuditEntry = `${slsInjectPath}:${slsSteamPath}`
      const existing = env.LD_AUDIT || ''
      // Avoid duplicating entries
      if (!existing.includes(slsSteamPath)) {
        env.LD_AUDIT = existing ? `${existing}:${ldAuditEntry}` : ldAuditEntry
      }
      ucLog(`SLSsteam: injecting LD_AUDIT=${env.LD_AUDIT}`)
    } else {
      ucLog(`SLSsteam: enabled but .so files not found (slsSteamPath=${slsSteamPath}, slsInjectPath=${slsInjectPath})`, 'warn')
    }
  }

  return env
}

/**
 * Detect SLSsteam installation at the default path (~/.local/share/SLSsteam/).
 */
function detectSLSSteam() {
  if (process.platform !== 'linux') return { found: false }
  try {
    const home = app.getPath('home')
    const slsDir = path.join(home, '.local', 'share', 'SLSsteam')
    const slsSteamSo = path.join(slsDir, 'SLSsteam.so')
    const slsInjectSo = path.join(slsDir, 'library-inject.so')
    const found = fs.existsSync(slsSteamSo) && fs.existsSync(slsInjectSo)
    return {
      found,
      dir: found ? slsDir : null,
      slsSteamPath: found ? slsSteamSo : null,
      slsInjectPath: found ? slsInjectSo : null,
    }
  } catch (err) {
    return { found: false, error: err.message }
  }
}

/**
 * Detect installed Proton versions from common Steam library paths.
 * Returns an array of { label, path } objects.
 * Enhanced to match Heroic/Lutris behavior - scans more locations and returns sorted by version.
 */
function detectProtonVersions() {
  const results = []
  const home = app.getPath('home')
  
  // Steam library locations to scan (similar to Heroic/Lutris)
  const steamRoots = [
    path.join(home, '.steam', 'steam'),
    path.join(home, '.local', 'share', 'Steam'),
    path.join(home, '.steam', 'steamroot'),
    '/usr/share/steam',
    '/opt/steam',
  ]

  // Also check for Steam library folders defined in steamapps/libraryfolders.vdf
  const libraryFolders = new Set(steamRoots)
  
  // Parse libraryfolders.vdf if it exists to find additional Steam libraries
  for (const steamRoot of steamRoots) {
    const libraryFoldersPath = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf')
    if (fs.existsSync(libraryFoldersPath)) {
      try {
        const content = fs.readFileSync(libraryFoldersPath, 'utf8')
        const matches = content.match(/"path"\s+"([^"]+)"/g)
        if (matches) {
          for (const match of matches) {
            const folderPath = match.replace(/"path"\s+"/, '').replace(/"/, '')
            if (folderPath && fs.existsSync(folderPath)) {
              libraryFolders.add(folderPath)
            }
          }
        }
      } catch {}
    }
  }

  for (const steamRoot of libraryFolders) {
    const commonDir = path.join(steamRoot, 'steamapps', 'common')
    if (!fs.existsSync(commonDir)) continue
    try {
      const entries = fs.readdirSync(commonDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const lower = entry.name.toLowerCase()
        // Match Proton versions (Proton, Proton Experimental, etc.)
        if (!lower.startsWith('proton')) continue
        const protonScript = path.join(commonDir, entry.name, 'proton')
        if (fs.existsSync(protonScript)) {
          results.push({ label: entry.name, path: protonScript })
        }
        // Also check for proton script in bin directory
        const protonBin = path.join(commonDir, entry.name, 'bin', 'proton')
        if (fs.existsSync(protonBin)) {
          results.push({ label: entry.name, path: protonBin })
        }
      }
    } catch {}
  }

  // Sort results by version (newest first)
  results.sort((a, b) => {
    const aVersion = extractProtonVersion(a.label)
    const bVersion = extractProtonVersion(b.label)
    return compareVersions(bVersion, aVersion)
  })

  // Deduplicate by path
  const seen = new Set()
  const unique = []
  for (const r of results) {
    if (!seen.has(r.path)) {
      seen.add(r.path)
      unique.push(r)
    }
  }
  
  return unique
}

/**
 * Extract version number from Proton name for sorting
 */
function extractProtonVersion(name) {
  const match = name.match(/(\d+\.\d+)/)
  return match ? match[1] : '0.0'
}

/**
 * Detect common Wine installations on the system.
 */
function detectWineVersions() {
  const results = []
  const candidates = [
    { label: 'System wine', path: 'wine' },
    { label: 'System wine64', path: 'wine64' },
  ]

  // Check /usr/bin and /usr/local/bin
  const binDirs = ['/usr/bin', '/usr/local/bin', '/opt/wine/bin', '/opt/wine-staging/bin', '/opt/wine-tkg/bin']
  for (const dir of binDirs) {
    for (const name of ['wine', 'wine64', 'wine-stable', 'wine-staging']) {
      const full = path.join(dir, name)
      if (fs.existsSync(full)) {
        const label = `${name} (${dir})`
        if (!results.some(r => r.path === full)) {
          results.push({ label, path: full })
        }
      }
    }
  }

  // Deduplicate against candidates
  for (const c of candidates) {
    if (!results.some(r => r.path === c.path)) {
      results.push(c)
    }
  }

  return results
}

/**
 * Run a Linux tool (winetricks, protontricks, winecfg, etc.) with the
 * appropriate environment variables applied.
 */
function runLinuxTool(toolCmd, toolArgs, env, opts) {
  return new Promise((resolve) => {
    try {
      const proc = child_process.spawn(toolCmd, toolArgs || [], {
        detached: true,
        stdio: opts && opts.captureOutput ? ['ignore', 'pipe', 'pipe'] : 'ignore',
        env: env || process.env,
        cwd: opts && opts.cwd ? opts.cwd : undefined,
      })

      if (opts && opts.captureOutput) {
        let stdout = ''
        let stderr = ''
        proc.stdout && proc.stdout.on('data', (d) => { stdout += String(d) })
        proc.stderr && proc.stderr.on('data', (d) => { stderr += String(d) })
        proc.on('close', (code) => resolve({ ok: code === 0, code, stdout, stderr }))
        proc.on('error', (err) => resolve({ ok: false, error: err.message }))
      } else {
        proc.unref()
        resolve({ ok: true, pid: proc.pid })
        proc.on('error', () => {})
      }
    } catch (err) {
      resolve({ ok: false, error: err.message })
    }
  })
}

// IPC: Detect Proton versions (enhanced with auto-apply similar to Heroic/Lutris)
ipcMain.handle('uc:linux-detect-proton', async () => {
  try {
    if (process.platform !== 'linux') return { ok: false, error: 'not-linux', versions: [] }
    const versions = detectProtonVersions()
    
    // Auto-apply: if no proton path is configured, use the best available one
    const settings = readSettings() || {}
    const currentProtonPath = settings.linuxProtonPath || ''
    
    // If no proton path is set and we found some, auto-select the first (newest) one
    if (!currentProtonPath && versions.length > 0) {
      const bestProton = versions[0] // Already sorted by version
      settings.linuxProtonPath = bestProton.path
      settings.linuxLaunchMode = 'proton'
      writeSettings(settings)
      ucLog(`Proton: auto-detected and applied ${bestProton.label} (${bestProton.path})`)
      return { 
        ok: true, 
        versions, 
        autoApplied: true, 
        appliedVersion: bestProton 
      }
    }
    
    return { ok: true, versions }
  } catch (err) {
    return { ok: false, error: err.message, versions: [] }
  }
})

// IPC: Detect Wine versions
ipcMain.handle('uc:linux-detect-wine', () => {
  try {
    if (process.platform !== 'linux') return { ok: false, error: 'not-linux', versions: [] }
    const versions = detectWineVersions()
    return { ok: true, versions }
  } catch (err) {
    return { ok: false, error: err.message, versions: [] }
  }
})

// IPC: Run winecfg
ipcMain.handle('uc:linux-winecfg', async () => {
  try {
    if (process.platform !== 'linux') return { ok: false, error: 'not-linux' }
    const settings = readSettings() || {}
    const winePath = normalizeRunnerPath(settings.linuxWinePath, 'wine')
    const wineDir = path.isAbsolute(winePath) ? path.dirname(winePath) : null
    let winecfgCmd = 'winecfg'
    if (wineDir) {
      const candidate = path.join(wineDir, 'winecfg')
      try {
        fs.accessSync(candidate, fs.constants.X_OK)
        winecfgCmd = candidate
      } catch {
        // If the candidate is not accessible/executable, fall back to the default 'winecfg'
      }
    }
    const env = buildLinuxGameEnv(process.env)
    ucLog(`Running winecfg: ${winecfgCmd}`)
    const result = await runLinuxTool(winecfgCmd, [], env, {})
    return result
  } catch (err) {
    ucLog(`winecfg failed: ${err.message}`, 'error')
    return { ok: false, error: err.message }
  }
})

// IPC: Run winetricks
ipcMain.handle('uc:linux-winetricks', async (_event, packages) => {
  try {
    if (process.platform !== 'linux') return { ok: false, error: 'not-linux' }
    const env = buildLinuxGameEnv(process.env)
    const args = Array.isArray(packages) && packages.length > 0 ? packages : []
    ucLog(`Running winetricks: ${args.join(' ')}`)
    const result = await runLinuxTool('winetricks', args, env, {})
    return result
  } catch (err) {
    ucLog(`winetricks failed: ${err.message}`, 'error')
    return { ok: false, error: err.message }
  }
})

// IPC: Run protontricks
ipcMain.handle('uc:linux-protontricks', async (_event, appId, packages) => {
  try {
    if (process.platform !== 'linux') return { ok: false, error: 'not-linux' }
    const env = buildLinuxGameEnv(process.env)
    const args = []
    if (appId) args.push(String(appId))
    if (Array.isArray(packages) && packages.length > 0) args.push(...packages)
    ucLog(`Running protontricks: ${args.join(' ')}`)
    const result = await runLinuxTool('protontricks', args, env, {})
    return result
  } catch (err) {
    ucLog(`protontricks failed: ${err.message}`, 'error')
    return { ok: false, error: err.message }
  }
})

// IPC: Create a new WINEPREFIX
ipcMain.handle('uc:linux-create-prefix', async (_event, prefixPath, arch) => {
  try {
    if (process.platform !== 'linux') return { ok: false, error: 'not-linux' }
    if (!prefixPath || typeof prefixPath !== 'string') return { ok: false, error: 'invalid-path' }
    const settings = readSettings() || {}
    const winePath = normalizeRunnerPath(settings.linuxWinePath, 'wine')
    const env = buildLinuxGameEnv(process.env)
    env.WINEPREFIX = prefixPath
    if (arch === '32' || arch === 'win32') env.WINEARCH = 'win32'
    else env.WINEARCH = 'win64'
    ucLog(`Creating WINEPREFIX at ${prefixPath} (arch=${env.WINEARCH})`)

    // Determine the correct wineboot executable corresponding to the configured winePath.
    const winebootPath = (() => {
      if (!winePath || typeof winePath !== 'string') return 'wineboot'
      // If winePath looks like a filesystem path (absolute or contains a path separator),
      // use the same directory and replace the basename with "wineboot".
      if (path.isAbsolute(winePath) || winePath.includes('/') || winePath.includes('\\')) {
        return path.join(path.dirname(winePath), 'wineboot')
      }
      // For bare command names (e.g. "wine", "wine64"), just call "wineboot"
      return 'wineboot'
    })()

    // wineboot -i initializes the prefix
    const result = await runLinuxTool(winebootPath, ['-i'], env, { captureOutput: true })
    return result
  } catch (err) {
    ucLog(`create-prefix failed: ${err.message}`, 'error')
    return { ok: false, error: err.message }
  }
})

// IPC: Initialize default proton prefix (copies from source or creates fresh)
ipcMain.handle('uc:linux-init-default-proton-prefix', async (_event, sourcePrefixPath) => {
  try {
    if (process.platform !== 'linux') return { ok: false, error: 'not-linux' }
    const home = app.getPath('home')
    const defaultPrefix = path.join(home, '.local', 'share', 'uc-proton', 'default')
    
    // If default already exists, don't overwrite
    if (fs.existsSync(defaultPrefix)) {
      ucLog(`Default proton prefix already exists at ${defaultPrefix}`)
      return { ok: true, path: defaultPrefix, alreadyExisted: true }
    }
    
    // If source path provided and exists, copy it
    if (sourcePrefixPath && typeof sourcePrefixPath === 'string') {
      if (fs.existsSync(sourcePrefixPath)) {
        ucLog(`Copying default proton prefix from ${sourcePrefixPath} to ${defaultPrefix}`)
        await fs.promises.cp(sourcePrefixPath, defaultPrefix, { recursive: true })
        return { ok: true, path: defaultPrefix, copied: true }
      }
    }
    
    // Create fresh default prefix directory
    ucLog(`Creating default proton prefix at ${defaultPrefix}`)
    fs.mkdirSync(defaultPrefix, { recursive: true })
    return { ok: true, path: defaultPrefix, created: true }
  } catch (err) {
    ucLog(`init-default-proton-prefix failed: ${err.message}`, 'error')
    return { ok: false, error: err.message }
  }
})

// IPC: Get default proton prefix path
ipcMain.handle('uc:linux-get-default-proton-prefix-path', async () => {
  try {
    if (process.platform !== 'linux') return { ok: false, error: 'not-linux' }
    const home = app.getPath('home')
    const defaultPrefix = path.join(home, '.local', 'share', 'uc-proton', 'default')
    return { ok: true, path: defaultPrefix }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// IPC: Pick a directory for WINEPREFIX or Proton prefix
ipcMain.handle('uc:linux-pick-prefix-dir', async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Select Prefix Directory',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths?.length) return { ok: false, cancelled: true }
    return { ok: true, path: result.filePaths[0] }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// IPC: Pick a file (for wine/proton binary)
ipcMain.handle('uc:linux-pick-binary', async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Select Binary',
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths?.length) return { ok: false, cancelled: true }
    return { ok: true, path: result.filePaths[0] }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// IPC: Check if a tool is available on PATH
ipcMain.handle('uc:linux-check-tool', async (_event, toolName) => {
  try {
    if (process.platform !== 'linux') return { ok: false, available: false }
    const result = await new Promise((resolve) => {
      const proc = child_process.spawn('which', [toolName], { stdio: ['ignore', 'pipe', 'ignore'] })
      let out = ''
      proc.stdout && proc.stdout.on('data', (d) => { out += String(d) })
      proc.on('close', (code) => resolve({ available: code === 0, path: out.trim() }))
      proc.on('error', () => resolve({ available: false }))
    })
    return { ok: true, ...result }
  } catch (err) {
    return { ok: false, available: false, error: err.message }
  }
})

// IPC: Get Steam install path (for Proton)
ipcMain.handle('uc:linux-steam-path', () => {
  try {
    if (process.platform !== 'linux') return { ok: false, error: 'not-linux' }
    const home = app.getPath('home')
    const candidates = [
      path.join(home, '.steam', 'steam'),
      path.join(home, '.local', 'share', 'Steam'),
    ]
    for (const c of candidates) {
      if (fs.existsSync(c)) return { ok: true, path: c }
    }
    return { ok: false, error: 'not-found' }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// IPC: Detect SLSsteam installation
ipcMain.handle('uc:linux-detect-slssteam', () => {
  try {
    const result = detectSLSSteam()
    return { ok: true, ...result }
  } catch (err) {
    return { ok: false, error: err.message, found: false }
  }
})

// IPC: Pick a .so file (for SLSsteam paths)
ipcMain.handle('uc:linux-pick-so', async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Select .so Library',
      properties: ['openFile'],
      filters: [
        { name: 'Shared Libraries', extensions: ['so'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (result.canceled || !result.filePaths?.length) return { ok: false, cancelled: true }
    return { ok: true, path: result.filePaths[0] }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ============================================================
// SteamVR / OpenXR / VR Helpers
// ============================================================

/**
 * Detect SteamVR installation paths on Linux and Windows.
 * Returns the SteamVR directory and the vrserver executable if found.
 */
function detectSteamVR() {
  const home = process.platform !== 'win32' ? app.getPath('home') : null
  const candidates = []

  if (process.platform === 'linux') {
    candidates.push(
      path.join(home, '.steam', 'steam', 'steamapps', 'common', 'SteamVR'),
      path.join(home, '.local', 'share', 'Steam', 'steamapps', 'common', 'SteamVR'),
    )
  } else if (process.platform === 'win32') {
    // Common Steam install locations on Windows
    const drives = ['C', 'D', 'E']
    for (const d of drives) {
      candidates.push(
        `${d}:\\Program Files (x86)\\Steam\\steamapps\\common\\SteamVR`,
        `${d}:\\Steam\\steamapps\\common\\SteamVR`,
      )
    }
    // Also check registry-based Steam path via env
    const steamPath = process.env.STEAM_PATH || process.env.SteamPath
    if (steamPath) candidates.push(path.join(steamPath, 'steamapps', 'common', 'SteamVR'))
  } else if (process.platform === 'darwin') {
    candidates.push(
      path.join(home, 'Library', 'Application Support', 'Steam', 'steamapps', 'common', 'SteamVR'),
    )
  }

  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue
    // Find the vrserver executable
    const vrserverCandidates = [
      path.join(dir, 'bin', 'linux64', 'vrserver'),
      path.join(dir, 'bin', 'win64', 'vrserver.exe'),
      path.join(dir, 'bin', 'osx64', 'vrserver'),
    ]
    const vrserver = vrserverCandidates.find(p => fs.existsSync(p)) || null
    // Find the vrstartup script
    const startupCandidates = [
      path.join(dir, 'bin', 'linux64', 'vrstartup.sh'),
      path.join(dir, 'bin', 'win64', 'vrstartup.exe'),
    ]
    const startup = startupCandidates.find(p => fs.existsSync(p)) || null
    return { found: true, dir, vrserver, startup }
  }
  return { found: false, dir: null, vrserver: null, startup: null }
}

/**
 * Detect OpenXR runtime JSON files on Linux.
 * Returns the active runtime JSON path if found.
 */
function detectOpenXRRuntime() {
  if (process.platform !== 'linux') return null
  const home = app.getPath('home')
  const candidates = [
    // SteamVR OpenXR runtime
    path.join(home, '.steam', 'steam', 'steamapps', 'common', 'SteamVR', 'steamxr_linux64.json'),
    path.join(home, '.local', 'share', 'Steam', 'steamapps', 'common', 'SteamVR', 'steamxr_linux64.json'),
    // Monado
    '/usr/share/openxr/1/openxr_monado.json',
    '/usr/local/share/openxr/1/openxr_monado.json',
    // WiVRn
    path.join(home, '.config', 'openxr', '1', 'active_runtime.json'),
    // System active runtime
    '/etc/xdg/openxr/1/active_runtime.json',
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return null
}

/**
 * Build environment variables for VR game launches.
 * Merges SteamVR-specific env vars from settings.
 */
function buildVRGameEnv(baseEnv) {
  const settings = readSettings() || {}
  const env = { ...(baseEnv || process.env) }

  // XR_RUNTIME_JSON - OpenXR runtime
  const xrRuntime = typeof settings.vrXrRuntimeJson === 'string' ? settings.vrXrRuntimeJson.trim() : ''
  if (xrRuntime) env.XR_RUNTIME_JSON = xrRuntime

  // STEAM_VR_RUNTIME - SteamVR runtime path
  const steamVrRuntime = typeof settings.vrSteamVrRuntime === 'string' ? settings.vrSteamVrRuntime.trim() : ''
  if (steamVrRuntime) env.STEAM_VR_RUNTIME = steamVrRuntime

  // VR-specific extra env vars
  const vrExtraEnv = typeof settings.vrExtraEnv === 'string' ? settings.vrExtraEnv.trim() : ''
  if (vrExtraEnv) {
    for (const line of vrExtraEnv.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx < 1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const value = trimmed.slice(eqIdx + 1).trim()
      if (key) env[key] = value
    }
  }

  return env
}

// IPC: Detect SteamVR
ipcMain.handle('uc:vr-detect-steamvr', () => {
  try {
    const result = detectSteamVR()
    return { ok: true, ...result }
  } catch (err) {
    return { ok: false, error: err.message, found: false }
  }
})

// IPC: Detect OpenXR runtime
ipcMain.handle('uc:vr-detect-openxr', () => {
  try {
    const runtimePath = detectOpenXRRuntime()
    return { ok: true, found: Boolean(runtimePath), path: runtimePath }
  } catch (err) {
    return { ok: false, error: err.message, found: false }
  }
})

// IPC: Launch SteamVR
ipcMain.handle('uc:vr-launch-steamvr', async () => {
  try {
    const settings = readSettings() || {}
    const steamVrDir = typeof settings.vrSteamVrPath === 'string' && settings.vrSteamVrPath.trim()
      ? settings.vrSteamVrPath.trim()
      : detectSteamVR().dir

    if (!steamVrDir) return { ok: false, error: 'SteamVR not found. Set the SteamVR path in settings.' }

    const env = buildVRGameEnv(buildLinuxGameEnv(process.env))

    // Try to launch via Steam URL first (most reliable)
    if (process.platform === 'linux' || process.platform === 'darwin') {
      try {
        const proc = child_process.spawn('steam', ['steam://rungameid/250820'], {
          detached: true,
          stdio: 'ignore',
          env,
        })
        proc.unref()
        ucLog('SteamVR launched via steam:// URL')
        return { ok: true, method: 'steam-url' }
      } catch {}
    }

    // Fallback: launch vrserver directly
    const vrInfo = detectSteamVR()
    const startup = vrInfo.startup
    if (startup && fs.existsSync(startup)) {
      const proc = child_process.spawn(startup, [], {
        detached: true,
        stdio: 'ignore',
        cwd: path.dirname(startup),
        env,
      })
      proc.unref()
      ucLog(`SteamVR launched via startup script: ${startup}`)
      return { ok: true, method: 'startup-script' }
    }

    // Last resort: shell.openExternal
    await shell.openExternal('steam://rungameid/250820')
    return { ok: true, method: 'shell-open' }
  } catch (err) {
    ucLog(`SteamVR launch failed: ${err.message}`, 'error')
    return { ok: false, error: err.message }
  }
})

// IPC: Pick a file for XR runtime JSON or SteamVR path
ipcMain.handle('uc:vr-pick-runtime-json', async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Select OpenXR Runtime JSON',
      properties: ['openFile'],
      filters: [
        { name: 'JSON files', extensions: ['json'] },
        { name: 'All files', extensions: ['*'] },
      ],
    })
    if (result.canceled || !result.filePaths?.length) return { ok: false, cancelled: true }
    return { ok: true, path: result.filePaths[0] }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// IPC: Pick SteamVR directory
ipcMain.handle('uc:vr-pick-steamvr-dir', async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Select SteamVR Directory',
      properties: ['openDirectory'],
    })
    if (result.canceled || !result.filePaths?.length) return { ok: false, cancelled: true }
    return { ok: true, path: result.filePaths[0] }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// IPC: Check if a VR game should use VR mode (based on settings)
ipcMain.handle('uc:vr-get-settings', () => {
  try {
    const settings = readSettings() || {}
    return {
      ok: true,
      vrEnabled: Boolean(settings.vrEnabled),
      vrSteamVrPath: settings.vrSteamVrPath || '',
      vrXrRuntimeJson: settings.vrXrRuntimeJson || '',
      vrSteamVrRuntime: settings.vrSteamVrRuntime || '',
      vrExtraEnv: settings.vrExtraEnv || '',
      vrAutoLaunchSteamVr: Boolean(settings.vrAutoLaunchSteamVr),
    }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ============================================================
// Game Launch
// ============================================================

function launchTrackedGameProcess({ appid, exePath, gameName, showGameName, command, args, cwd, env }) {
  return new Promise((resolve, reject) => {
    try {
      const proc = child_process.spawn(command, Array.isArray(args) ? args : [], {
        shell: false,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        cwd,
        env
      })

      proc.once('spawn', () => {
        proc.unref()
        registerRunningGame(appid, exePath, proc, gameName, showGameName)
        ucLog(`Game launched successfully: ${appid} (PID: ${proc.pid})`)
        resolve({ ok: true, pid: proc.pid })
      })

      proc.once('error', reject)
    } catch (err) {
      reject(err)
    }
  })
}

function buildGameLaunchPreflight(appid, exePath) {
  const checks = []

  if (!exePath || typeof exePath !== 'string') {
    return {
      ok: true,
      canLaunch: false,
      checks: [{ level: 'error', code: 'invalid-exe-path', message: 'The selected executable path is invalid.' }],
      resolved: null,
    }
  }

  if (!fs.existsSync(exePath)) {
    return {
      ok: true,
      canLaunch: false,
      checks: [{ level: 'error', code: 'exe-not-found', message: 'The selected executable no longer exists on disk.' }],
      resolved: null,
    }
  }

  let stat = null
  try {
    stat = fs.statSync(exePath)
  } catch (err) {
    return {
      ok: true,
      canLaunch: false,
      checks: [{ level: 'error', code: 'exe-stat-failed', message: err?.message || 'Unable to inspect the selected executable.' }],
      resolved: null,
    }
  }

  if (!stat.isFile()) {
    checks.push({ level: 'error', code: 'exe-not-file', message: 'The selected path is not a file.' })
  }

  const basename = path.basename(exePath)
  const ext = path.extname(basename).toLowerCase()
  const suspiciousNamePattern = /(setup|install|unins|uninstall|redist|prereq|benchmark|config|dxsetup|vc_redist|crashreport)/i
  const likelyExecutableExtensions = new Set(['.exe', '.bat', '.cmd', '.com', '.sh', '.appimage'])

  if (ext && !likelyExecutableExtensions.has(ext) && ext !== '.lnk') {
    checks.push({
      level: 'warning',
      code: 'unusual-extension',
      message: `This file uses an unusual launch extension (${ext}). Make sure it is the actual game executable.`,
    })
  }

  if (ext === '.lnk') {
    checks.push({
      level: 'warning',
      code: 'shortcut-selected',
      message: 'A shortcut file was selected. Launching the real executable directly is usually more reliable.',
    })
  }

  if (suspiciousNamePattern.test(basename)) {
    checks.push({
      level: 'warning',
      code: 'suspicious-name',
      message: 'This filename looks like an installer, prerequisite, or helper executable rather than the main game binary.',
    })
  }

  let resolved = null
  try {
    resolved = appid ? resolveLaunchCommandWithGameConfig(exePath, appid) : resolveLaunchCommand(exePath)
    if (resolved?.cwd && !fs.existsSync(resolved.cwd)) {
      checks.push({ level: 'error', code: 'missing-working-directory', message: 'The launch working directory could not be found.' })
    }
  } catch (err) {
    checks.push({ level: 'error', code: 'resolve-launch-command-failed', message: err?.message || 'Unable to build the launch command.' })
  }

  if (process.platform !== 'win32') {
    try {
      fs.accessSync(exePath, fs.constants.X_OK)
    } catch {
      checks.push({
        level: 'warning',
        code: 'not-executable',
        message: 'This file is not marked as executable on the current system.',
      })
    }
  }

  return {
    ok: true,
    canLaunch: !checks.some((check) => check.level === 'error'),
    checks,
    resolved: resolved ? {
      command: resolved.command,
      args: Array.isArray(resolved.args) ? resolved.args : [],
      cwd: resolved.cwd,
    } : null,
  }
}

ipcMain.handle('uc:game-exe-preflight', async (_event, appid, exePath) => {
  try {
    return buildGameLaunchPreflight(appid, exePath)
  } catch (err) {
    return {
      ok: true,
      canLaunch: false,
      checks: [{ level: 'error', code: 'preflight-failed', message: err?.message || 'Launch preflight failed.' }],
      resolved: null,
    }
  }
})

ipcMain.handle('uc:game-exe-launch', async (_event, appid, exePath, gameName, showGameName) => {
  try {
    if (!exePath || typeof exePath !== 'string') return { ok: false }
    if (!fs.existsSync(exePath)) {
      ucLog(`Game launch failed: ${appid} - executable not found at ${exePath}`, 'error')
      return { ok: false, error: 'exe-not-found' }
    }
    ucLog(`Launching game: ${appid} at ${exePath}`)

    try {
      // Use per-game config overrides if available
      const { command, args, cwd } = appid
        ? resolveLaunchCommandWithGameConfig(exePath, appid)
        : resolveLaunchCommand(exePath)

      // Verbose logging
      const settings = readSettings() || {}
      if (settings.verboseDownloadLogging) {
        ucLog(`  Working directory: ${cwd}`, 'info')
        ucLog(`  Command: ${command}`, 'info')
        ucLog(`  Args: ${JSON.stringify(args)}`, 'info')
      }

      // Windows (non-admin): spawn the exe directly so we track the actual game process.
      if (process.platform === 'win32') {
        const env = { ...process.env }
        env.PATH = `${cwd};${env.PATH || ''}`

        return await launchTrackedGameProcess({
          appid,
          exePath,
          gameName,
          showGameName,
          command,
          args,
          cwd,
          env
        })
      }

      // Non-Windows path (Linux/macOS) - apply per-game + global Wine/Proton/VR/SLSsteam env vars
      const env = buildGameLaunchEnv(appid, process.env)
      env.PATH = `${cwd}:${env.PATH || ''}`

      return await launchTrackedGameProcess({
        appid,
        exePath,
        gameName,
        showGameName,
        command,
        args,
        cwd,
        env
      })
    } catch (err) {
      const res = await shell.openPath(exePath)
      if (res && typeof res === 'string' && res.length > 0) {
        ucLog(`Game launch failed: ${appid} - ${res}`, 'error')
        return { ok: false, error: res }
      }
      ucLog(`Game opened via shell: ${appid}`)
      return { ok: true }
    }
  } catch (err) {
    ucLog(`Game launch error: ${appid} - ${err.message}`, 'error')
    return { ok: false }
  }
})

ipcMain.handle('uc:game-exe-running', async (_event, appid) => {
  try {
    const running = getRunningGame(appid)
    if (!running) return { ok: true, running: false }
    const alive = await isProcessRunning(running.pid)
    if (!alive) {
      if (running.appid) runningGames.delete(running.appid)
      if (running.exePath) runningGames.delete(running.exePath)
      return { ok: true, running: false }
    }
    return { ok: true, running: true, pid: running.pid, exePath: running.exePath }
  } catch (err) {
    ucLog(`Game running check failed: ${appid} - ${err.message}`, 'error')
    return { ok: false, running: false }
  }
})

ipcMain.handle('uc:game-exe-quit', async (_event, appid) => {
  try {
    const running = getRunningGame(appid)
    if (!running) return { ok: true, stopped: false }
    let stopped = await killProcessTree(running.pid)
    if (!stopped) {
      const alive = await isProcessRunning(running.pid)
      if (!alive) stopped = true
    }
    if (stopped) {
      if (running.appid) runningGames.delete(running.appid)
      if (running.exePath) runningGames.delete(running.exePath)
      if (runningGames.size === 0) clearGameRpcActivity()
    }
    return { ok: true, stopped }
  } catch (err) {
    console.error('[UC] game-exe-quit failed', err)
    return { ok: false, stopped: false }
  }
})

ipcMain.handle('uc:installed-delete', async (_event, appid) => {
  try {
    let ok = false
    let updatedRoot = null
    const roots = listDownloadRoots()
    for (const baseRoot of roots) {
      const root = path.join(baseRoot, installedDirName)
      if (!fs.existsSync(root)) continue
      if (await deleteFolderByAppIdAsync(root, appid)) {
        ok = true
        updatedRoot = root
        break
      }
    }
    if (!ok) {
      const downloadRoot = ensureDownloadDir()
      const root = path.join(downloadRoot, installedDirName)
      ok = await deleteFolderByAppIdAsync(root, appid)
      if (ok) updatedRoot = root
    }
    if (ok && updatedRoot) {
      try { updateInstalledIndex(updatedRoot) } catch (e) { }
    }
    return { ok }
  } catch (err) {
    console.error('[UC] installed-delete failed', err)
    return { ok: false }
  }
})

ipcMain.handle('uc:installing-delete', async (_event, appid) => {
  try {
    let ok = false
    const roots = listDownloadRoots()
    for (const baseRoot of roots) {
      const root = path.join(baseRoot, installingDirName)
      if (!fs.existsSync(root)) continue
      if (await deleteFolderByAppIdAsync(root, appid)) {
        ok = true
        break
      }
    }
    if (!ok) {
      const downloadRoot = ensureDownloadDir()
      const root = path.join(downloadRoot, installingDirName)
      ok = await deleteFolderByAppIdAsync(root, appid)
    }
    return { ok }
  } catch (err) {
    console.error('[UC] installing-delete failed', err)
    return { ok: false }
  }
})

function sanitizeDesktopFileName(name) {
  if (!name || typeof name !== 'string') return 'UnionCrax-Game'
  return name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'UnionCrax-Game'
}

function buildDesktopExecLine(exePath) {
  const { command, args } = resolveLaunchCommand(exePath)
  const quote = (value) => `"${String(value).replace(/"/g, '\\"')}"`

  // For Wine/Proton on Linux, we need to ensure the working directory is set via environment
  // The Path= field in .desktop files should handle this, but we also wrap it to be safe
  const workingDir = path.dirname(exePath)

  // If using Wine/Proton, prepend cd command to ensure working directory
  if (process.platform === 'linux' && (command.includes('wine') || command.includes('proton'))) {
    const fullCmd = [command, ...args].map(quote).join(' ')
    return `sh -c 'cd "${workingDir.replace(/"/g, '\\"')}" && ${fullCmd}'`
  }

  return [command, ...args].map(quote).join(' ')
}

ipcMain.handle('uc:delete-desktop-shortcut', async (_event, gameName) => {
  try {
    if (!gameName || typeof gameName !== 'string') {
      ucLog('Invalid game name for shortcut deletion', 'error')
      return { ok: false, error: 'Invalid game name' }
    }

    const desktopPath = app.getPath('desktop')
    const shortcutName = process.platform === 'win32'
      ? `${gameName} - UC.lnk`
      : `${sanitizeDesktopFileName(gameName)} - UC.desktop`
    const shortcutPath = path.join(desktopPath, shortcutName)

    if (!fs.existsSync(shortcutPath)) {
      ucLog(`Desktop shortcut does not exist: ${shortcutPath}`)
      return { ok: true, notFound: true }
    }

    await fs.promises.unlink(shortcutPath)
    ucLog(`Desktop shortcut deleted: ${shortcutPath}`)
    return { ok: true }
  } catch (err) {
    ucLog(`Failed to delete desktop shortcut: ${err.message}`, 'error')
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('uc:create-desktop-shortcut', async (_event, gameName, exePath) => {
  try {
    if (!gameName || !exePath || typeof gameName !== 'string' || typeof exePath !== 'string') {
      ucLog('Invalid parameters for desktop shortcut creation', 'error')
      return { ok: false, error: 'Invalid parameters' }
    }

    if (!fs.existsSync(exePath)) {
      ucLog(`Executable not found for shortcut: ${exePath}`, 'error')
      return { ok: false, error: 'Executable not found' }
    }

    const desktopPath = app.getPath('desktop')
    const shortcutName = process.platform === 'win32'
      ? `${gameName} - UC.lnk`
      : `${sanitizeDesktopFileName(gameName)} - UC.desktop`
    const shortcutPath = path.join(desktopPath, shortcutName)

    // Check if shortcut already exists
    if (fs.existsSync(shortcutPath)) {
      ucLog(`Desktop shortcut already exists: ${shortcutPath}`)
      return { ok: true, existed: true }
    }

    // On Windows, create a .lnk shortcut using PowerShell
    if (process.platform === 'win32') {
      const safeExePath = exePath.replace(/'/g, "''")
      const safeShortcutPath = shortcutPath.replace(/'/g, "''")
      const workingDir = path.dirname(exePath).replace(/'/g, "''")

      // Log shortcut creation details
      const settings = readSettings() || {}
      if (settings.verboseDownloadLogging) {
        ucLog(`Creating Windows shortcut:`, 'info')
        ucLog(`  Target: ${exePath}`, 'info')
        ucLog(`  Working Dir: ${workingDir}`, 'info')
        ucLog(`  Shortcut Path: ${shortcutPath}`, 'info')
      }

      const psScript = `
        $WshShell = New-Object -ComObject WScript.Shell
        $Shortcut = $WshShell.CreateShortcut('${safeShortcutPath}')
        $Shortcut.TargetPath = '${safeExePath}'
        $Shortcut.WorkingDirectory = '${workingDir}'
        $Shortcut.Save()
      `

      return new Promise((resolve) => {
        const proc = child_process.spawn('powershell.exe', [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          psScript
        ], {
          detached: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true
        })

        let stdout = ''
        let stderr = ''

        proc.stdout?.on('data', (data) => {
          stdout += String(data)
        })

        proc.stderr?.on('data', (data) => {
          stderr += String(data)
        })

        proc.on('close', (code) => {
          if (code === 0 && fs.existsSync(shortcutPath)) {
            ucLog(`Desktop shortcut created successfully: ${shortcutPath}`)
            resolve({ ok: true })
          } else {
            ucLog(`Failed to create desktop shortcut: ${stderr || stdout}`, 'error')
            resolve({ ok: false, error: stderr || stdout || 'Unknown error' })
          }
        })

        proc.on('error', (err) => {
          ucLog(`Desktop shortcut creation error: ${err.message}`, 'error')
          resolve({ ok: false, error: err.message })
        })
      })
    } else {
      try {
        const iconPath = resolveIcon()
        const execLine = buildDesktopExecLine(exePath)
        const workingDir = path.dirname(exePath)
        const desktopEntry = `[Desktop Entry]\nType=Application\nName=${gameName}\nExec=${execLine}\nPath=${workingDir}\nIcon=${iconPath}\nTerminal=false\nCategories=Game;\n`;
        fs.writeFileSync(shortcutPath, desktopEntry, 'utf8')
        try { fs.chmodSync(shortcutPath, 0o755) } catch { }
        ucLog(`Desktop shortcut created successfully: ${shortcutPath}`)
        return { ok: true }
      } catch (err) {
        ucLog(`Desktop shortcut creation error: ${err.message}`, 'error')
        return { ok: false, error: err.message }
      }
    }
  } catch (err) {
    ucLog(`Desktop shortcut creation error: ${err.message}`, 'error')
    return { ok: false, error: err.message }
  }
})

// ============================================================
// Per-game Linux / VR configuration
// ============================================================

/**
 * Read per-game Linux config from settings.
 * Stored as `gameLinux:${appid}` in settings.json.
 */
function getGameLinuxConfig(appid) {
  if (!appid) return null
  try {
    const s = readSettings() || {}
    const raw = s[`gameLinux:${appid}`]
    if (!raw || typeof raw !== 'object') return null
    return raw
  } catch {
    return null
  }
}

/**
 * Resolve the effective launch command for a game, applying per-game overrides
 * on top of the global Linux settings.
 */
function resolveLaunchCommandWithGameConfig(exePath, appid) {
  const cwd = path.dirname(exePath)
  if (process.platform !== 'linux') {
    return { command: exePath, args: [], cwd }
  }

  const globalSettings = readSettings() || {}
  const gameConfig = getGameLinuxConfig(appid) || {}

  // 'inherit' means use global settings; otherwise per-game overrides take precedence
  const rawMode = gameConfig.launchMode && gameConfig.launchMode !== 'inherit'
    ? gameConfig.launchMode
    : globalSettings.linuxLaunchMode || 'auto'
  const mode = String(rawMode).toLowerCase()

  const winePath = normalizeRunnerPath(
    (gameConfig.winePath && gameConfig.winePath !== '') ? gameConfig.winePath : globalSettings.linuxWinePath,
    'wine'
  )
  const protonPath = normalizeRunnerPath(
    (gameConfig.protonPath && gameConfig.protonPath !== '') ? gameConfig.protonPath : globalSettings.linuxProtonPath,
    ''
  )
  const isExe = exePath.toLowerCase().endsWith('.exe')

  if (mode === 'native') {
    return { command: exePath, args: [], cwd }
  }

  if (isExe) {
    if (mode === 'proton') {
      if (!protonPath) {
        ucLog(`Proton mode for ${appid} but no proton path configured - falling back to wine`, 'warn')
        return { command: winePath, args: [exePath], cwd }
      }
      
      // Validate proton executable exists
      const protonExists = protonPath.includes('/') || protonPath.includes('\\') 
        ? fs.existsSync(protonPath) 
        : true // Bare command will be resolved at spawn time
      
      if (!protonExists) {
        ucLog(`Proton executable not found: ${protonPath}, falling back to wine`, 'error')
        return { command: winePath, args: [exePath], cwd }
      }
      
      ucLog(`Proton launch: path=${protonPath} exe=${exePath} prefix=~/.local/share/uc-proton/${appid || 'default'}`)
      return { command: protonPath, args: ['run', exePath], cwd, needsProtonEnv: true }
    }
    if (mode === 'wine' || mode === 'auto') {
      return { command: winePath, args: [exePath], cwd }
    }
  }

  return { command: exePath, args: [], cwd }
}

/**
 * Build the effective environment for a game launch, merging global and per-game settings.
 */
function buildGameLaunchEnv(appid, baseEnv) {
  // Start with global Linux + VR env
  const env = buildVRGameEnv(buildLinuxGameEnv(baseEnv || process.env))

  if (process.platform !== 'linux' || !appid) return env

  const globalSettings = readSettings() || {}
  const gameConfig = getGameLinuxConfig(appid) || {}

  // Per-game WINEPREFIX override
  const winePrefix = typeof gameConfig.winePrefix === 'string' ? gameConfig.winePrefix.trim() : ''
  if (winePrefix) env.WINEPREFIX = winePrefix

  // Per-game Proton prefix override
  const protonPrefix = typeof gameConfig.protonPrefix === 'string' ? gameConfig.protonPrefix.trim() : ''
  if (protonPrefix) env.STEAM_COMPAT_DATA_PATH = protonPrefix

  // Per-game extra env vars
  const extraEnv = typeof gameConfig.extraEnv === 'string' ? gameConfig.extraEnv.trim() : ''
  if (extraEnv) {
    for (const line of extraEnv.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx < 1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const value = trimmed.slice(eqIdx + 1).trim()
      if (key) env[key] = value
    }
  }

  // Per-game VR override
  if (typeof gameConfig.vrEnabled === 'boolean' && !gameConfig.vrEnabled) {
    // Explicitly disabled for this game - remove VR env vars
    delete env.XR_RUNTIME_JSON
    delete env.STEAM_VR_RUNTIME
  } else if (gameConfig.vrEnabled) {
    const xrRuntime = typeof gameConfig.vrXrRuntimeJson === 'string' ? gameConfig.vrXrRuntimeJson.trim() : ''
    if (xrRuntime) env.XR_RUNTIME_JSON = xrRuntime
  }

  // If effective mode is Proton, ensure required Proton env vars are set
  // Pass appid to enable per-game prefix creation
  const effectiveMode = (gameConfig.launchMode && gameConfig.launchMode !== 'inherit')
    ? gameConfig.launchMode
    : globalSettings.linuxLaunchMode || 'auto'
  if (String(effectiveMode).toLowerCase() === 'proton') {
    const withProton = ensureProtonEnv(env, appid)
    Object.assign(env, withProton)
  }

  return env
}

// IPC: Get per-game Linux config
ipcMain.handle('uc:game-linux-config-get', (_event, appid) => {
  try {
    if (!appid) return { ok: false, error: 'missing-appid' }
    const config = getGameLinuxConfig(appid)
    return { ok: true, config: config || {} }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// IPC: Set per-game Linux config
ipcMain.handle('uc:game-linux-config-set', (_event, appid, config) => {
  try {
    if (!appid) return { ok: false, error: 'missing-appid' }
    const s = readSettings() || {}
    const prev = { ...s }
    if (config === null || config === undefined) {
      delete s[`gameLinux:${appid}`]
    } else {
      s[`gameLinux:${appid}`] = config
    }
    writeSettings(s)
    broadcastSettingsChanges(s, prev)
    ucLog(`Per-game Linux config set for ${appid}`)
    return { ok: true }
  } catch (err) {
    ucLog(`Per-game Linux config set failed for ${appid}: ${err.message}`, 'error')
    return { ok: false, error: err.message }
  }
})

// ============================================================
// SLSteam integration
// ============================================================

const SLSSTEAM_GITHUB_URL = 'https://github.com/acesls/SLSsteam/releases/latest'

// IPC: Open SLSsteam GitHub releases page
ipcMain.handle('uc:linux-slssteam-download', async () => {
  try {
    await shell.openExternal(SLSSTEAM_GITHUB_URL)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// IPC: Set up a game folder for SLSsteam (create steam_appid.txt)
ipcMain.handle('uc:linux-slssteam-setup-game', async (_event, appid, steamAppId) => {
  try {
    if (!appid) return { ok: false, error: 'missing-appid' }

    // Find the installed game folder
    const gameFolder = findInstalledFolderByAppid(appid)
    if (!gameFolder) return { ok: false, error: 'game-not-found' }

    // Find the actual game directory (may be a subfolder)
    let targetDir = gameFolder
    try {
      const entries = fs.readdirSync(gameFolder, { withFileTypes: true })
      const subdirs = entries.filter(e => e.isDirectory() && e.name !== 'screenshots')
      const files = entries.filter(e => e.isFile())
      // If there's only installed.json and one subdirectory, use that subdirectory
      if (subdirs.length === 1 && files.every(f => f.name === INSTALLED_MANIFEST)) {
        targetDir = path.join(gameFolder, subdirs[0].name)
      }
    } catch {}

    // Write steam_appid.txt
    const steamAppIdStr = steamAppId ? String(steamAppId).trim() : '0'
    const steamAppIdPath = path.join(targetDir, 'steam_appid.txt')
    fs.writeFileSync(steamAppIdPath, steamAppIdStr, 'utf8')
    ucLog(`SLSsteam: wrote steam_appid.txt to ${steamAppIdPath} (appid=${steamAppIdStr})`)

    return { ok: true, path: steamAppIdPath, steamAppId: steamAppIdStr }
  } catch (err) {
    ucLog(`SLSsteam setup failed for ${appid}: ${err.message}`, 'error')
    return { ok: false, error: err.message }
  }
})

// IPC: Check if a game has steam_appid.txt set up
ipcMain.handle('uc:linux-slssteam-check-game', (_event, appid) => {
  try {
    if (!appid) return { ok: false, error: 'missing-appid' }
    const gameFolder = findInstalledFolderByAppid(appid)
    if (!gameFolder) return { ok: false, error: 'game-not-found' }

    // Check in game folder and one level of subdirectories
    const candidates = [gameFolder]
    try {
      const entries = fs.readdirSync(gameFolder, { withFileTypes: true })
      for (const e of entries) {
        if (e.isDirectory()) candidates.push(path.join(gameFolder, e.name))
      }
    } catch {}

    for (const dir of candidates) {
      const steamAppIdPath = path.join(dir, 'steam_appid.txt')
      if (fs.existsSync(steamAppIdPath)) {
        try {
          const content = fs.readFileSync(steamAppIdPath, 'utf8').trim()
          return { ok: true, found: true, path: steamAppIdPath, steamAppId: content }
        } catch {}
      }
    }
    return { ok: true, found: false }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ============================================================
// In-Game Overlay IPC Handlers
// ============================================================

// IPC: Show overlay
ipcMain.handle('uc:overlay-show', (_event, appid) => {
  try {
    showOverlay(appid)
    return { ok: true }
  } catch (err) {
    ucLog(`Overlay show failed: ${err.message}`, 'error')
    return { ok: false, error: err.message }
  }
})

// IPC: Hide overlay
ipcMain.handle('uc:overlay-hide', () => {
  try {
    hideOverlay()
    return { ok: true }
  } catch (err) {
    ucLog(`Overlay hide failed: ${err.message}`, 'error')
    return { ok: false, error: err.message }
  }
})

// IPC: Toggle overlay
ipcMain.handle('uc:overlay-toggle', (_event, appid) => {
  try {
    toggleOverlay(appid)
    return { ok: true }
  } catch (err) {
    ucLog(`Overlay toggle failed: ${err.message}`, 'error')
    return { ok: false, error: err.message }
  }
})

// IPC: Get overlay status
ipcMain.handle('uc:overlay-status', () => {
  try {
    const visible = overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()
    return { 
      ok: true, 
      visible, 
      currentAppid: currentOverlayAppid,
      enabled: overlayEnabled,
      hotkey: overlayHotkey,
      autoShow: overlayAutoShow,
      position: overlayPosition
    }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// IPC: Get overlay settings
ipcMain.handle('uc:overlay-get-settings', () => {
  try {
    return { 
      ok: true, 
      enabled: overlayEnabled,
      hotkey: overlayHotkey,
      autoShow: overlayAutoShow,
      position: overlayPosition
    }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// IPC: Set overlay settings
ipcMain.handle('uc:overlay-set-settings', (_event, settings) => {
  try {
    if (!settings || typeof settings !== 'object') {
      return { ok: false, error: 'invalid-settings' }
    }
    updateOverlaySettings(settings)
    
    // Persist settings
    const currentSettings = readSettings()
    if (settings.overlayEnabled !== undefined) currentSettings.overlayEnabled = settings.overlayEnabled
    if (settings.overlayHotkey) currentSettings.overlayHotkey = settings.overlayHotkey
    if (settings.overlayAutoShow !== undefined) currentSettings.overlayAutoShow = settings.overlayAutoShow
    if (settings.overlayPosition) currentSettings.overlayPosition = settings.overlayPosition
    writeSettings(currentSettings)
    
    return { ok: true }
  } catch (err) {
    ucLog(`Overlay settings update failed: ${err.message}`, 'error')
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('uc:overlay-diagnostics', () => {
  try {
    return { ok: true, diagnostics: getOverlayDiagnostics() }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// IPC: Get overlay game info (for overlay UI to show game name, playtime, etc.)
ipcMain.handle('uc:overlay-game-info', (_event, appid) => {
  try {
    // Helper to look up game image from installed manifest
    const getGameImage = (gameAppid) => {
      try {
        const folder = findInstalledFolderByAppid(gameAppid)
        if (!folder) return null
        const manifest = readJsonFile(path.join(folder, INSTALLED_MANIFEST))
        return manifest?.metadata?.image || null
      } catch { return null }
    }

    if (!appid) {
      // Return first running game if no appid specified
      for (const [key, val] of runningGames) {
        if (val && val.appid && val.appid === key) {
          return { ok: true, appid: val.appid, gameName: val.gameName, startedAt: val.startedAt, pid: val.pid, image: getGameImage(val.appid) }
        }
      }
      return { ok: true, appid: null }
    }
    const game = getRunningGame(appid)
    if (!game) return { ok: true, appid: null }
    return { ok: true, appid: game.appid, gameName: game.gameName, startedAt: game.startedAt, pid: game.pid, image: getGameImage(game.appid) }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// IPC: List all running games (for overlay UI)
ipcMain.handle('uc:overlay-running-games', () => {
  try {
    const games = []
    const seen = new Set()
    for (const [key, val] of runningGames) {
      if (val && val.appid && val.appid === key && !seen.has(val.appid)) {
        seen.add(val.appid)
        games.push({ appid: val.appid, gameName: val.gameName, startedAt: val.startedAt, pid: val.pid })
      }
    }
    return { ok: true, games }
  } catch (err) {
    return { ok: false, error: err.message, games: [] }
  }
})

// IPC: Get active downloads for overlay UI
ipcMain.handle('uc:overlay-get-downloads', () => {
  try {
    const downloads = []
    const seen = new Set()

    // Primary: latestDownloadState has snapshots for every active download
    // regardless of which downloader (Chromium or UC Files) is handling it.
    for (const [downloadId, snap] of latestDownloadState) {
      seen.add(downloadId)
      downloads.push({
        id: downloadId,
        appid: snap.appid || '',
        gameName: snap.gameName || snap.appid || 'Unknown',
        status: snap.status || 'downloading',
        receivedBytes: snap.receivedBytes || 0,
        totalBytes: snap.totalBytes || 0,
        speedBps: snap.speedBps || 0,
        etaSeconds: snap.etaSeconds ?? null,
      })
    }

    // Fallback: Chromium activeDownloads (for any items not yet seen via sendDownloadUpdate)
    for (const [downloadId, entry] of activeDownloads) {
      if (seen.has(downloadId) || !entry || !entry.item) continue
      const item = entry.item
      const received = item.getReceivedBytes ? item.getReceivedBytes() : 0
      const total = item.getTotalBytes ? item.getTotalBytes() : 0
      const state = item.getState ? item.getState() : 'progressing'
      let status = 'downloading'
      if (state === 'interrupted') status = 'paused'
      else if (item.isPaused && item.isPaused()) status = 'paused'
      const speed = entry.state?.speedBps || 0
      downloads.push({
        id: downloadId,
        appid: entry.appid || '',
        gameName: entry.gameName || entry.appid || 'Unknown',
        status,
        receivedBytes: received,
        totalBytes: total,
        speedBps: speed,
        etaSeconds: total > 0 && speed > 0 ? Math.round((total - received) / speed) : null,
      })
    }

    // Queued entries that haven't started yet
    for (const queueEntry of globalDownloadQueue) {
      if (seen.has(queueEntry.downloadId)) continue
      downloads.push({
        id: queueEntry.downloadId || '',
        appid: queueEntry.appid || '',
        gameName: queueEntry.gameName || queueEntry.appid || 'Queued',
        status: 'queued',
        receivedBytes: 0,
        totalBytes: 0,
        speedBps: 0,
        etaSeconds: null,
      })
    }

    return { ok: true, downloads }
  } catch (err) {
    ucLog(`overlay-get-downloads error: ${err.message}`, 'error')
    return { ok: true, downloads: [] }
  }
})

// ============================================================
// Controller Support IPC Handlers
// ============================================================

let controllerSettings = {
  enabled: false,
  controllerType: 'generic',
  vibrationEnabled: true,
  deadzone: 0.15,
  triggerDeadzone: 0.1,
  buttonLayout: 'default'
}

// IPC: Get controller settings
ipcMain.handle('uc:controller-get-settings', () => {
  try {
    // Load from settings
    const settings = readSettings()
    if (settings.controllerSettings) {
      controllerSettings = { ...controllerSettings, ...settings.controllerSettings }
    }
    return { ok: true, settings: controllerSettings }
  } catch (err) {
    ucLog(`Controller get settings failed: ${err.message}`, 'error')
    return { ok: false, error: err.message }
  }
})

// IPC: Set controller settings
ipcMain.handle('uc:controller-set-settings', (_event, settings) => {
  try {
    if (!settings || typeof settings !== 'object') {
      return { ok: false, error: 'invalid-settings' }
    }
    controllerSettings = { ...controllerSettings, ...settings }
    
    // Persist to settings
    const currentSettings = readSettings()
    currentSettings.controllerSettings = controllerSettings
    writeSettings(currentSettings)
    
    ucLog(`Controller settings updated: ${JSON.stringify(controllerSettings)}`)
    return { ok: true }
  } catch (err) {
    ucLog(`Controller set settings failed: ${err.message}`, 'error')
    return { ok: false, error: err.message }
  }
})

// IPC: Get connected controller info
ipcMain.handle('uc:controller-get-connected', () => {
  try {
    // In a real implementation, this would detect connected gamepads
    // For now, return a placeholder that no controller is connected
    // The actual gamepad detection would happen in the renderer using the Gamepad API
    return { 
      connected: false, 
      controllerId: null, 
      controllerName: null, 
      controllerType: null 
    }
  } catch (err) {
    ucLog(`Controller get connected failed: ${err.message}`, 'error')
    return { connected: false, controllerId: null, controllerName: null, controllerType: null }
  }
})

// IPC: Get mapping presets (x360ce-style)
ipcMain.handle('uc:controller-get-mapping-presets', () => {
  try {
    const settings = readSettings()
    const presets = settings?.controllerMappingPresets || [
      { id: 'generic', name: 'Generic Controller' },
      { id: 'xbox', name: 'Xbox Controller' },
      { id: 'playstation', name: 'PlayStation Controller' },
      { id: 'dualsense', name: 'DualSense (PS5)' },
      { id: 'dualshock4', name: 'DualShock 4 (PS4)' },
      { id: 'xboxone', name: 'Xbox One' },
      { id: 'xboxseries', name: 'Xbox Series X' },
    ]
    return { ok: true, presets }
  } catch (err) {
    return { ok: false, presets: [], error: err.message }
  }
})

// IPC: Get active mapping
ipcMain.handle('uc:controller-get-active-mapping', () => {
  try {
    const settings = readSettings()
    return { 
      ok: true, 
      mapping: settings?.controllerActiveMapping || { preset: 'auto', customMapping: null } 
    }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// IPC: Set active mapping
ipcMain.handle('uc:controller-set-active-mapping', (_event, preset, customMapping) => {
  try {
    const settings = readSettings()
    settings.controllerActiveMapping = { preset, customMapping }
    writeSettings(settings)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// IPC: Get profiles (key binding profiles - antimicrox-style)
ipcMain.handle('uc:controller-get-profiles', () => {
  try {
    const settings = readSettings()
    const profiles = settings?.controllerProfiles || [
      {
        id: 'default',
        name: 'Default',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        mappingEnabled: true,
        keyBindingEnabled: false,
        deadzone: 0.15,
        triggerDeadzone: 0.1,
        vibrationEnabled: true,
        vibrationIntensity: 1.0,
        keyBinding: {
          id: 'default',
          name: 'Default',
          profileName: 'Default',
          enabled: true,
          buttonMappings: {},
          stickToMouse: { leftStick: false, rightStick: false, mouseSpeed: 1.0, mouseAcceleration: false },
          triggerToScroll: { leftTrigger: false, rightTrigger: false, scrollSpeed: 1.0 },
        }
      }
    ]
    return { ok: true, profiles }
  } catch (err) {
    return { ok: false, profiles: [], error: err.message }
  }
})

// IPC: Get active profile
ipcMain.handle('uc:controller-get-active-profile', () => {
  try {
    const settings = readSettings()
    const profiles = settings?.controllerProfiles || []
    const activeId = settings?.controllerActiveProfileId || 'default'
    const activeProfile = profiles.find(p => p.id === activeId) || profiles[0] || null
    return { ok: true, profile: activeProfile }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// IPC: Set active profile
ipcMain.handle('uc:controller-set-active-profile', (_event, profileId) => {
  try {
    const settings = readSettings()
    settings.controllerActiveProfileId = profileId
    writeSettings(settings)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// IPC: Create profile
ipcMain.handle('uc:controller-create-profile', (_event, profile) => {
  try {
    const settings = readSettings()
    const profiles = settings?.controllerProfiles || []
    profiles.push({
      ...profile,
      id: profile.id || `profile_${Date.now()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    settings.controllerProfiles = profiles
    writeSettings(settings)
    return { ok: true, profile }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// IPC: Update profile
ipcMain.handle('uc:controller-update-profile', (_event, profile) => {
  try {
    const settings = readSettings()
    const profiles = settings?.controllerProfiles || []
    const idx = profiles.findIndex(p => p.id === profile.id)
    if (idx >= 0) {
      profiles[idx] = { ...profile, updatedAt: Date.now() }
      settings.controllerProfiles = profiles
      writeSettings(settings)
      return { ok: true }
    }
    return { ok: false, error: 'Profile not found' }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// IPC: Delete profile
ipcMain.handle('uc:controller-delete-profile', (_event, profileId) => {
  try {
    const settings = readSettings()
    let profiles = settings?.controllerProfiles || []
    profiles = profiles.filter(p => p.id !== profileId)
    // Ensure at least one profile exists
    if (profiles.length === 0) {
      profiles.push({
        id: 'default',
        name: 'Default',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        mappingEnabled: true,
        keyBindingEnabled: false,
        deadzone: 0.15,
        triggerDeadzone: 0.1,
        vibrationEnabled: true,
        vibrationIntensity: 1.0,
        keyBinding: {
          id: 'default',
          name: 'Default',
          profileName: 'Default',
          enabled: true,
        }
      })
    }
    settings.controllerProfiles = profiles
    // If deleted profile was active, switch to first available
    if (settings.controllerActiveProfileId === profileId) {
      settings.controllerActiveProfileId = profiles[0].id
    }
    writeSettings(settings)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// IPC: Get controller overlay settings
ipcMain.handle('uc:controller-get-overlay-settings', () => {
  try {
    const settings = readSettings()
    return {
      ok: true,
      settings: {
        overlayEnabled: settings?.controllerOverlayEnabled ?? true,
        overlayHotkey: settings?.controllerOverlayHotkey || 'Ctrl+Shift+Gamepad',
        overlayPosition: settings?.controllerOverlayPosition || 'right',
      }
    }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// IPC: Set controller overlay settings
ipcMain.handle('uc:controller-set-overlay-settings', (_event, overlaySettings) => {
  try {
    const settings = readSettings()
    settings.controllerOverlayEnabled = overlaySettings.overlayEnabled
    settings.controllerOverlayHotkey = overlaySettings.overlayHotkey
    settings.controllerOverlayPosition = overlaySettings.overlayPosition
    writeSettings(settings)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// END Controller IPC Handlers

// ============================================================
// System Functions (Volume, Screenshot, Notifications)
// ============================================================

// Helper: run a PowerShell script via a temp file to avoid shell-injection risks
function runPsFile(scriptContent) {
  return new Promise((resolve, reject) => {
    const { execFile } = require('child_process')
    const os = require('os')
    const tmpScript = path.join(os.tmpdir(), `uc-sys-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`)
    try {
      fs.writeFileSync(tmpScript, scriptContent, 'utf8')
    } catch (err) {
      return reject(err)
    }
    execFile('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-NonInteractive', '-NoProfile', '-File', tmpScript],
      { timeout: 10000 },
      (err, stdout) => {
        try { fs.unlinkSync(tmpScript) } catch {}
        if (err) return reject(err)
        resolve(stdout.trim())
      }
    )
  })
}

// Correct Core Audio COM interface definition shared by all volume/mute handlers.
// IAudioEndpointVolume vtable stubs match the Windows SDK order exactly so that
// GetMasterVolumeLevelScalar (index 5), SetMasterVolumeLevelScalar (index 3),
// SetMute (index 11) and GetMute (index 12) dispatch to the right methods.
const AUDIO_TYPE_DEF = `Add-Type -TypeDefinition @"
using System;using System.Runtime.InteropServices;
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator{int n0();int GetDefaultAudioEndpoint(int d,int r,out IMMDevice ep);}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice{int Activate(ref Guid id,int ctx,IntPtr p,[MarshalAs(UnmanagedType.Interface)]out IAudioEndpointVolume aev);}
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume{int n0(IntPtr p);int n1(IntPtr p);int n2(float l,ref Guid g);int SetMasterVolumeLevelScalar(float l,ref Guid g);int n4(out float l);int GetMasterVolumeLevelScalar(out float l);int n6(uint c,float l,ref Guid g);int n7(uint c,float l,ref Guid g);int n8(uint c,out float l);int n9(uint c,out float l);int n10(out uint c);int SetMute([MarshalAs(UnmanagedType.Bool)]bool m,ref Guid g);int GetMute([MarshalAs(UnmanagedType.Bool)]out bool m);}
"@ -ErrorAction SilentlyContinue
$_e=[Activator]::CreateInstance([Type]::GetTypeFromCLSID([Guid]"BCDE0395-E52F-467C-8E3D-C4579291692E")) -as [IMMDeviceEnumerator]
$_d=$null;$_e.GetDefaultAudioEndpoint(0,1,[ref]$_d)
$_aevGuid=[Guid]"5CDF2C82-841E-4546-9722-0CF74078229A"
$_a=$null;$_d.Activate([ref]$_aevGuid,1,[IntPtr]::Zero,[ref]$_a)
`

// IPC: Get system volume (0-100)
ipcMain.handle('uc:system-get-volume', async () => {
  try {
    if (process.platform === 'win32') {
      const script = AUDIO_TYPE_DEF + `$l=0.0;$_a.GetMasterVolumeLevelScalar([ref]$l);[Math]::Round($l*100)`
      const stdout = await runPsFile(script)
      const vol = parseInt(stdout, 10)
      return { ok: true, volume: isNaN(vol) ? 50 : Math.round(vol) }
    }
    return { ok: false, error: 'not-supported' }
  } catch (err) {
    ucLog(`System get volume failed: ${err.message}`, 'error')
    return { ok: false, error: err.message, volume: 50 }
  }
})

// IPC: Set system volume (0-100)
ipcMain.handle('uc:system-set-volume', async (_event, level) => {
  try {
    if (process.platform === 'win32') {
      const vol = Math.max(0, Math.min(100, parseInt(level, 10) || 50))
      const script = AUDIO_TYPE_DEF + `$_a.SetMasterVolumeLevelScalar(${vol}/100.0,[ref][Guid]::Empty)`
      await runPsFile(script)
      return { ok: true }
    }
    return { ok: false, error: 'not-supported' }
  } catch (err) {
    ucLog(`System set volume failed: ${err.message}`, 'error')
    return { ok: false, error: err.message }
  }
})

// IPC: Get mute state
ipcMain.handle('uc:system-get-muted', async () => {
  try {
    if (process.platform === 'win32') {
      const script = AUDIO_TYPE_DEF + `$m=$false;$_a.GetMute([ref]$m);$m`
      const stdout = await runPsFile(script)
      return { ok: true, muted: stdout.toLowerCase() === 'true' }
    }
    return { ok: false, error: 'not-supported' }
  } catch (err) {
    ucLog(`System get muted failed: ${err.message}`, 'error')
    return { ok: false, error: err.message, muted: false }
  }
})

// IPC: Set mute state
ipcMain.handle('uc:system-set-muted', async (_event, muted) => {
  try {
    if (process.platform === 'win32') {
      const muteVal = muted ? '$true' : '$false'
      const script = AUDIO_TYPE_DEF + `$_a.SetMute(${muteVal},[ref][Guid]::Empty)`
      await runPsFile(script)
      return { ok: true }
    }
    return { ok: false, error: 'not-supported' }
  } catch (err) {
    ucLog(`System set muted failed: ${err.message}`, 'error')
    return { ok: false, error: err.message }
  }
})

// IPC: Take screenshot
ipcMain.handle('uc:system-screenshot', async () => {
  try {
    if (process.platform === 'win32') {
      const screenshotsDir = path.join(app.getPath('pictures'), 'UnionCrax.Direct', 'Screenshots')
      if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir, { recursive: true })
      }
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = `screenshot-${timestamp}.png`
      const filepath = path.join(screenshotsDir, filename)
      
      // Escape single quotes in the path for a PowerShell single-quoted string,
      // then write the script to a temp file to avoid CMD shell-injection risks.
      const psPath = filepath.replace(/'/g, "''")
      const psScript = `Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
$bitmap.Save('${psPath}', [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
`
      
      await runPsFile(psScript)
      
      if (fs.existsSync(filepath)) {
        ucLog(`Screenshot saved: ${filepath}`)
        return { ok: true, path: filepath, filename }
      }
      return { ok: false, error: 'file-not-created' }
    }
    return { ok: false, error: 'not-supported' }
  } catch (err) {
    ucLog(`System screenshot failed: ${err.message}`, 'error')
    return { ok: false, error: err.message }
  }
})

// IPC: Get screenshot save path
ipcMain.handle('uc:system-screenshot-path', async () => {
  try {
    const screenshotsDir = path.join(app.getPath('pictures'), 'UnionCrax.Direct', 'Screenshots')
    return { ok: true, path: screenshotsDir }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// IPC: List all saved screenshots
ipcMain.handle('uc:system-list-screenshots', async () => {
  try {
    const screenshotsDir = path.join(app.getPath('pictures'), 'UnionCrax.Direct', 'Screenshots')
    if (!fs.existsSync(screenshotsDir)) return { ok: true, screenshots: [] }
    const files = fs.readdirSync(screenshotsDir)
      .filter(f => /\.(png|jpg|jpeg)$/i.test(f))
      .map(f => {
        const filePath = path.join(screenshotsDir, f)
        const stat = fs.statSync(filePath)
        return { filename: f, path: filePath, size: stat.size, takenAt: stat.birthtimeMs || stat.mtimeMs }
      })
      .sort((a, b) => b.takenAt - a.takenAt)
    return { ok: true, screenshots: files }
  } catch (err) {
    return { ok: false, error: err.message, screenshots: [] }
  }
})

// IPC: Delete a screenshot
ipcMain.handle('uc:system-delete-screenshot', async (_event, filePath) => {
  try {
    if (!filePath || typeof filePath !== 'string') return { ok: false, error: 'invalid-path' }
    const screenshotsDir = path.join(app.getPath('pictures'), 'UnionCrax.Direct', 'Screenshots')
    const resolved = path.resolve(filePath)
    const resolvedDir = path.resolve(screenshotsDir)
    if (!resolved.startsWith(resolvedDir + path.sep)) return { ok: false, error: 'path-not-allowed' }
    fs.unlinkSync(resolved)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// IPC: Show screenshot in Explorer
ipcMain.handle('uc:system-open-screenshot', async (_event, filePath) => {
  try {
    if (!filePath || typeof filePath !== 'string') return { ok: false, error: 'invalid-path' }
    shell.showItemInFolder(filePath)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// IPC: Get Windows notifications
ipcMain.handle('uc:system-notifications', async () => {
  try {
    if (process.platform === 'win32') {
      const { exec } = require('child_process')
      return new Promise((resolve) => {
        // Get notifications from Windows Action Center using PowerShell
        const psScript = `
          $toastXml = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
          $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("UnionCrax.Direct")
          $history = $notifier.GetHistory()
          $notifications = @()
          foreach ($toast in $history) {
            $notifications += @{
              id = $toast.Id
              title = $toast.Content.QueryText
              timestamp = $toast.Timestamp.ToString("o")
              appName = "UnionCrax.Direct"
            }
          }
          $notifications | ConvertTo-Json -Compress
        `
        exec(`powershell -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, (err, stdout) => {
          if (err || !stdout) {
            // Return empty array if no notifications or error
            resolve({ ok: true, notifications: [] })
            return
          }
          try {
            const parsed = JSON.parse(stdout.trim())
            const notifications = Array.isArray(parsed) ? parsed : [parsed]
            resolve({ ok: true, notifications })
          } catch (e) {
            resolve({ ok: true, notifications: [] })
          }
        })
      })
    }
    return { ok: true, notifications: [] }
  } catch (err) {
    ucLog(`System notifications failed: ${err.message}`, 'error')
    return { ok: true, notifications: [] }
  }
})

// IPC: Clear notification (when clicked)
ipcMain.handle('uc:system-notification-activated', async (_event, notificationId) => {
  try {
    if (process.platform === 'win32') {
      // Clear the notification from history when user clicks on it in the overlay
      ucLog(`Notification activated: ${notificationId}`)
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

