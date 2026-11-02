// Her chatter while she's put away in her corner (Ctrl+Alt+C). Now and then she says something about how the PC
// is doing (RAM, CPU), what's in front of you (the program's NAME only: never a window title or anything inside
// it), what's playing, the time of day, or how long you've been at it. All her own lines (ambient-lines.js): no
// AI call, so it costs nothing and nothing leaves your PC.
//
// Her menu > When she rests > When she is put away: quiet, now and then, or often (config restTalk).
// Her menu > What she sees now: she says what she's looking at right now, to check it works.
// She talks put away (her eyes open in the corner) and also out and about (menu > Comments, 'also when she is active').
// Always a text bubble with its sounds; her voice only some of the time, or never, or always (config ambientVoice).
// She never breaks in on a chat, her guide, Claude working, a call or a game, nor talks to an empty room.

import { pick, rand, fmt } from './util.js';
import { ambientLines, flirtLines, isFlirty } from './ambient-lines.js';

const TICK = 20 * 1000;
const MIN_GAP = 90 * 1000;                                 // never twice within this
const GAPS = { sometimes: [7, 16], often: [2.5, 6] };      // minutes between remarks
const COOLDOWN = { look: 14, ram: 25, cpu: 25, late: 60, break: 20, long: 80, song: 6, watching: 45, vibe: 25, day: 150, app: 18 }; // minutes before she repeats herself
const RAM_AT = 85;
const CPU_AT = 92;
const AWAY_AFTER = 5 * 60;      // seconds without touching the PC: nobody's there
const BREAK_AFTER = 60;         // minutes at it before she tells you to get up (config breakMins)
const LONG_AFTER = 60;          // minutes in the same kind of program
const SHOWN = 9000;
const LONG_KINDS = new Set(['design', 'code', 'video', 'blender', 'office']);
// where she may take a look at the screen by herself: never chats, browsers, files, calls, games or anything she can't place
const LOOK_OK = new Set(['design', 'code', 'video', 'blender', 'office', 'music']);

// the program's name (lowercase, without .exe) -> what it is. First match wins; 'quiet' = don't disturb.
const APPS = [
  ['quiet', /^(zoom|teams|ms-teams|skype|webex|obs|obs64|powerpnt|minecraft|javaw|steam|steamwebhelper|epicgameslauncher|valorant.*|leagueclient|league of legends|fortniteclient.*|robloxplayerbeta|cs2|dota2|eldenring|gta5|curseforge)$/],
  ['music', /^(spotify|applemusic|itunes|musicbee|foobar2000|aimp)$/],
  ['design', /illustrator|photoshop|indesign|figma|affinity|canva|inkscape|krita|clipstudio|lightroom|gimp|vectorcraft|sai2/],
  ['blender', /^blender/],
  ['video', /premiere|afterfx|resolve|capcut|^vegas|kdenlive/],
  ['code', /^(code|cursor|devenv|webstorm64|pycharm64|idea64|windowsterminal|wt|powershell|pwsh|cmd|claude|antigravity|sublime_text|notepad\+\+)$/],
  ['chat', /^(discord|whatsapp|telegram|slack|signal)$/],
  ['office', /^(winword|excel|onenote|acrobat|acrord32|notion|obsidian)$/],
  ['files', /^explorer$/],
  ['browser', /^(chrome|msedge|firefox|brave|opera|opera_gx|vivaldi|zen|arc)$/],
];

const LABEL = {
  es: { music: 'música', design: 'diseño', blender: '3D', video: 'video', code: 'código', chat: 'mensajería', office: 'documentos', files: 'archivos', browser: 'navegador', quiet: 'no molestar' },
  en: { music: 'music', design: 'design', blender: '3D', video: 'video', code: 'code', chat: 'messaging', office: 'documents', files: 'files', browser: 'browser', quiet: 'do not disturb' },
};

export const categorize = (proc) => {
  const name = String(proc || '').toLowerCase().replace(/\.exe$/, '').trim();
  if (!name || name === 'electron' || name === 'capri') return null; // herself, or nothing
  return APPS.find(([, re]) => re.test(name))?.[0] || null;
};

// the time of day, as a kind of remark
const dayKey = (hour, weekend) => {
  if (hour >= 23 || hour < 5) return 'late';
  if (weekend && Math.random() < 0.5) return 'weekend';
  if (hour < 11) return 'morning';
  if (hour < 15) return 'noon';
  if (hour < 19) return 'afternoon';
  return 'evening';
};

export class Ambient {
  constructor({ host, capri, panel, chip, brain, guide, chat, speaker, voice, getConfig }) {
    Object.assign(this, { host, capri, panel, chip, brain, guide, chat, speaker, voice, getConfig });
    this.said = {};          // key -> when she last said something about it
    this.lastSaid = 0;
    this.next = Date.now() + 3 * 60 * 1000;
    this.wasStowed = false;
    this.lastCat = null;
    this.catSince = Date.now();
    this.presentSince = Date.now(); // since you last came back to the PC
    this.cpuHigh = 0;               // samples in a row with the CPU through the roof
    this.song = '';
    this.lastMusicCheck = 0;
    this.musicSince = 0; // since when music has been playing, 0: none
    this.working = false;
  }

  start() {
    setInterval(() => this.tick(), TICK);
  }

  // nothing else is going on that she'd step on
  // What's keeping her from talking right now ('' = nothing). Asleep is not a reason: a remark wakes her.
  blocker() {
    const { capri, panel, guide, chat, brain } = this;
    const es = String(brain.lang).startsWith('es');
    const L = (a, b) => (es ? a : b);
    if (this.getConfig()?.dnd) return L('no molestar está activado', 'do not disturb is on');
    if (this.getConfig()?.dndAuto) return L('está en silencio automático (llamada, grabación o juego)', 'automatic quiet is on (call, recording or game)');
    if (capri.busy) return L('está en medio de una animación', 'in the middle of an animation');
    if (capri.stowing) return L('se está guardando', 'putting herself away');
    if (panel.visible) return L('hay una burbuja abierta', 'a bubble is open');
    if (guide.running) return L('su guía está en marcha', 'her guide is running');
    if (chat.turn) return L('estás en el chat con ella', 'you are chatting with her');
    if (brain.busySessions.length) return L('Claude está trabajando', 'Claude is working');
    if (capri.stowed) return '';
    if (capri.act) return L('está en medio de un gesto', 'in the middle of a gesture');
    if (capri.pointing) return L('está señalando algo', 'pointing at something');
    if (capri.hidden && !capri.dormant) return L('está escondida', 'hidden');
    if (!['idle', 'sleep'].includes(capri.mode)) return L(`está en modo ${capri.mode}`, `in ${capri.mode} mode`);
    if (!capri.dormant && !['stand', 'sit'].includes(capri.stance)) return L(`está en postura ${capri.stance}`, `in ${capri.stance} stance`);
    return '';
  }

  free() {
    return !this.blocker();
  }

  // Asleep (or down to her mask)? A remark wakes her first, and waits for her to be back together.
  async wakeUp() {
    const { capri } = this;
    if (capri.stowed || !(capri.dormant || capri.mode === 'sleep')) return;
    capri.wake();
    const end = Date.now() + 6000;
    while ((capri.dormant || capri.busy) && Date.now() < end) await new Promise((r) => setTimeout(r, 200));
    await new Promise((r) => setTimeout(r, 350));
  }

  due(key, now) {
    return now - (this.said[key] || 0) > (COOLDOWN[key] ?? COOLDOWN.app) * 60 * 1000;
  }

  // Her bubble comes out of the corner where her mask is, or from her head.
  anchor() {
    if (this.capri.stowed) {
      const c = this.chip.center();
      this.panel.setAnchor({ x: c.x, y: c.y, top: c.y - 62 }, this.capri.view);
    } else {
      this.panel.setAnchor({ ...this.capri.head(), lean: 0 }, this.capri.view);
    }
  }

  async tick() {
    if (this.working) return;
    this.working = true;
    try {
      await this.step();
    } catch (err) {
      console.error('[capri] ambient:', err?.message || err);
    } finally {
      this.working = false;
    }
  }

  async step() {
    const now = Date.now();
    const stowed = Boolean(this.capri.stowed);
    if (stowed !== this.wasStowed) { // put away, or back out: a little quiet first
      this.wasStowed = stowed;
      this.next = Math.max(this.next, now + rand(1.5, 3) * 60 * 1000);
      this.lastCat = null;
      this.cpuHigh = 0;
    }
    const cfg = this.getConfig() || {};
    const mode = cfg.restTalk || 'often';
    if (mode === 'never' || (!stowed && cfg.ambientActive === false) || !this.free()) return;

    const s = await this.host.ambient?.().catch(() => null);
    if (!s) return;
    if (s.idle > AWAY_AFTER) { // nobody's there: she keeps quiet, and the clock for "you've been at it" starts over
      this.presentSince = now;
      this.catSince = now;
      return;
    }
    const cat = categorize(s.app);
    this.cpuHigh = s.cpuPct >= CPU_AT ? this.cpuHigh + 1 : 0;
    if (cat === 'quiet') return; // a call, a recording, a game: not now
    const changed = Boolean(cat) && cat !== this.lastCat;
    if (cat && changed) this.catSince = now;
    if (cat) this.lastCat = cat;
    if (now - this.lastSaid < MIN_GAP) return;

    const musical = await this.musicMoment(now, mode);
    if (musical) {
      await this.speak(musical, s, cat, mode, now);
      return;
    }

    const key = this.choose(s, cat, changed, now);
    if (key) await this.speak(key, s, cat, mode, now);
  }

  // Music: whatever plays (Spotify, YouTube Music in the browser, any player Windows knows). She notices a new song now and then and says
  // its name, and after a good while of music, a remark about the vibe. Never the words of a song: only its title and who plays it.
  async musicMoment(now, mode) {
    if (now - this.lastMusicCheck < 45 * 1000 || now - this.lastSaid < 3 * 60 * 1000) return null;
    this.lastMusicCheck = now;
    const np = await this.host.nowPlaying?.().catch(() => null);
    if (!np?.playing || !np.title) {
      this.musicSince = 0;
      return null;
    }
    if (np.kind === 'video') { // a video in the browser (a tutorial, a series): not music, so no "nice song" and no "vibe"; now and then a remark about the video itself
      this.musicSince = 0;
      return this.due('watching', now) && np.title !== this.watched && Math.random() < (mode === 'sometimes' ? 0.15 : 0.3) ? 'watching' : null;
    }
    if (!this.musicSince) this.musicSince = now;
    const chance = mode === 'sometimes' ? 0.25 : 0.5; // (put away and quiet: less)
    if (np.title !== this.song && this.due('song', now) && Math.random() < chance) return 'song';
    if (now - this.musicSince > 12 * 60 * 1000 && this.due('vibe', now) && Math.random() < chance) return 'vibe';
    return null;
  }

  // what to say, if anything: things going wrong first, then what you're doing, then just company
  choose(s, cat, changed, now) {
    const hour = new Date().getHours();
    const weekend = [0, 6].includes(new Date().getDay());
    if (s.ramPct >= RAM_AT && this.due('ram', now)) return 'ram';
    if (this.cpuHigh >= 2 && this.due('cpu', now)) return 'cpu';
    const breakMs = (Number(this.getConfig()?.breakMins) || BREAK_AFTER) * 60 * 1000; // (her menu config: breakMins, default 60)
    if (this.breakOffDay !== new Date().toDateString() && now - this.presentSince > breakMs && this.due('break', now)) return 'break';
    if (LONG_KINDS.has(cat) && now - this.catSince > LONG_AFTER * 60 * 1000 && this.due('long', now)) return 'long';
    if (changed && Math.random() < 0.45 && this.due(cat, now)) return cat; // you switched to something
    if (now < this.next) return null;
    // a real look at the screen, if you turned it on: not while the PC is already working hard
    if (this.getConfig()?.autoLook && LOOK_OK.has(cat) && s.cpuPct < 70 && this.due('look', now) && Math.random() < 0.5) return 'look';
    const r = Math.random();
    if (r < 0.2 && this.due('day', now)) return dayKey(hour, weekend);
    if (cat && r < 0.7 && this.due(cat, now)) return cat;
    return Math.random() < 0.5 ? 'misc' : 'idle';
  }

  // The words for it. A song that plays gets named now and then.
  async lineFor(key, s, cat) {
    const lang = this.brain.lang;
    const name = this.brain.custom?.userName || 'choom';
    const vars = {
      name, pct: s.ramPct, used: s.ramUsed, total: s.ramTotal, cpu: s.cpuPct,
      mins: Math.round((Date.now() - (key === 'long' ? this.catSince : this.presentSince)) / 60000),
    };
    if (key === 'idle') return { key, line: this.brain.idleLine() };
    if (key === 'watching') { // a video that plays in the browser: its title only (from the media session), never what is on the screen
      const np = await this.host.nowPlaying?.().catch(() => null);
      if (!np?.playing || !np.title || np.kind !== 'video') return { key, line: '' };
      this.watched = np.title;
      return { key, line: fmt(pick(ambientLines(lang).watching), { ...vars, title: np.title }) };
    }
    if (key === 'song') { // named from what plays right now
      const np = await this.host.nowPlaying?.().catch(() => null);
      if (!np?.playing || !np.title || np.kind === 'video') return { key, line: '' };
      this.song = np.title;
      const by = np.artist ? (String(lang).startsWith('es') ? ` de ${np.artist}` : ` by ${np.artist}`) : '';
      const fp = this.flirtPool(lang, 'song');
      return { key, flirt: Boolean(fp), line: fmt(pick(fp || ambientLines(lang).song), { ...vars, song: np.title, by }) };
    }
    if (key === 'look') {
      this.said.look = Date.now(); // whatever comes of it, not again for a while
      const seen = await this.host.look?.().catch(() => null);
      return { key, line: seen?.ok ? seen.text : '' };
    }
    if ((cat === 'music' || key === 'misc' || key === 'music') && this.due('song', Date.now())) {
      const np = await this.host.nowPlaying?.().catch(() => null);
      if (np?.playing && np.title && np.kind !== 'video' && np.title !== this.song) {
        this.song = np.title;
        const by = np.artist ? (String(lang).startsWith('es') ? ` de ${np.artist}` : ` by ${np.artist}`) : '';
        return { key: 'song', line: fmt(pick(ambientLines(lang).song), { ...vars, song: np.title, by }) };
      }
    }
    const fp = this.flirtPool(lang, key);
    return { key, flirt: Boolean(fp), line: fmt(pick(fp || ambientLines(lang)[key] || ambientLines(lang).misc), vars) };
  }

  // her flirty version of a comment (config persona asks for it), most of the time; else null and the usual lines go
  flirtPool(lang, key) {
    if (!isFlirty(this.getConfig()?.persona) || Math.random() > 0.65) return null;
    return flirtLines(lang)[key] || null;
  }

  // What she does when she remarks something while she is put away (Ctrl+Alt+C):
  //  - in text: her bubble comes out of the corner (her panel was put aside when she folded away, so it was never seen: it comes back for it),
  //    with its sounds, and goes again
  //  - in voice: she comes out for a moment, says it (bubble and voice), and folds herself away again, unless you called her out meanwhile
  async speak(key, s, cat, mode, now, { force = false, tag: given = '' } = {}) {
    let tag = given;
    const { key: said, line, flirt } = await this.lineFor(key, s, cat);
    if (!line) return false;
    const cfg = this.getConfig() || {};
    const vmode = cfg.ambientVoice || 'sometimes';
    // her voice only some of the time, and only if it can be heard (voice on, not already saying something)
    // (her passing remarks about your PC and what you do are said out loud now and then, in every voice mode: her menu > Comments sets how often)
    const voiced = (vmode === 'always' || (vmode === 'sometimes' && Math.random() < 0.35))
      && this.speaker.enabled && !this.speaker.speaking && cfg.announce !== 'never';
    // put away she stays put away: her small card (text or voice) and a clip over it, out of her biochip. (stowedVisit: true in her
    // config brings her out instead for a spoken remark, and she goes back after)
    const visit = Boolean(this.capri.stowed) && voiced && cfg.stowedVisit === true;
    const wasAsleep = Boolean(this.capri.dormant || this.capri.mode === 'sleep'); // (down to her mask, or dozing)
    if (visit) await this.capri.unstow(); // she comes out, next to her biochip
    await this.wakeUp();
    if (!tag && s.app && (said === 'ram' || said === 'cpu' || said === 'look' || (LABEL.es[said] && said !== 'quiet'))) tag = `${String(this.brain.lang).startsWith('es') ? 'VEO' : 'SEE'} · ${s.app}`;
    const stowedNow = Boolean(this.capri.stowed);
    if (stowedNow) this.panel.resume(); // (it was put aside while she is folded away)
    this.anchor();
    // woken by herself (put away, or asleep): one small remark, her face and a line, and then back; the whole card is for when she is out
    const compact = (stowedNow || visit || wasAsleep) && !force;
    const hold = compact ? (voiced ? 5000 : 6000) : force ? SHOWN + 3000 : SHOWN;
    const es = String(this.brain.lang).startsWith('es');
    const breakMs = (Number(cfg.breakMins) || BREAK_AFTER) * 60 * 1000;
    const withButtons = said === 'break' && !compact; // a break she suggests out and about: you answer it
    const withRam = said === 'ram'; // the memory remark brings its button: she helps close what weighs (ramHelp)
    const shown = this.panel.say({
      kind: 'info', line, tag: withButtons ? (es ? 'PAUSA' : 'BREAK') : tag, face: said === 'ram' || said === 'cpu' ? 'aside' : 'smug', hold: withButtons ? 20000 : withRam ? Math.max(hold, 15000) : hold, compact,
      ...(withRam ? {
        actions: [{ id: 'free', label: es ? 'Liberar RAM' : 'Free RAM', primary: true }, { id: 'later', label: es ? 'Luego' : 'Later' }],
        onAction: (id) => { if (id === 'free') this.ramHelp(); else this.panel.hide?.(); },
      } : {}),
      ...(withButtons ? {
        actions: [
          { id: 'done', label: es ? 'Ya descansé' : 'Rested', primary: true },
          { id: 'snooze', label: es ? 'En 15 min' : 'In 15 min' },
          { id: 'skip', label: es ? 'Hoy no' : 'Not today' },
        ],
        onAction: (id) => {
          if (id === 'snooze') this.presentSince = Date.now() - (breakMs - 15 * 60 * 1000); // asks again in 15 minutes
          else if (id === 'skip') this.breakOffDay = new Date().toDateString();            // not again until tomorrow
          else this.presentSince = Date.now();                                              // the clock starts over
          this.panel.hide?.();
        },
      } : {}),
    });
    if (shown && flirt && Math.random() < 0.5) this.panel.onLaugh?.(); // (a flirty remark, a little giggle)
    if (!shown) {
      if (stowedNow) this.panel.suspend();
      if (visit) await this.goBack();
      return false;
    }
    this.said[said] = now;
    if (said === 'break') this.presentSince = now;
    if (said === 'long') this.catSince = now;
    if (said === 'late' || ['morning', 'noon', 'afternoon', 'evening', 'weekend'].includes(said)) this.said.day = now;
    this.lastSaid = now;
    const [lo, hi] = GAPS[mode] || GAPS.often;
    this.next = now + rand(lo, hi) * 60 * 1000;
    // a text bubble always (with its typing sounds); her voice only some of the time
    if (voiced) this.speaker.announce(line, this.brain.lang, { quiet: true, flirt: Boolean(flirt) }); // (her passing remarks: a soft voice)
    // a clip that goes with it: while put away always (a remark is also a small show), out and about half of the time
    if (stowedNow || visit || Math.random() < 0.5) {
      const music = said === 'song' || said === 'vibe';
      const kind = voiced ? 'voz' : said === 'ram' || said === 'cpu' ? 'sorpresa' : music ? 'musica' : 'idle';
      this.clips?.play(kind, { away: stowedNow, fallback: kind === 'idle' ? '' : 'idle' });
    }
    this.voice?.play(said === 'ram' || said === 'cpu' ? 'alert' : 'tick');
    if (!this.capri.stowed) { // out and about: she reacts a little as it comes out
      this.capri.pulse?.();
      if (Math.random() < 0.3 && this.capri.stance === 'stand') this.capri.perform?.('curious', this.capri.towardCenter());
    }
    if (stowedNow) { // her eyes open a moment, like when Claude waits on you; and her panel is put aside again after
      this.chip.setMode('alert');
      setTimeout(() => {
        if (!this.capri.stowed) return;
        this.chip.setMode(this.capri.mode);
        if (!this.chat.open && !this.guide.running) this.panel.suspend();
      }, hold + 600);
    }
    if (visit) await this.goBack();
    return true;
  }

  // After a spoken remark she came out for: wait until her voice and her bubble are done, then fold herself away again
  // (not if you called her out meanwhile, her chat or guide opened, or something else needs her)
  // The button of her memory remark: what weighs on the PC. What is on the safe list (Adobe helpers, Phone Link, Teams with no window...) she closes on one press;
  // heavy programs get a button each (named, with their size) unless they are a browser or a work app: those she only lists, and you say "cierra Chrome" (she asks first).
  async ramHelp() {
    const es = String(this.brain.lang).startsWith('es');
    const gb = (m) => (m >= 1024 ? `${(m / 1024).toFixed(1)} GB` : `${m} MB`);
    const tag = 'RAM';
    this.panel.say({ kind: 'info', tag, face: 'smug', line: es ? 'Miro qué se está comiendo tu memoria…' : 'Looking at what is eating your memory…', hold: 25000, compact: true });
    const r = await this.host.perfScan?.().catch(() => null);
    if (!r?.total) {
      this.panel.say({ kind: 'error', tag, face: 'aside', line: es ? 'No pude mirar los procesos ahora.' : 'I could not look at the processes right now.', hold: 5000 });
      return;
    }
    const KEEP = /chrome|msedge|firefox|zen|brave|opera|vivaldi|illustrator|photoshop|indesign|lightroom|affinity|figma|blender|premiere|after\s*effects|davinci|clip\s*studio|krita|fusion|autocad|winword|excel|powerpnt|devenv|code|obs|unity|unreal|zbrush|substance|ollama|whisper|claude/i;
    const safeMb = r.safe.reduce((n, p) => n + p.mb, 0);
    const offer = r.heavy.filter((p) => p.win && !KEEP.test(p.name)).slice(0, 2);
    const lines = [es ? `Memoria: ${gb(r.total - r.free)} en uso de ${gb(r.total)}.` : `Memory: ${gb(r.total - r.free)} in use of ${gb(r.total)}.`];
    if (r.safe.length) lines.push(es ? `Puedo cerrar sin problema (${gb(safeMb)}):` : `I can close safely (${gb(safeMb)}):`, ...r.safe.map((p) => `• ${p.name}${p.count > 1 ? ` ×${p.count}` : ''} — ${gb(p.mb)}`));
    if (r.heavy.length) lines.push(es ? 'Lo que más pesa (dime «cierra X» y te pregunto antes si puede tener trabajo sin guardar):' : 'What weighs most (say "close X" and I ask first if it may hold unsaved work):', ...r.heavy.map((p) => `• ${p.name}${p.count > 1 ? ` ×${p.count}` : ''} — ${gb(p.mb)}`));
    if (!r.safe.length && !r.heavy.length) lines.push(es ? 'No veo nada pesado que sobre. Probablemente son pestañas del navegador.' : 'I see nothing heavy that is not needed. Probably browser tabs.');
    const actions = [];
    if (r.safe.length) actions.push({ id: 'safe', label: es ? `Cerrar lo seguro (${gb(safeMb)})` : `Close the safe ones (${gb(safeMb)})`, primary: true });
    offer.forEach((p, i) => actions.push({ id: `app:${i}`, label: `${es ? 'Cerrar' : 'Close'} ${p.name} (${gb(p.mb)})`, primary: !r.safe.length && i === 0 }));
    actions.push({ id: 'cancel', label: es ? 'Dejarlo así' : 'Leave it' });
    const done = (ok, line) => this.panel.say({ kind: ok ? 'done' : 'error', badge: es ? 'RENDIMIENTO' : 'SPEED', line, face: ok ? 'laugh' : 'aside', hold: 7000 });
    this.panel.say({
      kind: 'info', tag, face: 'smug', line: lines[0], reply: lines.slice(1).join('\n'), hold: 40000, actions,
      onAction: async (id) => {
        if (id === 'cancel') { this.panel.hide?.(); return; }
        if (id === 'safe') {
          const res = await this.host.perfRun?.(r.safe.map((p) => p.name), true).catch(() => null);
          done(Boolean(res?.ok), res?.ok ? (es ? `Cerré ${res.closed} procesos. Debí liberar unos ${gb(safeMb)}.` : `Closed ${res.closed} processes. That should free about ${gb(safeMb)}.`) : (es ? `No pude cerrarlos: ${res?.error || 'error'}.` : `Couldn't close them: ${res?.error || 'error'}.`));
          return;
        }
        const p = offer[Number(String(id).split(':')[1])];
        if (!p) return;
        const res = await this.host.closeApp?.(p.name, false).catch(() => null);
        done(Boolean(res) && !res.running, res && !res.running ? (es ? `Cerré ${p.name}. Debí liberar unos ${gb(p.mb)}.` : `Closed ${p.name}. That should free about ${gb(p.mb)}.`) : (es ? `${p.name} sigue abierto (quizá lo guardó en la bandeja o pide guardar algo).` : `${p.name} is still open (maybe it hid in the tray or asks to save something).`));
      },
    });
  }

  async goBack() {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const { capri, panel, speaker, chat, guide } = this;
    await wait(1500);
    const end = Date.now() + 40000;
    while ((speaker.speaking || panel.visible) && Date.now() < end) await wait(300);
    await wait(500);
    if (capri.stowed || chat.open || guide.running || chat.turn) return;
    const cfg = await this.host.getConfig?.().catch(() => null);
    if (cfg && cfg.visible !== false) return; // you called her out (her menu, Ctrl+Alt+C, her biochip): she stays
    for (let i = 0; capri.busy && i < 30; i++) await wait(200);
    if (capri.stowed) return;
    await capri.stow();
  }

  // Her menu > What she sees now: what she's looking at, and a remark about it, right away.
  async now() {
    const s = await this.host.ambient?.().catch(() => null);
    const es = String(this.brain.lang).startsWith('es');
    if (!s) {
      this.panel.say({ kind: 'error', line: es ? 'No logro ver nada: el sensor de ventanas no responde.' : 'I cannot see anything: the window sensor is not answering.', hold: 8000 });
      return;
    }
    const cat = categorize(s.app);
    const kind = (LABEL[es ? 'es' : 'en'][cat] || (es ? 'otro programa' : 'other program'));
    const why = this.blocker() || (s.idle > AWAY_AFTER ? (es ? 'no has tocado el PC' : 'you have not touched the PC') : '') || (cat === 'quiet' ? (es ? 'programa de no molestar' : 'do-not-disturb program') : '');
    const tag = `${es ? 'VEO' : 'SEE'}: ${s.app || (es ? 'nada' : 'nothing')} · ${kind} · RAM ${s.ramPct}% · CPU ${s.cpuPct}% · ${es ? 'AUTO' : 'AUTO'}: ${why || (es ? 'activo' : 'on')}`;
    const key = s.ramPct >= RAM_AT ? 'ram' : (cat && cat !== 'quiet' ? cat : 'misc');
    await this.speak(key, s, cat, this.getConfig()?.restTalk || 'often', Date.now(), { force: true, tag });
  }
}
