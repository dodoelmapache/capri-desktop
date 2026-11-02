'use strict';

// Every new risky file in Downloads is checked with Windows Defender (MpCmdRun.exe, already on the PC) before you open it.
// Defender only REPORTS here (-DisableRemediation): nothing is deleted or moved. A clean file makes no noise.
// For a suspicious one, "VirusTotal" looks up the file's SHA-256 hash on virustotal.com in your browser: the file itself is never uploaded.
// config.avScan (default true) turns it off.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const RISKY = /\.(exe|msi|msix|bat|cmd|ps1|vbs|vbe|js|jse|wsf|jar|dll|scr|com|lnk|hta|reg|iso|img|zip|rar|7z|tar|gz|apk|docm|xlsm|pptm|doc|xls|ppt|rtf|pdf|chm)$/i;
const MAX_BYTES = 2 * 1024 * 1024 * 1024;

function defender() {
  const roots = [process.env.ProgramFiles, process.env.ProgramW6432, 'C:\\Program Files'].filter(Boolean);
  for (const r of roots) {
    const f = path.join(r, 'Windows Defender', 'MpCmdRun.exe');
    if (fs.existsSync(f)) return f;
  }
  try { // newer Windows keeps it with the platform updates
    const base = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows Defender', 'Platform');
    const vers = fs.readdirSync(base).sort().reverse();
    for (const v of vers) { const f = path.join(base, v, 'MpCmdRun.exe'); if (fs.existsSync(f)) return f; }
  } catch { /* none */ }
  return null;
}

// -> { checked: bool, threat: bool, error?: string }
function check(file) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' || !RISKY.test(file)) return resolve({ checked: false });
    let size = 0;
    try { size = fs.statSync(file).size; } catch { return resolve({ checked: false }); }
    if (size > MAX_BYTES) return resolve({ checked: false });
    const exe = defender();
    if (!exe) return resolve({ checked: false, error: 'Windows Defender (MpCmdRun.exe) not found' });
    let out = '';
    const p = spawn(exe, ['-Scan', '-ScanType', '3', '-File', file, '-DisableRemediation'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const timer = setTimeout(() => { try { p.kill(); } catch { /* gone */ } }, 180000);
    p.stdout.on('data', (b) => { out += b.toString(); });
    p.on('error', (e) => { clearTimeout(timer); resolve({ checked: false, error: e.message }); });
    p.on('exit', (code) => {
      clearTimeout(timer);
      const found = code === 2 || /found\s+[1-9]\d*\s+threats?/i.test(out) || /amenaza[s]?\s+encontrada/i.test(out);
      resolve({ checked: code === 0 || code === 2, threat: found, name: (/Threat\s*:\s*(.+)/i.exec(out) || [])[1]?.trim() || '' });
    });
  });
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

module.exports = { check, sha256, RISKY };
