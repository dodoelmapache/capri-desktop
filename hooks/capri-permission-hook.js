#!/usr/bin/env node
'use strict';

// Claude Code PermissionRequest hook -> Capri, and back.
// Unlike capri-hook.js this one waits: Capri shows Allow / Deny and the answer goes back to Claude.
// Rule #1 still holds: if Capri isn't there, doesn't answer, or anything goes wrong, print nothing
// and exit 0, and Claude asks in the terminal as usual.

const http = require('node:http');

const PORT = Number(process.env.CAPRI_PORT) || 47823;
const WAIT_MS = 280 * 1000; // under the hook's timeout in settings.json (300 s)

const KEEP = ['session_id', 'cwd', 'tool_name', 'tool_input', 'tool_use_id', 'permission_suggestions', 'permission_mode'];

function trim(value, depth = 0) {
  if (typeof value === 'string') return value.length > 600 ? value.slice(0, 600) + '…' : value;
  if (Array.isArray(value)) return depth > 3 ? undefined : value.slice(0, 12).map((v) => trim(v, depth + 1));
  if (value && typeof value === 'object') {
    if (depth > 3) return undefined;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (['content', 'old_string', 'new_string', 'new_source', 'edits'].includes(k)) {
        out[k + '_len'] = typeof v === 'string' ? v.length : Array.isArray(v) ? v.length : 0;
        continue;
      }
      out[k] = trim(v, depth + 1);
    }
    return out;
  }
  return value;
}

// Capri's answer -> what Claude Code expects on stdout
function decision(answer, evt) {
  if (answer === 'allow') return { behavior: 'allow' };
  if (answer === 'always') {
    const out = { behavior: 'allow' };
    if (Array.isArray(evt.permission_suggestions) && evt.permission_suggestions.length) out.updatedPermissions = evt.permission_suggestions;
    return out;
  }
  if (answer === 'deny') return { behavior: 'deny', message: 'Denied from Capri.' };
  return null;
}

function run() {
  const bail = () => process.exit(0);
  const guard = setTimeout(bail, WAIT_MS + 5000);
  guard.unref();

  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 8 * 1024 * 1024) bail();
  });
  process.stdin.on('error', bail);
  process.stdin.on('end', () => {
    let evt;
    try {
      evt = JSON.parse(raw);
      if (!evt || typeof evt !== 'object') return bail();
    } catch {
      return bail();
    }
    const slim = { hook_event_name: 'PermissionRequest' };
    for (const key of KEEP) if (evt[key] !== undefined) slim[key] = key === 'permission_suggestions' ? evt[key] : trim(evt[key]);
    const body = JSON.stringify(slim);
    const req = http.request({
      host: '127.0.0.1',
      port: PORT,
      path: '/permission',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      timeout: WAIT_MS,
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        try {
          const out = decision(JSON.parse(text).answer, evt);
          if (out) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: out } }));
        } catch { /* no answer: the terminal asks */ }
        bail();
      });
    });
    req.on('timeout', () => { req.destroy(); bail(); });
    req.on('error', bail);
    req.end(body);
  });
}

module.exports = { run, decision };
if (require.main === module) run();
