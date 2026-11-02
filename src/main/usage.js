'use strict';

// What her Claude jobs have used: each one, as Claude Code reports it when it finishes (tokens, turns, and the cost it would be at
// API prices). On a subscription that cost isn't a bill: it's a way to compare jobs and days. Only what Capri launched is counted,
// not what you do in Claude Code yourself. One small file on this PC; nothing is sent anywhere.

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const MAX_ENTRIES = 6000;
const KEEP_DAYS = 120;
const file = () => path.join(app.getPath('userData'), 'usage.json');
let cache = null;

function load() {
  if (cache) return cache;
  try {
    const data = JSON.parse(fs.readFileSync(file(), 'utf8'));
    cache = Array.isArray(data.entries) ? data.entries : [];
  } catch {
    cache = [];
  }
  return cache;
}

function persist() {
  try {
    const cut = Date.now() - KEEP_DAYS * 86400000;
    cache = cache.filter((e) => e.ts >= cut).slice(-MAX_ENTRIES);
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    const tmp = `${file()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries: cache }));
    fs.renameSync(tmp, file());
  } catch (err) {
    console.error('[capri] could not save the usage:', err.message);
  }
}

// haiku / sonnet / opus / other, from the name of the model that did the work (else the one she asked for)
function family(...names) {
  for (const n of names) {
    const m = /haiku|sonnet|opus/i.exec(String(n || ''));
    if (m) return m[0].toLowerCase();
  }
  return 'other';
}

// How full each Claude conversation is: the input of its last call over the model's window (Claude Code says the window in its result)
const ctxBySession = new Map();

// result: Claude Code's final message (stream-json "result"); meta: { kind, model, sid } from the call; lastCall: usage of its last call
function record({ kind = 'task', model = '', sid = null, result = {}, lastCall = null } = {}) {
  if (sid && lastCall) {
    const used = Object.values(result.modelUsage || {}).find((m) => m?.contextWindow);
    const tokens = (Number(lastCall.input_tokens) || 0) + (Number(lastCall.cache_read_input_tokens) || 0) + (Number(lastCall.cache_creation_input_tokens) || 0);
    if (used?.contextWindow && tokens) ctxBySession.set(sid, { tokens, window: Number(used.contextWindow), at: Date.now() });
  }
  const u = result.usage || {};
  // the model that really did most of it, when it says (modelUsage is keyed by the model id)
  const used = Object.entries(result.modelUsage || {}).sort((a, b) => (b[1]?.outputTokens || 0) - (a[1]?.outputTokens || 0))[0]?.[0];
  const entry = {
    ts: Date.now(),
    kind,
    model: family(used, model),
    cost: Number(result.total_cost_usd) || 0,
    input: Number(u.input_tokens) || 0,
    output: Number(u.output_tokens) || 0,
    cacheRead: Number(u.cache_read_input_tokens) || 0,
    cacheWrite: Number(u.cache_creation_input_tokens) || 0,
    turns: Number(result.num_turns) || 0,
    ms: Number(result.duration_ms) || 0,
    error: Boolean(result.is_error),
  };
  load().push(entry);
  persist();
  return entry;
}

const dayStart = (ms) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

function sum(entries) {
  const out = { jobs: 0, cost: 0, tokens: 0, byModel: { haiku: { n: 0, cost: 0 }, sonnet: { n: 0, cost: 0 }, opus: { n: 0, cost: 0 }, other: { n: 0, cost: 0 } }, byKind: {} };
  for (const e of entries) {
    out.jobs += 1;
    out.cost += e.cost;
    out.tokens += e.input + e.output + e.cacheWrite; // what was really worked through (cache reads are the cheap re-reading)
    const m = out.byModel[e.model] || out.byModel.other;
    m.n += 1;
    m.cost += e.cost;
    out.byKind[e.kind] = (out.byKind[e.kind] || 0) + 1;
  }
  return out;
}

// today / the last 7 days / the last 30, by local days
function summary(now = Date.now()) {
  const all = load();
  const today = dayStart(now);
  return {
    today: sum(all.filter((e) => e.ts >= today)),
    week: sum(all.filter((e) => e.ts >= today - 6 * 86400000)),
    month: sum(all.filter((e) => e.ts >= today - 29 * 86400000)),
    since: all[0]?.ts || null,
  };
}

// ---- the limits: Claude Code's own numbers, from two places ----
//  1) rate_limit_event, in the stream of the jobs she launches (it carries "utilization" only at times)
//  2) a file the status line of a Claude Code opened with her CODE button writes after every answer (the % of the 5-hour and weekly limits)
const WINDOW = { five_hour: 5 * 3600 * 1000, seven_day: 7 * 86400 * 1000 };
const limits = { five_hour: null, seven_day: null };
const toMs = (v) => {
  if (v == null) return null;
  const n = typeof v === 'string' && Number.isNaN(Number(v)) ? Date.parse(v) : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e11 ? n * 1000 : n; // seconds or milliseconds
};
const toPct = (v) => {
  const n = Number(v);
  if (v == null || !Number.isFinite(n) || n < 0) return null;
  return Math.min(100, n <= 1 ? n * 100 : n); // 0..1 or 0..100
};

// a percent that is already 0..100 (what the status line gives): taken as it is
const asPercent = (v) => {
  const n = Number(v);
  return v == null || !Number.isFinite(n) || n < 0 ? null : Math.min(100, n);
};

function noteLimit(info = {}, now = Date.now()) {
  const type = info.rateLimitType || info.rate_limit_type;
  if (!WINDOW[type]) return;
  const resetsAt = toMs(info.resetsAt ?? info.resets_at);
  const pct = toPct(info.utilization);
  const before = limits[type];
  const sameWindow = before && resetsAt && before.resetsAt === resetsAt;
  limits[type] = { pct: pct ?? (sameWindow ? before.pct : null), resetsAt: resetsAt || before?.resetsAt || null, at: now, src: 'event', status: info.status || null };
}

function readBridge(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); // PowerShell writes a BOM
    const out = { at: Number(j.at) || 0, ctxPct: asPercent(j.ctx?.pct) };
    for (const type of Object.keys(WINDOW)) {
      const w = j[type];
      out[type] = w ? { pct: asPercent(w.pct), resetsAt: toMs(w.resets), at: out.at, src: 'code' } : null;
    }
    return out;
  } catch {
    return null;
  }
}

// each window: the freshest word we have, and nothing once its window has reset (the % it had no longer means anything)
function limitsNow(bridgeFile, now = Date.now()) {
  const bridge = bridgeFile ? readBridge(bridgeFile) : null;
  const out = {};
  for (const type of Object.keys(WINDOW)) {
    const cands = [limits[type], bridge?.[type]].filter(Boolean).sort((a, b) => b.at - a.at);
    const w = cands.find((c) => c.pct != null) || cands[0] || null;
    if (!w || (w.resetsAt && w.resetsAt < now)) out[type] = null;
    else out[type] = { pct: w.pct, resetsAt: w.resetsAt, src: w.src, at: w.at, status: w.status || null };
  }
  return { ...out, codeCtxPct: bridge?.ctxPct ?? null, codeAt: bridge?.at || null };
}

// ---- the warnings: she says it when you are about to run out, and when you have; never a bar to watch ----
// Each window warns once per level (80 %, 95 %, the limit itself) until it resets. Claude Code can say "careful" without a number
// (status allowed_warning): that is a warning too. A job that fails because the limit was reached counts as the limit.
const LEVELS = [80, 95, 100];
const announced = new Map(); // "five_hour:<resetsAt>" -> the highest level already said

function alertsDue(lim, now = Date.now()) {
  const out = [];
  for (const type of Object.keys(WINDOW)) {
    const w = lim?.[type];
    if (!w) continue;
    const pct = w.status === 'rejected' ? 100 : w.pct;
    let level = 0;
    if (pct != null) for (const l of LEVELS) if (pct >= (l === 100 ? 99.5 : l)) level = l;
    if (!level && w.status === 'allowed_warning') level = 80; // careful, but no number
    if (!level) continue;
    const key = `${type}:${w.resetsAt || 'x'}`;
    if (level <= (announced.get(key) || 0)) continue;
    announced.set(key, level);
    out.push({ type, level, pct: pct == null ? null : Math.round(pct), resetsAt: w.resetsAt || null, now });
  }
  return out;
}

// the text of a job that failed: was it the limit? (the 5-hour session, or the week)
function reachedFromError(message, now = Date.now()) {
  const m = String(message || '');
  if (!/(?:usage|rate)[ -]?limit|limit (?:reached|will reset)|(?:reached|hit) (?:your|the) [\w -]{0,20}limit|weekly limit|out of (?:extra )?usage|exceeded (?:your|the) (?:usage|rate)|quota/i.test(m)) return null;
  const type = /week/i.test(m) ? 'seven_day' : 'five_hour';
  const key = `${type}:reached:${Math.floor(now / 1800000)}`; // once per half hour at most
  if (announced.has(key)) return null;
  announced.set(key, 100);
  const known = limits[type]?.resetsAt;
  return { type, level: 100, pct: 100, resetsAt: known && known > now ? known : null, now };
}

// what she herself has launched in the current 5-hour window (it starts with the first job after the last window ran out)
function windowSoFar(now = Date.now()) {
  let start = null;
  for (const e of load()) if (start == null || e.ts >= start + WINDOW.five_hour) start = e.ts;
  if (start == null || now >= start + WINDOW.five_hour) return { jobs: 0, cost: 0, tokens: 0, start: null, resetsAt: null };
  const s = sum(load().filter((e) => e.ts >= start));
  return { jobs: s.jobs, cost: s.cost, tokens: s.tokens, start, resetsAt: start + WINDOW.five_hour };
}

function context(sid) {
  const c = sid ? ctxBySession.get(sid) : null;
  return c ? { pct: Math.min(100, (c.tokens / c.window) * 100), tokens: c.tokens, window: c.window } : null;
}

function clear() {
  cache = [];
  persist();
}

module.exports = { record, summary, clear, family, noteLimit, readBridge, limitsNow, windowSoFar, context, alertsDue, reachedFromError };
