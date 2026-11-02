'use strict';

// Cleaning caches and temporary files, only in a short list of places that are safe to empty (they come back by themselves). Two steps, always:
// scan() says what is there and how big; run(ids) empties what you pressed. Nothing is touched that changed in the last 30 minutes (it may be in
// use), the folders themselves stay, and nothing outside this list is ever deleted. Extra folders: config.cleanPaths (a list of full paths).
// What was freed goes in _logs/clean.log (sizes only).

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

const env = process.env;
const L = env.LOCALAPPDATA || '';
const A = env.APPDATA || '';
const T = env.TEMP || env.TMP || '';
const j = path.join;
const RECENT_MS = 30 * 60000;

const CATS = [
  { id: 'temp', es: 'Archivos temporales', en: 'Temporary files', paths: [T] },
  { id: 'chrome', es: 'Caché de Chrome', en: 'Chrome cache', paths: ['Cache', 'Code Cache', 'GPUCache'].map((d) => j(L, 'Google', 'Chrome', 'User Data', 'Default', d)) },
  { id: 'edge', es: 'Caché de Edge', en: 'Edge cache', paths: ['Cache', 'Code Cache', 'GPUCache'].map((d) => j(L, 'Microsoft', 'Edge', 'User Data', 'Default', d)) },
  { id: 'discord', es: 'Caché de Discord', en: 'Discord cache', paths: ['Cache', 'Code Cache', 'GPUCache'].map((d) => j(A, 'discord', d)) },
  { id: 'adobe', es: 'Cachés de Adobe (medios y vistas)', en: 'Adobe caches (media and previews)', paths: ['Media Cache Files', 'Media Cache', 'Peak Files'].map((d) => j(A, 'Adobe', 'Common', d)) },
  { id: 'gpu', es: 'Cachés de sombreadores (NVIDIA y DirectX)', en: 'Shader caches (NVIDIA and DirectX)', paths: [j(L, 'NVIDIA', 'DXCache'), j(L, 'NVIDIA', 'GLCache'), j(L, 'D3DSCache')] },
  { id: 'crash', es: 'Reportes de fallos', en: 'Crash reports', paths: [j(L, 'CrashDumps'), j(L, 'Microsoft', 'Windows', 'WER', 'ReportArchive')] },
  { id: 'dev', es: 'Cachés de npm y pip', en: 'npm and pip caches', paths: [j(L, 'npm-cache'), j(L, 'pip', 'Cache')] },
].map((c) => ({ ...c, paths: c.paths.filter((p) => p && path.isAbsolute(p)) }));

function log(line) {
  try {
    const dir = path.join(__dirname, '..', '..', '_logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'clean.log'), `${new Date().toISOString()} ${line}\n`);
  } catch { /* a courtesy */ }
}

const catsOf = (config) => {
  const extra = [].concat(config?.load?.().cleanPaths || []).filter((p) => typeof p === 'string' && path.isAbsolute(p) && path.parse(p).dir !== path.parse(p).root);
  return extra.length ? [...CATS, { id: 'extra', es: 'Tus carpetas extra', en: 'Your extra folders', paths: extra }] : CATS;
};

async function sizeOf(dir, deadline) {
  let bytes = 0;
  let files = 0;
  const stack = [dir];
  while (stack.length) {
    if (Date.now() > deadline) break;
    const d = stack.pop();
    let ents;
    try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const p = j(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) stack.push(p);
      else { try { bytes += (await fsp.lstat(p)).size; files += 1; } catch { /* gone or locked */ } }
    }
  }
  return { bytes, files };
}

// [{ id, es, en, bytes, files }] with at least 1 MB each
async function scan(config) {
  if (process.platform !== 'win32') return [];
  const out = [];
  for (const c of catsOf(config)) {
    let bytes = 0;
    let files = 0;
    const deadline = Date.now() + 6000;
    for (const p of c.paths) {
      const r = await sizeOf(p, deadline);
      bytes += r.bytes;
      files += r.files;
    }
    if (bytes >= 1024 * 1024) out.push({ id: c.id, es: c.es, en: c.en, bytes, files });
  }
  return out.sort((a, b) => b.bytes - a.bytes);
}

// Empties what is in `ids` (only ids from the list above): { ok, freed, per: [{ id, freed, kept }] }
async function run(ids, config) {
  if (process.platform !== 'win32') return { ok: false, error: 'windows only' };
  const wanted = new Set([].concat(ids || []).map(String));
  const per = [];
  let total = 0;
  for (const c of catsOf(config).filter((x) => wanted.has(x.id))) {
    let freed = 0;
    let kept = 0;
    for (const root of c.paths) {
      let ents;
      try { ents = await fsp.readdir(root, { withFileTypes: true }); } catch { continue; }
      for (const e of ents) {
        const p = j(root, e.name);
        if (path.dirname(p) !== root) continue; // (never anything but what is directly inside)
        try {
          const st = await fsp.lstat(p);
          if (Date.now() - st.mtimeMs < RECENT_MS) { kept += 1; continue; } // (touched a moment ago: someone may be using it)
          const size = e.isDirectory() && !e.isSymbolicLink() ? (await sizeOf(p, Date.now() + 4000)).bytes : st.size;
          await fsp.rm(p, { recursive: true, force: true, maxRetries: 0 });
          freed += size;
        } catch { kept += 1; } // (in use: it stays)
      }
    }
    total += freed;
    per.push({ id: c.id, freed, kept });
  }
  log(`freed ${Math.round(total / 1048576)} MB (${per.map((p) => `${p.id}:${Math.round(p.freed / 1048576)}`).join(' ')})`);
  return { ok: true, freed: total, per };
}

module.exports = { scan, run };
