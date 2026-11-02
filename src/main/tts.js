'use strict';

// Voice out, the good one: her answers as speech with a neural voice (talk.js plays the audio).
//  - ElevenLabs: your own voice (needs `apiKeys.elevenlabs` or ELEVENLABS_API_KEY, and `ttsVoiceId`).
//  - Edge: Microsoft's read-aloud neural voices through the msedge-tts package. Free, no key.
//    It is an unofficial route: it can change or stop working without notice.
// 'auto' uses ElevenLabs when it's set up, else Edge; with neither (or `ttsProvider: 'system'`)
// she keeps the Windows voices (talk.js).
// NOTE: the text she says goes to ElevenLabs or Microsoft to be turned into audio.

const ELEVEN_URL = 'https://api.elevenlabs.io/v1/text-to-speech';

// the Edge voice for each of her languages (cfg.edgeVoice picks another: "es-MX-DaliaNeural"...)
const EDGE_VOICES = {
  es: 'es-VE-PaolaNeural',
  en: 'en-US-AriaNeural',
  fr: 'fr-FR-DeniseNeural',
  pt: 'pt-BR-FranciscaNeural',
  ru: 'ru-RU-SvetlanaNeural',
};

let edge; // the msedge-tts module, once loaded (null: not installed)
function edgeModule() {
  if (edge === undefined) {
    try {
      edge = require('msedge-tts');
    } catch {
      edge = null; // `npm install` hasn't been run since it was added
    }
  }
  return edge;
}

function elevenSetup(cfg) {
  const key = cfg.apiKeys?.elevenlabs || process.env.ELEVENLABS_API_KEY;
  const voice = String(cfg.ttsVoiceId || '').trim();
  return key && voice ? { key, voice, model: cfg.ttsModel || 'eleven_v4' } : null;
}

// who speaks: { kind: 'elevenlabs', ... } | { kind: 'edge' } | null (the Windows voices)
function choose(cfg) {
  const wanted = cfg.ttsProvider || 'auto';
  if (wanted === 'system') return null;
  if (wanted === 'auto' || wanted === 'elevenlabs') {
    const eleven = elevenSetup(cfg);
    if (eleven) return { kind: 'elevenlabs', ...eleven };
    if (wanted === 'elevenlabs') return null;
  }
  return edgeModule() ? { kind: 'edge' } : null;
}

const status = (cfg) => {
  const who = choose(cfg);
  return who ? { ok: true, provider: who.kind } : { ok: false };
};

async function speakEleven(who, { text }) {
  const body = { text: String(text || '').slice(0, 1500), model_id: who.model };
  // v3 and v4 keep their own defaults (their stability has its own steps). The older models get a lively setting.
  if (/^eleven_(multilingual|flash|turbo|monolingual)_/.test(who.model)) body.voice_settings = { stability: 0.35, similarity_boost: 0.8, style: 0.45, use_speaker_boost: true };
  const res = await fetch(`${ELEVEN_URL}/${encodeURIComponent(who.voice)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': who.key, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    let msg = '';
    try {
      const { detail } = JSON.parse(raw);
      msg = typeof detail === 'string' ? detail : detail?.message || detail?.status || '';
    } catch {
      // not JSON
    }
    throw new Error(msg || raw.slice(0, 200) || `answered ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// the text goes into SSML: its own characters must not be taken for markup
const xml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// A connection to Edge's voice service takes a few hundred milliseconds to open (DNS, TLS, the websocket and its first message). Opened only when
// she has something to say, that wait lands right on the start of her speech. So a couple are kept open and ready, each used once; a new one
// takes its place at once. They are let go after a while (the service closes idle ones).
const WARM_MAX = 2;
const WARM_TTL = 40 * 1000;
const FORMAT = () => edgeModule().OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;
const warm = []; // [{ tts, voice, at }]
let warming = 0;

// embedded: an English phrase inside a line in another language ("buen chico... good boy"): it gets an English voice, whatever voice she speaks the rest with
const voiceFor = (cfg, language, embedded = false) => (embedded ? (cfg.edgeVoiceEn || EDGE_VOICES.en) : cfg.edgeVoice || EDGE_VOICES[String(language || 'es').slice(0, 2).toLowerCase()] || EDGE_VOICES.es);

function dropStale() {
  const now = Date.now();
  for (let i = warm.length - 1; i >= 0; i--) {
    if (now - warm[i].at > WARM_TTL) {
      try { warm[i].tts.close(); } catch { /* it was already closed */ }
      warm.splice(i, 1);
    }
  }
}

function takeWarm(voice) {
  dropStale();
  const at = warm.findIndex((w) => w.voice === voice);
  return at >= 0 ? warm.splice(at, 1)[0].tts : null;
}

// keep WARM_MAX connections ready for this voice (in the background: nobody waits for it)
function refill(cfg, language) {
  if (!edgeModule() || choose(cfg)?.kind !== 'edge') return;
  const voice = voiceFor(cfg, language);
  dropStale();
  const need = WARM_MAX - warm.filter((w) => w.voice === voice).length - warming;
  for (let n = 0; n < need; n++) {
    warming += 1;
    const { MsEdgeTTS } = edgeModule();
    const tts = new MsEdgeTTS({ connectionTimeoutMs: 8000, synthesisTimeoutMs: 20000 });
    tts.setMetadata(voice, FORMAT())
      .then(() => { warm.push({ tts, voice, at: Date.now() }); })
      .catch(() => { try { tts.close(); } catch { /* nothing to close */ } })
      .finally(() => { warming -= 1; });
  }
}

async function speakEdge(cfg, { text, language, embedded }, { cold = false } = {}) {
  const { MsEdgeTTS } = edgeModule();
  const voice = voiceFor(cfg, language, embedded);
  let tts = cold ? null : takeWarm(voice); // one already open: no waiting to connect
  if (!tts) {
    tts = new MsEdgeTTS({ connectionTimeoutMs: 8000, synthesisTimeoutMs: 20000 });
    await tts.setMetadata(voice, FORMAT());
  }
  try {
    const { audioStream } = tts.toStream(xml(String(text || '').slice(0, 1500)), {
      rate: cfg.edgeRate ?? '+14%',   // a little quicker and higher than her calm default
      pitch: cfg.edgePitch ?? '+10Hz',
    });
    const chunks = [];
    await new Promise((resolve, reject) => {
      audioStream.on('data', (chunk) => chunks.push(chunk));
      audioStream.on('error', reject);
      audioStream.on('close', resolve);
      audioStream.on('end', resolve);
    });
    const audio = Buffer.concat(chunks);
    if (!audio.length) throw new Error('the voice service returned no audio');
    return audio;
  } finally {
    tts.close();
    refill(cfg, language); // the next one is already on its way
  }
}

async function speak(cfg, request = {}) {
  const who = choose(cfg);
  if (!who) throw Object.assign(new Error('no neural voice set up'), { code: 'nokey' });
  if (who.kind === 'elevenlabs') return speakEleven(who, request);
  // Edge's free service drops a request now and then: one more try before she falls back to the Windows voice
  try {
    return await speakEdge(cfg, request);
  } catch (first) {
    console.warn('[capri] Edge voice failed, trying again:', first.message);
    return speakEdge(cfg, request, { cold: true }); // (not one of the ready ones: it may be what failed)
  }
}

// at start (and when her voice changes): the first thing she says doesn't wait for a connection either
const prewarm = (cfg, language = 'es') => { try { refill(cfg, language); } catch { /* the voice is a nicety: never a reason to fail */ } };

module.exports = { status, speak, prewarm };
