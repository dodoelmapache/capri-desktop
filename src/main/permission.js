'use strict';

// Claude asking for permission, answered from Capri: a small Allow / Deny card on top of
// everything, next to the pointer. One card per request; the hook waits on the bridge for it.
// Answered in the terminal instead (or Claude moved on), the card goes away and the hook
// hears nothing, so Claude keeps the terminal's answer.

const path = require('node:path');
const { BrowserWindow, ipcMain, screen } = require('electron');
const config = require('./config');

const W = 440;
const H = 236;

const TEXT = {
  en: { title: 'Claude is asking', allow: 'Allow', always: 'Always', deny: 'Deny', in: 'in' },
  es: { title: 'Claude pide permiso', allow: 'Permitir', always: 'Siempre', deny: 'Denegar', in: 'en' },
  fr: { title: 'Claude demande', allow: 'Autoriser', always: 'Toujours', deny: 'Refuser', in: 'dans' },
};

const pending = new Map(); // webContents id -> { win, resolve, evt }

// "Always" remembered by Capri herself (works in her chat too, where Claude sends no suggestions).
// A rule is the tool, or for Bash the command's first word. Chained or risky commands never get one.
const NEVER = new Set(['rm', 'rmdir', 'del', 'erase', 'rd', 'format', 'diskpart', 'shutdown', 'reg', 'powershell', 'pwsh', 'cmd', 'curl', 'wget', 'iex', 'sudo', 'chmod', 'chown', 'dd', 'mkfs', 'taskkill', 'git']);
function ruleKey(evt) {
  const tool = evt.tool_name;
  if (!tool) return null;
  if (tool === 'Bash') {
    const cmd = String((evt.tool_input || {}).command || '').trim();
    if (!cmd || /[;&|`<>\n]|\$\(/.test(cmd)) return null;
    const first = cmd.split(/\s+/)[0].replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase();
    return !first || NEVER.has(first) ? null : `Bash:${first}`;
  }
  return tool;
}
const isAllowed = (evt) => {
  const key = ruleKey(evt);
  return Boolean(key) && (config.load().allowedRules || []).includes(key);
};
function remember(evt) {
  const key = ruleKey(evt);
  if (!key) return;
  const rules = config.load().allowedRules || [];
  if (!rules.includes(key)) config.save({ allowedRules: [...rules, key] });
}


// The line that says what it's about: the command, the file, the address...
function summary(evt) {
  const input = evt.tool_input || {};
  const pick = input.command || input.file_path || input.notebook_path || input.url || input.path || input.pattern || input.query || input.description;
  if (pick) return String(pick);
  try {
    return JSON.stringify(input).slice(0, 400);
  } catch {
    return '';
  }
}

function place(index) {
  const at = screen.getCursorScreenPoint();
  const { workArea: a } = screen.getDisplayNearestPoint(at);
  const x = Math.min(Math.max(at.x + 24, a.x + 12), a.x + a.width - W - 12);
  const y = Math.min(Math.max(at.y - H / 2 + index * 24, a.y + 12), a.y + a.height - H - 12);
  return { x: Math.round(x), y: Math.round(y) };
}

function finish(id, answer) {
  const item = pending.get(id);
  if (!item) return;
  pending.delete(id);
  if (answer === 'always') remember(item.evt);
  item.resolve(answer);
  if (!item.win.isDestroyed()) item.win.destroy();
}

// Resolves with 'allow' | 'always' | 'deny', or null when the card went away unanswered.
function ask(evt, { lang = 'en', signal } = {}) {
  if (isAllowed(evt)) return Promise.resolve('allow'); // you said "always" to this one before
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      ...place(pending.size), width: W, height: H,
      frame: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      skipTaskbar: true, alwaysOnTop: true, show: false, backgroundColor: '#1a1424',
      title: 'Capri',
      webPreferences: {
        preload: path.join(__dirname, '..', 'permission-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    const id = win.webContents.id;
    pending.set(id, { win, resolve, evt, lang });
    win.on('closed', () => finish(id, null));
    signal?.addEventListener('abort', () => finish(id, null), { once: true });
    win.loadURL('capri://app/src/renderer/permission.html');
    win.once('ready-to-show', () => win.showInactive()); // your typing stays where it was
  });
}

// Claude moved on in that session: whatever it was asking was answered somewhere else.
function settledElsewhere(evt) {
  const name = evt.hook_event_name;
  const everything = ['Stop', 'StopFailure', 'UserPromptSubmit', 'SessionEnd'].includes(name);
  const oneTool = ['PostToolUse', 'PostToolUseFailure', 'PermissionDenied'].includes(name);
  if (!everything && !oneTool) return;
  for (const [id, { evt: asked }] of pending) {
    if (asked.session_id !== evt.session_id) continue;
    if (oneTool) {
      const sameId = asked.tool_use_id && evt.tool_use_id;
      if (sameId ? asked.tool_use_id !== evt.tool_use_id : asked.tool_name !== evt.tool_name) continue;
    }
    finish(id, null);
  }
}

function registerPermissionIpc() {
  ipcMain.handle('permission:info', (e) => {
    const item = pending.get(e.sender.id);
    if (!item) return null;
    const { evt, lang } = item;
    const folder = evt.cwd ? path.basename(evt.cwd) : '';
    return {
      text: TEXT[lang] || TEXT.en,
      tool: evt.tool_name || '?',
      summary: summary(evt),
      folder,
      canAlways: (Array.isArray(evt.permission_suggestions) && evt.permission_suggestions.length > 0) || Boolean(ruleKey(evt)),
    };
  });
  ipcMain.on('permission:answer', (e, answer) => {
    if (['allow', 'always', 'deny'].includes(answer)) finish(e.sender.id, answer);
  });
}

module.exports = { ask, settledElsewhere, registerPermissionIpc };
