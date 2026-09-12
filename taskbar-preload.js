const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codexPulseTaskbar', {
  show: () => ipcRenderer.invoke('app:show'),
  onStatus: (callback) => ipcRenderer.on('taskbar:status', (_event, status) => callback(status)),
});
