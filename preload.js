const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codexPulse', {
  readUsage: () => ipcRenderer.invoke('usage:read'),
  hide: () => ipcRenderer.invoke('app:hide'),
  show: () => ipcRenderer.invoke('app:show'),
  setView: (minimized) => ipcRenderer.invoke('app:set-view', minimized),
  moveBy: (dx, dy) => ipcRenderer.send('app:move', { dx, dy }),
  openCodex: () => ipcRenderer.invoke('app:open-codex'),
  quit: () => ipcRenderer.invoke('app:quit'),
  onRefresh: (callback) => ipcRenderer.on('usage:refresh', callback),
  onViewChange: (callback) => ipcRenderer.on('window:view', (_event, view) => callback(view)),
});
