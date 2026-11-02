'use strict';

// "Retomar donde quedé": the files you opened last in your working programs (Illustrator, Photoshop, Affinity, Blender, Office...), from the list Windows
// itself keeps (Recent). She reads ONLY that list (a name, a path and when it was last opened): not window titles, not what is inside any file.
// recent({ config, files }) -> { ok, items: [{ path, name, ext, kind, when, day }] }  (day: 'today' | 'yesterday' | 'before')
// The files are handed to files.js so her Open buttons may open them (what would run, like an .exe, is never in this list).
// config.resumeExts overrides the extensions ("ai,psd,blend"); config.resumeDays how far back she looks (default 7).

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const KINDS = {
  design: ['ai', 'eps', 'psd', 'psb', 'afdesign', 'afphoto', 'afpub', 'indd', 'svg', 'kra', 'clip', 'xcf', 'sai2'],
  '3d': ['blend', 'f3d', 'f3z', 'step', 'stp', 'stl', '3mf', 'obj', 'fbx', 'dwg', 'skp'],
  docs: ['docx', 'pptx', 'xlsx', 'pdf'],
};
const SKIP = /node_modules|\\appdata\\local\\temp|\\\.git\\|\\_backup_|\\_versions\\|\\capri-desktop\\|\\\$recycle\.bin/i;

const kindOf = (ext) => Object.keys(KINDS).find((k) => KINDS[k].includes(ext)) || null;

// the targets of the shortcuts in Windows' Recent folder, newest first: [{ t: target, m: ISO date }]
function readRecent() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve([]); return; }
    const script = [
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      '$sh = New-Object -ComObject WScript.Shell',
      "$dir = Join-Path $env:APPDATA 'Microsoft\\Windows\\Recent'",
      'Get-ChildItem -LiteralPath $dir -Filter *.lnk -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 400 | ForEach-Object {',
      '  try { $t = $sh.CreateShortcut($_.FullName).TargetPath } catch { $t = "" }',
      "  if ($t) { [pscustomobject]@{ t = $t; m = $_.LastWriteTime.ToString('o') } }",
      '} | ConvertTo-Json -Compress',
    ].join('\n');
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      if (err || !out) { resolve([]); return; }
      try {
        const data = JSON.parse(String(out).trim() || '[]');
        resolve(Array.isArray(data) ? data : [data]);
      } catch {
        resolve([]);
      }
    });
  });
}

const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

async function recent({ config, files, limit = 6 } = {}) {
  const cfg = config?.load?.() || {};
  const exts = cfg.resumeExts ? String(cfg.resumeExts).toLowerCase().split(/[\s,;]+/).filter(Boolean) : Object.values(KINDS).flat();
  const days = Math.max(1, Number(cfg.resumeDays) || 7);
  const now = new Date();
  const today = midnight(now).getTime();
  const seen = new Set();
  const items = [];
  for (const row of await readRecent()) {
    const target = String(row.t || '');
    const ext = path.extname(target).slice(1).toLowerCase();
    if (!ext || !exts.includes(ext) || SKIP.test(target)) continue;
    const key = target.toLowerCase();
    if (seen.has(key)) continue;
    const when = new Date(row.m);
    if (Number.isNaN(when.getTime()) || now - when > days * 864e5) continue;
    try {
      if (!fs.statSync(target).isFile()) continue; // (gone, moved, or a folder)
    } catch {
      continue;
    }
    seen.add(key);
    const diff = Math.round((today - midnight(when).getTime()) / 864e5);
    items.push({ path: target, name: path.basename(target), ext, kind: kindOf(ext), when: when.getTime(), day: diff <= 0 ? 'today' : diff === 1 ? 'yesterday' : 'before' });
    if (items.length >= limit) break;
  }
  files?.remember?.(items.map((i) => i.path));
  return { ok: true, items };
}

module.exports = { recent, kindOf };
