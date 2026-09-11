const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codexPulse', {
  readUsage: () => ipcRenderer.invoke('usage:read'),
  hide: () => ipcRenderer.invoke('app:hide'),
  show: () => ipcRenderer.invoke('app:show'),
  openCodex: () => ipcRenderer.invoke('app:open-codex'),
  quit: () => ipcRenderer.invoke('app:quit'),
  onRefresh: (callback) => ipcRenderer.on('usage:refresh', callback),
});
