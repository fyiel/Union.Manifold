const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('ucDownloads', {
  start: (payload) => ipcRenderer.invoke('uc:download-start', payload),
  cancel: (downloadId) => ipcRenderer.invoke('uc:download-cancel', downloadId),
  showInFolder: (targetPath) => ipcRenderer.invoke('uc:download-show', targetPath),
  openPath: (targetPath) => ipcRenderer.invoke('uc:download-open', targetPath),
  listDisks: () => ipcRenderer.invoke('uc:disk-list'),
  getDownloadPath: () => ipcRenderer.invoke('uc:download-path-get'),
  setDownloadPath: (targetPath) => ipcRenderer.invoke('uc:download-path-set', targetPath),
  pickDownloadPath: () => ipcRenderer.invoke('uc:download-path-pick'),
  getDownloadUsage: (targetPath) => ipcRenderer.invoke('uc:download-usage', targetPath),
  // Installed manifests (stored next to installed files)
  saveInstalledMetadata: (appid, metadata) => ipcRenderer.invoke('uc:installed-save', appid, metadata),
  listInstalled: () => ipcRenderer.invoke('uc:installed-list'),
  getInstalled: (appid) => ipcRenderer.invoke('uc:installed-get', appid),
  onUpdate: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('uc:download-update', listener)
    return () => ipcRenderer.removeListener('uc:download-update', listener)
  }
})

contextBridge.exposeInMainWorld('ucSettings', {
  get: (key) => ipcRenderer.invoke('uc:setting-get', key),
  set: (key, value) => ipcRenderer.invoke('uc:setting-set', key, value),
  onChanged: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('uc:setting-changed', listener)
    return () => ipcRenderer.removeListener('uc:setting-changed', listener)
  }
})
