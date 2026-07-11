'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudeStatusbar', {
  getReport: () => ipcRenderer.invoke('statusbar:report'),
  refreshReport: () => ipcRenderer.invoke('statusbar:refresh-report'),
  onReport: (callback) => {
    ipcRenderer.on('statusbar:report-update', (_event, report) => callback(report));
  },
});
