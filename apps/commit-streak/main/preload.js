// contextBridge only — no direct Node/Electron access leaks into the renderer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('commitStreak', {
  getState: () => ipcRenderer.invoke('state:get'),
  rescan: () => ipcRenderer.invoke('scan:rescan'),
  snooze: () => ipcRenderer.invoke('notify:snooze'),
  onStateUpdate: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('state:update', handler);
    return () => ipcRenderer.removeListener('state:update', handler);
  },
});
