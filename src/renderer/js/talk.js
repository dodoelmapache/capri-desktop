// Voice for her chat.
//  - Speaker: she reads her answers out loud, with the voices Windows has (speechSynthesis).
//  - Listener: Ctrl+Alt+V starts listening, it stops by itself when you go quiet (or press again),
//    a Whisper service turns it into text (main/stt.js) and it goes to her chat as if you'd typed it.

import { HearPill } from './hearpill.js';

const MAX_SPOKEN = 520;      // characters: a bubble's worth, not a whole report
const SILENCE_MS = 1000;     // quiet this long after you spoke: done (a command is short: she doesn't wait for more)
const NO_SPEECH_MS = 7000;   // nobody spoke at all: give up
const MAX_RECORD_MS = 30000;
const LEVEL = 14;            // 0..128, how loud counts as speech
// hands free: "Capri…" (how Whisper may spell her), at the start of what it heard
const WAKE = /^(?:(?:hey|hei|hola|oye|ey|eh|ok|okay|okey|hello|hi)[\s,.!¡]*)?(capri|capry|kapri|capi|cabri|capris|cafri|capre|kapry|cabry|capr[ií]e?)\b[\s,.:;!¡?¿-]*/i;
const HF_MIN_LEVEL = 0.025;   // 0..1, never less than this counts as speech
const HF_QUIET_MS = 600;      // quiet this long: the phrase is over
const FOLLOW_MS = 9000;       // after a voice command, and once she has answered, this long you can go on talking without saying "Capri" again
const WARM_MS = 20000;        // the mic stays open this long after a recording: the next one starts with your first word, not after it
const HF_MAX_MS = 9000;       // a wake phrase is short
const HF_PER_MINUTE = 16;     // at most this many clips sent for transcription a minute (free tiers have limits)
// what Whisper invents out of silence
// said over her voice, these alone make her stop (a whole short phrase, never part of a longer one)
const STOP = /^[\s¡]*(?:para|pará|calla|c[aá]llate|espera|basta|silencio|d[eé]jalo|ya\s+(?:est[aá]|basta)|stop|wait|hold\s+on|shut\s+up)[\s.!¡?¿,]*$/i;
const GHOST = /amara\.org|subt[ií]tulos|gracias por ver|thanks for watching|suscr[ií]b|^[\s\[\(♪*]*(?:aplausos?|m[uú]sica|risas?|silencio|ruido|applause|music|laughter|laughs?|noise|ok|okay|mm+|hmm+|eh+|ah+|uh+|um+|oh+)[\s\]\)♪*.!¡?¿,]*$/i;

// English words that show up inside her Spanish lines: two or more in a row are a phrase in English ("good boy", "let's go"), and it is spoken with an
// English voice (talk.js piece()); with the Spanish voice they come out with a Spanish accent. (Words that are also Spanish, like "me", "no" or "he", are left out.)
const EN_WORDS = new Set(('the and you your are is was were be been have has had do does did will would can could should must it its that this these those with for from not but or if so at by of to in out up '
  + 'down over what when where who why how all any some one two yes good great nice well done job boy girl man woman time game play lets let go going get got make take see look thanks thank please sorry hello hi hey '
  + 'love like want need know think say tell give find work best better just now here there then than very too also again always never more most much many little big new old first last next long high low right '
  + 'left back off away home night day morning today tomorrow yesterday my we us our they them their she his her him keep moving rock rocks nailed killed crushed awesome amazing perfect beautiful cool sweet baby '
  + 'darling honey gorgeous handsome pretty proud got this soon easy peasy show break stand choice thats atta attaboy come on anytime bye').split(' '));
// Her voice keeps its own accent for English phrases (config englishVoice 'mine', the default): the phrase is respelled the way a Latina would say it
// ("good boy" -> "gud boi"), so her usual voice reads it with an accent that is hers instead of changing to another voice. 'english': an English voice.
const RESPELL = {"the": "da", "and": "and", "you": "yu", "your": "yor", "are": "ar", "is": "is", "was": "uas", "were": "uer", "be": "bi", "been": "bin", "have": "jav", "has": "jas", "had": "jad", "do": "du", "does": "das", "did": "did", "will": "uil", "would": "uud", "can": "kan", "could": "kud", "should": "shud", "must": "mast", "it": "it", "its": "its", "that": "dat", "thats": "dats", "this": "dis", "these": "dis", "those": "dous", "with": "uit", "for": "for", "from": "from", "not": "not", "but": "bat", "or": "or", "if": "if", "so": "sou", "at": "at", "by": "bai", "of": "of", "to": "tu", "in": "in", "out": "aut", "up": "ap", "down": "daun", "over": "ouver", "what": "uat", "when": "uen", "where": "uer", "who": "ju", "why": "uai", "how": "jau", "all": "ol", "any": "eni", "some": "sam", "one": "uan", "two": "tu", "yes": "yes", "good": "gud", "great": "greit", "nice": "nais", "well": "uel", "done": "dan", "job": "yob", "boy": "boi", "girl": "guerl", "man": "man", "woman": "uoman", "time": "taim", "game": "gueim", "play": "plei", "lets": "lets", "let": "let", "go": "gou", "going": "goin", "get": "get", "got": "got", "make": "meik", "take": "teik", "see": "si", "look": "luk", "thanks": "tenks", "thank": "tenk", "please": "plis", "sorry": "sori", "hello": "jelou", "hi": "jai", "hey": "jei", "love": "lav", "like": "laik", "want": "uant", "need": "nid", "know": "nou", "think": "tink", "say": "sei", "tell": "tel", "give": "guiv", "find": "faind", "work": "uork", "best": "best", "better": "beter", "just": "yast", "now": "nau", "here": "jir", "there": "der", "then": "den", "than": "dan", "very": "veri", "too": "tu", "also": "olsou", "again": "aguen", "always": "olueis", "never": "never", "more": "mor", "most": "moust", "much": "mach", "many": "meni", "little": "litol", "big": "big", "new": "niu", "old": "ould", "first": "ferst", "last": "last", "next": "nekst", "long": "long", "high": "jai", "low": "lou", "right": "rait", "left": "left", "back": "bak", "off": "of", "away": "auei", "home": "joum", "night": "nait", "day": "dei", "morning": "morning", "today": "tudei", "tomorrow": "tumorou", "yesterday": "yesterdei", "my": "mai", "we": "ui", "us": "as", "our": "auer", "they": "dei", "them": "dem", "their": "der", "she": "shi", "his": "jis", "her": "jer", "him": "jim", "keep": "kip", "moving": "muvin", "rock": "rok", "rocks": "roks", "nailed": "neild", "killed": "kild", "crushed": "krasht", "awesome": "osom", "amazing": "ameisin", "perfect": "perfect", "beautiful": "biutiful", "cool": "kul", "sweet": "suit", "baby": "beibi", "darling": "darlin", "honey": "jani", "gorgeous": "yorlles", "handsome": "jansom", "pretty": "priti", "proud": "praud", "soon": "sun", "easy": "isi", "peasy": "pisi", "show": "shou", "break": "breik", "stand": "stand", "choice": "chois", "atta": "ata", "attaboy": "ataboi", "come": "kam", "on": "on", "anytime": "enitaim", "bye": "bai"};
export function respell(text) {
  return String(text).replace(/[A-Za-zÀ-ÿ']+/g, (w) => RESPELL[w.toLowerCase().replace(/'/g, '')] ?? w);
}

export function splitEnglish(text) {
  const tokens = String(text).match(/[A-Za-zÀ-ÿ']+|[^A-Za-zÀ-ÿ']+/g) || [];
  const isEn = (t) => /^[A-Za-z']+$/.test(t) && EN_WORDS.has(t.toLowerCase().replace(/'/g, ''));
  const parts = [];
  let cur = '';
  let curEn = false;
  const push = () => { if (cur.trim()) parts.push({ text: cur.trim(), en: curEn }); cur = ''; };
  for (let i = 0; i < tokens.length; i++) {
    // a run of two or more English words (blanks between them are fine)
    if (isEn(tokens[i])) {
      let j = i;
      let words = 1;
      while (j + 2 < tokens.length && /^[\s]+$/.test(tokens[j + 1]) && isEn(tokens[j + 2])) { j += 2; words += 1; }
      if (words >= 2) {
        if (curEn) push();
        else if (cur.trim()) push();
        curEn = true;
        cur = tokens.slice(i, j + 1).join('');
        // the punctuation right after it belongs to it
        const after = /^[.,!?…]+/.exec(tokens[j + 1] || '');
        if (after) { cur += after[0]; tokens[j + 1] = tokens[j + 1].slice(after[0].length); }
        push();
        curEn = false;
        i = j;
        continue;
      }
    }
    cur += tokens[i];
  }
  push();
  return parts.length ? parts : [{ text: String(text).trim(), en: false }];
}

// lines that are always her flirty voice, wherever they come from
const FLIRT_RE = /good boy|buen chico|that'?s my boy|come here, you|proud of you|te extra[ñn]o|pensando en ti/i;

export class Speaker {
  constructor(getCfg, host) {
    this.getCfg = getCfg;
    this.host = host;
    this.voices = [];
    this.available = 'speechSynthesis' in window;
    this.token = 0;          // each line she starts gets one; stopping her invalidates it
    this.source = null;      // the neural voice playing, if any
    this.ctx = null;
    this.cloud = { at: -Infinity, ok: false, until: 0 }; // never asked yet
    if (this.available) {
      const load = () => { this.voices = speechSynthesis.getVoices(); };
      load();
      speechSynthesis.addEventListener?.('voiceschanged', load);
    }
  }

  get enabled() {
    const cfg = this.getCfg();
    // (do not disturb: no voice at all; the automatic quiet too, except that of a game while she says what she sees of the match: gameVoiceUntil)
    const auto = !cfg.dndAuto || (cfg.dndAuto === 'game' && Date.now() < (this.gameVoiceUntil || 0));
    return cfg.speak !== false && cfg.speakMode !== 'never' && cfg.dnd !== true && auto && (this.available || Boolean(this.host));
  }

  // should this answer be read out loud? By default only when you asked her by voice (speakMode 'voice')
  // 'important': only what matters is said out loud (her answers when you spoke to her, greetings and goodbyes, your notes, timers, deadlines and
  // summaries, and what she announces by herself: Claude finishing...), not everything she writes; `important` marks one of those
  wants(viaVoice, important = false) {
    if (!this.enabled) return false;
    const mode = this.getCfg().speakMode || 'voice';
    if (mode === 'important') return Boolean(viaVoice) || Boolean(important);
    return mode === 'always' || (mode === 'voice' && Boolean(viaVoice));
  }

  get important() {
    return this.getCfg().speakMode === 'important';
  }

  voiceFor(lang) {
    const cfg = this.getCfg();
    if (cfg.speakVoice) {
      const named = this.voices.find((v) => v.name.toLowerCase().includes(String(cfg.speakVoice).toLowerCase()));
      if (named) return named;
    }
    const want = String(cfg.speakLang || lang || 'es').slice(0, 2).toLowerCase();
    const score = (v) => (/es-(CO|MX|US|AR|CL|PE|VE)/i.test(v.lang) ? 3 : 0) + (/natural|online/i.test(v.name) ? 2 : 0);
    return this.voices
      .filter((v) => v.lang.slice(0, 2).toLowerCase() === want)
      .sort((a, b) => score(b) - score(a))[0] || null;
  }

  // is the neural voice set up (key and voice id)? asked now and then, and backed off after a failure
  async cloudReady() {
    if (!this.host || performance.now() < this.cloud.until) return false;
    if (performance.now() - this.cloud.at > 20000) {
      this.cloud = { at: performance.now(), ok: Boolean((await this.host.ttsStatus().catch(() => null))?.ok), until: 0 };
    }
    return this.cloud.ok;
  }

  // ---- speaking -------------------------------------------------------------------------------
  // A "line" is one answer, fed in as it grows (chat.js): every finished sentence or two becomes a
  // piece, ordered from the voice service at once and played in turn, so she starts talking while
  // the rest is still being written.

  begin(lang, { quiet = false, loud = false, level = 0, override = null, flirt = false } = {}) {
    if (!this.enabled) return null;
    this.stop();
    // quiet: a remark of her own, or anything she says while she is put away in her corner: a soft voice, not one that startles you
    const line = { token: this.token, lang, override, flirt, quiet: level > 0 ? level : loud ? false : Boolean(quiet || this.quietWhen?.()), cut: 0, buf: '', spoken: 0, pieces: [], fed: 0, done: false, over: false, neural: undefined, wake: null };
    this.line = line;
    this.onSpeak?.(); // (her clips show her talking)
    line.ready = this.cloudReady().then((ok) => { line.neural = ok; line.wake?.(); }, () => { line.neural = false; line.wake?.(); });
    this.play(line);
    return {
      feed: (text) => this.feed(line, text, false),
      end: (text) => this.feed(line, text ?? line.last ?? '', true),
      get fed() { return line.fed; },
    };
  }

  // the whole answer so far (its start never changes): what's new and complete goes to the voice
  feed(line, text, final) {
    if (line.token !== this.token || line.done) return;
    line.last = text;
    const clean = this.sanitize(final ? text : text.replace(/```[^]*$/, ''), final);
    if (clean.length < line.cut) return; // it shrank: the model rewrote it, nothing to add
    line.fed = clean.length;
    const rest = clean.slice(line.cut);
    const sentence = /[^.!?…]+[.!?…]+["')\]]*(?:\s+|$)/y;
    let at = 0;
    for (;;) {
      sentence.lastIndex = at;
      const m = sentence.exec(rest);
      // mid-stream, a sentence only counts once what follows it has started (3.5 isn't two)
      if (!m || (!final && !/\s$/.test(m[0]))) break;
      line.buf += m[0];
      at += m[0].length;
      if (line.buf.trim().length >= (line.pieces.length ? 40 : 16)) this.piece(line); // (the first piece is short: she starts talking sooner)
    }
    // still no sentence done but the first clause is: she starts with that ("Claro, te explico:" does not wait for the whole sentence)
    if (!final && !line.pieces.length && !line.buf.trim()) {
      const clause = /^(.{24,}?[,;:])\s/.exec(rest.slice(at));
      if (clause && rest.length - at > clause[0].length + 8) {
        line.buf += clause[0];
        at += clause[0].length;
        this.piece(line);
      }
    }
    line.cut += at;
    if (final) {
      line.buf += rest.slice(at);
      line.cut = clean.length;
      this.piece(line);
      line.done = true;
    }
    line.wake?.();
  }

  piece(line) {
    let text = line.buf.trim();
    line.buf = '';
    if (!text || line.over) return;
    const left = MAX_SPOKEN - line.spoken;
    if (text.length > left) {
      line.over = true;
      if (left < 60) return; // enough said
      text = text.slice(0, left);
      text = text.slice(0, Math.max(text.lastIndexOf('. '), text.lastIndexOf(', '), text.lastIndexOf(' '))).trim();
      if (!text) return;
    }
    line.spoken += text.length;
    // an English phrase inside a Spanish line gets its own piece, with an English voice
    const parts = String(line.lang || '').startsWith('en') ? [{ text, en: false }] : splitEnglish(text);
    const mine = this.getCfg().englishVoice !== 'english'; // her own voice and accent for the English bits (respelled), or an English voice
    const flirty = Boolean(line.flirt || FLIRT_RE.test(text));
    if (mine) { // one piece, as it was: only the English bits are respelled, so the sentence keeps its flow in her voice
      line.pieces.push({ text: parts.map((part) => (part.en ? respell(part.text) : part.text)).join(' '), en: false, flirt: flirty, job: null });
    } else {
      for (const part of parts) line.pieces.push({ text: part.text, en: part.en, flirt: flirty, job: null });
    }
    this.order(line, 0);
  }

  // order the next pieces from the voice service, a few ahead of the one playing
  order(line, from) {
    if (line.neural !== true) return;
    for (let i = from; i < Math.min(line.pieces.length, from + 3); i++) {
      const p = line.pieces[i];
      if (!p.job) p.job = this.host.ttsSpeak({ text: p.text, language: p.en ? 'en' : line.lang, embedded: Boolean(p.en), override: p.en ? null : (line.override || (p.flirt ? (this.getCfg().flirtVoiceOverride || null) : null)) }).catch((err) => ({ ok: false, error: err.message }));
    }
  }

  async play(line) {
    const live = () => line.token === this.token;
    let i = 0;
    while (live()) {
      if (i >= line.pieces.length) {
        if (line.done) break;
        await new Promise((resolve) => { line.wake = resolve; });
        line.wake = null;
        continue;
      }
      if (line.neural === undefined) { // not asked yet whether the neural voice is there
        await new Promise((resolve) => { line.wake = resolve; });
        line.wake = null;
        continue;
      }
      const piece = line.pieces[i];
      if (line.neural) {
        this.order(line, i);
        const res = await piece.job;
        if (!live()) return;
        if (res.ok) {
          if (!(await this.playBuffer(line, res))) line.neural = false;
        } else {
          console.warn('[capri] neural voice failed:', res.error);
          if (i === 0) this.cloud.until = performance.now() + 12000; // the Windows voice for a few seconds, then try again
          line.neural = false;
        }
        if (!live()) return;
      }
      if (!line.neural && this.available) this.sayLocal(piece.text, piece.en ? 'en' : line.lang, line.quiet);
      i += 1;
    }
    if (this.line === line) this.line = null;
  }

  // one piece of audio, through her effects; resolves when it has played (false: it couldn't)
  async playBuffer(line, res) {
    try {
      const ctx = this.ctx ??= new AudioContext();
      if (ctx.state === 'suspended') await ctx.resume();
      const raw = res.audio instanceof ArrayBuffer ? res.audio : res.audio.buffer.slice(res.audio.byteOffset, res.audio.byteOffset + res.audio.byteLength);
      const buffer = await ctx.decodeAudioData(raw);
      if (line.token !== this.token) return true;
      await new Promise((resolve) => {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        this.chain(ctx, src, line.quiet);
        src.onended = () => { if (this.source === src) this.source = null; resolve(); };
        this.source = src;
        src.start();
      });
      return true;
    } catch (err) {
      console.warn('[capri] could not play the neural voice:', err);
      return false;
    }
  }

  // what's worth hearing: no code, links or symbols
  sanitize(text, final) {
    let out = String(text);
    if (!final) out = out.replace(/```[^]*$/, ' '); // a code block still open
    return out
      .replace(/(?<![\p{L}])(?:parce(?:ro|ra|s|ros|ras)?|chamos?|chama|panas?|mijit[oa]|mij[oa]|g[uü]ey|wey|bro|broder)(?![\p{L}])/giu, 'choom') // (the slang she does not use, if a model says it)
      .replace(/(?<![\p{L}])bacan[oa]s?(?![\p{L}])/giu, 'genial')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[*_`#>\[\]{}|~^]+/g, ' ')
      .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^\s+/, '');
  }

  // a whole text at once
  say(text, lang, opts) {
    const line = this.begin(lang, opts);
    line?.end(text);
  }

  // she speaks up on her own (a timer, Claude finishing): never over something she's already saying
  announce(text, lang, opts) {
    if (!this.enabled || this.speaking || this.getCfg().announce === 'never') return;
    this.say(text, lang, opts);
  }

  // her voice, with a faint doubling (the other minds in her) and a touch of air; ttsFx: false for it clean
  chain(ctx, src, quiet = false) {
    const cfg = this.getCfg();
    const out = ctx.createGain();
    out.gain.value = Math.min(1.2, cfg.muted ? 0 : (cfg.volume ?? 0.7) + 0.4) * (typeof quiet === 'number' ? quiet : quiet ? this.quietFactor : 1);
    if (cfg.ttsFx === false) {
      src.connect(out).connect(ctx.destination);
      return;
    }
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 110;
    const air = ctx.createBiquadFilter();
    air.type = 'highshelf';
    air.frequency.value = 4500;
    air.gain.value = 3;
    const dry = ctx.createGain();
    dry.gain.value = 0.92;
    const twin = ctx.createDelay(0.1);
    twin.delayTime.value = 0.026;
    const wobble = ctx.createOscillator(); // her other mind drifts a little
    wobble.frequency.value = 0.7;
    const depth = ctx.createGain();
    depth.gain.value = 0.004;
    wobble.connect(depth).connect(twin.delayTime);
    wobble.start();
    const wet = ctx.createGain();
    wet.gain.value = 0.26;
    src.connect(high);
    high.connect(dry).connect(air);
    high.connect(twin).connect(wet).connect(air);
    air.connect(out).connect(ctx.destination);
    src.addEventListener('ended', () => { try { wobble.stop(); } catch { /* already stopped */ } });
  }

  // how much of her usual volume a quiet line keeps (config quietVolume, 0.1 to 1)
  get quietFactor() {
    const v = Number(this.getCfg().quietVolume);
    return Math.min(1, Math.max(0.05, Number.isFinite(v) && v > 0 ? v : 0.3));
  }

  sayLocal(spoken, lang, quiet = false) {
    const cfg = this.getCfg();
    const voice = this.voiceFor(lang);
    // sentence by sentence: a long utterance can get cut off partway
    for (const piece of spoken.match(/[^.!?…]+[.!?…]*/g) || [spoken]) {
      const line = piece.trim();
      if (!line) continue;
      const u = new SpeechSynthesisUtterance(line);
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = lang || 'es';
      u.rate = Number(cfg.speakRate) || 1.05;
      u.pitch = Number(cfg.speakPitch) || 1;
      u.volume = Math.min(1, (cfg.muted ? 0 : (cfg.volume ?? 0.7) + 0.3) * (typeof quiet === 'number' ? quiet : quiet ? this.quietFactor : 1));
      speechSynthesis.speak(u);
    }
  }

  get speaking() {
    return Boolean(this.line) || Boolean(this.source) || (this.available && speechSynthesis.speaking);
  }

  stop() {
    this.token += 1;
    this.line?.wake?.();
    this.line = null;
    if (this.source) {
      try { this.source.stop(); } catch { /* not started */ }
      this.source = null;
    }
    if (this.available) speechSynthesis.cancel();
  }
}

const TEXT = {
  es: {
    listening: 'ESCUCHANDO', thinking: 'TRANSCRIBIENDO',
    handsOn: 'Manos libres activado: di «Capri…» y te escucho.',
    nokey: 'Para oírte necesito una clave de Groq (gratis, console.groq.com) o de OpenAI. Ponla en config.json › apiKeys, por ejemplo { "groq": "gsk_..." }, y reinicia a Capri. Mientras tanto puedes dictarme con Win+H.',
    micStuck: 'Ojo: llevo un rato sin oír nada por el micrófono. Puede estar silenciado, desconectado o bloqueado por Windows. Revisa Configuración › Privacidad › Micrófono.',
    btOn: (n, hf) => hf ? `Se conectó ${n}. Ojo: como micrófono usa el modo manos libres, que suena peor.` : `Se conectó ${n}.`,
    btOff: (n) => `Se desconectó ${n}.`,
    mic: 'No puedo abrir el micrófono. Revisa Configuración › Privacidad › Micrófono y que las apps de escritorio puedan usarlo.',
    failed: 'No te pude transcribir:', nothing: 'No te escuché. Prueba otra vez.',
  },
  en: {
    listening: 'LISTENING', thinking: 'TRANSCRIBING',
    handsOn: 'Hands free is on: say “Capri…” and I’m listening.',
    nokey: 'To hear you I need a Groq key (free, console.groq.com) or an OpenAI key. Put it in config.json › apiKeys, like { "groq": "gsk_..." }, and restart Capri. Meanwhile you can dictate with Win+H.',
    micStuck: 'Heads up: I haven’t heard anything from the microphone for a while. It may be muted, unplugged or blocked by Windows. Check Settings › Privacy › Microphone.',
    btOn: (n, hf) => hf ? `${n} connected. Careful: as a mic it uses hands-free mode, which sounds worse.` : `${n} connected.`,
    btOff: (n) => `${n} disconnected.`,
    mic: 'I can’t open the microphone. Check Settings › Privacy › Microphone and that desktop apps may use it.',
    failed: 'Couldn’t transcribe you:', nothing: 'I didn’t hear anything. Try again.',
  },
};

export class Listener {
  constructor({ capri, panel, host, voice, chat, speaker, getCfg }) {
    Object.assign(this, { capri, panel, host, voice, chat, speaker, getCfg });
    this.state = 'idle'; // idle | recording | transcribing
    this.session = null;
    this.pill = new HearPill(panel, getCfg); // (a small pill beside her while she takes in your voice with her chat closed)
    // while she talks, the pill says so (chat closed): listening/transcribing keep priority
    setInterval(() => {
      const talking = Boolean(this.speaker?.speaking) && !this.chat.open;
      if (talking && !this.cueKind && this.pill.kind !== 'speaking') this.pill.set('speaking');
      else if (!talking && this.pill.kind === 'speaking') this.pill.set(null);
    }, 250);
  }

  get t() {
    return TEXT[String(this.getCfg().lang || 'es').slice(0, 2)] || TEXT.en;
  }

  // Ctrl+Alt+V: start listening, or (while listening) stop now
  async toggle() {
    if (this.state === 'recording') return this.finish();
    if (this.state !== 'idle') return undefined;
    this.state = 'starting';
    try {
      await this.begin();
    } finally {
      if (this.state === 'starting') this.state = 'idle';
    }
    return undefined;
  }

  // ---- hands free: say "Capri…" ------------------------------------------------------------------
  // The mic stays open and she listens for speech; each phrase goes to Whisper as a short clip and
  // nothing happens unless it begins with her name. "Capri, pon 25 minutos" is carried out right
  // away; just "Capri" and she listens for what comes next, as Ctrl+Alt+V would.
  // NOTE: everything you say near the mic goes to the Whisper service, to look for her name.

  // your words (apps, games, playlists), so the speech service spells them the way you have them
  vocab() {
    if (!this.names || Date.now() - this.namesAt > 300000) {
      this.namesAt = Date.now();
      this.names ||= [];
      this.host.launchables?.().then((list) => {
        const more = Object.values(this.getCfg().ytPlaylists || {}).map((p) => p?.name).filter(Boolean);
        this.names = [...(list || []).map((a) => a.name), ...more];
      }).catch(() => {});
    }
    return this.names;
  }

  // the mic, kept open a little after use: opening it takes a moment, and that moment is your first word
  async mic(constraints) {
    clearTimeout(this.warmTimer);
    const live = this.warm?.getAudioTracks().some((t) => t.readyState === 'live');
    const stream = live ? this.warm : await navigator.mediaDevices.getUserMedia({ audio: constraints });
    this.warm = stream;
    return stream;
  }

  cool() {
    clearTimeout(this.warmTimer);
    this.warmTimer = setTimeout(() => {
      if (this.state === 'recording') return;
      this.warm?.getTracks().forEach((track) => track.stop());
      this.warm = null;
    }, WARM_MS);
  }

  setHandsFree(on) {
    if (on) this.watch();
    else this.unwatch();
  }

  // what the bar of her chat says while she is taking in your voice (when it is open): ESCUCHANDO, then TRANSCRIBIENDO, then its usual line again
  cue(kind) {
    this.cueKind = null; // (the pill is for her name, not for every sound: hearPillAlways: true brings the old behaviour)
    const always = this.getCfg().hearPillAlways === true;
    this.pill.set(this.chat.open ? null : ((always && kind) || (this.speaker.speaking ? 'speaking' : null)));
    const input = this.panel.chatInput;
    if (!input || !this.chat.open) return;
    input.placeholder = kind ? `${kind === 'listening' ? this.t.listening : this.t.thinking}…` : this.chat.t.placeholder;
  }

  // is her own Whisper answering? asked now and then, not on every phrase
  async refreshLocal() {
    if (performance.now() - (this.localAt || -1e9) < 30000) return;
    this.localAt = performance.now();
    try {
      const st = await this.host.sttStatus();
      this.localUp = Boolean(st?.local?.up);
    } catch {
      this.localUp = false;
    }
  }

  // is the voice side in the middle of something (you are talking, she is talking, or her name was just heard and the follow-up window is open)?
  engaged() {
    return this.state !== 'idle' || Boolean(this.speaker.speaking) || Boolean(this.watcher?.seg) || Boolean(this.followUntil && Date.now() < this.followUntil);
  }

  paused() {
    return this.state !== 'idle' || this.speaker.speaking || Boolean(this.chat.turn);
  }

  async watch() {
    if (this.watcher || this.starting) return;
    this.starting = true;
    try {
      const status = await this.host.sttStatus();
      if (!status.ok) return this.panel.say({ kind: 'info', line: this.t.nokey, hold: 9000 });
      // no microphone plugged in (often the case): nothing to say; she starts by herself when one shows up
      const mics = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((d) => d.kind === 'audioinput');
      if (navigator.mediaDevices.enumerateDevices && !mics.length) { this.waitMic(); return undefined; }
      const ws = await this.host.wakeStatus?.().catch(() => null); // her name heard on this PC, if openWakeWord and its model are installed
      this.wakeOn = Boolean(ws?.installed && ws.engine !== 'off');
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
      } catch {
        return this.panel.say({ kind: 'info', line: this.t.mic, hold: 9000 });
      }
      const ctx = new AudioContext();
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      const mute = ctx.createGain(); // the processor only runs while it's connected: to nothing audible
      mute.gain.value = 0;
      const source = ctx.createMediaStreamSource(stream);
      source.connect(proc);
      proc.connect(mute).connect(ctx.destination);
      const w = { stream, ctx, proc, source, mute, ring: [], seg: null, floor: 0.008, sr: ctx.sampleRate, sent: [] };
      proc.onaudioprocess = (e) => this.hear(w, e.inputBuffer.getChannelData(0));
      stream.getAudioTracks()[0].onended = () => { // the mic went away (sleep, unplugged): try again soon
        this.unwatch();
        setTimeout(() => this.getCfg().handsFree && this.watch(), 5000);
      };
      this.watcher = w;
      w.beat = performance.now();
      w.dog = setInterval(() => this.micCheck(w), 5000);
      this.devWatch();
      this.voice.play('tick');
    } finally {
      this.starting = false;
    }
    return undefined;
  }

  // hands free is on but there is no mic: once, she waits for a device to appear and then opens it
  waitMic() {
    if (this.micWait || !navigator.mediaDevices?.addEventListener) return;
    this.micWait = true;
    navigator.mediaDevices.addEventListener('devicechange', async () => {
      if (this.watcher || this.starting || !this.getCfg().handsFree) return;
      const has = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).some((d) => d.kind === 'audioinput');
      if (has) setTimeout(() => this.getCfg().handsFree && !this.watcher && this.watch(), 1200);
    });
  }

  // every 5 s: is the mic still giving sound? Silent for a long time (muted, blocked, stalled) -> try to wake it, then tell once in a while
  micCheck(w) {
    if (this.watcher !== w) return;
    const now = performance.now();
    const track = w.stream.getAudioTracks()[0];
    const stalled = now - w.beat > 12000;
    const dead = Boolean(w.flat && now - w.flat > 25000) || Boolean(track?.muted && now - (w.mutedAt ??= now) > 8000);
    if (!track?.muted) w.mutedAt = null;
    if (w.ctx.state === 'suspended') w.ctx.resume().catch(() => {});
    if (stalled && now - (this.retryAt || -1e9) > 120000) { // the processor stopped: open the mic again (not more than every 2 min)
      this.retryAt = now;
      this.unwatch();
      setTimeout(() => this.getCfg().handsFree && this.watch(), 800);
      return;
    }
    if (this.getCfg().micWarn !== false && w.alive && (stalled || dead) && now - (this.stuckAt || -1e9) > 20 * 60000) {
      this.stuckAt = now;
      this.panel.say({ kind: 'info', line: this.t.micStuck, hold: 12000 });
    }
  }

  // headphones and speakers coming and going (Bluetooth, mostly): she says so, once per device
  async devWatch() {
    if (this.devOn || !navigator.mediaDevices?.enumerateDevices) return;
    this.devOn = true;
    const names = async () => {
      const map = new Map();
      for (const d of await navigator.mediaDevices.enumerateDevices().catch(() => [])) {
        if (!d.label || (d.kind !== 'audioinput' && d.kind !== 'audiooutput') || d.deviceId === 'default' || d.deviceId === 'communications') continue;
        const inner = d.label.match(/\(([^()]+)\)\s*$/);
        const name = (inner ? inner[1] : d.label).replace(/\s*-?\s*hands-?free.*$/i, '').replace(/\s*stereo$/i, '').trim();
        if (!name || /^(?:default|predeterminado|realtek|nvidia|amd|intel|usb audio)/i.test(name)) continue;
        map.set(name, (map.get(name) || false) || /hands-?free|headset|manos libres|auricular/i.test(d.label) && d.kind === 'audioinput');
      }
      return map;
    };
    let known = await names();
    const seen = new Map();
    navigator.mediaDevices.addEventListener('devicechange', async () => {
      const now = await names();
      for (const [name, hf] of now) {
        if (!known.has(name) && Date.now() - (seen.get(name) || 0) > 60000) {
          seen.set(name, Date.now());
          if (!this.paused()) this.panel.say({ kind: 'info', line: this.t.btOn(name, hf), hold: 6500 });
        }
      }
      for (const name of known.keys()) {
        if (!now.has(name) && Date.now() - (seen.get(`-${name}`) || 0) > 60000) {
          seen.set(`-${name}`, Date.now());
          if (!this.paused()) this.panel.say({ kind: 'info', line: this.t.btOff(name), hold: 4500 });
        }
      }
      known = now;
    });
  }

  unwatch() {
    const w = this.watcher;
    if (!w) return;
    this.watcher = null;
    clearInterval(w.dog);
    try { w.proc.onaudioprocess = null; w.proc.disconnect(); w.source.disconnect(); } catch { /* already gone */ }
    w.stream.getTracks().forEach((track) => track.stop());
    w.ctx.close().catch(() => {});
  }

  // one block of the mic (about 85 ms): is someone talking? keep the phrase, with a little before it
  hear(w, data) {
    const block = new Float32Array(data);
    if (this.wakeOn && !this.paused()) this.host.wakeFeed?.(pcm16k(block, w.sr)); // her name, heard on this PC (openWakeWord)
    let sum = 0;
    for (const v of block) sum += v * v;
    const level = Math.sqrt(sum / block.length);
    w.beat = performance.now();
    if (level >= 1e-6) w.alive = true; // (a mic that never gave a sound is not "stuck": it may just not be there)
    if (level < 1e-6) w.flat ??= w.beat; else w.flat = null; // a dead-flat line is a muted or blocked mic, not a quiet room
    // recording or transcribing: her own listener has the mic. Her answering or talking does NOT stop her ears any more: while she talks
    // only a louder voice starts a phrase, and it counts only if her name is in it (see heard): her own voice leaking in is never an order
    if (this.state !== 'idle') {
      w.seg = null;
      w.ring.length = 0;
      if (this.followUntil) this.followUntil = Date.now() + FOLLOW_MS; // the window counts from when she finishes
      return;
    }
    const talking = Boolean(this.speaker.speaking);
    if (talking && this.followUntil) this.followUntil = Date.now() + FOLLOW_MS; // (the window counts from when she finishes talking)
    const now = performance.now();
    const limit = talking ? Math.max(HF_MIN_LEVEL * 2.5, w.floor * 6) : Math.max(HF_MIN_LEVEL, w.floor * 3);
    if (!w.seg) {
      if (level > limit) {
        w.seg = { blocks: [...w.ring, block], start: now, lastLoud: now, loud: 1, talk: talking };
        w.ring.length = 0;
        this.cue('listening'); // (someone is talking: she is taking it in)
      } else {
        w.floor = Math.min(0.05, Math.max(0.002, w.floor * 0.97 + level * 0.03)); // the room's own noise
        w.ring.push(block);
        if (w.ring.length > 5) w.ring.shift(); // ~0.4 s: the start of her name isn't cut
      }
      return;
    }
    const seg = w.seg;
    seg.blocks.push(block);
    if (level > limit) {
      seg.lastLoud = now;
      seg.loud += 1;
    }
    if (now - seg.lastLoud > HF_QUIET_MS || now - seg.start > HF_MAX_MS) {
      w.seg = null;
      this.heard(w, seg);
    }
  }

  // openWakeWord heard her name: she reacts at once (before the phrase is over), and the phrase being said is marked as hers
  wakeHit() {
    if (this.state !== 'idle' || this.paused()) return;
    this.wakeHitAt = Date.now();
    if (this.watcher?.seg) this.watcher.seg.hit = true;
    this.cue('listening');
    this.voice.play('tick');
    this.capri.wake();
    this.capri.pulse();
  }

  async heard(w, seg) {
    if (seg.loud < 3 || this.state !== 'idle' || !this.watcher) { if (this.state === 'idle') this.cue(null); return; } // a click, a cough
    const hit = Boolean(seg.hit) || (this.wakeHitAt && Date.now() - this.wakeHitAt < 2500); // her name was heard in this phrase
    if (this.wakeOn && this.getCfg().wakeStrict === true && !hit && !(this.followUntil && Date.now() < this.followUntil)) { this.cue(null); return; } // (not for her: no transcription spent)
    this.cue('thinking');
    await this.refreshLocal();
    const now = Date.now();
    w.sent = w.sent.filter((at) => now - at < 60000);
    // with her own Whisper on this PC, listening for her name costs nothing (no limit); the cloud is only for the words of what is for her
    const cloudSend = () => { if (w.sent.length >= HF_PER_MINUTE) return false; w.sent.push(Date.now()); return true; };
    if (!this.localUp && !cloudSend()) { this.cue(null); return; }
    const audio = encodeWav(seg.blocks, w.sr);
    const ask = (extra) => this.host.sttTranscribe({
      audio,
      mime: 'audio/wav',
      language: String(this.getCfg().sttLanguage || this.getCfg().lang || 'es').slice(0, 2),
      vocab: this.vocab(),
      ...extra,
    });
    let res;
    try {
      res = await ask({ wake: true });
    } catch {
      this.cue(null);
      return;
    }
    if (!res?.ok || this.state !== 'idle') { this.cue(null); return; }
    let text = String(res.text || '').trim();
    // the small Whisper of this PC found her name (or you are in the window after an order): the cloud one writes the words down well
    if (res.provider === 'local' && text && (WAKE.test(text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')) || (this.followUntil && Date.now() < this.followUntil)) && cloudSend()) {
      try {
        const better = await ask({ quality: true });
        if (better?.ok && String(better.text || '').trim()) text = String(better.text).trim();
      } catch { /* the one of this PC will do */ }
    }
    if (!text || (GHOST.test(text) && text.length < 70)) { this.cue(null); return; }
    const plain = text.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // same length: accents drop
    const m = WAKE.exec(plain);
    if (seg.talk && !m && !hit && STOP.test(text) && this.speaker.speaking) { this.speaker.stop(); this.cue(null); this.followUntil = Date.now() + FOLLOW_MS; return; } // ("para" over her voice: she shuts up and waits)
    if (seg.talk && !m && !hit) { this.cue(null); return; } // (said while she was talking, without her name: probably her own voice or the room)
    if (m && this.speaker.speaking) this.speaker.stop(); // (you called her over her own voice: she stops and listens)
    if (!m && hit && seg.blocks.length <= 22) { // only her name (about 2 s or less), and the speech service wrote it down badly: she listens
      this.followUntil = Date.now() + FOLLOW_MS;
      this.cue(null);
      this.woke('');
      return;
    }
    if (!m) {
      if (!(this.followUntil && Date.now() < this.followUntil)) this.cue(null);
      // she has just been talking with you: no need to say her name again, what you say next is for her
      // (only an order for the PC counts there: a sound, a video playing nearby or someone talking is not for her, and never becomes a conversation)
      if (this.followUntil && Date.now() < this.followUntil && text.length >= 3 && await Promise.resolve(this.chat.systemOrder?.(text)).catch(() => null)) {
        this.followUntil = Date.now() + FOLLOW_MS;
        this.cue(null);
        this.voice.play('tick');
        this.capri.pulse();
        const busy = Boolean(this.chat.turn); // (Claude is in the middle of an answer: a plain order for the PC is still done, and it never joins that conversation)
        if (await this.chat.quickVoice?.(text, { force: busy }).catch(() => false)) return; // (a short order: a small card, not her chat)
        if (busy) return;
        if (!this.chat.open) await this.chat.start();
        if (this.chat.open && !this.chat.turn) this.chat.send(text, { voice: true });
      }
      return;
    }
    this.followUntil = Date.now() + FOLLOW_MS;
    this.cue(null);
    this.woke(text.slice(m[0].length).replace(/^[\s,.:;!¡?¿-]+/, '').trim());
  }

  // she heard her name, with something after it or without
  async woke(command) {
    this.voice.play('tick');
    this.capri.wake();
    this.capri.pulse();
    const single = command && command.split(/\s+/).length < 2 && command.length >= 4 ? await Promise.resolve(this.chat.systemOrder?.(command)).catch(() => null) : null; // ("Capri, pausa": one word that is an order)
    if ((command.length > 5 && command.split(/\s+/).length >= 2) || single) {
      if (await this.chat.quickVoice?.(command, { force: Boolean(this.chat.turn) }).catch(() => false)) return; // (a short order: a small card, not her chat; also while Claude answers)
      if (!this.chat.open) await this.chat.start();
      if (this.chat.open && !this.chat.turn) this.chat.send(command, { voice: true });
      return;
    }
    await this.toggle(); // just her name: she listens for the rest
  }

  note(message) {
    if (!this.chat.open) return;
    this.panel.chatTurn({ quote: '', face: 'aside' });
    this.panel.stream(message, { done: true });
    this.panel.setChatBusy(false);
  }

  async begin() {
    const t = this.t;
    this.speaker.stop(); // she doesn't talk over you, nor listen to herself
    // her chat opens (and she comes out of her biochip) while she is already listening: your first words do not wait for the animation
    const opening = this.chat.open ? null : Promise.resolve(this.chat.start()).catch(() => {});
    if (this.chat.open && this.chat.turn) return; // she's still answering
    const status = await this.host.sttStatus();
    if (!status.ok) return this.note(t.nokey);
    let stream;
    try {
      stream = await this.mic({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 });
    } catch {
      return this.note(t.mic);
    }
    if (!this.chat.open) this.pill.set('listening'); // (she was called: now it shows)
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    // the level, to know when you've stopped talking
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const s = { rec, stream, ctx, chunks, heard: false, last: 0, began: performance.now(), mime: rec.mimeType || mime };
    s.timer = setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      for (const v of samples) peak = Math.max(peak, Math.abs(v - 128));
      const now = performance.now();
      if (peak > LEVEL) { s.heard = true; s.last = now; }
      if (s.heard && now - s.last > SILENCE_MS) this.finish();
      else if (!s.heard && now - s.began > NO_SPEECH_MS) this.finish();
      else if (now - s.began > MAX_RECORD_MS) this.finish();
    }, 100);
    this.session = s;
    this.state = 'recording';
    rec.start(250);
    this.voice.play('tick');
    this.capri.wake();
    this.capri.pulse();
    if (opening) {
      await opening;
      if (!this.chat.open || this.chat.turn) { // it did not open (not set up yet) or she is answering: no recording
        clearInterval(s.timer);
        try { rec.stop(); } catch { /* not started */ }
        s.ctx.close().catch(() => {});
        this.session = null;
        this.state = 'idle';
        return;
      }
    }
    this.panel.chatInput.placeholder = `${t.listening}…`;
  }

  // hold-to-dictate: the key goes down, she records; it goes up, she types what you said where the cursor is (not an order, not a chat turn)
  async dictation(phase) {
    if (phase === 'down') {
      if (this.dict || this.state !== 'idle' || this.getCfg().dictate === false) return;
      let stream;
      try { stream = await this.mic({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }); } catch { return; }
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      this.speaker.stop();
      this.state = 'dictating';
      this.dict = { rec, chunks, stream, at: performance.now(), mime: rec.mimeType || mime, limit: setTimeout(() => this.dictation('up'), 90000) };
      rec.start(250);
      this.pill.set('listening');
      this.voice.play('tick');
      return;
    }
    const d = this.dict;
    if (!d) return;
    this.dict = null;
    clearTimeout(d.limit);
    await new Promise((resolve) => { d.rec.onstop = resolve; try { d.rec.stop(); } catch { resolve(); } });
    this.cool?.();
    for (const t of d.stream.getTracks()) t.stop();
    if (performance.now() - d.at < 500) { this.state = 'idle'; this.pill.set(null); return; } // (a tap, not a dictation)
    this.pill.set('thinking');
    try {
      const blob = new Blob(d.chunks, { type: d.mime || 'audio/webm' });
      const wav = await blobToWav(blob).catch(() => null);
      const res = await this.host.sttTranscribe({
        audio: wav || await blob.arrayBuffer(),
        mime: wav ? 'audio/wav' : blob.type,
        language: String(this.getCfg().sttLanguage || this.getCfg().lang || 'es').slice(0, 2),
        vocab: this.vocab(),
        quality: true,
      });
      const text = String(res?.text || '').trim();
      if (res?.ok && text && !(GHOST.test(text) && text.length < 70)) {
        await this.host.dictatePaste(text);
        this.voice.play('go');
      } else if (!res?.ok) {
        this.panel.say({ kind: 'error', line: String(this.getCfg().lang || 'es').startsWith('en') ? 'I could not transcribe that.' : 'No pude transcribir eso.', hold: 4000 });
      }
    } finally {
      this.state = 'idle';
      this.pill.set(null);
    }
  }

  async finish() {
    const s = this.session;
    if (!s || this.state !== 'recording') return;
    this.state = 'transcribing';
    this.session = null;
    clearInterval(s.timer);
    await new Promise((resolve) => {
      s.rec.onstop = resolve;
      try { s.rec.stop(); } catch { resolve(); }
    });
    this.cool(); // (the mic stays warm a few seconds)
    this.pill.set(null);
    s.ctx.close().catch(() => {});
    const t = this.t;
    this.panel.chatInput.placeholder = this.chat.t.placeholder;
    try {
      if (!s.heard) return this.note(t.nothing);
      this.panel.chatInput.placeholder = `${t.thinking}…`;
      const blob = new Blob(s.chunks, { type: s.mime || 'audio/webm' });
      const wav = await blobToWav(blob).catch(() => null); // (the recording as a WAV: any Whisper takes that one)
      const res = await this.host.sttTranscribe({
        audio: wav || await blob.arrayBuffer(),
        mime: wav ? 'audio/wav' : blob.type,
        language: String(this.getCfg().sttLanguage || this.getCfg().lang || 'es').slice(0, 2),
        vocab: this.vocab(),
      });
      if (!res.ok) return this.note(res.code === 'nokey' ? t.nokey : `${t.failed} ${res.error}`);
      const text = res.text.trim();
      if (!text || (GHOST.test(text) && text.length < 70)) return this.note(t.nothing);
      this.followUntil = Date.now() + FOLLOW_MS; // (hands free: you can go on without her name)
      return this.chat.send(text, { voice: true }); // she answers out loud: you spoke to her
    } finally {
      this.panel.chatInput.placeholder = this.chat.t.placeholder;
      this.state = 'idle';
    }
  }
}

// a recording of the mic (webm, ogg...) as a 16 kHz mono WAV
async function blobToWav(blob) {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    return encodeWav([decoded.getChannelData(0)], decoded.sampleRate);
  } finally {
    ctx.close().catch(() => {});
  }
}

// the clips of the mic as a WAV (mono, 16 kHz, a little louder if it was soft): what Whisper takes
// a block of the microphone (any rate) as 16 kHz, 16-bit mono audio: what openWakeWord is given (each output sample is the mean of the input samples it covers)
function pcm16k(block, rate) {
  const ratio = rate / 16000;
  const n = Math.floor(block.length / ratio);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const from = Math.floor(i * ratio);
    const to = Math.max(from + 1, Math.min(block.length, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = from; j < to; j++) sum += block[j];
    out[i] = Math.max(-32768, Math.min(32767, Math.round((sum / (to - from)) * 32767)));
  }
  return out.buffer;
}

function encodeWav(blocks, rate) {
  const total = blocks.reduce((n, b) => n + b.length, 0);
  const all = new Float32Array(total);
  let o = 0;
  for (const b of blocks) { all.set(b, o); o += b.length; }
  let peak = 0;
  for (const v of all) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0 ? Math.min(8, 0.8 / peak) : 1;
  const ratio = rate / 16000;
  const out = new Int16Array(Math.floor(total / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio);
    const z = Math.min(total, Math.max(a + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = a; j < z; j++) sum += all[j];
    out[i] = Math.max(-1, Math.min(1, (sum / (z - a)) * gain)) * 0x7fff;
  }
  const buf = new ArrayBuffer(44 + out.length * 2);
  const v = new DataView(buf);
  const text = (at, str) => { for (let i = 0; i < str.length; i++) v.setUint8(at + i, str.charCodeAt(i)); };
  text(0, 'RIFF'); v.setUint32(4, 36 + out.length * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  text(36, 'data'); v.setUint32(40, out.length * 2, true);
  new Int16Array(buf, 44).set(out);
  return buf;
}
