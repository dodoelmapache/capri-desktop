'use strict';

// Voice in: the overlay records your voice (talk.js) and this turns it into text with a Whisper
// service. Groq (free tier, fast) first, else OpenAI. Keys come from config.json's `apiKeys`
// ({ groq: "gsk_..." }) or the GROQ_API_KEY / OPENAI_API_KEY environment variables.
// NOTE: unlike the rest of Capri, the audio of what you say leaves the PC to reach that service.
//
// What makes it hear you right:
//  - the accurate model (whisper-large-v3) by default; sttModel: 'turbo' is the faster, less careful one
//  - a prompt made of YOUR words (apps, playlists, her name), so "Fusion 360" or "Figma" are spelled the way you have them
//  - segments Whisper itself thinks are not speech are dropped (that is where the invented "subtítulos por..." come from)
//  - the words of an "abre ..." command are snapped to the closest app you really have
//  - if the first service fails (limit, network), the next one answers

const whisperLocal = require('./whisperlocal');

const PROVIDERS = {
  groq: { url: 'https://api.groq.com/openai/v1/audio/transcriptions', models: { accurate: 'whisper-large-v3', turbo: 'whisper-large-v3-turbo' }, env: 'GROQ_API_KEY' },
  openai: { url: 'https://api.openai.com/v1/audio/transcriptions', models: { accurate: 'whisper-1', turbo: 'whisper-1' }, env: 'OPENAI_API_KEY' },
};

// A Whisper that runs on this PC (whisper.cpp's server): no key, no limit, no cost, nothing leaves the PC. Capri only talks to it when config.sttLocal is on
// (sttLocalUrl: where it listens, http://127.0.0.1:8178/inference by default). Same prompt and same word fixes as the cloud ones.
const LOCAL = { id: 'local', url: 'http://127.0.0.1:8178/inference', key: '', models: {}, local: true };
let localUp = { at: 0, ok: false };

// how many requests this day (UTC, as Groq counts them) went to the cloud: while there is room she uses it to listen for her name (it answers in under a second);
// past the budget, this PC's Whisper does that and the cloud keeps what is left for the words of your orders
let today = null;
const usageFile = () => {
  try { return require('node:path').join(require('electron').app.getPath('userData'), 'stt-usage.json'); } catch { return null; }
};
function cloudToday() {
  const day = new Date().toISOString().slice(0, 10);
  if (!today) {
    try { today = JSON.parse(require('node:fs').readFileSync(usageFile(), 'utf8')); } catch { today = null; }
  }
  if (!today || today.day !== day) today = { day, n: 0 };
  return today.n;
}
function bumpCloud() {
  cloudToday();
  today.n += 1;
  if (today.n % 10 === 0) { try { require('node:fs').writeFileSync(usageFile(), JSON.stringify(today)); } catch { /* not kept */ } }
}
// on when config.sttLocal is true, or when it is not false and the program and a model are installed (tools\install-whisper-local.ps1)
const localOn = (cfg) => cfg.sttLocal === true || (cfg.sttLocal !== false && whisperLocal.installed(cfg));

async function localReady(cfg) {
  if (!localOn(cfg)) return false;
  if (Date.now() - localUp.at < 15000) return localUp.ok;
  let ok = false;
  try {
    const base = new URL(cfg.sttLocalUrl || LOCAL.url);
    const res = await fetch(base.origin + '/', { signal: AbortSignal.timeout(900) });
    ok = res.status < 500;
  } catch { ok = false; }
  localUp = { at: Date.now(), ok };
  return ok;
}

const LANGS = new Set(['es', 'en', 'fr', 'pt', 'ru', 'de', 'it']);

// a few words of her world, so Whisper spells them right
const BASE_HINT = 'Capri, Claude, Claude Code, Figma, Illustrator, Canva, YouTube Music, Spotify, Discord, WhatsApp, Chrome, abre, cierra, pon música, pausa, siguiente, anterior, aleatorio, captura de pantalla, graba la pantalla., limpia el caché, archivos temporales, libera espacio, optimiza el PC, rendimiento, memoria RAM, qué tengo abierto, lee mis mensajes de WhatsApp, responde en Discord';

function chooseAll(cfg) {
  const order = cfg.sttProvider && cfg.sttProvider !== 'auto' ? [cfg.sttProvider] : ['groq', 'openai'];
  const found = [];
  for (const id of order) {
    const p = PROVIDERS[id];
    if (!p) continue;
    const key = cfg.apiKeys?.[id] || process.env[p.env];
    if (key) found.push({ id, ...p, key });
  }
  if (localOn(cfg) && (!cfg.sttProvider || ['auto', 'local'].includes(cfg.sttProvider))) {
    const local = { ...LOCAL, url: cfg.sttLocalUrl || LOCAL.url };
    // 'local' alone: only this PC; with the others ('auto'): the cloud first while it has room, this one when it does not (or first when sttLocalFirst)
    if (cfg.sttProvider === 'local') return [local];
    return cfg.sttLocalFirst === true ? [local, ...found] : [...found, local];
  }
  return found;
}

function status(cfg) {
  const p = chooseAll(cfg)[0];
  return p ? { ok: true, provider: p.id } : { ok: false, error: 'nokey' };
}

const plain = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();

// the prompt Whisper reads before listening: her words, then yours (apps, playlists), within what it takes (~220 tokens)
function promptFor(vocab) {
  const mine = [...new Set((vocab || []).map((v) => String(v || '').trim()).filter((v) => v.length >= 2 && v.length <= 40))];
  let out = BASE_HINT;
  for (const v of mine) {
    if (out.length + v.length + 2 > 650) break;
    out += ` ${v},`;
  }
  return out;
}

function lev(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

const OPEN_VERB = /^((?:capri[\s,]+)?(?:por favor[\s,]+)?(?:abre(?:me)?|abrir|ábre(?:me)?|inicia|iniciar|lanza|arranca|ejecuta|pon(?:me)?|cierra|cerrar|reproduce|reproducir|busca)\s+(?:la\s+|el\s+|mi\s+|mis\s+)?(?:app\s+(?:de\s+)?|aplicaci[oó]n\s+(?:de\s+)?)?)(.+)$/i;

// "abre fusion 360 y figma": each name is snapped to the closest one among the apps you have, only when it is clearly the same word
function correct(text, vocab) {
  const names = [...new Set((vocab || []).map((v) => String(v || '').trim()).filter(Boolean))];
  if (!names.length) return text;
  const m = OPEN_VERB.exec(String(text).trim());
  if (!m) return text;
  const head = m[1];
  const tail = m[2].replace(/[.!?¡¿]+$/g, '');
  const parts = tail.split(/\s*(?:,|\by\b|\be\b|\bademás\b)\s*/i).filter(Boolean);
  const fixed = parts.map((raw) => {
    const before = plain(raw);
    const heard = before.replace(/\b(?:wasap|guasap|wassap|whasap|wats ?ap|uatsap)\b/g, 'whatsapp').replace(/\b(?:yutub|youtub|iutub|yutube)\b/g, 'youtube').replace(/\bdiscor\b/g, 'discord');
    if (heard.length < 3) return raw;
    const aliased = heard !== before;
    let best = null;
    for (const name of names) {
      const target = plain(name);
      if (!target) continue;
      if (target === heard) return aliased ? name : raw; // already right (or only said the way people say it)
      if (target.startsWith(`${heard} `) || heard.startsWith(`${target} `)) return aliased ? name : raw; // a clear prefix of it
      const d = lev(heard, target);
      const ratio = 1 - d / Math.max(heard.length, target.length);
      if (!best || ratio > best.ratio) best = { name, ratio, d };
    }
    return best && best.ratio >= 0.72 && best.d <= 3 ? best.name : raw;
  });
  return `${head}${fixed.join(' y ')}`;
}

async function callLocal(p, cfg, { bytes, mime, language, vocab }) {
  const ext = /wav/.test(mime) ? 'wav' : /ogg/.test(mime) ? 'ogg' : /mp4/.test(mime) ? 'm4a' : 'webm';
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime || 'audio/wav' }), 'voice.' + ext);
  form.append('response_format', 'json');
  form.append('temperature', '0.0');
  if (language) form.append('language', language);
  if (!language || language === 'es') form.append('prompt', promptFor(vocab));
  const res = await fetch(p.url, { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('local whisper answered ' + res.status);
  const data = await res.json();
  return String(data.text || data.transcription || '').replace(/\s+/g, ' ').trim();
}

async function call(p, cfg, { bytes, mime, language, vocab }) {
  if (p.local) return callLocal(p, cfg, { bytes, mime, language, vocab });
  const ext = /wav/.test(mime) ? 'wav' : /ogg/.test(mime) ? 'ogg' : /mp4/.test(mime) ? 'm4a' : 'webm';
  const wantTurbo = String(cfg.sttModel || '').toLowerCase() === 'turbo';
  const model = cfg.sttModel && !['turbo', 'accurate'].includes(String(cfg.sttModel).toLowerCase()) ? cfg.sttModel : p.models[wantTurbo ? 'turbo' : 'accurate'];
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime || 'audio/webm' }), `voice.${ext}`);
  form.append('model', model);
  form.append('response_format', p.id === 'groq' || model === 'whisper-1' ? 'verbose_json' : 'json');
  form.append('temperature', '0');
  if (language) form.append('language', language);
  if (!language || language === 'es') form.append('prompt', promptFor(vocab));
  const res = await fetch(p.url, {
    method: 'POST',
    headers: { authorization: `Bearer ${p.key}` },
    body: form,
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let msg = '';
    try {
      const err = JSON.parse(body).error;
      msg = typeof err === 'string' ? err : err?.message;
    } catch {
      // not JSON
    }
    throw new Error(msg || body.slice(0, 200) || `answered ${res.status}`);
  }
  const data = await res.json();
  // drop what Whisper itself doubts is speech (silence turned into words)
  if (Array.isArray(data.segments) && data.segments.length) {
    const keep = data.segments.filter((s) => !(s.no_speech_prob > 0.6 && s.avg_logprob < -0.7) && !(s.avg_logprob < -1.6));
    return keep.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
  }
  return String(data.text || '').trim();
}

async function transcribeEx(cfg, { audio, mime, language, vocab, wake, quality } = {}) {
  let providers = chooseAll(cfg);
  // wake: only listening for her name (many phrases, most of them not for her): this PC's Whisper when there is one, so the cloud is spent on what is for her
  // quality: the words of an order she has just heard: the cloud first (it hears the names better), this PC's if the cloud has no room
  const wakeMode = cfg.sttWake || 'auto'; // 'auto': the cloud while today's budget lasts, then this PC; 'local': always this PC; 'cloud': always the cloud
  if (wake && wakeMode !== 'cloud' && providers.some((p) => p.local) && await localReady(cfg) && (wakeMode === 'local' || cloudToday() >= (Number(cfg.sttWakeBudget) || 1200))) providers = providers.filter((p) => p.local);
  else if (quality) providers = [...providers.filter((p) => !p.local), ...providers.filter((p) => p.local)];
  if (!providers.length) throw Object.assign(new Error('no key for speech to text'), { code: 'nokey' });
  const bytes = Buffer.from(audio || []);
  if (bytes.length < 2000) return ''; // nothing but a click
  const lang = String(language || '').slice(0, 2).toLowerCase();
  const useLang = LANGS.has(lang) ? lang : '';
  let lastErr = null;
  for (const p of providers) {
    if (p.local && !(await localReady(cfg))) continue; // (it is not running: the next one)
    try {
      const text = await call({ ...p }, cfg, { bytes, mime, language: useLang, vocab });
      if (!p.local) bumpCloud();
      return { text: correct(text, vocab), provider: p.id };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || Object.assign(new Error('no speech service is answering'), { code: 'down' });
}

async function transcribe(cfg, request) {
  return (await transcribeEx(cfg, request)).text;
}

// is this PC's Whisper answering now (for the overlay: it decides how it listens for her name)
async function localStatus(cfg) {
  return { installed: whisperLocal.installed(cfg), on: localOn(cfg), up: await localReady(cfg) };
}

module.exports = { status, transcribe, transcribeEx, localStatus, correct, promptFor, cloudToday };
