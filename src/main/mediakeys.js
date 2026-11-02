'use strict';

// The keyboard's media keys, taken from Windows while she is out (mediakeys.ps1 holds a keyboard hook that swallows them): her player card answers them
// and Windows' own pop-up stays closed. setEnabled(false) gives them back at once (a game in front, her menu's switch).
// If the helper cannot run, `running` stays false and main.js falls back to registering the keys the usual way.

const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'mediakeys.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const ACTIONS = new Set(['toggle', 'next', 'previous']);

let current = null; // the helper in use: launch.js tells it before it sends a media key itself

function pass() {
  try { current?.stdin.write('pass\n'); } catch { /* it is going away */ }
}

function start({ onKey, onLog }) {
  if (process.platform !== 'win32') return { running: false, setEnabled() {}, stop() {} };
  let child = null;
  let stopped = false;
  let restarts = 0;
  let enabled = false;
  const api = { running: false };

  const send = () => {
    try { child?.stdin.write(`${enabled ? 'on' : 'off'}\n`); } catch { /* it is going away */ }
  };

  const run = () => {
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    api.running = true;
    child.stdin.on('error', () => {});
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      const action = line.trim();
      if (ACTIONS.has(action)) onKey(action);
    });
    current = child;
    child.stderr.on('data', (d) => { const t = String(d).trim(); console.error('[capri] media keys:', t); onLog?.(t); });
    child.on('exit', () => {
      child = null;
      api.running = false;
      if (!stopped && restarts++ < 3) setTimeout(run, 3000);
    });
    setTimeout(send, 600); // (the hook is up a moment after it starts)
  };
  run();

  api.setEnabled = (on) => {
    if (enabled === Boolean(on)) return;
    enabled = Boolean(on);
    send();
  };
  api.stop = () => {
    stopped = true;
    try { child?.stdin.end(); child?.kill(); } catch { /* gone */ }
  };
  return api;
}

module.exports = { start, pass };
