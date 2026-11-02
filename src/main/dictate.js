'use strict';

// Dictation anywhere: hold a key combo, talk, let go, and the words are typed where the cursor is.
// dictate.ps1 only watches the keys (it takes none of them); the renderer records and transcribes (talk.js), and paste() types the text.

const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { clipboard } = require('electron');

const SCRIPT = path.join(__dirname, 'dictate.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const VK = { control: 17, ctrl: 17, alt: 18, shift: 16, space: 32, win: 91, f1: 112, f2: 113, f3: 114, f4: 115, f5: 116, f6: 117, f7: 118, f8: 119, f9: 120, f10: 121, f11: 122, f12: 123 };

function vks(combo) {
  const out = String(combo || 'Control+Alt+Space').split('+').map((k) => k.trim().toLowerCase()).map((k) => VK[k] || (k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0));
  return out.every(Boolean) ? out : [17, 18, 32];
}

function start(combo, { onDown, onUp }) {
  if (process.platform !== 'win32') return { stop() {} };
  let child = null;
  let stopped = false;
  let restarts = 0;
  const run = () => {
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Keys', vks(combo).join(',')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    readline.createInterface({ input: child.stdout }).on('line', (l) => { const w = l.trim(); if (w === 'down') onDown(); else if (w === 'up') onUp(); });
    child.stderr.on('data', (d) => console.error('[capri] dictate:', String(d).trim()));
    child.on('exit', () => { child = null; if (!stopped && restarts++ < 3) setTimeout(run, 3000); });
  };
  run();
  return { stop() { stopped = true; try { child?.kill(); } catch { /* gone */ } } };
}

// types the text at the cursor: through the clipboard (Ctrl+V), once the keys of the combo are let go; the old clipboard text comes back
function paste(text) {
  if (process.platform !== 'win32' || !text) return Promise.resolve(false);
  const old = clipboard.readText();
  clipboard.writeText(text);
  const ps = "Add-Type -AssemblyName System.Windows.Forms; Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class CapriPK { [DllImport(\"user32.dll\")] public static extern short GetAsyncKeyState(int k); }'; $i=0; while ($i -lt 40 -and ((([CapriPK]::GetAsyncKeyState(0x11) -band 0x8000) -ne 0) -or (([CapriPK]::GetAsyncKeyState(0x12) -band 0x8000) -ne 0) -or (([CapriPK]::GetAsyncKeyState(0x10) -band 0x8000) -ne 0))) { Start-Sleep -Milliseconds 50; $i++ }; [System.Windows.Forms.SendKeys]::SendWait('^v')";
  return new Promise((resolve) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true, stdio: 'ignore' });
    p.on('exit', () => { setTimeout(() => { try { if (clipboard.readText() === text) clipboard.writeText(old); } catch { /* ok */ } }, 500); resolve(true); });
    p.on('error', () => resolve(false));
  });
}

module.exports = { start, paste, vks };
