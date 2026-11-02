'use strict';

// Whisper on this PC: whisper.cpp's server (a small program) with a model file, both put in %LOCALAPPDATA%\Capri\whisper by tools\install-whisper-local.ps1.
// She starts it with herself and stops it when she closes. stt.js talks to it like to any other speech service: no key, no limit, nothing leaves the PC.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const dir = () => path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Capri', 'whisper');
const PREFER = ['small', 'base', 'medium', 'turbo']; // (when more than one model is there: the one that is quick first)

function found(cfg = {}) {
  try {
    const d = dir();
    if (!fs.existsSync(d)) return null;
    const exe = ['whisper-server.exe', 'server.exe'].map((n) => path.join(d, n)).find((f) => fs.existsSync(f));
    const models = fs.readdirSync(d).filter((f) => /^ggml-.*\.bin$/i.test(f));
    if (!exe || !models.length) return null;
    const want = String(cfg.sttLocalModel || '').toLowerCase();
    const model = (want && models.find((m) => m.toLowerCase().includes(want)))
      || PREFER.map((p) => models.find((m) => m.toLowerCase().includes(p))).find(Boolean) || models[0];
    return { dir: d, exe, model: path.join(d, model), name: model };
  } catch {
    return null;
  }
}

const installed = (cfg) => Boolean(found(cfg));

let child = null;
let stopped = false;
let restarts = 0;
let plainStart = false; // true once it is known that this version does not take -ac

function start(cfg = {}) {
  if (process.platform !== 'win32' || child) return false;
  const f = found(cfg);
  if (!f) return false;
  let port = 8178;
  try { port = Number(new URL(cfg.sttLocalUrl || 'http://127.0.0.1:8178').port) || 8178; } catch { /* the usual one */ }
  const threads = Math.max(2, Math.min(8, Math.floor(os.cpus().length / 2)));
  stopped = false;
  // -ac 512: the model only looks at the first ~10 seconds of the clip instead of padding it to 30 (a phrase to her is shorter): about three times quicker.
  // If that option is not known to this version it exits at once, and it is started again without it.
  const base = ['-m', f.model, '-l', 'es', '--host', '127.0.0.1', '--port', String(port), '-t', String(threads)];
  const fast = cfg.sttLocalFast !== false && !plainStart;
  const args = fast ? [...base, '-ac', '512'] : base;
  const began = Date.now();
  child = spawn(f.exe, args, { cwd: f.dir, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', () => {}); // (it is chatty)
  child.on('error', (err) => console.error('[capri] local whisper:', err.message));
  child.on('exit', () => {
    child = null;
    if (stopped) return;
    if (fast && Date.now() - began < 6000) { plainStart = true; setTimeout(() => start(cfg), 500); return; } // (it did not like -ac)
    if (restarts++ < 3) setTimeout(() => start(cfg), 4000);
  });
  console.log(`[capri] local whisper started (${f.name}, ${threads} threads, port ${port}${fast ? ', short window' : ''})`);
  return true;
}

function stop() {
  stopped = true;
  try { child?.kill(); } catch { /* gone */ }
  child = null;
}

// Runs tools\install-whisper-local.ps1 (hidden) and answers when it is done; `onStep` gets each "1/3 ..." line.
let installing = null;
function install(root, model = 'small', onStep = () => {}) {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, error: 'only on Windows' });
  if (installing) return installing;
  const script = path.join(root, 'tools', 'install-whisper-local.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`); // (PowerShell cannot read inside the app archive)
  if (!fs.existsSync(script)) return Promise.resolve({ ok: false, error: 'tools\\install-whisper-local.ps1 not found' });
  installing = new Promise((resolve) => {
    let out = '';
    const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Model', model], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const feed = (b) => { const t = b.toString(); out += t; const m = /(\d\/3)\s+(.+)/.exec(t); if (m) onStep(m[1], m[2].trim()); };
    ps.stdout.on('data', feed);
    ps.stderr.on('data', (b) => { out += b.toString(); });
    ps.on('error', (e) => { installing = null; resolve({ ok: false, error: e.message }); });
    ps.on('exit', (code) => { installing = null; resolve(code === 0 && installed({}) ? { ok: true } : { ok: false, error: out.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' ').slice(0, 220) || `code ${code}` }); });
  });
  return installing;
}

module.exports = { installed, found, start, stop, dir, install };
