'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('permission', {
  info: () => ipcRenderer.invoke('permission:info'),
  answer: (answer) => ipcRenderer.send('permission:answer', answer),
});
