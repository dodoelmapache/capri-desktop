#!/usr/bin/env node
'use strict';

// A tiny MCP server with one tool, `approve`: Claude Code's --permission-prompt-tool for the tasks
// Capri hands it (llm.js). Whenever Claude wants to do something that needs permission (edit a file,
// run a command, use one of your MCP tools), it asks here; we ask Capri, who shows her Allow / Deny
// card, and the answer goes back. Anything unclear (Capri gone, no answer) is a Deny.
// Speaks MCP over stdio: one JSON-RPC message per line.

const http = require('node:http');
const readline = require('node:readline');

const PORT = Number(process.env.CAPRI_PORT) || 47823;
const SESSION = process.env.CAPRI_TASK_SESSION || '';
const WAIT_MS = 280 * 1000;

const TOOL = {
  name: 'approve',
  description: 'Ask the user, on Capri\'s Allow / Deny card, whether a tool may run.',
  inputSchema: {
    type: 'object',
    properties: {
      tool_name: { type: 'string', description: 'The tool asking for permission' },
      input: { type: 'object', description: 'What it wants to do' },
      tool_use_id: { type: 'string', description: 'Its call id' },
    },
    required: ['tool_name', 'input'],
  },
};

// long contents don't belong on a small card
function trim(value, depth = 0) {
  if (typeof value === 'string') return value.length > 600 ? `${value.slice(0, 600)}…` : value;
  if (Array.isArray(value)) return depth > 3 ? undefined : value.slice(0, 12).map((v) => trim(v, depth + 1));
  if (value && typeof value === 'object') {
    if (depth > 3) return undefined;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (['content', 'old_string', 'new_string', 'new_source', 'edits'].includes(k)) {
        out[`${k}_len`] = typeof v === 'string' ? v.length : Array.isArray(v) ? v.length : 0;
        continue;
      }
      out[k] = trim(v, depth + 1);
    }
    return out;
  }
  return value;
}

// 'allow' | 'always' | 'deny' | null, from her card
function askCapri(args) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      hook_event_name: 'PermissionRequest',
      session_id: SESSION,
      cwd: process.cwd(),
      tool_name: String(args.tool_name || '?'),
      tool_input: trim(args.input || {}),
      tool_use_id: args.tool_use_id,
    });
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: '/permission', method: 'POST', timeout: WAIT_MS,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(text).answer || null); } catch { resolve(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.end(body);
  });
}

async function approve(args) {
  const answer = await askCapri(args);
  if (answer === 'allow' || answer === 'always') return { behavior: 'allow', updatedInput: args.input || {} };
  return { behavior: 'deny', message: answer === 'deny' ? 'Denied from Capri.' : 'Capri didn\'t answer, so it was denied.' };
}

const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return send({ id, result: { protocolVersion: params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'capri', version: '1.0.0' } } });
  }
  if (method === 'ping') return send({ id, result: {} });
  if (method === 'tools/list') return send({ id, result: { tools: [TOOL] } });
  if (method === 'tools/call') {
    if (params?.name !== TOOL.name) return send({ id, error: { code: -32602, message: `unknown tool ${params?.name}` } });
    const decision = await approve(params.arguments || {});
    return send({ id, result: { content: [{ type: 'text', text: JSON.stringify(decision) }] } });
  }
  if (id !== undefined) return send({ id, error: { code: -32601, message: `no such method ${method}` } });
  return undefined; // a notification (initialized, cancelled...): nothing to answer
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  handle(msg).catch((err) => msg.id !== undefined && send({ id: msg.id, error: { code: -32603, message: String(err.message || err) } }));
});
rl.on('close', () => process.exit(0));
