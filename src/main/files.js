'use strict';

// What Capri made or Claude made: the files come back to her with Open / Show-folder buttons, so nobody has to read a
// path out loud. Only files she was told about can be opened from her buttons, and anything that would RUN (an .exe, a
// script) is shown in its folder instead of being launched.

const fs = require('node:fs');
const path = require('node:path');

const allowed = new Set();
const key = (p) => path.resolve(String(p || '')).toLowerCase();
const RISKY = /\.(exe|bat|cmd|ps1|vbs|vbe|js|jse|msi|scr|com|lnk|jar|hta|reg|wsf|dll|pif)$/i;

function remember(list) {
  for (const p of list) allowed.add(key(p));
}

// Claude ends its answer with "FILES: C:\a.png; C:\b.pdf" (TASK_NOTE in llm.js); what it did say in words may also hold
// a full path. Whatever exists comes out as files; the FILES line is taken out of what she says and speaks.
function extract(raw) {
  let text = String(raw || '');
  const found = [];
  text = text.replace(/\bFILES?:[ \t]*([^\n]+)/g, (_m, list) => { // (uppercase on purpose: not the word "files" in a sentence)
    for (const part of list.split(/\s*[;|]\s*/)) found.push(part.trim().replace(/^["'`]+|["'`.]+$/g, ''));
    return '';
  });
  for (const m of text.matchAll(/[A-Za-z]:\\[^\s"'<>|*?\r\n]+/g)) found.push(m[0].replace(/[.,;:)\]]+$/, ''));
  const files = [...new Set(found)].filter((p) => {
    try {
      return path.isAbsolute(p) && fs.existsSync(p);
    } catch {
      return false;
    }
  }).slice(0, 6);
  return { text: text.replace(/\n{3,}/g, '\n\n').trim(), files };
}

async function open(p) {
  const { shell } = require('electron');
  const abs = path.resolve(String(p || ''));
  if (!allowed.has(key(abs)) || !fs.existsSync(abs)) return false;
  if (RISKY.test(abs)) {
    shell.showItemInFolder(abs);
    return true;
  }
  return !(await shell.openPath(abs)); // openPath answers '' when it worked
}

function reveal(p) {
  const { shell } = require('electron');
  const abs = path.resolve(String(p || ''));
  if (!allowed.has(key(abs)) || !fs.existsSync(abs)) return false;
  shell.showItemInFolder(abs);
  return true;
}

// ---- what a job really touched, seen instead of asked for ----
// Claude doesn't always remember to end with a FILES line (a tiny job done with one command never does), so she watches what it DID:
// the files its Write / Edit tools wrote, and the folders named in the commands it ran. When it's over, whatever in those folders was
// created or changed meanwhile comes back as files. A file it only read (an original it didn't touch) is older than the job: left out.
const os = require('node:os');

const newTouch = () => ({ since: Date.now(), writes: new Set(), paths: new Set() });

const expandHome = (s) => String(s)
  .replace(/\$env:USERPROFILE|%USERPROFILE%|\$HOME|\$\{HOME\}|\$env:HOMEPATH/gi, os.homedir())
  .replace(/(^|[\s"'=(])~(?=[\\/])/g, `$1${os.homedir()}`);

// the paths a command line names: inside quotes (they may hold spaces) or bare
function pathsIn(command) {
  const out = new Set();
  const cmd = expandHome(command);
  for (const m of cmd.matchAll(/(["'])((?:[A-Za-z]:[\\/]|\/)[^"'\r\n]+?)\1/g)) out.add(m[2]);
  for (const m of cmd.matchAll(/(?<![\w"'])([A-Za-z]:[\\/][^\s"'<>|*?;,)]+)/g)) out.add(m[1].replace(/[.,;:)\]]+$/, ''));
  for (const m of cmd.matchAll(/(?<![\w"':.])(\/(?:home|Users|mnt|tmp)\/[^\s"'<>|*?;,)]+)/g)) out.add(m[1].replace(/[.,;:)\]]+$/, ''));
  return [...out];
}

// block: a tool_use of Claude's assistant message
function noteTool(touch, block) {
  const input = block?.input || {};
  const name = String(block?.name || '');
  if (/^(?:Write|Edit|MultiEdit)$/.test(name) && input.file_path) touch.writes.add(String(input.file_path));
  else if (name === 'NotebookEdit' && input.notebook_path) touch.writes.add(String(input.notebook_path));
  else if (/^(?:Bash|PowerShell)$/.test(name) && input.command) for (const p of pathsIn(input.command)) touch.paths.add(p);
}

// a script Claude wrote to MAKE the result (make_deck.py): not the result. It is offered only when it is all there is (you asked for a script).
const HELPER = /\.(?:py|js|mjs|cjs|ts|sh|ps1|bat|cmd|vbs)$/i;

const JUNK_NAME = /^(?:\.|~\$|capri-|desktop\.ini$|thumbs\.db$|ntuser)/i;
const JUNK_EXT = /\.(?:tmp|log|lock|swp|bak|pyc|map|crdownload|part)$/i;

// the files a job made or changed: the ones its tools wrote, then what changed in the folders it worked in (newest first), up to `limit`
function discover(touch, { cwd = null, dirs = [], limit = 6, budgetMs = 900, slackMs = 1500 } = {}) {
  const started = Date.now();
  const tmp = path.resolve(os.tmpdir()).toLowerCase();
  const fresh = (st) => st.isFile() && Math.max(st.mtimeMs, st.birthtimeMs || 0) >= touch.since - slackMs;
  const okName = (p) => !JUNK_NAME.test(path.basename(p)) && !JUNK_EXT.test(p) && !path.resolve(p).toLowerCase().startsWith(tmp);
  const out = [];
  const seen = new Set();
  const add = (p) => {
    const k = key(p);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(p);
    }
  };
  const folders = new Set();
  for (const w of touch.writes) { // what its Write / Edit tools wrote: certain, and the folder it wrote in is where a script of it saves its result
    try {
      const p = path.resolve(w);
      if (fs.statSync(p).isFile() && okName(p)) {
        add(p);
        folders.add(path.dirname(p));
      }
    } catch { /* it was moved or deleted afterwards */ }
  }
  for (const p of touch.paths) {
    try {
      const abs = path.resolve(p);
      const st = fs.statSync(abs);
      folders.add(st.isDirectory() ? abs : path.dirname(abs));
      if (st.isFile() && fresh(st) && okName(abs)) add(abs); // named in a command and changed meanwhile
    } catch { /* a path it only mentioned */ }
  }
  if (cwd && path.resolve(cwd).toLowerCase() !== path.resolve(os.homedir()).toLowerCase()) folders.add(path.resolve(cwd)); // her folder, if she has one (not all of your home)
  for (const d of dirs) folders.add(path.resolve(String(d)));
  const found = [];
  let looked = 0;
  for (const dir of folders) {
    if (Date.now() - started > budgetMs) break;
    if (path.resolve(dir).toLowerCase().startsWith(tmp)) continue; // (the temp folder is scratch: skipped, the others still count)
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (++looked > 4000 || Date.now() - started > budgetMs) break;
      const p = path.join(dir, name);
      if (JUNK_NAME.test(name) || JUNK_EXT.test(name)) continue;
      try {
        const st = fs.statSync(p);
        if (fresh(st)) found.push({ p, t: Math.max(st.mtimeMs, st.birthtimeMs || 0) });
      } catch { /* gone */ }
    }
  }
  for (const f of found.sort((a, b) => b.t - a.t)) if (okName(f.p)) add(f.p);
  const results = out.filter((p) => !HELPER.test(p)); // the deck, the PDF, the picture...
  return (results.length ? results : out).slice(0, limit);
}

const isAllowed = (p) => allowed.has(key(p)) && fs.existsSync(path.resolve(String(p || '')));

module.exports = { remember, extract, open, reveal, isAllowed, RISKY, newTouch, noteTool, pathsIn, discover };
