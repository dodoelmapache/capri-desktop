'use strict';

// Her name, heard on this PC (openWakeWord, tools/install-wakeword.ps1): a small Python program in %LOCALAPPDATA%\Capri\wake that gets the microphone
// as 16 kHz audio from talk.js and says "HIT" when it hears the word. It is quicker than writing every phrase down with a speech service (it answers while
// you are still saying her name) and it costs nothing. It needs a model of the word "Capri" (capri.onnx) in that folder.
// Config: wakeEngine ('auto' = used when installed, 'off'), wakeThreshold (0.5), wakeModel (a file name of that folder), wakeStrict (true: phrases without a hit
// are not sent to the speech service at all).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const dir = () => path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Capri', 'wake');

function found(cfg = {}) {
  try {
    const d = dir();
    const py = path.join(d, 'venv', 'Scripts', 'python.exe');
    const script = path.join(d, 'capri_wake.py');
    if (!fs.existsSync(py) || !fs.existsSync(script)) return null;
    const models = fs.readdirSync(d).filter((f) => /\.onnx$/i.test(f));
    const want = String(cfg.wakeModel || '').toLowerCase();
    const model = (want && models.find((m) => m.toLowerCase() === want)) || models.find((m) => /capri/i.test(m)) || models[0];
    return model ? { dir: d, py, script, model: path.join(d, model), name: model } : null;
  } catch {
    return null;
  }
}

let child = null;
let stopped = false;
let ready = false;
let restarts = 0;
let hit = () => {};

// { onHit(score) }
function start(cfg = {}, onHit) {
  if (onHit) hit = onHit;
  if (process.platform !== 'win32' || child || cfg.wakeEngine === 'off') return false;
  const f = found(cfg);
  if (!f) return false;
  stopped = false;
  ready = false;
  child = spawn(f.py, [f.script, f.model, String(Number(cfg.wakeThreshold) || 0.5)], { cwd: f.dir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.on('data', () => {});
  child.stdin.on('error', () => {}); // (it closed while she was still writing)
  let pending = '';
  child.stdout.on('data', (d) => {
    pending += d.toString();
    let at;
    while ((at = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, at).trim();
      pending = pending.slice(at + 1);
      if (line === 'READY') { ready = true; restarts = 0; } else if (line.startsWith('HIT')) hit(Number(line.split(' ')[1]) || 0);
    }
  });
  child.on('error', (err) => console.error('[capri] wake word:', err.message));
  child.on('exit', () => {
    child = null;
    ready = false;
    if (!stopped && restarts++ < 3) setTimeout(() => start(cfg), 4000);
  });
  console.log(`[capri] wake word started (${f.name})`);
  return true;
}

// 16 kHz, 16-bit mono audio from the renderer
function feed(buf) {
  if (!child || !ready || !child.stdin.writable) return;
  try { child.stdin.write(Buffer.from(buf)); } catch { /* it is going away */ }
}

function stop() {
  stopped = true;
  try { child?.stdin.end(); child?.kill(); } catch { /* gone */ }
  child = null;
  ready = false;
}

const status = (cfg) => ({ installed: Boolean(found(cfg)), running: ready, engine: cfg.wakeEngine === 'off' ? 'off' : 'auto', strict: cfg.wakeStrict === true });

module.exports = { start, feed, stop, status, found };
