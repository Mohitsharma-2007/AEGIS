const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('aegisBridge', {
  onEvent: cb => ipcRenderer.on('aegis:event', (_e, name) => cb(name)),
  onUpdate: cb => ipcRenderer.on('aegis:update', (_e, patch) => cb(patch)),
  onSay: cb => ipcRenderer.on('aegis:say', (_e, role, text) => cb(role, text)),
  action: (name, data) => ipcRenderer.send('aegis:action', name, data),
  hover: over => ipcRenderer.send('aegis:hover', over),
});
