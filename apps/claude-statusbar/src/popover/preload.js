'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudeStatusbar', {
  onUpdate: (callback) => {
    ipcRenderer.on('statusbar:update', (_event, payload) => callback(payload));
  },
});
