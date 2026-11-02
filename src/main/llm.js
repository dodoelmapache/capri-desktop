'use strict';

// Who she talks with: Ollama, any OpenAI-compatible server (local, cloud, or a keyless gateway),
// or Claude Code itself (headless `claude -p`, so your messages become its prompts).
// Keys come from config.json's `apiKeys` ({ openai: "sk-..." }) or the provider's env variable.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const ollama = require('./ollama');

const PROVIDERS = {
  ollama: { label: 'Ollama (local)', kind: 'ollama', local: true },
  lmstudio: { label: 'LM Studio (local)', url: 'http://127.0.0.1:1234/v1', local: true },
  llamacpp: { label: 'llama.cpp / vLLM (local :8080)', url: 'http://127.0.0.1:8080/v1', local: true },
  pollinations: {
    label: 'Pollinations (no key)', url: 'https://text.pollinations.ai/openai', modelsUrl: 'https://text.pollinations.ai/models',
  },
  openrouter: { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', env: 'OPENROUTER_API_KEY' },
  openai: { label: 'OpenAI', url: 'https://api.openai.com/v1', env: 'OPENAI_API_KEY' },
  groq: { label: 'Groq', url: 'https://api.groq.com/openai/v1', env: 'GROQ_API_KEY' },
  gemini: { label: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai', env: 'GEMINI_API_KEY' },
  deepseek: { label: 'DeepSeek', url: 'https://api.deepseek.com/v1', env: 'DEEPSEEK_API_KEY' },
  mistral: { label: 'Mistral', url: 'https://api.mistral.ai/v1', env: 'MISTRAL_API_KEY' },
  custom: { label: 'Custom (customUrl in config)' },
  claude: { label: 'Claude Code (sends to the terminal agent)', kind: 'claude' },
};

// no bypassPermissions: a chat bubble on the desktop shouldn't run anything without asking
const CLAUDE_MODES = ['default', 'acceptEdits'];

function endpoint(id, cfg) {
  const p = PROVIDERS[id];
  const url = (id === 'custom' ? cfg.customUrl : p.url) || '';
  const key = cfg.apiKeys?.[id] || (p.env && process.env[p.env]) || '';
  return { ...p, url: url.replace(/\/+$/, ''), key };
}

const headers = (key) => ({ 'content-type': 'application/json', ...(key && { authorization: `Bearer ${key}` }) });

async function failure(res) {
  const body = await res.text().catch(() => '');
  const out = (message) => Object.assign(new Error(message), { status: res.status });
  try {
    let parsed = JSON.parse(body);
    if (Array.isArray(parsed)) [parsed] = parsed; // Gemini wraps its errors in a list
    const err = parsed?.error;
    return out(typeof err === 'string' ? err : err?.message || body.slice(0, 200));
  } catch {
    return out(body.slice(0, 200) || `answered ${res.status}`);
  }
}

// The provider's models by name; null when it can't be reached (Ollama only), throws with why otherwise.
async function models(id, cfg) {
  const p = endpoint(id, cfg);
  if (p.kind === 'ollama') return ollama.models().catch(() => null);
  if (p.kind === 'claude') return claudeVersion().then(() => ['Claude Code']);
  // what's missing has a code, so her setup knows what to ask for (setup.js)
  if (!p.url) throw Object.assign(new Error('no address set for this server'), { code: 'nourl' });
  if (p.env && !p.key) throw Object.assign(new Error(`no API key (or ${p.env})`), { code: 'nokey' });
  const res = await fetch(p.modelsUrl || `${p.url}/models`, { headers: headers(p.key), signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw await failure(res);
  const body = await res.json();
  const list = Array.isArray(body) ? body : body.data || body.models || [];
  return list.map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
}

function warm(id, model) {
  if (PROVIDERS[id].kind === 'ollama') ollama.warm(model);
}

// OpenAI-style streaming (server-sent events): onDelta(piece) as it comes, resolves with all of it.
async function openaiChat(p, { model, messages }, onDelta, signal) {
  const res = await fetch(`${p.url}/chat/completions`, {
    method: 'POST',
    headers: headers(p.key),
    body: JSON.stringify({ model, messages, stream: true }),
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
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return text;
      const msg = JSON.parse(data);
      if (msg.error) throw new Error(msg.error.message || msg.error);
      const piece = msg.choices?.[0]?.delta?.content || ''; // reasoning comes apart, and is left out
      if (piece) {
        text += piece;
        onDelta(piece);
      }
    }
  }
  return text;
}

// --- Claude Code ---------------------------------------------------------------------------------
// The prompt goes in on stdin, never on the command line: the shell (needed for an npm claude.cmd)
// only ever sees fixed arguments.

const quote = (s) => (process.platform === 'win32' ? `"${s}"` : s); // cmd joins the arguments
// its session id, picked here so her hooks can tell its events from your other sessions' (main.js)
let claudeSession = null;
let claudeStarted = false; // each message after the first continues the same conversation
let claudeTurns = 0;      // answers in this conversation: it grows with every message, and so does what it costs

function claudeVersion() {
  return new Promise((resolve, reject) => {
    execFile('claude', ['--version'], { shell: process.platform === 'win32', timeout: 10000 }, (err, out) => (
      err ? reject(new Error('Claude Code not found (is `claude` on your PATH?)')) : resolve(out.trim())));
  });
}

function claudeChat(cfg, text, persona, onDelta, signal, port, extra = {}) {
  // her persona, from a file: too long and too full of quotes and newlines for cmd's command line
  const personaFile = path.join(os.tmpdir(), 'capri-persona.txt');
  fs.writeFileSync(personaFile, persona);
  if (!claudeSession) claudeSession = randomUUID();
  const args = ['-p', '--output-format', 'stream-json', '--verbose',
    '--permission-mode', CLAUDE_MODES.includes(cfg.claudeMode) ? cfg.claudeMode : 'default',
    '--include-partial-messages', // her answer arrives word by word: it streams in her bubble and she can start speaking
    '--append-system-prompt-file', quote(personaFile)];
  // anything that needs permission (edit, command, MCP tool) asks on her Allow / Deny card, same as her tasks.
  // Without this a headless chat can't ask anyone: Claude just says "accept the permissions" and nothing shows.
  if (port) {
    const mcpFile = path.join(os.tmpdir(), 'capri-chat-approve-mcp.json');
    fs.writeFileSync(mcpFile, JSON.stringify({
      mcpServers: {
        capri: {
          command: process.execPath,
          args: [approveScript()],
          env: { ELECTRON_RUN_AS_NODE: '1', CAPRI_PORT: String(port), CAPRI_TASK_SESSION: claudeSession },
        },
      },
    }));
    args.push('--permission-prompt-tool', 'mcp__capri__approve', '--mcp-config', quote(mcpFile));
  }
  // a chat bubble doesn't need all your MCP servers and skills booted on every message: that's most of the wait
  if (/^[\w.\-\[\]]+$/.test(cfg.claudeChatModel || '')) args.push('--model', modelId(cfg, cfg.claudeChatModel));
  args.push(...effortFor(cfg, cfg.claudeChatModel));
  if (cfg.claudeLean !== false) args.push('--strict-mcp-config', '--disable-slash-commands');
  for (const dir of extra.dirs || []) args.push('--add-dir', quote(dir)); // the folders of what you attached
  const goChat = (continuing) => runClaude([...args, continuing ? '--resume' : '--session-id', claudeSession], {
    meta: { kind: 'chat', model: cfg.claudeChatModel, sid: claudeSession },
    onTouched: extra.onTouched,
    onSessionId: (id) => chatIds.add(id),
    text, cwd: cfg.claudeCwd, onDelta, signal,
    env: cfg.claudeLean !== false ? { ...process.env, MAX_THINKING_TOKENS: '0' } : process.env, // no long thinking for a chat bubble
    onOutput: () => { claudeStarted = true; },
  });
  return withSessionFlag(goChat, claudeStarted, (continuing) => { claudeStarted = continuing; }).then((result) => { claudeTurns += 1; return result; });
}

// How rigorously Claude works (its --effort: low, medium, high, xhigh, max). Only when you pick one in her menu (Rigor of Claude); without it,
// Claude Code keeps its own. Haiku has no such levels, so it is left alone.
// Which version of a family and how hard it thinks, per family (settings window: verSonnet / effSonnet ...). '' = Claude Code's own latest / the general rigor.
const FAMILIES = ['haiku', 'sonnet', 'opus'];
const familyOf = (m) => FAMILIES.find((f) => new RegExp(f, 'i').test(m || '')) || '';
let prefs = {}; // last config seen (setModelPrefs), for the calls that get no cfg (selected text)
const setModelPrefs = (cfg) => { prefs = cfg || {}; };
const modelId = (cfg, m) => {
  const fam = FAMILIES.includes(m) ? m : '';
  const v = String((cfg || prefs)?.[`ver${fam.replace(/^./, (c) => c.toUpperCase())}`] || '');
  return fam && /^claude-[\w.\-]+$/.test(v) ? v : m;
};
const effortFor = (cfg, m) => {
  const fam = familyOf(m);
  const own = fam && fam !== 'haiku' ? String((cfg || prefs)?.[`eff${fam.replace(/^./, (c) => c.toUpperCase())}`] || '') : '';
  return effortArgs(own || (cfg || prefs)?.claudeEffort, m);
};
const effortArgs = (level, model) => (/^(low|medium|high|xhigh|max)$/.test(level || '') && !/haiku/i.test(model || '') ? ['--effort', level] : []);

// One question to Claude, no tools, no MCP, no skills, in an empty folder: for text you selected on any page. What's inside <texto> is
// data (a web page can say anything): the tools that could read or change anything are switched off anyway.
const NO_TOOLS = 'Read,Glob,Grep,Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,Task';
function claudeOnce(model, instructions, text, signal) {
  const m = /^[\w.\-\[\]]+$/.test(model || '') ? model : 'haiku';
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'default', '--strict-mcp-config', '--disable-slash-commands',
    '--disallowedTools', NO_TOOLS, '--model', modelId(null, m), ...effortFor(null, m), '--session-id', randomUUID()];
  return runClaude(args, {
    meta: { kind: 'selection', model: m },
    onSessionId: (id) => taskIds.add(id),
    text: `${instructions}\n\n<texto>\n${text}\n</texto>`,
    cwd: os.tmpdir(), env: { ...process.env, MAX_THINKING_TOKENS: '0' }, onDelta: () => {}, signal,
  });
}

// `claude -p` with these arguments, the prompt on stdin: the words as they stream in, then all of them.
const fileTools = require('./files');
let usageSink = null; // (entry) => void: main.js keeps count of what each job used (usage.js)
const setUsageSink = (fn) => { usageSink = fn; };
let limitSink = null; // (info) => void: Claude Code's own word on your 5-hour / weekly limit, when it gives it (rate_limit_event)
const setLimitSink = (fn) => { limitSink = fn; };

function runClaude(args, { text, cwd, env, onDelta, signal, onOutput, onTouched, onSessionId, meta = {} }) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      cwd: cwd || os.homedir(),
      shell: process.platform === 'win32',
      windowsHide: true,
      env,
    });
    const kill = () => (process.platform === 'win32'
      ? execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], () => {})
      : child.kill());
    signal.addEventListener('abort', kill, { once: true });
    let buffer = '';
    let all = '';
    let result = null;
    let errors = '';
    let current = null;          // the message being streamed
    let lastSeenId = null;
    let lastCall = null;         // the usage of the last call to the model: how much of its window the conversation fills
    const touch = fileTools.newTouch(); // what its tools wrote and where its commands worked: the files it made, seen instead of asked for
    const streamed = new Set();   // messages whose text already came as deltas
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        onOutput?.();
        if (msg.session_id && msg.session_id !== lastSeenId) { // the id Claude Code really uses (a resumed conversation may have a new one): its hooks are hers too
          lastSeenId = msg.session_id;
          try { onSessionId?.(msg.session_id); } catch { /* never breaks a job */ }
        }
        if (msg.type === 'rate_limit_event' && msg.rate_limit_info && limitSink) {
          try { limitSink(msg.rate_limit_info); } catch { /* never breaks a job */ }
          continue;
        }
        if (msg.type === 'assistant' && !msg.parent_tool_use_id && msg.message?.usage) lastCall = msg.message.usage;
        if (msg.type === 'assistant') for (const block of msg.message?.content || []) if (block.type === 'tool_use') fileTools.noteTool(touch, block);
        if (msg.type === 'stream_event') {
          if (msg.parent_tool_use_id) continue; // a sub-agent's words aren't hers
          const ev = msg.event || {};
          if (ev.type === 'message_start') current = ev.message?.id || null;
          else if (ev.type === 'content_block_start' && ev.content_block?.type === 'text' && all) {
            all += '\n';
            onDelta('\n');
          } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
            if (current) streamed.add(current);
            all += ev.delta.text;
            onDelta(ev.delta.text);
          }
        } else if (msg.type === 'assistant') {
          if (msg.parent_tool_use_id || streamed.has(msg.message?.id)) continue; // already came in pieces
          for (const block of msg.message?.content || []) {
            if (block.type !== 'text' || !block.text) continue;
            const piece = (all ? '\n' : '') + block.text;
            all += piece;
            onDelta(piece);
          }
        } else if (msg.type === 'result') {
          result = msg;
        }
      }
    });
    child.stderr.on('data', (chunk) => { errors += chunk; });
    child.stdin.end(text);
    child.on('error', reject);
    child.on('close', () => {
      try { onTouched?.(touch); } catch { /* never breaks a job */ }
      if (result && usageSink) {
        try { usageSink({ ...meta, result, lastCall }); } catch { /* counting must never break a job */ }
      }
      if (signal.aborted) return reject(new Error('stopped'));
      if (result?.is_error) return reject(new Error(result.result || 'Claude Code failed'));
      if (!result) return reject(new Error(errors.trim().slice(0, 300) || 'Claude Code gave no answer'));
      resolve(result.result || all);
    });
  });
}


// --- Tasks ---------------------------------------------------------------------------------------
// What you ask Claude Code by voice ("dile a Claude que…", "en Figma…"). It works in your project with
// ALL your MCP servers, in its own conversation, and anything that needs permission (a file change, a
// command, a Figma or Canva action) asks on her Allow / Deny card, through hooks/capri-mcp-approve.js.
let taskSession = null;
let taskStarted = false;

const approveScript = () => path.resolve(__dirname, '..', '..', 'hooks', 'capri-mcp-approve.js')
  .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

const TASK_NOTE = [
  'You were asked by voice through Capri, a small companion on the user\'s desktop. Do what they ask in their project or with their connected tools (MCP).',
  'Anything that changes something asks the user first, on Capri\'s card: just go ahead and use the tool.',
  'When you finish, answer in one to three short plain sentences saying what you did: it is read out loud, so no markdown, no lists, no emoji. Use the user\'s language.',
  'Do NOT say where files are saved or read out paths: Capri shows Open and Show-folder buttons. If you created or changed files, folders or documents for the user, put one extra LAST line in your answer, exactly like this (absolute paths, separated by semicolons, most important first): FILES: C:\\full\\path\\one.png; C:\\full\\path\\two.pdf',
].join('\n');

// For "¿qué me dices sobre...?": a look-it-up job. Reading the web is allowed without asking (it only reads); it answers in a short
// paragraph with where it read it, and doesn't make files unless asked.
const RESEARCH_NOTE = [
  'You were asked by voice through Capri, a small companion on the user\'s desktop. The user wants to know about a topic.',
  'Look it up on the web (WebSearch, then WebFetch on the best pages) and answer from what you find, not from memory: things change. Use the user\'s language.',
  'Answer in one short paragraph of at most six sentences, plain text (no markdown, no lists, no emoji: it is read out loud). End with one short sentence naming the one to three sites you relied on.',
  'Do not create or change any file unless the user asks for it. If the topic is ambiguous, answer the most likely meaning and say which one you took.',
].join('\n');

// In her conversation window (a real chat, long sessions): full answers, formatting welcome, tools when they help
const WINDOW_NOTE = [
  'You are Claude, talking with the user inside Capri\'s conversation window on their Windows PC (Capri is a small desktop companion; this is her full chat). Keep the personality light: you are helpful first.',
  'Answer the way a good chat assistant does: complete, well organized, in the user\'s language. Markdown is rendered (lists, headings, code blocks), so use it where it helps; do not shorten answers to a few sentences.',
  'Use your tools when they help (read files, search the web, edit things, run commands): Capri asks the user to approve anything that changes something, on her cards. Just go ahead and use them.',
  'If you create or change files, folders or documents for the user, do not spell out their paths: end your answer with one extra LAST line exactly like: FILES: C:\\full\\path\\one.png; C:\\full\\path\\two.pdf',
].join('\n');

const sendDir = (cfg) => cfg.sendDir || path.join(os.homedir(), 'Desktop', 'Para enviar');

// what Claude is told about sending files: Blip has no watched folder, so they wait in one for you to drag into it
function sendNote(cfg) {
  const lines = [
    `When the user asks to send files to their tablets, phone or Blip, DO NOT just open the files or folders: find the files they mean, copy them (do not move) into "${sendDir(cfg)}" (create it if missing), and then put those same files on the Windows clipboard with PowerShell: Set-Clipboard -Path "<file1>","<file2>". Blip cannot be controlled, so the user finishes it: open Blip, click the device and press Ctrl+V. Say that in your last sentence.`,
  ];
  if (cfg.syncDir && fs.existsSync(cfg.syncDir)) lines.push(`ALSO copy them into "${cfg.syncDir}": it syncs to the user's devices on its own, so they arrive without Blip.`);
  else lines.push('If a Google Drive tool is available you may upload there instead when the user asks to send by Drive.');
  return lines.join('\n');
}

function claudeTask(cfg, text, onDelta, signal, port) {
  // a conversation of hers brings its own Claude session (what was said in it is what Claude remembers); else the shared one
  const own = cfg.taskSession?.id ? cfg.taskSession : null;
  if (!own && !taskSession) taskSession = randomUUID();
  const sid = own ? own.id : taskSession;
  const resume = own ? own.started : taskStarted;
  taskIds.add(sid);
  const dir = os.tmpdir();
  const noteFile = path.join(dir, 'capri-task-note.txt');
  const mcpFile = path.join(dir, 'capri-approve-mcp.json');
  fs.writeFileSync(noteFile, cfg.windowJob ? WINDOW_NOTE : cfg.researchJob ? RESEARCH_NOTE : `${TASK_NOTE}\n${sendNote(cfg)}`);
  fs.writeFileSync(mcpFile, JSON.stringify({
    mcpServers: {
      capri: {
        command: process.execPath, // Capri's own Electron, run as plain node: no node needed on the PC
        args: [approveScript()],
        env: { ELECTRON_RUN_AS_NODE: '1', CAPRI_PORT: String(port), CAPRI_TASK_SESSION: sid },
      },
    },
  }));
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--permission-mode', 'default', '--permission-prompt-tool', 'mcp__capri__approve',
    '--mcp-config', quote(mcpFile), '--append-system-prompt-file', quote(noteFile)];
  // her tasks may read and write in your Organizacion Claude folder (and any folder in claudeDirs), besides the project's
  for (const dir of [path.join(os.homedir(), 'Desktop', 'Organizacion Claude'), path.join(os.tmpdir(), 'capri-scan'), sendDir(cfg), cfg.syncDir, ...(Array.isArray(cfg.claudeDirs) ? cfg.claudeDirs : [])]) {
    if (typeof dir === 'string' && dir && fs.existsSync(dir)) args.push('--add-dir', quote(dir));
  }
  if (cfg.researchJob || cfg.allowWeb) args.push('--allowedTools', 'WebSearch,WebFetch'); // only reads the web: no card for it
  if (/^[\w.\-\[\]]+$/.test(cfg.claudeTaskModel || '')) args.push('--model', modelId(cfg, cfg.claudeTaskModel));
  args.push(...effortFor(cfg, cfg.claudeTaskModel));
  const go = (continuing) => runClaude([...args, continuing ? '--resume' : '--session-id', sid], { meta: { kind: cfg.windowJob ? 'window' : cfg.researchJob ? 'search' : 'task', model: cfg.claudeTaskModel, sid }, onTouched: cfg.onTouched, onSessionId: (id) => taskIds.add(id), text, cwd: cfg.claudeCwd, env: process.env, onDelta, signal, onOutput: () => { if (own) cfg.onTaskStarted?.(); else taskStarted = true; } });
  return withSessionFlag(go, resume, (continuing) => {
    if (!own) taskStarted = continuing; // (the shared one keeps its own flag; a conversation's is saved by Capri's chat from claudeStarted)
  });
}

// Whether a Claude conversation already exists is a flag she keeps, and a job that started it and then failed (or was stopped) leaves it wrong:
// "Session ID ... is already in use" (it exists, she said create) or "No conversation found" (it doesn't, she said resume).
// She goes the other way once, instead of failing every time after that.
async function withSessionFlag(go, resume, remember = () => {}) {
  try {
    return await go(resume);
  } catch (err) {
    const msg = String(err?.message || err);
    if (!resume && /already in use/i.test(msg)) {
      remember(true);
      return go(true);
    }
    if (resume && /no conversation found/i.test(msg)) {
      remember(false);
      return go(false);
    }
    throw err;
  }
}

const resetTask = () => { taskSession = null; taskStarted = false; };
const taskIds = new Set(); // the Claude sessions of her conversations: their hooks are hers too
let scanSession = null; // the one-shot Claude Code run that reads a scan (her scanner): its hooks count as a task of hers
const isTaskSession = (id) => Boolean(id) && (id === taskSession || id === scanSession || taskIds.has(id));

// Your MCP servers, as Claude Code lists them: [{ name, ok }]
function mcpList() {
  return new Promise((resolve, reject) => {
    execFile('claude', ['mcp', 'list'], { shell: process.platform === 'win32', timeout: 60000, windowsHide: true, cwd: os.homedir(), maxBuffer: 1024 * 1024 }, (err, out) => {
      if (err && !out) return reject(new Error('Claude Code not found (is `claude` on your PATH?)'));
      const list = [];
      for (const line of String(out).split(/\r?\n/)) {
        const m = /^(.+?):\s+.+?\s+-\s+(.*)$/.exec(line.trim());
        if (m) list.push({ name: m[1].trim(), ok: /connected/i.test(m[2]) && !/not connected|fail/i.test(m[2]) });
      }
      resolve(list);
    });
  });
}

function resetClaude() {
  claudeSession = null;
  claudeStarted = false;
  claudeTurns = 0;
}

// Claude Code's conversation, to save and pick up again after a restart.
const claudeMemory = () => ({ session: claudeSession, started: claudeStarted, turns: claudeTurns });
function restoreClaude(saved) {
  claudeSession = saved?.session || null;
  claudeStarted = Boolean(claudeSession && saved.started);
  claudeTurns = claudeStarted ? Math.max(0, Number(saved.turns) || 0) : 0;
}

const chatIds = new Set(); // the ids her chat with Claude really got
const isChatSession = (id) => Boolean(id) && (id === claudeSession || chatIds.has(id));

// A message with pictures: { role, content, images: [{ mime, b64 }] } becomes what each kind of server takes
function withImages(kind, messages) {
  return messages.map((m) => {
    if (!m.images?.length) return m;
    if (kind === 'ollama') return { role: m.role, content: m.content, images: m.images.map((i) => i.b64) };
    return { role: m.role, content: [{ type: 'text', text: m.content }, ...m.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.b64}` } }))] };
  });
}

async function chat(id, cfg, { model, messages }, onDelta, signal, port, extra = {}) {
  const p = endpoint(id, cfg);
  if (p.kind === 'ollama') return ollama.chat({ model, messages: withImages('ollama', messages) }, onDelta, signal);
  // Claude Code keeps its own memory of the conversation: only her persona and your last message go
  if (p.kind === 'claude') return claudeChat(cfg, messages.at(-1).content, messages[0].content, onDelta, signal, port, extra);
  return openaiChat(p, { model, messages: withImages('openai', messages) }, onDelta, signal);
}

// Whether her answers stay on this PC: a server on this machine.
function isLocal(id, cfg) {
  if (id === 'ollama') return /^(https?:\/\/)?(127\.0\.0\.1|localhost|0\.0\.0\.0|\[?::1\]?)(:|\/|$)/.test(process.env.OLLAMA_HOST || '127.0.0.1');
  if (id === 'custom') return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(cfg.customUrl || '');
  return Boolean(PROVIDERS[id].local);
}

// --- Her scanner ---------------------------------------------------------------------------------
// A picture of the part of your screen inside her frame (scanner.js), described in her voice.
// Claude Code reads it from a file in its own folder; the others get it inline (Ollama, OpenAI-style APIs).
const LANG_NAME = { es: 'Spanish', en: 'English', fr: 'French', pt: 'Portuguese', ru: 'Russian' };

function visionPrompt(cfg, lang, mode = 'describe') {
  const voice = cfg.persona ? `How you talk to the user: ${cfg.persona}` : '';
  if (mode === 'remark') { // her own look at your screen, unasked: one remark, not a description
    return [
      'You are Capri, a witty cyberpunk companion that lives on the user\'s desktop and glances at their screen now and then, like a friend looking over their shoulder.', voice,
      'The image is their screen right now. Make ONE short remark (one or two sentences) about what they seem to be doing: encouraging, teasing or practical, in character.',
      'Talk about the kind of activity and what you see in general (the artwork, the code, the song, the layout). NEVER read out or repeat private text: messages, emails, names, numbers, passwords, addresses.',
      'If the screen is empty, locked, a game, a call, something private or banking, or you have nothing interesting to say, answer exactly: NOTHING',
      `Otherwise answer in ${LANG_NAME[lang] || 'the user\'s language'}, plain text, no markdown, no lists, no emoji (it is read out loud).`,
    ].filter(Boolean).join('\n');
  }
  return [
    'You are Capri, a witty cyberpunk companion that lives on the user\'s desktop.', voice,
    'The image is a crop of the user\'s screen that they just pointed you at. Say what you see and, if it helps, what stands out or what they could do next.',
    `Answer in ${LANG_NAME[lang] || 'the user\'s language'}, in at most three short sentences, plain text: no markdown, no lists, no emoji (it is read out loud). Never invent what you cannot read.`,
  ].filter(Boolean).join('\n');
}

// Who looks at the picture (config scanProvider): 'auto' = a vision model you already have in Ollama (free, on this
// PC) and, only if there is none, whatever her chat uses; 'ollama' = only that; 'claude' = Claude Code (costs usage).
const VISION_MODEL = /llava|bakllava|moondream|gemma3|qwen2\.?5?-?vl|qwen3-vl|llama3\.2-vision|minicpm-v|granite3\.2-vision|mistral-small3|phi3\.5-vision|vision/i;

// Is Ollama up, which models it has, which of them see images: { running, models, vision }
// start: if it's off, turn it on first (and say so with started: true).
async function ollamaStatus({ start = false } = {}) {
  const was = await ollama.up();
  const running = was || (start && await ollama.ensure());
  if (!running) return { running: false, models: [], vision: [], started: false };
  try {
    const models = await ollama.models();
    return { running: true, models, vision: models.filter((n) => VISION_MODEL.test(n)), started: !was };
  } catch {
    return { running: false, models: [], vision: [], started: false };
  }
}

async function scanTarget(cfg, chatModel) {
  const want = cfg.scanProvider || 'auto';
  if (want === 'claude') return { id: 'claude', model: chatModel };
  if (want === 'gemini') { // fast, free with a key from Google AI Studio; the picture goes to Google
    if (!cfg.apiKeys?.gemini) {
      throw new Error(String(cfg.lang || '').startsWith('es')
        ? 'falta la clave de Gemini: menú > Modelo IA > Google Gemini > Clave API (clave gratis en aistudio.google.com), y luego vuelve a tu modelo'
        : 'no Gemini key yet: menu > AI model > Google Gemini > API key (free key at aistudio.google.com), then switch back to your model');
    }
    return { id: 'gemini', model: cfg.geminiModel || 'gemini-flash-latest' };
  }
  const st = await ollamaStatus({ start: want !== 'claude' }); // off? she switches it on
  const local = (cfg.visionModel && st.models.includes(cfg.visionModel)) ? cfg.visionModel : st.vision[0];
  if (local) return { id: 'ollama', model: local };
  if (want === 'ollama') {
    const es = String(cfg.lang || '').startsWith('es');
    if (!st.running) throw new Error(es ? 'Ollama no responde: ábrelo (la llama en la bandeja de Windows) o corre «ollama serve»' : 'Ollama is not answering: open it (the llama in the Windows tray) or run "ollama serve"');
    throw new Error(es ? `Ollama funciona pero ningún modelo ve imágenes (tienes: ${st.models.join(', ') || 'ninguno'}): instala uno con «ollama pull gemma3:4b»` : `Ollama is up but no model sees images (you have: ${st.models.join(', ') || 'none'}): install one with "ollama pull gemma3:4b"`);
  }
  return { id: cfg.provider, model: chatModel };
}

async function describeImage(id, cfg, { model, file, png, lang, signal, mode = 'describe' }) {
  const p = endpoint(id, cfg);
  const prompt = visionPrompt(cfg, lang, mode);
  if (p.kind === 'claude') {
    const m = cfg.claudeScanModel || 'haiku'; // a look at a picture doesn't need the big one
    const modelArgs = /^[\w.\-\[\]]+$/.test(m) ? ['--model', modelId(cfg, m)] : [];
    const env = { ...process.env, MAX_THINKING_TOKENS: '0' };
    const common = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'default', '--strict-mcp-config', '--disable-slash-commands', ...modelArgs];
    // 1) the picture goes in with the message: one step, the fast way
    try {
      scanSession = randomUUID();
      const message = JSON.stringify({ type: 'user', message: { role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } },
        { type: 'text', text: prompt },
      ] } });
      const text = await runClaude([...common, '--input-format', 'stream-json', '--session-id', scanSession], { meta: { kind: 'scan', model: m }, onSessionId: (id) => taskIds.add(id), text: `${message}\n`, cwd: path.dirname(file), env, onDelta: () => {}, signal });
      if (!/no (?:puedo ver|veo) (?:ninguna )?imagen|(?:do not|don't|cannot|can't) see (?:an |any |the )?image|no image/i.test(text)) return text;
    } catch (err) {
      if (signal?.aborted) throw err;
    }
    // 2) this version of Claude Code didn't take it inline: it reads the file with its Read tool (an extra step, slower)
    scanSession = randomUUID();
    return runClaude([...common, '--allowedTools', 'Read', '--add-dir', quote(path.dirname(file)), '--session-id', scanSession], {
      meta: { kind: 'scan', model: m },
      onSessionId: (id) => taskIds.add(id),
      text: `${prompt}\n\nThe image is this file, read it first with the Read tool: ${file}`,
      cwd: path.dirname(file), env, onDelta: () => {}, signal,
    });
  }
  const image = png.toString('base64');
  if (p.kind === 'ollama') return ollama.vision({ model, prompt, image }, signal);
  // Overloaded (503, 429...) is usually a matter of seconds: Gemini tries its other fast models before giving up
  const names = id === 'gemini' ? [...new Set([model, 'gemini-2.5-flash', 'gemini-2.5-flash-lite'])] : [model];
  let last = null;
  for (const [i, name] of names.entries()) {
    const res = await fetch(`${p.url}/chat/completions`, {
      method: 'POST',
      headers: headers(p.key),
      body: JSON.stringify({
        model: name,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:image/png;base64,${image}` } }] }],
      }),
      signal,
    });
    if (res.ok) return String((await res.json()).choices?.[0]?.message?.content || '').trim();
    last = await failure(res);
    const again = [429, 500, 502, 503, 504].includes(res.status) || (id === 'gemini' && res.status === 404); // 404: that model name is gone
    if (!again || i === names.length - 1) break;
    await new Promise((r) => setTimeout(r, 1200));
  }
  if ([429, 500, 502, 503, 504].includes(last?.status)) {
    throw Object.assign(new Error(lang === 'es' ? `${p.label} está saturado ahora mismo (probé con varios modelos)` : `${p.label} is overloaded right now (I tried several models)`), { status: last.status });
  }
  throw last;
}

module.exports = { setModelPrefs, setUsageSink, setLimitSink, once: claudeOnce, VISION_MODEL, ollamaStatus, scanTarget, describeImage, isLocal, PROVIDERS, CLAUDE_MODES, models, warm, chat, task: claudeTask, resetTask, isTaskSession, mcpList, resetClaude, isChatSession, claudeMemory, restoreClaude };
