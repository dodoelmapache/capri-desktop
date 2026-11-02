'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scanner', {
  scan: () => ipcRenderer.invoke('scanner:scan'),
  palette: () => ipcRenderer.invoke('scanner:palette'),
  shot: () => ipcRenderer.invoke('scanner:shot'),
  close: () => ipcRenderer.send('scanner:close'),
  size: (w, h) => ipcRenderer.send('scanner:size', { w, h }),
});
