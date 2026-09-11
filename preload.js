const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codexPulse', {
  readUsage: () => ipcRenderer.invoke('usage:read'),
  hide: () => ipcRenderer.invoke('app:hide'),
  show: () => ipcRenderer.invoke('app:show'),
  setView: (minimized) => ipcRenderer.invoke('app:set-view', minimized),
  moveBy: (dx, dy) => ipcRenderer.send('app:move', { dx, dy }),
  openCodex: () => ipcRenderer.invoke('app:open-codex'),
  quit: () => ipcRenderer.invoke('app:quit'),
  getSettings: () => ipcRenderer.invoke('settings:read'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  chooseCodex: () => ipcRenderer.invoke('settings:choose-codex'),
  resetPosition: () => ipcRenderer.invoke('settings:reset-position'),
  updateTray: (data) => ipcRenderer.invoke('tray:update', data),
  showNotification: (data) => ipcRenderer.invoke('notifications:show', data),
  checkForUpdates: () => ipcRenderer.invoke('app:check-updates'),
  downloadUpdate: () => ipcRenderer.invoke('app:download-update'),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
  onRefresh: (callback) => ipcRenderer.on('usage:refresh', callback),
  onSettingsOpen: (callback) => ipcRenderer.on('settings:open', callback),
  onUpdate: (callback) => ipcRenderer.on('update:state', (_event, state) => callback(state)),
  onViewChange: (callback) => ipcRenderer.on('window:view', (_event, view) => callback(view)),
});
