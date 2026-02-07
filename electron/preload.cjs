const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('ucDownloads', {
  start: (payload) => ipcRenderer.invoke('uc:download-start', payload),
  cancel: (downloadId) => ipcRenderer.invoke('uc:download-cancel', downloadId),
  pause: (downloadId) => ipcRenderer.invoke('uc:download-pause', downloadId),
  resume: (downloadId) => ipcRenderer.invoke('uc:download-resume', downloadId),
  resumeInterrupted: (payload) => ipcRenderer.invoke('uc:download-resume-interrupted', payload),
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
  listInstalling: () => ipcRenderer.invoke('uc:installing-list'),
  getInstalling: (appid) => ipcRenderer.invoke('uc:installing-get', appid),
  listInstalledGlobal: () => ipcRenderer.invoke('uc:installed-list-global'),
  getInstalledGlobal: (appid) => ipcRenderer.invoke('uc:installed-get-global', appid),
  listInstallingGlobal: () => ipcRenderer.invoke('uc:installing-list-global'),
  getInstallingGlobal: (appid) => ipcRenderer.invoke('uc:installing-get-global', appid),
  listGameExecutables: (appid) => ipcRenderer.invoke('uc:game-exe-list', appid),
  findGameSubfolder: (folder) => ipcRenderer.invoke('uc:game-subfolder-find', folder),
  launchGameExecutable: (appid, exePath, gameName) => ipcRenderer.invoke('uc:game-exe-launch', appid, exePath, gameName),
  launchGameExecutableAsAdmin: (appid, exePath, gameName) => ipcRenderer.invoke('uc:game-exe-launch-admin', appid, exePath, gameName),
  getRunningGame: (appid) => ipcRenderer.invoke('uc:game-exe-running', appid),
  quitGameExecutable: (appid) => ipcRenderer.invoke('uc:game-exe-quit', appid),
  deleteInstalled: (appid) => ipcRenderer.invoke('uc:installed-delete', appid),
  deleteInstalling: (appid) => ipcRenderer.invoke('uc:installing-delete', appid),
  setInstallingStatus: (appid, status, error) => ipcRenderer.invoke('uc:installing-status-set', appid, status, error),
  createDesktopShortcut: (gameName, exePath) => ipcRenderer.invoke('uc:create-desktop-shortcut', gameName, exePath),
  deleteDesktopShortcut: (gameName) => ipcRenderer.invoke('uc:delete-desktop-shortcut', gameName),
  addExternalGame: (appid, metadata, gamePath) => ipcRenderer.invoke('uc:add-external-game', appid, metadata, gamePath),
  pickExternalGameFolder: () => ipcRenderer.invoke('uc:pick-external-game-folder'),
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
