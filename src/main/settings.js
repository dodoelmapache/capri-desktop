'use strict';

// Her settings window ("Ajustes de Capri"): switches and sliders for what we tuned together (game mode, her voices, sounds, her card). It opens from her tray
// menu or by saying "abre los ajustes". A change applies at once and is kept in her config, like any other.

const path = require('node:path');
const { BrowserWindow, screen } = require('electron');

let win = null;
const current = () => (win && !win.isDestroyed() ? win : null);

// what the window may change: 'bool', [min, max, integer?] for a number, or a list of allowed words
const SPEC = {
  lolMode: 'bool', lolSpeak: 'bool', lolVolume: [0.1, 1], lolClips: 'bool', lolSfx: 'bool', lolShout: 'bool', lolSfxVol: [0.05, 1], lolGap: [10, 300, true],
  heavyMode: 'bool', heavyFps: [0, 12, true], gameClickThrough: 'bool',
  cardAutoClose: [0, 30000, true],
  muted: 'bool', boomSay: 'bool', boomVol: [0.05, 1], volume: [0, 1], quietVolume: [0.1, 1], giggle: 'bool', giggleLevel: [0.1, 1],
  flirtVoiceOn: 'bool', flirtVoice: ['salome', 'dalia', 'elena', 'paloma', 'paola'], englishVoice: ['mine', 'english'],
  dnd: 'bool',
};

// a patch from the window, cleaned: only known keys, in range, of the right type
function clean(patch) {
  const out = {};
  for (const [key, value] of Object.entries(patch || {})) {
    const spec = SPEC[key];
    if (!spec) continue;
    if (spec === 'bool') out[key] = Boolean(value);
    else if (Array.isArray(spec) && typeof spec[0] === 'number') {
      let n = Number(value);
      if (!Number.isFinite(n)) continue;
      n = Math.min(spec[1], Math.max(spec[0], n));
      out[key] = spec[2] ? Math.round(n) : Math.round(n * 100) / 100;
    } else if (Array.isArray(spec) && spec.includes(value)) out[key] = value;
  }
  return out;
}

const read = (cfg) => Object.fromEntries(Object.keys(SPEC).map((k) => [k, cfg[k]]));

function open() {
  const alive = current();
  if (alive) {
    if (alive.isMinimized()) alive.restore();
    alive.show();
    alive.focus();
    return alive;
  }
  const { workArea: a } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const width = 560;
  const height = Math.min(820, a.height - 60);
  win = new BrowserWindow({
    width, height, minWidth: 460, minHeight: 480,
    x: Math.round(a.x + (a.width - width) / 2), y: Math.round(a.y + (a.height - height) / 2),
    backgroundColor: '#14101c', title: 'Capri — Ajustes', autoHideMenuBar: true, show: false,
    icon: path.join(__dirname, '..', '..', 'assets', 'icons', 'capri.ico'),
    webPreferences: { preload: path.join(__dirname, '..', 'settings-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.loadURL('capri://app/src/renderer/settings.html');
  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('capri://')) e.preventDefault(); });
  return win;
}

module.exports = { open, current, clean, read, SPEC };
