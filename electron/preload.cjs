const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('ucDownloads', {
  start: (payload) => ipcRenderer.invoke('uc:download-start', payload),
  cancel: (downloadId) => ipcRenderer.invoke('uc:download-cancel', downloadId),
  pause: (downloadId) => ipcRenderer.invoke('uc:download-pause', downloadId),
  resume: (downloadId) => ipcRenderer.invoke('uc:download-resume', downloadId),
  resumeInterrupted: (payload) => ipcRenderer.invoke('uc:download-resume-interrupted', payload),
  resumeWithFreshUrl: (payload) => ipcRenderer.invoke('uc:download-resume-with-fresh-url', payload),
  showInFolder: (targetPath) => ipcRenderer.invoke('uc:download-show', targetPath),
  openPath: (targetPath) => ipcRenderer.invoke('uc:download-open', targetPath),
  listDisks: () => ipcRenderer.invoke('uc:disk-list'),
  getDownloadPath: () => ipcRenderer.invoke('uc:download-path-get'),
  setDownloadPath: (targetPath) => ipcRenderer.invoke('uc:download-path-set', targetPath),
  pickDownloadPath: () => ipcRenderer.invoke('uc:download-path-pick'),
  getDownloadUsage: (targetPath) => ipcRenderer.invoke('uc:download-usage', targetPath),
  clearDownloadCache: () => ipcRenderer.invoke('uc:download-cache-clear'),
  // Installed manifests (stored next to installed files)
  saveInstalledMetadata: (appid, metadata) => ipcRenderer.invoke('uc:installed-save', appid, metadata),
  listInstalled: () => ipcRenderer.invoke('uc:installed-list'),
  getInstalled: (appid) => ipcRenderer.invoke('uc:installed-get', appid),
  listInstalledByAppid: (appid) => ipcRenderer.invoke('uc:installed-list-by-appid', appid),
  listInstalling: () => ipcRenderer.invoke('uc:installing-list'),
  getInstalling: (appid) => ipcRenderer.invoke('uc:installing-get', appid),
  listInstalledGlobal: () => ipcRenderer.invoke('uc:installed-list-global'),
  getInstalledGlobal: (appid) => ipcRenderer.invoke('uc:installed-get-global', appid),
  listInstallingGlobal: () => ipcRenderer.invoke('uc:installing-list-global'),
  getInstallingGlobal: (appid) => ipcRenderer.invoke('uc:installing-get-global', appid),
  listGameExecutables: (appid, versionLabel) => ipcRenderer.invoke('uc:game-exe-list', appid, versionLabel),
  browseForGameExe: (defaultPath) => ipcRenderer.invoke('uc:game-browse-exe', defaultPath),
  findGameSubfolder: (folder) => ipcRenderer.invoke('uc:game-subfolder-find', folder),
  launchGameExecutable: (appid, exePath, gameName, showGameName) => ipcRenderer.invoke('uc:game-exe-launch', appid, exePath, gameName, showGameName),
  launchGameExecutableAsAdmin: (appid, exePath, gameName, showGameName) => ipcRenderer.invoke('uc:game-exe-launch-admin', appid, exePath, gameName, showGameName),
  getRunningGame: (appid) => ipcRenderer.invoke('uc:game-exe-running', appid),
  isLauncherAvailable: () => ipcRenderer.invoke('uc:launcher-available'),
  quitGameExecutable: (appid) => ipcRenderer.invoke('uc:game-exe-quit', appid),
  deleteInstalled: (appid) => ipcRenderer.invoke('uc:installed-delete', appid),
  deleteInstalling: (appid) => ipcRenderer.invoke('uc:installing-delete', appid),
  setInstallingStatus: (appid, status, error) => ipcRenderer.invoke('uc:installing-status-set', appid, status, error),
  getActiveStatus: (appid) => ipcRenderer.invoke('uc:download-active-status', appid),
  createDesktopShortcut: (gameName, exePath) => ipcRenderer.invoke('uc:create-desktop-shortcut', gameName, exePath),
  deleteDesktopShortcut: (gameName) => ipcRenderer.invoke('uc:delete-desktop-shortcut', gameName),
  addExternalGame: (appid, metadata, gamePath) => ipcRenderer.invoke('uc:add-external-game', appid, metadata, gamePath),
  updateInstalledMetadata: (appid, updates) => ipcRenderer.invoke('uc:installed-update-metadata', appid, updates),
  pickExternalGameFolder: () => ipcRenderer.invoke('uc:pick-external-game-folder'),
  pickImage: () => ipcRenderer.invoke('uc:pick-image'),
  pickArchiveFiles: () => ipcRenderer.invoke('uc:pick-archive-files'),
  installFromArchive: (payload) => ipcRenderer.invoke('uc:install-from-archive', payload),
  onUpdate: (callback) => {
    const listener = (_event, data) => {
      try {
        // Mirror updates to renderer devtools console for easier debugging
        try { console.debug('[uc:download-update]', data) } catch (e) {}
      } catch (e) {}
      callback(data)
    }
    ipcRenderer.on('uc:download-update', listener)
    return () => ipcRenderer.removeListener('uc:download-update', listener)
  },
  onGameQuickExit: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('uc:game-quick-exit', listener)
    return () => ipcRenderer.removeListener('uc:game-quick-exit', listener)
  }
})

contextBridge.exposeInMainWorld('ucSettings', {
  get: (key) => ipcRenderer.invoke('uc:setting-get', key),
  set: (key, value) => ipcRenderer.invoke('uc:setting-set', key, value),
  clearAll: () => ipcRenderer.invoke('uc:setting-clear-all'),
  exportSettings: () => ipcRenderer.invoke('uc:settings-export'),
  importSettings: () => ipcRenderer.invoke('uc:settings-import'),
  runNetworkTest: (baseUrl) => ipcRenderer.invoke('uc:network-test', baseUrl),
  onChanged: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('uc:setting-changed', listener)
    return () => ipcRenderer.removeListener('uc:setting-changed', listener)
  }
})

contextBridge.exposeInMainWorld('ucAuth', {
  login: (baseUrl) => ipcRenderer.invoke('uc:auth-login', baseUrl),
  logout: (baseUrl) => ipcRenderer.invoke('uc:auth-logout', baseUrl),
  getSession: (baseUrl) => ipcRenderer.invoke('uc:auth-session', baseUrl),
  fetch: (baseUrl, path, init) => ipcRenderer.invoke('uc:auth-fetch', { baseUrl, path, init })
})

contextBridge.exposeInMainWorld('ucUpdater', {
  checkForUpdates: () => ipcRenderer.invoke('uc:check-for-updates'),
  getVersion: () => ipcRenderer.invoke('uc:get-version')
})

contextBridge.exposeInMainWorld('ucLogs', {
  log: (level, message, data) => ipcRenderer.invoke('uc:log', level, message, data),
  getLogs: () => ipcRenderer.invoke('uc:logs-get'),
  clearLogs: () => ipcRenderer.invoke('uc:logs-clear'),
  openLogsFolder: () => ipcRenderer.invoke('uc:logs-open-folder')
})

contextBridge.exposeInMainWorld('ucRpc', {
  setActivity: (payload) => ipcRenderer.invoke('uc:rpc-set-activity', payload),
  clearActivity: () => ipcRenderer.invoke('uc:rpc-clear'),
  getStatus: () => ipcRenderer.invoke('uc:rpc-status')
})

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    on: (channel, func) => {
      ipcRenderer.on(channel, func)
    },
    removeListener: (channel, func) => {
      ipcRenderer.removeListener(channel, func)
    }
  }
})

contextBridge.exposeInMainWorld('ucLinux', {
  detectProton: () => ipcRenderer.invoke('uc:linux-detect-proton'),
  detectWine: () => ipcRenderer.invoke('uc:linux-detect-wine'),
  runWinecfg: () => ipcRenderer.invoke('uc:linux-winecfg'),
  runWinetricks: (packages) => ipcRenderer.invoke('uc:linux-winetricks', packages),
  runProtontricks: (appId, packages) => ipcRenderer.invoke('uc:linux-protontricks', appId, packages),
  createPrefix: (prefixPath, arch) => ipcRenderer.invoke('uc:linux-create-prefix', prefixPath, arch),
  initDefaultProtonPrefix: (sourcePrefixPath) => ipcRenderer.invoke('uc:linux-init-default-proton-prefix', sourcePrefixPath),
  getDefaultProtonPrefixPath: () => ipcRenderer.invoke('uc:linux-get-default-proton-prefix-path'),
  pickPrefixDir: () => ipcRenderer.invoke('uc:linux-pick-prefix-dir'),
  pickBinary: () => ipcRenderer.invoke('uc:linux-pick-binary'),
  pickSo: () => ipcRenderer.invoke('uc:linux-pick-so'),
  checkTool: (toolName) => ipcRenderer.invoke('uc:linux-check-tool', toolName),
  getSteamPath: () => ipcRenderer.invoke('uc:linux-steam-path'),
  // Per-game Linux config
  getGameConfig: (appid) => ipcRenderer.invoke('uc:game-linux-config-get', appid),
  setGameConfig: (appid, config) => ipcRenderer.invoke('uc:game-linux-config-set', appid, config),
  // SLSteam
  detectSLSSteam: () => ipcRenderer.invoke('uc:linux-detect-slssteam'),
  slsSteamDownload: () => ipcRenderer.invoke('uc:linux-slssteam-download'),
  slsSteamSetupGame: (appid, steamAppId) => ipcRenderer.invoke('uc:linux-slssteam-setup-game', appid, steamAppId),
  slsSteamCheckGame: (appid) => ipcRenderer.invoke('uc:linux-slssteam-check-game', appid),
})

contextBridge.exposeInMainWorld('ucVR', {
  detectSteamVR: () => ipcRenderer.invoke('uc:vr-detect-steamvr'),
  detectOpenXR: () => ipcRenderer.invoke('uc:vr-detect-openxr'),
  launchSteamVR: () => ipcRenderer.invoke('uc:vr-launch-steamvr'),
  pickRuntimeJson: () => ipcRenderer.invoke('uc:vr-pick-runtime-json'),
  pickSteamVRDir: () => ipcRenderer.invoke('uc:vr-pick-steamvr-dir'),
  getSettings: () => ipcRenderer.invoke('uc:vr-get-settings'),
})

// In-Game Overlay API
contextBridge.exposeInMainWorld('ucOverlay', {
  show: (appid) => ipcRenderer.invoke('uc:overlay-show', appid),
  hide: () => ipcRenderer.invoke('uc:overlay-hide'),
  toggle: (appid) => ipcRenderer.invoke('uc:overlay-toggle', appid),
  getStatus: () => ipcRenderer.invoke('uc:overlay-status'),
  getSettings: () => ipcRenderer.invoke('uc:overlay-get-settings'),
  setSettings: (settings) => ipcRenderer.invoke('uc:overlay-set-settings', settings),
  getGameInfo: (appid) => ipcRenderer.invoke('uc:overlay-game-info', appid),
  getRunningGames: () => ipcRenderer.invoke('uc:overlay-running-games'),
  getDownloads: () => ipcRenderer.invoke('uc:overlay-get-downloads'),
  onShow: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('uc:overlay-show', listener)
    return () => ipcRenderer.removeListener('uc:overlay-show', listener)
  },
  onHide: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('uc:overlay-hide', listener)
    return () => ipcRenderer.removeListener('uc:overlay-hide', listener)
  },
  onStateChanged: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('uc:overlay-state-changed', listener)
    return () => ipcRenderer.removeListener('uc:overlay-state-changed', listener)
  },
  onPositionChanged: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('uc:overlay-position-changed', listener)
    return () => ipcRenderer.removeListener('uc:overlay-position-changed', listener)
  },
  onDownloadUpdate: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('uc:download-update', listener)
    return () => ipcRenderer.removeListener('uc:download-update', listener)
  },
  pauseDownload: (downloadId) => ipcRenderer.invoke('uc:download-pause', downloadId),
  resumeDownload: (downloadId) => ipcRenderer.invoke('uc:download-resume', downloadId),
  onToast: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('uc:overlay-toast', listener)
    return () => ipcRenderer.removeListener('uc:overlay-toast', listener)
  }
})

// Controller Support API
contextBridge.exposeInMainWorld('ucController', {
  // Basic settings
  getSettings: () => ipcRenderer.invoke('uc:controller-get-settings'),
  setSettings: (settings) => ipcRenderer.invoke('uc:controller-set-settings', settings),
  getConnected: () => ipcRenderer.invoke('uc:controller-get-connected'),
  // Input translation (x360ce-style)
  getMappingPresets: () => ipcRenderer.invoke('uc:controller-get-mapping-presets'),
  getActiveMapping: () => ipcRenderer.invoke('uc:controller-get-active-mapping'),
  setActiveMapping: (preset, customMapping) => ipcRenderer.invoke('uc:controller-set-active-mapping', preset, customMapping),
  // Key binding (antimicrox-style)
  getProfiles: () => ipcRenderer.invoke('uc:controller-get-profiles'),
  getActiveProfile: () => ipcRenderer.invoke('uc:controller-get-active-profile'),
  setActiveProfile: (profileId) => ipcRenderer.invoke('uc:controller-set-active-profile', profileId),
  createProfile: (profile) => ipcRenderer.invoke('uc:controller-create-profile', profile),
  updateProfile: (profile) => ipcRenderer.invoke('uc:controller-update-profile', profile),
  deleteProfile: (profileId) => ipcRenderer.invoke('uc:controller-delete-profile', profileId),
  // Input events
  onControllerConnected: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('uc:controller-connected', listener)
    return () => ipcRenderer.removeListener('uc:controller-connected', listener)
  },
  onControllerDisconnected: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('uc:controller-disconnected', listener)
    return () => ipcRenderer.removeListener('uc:controller-disconnected', listener)
  },
  onControllerInput: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('uc:controller-input', listener)
    return () => ipcRenderer.removeListener('uc:controller-input', listener)
  },
  // Overlay-specific
  getOverlaySettings: () => ipcRenderer.invoke('uc:controller-get-overlay-settings'),
  setOverlaySettings: (settings) => ipcRenderer.invoke('uc:controller-set-overlay-settings', settings),
})

// System Notifications API
contextBridge.exposeInMainWorld('ucSystem', {
  // Volume control
  getVolume: () => ipcRenderer.invoke('uc:system-get-volume'),
  setVolume: (level) => ipcRenderer.invoke('uc:system-set-volume', level),
  getMuted: () => ipcRenderer.invoke('uc:system-get-muted'),
  setMuted: (muted) => ipcRenderer.invoke('uc:system-set-muted', muted),
  // Screenshot
  takeScreenshot: () => ipcRenderer.invoke('uc:system-screenshot'),
  getScreenshotPath: () => ipcRenderer.invoke('uc:system-screenshot-path'),
  // Notifications
  getNotifications: () => ipcRenderer.invoke('uc:system-notifications'),
  onNotificationActivated: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('uc:system-notification-activated', listener)
    return () => ipcRenderer.removeListener('uc:system-notification-activated', listener)
  }
})
