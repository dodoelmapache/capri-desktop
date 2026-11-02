'use strict';

// Folders and files, opened by name without any model: "abre mi carpeta de descargas", "abre el pdf de la cotización", "el último archivo descargado".
//  - folders: a fixed list of yours (Downloads, Documents, Desktop, Pictures, Videos, Music, her captures and clips, Organización Claude, config.extraFolders)
//  - files: searched by name in those same places (three levels deep, never in hidden or system folders); what is found is allowed for her Open buttons
// Nothing is typed into a shell and nothing outside those folders is looked at. Programs (.exe, .bat...) are only shown in their folder, never run (files.js).

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { app, shell } = require('electron');

const plain = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').trim();

function folders(config) {
  const cfg = config.load();
  const desk = app.getPath('desktop');
  const docs = app.getPath('documents');
  const pics = app.getPath('pictures');
  const vids = app.getPath('videos');
  const list = [
    { keys: ['descargas', 'descarga', 'downloads'], label: 'Descargas', dir: app.getPath('downloads') },
    { keys: ['documentos', 'documents', 'docs'], label: 'Documentos', dir: docs },
    { keys: ['escritorio', 'desktop'], label: 'Escritorio', dir: desk },
    { keys: ['imagenes', 'fotos', 'pictures'], label: 'Imágenes', dir: pics },
    { keys: ['videos', 'video'], label: 'Videos', dir: vids },
    { keys: ['musica', 'music'], label: 'Música', dir: app.getPath('music') },
    { keys: ['capturas', 'capturas de pantalla'], label: 'Capturas', dir: cfg.captureDir || path.join(pics, 'Capri', 'Capturas') },
    { keys: ['clips'], label: 'Clips', dir: cfg.clipDir || path.join(vids, 'Capri', 'Clips') },
    { keys: ['organizacion claude'], label: 'Organización Claude', dir: [path.join(desk, 'Organización Claude'), path.join(desk, 'Organizacion Claude')].find((d) => fs.existsSync(d)) || path.join(desk, 'Organización Claude') },
    { keys: ['capri'], label: 'Capri', dir: path.join(docs, 'Capri') },
  ];
  for (const [name, dir] of Object.entries(cfg.extraFolders || {})) list.push({ keys: [plain(name)], label: name, dir: String(dir) });
  return list;
}

// the type words of a request, as extensions ("el pdf", "mi imagen", "una hoja de excel")
const TYPES = [
  [/\bpdf\b/, ['pdf']], [/\b(?:word|doc|docx)\b/, ['docx', 'doc']], [/\b(?:excel|xlsx|hoja de calculo)\b/, ['xlsx', 'xls', 'csv']],
  [/\b(?:presentacion|powerpoint|pptx)\b/, ['pptx', 'ppt']], [/\b(?:imagen|imagenes|foto|fotos|png|jpg|jpeg)\b/, ['png', 'jpg', 'jpeg', 'webp', 'gif', 'psd', 'svg']],
  [/\b(?:video|videos|mp4)\b/, ['mp4', 'mov', 'mkv', 'webm']],
];
const STOP = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'mi', 'mis', 'de', 'del', 'en', 'que', 'se', 'llama', 'llamado', 'llamada', 'archivo', 'archivos', 'documento', 'documentos', 'ultimo', 'ultima', 'ultimos', 'ultimas', 'reciente', 'recien', 'descargado', 'descargada', 'descarga', 'carpeta', 'por', 'favor', 'capri', 'abre', 'abreme', 'abrir', 'busca', 'buscame', 'encuentra', 'encuentrame', 'muestra', 'muestrame', 'word', 'excel', 'pdf', 'imagen', 'foto', 'video', 'presentacion', 'powerpoint', 'hoja', 'calculo']);

function parse(raw) {
  const text = plain(raw);
  const exts = new Set();
  for (const [re, list] of TYPES) if (re.test(text)) list.forEach((e) => exts.add(e));
  const named = /([a-z0-9ñ ]+?)\s*(?:\.|punto )(pdf|docx?|xlsx?|pptx?|png|jpe?g|webp|gif|psd|ai|svg|txt|zip|rar|mp4|mov|mkv|csp|clip|fig|afdesign|blend|obj|stl)\b/.exec(plain(String(raw).replace(/\./g, ' . ')).replace(/ \. /g, '.'));
  if (named) exts.add(named[2]);
  const tokens = text.split(' ').filter((w) => w && !STOP.has(w) && !/^(?:docx?|xlsx?|pptx?|png|jpe?g|webp|gif|psd|svg|txt|zip|rar|mp4|mov|mkv|csp|clip|fig)$/.test(w));
  return { tokens, exts: [...exts], downloads: /\bdescarg/.test(text), latest: /\b(?:ultimo|ultima|ultimos|ultimas|reciente|recien)\b/.test(text) };
}

const SKIP_DIR = /^(?:\.|node_modules$|\$recycle|appdata$|system volume|windows$|program files)/i;
const TEMP_FILE = /\.(?:crdownload|tmp|part|partial|ini)$|^~\$|^desktop\.ini$/i;

function walk(root, { depth = 3, budgetMs = 2500, cap = 20000 } = {}) {
  const out = [];
  const deadline = Date.now() + budgetMs;
  const queue = [[root, 0]];
  let seen = 0;
  while (queue.length && seen < cap && Date.now() < deadline) {
    const [dir, d] = queue.shift();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      seen += 1;
      if (SKIP_DIR.test(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (d < depth) queue.push([full, d + 1]); } else if (e.isFile() && !TEMP_FILE.test(e.name)) out.push(full);
    }
  }
  return out;
}

// Everything (voidtools): if it is installed and running, a file by name is found anywhere on the PC in a blink, through its command-line tool es.exe.
// She only passes it the words of the name (letters and digits) and the extensions; the paths it returns are looked at here, and what is found is allowed
// for her Open buttons like before. If it is not there, or finds nothing, the search above (her usual folders) goes on as always. Config: everythingCli (path to es.exe).
// Install: winget install voidtools.Everything  and  winget install voidtools.Everything.Cli  (or voidtools.com), and leave Everything running.
let esCache; // undefined: not looked yet; null: not there
function esPath(cfg) {
  if (esCache !== undefined && !cfg.everythingCli) return Promise.resolve(esCache);
  const env = process.env;
  const cand = [cfg.everythingCli, path.join(env.ProgramFiles || '', 'Everything', 'es.exe'), path.join(env['ProgramFiles(x86)'] || '', 'Everything', 'es.exe'),
    path.join(env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'es.exe'), path.join(env.LOCALAPPDATA || '', 'Programs', 'Everything', 'es.exe')].filter(Boolean);
  const hit = cand.find((f) => { try { return fs.existsSync(f); } catch { return false; } });
  if (hit) { esCache = hit; return Promise.resolve(hit); }
  return new Promise((resolve) => {
    execFile('where.exe', ['es.exe'], { windowsHide: true, timeout: 3000 }, (err, out) => {
      esCache = !err && out ? String(out).split(/\r?\n/)[0].trim() || null : null;
      resolve(esCache);
    });
  });
}
const OUT_DIR = /\\(?:appdata|node_modules|\$recycle\.bin|windows|program files[^\\]*|\.git|_backup_[^\\]*|_versions)\\/i;

async function everythingSearch(cfg, { tokens, exts }, files) {
  if (process.platform !== 'win32' || cfg.everything === false || !tokens.length) return null;
  const es = await esPath(cfg);
  if (!es) return null;
  const args = ['-n', '80', 'file:', ...tokens.filter((t) => /^[a-z0-9ñ]+$/.test(t)), ...(exts.length ? [`ext:${exts.filter((e) => /^[a-z0-9]+$/.test(e)).join(';')}`] : [])];
  const out = await new Promise((resolve) => {
    execFile(es, args, { windowsHide: true, timeout: 4000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
  if (out === null) return null; // (Everything is not running, or es.exe did not like it: the usual search goes on)
  const rows = [];
  for (const line of out.split(/\r?\n/)) {
    const file = line.trim();
    if (!file || !path.isAbsolute(file) || OUT_DIR.test(file) || TEMP_FILE.test(path.basename(file))) continue;
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    if (!st.isFile()) continue;
    const base = plain(path.basename(file, path.extname(file)));
    if (tokens.some((t) => !base.includes(t))) continue;
    const score = tokens.join('').length / Math.max(1, base.replace(/ /g, '').length) + (base.startsWith(tokens[0]) ? 0.3 : 0);
    rows.push({ path: file, name: path.basename(file), dir: path.basename(path.dirname(file)), mtime: st.mtimeMs, score });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
  const top = rows.slice(0, 5);
  files.remember(top.map((r) => r.path));
  return { ok: true, matches: top, latest: false, tokens: tokens.length, via: 'everything' };
}

let searchFn = null; // set by setup: the search by name, for the phone feature

function setup({ ipcMain, config, files }) {
  ipcMain.handle('fs:openFolder', async (_e, name) => {
    const key = plain(name).replace(/^(?:carpeta|folder)\s+(?:de\s+|of\s+)?/, '');
    const hit = folders(config).find((f) => f.keys.includes(key));
    if (!hit) return { ok: false, error: 'unknown' };
    if (!fs.existsSync(hit.dir)) return { ok: false, error: 'missing', label: hit.label };
    const err = await shell.openPath(hit.dir); // '' when it worked
    return err ? { ok: false, error: err, label: hit.label } : { ok: true, label: hit.label, path: hit.dir };
  });

  const search = (query) => {
    const { tokens, exts, latest, downloads } = parse(query);
    if (!tokens.length && !exts.length && !latest) return { ok: true, matches: [] };
    const roots = downloads ? [app.getPath('downloads')] : [...new Set([app.getPath('downloads'), app.getPath('desktop'), app.getPath('documents'), app.getPath('pictures'), app.getPath('videos')])]; // ("lo último que descargué": only Downloads)
    const rows = [];
    for (const root of roots) {
      for (const file of walk(root, { depth: root === app.getPath('downloads') ? 2 : 3 })) {
        const ext = path.extname(file).slice(1).toLowerCase();
        if (exts.length && !exts.includes(ext)) continue;
        const base = plain(path.basename(file, path.extname(file)));
        if (tokens.some((t) => !base.includes(t))) continue;
        let st;
        try { st = fs.statSync(file); } catch { continue; }
        const score = tokens.length ? tokens.join('').length / Math.max(1, base.replace(/ /g, '').length) + (base.startsWith(tokens[0]) ? 0.3 : 0) : 0;
        rows.push({ path: file, name: path.basename(file), dir: path.basename(path.dirname(file)), mtime: st.mtimeMs, score });
      }
    }
    // the closest name first (a name that is only what you said beats a long one that holds it), then the newest
    rows.sort((a, b) => (tokens.length ? b.score - a.score : 0) || b.mtime - a.mtime);
    const top = rows.slice(0, 5);
    files.remember(top.map((r) => r.path));
    return { ok: true, matches: top, latest, tokens: tokens.length };
  };
  ipcMain.handle('fs:findFiles', async (_e, query) => {
    const q = parse(query);
    const viaEverything = q.latest || q.downloads ? null : await everythingSearch(config.load(), q, files).catch(() => null); // ("el último que descargué": her own look at Downloads)
    return viaEverything || search(query);
  });
  searchFn = search;
}

module.exports = { setup, parse, search: (q) => (searchFn ? searchFn(q) : { ok: false, matches: [] }) };
