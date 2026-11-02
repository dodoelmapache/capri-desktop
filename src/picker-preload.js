'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('picker', {
  onInit: (fn) => ipcRenderer.on('picker:init', (_e, payload) => fn(payload)),
  done: (hex) => ipcRenderer.send('picker:done', { hex }),
});
