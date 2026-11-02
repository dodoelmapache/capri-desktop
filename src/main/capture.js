'use strict';

// Screenshots and screen clips, on request ("haz una captura de pantalla", "graba la pantalla por 30 segundos").
//  - shot: the screen she is on, as a PNG in Pictures\Capri\Capturas (or your "Organización Claude\capturas de pantalla" folder, config.mediaDirs)
//  - clip: the overlay (renderer) records the screen with MediaRecorder and hands the pieces here, which writes them to Videos\Capri\Clips
// She herself is left out of both: her window is excluded from the capture while it runs (setContentProtection), so what you record is your screen, not her.

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { app, desktopCapturer, clipboard, nativeImage } = require('electron');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A picture on the clipboard, and checked: another program (a clipboard manager, the history of Windows) can hold the clipboard for a moment, and then the first try
// is lost without a word. A few tries; then Windows' own way (PowerShell); then the reason. { ok, how?, error? }
async function copyImage(img, file) {
  let last = '';
  for (let i = 0; i < 6; i++) {
    try {
      clipboard.writeImage(img);
      await sleep(60);
      if (!clipboard.readImage().isEmpty()) return { ok: true, how: 'electron' };
      last = 'the clipboard stayed empty';
    } catch (err) {
      last = String(err.message || err).slice(0, 120);
    }
    await sleep(140);
  }
  if (file && process.platform === 'win32') {
    const r = await new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command',
        'Add-Type -AssemblyName System.Windows.Forms, System.Drawing; $i = [System.Drawing.Image]::FromFile($env:CAPRI_IMG); [System.Windows.Forms.Clipboard]::SetImage($i); $i.Dispose()'],
      { windowsHide: true, timeout: 9000, env: { ...process.env, CAPRI_IMG: file } }, (err) => resolve(err ? { ok: false, error: String(err.message || err).slice(0, 120) } : { ok: true, how: 'windows' }));
    });
    if (r.ok) return r;
    last = r.error || last;
  }
  return { ok: false, error: last || 'the clipboard did not take it' };
}

const pad = (n) => String(n).padStart(2, '0');
const stamp = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
};

let saver = null; // set by setup: (png Buffer) => { ok, path, copied }, for the scanner's CAPTURAR

let recordingNow = () => false; // (set once her screen clips exist: is one being recorded?)

function setup({ ipcMain, getOverlay, getDisplay, files, config }) {
  const shotDir = () => config.mediaDirs().shots;
  const clipDir = () => config.mediaDirs().clips;
  const clips = new Map(); // id -> { fd, path }
  recordingNow = () => clips.size > 0;
  let hidden = 0;          // how many captures are asking her to stay out of the picture
  let clipHides = false;   // this clip asked it (a clip with her in the picture does not)

  const protect = (on) => {
    const win = getOverlay();
    if (!win || win.isDestroyed()) return;
    hidden = Math.max(0, hidden + (on ? 1 : -1));
    try { win.setContentProtection(hidden > 0); } catch { /* not supported: she shows in the capture */ }
  };

  async function screenSource() {
    const d = getDisplay();
    const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    return { source: sources.find((s) => String(s.display_id) === String(d.id)) || sources[0], size };
  }

  // a picture that is already taken (the part of the screen the scanner's frame covers): saved as a screenshot, and on the clipboard
  saver = async (png) => {
    try {
      fs.mkdirSync(shotDir(), { recursive: true });
      const file = path.join(shotDir(), `captura-${stamp()}.png`);
      fs.writeFileSync(file, png);
      files.remember([file]);
      let copied = false;
      let copyError = '';
      if (config.load().captureCopy !== false) {
        const c = await copyImage(nativeImage.createFromBuffer(png), file);
        copied = c.ok;
        copyError = c.error || '';
      }
      return { ok: true, path: file, copied, copyError, dir: path.dirname(file) };
    } catch (err) {
      return { ok: false, error: String(err.message || err).slice(0, 200) };
    }
  };

  ipcMain.handle('capture:shot', async () => {
    protect(true);
    try {
      await new Promise((r) => setTimeout(r, 160)); // (her window leaves the picture)
      const { source } = await screenSource();
      if (!source || source.thumbnail.isEmpty()) return { ok: false, error: 'empty' };
      fs.mkdirSync(shotDir(), { recursive: true });
      const file = path.join(shotDir(), `captura-${stamp()}.png`);
      fs.writeFileSync(file, source.thumbnail.toPNG());
      files.remember([file]);
      // on the clipboard too, as the Print Screen key does: ready to paste (Ctrl+V) wherever you want
      let copied = false;
      let copyError = '';
      if (config.load().captureCopy !== false) {
        const c = await copyImage(source.thumbnail, file);
        copied = c.ok;
        copyError = c.error || '';
      }
      return { ok: true, path: file, copied, copyError, dir: path.dirname(file) };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      protect(false);
    }
  });

  // a screenshot on the clipboard, only of what she saved herself
  ipcMain.handle('capture:copy', async (_e, p) => {
    try {
      const file = path.resolve(String(p || ''));
      if (!file.toLowerCase().startsWith(path.resolve(shotDir()).toLowerCase()) || !/\.png$/i.test(file)) return { ok: false, error: 'that file is not one of her screenshots' };
      const img = nativeImage.createFromPath(file);
      if (img.isEmpty()) return { ok: false, error: 'the picture could not be read' };
      return await copyImage(img, file);
    } catch (err) {
      return { ok: false, error: String(err.message || err).slice(0, 120) };
    }
  });

  // the id of the screen to record (the renderer opens it with getUserMedia), and her window out of the picture until it ends
  const releaseClip = () => { if (clipHides) { clipHides = false; protect(false); } };

  ipcMain.handle('capture:source', async (_e, opts) => {
    try {
      const { source } = await screenSource();
      if (!source) return { ok: false, error: 'nosource' };
      releaseClip();
      if (!opts?.withCapri) { protect(true); clipHides = true; } // (she leaves the picture, unless you asked for her in it)
      return { ok: true, id: source.id };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('capture:clipStart', (_e, ext) => {
    try {
      fs.mkdirSync(clipDir(), { recursive: true });
      const id = `${Date.now()}`;
      const file = path.join(clipDir(), `clip-${stamp()}.${ext === 'mp4' ? 'mp4' : 'webm'}`);
      clips.set(id, { fd: fs.openSync(file, 'w'), path: file });
      return { ok: true, id, path: file };
    } catch (err) {
      releaseClip();
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('capture:clipChunk', (_e, id, buf) => {
    const c = clips.get(String(id));
    if (!c) return false;
    try {
      fs.writeSync(c.fd, Buffer.from(buf));
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('capture:clipEnd', (_e, id, ok = true) => {
    const c = clips.get(String(id));
    releaseClip();
    if (!c) return { ok: false };
    clips.delete(String(id));
    try { fs.closeSync(c.fd); } catch { /* closed */ }
    if (!ok) { // nothing was recorded: no empty file left behind
      try { if (fs.statSync(c.path).size < 1000) fs.rmSync(c.path, { force: true }); } catch { /* gone */ }
      return { ok: false };
    }
    files.remember([c.path]);
    return { ok: true, path: c.path };
  });

  // a recording that never ended (the app closed): the window is hers again
  app.on('will-quit', () => { for (const c of clips.values()) { try { fs.closeSync(c.fd); } catch { /* closed */ } } });
}

module.exports = { setup, recording: () => recordingNow(), saveShot: async (png) => (saver ? saver(png) : { ok: false, error: 'not ready' }) };
