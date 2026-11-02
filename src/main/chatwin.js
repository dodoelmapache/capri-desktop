'use strict';

// Her conversation window: a real window (resizable, with the list of conversations on the left and the messages to scroll
// and select on the right), for long sessions. The little bubble stays for quick things.

const path = require('node:path');
const { BrowserWindow, screen } = require('electron');
const design = require('./design');

let win = null;

const current = () => (win && !win.isDestroyed() ? win : null);

function open(sessionId = null) {
  const alive = current();
  if (alive) {
    if (alive.isMinimized()) alive.restore();
    alive.show();
    alive.focus();
    if (sessionId) alive.webContents.send('chatwin:open', sessionId);
    return alive;
  }
  const { workArea: a } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  win = new BrowserWindow({
    width: Math.min(1180, a.width - 80), height: Math.min(820, a.height - 80), minWidth: 760, minHeight: 520,
    x: Math.round(a.x + (a.width - Math.min(1180, a.width - 80)) / 2), y: Math.round(a.y + (a.height - Math.min(820, a.height - 80)) / 2),
    backgroundColor: '#14101c', title: 'Capri — Conversaciones', autoHideMenuBar: true, show: false,
    icon: path.join(__dirname, '..', '..', 'assets', 'icons', 'capri.ico'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'chatwin-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadURL(`capri://app/src/renderer/chatwin.html${sessionId ? `#${encodeURIComponent(sessionId)}` : ''}`);
  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => { win = null; design.release(); }); // (its Claude Design tab goes with it)
  // a link in an answer never turns this window into a browser: it opens in yours
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('capri://')) e.preventDefault(); });
  return win;
}

module.exports = { open, current };
