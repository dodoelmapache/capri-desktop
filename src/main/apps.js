'use strict';

// Closing an app when you ask her to (chat.js), after you've confirmed with a click. The apps with
// a window, by name; closing one the way its own close button does (it can still ask you to save),
// and only if you ask again, forcing it. Windows only.

const { execFile } = require('node:child_process');

// never these: the desktop itself, Windows' own pieces, her (Capri), Claude (she watches it) and
// Ollama (she talks through it)
const KEEP = new Set([
  'explorer', 'applicationframehost', 'textinputhost', 'shellexperiencehost', 'startmenuexperiencehost',
  'searchhost', 'searchapp', 'lockapp', 'dwm', 'capri', 'electron', 'claude', 'codex', 'ollama', 'ollama app',
]);

function powershell(script, timeout = 15000, env = null) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `[Console]::OutputEncoding = [Text.Encoding]::UTF8; ${script}`,
    ], { windowsHide: true, timeout, ...(env && { env: { ...process.env, ...env } }) }, (err, out) => (err ? reject(err) : resolve(out.trim())));
  });
}

// [{ name, process, ids }]: one per program with a window open ("AM Music", "Discord"...)
async function list() {
  if (process.platform !== 'win32') return [];
  const out = await powershell(
    'Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | '
    + 'ForEach-Object { [pscustomobject]@{ id = $_.Id; name = $_.ProcessName; label = $_.Description } } | '
    + 'ConvertTo-Json -Compress',
  );
  const rows = [].concat(out ? JSON.parse(out) : []);
  const apps = new Map();
  for (const { id, name, label } of rows) {
    if (id === process.pid || KEEP.has(name.toLowerCase())) continue;
    const app = apps.get(name) || { name, process: name, label: label || '', ids: [] };
    app.ids.push(id);
    apps.set(name, app);
  }
  return [...apps.values()];
}

const simple = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// The open app that `wanted` names, by its name or its description ("am music", "YouTube Music").
async function find(wanted) {
  const key = simple(wanted);
  if (key.length < 2) return null;
  const apps = await list();
  const score = (app) => {
    const names = [simple(app.name), simple(app.label)].filter(Boolean);
    if (names.includes(key)) return 3;
    if (names.some((n) => n.startsWith(key) || key.startsWith(n))) return 2;
    if (key.length >= 3 && names.some((n) => n.includes(key) || key.includes(n))) return 1;
    return 0;
  };
  const best = apps.map((app) => [score(app), app]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0])[0];
  return best ? best[1] : null;
}

// Closes it like its close button would; `force` ends it outright (unsaved work is lost).
// Resolves with what's left: { running } (true when it stayed open, or hid in the tray).
async function close(name, { force = false } = {}) {
  const app = (await list()).find((a) => a.process === name);
  if (!app) return { running: false };
  const ids = app.ids.join(',');
  const out = await powershell(force
    ? `Stop-Process -Id ${ids} -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 600; `
      + `@(Get-Process -Id ${ids} -ErrorAction SilentlyContinue).Count`
    : `foreach ($p in @(Get-Process -Id ${ids} -ErrorAction SilentlyContinue)) { [void]$p.CloseMainWindow() }; `
      + 'Start-Sleep -Milliseconds 2500; '
      + `@(Get-Process -Name '${name.replace(/'/g, "''")}' -ErrorAction SilentlyContinue).Count`);
  return { running: Number(out) > 0 };
}

// The visible windows with a title, one row each: [{ hwnd, pid, proc, title }]. A Chrome app (YouTube Music, WhatsApp...) is a window of chrome.exe, so the
// list of programs above cannot tell it from your browser: its window, by title, can.
const WINDOWS_PS = String.raw`Add-Type -TypeDefinition @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class CapriWin {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  public static List<string[]> All() {
    var list = new List<string[]>();
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      if ((GetWindowLong(h, -20) & 0x80) != 0) return true; // tool windows
      int n = GetWindowTextLength(h);
      if (n < 1) return true;
      var sb = new StringBuilder(n + 1); GetWindowText(h, sb, n + 1);
      uint pid; GetWindowThreadProcessId(h, out pid);
      var cn = new StringBuilder(256); GetClassName(h, cn, 256);
      list.Add(new string[] { h.ToInt64().ToString(), pid.ToString(), sb.ToString(), cn.ToString() });
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
'@
`;

async function windows() {
  if (process.platform !== 'win32') return [];
  const out = await powershell(`${WINDOWS_PS} $rows = foreach ($w in [CapriWin]::All()) { $p = Get-Process -Id ([int]$w[1]) -ErrorAction SilentlyContinue; [pscustomobject]@{ hwnd = $w[0]; pid = [int]$w[1]; proc = $(if ($p) { $p.ProcessName } else { '' }); title = $w[2] } }; $rows | ConvertTo-Json -Compress`, 20000);
  return [].concat(out ? JSON.parse(out) : []).filter((w) => w.pid !== process.pid && !KEEP.has(String(w.proc).toLowerCase()) && !/^(?:program manager|windows input experience|settings)$/i.test(w.title));
}

// The open window that `wanted` names by its title ("youtube music" -> "YouTube Music - Oficial"). A program that is a browser only answers to its own name.
async function findWindow(wanted) {
  const key = simple(wanted);
  if (key.length < 3) return null;
  const rows = await windows();
  const hit = rows
    .map((w) => ({ w, t: simple(w.title) }))
    .filter(({ t }) => t.includes(key) || (key.length >= 6 && key.includes(t) && t.length >= 6))
    .sort((a, b) => a.t.length - b.t.length)[0];
  return hit ? { hwnd: hit.w.hwnd, title: hit.w.title, proc: hit.w.proc } : null;
}

// Closes one window like its X does (WM_CLOSE): the program may still ask to save. { running: it is still there }
async function closeWindow(hwnd) {
  const id = String(hwnd || '');
  if (!/^\d{1,19}$/.test(id)) return { running: false };
  const out = await powershell(`${WINDOWS_PS} $h = [IntPtr][int64]$env:CAPRI_HWND; [void][CapriWin]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero); Start-Sleep -Milliseconds 1800; if ([CapriWin]::IsWindow($h)) { 1 } else { 0 }`, 15000, { CAPRI_HWND: id });
  return { running: Number(out) > 0 };
}

// The windows of File Explorer (its folders), all closed like their X does. The desktop and the taskbar are not among them. { closed: how many }
async function closeExplorer() {
  if (process.platform !== 'win32') return { closed: 0 };
  const out = await powershell(`${WINDOWS_PS} $n = 0; foreach ($w in [CapriWin]::All()) { if ($w[3] -eq 'CabinetWClass') { [void][CapriWin]::PostMessage([IntPtr][int64]$w[0], 0x0010, [IntPtr]::Zero, [IntPtr]::Zero); $n++ } }; Start-Sleep -Milliseconds 800; $n`, 15000);
  return { closed: Number(out) || 0 };
}

// All the windows of one program ("cierra todas las ventanas de Chrome"): the ones whose program or title is that name, each closed like its X. { closed }
async function closeAllOf(wanted) {
  const key = simple(wanted);
  if (key.length < 3 || process.platform !== 'win32') return { closed: 0 };
  const rows = (await windows()).filter((w) => simple(w.proc).includes(key) || simple(w.title).includes(key));
  const ids = rows.map((w) => String(w.hwnd)).filter((h) => /^\d{1,19}$/.test(h));
  if (!ids.length) return { closed: 0 };
  await powershell(`${WINDOWS_PS} foreach ($i in ($env:CAPRI_HWNDS -split ',')) { [void][CapriWin]::PostMessage([IntPtr][int64]$i, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }; Start-Sleep -Milliseconds 800`, 15000, { CAPRI_HWNDS: ids.join(',') });
  return { closed: ids.length, names: [...new Set(rows.map((w) => w.proc))].slice(0, 3) };
}

module.exports = { list, find, close, powershell, windows, findWindow, closeWindow, closeExplorer, closeAllOf };
