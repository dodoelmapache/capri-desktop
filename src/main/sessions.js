'use strict';

// Her conversations, kept across restarts: one entry per topic, like the list of chats you have with Claude.
// { id, title, createdAt, updatedAt, messages: [{ role, content, files? }], claude: { id, started } }
// "claude" is that conversation's own Claude Code session, so a job handed to Claude in it remembers what was said there.

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const MAX_SESSIONS = 80;      // the ones you are using
const MAX_ARCHIVED = 400;     // the archived ones: kept, out of sight, and they don't count against the 80
const MAX_MESSAGES = 300;
const MAX_CHARS = 20000;
const ENGINES = new Set(['local', 'haiku', 'sonnet', 'opus', 'image']);
const VIA = new Set([...ENGINES, 'palette']); // who wrote a message (a palette is hers, from the pixels; it isn't an engine a conversation stays on)

const file = () => path.join(app.getPath('userData'), 'sessions.json');
let cache = null;

function load() {
  if (cache) return cache;
  try {
    const data = JSON.parse(fs.readFileSync(file(), 'utf8'));
    cache = Array.isArray(data.sessions) ? data.sessions : [];
  } catch {
    cache = [];
  }
  return cache;
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    const tmp = `${file()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, sessions: cache }));
    fs.renameSync(tmp, file()); // never half a file
  } catch (err) {
    console.error('[capri] could not save her conversations:', err.message);
  }
}

// whatever the page sends, only this shape goes to disk
function clean(s) {
  if (!s || typeof s !== 'object' || !/^[\w-]{1,64}$/.test(String(s.id || ''))) return null;
  const messages = (Array.isArray(s.messages) ? s.messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_MESSAGES)
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, MAX_CHARS),
      ...(VIA.has(m.via) ? { via: m.via } : {}), // who answered: her own model or a Claude
      ...(Array.isArray(m.files) && m.files.length ? { files: m.files.map(String).slice(0, 6) } : {}),
    }));
  const claude = s.claude && /^[\w-]{1,64}$/.test(String(s.claude.id || '')) ? { id: String(s.claude.id), started: Boolean(s.claude.started) } : null;
  const firstAsk = messages.find((m) => m.role === 'user')?.content.replace(/\s+/g, ' ').trim() || '';
  return {
    id: String(s.id),
    title: String(s.title || firstAsk).replace(/\s+/g, ' ').trim().slice(0, 60),
    createdAt: Number(s.createdAt) || Date.now(),
    updatedAt: Number(s.updatedAt) || Date.now(),
    messages,
    claude,
    ...(ENGINES.has(s.engine) ? { engine: s.engine } : {}), // the engine this conversation was left on
    ...(typeof s.web === 'boolean' ? { web: s.web } : {}),
    ...(s.archived === true ? { archived: true } : {}), // put away: out of her list, still there
  };
}

const list = () => [...load()].sort((a, b) => b.updatedAt - a.updatedAt).map(({ id, title, updatedAt, messages, archived }) => ({ id, title, updatedAt, count: messages.length, archived: archived === true }));

function get(id) {
  const s = load().find((x) => x.id === id);
  return s ? JSON.parse(JSON.stringify(s)) : null;
}

function save(raw) {
  const s = clean(raw);
  if (s && !s.messages.length) { // an empty conversation isn't kept (and one that was emptied, e.g. "start over", is let go)
    remove(s.id);
    return false;
  }
  if (!s) return false;
  const all = load();
  const i = all.findIndex((x) => x.id === s.id);
  if (i >= 0) {
    if (raw.archived === undefined && all[i].archived) s.archived = true; // a save that doesn't know about it doesn't bring it back
    all[i] = s;
  } else all.push(s);
  const trim = (archived, max) => {
    const group = all.filter((x) => (x.archived === true) === archived).sort((a, b) => b.updatedAt - a.updatedAt);
    for (const old of group.slice(max)) all.splice(all.indexOf(old), 1);
  };
  trim(false, MAX_SESSIONS);
  trim(true, MAX_ARCHIVED);
  persist();
  return true;
}

function remove(id) {
  const all = load();
  const i = all.findIndex((x) => x.id === id);
  if (i < 0) return false;
  all.splice(i, 1);
  persist();
  return true;
}

// put a conversation away (or bring it back): it leaves the list but is kept
function archive(id, on = true) {
  const s = load().find((x) => x.id === id);
  if (!s) return false;
  if (on) s.archived = true;
  else delete s.archived;
  persist();
  return true;
}

function clear() {
  cache = [];
  persist();
}

module.exports = { list, get, save, remove, archive, clear, clean };
