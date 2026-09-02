'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudeStatusbar', {
  getPrefs: () => ipcRenderer.invoke('statusbar:prefs'),
  savePrefs: (patch) => ipcRenderer.invoke('statusbar:save-prefs', patch),
});
