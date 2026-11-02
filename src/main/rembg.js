'use strict';

// Taking the background off a picture on this PC with rembg (tools/install-rembg.ps1): no Claude, no Nano Banana, nothing leaves the PC.
// removeBg(file) -> { ok, path } : "<name> (sin fondo).png" next to the original (PNG with transparency).
// Config: rembgModel ('isnet-general-use' by default; others rembg knows: 'u2net', 'u2netp', 'silueta', 'birefnet-general').

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const dir = () => path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Capri', 'rembg');
const exe = () => path.join(dir(), 'venv', 'Scripts', 'rembg.exe');
const installed = () => process.platform === 'win32' && fs.existsSync(exe());
const IMG = /\.(png|jpe?g|webp|bmp)$/i;

function unique(target) {
  const ext = path.extname(target);
  const base = target.slice(0, -ext.length);
  let out = target;
  for (let i = 2; fs.existsSync(out) && i < 500; i++) out = `${base} (${i})${ext}`;
  return out;
}

// { config, files }
function removeBg(file, { config, files } = {}) {
  return new Promise((resolve) => {
    const src = path.resolve(String(file || ''));
    if (!installed()) { resolve({ ok: false, error: 'not-installed' }); return; }
    if (!IMG.test(src) || !fs.existsSync(src)) { resolve({ ok: false, error: 'not-a-picture' }); return; }
    const out = unique(path.join(path.dirname(src), `${path.basename(src, path.extname(src))} (sin fondo).png`));
    const model = String(config?.load?.().rembgModel || 'isnet-general-use');
    // (the first run downloads the model: that can take a few minutes)
    execFile(exe(), ['i', '-m', model, src, out], { windowsHide: true, timeout: 10 * 60e3, maxBuffer: 4 * 1024 * 1024 }, (err, _out, errOut) => {
      if (err || !fs.existsSync(out)) { resolve({ ok: false, error: String(errOut || err?.message || 'failed').trim().split(/\r?\n/).pop().slice(0, 200) }); return; }
      files?.remember?.([out]);
      resolve({ ok: true, path: out });
    });
  });
}

module.exports = { removeBg, installed };
