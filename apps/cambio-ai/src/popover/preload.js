'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cambio', {
  onUpdate: (callback) => {
    ipcRenderer.on('cambio:update', (_event, payload) => callback(payload));
  },
  getState: () => ipcRenderer.invoke('cambio:state'),
  refresh: () => ipcRenderer.invoke('cambio:refresh'),
  setLoginItem: (openAtLogin) => ipcRenderer.invoke('cambio:login-item', openAtLogin),
  resize: (height) => ipcRenderer.send('cambio:resize', height),
  quit: () => ipcRenderer.send('cambio:quit'),
});
