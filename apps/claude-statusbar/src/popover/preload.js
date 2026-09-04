'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudeStatusbar', {
  onUpdate: (callback) => {
    ipcRenderer.on('statusbar:update', (_event, payload) => callback(payload));
  },
  openReport: () => ipcRenderer.send('statusbar:open-report'),
  openPrefs: () => ipcRenderer.send('statusbar:open-prefs'),
  openProject: (dir) => ipcRenderer.invoke('statusbar:open-project', dir),
});
