'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settings', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (patch) => ipcRenderer.invoke('settings:set', patch),
  heavyList: () => ipcRenderer.invoke('heavy:list'),
  heavyEdit: (what, name, game) => ipcRenderer.invoke('heavy:edit', what, name, game),
});
