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

  openMainWindow: () => ipcRenderer.invoke('window:openMain'),
  getHistory: () => ipcRenderer.invoke('history:get'),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),
  onHistoryUpdate: (callback) => {
    const handler = (_event, history) => callback(history);
    ipcRenderer.on('history:update', handler);
    return () => ipcRenderer.removeListener('history:update', handler);
  },

  getGaps: () => ipcRenderer.invoke('gaps:get'),
  markGapAsRest: (gap) => ipcRenderer.invoke('restday:markGap', gap),
  getPendingToday: () => ipcRenderer.invoke('pending:getForToday'),
  getRepos: () => ipcRenderer.invoke('repos:list'),
  toggleRepo: (repo, enabled) => ipcRenderer.invoke('repos:toggle', repo, enabled),
  openInEditor: (repoPath) => ipcRenderer.invoke('editor:open', repoPath),
});
