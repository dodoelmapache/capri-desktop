'use strict';

// Her scanner: a see-through frame you move over anything on your screen. SCAN takes a picture of what's
// inside, a model that sees describes it (llm.describeImage), and she tells you about it. Nothing is kept:
// one picture on disk, replaced by the next scan, and only when you press SCAN.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { BrowserWindow, ipcMain, screen, desktopCapturer, nativeImage, clipboard } = require('electron');
const palette = require('./palette');
const capturer = require('./capture');

const HEADER = 34;      // css px: the bar on top of the frame isn't part of the picture
const MAX_SIDE = 1024;  // the model shrinks it anyway: bigger only costs time
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let win = null;
let deps = null;        // { describe({ file, png, signal }), onResult({ ok, text?, error? }) }
let running = null;     // AbortController of the scan in progress
let openMode = '';      // '' (her scanner) or 'shot' (the same frame, to pick the part of the screen for a screenshot)

const dir = () => path.join(os.tmpdir(), 'capri-scan');

function open(mode = '') {
  const wanted = mode === 'shot' ? 'shot' : '';
  if (win && !win.isDestroyed()) {
    if (wanted === openMode) { win.show(); win.focus(); return; }
    const old = win;
    win = null;
    old.destroy(); // (the other kind of frame was open: this one replaces it)
  }
  openMode = wanted;
  const { workArea: a } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const width = 560;
  const height = 400;
  win = new BrowserWindow({
    x: Math.round(a.x + (a.width - width) / 2), y: Math.round(a.y + (a.height - height) / 2), width, height,
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, show: false, title: 'Capri scanner',
    webPreferences: {
      preload: path.join(__dirname, '..', 'scanner-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver', 1);
  win.on('closed', () => {
    running?.abort();
    win = null;
  });
  win.loadURL(`capri://app/src/renderer/scanner.html${openMode ? `?mode=${openMode}` : ''}`);
  Promise.resolve(deps?.warm?.()).catch(() => {}); // the model loads while you place the frame
  win.once('ready-to-show', () => win.show());
}

// What's inside the frame, as a PNG: the frame hides for a moment so it isn't in its own picture.
async function capture(full = false) {
  const b = win.getBounds();
  const display = screen.getDisplayMatching(b);
  const k = display.scaleFactor || 1;
  win.hide();
  try {
    await sleep(230);
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(display.bounds.width * k), height: Math.round(display.bounds.height * k) },
    });
    const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
    if (!src || src.thumbnail.isEmpty()) throw new Error('could not capture the screen');
    const size = src.thumbnail.getSize();
    const r = size.width / display.bounds.width; // the real pixels per css pixel of that picture
    const x = Math.max(0, Math.round((b.x - display.bounds.x) * r));
    const y = Math.max(0, Math.round((b.y + HEADER - display.bounds.y) * r));
    const width = Math.min(size.width - x, Math.round(b.width * r));
    const height = Math.min(size.height - y, Math.round((b.height - HEADER) * r));
    if (width < 20 || height < 20) throw new Error('the frame is too small');
    let img = src.thumbnail.crop({ x, y, width, height });
    const big = Math.max(width, height);
    if (!full && big > MAX_SIDE) img = img.resize({ width: Math.round((width * MAX_SIDE) / big), height: Math.round((height * MAX_SIDE) / big) });
    return img.toPNG();
  } finally {
    if (win && !win.isDestroyed()) win.showInactive();
  }
}

// The whole screen you're on, as a PNG (her own look, ambient.js): nothing is hidden, and nothing is kept but this one file.
async function grabScreen() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const k = display.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(display.bounds.width * k), height: Math.round(display.bounds.height * k) },
  });
  const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
  if (!src || src.thumbnail.isEmpty()) throw new Error('could not capture the screen');
  const { width, height } = src.thumbnail.getSize();
  const big = Math.max(width, height);
  const img = big > MAX_SIDE ? src.thumbnail.resize({ width: Math.round((width * MAX_SIDE) / big), height: Math.round((height * MAX_SIDE) / big) }) : src.thumbnail;
  const png = img.toPNG();
  fs.mkdirSync(dir(), { recursive: true });
  const file = path.join(dir(), 'capri-look.png');
  fs.writeFileSync(file, png);
  return { png, file };
}

function register(d) {
  deps = d;
  ipcMain.handle('scanner:open', (_e, mode) => {
    open(mode);
    return true;
  });
  ipcMain.on('scanner:close', (e) => {
    if (win && e.sender === win.webContents) win.close();
  });
  ipcMain.on('scanner:size', (e, { w, h } = {}) => {
    if (!win || win.isDestroyed() || e.sender !== win.webContents) return;
    const b = win.getBounds();
    const { workArea } = screen.getDisplayMatching(b);
    win.setBounds({
      ...b,
      width: Math.round(Math.min(Math.max(Number(w) || b.width, 200), workArea.x + workArea.width - b.x)),
      height: Math.round(Math.min(Math.max(Number(h) || b.height, 140), workArea.y + workArea.height - b.y)),
    });
  });
  // CAPTURAR: the part of the screen inside the frame, at full size, saved and on the clipboard; the frame goes away (as Win+Shift+S does)
  ipcMain.handle('scanner:shot', async (e) => {
    if (!win || win.isDestroyed() || e.sender !== win.webContents || running) return { ok: false };
    running = new AbortController();
    try {
      const res = await capturer.saveShot(await capture(true));
      deps.onShot?.(res);
      if (res.ok && win && !win.isDestroyed()) win.close();
      return { ok: Boolean(res.ok) };
    } catch (err) {
      deps.onShot?.({ ok: false, error: String(err.message || err).slice(0, 200) });
      return { ok: false };
    } finally {
      running = null;
    }
  });
  // PALETA: the colours of what's inside the frame, no model: read from the pixels
  ipcMain.handle('scanner:palette', async (e) => {
    if (!win || win.isDestroyed() || e.sender !== win.webContents || running) return { ok: false };
    running = new AbortController();
    try {
      const img = nativeImage.createFromBuffer(await capture());
      const res = announcePalette(colorsOf(img));
      if (!res.ok) deps.onPalette?.({ ok: false, error: 'empty' });
      return res;
    } catch (err) {
      deps.onPalette?.({ ok: false, error: String(err.message || err).slice(0, 200) });
      return { ok: false };
    } finally {
      running = null;
    }
  });
  ipcMain.handle('scanner:scan', async (e) => {
    if (!win || win.isDestroyed() || e.sender !== win.webContents || running) return { ok: false };
    running = new AbortController();
    const started = Date.now();
    try {
      const png = await capture();
      fs.mkdirSync(dir(), { recursive: true });
      const file = path.join(dir(), `scan-${Date.now()}.png`);
      fs.writeFileSync(file, png);
      for (const old of fs.readdirSync(dir()).filter((f) => /^scan-\d+\.png$/.test(f)).sort().slice(0, -5)) fs.rmSync(path.join(dir(), old), { force: true }); // the last five stay
      const out = await deps.describe({ file, png, signal: running.signal });
      const text = String(out?.text ?? out ?? '').trim();
      if (!text) throw new Error('empty answer');
      deps.onResult({ ok: true, text, file, engine: out?.engine || '', ms: Date.now() - started });
      return { ok: true };
    } catch (err) {
      if (!running?.signal.aborted) deps.onResult({ ok: false, error: String(err.message || err).slice(0, 200) });
      return { ok: false };
    } finally {
      running = null;
    }
  });
}

// the colours of a picture (a file, or the png of the frame), copied all at once: "#AABBCC #112233 ..."
function colorsOf(img, k = 6) {
  const { width, height } = img.getSize();
  return palette.extract(img.toBitmap(), width, height, { k });
}
function announcePalette(colors, extra = {}) {
  if (!colors.length) return { ok: false };
  clipboard.writeText(colors.map((c) => c.hex).join(' '));
  deps.onPalette?.({ ok: true, colors, ...extra });
  return { ok: true };
}

module.exports = { open, register, grabScreen, colorsOf, announcePalette };
