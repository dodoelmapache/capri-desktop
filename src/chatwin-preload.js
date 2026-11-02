'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (fn) => {
  const listener = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('cw', {
  info: () => ipcRenderer.invoke('chatwin:info'),
  prefs: (patch) => ipcRenderer.invoke('chatwin:prefs', patch),
  sessionList: () => ipcRenderer.invoke('session:list'),
  sessionGet: (id) => ipcRenderer.invoke('session:get', id),
  sessionSave: (session) => ipcRenderer.invoke('session:save', session),
  sessionDelete: (id) => ipcRenderer.invoke('session:delete', id),
  sessionArchive: (id, on) => ipcRenderer.invoke('session:archive', id, on),
  orderTry: (request) => ipcRenderer.invoke('order:try', request),
  onListen: on('chatwin:listen'),
  clipsList: () => ipcRenderer.invoke('clips:list'),
  ttsStatus: () => ipcRenderer.invoke('tts:status'),
  ttsSpeak: (request) => ipcRenderer.invoke('tts:speak', request),
  sttStatus: () => ipcRenderer.invoke('stt:status'),
  sttTranscribe: (request) => ipcRenderer.invoke('stt:transcribe', request),
  launchables: () => ipcRenderer.invoke('apps:launchables'),
  chatSend: (request) => ipcRenderer.invoke('chat:send', request),
  chatStop: (id) => ipcRenderer.send('chat:stop', id),
  onDelta: on('chat:delta'),
  pickFiles: () => ipcRenderer.invoke('attach:pick'),
  inspectFiles: (paths) => ipcRenderer.invoke('attach:inspect', paths),
  saveClip: (buffer, ext) => ipcRenderer.invoke('attach:clip', buffer, ext),
  pathOf: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },
  readLinks: (urls) => ipcRenderer.invoke('link:read', urls),
  imageMake: (request) => ipcRenderer.invoke('image:make', request),
  preview: (p) => ipcRenderer.invoke('image:preview', p),
  listSounds: () => ipcRenderer.invoke('sounds:list'),
  usageSummary: (request) => ipcRenderer.invoke('usage:summary', request),
  paletteOf: (p) => ipcRenderer.invoke('palette:file', p),
  openFile: (p) => ipcRenderer.invoke('file:open', p),
  revealFile: (p) => ipcRenderer.invoke('file:reveal', p),
  openExternal: (url) => ipcRenderer.invoke('shell:external', url),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
  onSessionsChanged: on('sessions:changed'),
  onLimit: on('limit:alert'),
  onOpenSession: on('chatwin:open'),
  onLook: on('chatwin:look'),
  designApp: () => ipcRenderer.invoke('design:window'),
  designDock: (rect) => ipcRenderer.invoke('design:dock', rect),
  designBounds: (rect) => ipcRenderer.invoke('design:bounds', rect),
  designUndock: () => ipcRenderer.invoke('design:undock'),
  onDesignFailed: on('design:failed'),
});
