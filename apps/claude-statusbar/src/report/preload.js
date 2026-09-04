'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudeStatusbar', {
  getReport: () => ipcRenderer.invoke('statusbar:report'),
  refreshReport: () => ipcRenderer.invoke('statusbar:refresh-report'),
  exportReport: () => ipcRenderer.invoke('statusbar:export-report'),
  openProject: (dir) => ipcRenderer.invoke('statusbar:open-project', dir),
  onReport: (callback) => {
    ipcRenderer.on('statusbar:report-update', (_event, report) => callback(report));
  },
});
