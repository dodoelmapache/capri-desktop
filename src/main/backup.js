'use strict';

// Incremental backup of your work folders to an external disk, a USB or a Google Drive folder (Drive for desktop shows up as a normal folder).
// robocopy does the copying: only what is new or changed goes (/XO skips what the destination already has newer or equal), nothing is ever DELETED
// from either side, and no intermediate copy is made on this PC. Before copying she measures what would go (a dry run) and compares it with the free space.
// config: backupSources: [folders], backupDest: folder (e.g. "E:\\Respaldo").

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const BASE = ['/E', '/XO', '/FFT', '/R:1', '/W:1', '/NP', '/NJH', '/NDL', '/XJ', '/XD', 'node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information', '/XF', '*.tmp', '~$*', 'Thumbs.db'];

function robo(src, dst, extra) {
  return new Promise((resolve) => {
    let out = '';
    const p = spawn('robocopy.exe', [src, dst, ...BASE, ...extra], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    p.stdout.on('data', (b) => { out += b.toString('latin1'); });
    p.on('error', (e) => resolve({ ok: false, error: e.message }));
    p.on('exit', (code) => resolve({ ok: code < 8, code, out })); // (robocopy: 0-7 is success of some kind, 8+ is a failure)
  });
}

// The summary rows ("Dirs", "Files", "Bytes" in English, other words in other languages): the last three rows of six whole numbers, in that order.
// Each row: total, copied, skipped, mismatch, failed, extras.
function sums(out) {
  const rows = String(out).split(/\r?\n/).map((l) => /:\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(l)).filter(Boolean).slice(-3);
  const pick = (m) => (m ? { total: +m[1], copied: +m[2], skipped: +m[3], failed: +m[5] } : { total: 0, copied: 0, skipped: 0, failed: 0 });
  return rows.length === 3 ? { files: pick(rows[1]), bytes: pick(rows[2]) } : { files: pick(null), bytes: pick(null) };
}

function freeBytes(dir) {
  try { const s = fs.statfsSync(dir); return s.bavail * s.bsize; } catch { return null; }
}

function target(dest, src) { return path.join(dest, path.basename(src.replace(/[\\/]+$/, '')) || 'respaldo'); }

// what would be copied, without copying: { ok, files, bytes, free, enough }
async function plan({ sources, dest }) {
  if (process.platform !== 'win32') return { ok: false, error: 'only on Windows' };
  if (!dest || !sources?.length) return { ok: false, error: 'not-set' };
  const root = path.parse(path.resolve(dest)).root;
  if (!fs.existsSync(root)) return { ok: false, error: 'dest-missing' }; // (the disk is not plugged in)
  let files = 0;
  let bytes = 0;
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    const r = await robo(src, target(dest, src), ['/L', '/BYTES', '/NFL']);
    if (!r.ok) return { ok: false, error: `could not look at ${path.basename(src)}` };
    const s = sums(r.out);
    files += s.files.copied;
    bytes += s.bytes.copied;
  }
  const free = freeBytes(fs.existsSync(dest) ? dest : root);
  return { ok: true, files, bytes, free, enough: free === null ? true : bytes < free * 0.95 };
}

async function run({ sources, dest }) {
  let files = 0;
  let bytes = 0;
  let failed = 0;
  fs.mkdirSync(dest, { recursive: true });
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    const r = await robo(src, target(dest, src), ['/BYTES', '/NFL']);
    if (!r.ok) return { ok: false, error: `robocopy ${r.code ?? ''} ${r.error || ''}`.trim(), files, bytes };
    const s = sums(r.out);
    files += s.files.copied;
    bytes += s.bytes.copied;
    failed += s.files.failed;
  }
  return { ok: true, files, bytes, failed };
}

module.exports = { plan, run };
