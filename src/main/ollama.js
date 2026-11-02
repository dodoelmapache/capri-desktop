'use strict';

// Talking to her: a local model through Ollama (https://ollama.com). Done from here, not from
// the overlay's page, which can't reach other local ports. Everything stays on this machine
// unless OLLAMA_HOST points somewhere else.

function base() {
  let host = process.env.OLLAMA_HOST || '127.0.0.1:11434';
  if (!/^https?:\/\//.test(host)) host = `http://${host}`;
  return host.replace('://0.0.0.0', '://127.0.0.1').replace(/\/+$/, '');
}

// Ollama's errors come as {"error": "..."}
async function failure(res) {
  const body = await res.text().catch(() => '');
  try {
    return new Error(JSON.parse(body).error);
  } catch {
    return new Error(body || `Ollama answered ${res.status}`);
  }
}

// "Lean" mode (heavy.js): while a game or a heavy program has the PC, she keeps her model out of the way: it is not
// preloaded, it leaves memory 30 s after the last answer (not 15 min) and, if asked, it runs on the CPU so the video
// memory stays with the game.
const IDLE_KEEP = '2m'; // her model leaves memory this long after the last answer (the RAM comes back); the next first answer is a few seconds slower
let keepAlive = IDLE_KEEP;
let cpuOnly = false;
let lean = false;
function setLean(on, opts = {}) {
  lean = Boolean(on);
  cpuOnly = lean && opts.cpuOnly !== false;
  keepAlive = lean ? '30s' : IDLE_KEEP;
}
const tune = (options) => (cpuOnly ? { ...options, num_gpu: 0 } : options);

// The models installed, by name ("llama3.2:latest"...).
async function models() {
  const res = await fetch(`${base()}/api/tags`, { signal: AbortSignal.timeout(2500) });
  if (!res.ok) throw await failure(res);
  const { models: list = [] } = await res.json();
  return list.map((m) => m.name);
}

// The models installed with their size in bytes: [{ name, size }]
async function details() {
  const res = await fetch(`${base()}/api/tags`, { signal: AbortSignal.timeout(2500) });
  if (!res.ok) throw await failure(res);
  const { models: list = [] } = await res.json();
  return list.map((m) => ({ name: m.name, size: Number(m.size) || 0 }));
}

// The models loaded in memory right now, by name ([] if Ollama is off).
async function loaded() {
  try {
    const res = await fetch(`${base()}/api/ps`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return [];
    const { models: list = [] } = await res.json();
    return list.map((m) => m.name);
  } catch {
    return [];
  }
}

// Takes a model out of memory now (keep_alive 0). It stays installed.
async function unload(model) {
  try {
    await fetch(`${base()}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: 0 }),
      signal: AbortSignal.timeout(8000),
    });
    return true;
  } catch {
    return false;
  }
}

// Only the model she is about to use stays in memory: the ones left from another choice (a test of a lighter one, the
// light mode, a picture scan) go out first, so three of them never add up to 28 GB.
async function makeRoom(model) {
  try { for (const name of await loaded()) { if (name !== model) await unload(name); } } catch { /* Ollama is off */ }
}

// Loads the model into memory ahead of the first message (the first answer after a fresh start
// otherwise waits for it to load, which can take a while).
function warm(model) {
  if (lean) return; // (with a game in front nothing is loaded ahead of time)
  makeRoom(model).then(() => fetch(`${base()}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, keep_alive: IDLE_KEEP }), // (the same as an answer: it used to be 15 minutes)
  })).catch(() => {});
}

// Her answer, streamed: onDelta(piece) as it comes, resolves with all of it.
async function chat({ model, messages }, onDelta, signal) {
  if (!lean) await makeRoom(model);
  const res = await fetch(`${base()}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      keep_alive: keepAlive, // she stays loaded while you chat
      options: tune({ temperature: 0.85, num_predict: 240 }),
    }),
    signal,
  });
  if (!res.ok) throw await failure(res);
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.error) throw new Error(msg.error);
      const piece = msg.message?.content || ''; // a thinking model's reasoning comes apart, and is left out
      if (piece) {
        text += piece;
        onDelta(piece);
      }
      if (msg.done) return text;
    }
  }
  return text;
}

// A picture and a question, answered in one go (a model that sees: llava, gemma3, qwen2.5vl, llama3.2-vision...).
async function vision({ model, prompt, image }, signal) {
  const res = await fetch(`${base()}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt, images: [image] }],
      stream: false,
      keep_alive: keepAlive, // stays loaded for the next scan
      options: tune({ temperature: 0.6, num_predict: 150 }), // three short sentences; same context size as her chat so it's the same loaded model
    }),
    signal,
  });
  if (!res.ok) {
    const err = await failure(res);
    throw new Error(/image|vision|multimodal/i.test(err.message) ? `${model} can't see images: install one that does (ollama pull llava) and set "visionModel" in her config` : err.message);
  }
  const data = await res.json();
  return String(data.message?.content || '').trim();
}

// --- Starting it ---------------------------------------------------------------------------------
// Ollama only answers while its app or `ollama serve` is running; nobody starts it on its own after a restart
// unless it's in Windows' startup. So she starts it herself when she needs it (and it's on this PC).
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function binary() {
  if (process.env.OLLAMA_BIN) return process.env.OLLAMA_BIN;
  const installed = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe');
  return fs.existsSync(installed) ? installed : 'ollama';
}

const isLocal = () => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(base());

async function up() {
  try {
    await models();
    return true;
  } catch {
    return false;
  }
}

// Resolves true once it answers: already running, or started now. Never for a server on another machine.
async function ensure(timeoutMs = 20000) {
  if (await up()) return true;
  if (!isLocal()) return false;
  try {
    const child = spawn(binary(), ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {}); // not installed: it stays off, and she says so
    child.unref();
  } catch {
    return false;
  }
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await sleep(700);
    if (await up()) return true;
  }
  return false;
}

module.exports = { base, models, details, loaded, unload, setLean, warm, chat, vision, ensure, up };
