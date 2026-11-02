'use strict';

// "¿Qué color es este?" / Alt+C: her own eyedropper. The screen is photographed at once and shown still in a window that covers it, with a magnifier
// under the pointer and the colour's hex; a click takes that pixel (Esc or a right click cancels). The colour goes to the clipboard as #RRGGBB.
// { ok, hex, rgb, hsl } or { ok: false, cancelled? , error? }. What went wrong is written in _logs/color.log.

const fs = require('node:fs');
const path = require('node:path');
const { BrowserWindow, clipboard, desktopCapturer, screen } = require('electron');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (line) => {
  try {
    const dir = path.join(__dirname, '..', '..', '_logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'color.log'), `${new Date().toISOString()} ${line}\n`);
  } catch { /* a packaged app cannot write there */ }
};

function hslOf([r, g, b]) {
  const R = r / 255; const G = g / 255; const B = b / 255;
  const max = Math.max(R, G, B); const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>Capri color</title>
<body style="margin:0;overflow:hidden;cursor:crosshair;background:#000;user-select:none">
<canvas id="c" style="position:fixed;left:0;top:0;width:100vw;height:100vh"></canvas>
<canvas id="m" width="132" height="132" style="position:fixed;display:none;border:3px solid #fff;box-shadow:0 0 0 2px #000, 4px 4px 0 3px #7a3cff;image-rendering:pixelated"></canvas>
<div id="t" style="position:fixed;display:none;padding:4px 8px;background:#0b0615;color:#fff;border-left:5px solid #fff;font:700 13px/1.2 Consolas,monospace;letter-spacing:.06em"></div>
<div style="position:fixed;left:50%;top:14px;transform:translateX(-50%);padding:6px 14px;background:#0b0615;color:#3dff95;font:700 12px Consolas,monospace;letter-spacing:.12em">CAPRI // CUENTAGOTAS · clic: tomar color · Esc: cancelar</div>
<script>
const c = document.getElementById('c'), m = document.getElementById('m'), t = document.getElementById('t');
let cx = null; let mx = m.getContext('2d'); mx.imageSmoothingEnabled = false;
window.__picked = null;
window.setShot = async (url) => {
  const blob = await (await fetch(url)).blob();
  const img = await createImageBitmap(blob);
  c.width = img.width; c.height = img.height;
  cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  return true;
};
const at = (e) => [Math.min(c.width - 1, Math.max(0, Math.floor(e.clientX * c.width / innerWidth))), Math.min(c.height - 1, Math.max(0, Math.floor(e.clientY * c.height / innerHeight)))];
const hexAt = (x, y) => { const d = cx.getImageData(x, y, 1, 1).data; return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase(); };
addEventListener('mousemove', (e) => {
  if (!cx) return;
  const [x, y] = at(e);
  const hex = hexAt(x, y);
  mx.clearRect(0, 0, 132, 132);
  mx.drawImage(c, x - 5, y - 5, 11, 11, 0, 0, 132, 132);
  mx.strokeStyle = '#000'; mx.lineWidth = 2; mx.strokeRect(60, 60, 12, 12);
  mx.strokeStyle = '#fff'; mx.lineWidth = 1; mx.strokeRect(61, 61, 10, 10);
  const px = e.clientX + 26 + 140 > innerWidth ? e.clientX - 26 - 138 : e.clientX + 26;
  const py = e.clientY + 26 + 190 > innerHeight ? e.clientY - 26 - 190 : e.clientY + 26;
  m.style.display = 'block'; m.style.left = px + 'px'; m.style.top = py + 'px';
  t.style.display = 'block'; t.style.left = px + 'px'; t.style.top = (py + 140) + 'px'; t.style.borderLeftColor = hex; t.textContent = hex;
});
addEventListener('mousedown', (e) => {
  if (!cx) return;
  if (e.button === 2) { window.__picked = ''; return; }
  const [x, y] = at(e);
  window.__picked = hexAt(x, y);
});
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('keydown', (e) => { if (e.key === 'Escape') window.__picked = ''; });
</script>`;

let busy = false;

async function pick() {
  log('pick requested');
  if (busy) return { ok: false, error: 'busy' };
  busy = true;
  let win = null;
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const k = display.scaleFactor || 1;
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(display.bounds.width * k), height: Math.round(display.bounds.height * k) } });
    const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
    if (!src || src.thumbnail.isEmpty()) { log('the screen could not be photographed'); return { ok: false, error: 'could not photograph the screen' }; }
    const shot = `data:image/png;base64,${src.thumbnail.toPNG().toString('base64')}`;
    win = new BrowserWindow({
      ...display.bounds, frame: false, show: false, skipTaskbar: true, alwaysOnTop: true, resizable: false, movable: false, fullscreenable: false,
      hasShadow: false, focusable: true, backgroundColor: '#000000', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    win.setAlwaysOnTop(true, 'screen-saver', 2);
    win.setBounds(display.bounds);
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`);
    await win.webContents.executeJavaScript(`window.setShot(${JSON.stringify(shot)})`);
    win.show();
    win.focus();
    let out = null;
    for (let i = 0; i < 750 && out === null; i++) { // (up to a minute)
      if (win.isDestroyed()) { out = ''; break; }
      out = await win.webContents.executeJavaScript('window.__picked').catch(() => '');
      if (out === null) await sleep(80);
    }
    if (!out) return { ok: false, cancelled: true };
    const m = /^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/.exec(String(out).toUpperCase());
    if (!m) { log(`unexpected answer: ${String(out).slice(0, 40)}`); return { ok: false, error: 'unexpected answer' }; }
    const hex = `#${m[1]}${m[2]}${m[3]}`;
    const rgb = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
    clipboard.writeText(hex);
    return { ok: true, hex, rgb, hsl: hslOf(rgb) };
  } catch (err) {
    log(`failed: ${err.stack || err.message}`);
    return { ok: false, error: String(err.message || err).slice(0, 120) };
  } finally {
    busy = false;
    if (win && !win.isDestroyed()) win.destroy();
  }
}

// (main.js asks for a setup step: this eyedropper needs none, it opens its own window when asked)
function setup() {}

module.exports = { setup, pick, hslOf };
