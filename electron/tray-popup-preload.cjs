// Preload for the custom tray right-click popup window.
// Exposes a minimal API to the popup HTML via contextBridge.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('trayAPI', {
  /** Register a callback that fires whenever main pushes fresh menu data. */
  onData: (cb) => ipcRenderer.on('tray-popup:data', (_, data) => cb(data)),

  /** Send a menu action (button click) back to the main process. */
  action: (type, payload) =>
    ipcRenderer.send('tray-popup:action', { type, payload: payload ?? null }),

  /** Report the popup's rendered content height so main can size once. */
  ready: (height) => ipcRenderer.send('tray-popup:ready', { height }),
})
