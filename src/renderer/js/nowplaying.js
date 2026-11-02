// The "now playing" card: what plays on your PC (Spotify, a browser, any player Windows knows about), with
// ⏮ ⏯ ⏭ under it. From "Ahora suena" in her menu; asking her "¿qué suena?" in the chat gets the same
// answer, with the same buttons, right there (chat.js: a card can't open over her chat).

import { fmt } from './util.js';

const POLL_MS = 3000;   // the card keeps up with the song while it's open
const SETTLE_MS = 900;  // after a button: the player needs a moment before it reports the new song
const TEXT = '\uFE0E';  // text glyphs, not colour emoji

// ⏮ ⏯ ⏭, the middle one showing what it'll do
export const mediaButtons = (playing) => [
  { id: 'previous', label: `⏮${TEXT}` },
  { id: 'toggle', label: playing ? `⏸${TEXT}` : `▶${TEXT}`, primary: true },
  { id: 'next', label: `⏭${TEXT}` },
];

// one line for the chat: «Suena: «Title» de Artist · Spotify»
export function nowLine(t, info) {
  if (!info) return t.nothing;
  return fmt(t.line, {
    verb: info.playing ? t.playing : t.paused,
    title: info.title,
    by: info.artist ? fmt(t.by, { artist: info.artist }) : '',
    app: info.app ? ` · ${info.app}` : '',
  });
}

// the card's own pieces: the song, who plays it, and where
function describe(t, info) {
  if (!info) return { line: t.nothing, quote: '', tag: '' };
  return {
    line: info.title,
    quote: [info.artist, info.album].filter(Boolean).join(' · '),
    tag: [info.app, info.playing ? '' : t.paused].filter(Boolean).join(' · '),
  };
}

export class NowPlaying {
  constructor({ capri, panel, host, brain, voice }) {
    this.voice = voice;
    this.capri = capri;
    this.panel = panel;
    this.host = host;
    this.brain = brain;
    this.shown = false;
    this.timer = null;
    this.busy = false; // a read in flight: no second one on top
    this.key = '';     // what the buttons were made for, so they only change when that does
  }

  get t() {
    return this.brain.t.nowPlaying;
  }

  buttons(info) {
    return [...(info ? mediaButtons(info.playing) : []), { id: 'close', label: '✕' }];
  }

  async show() {
    const { capri, panel, host, t } = this;
    if (capri.stowed) {
      host.setConfig({ visible: true });
      await capri.unstow();
    }
    capri.wake();
    const info = await host.nowPlaying().catch(() => null);
    const card = describe(t, info);
    this.key = `${Boolean(info)}:${Boolean(info?.playing)}`;
    const shown = panel.say({
      kind: 'music',
      face: info ? 'smug' : 'aside',
      badge: t.badge,
      tag: card.tag,
      line: card.line,
      quote: card.quote,
      actions: this.buttons(info),
      onAction: (id) => this.press(id),
      onLeave: () => this.stop(),
      hold: null, // it stays until you close it
    });
    if (!shown) return false;
    capri.perform('hop');
    this.start();
    return true;
  }

  start() {
    this.stop();
    this.shown = true;
    this.timer = setInterval(() => this.refresh(), POLL_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.shown = false;
  }

  async press(id) {
    if (id === 'close') return this.panel.hide();
    this.voice.play('tick', { gain: 2.5 });
    await this.host.nowControl(id); // the song on the card, whatever else is open
    setTimeout(() => this.refresh(), SETTLE_MS);
    return undefined;
  }

  async refresh() {
    if (!this.shown || this.busy) return;
    this.busy = true;
    try {
      const info = await this.host.nowPlaying().catch(() => null);
      if (!this.shown) return;
      this.panel.updateCard(describe(this.t, info));
      const key = `${Boolean(info)}:${Boolean(info?.playing)}`;
      if (key !== this.key) { // play became pause, or something started: the buttons follow
        this.key = key;
        this.panel.setActions(this.buttons(info), (id) => this.press(id));
      }
    } finally {
      this.busy = false;
    }
  }
}

// The strip under her cards (panel.js renderNow): what plays, kept up to date while a card that has one is
// on screen. Her chat and the card for when you click her start it; leaving the card stops it. A tick on every button.
// What the strip shows, from every session Windows reports (launch.js nowSessions): a row for your music,
// another for a video or whatever else plays in the browser. A paused video isn't worth a row (a closed
// tab can linger for a while); paused music is, so you can start it again. Nothing else playing: the
// paused video, so there's still something to resume.
export function pickCards(list = []) {
  // everything Windows says is playing or paused (as its own list does): what plays first, music before video, at most four
  const shown = [...list]
    .sort((a, b) => (Number(b.playing) - Number(a.playing)) || ((b.kind === 'music') - (a.kind === 'music')))
    .slice(0, 4);
  return shown.map((s) => ({
    kind: s.kind,
    title: s.title,
    meta: [s.artist, s.app].filter(Boolean).join(' · '),
    playing: s.playing,
    pos: s.pos || 0,
    dur: s.dur || 0,
    age: s.age || 0, // (the position was this old when it was read)
    app: s.app,
    artist: s.artist || '',
    target: { title: s.title, appId: s.appId }, // so a button reaches that session and no other
    appId: s.appId,
  }));
}

export class NowStrip {
  constructor({ panel, host, voice }) {
    this.panel = panel;
    this.host = host;
    this.voice = voice;
    this.timer = null;
    this.active = false;
    this.busy = false; // a read in flight: no second one on top
    this.art = new Map(); // app|title -> its picture (data URL), or null when the player gives none
  }

  start() {
    this.stop();
    this.active = true;
    this.tick();
    this.timer = setInterval(() => this.tick(), POLL_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.active = false;
  }

  async tick() {
    if (!this.active || this.busy) return;
    if (this.player?.enabled) { // her player card shows it now, bigger: this small strip is not shown
      this.panel.renderNow([]);
      return;
    }
    this.busy = true;
    const list = await this.host.nowSessions().catch(() => []);
    this.busy = false;
    if (!this.active) return;
    const cards = pickCards(list).map((card) => ({ ...card, art: this.art.get(`${card.appId}|${card.title}`) || '' }));
    this.panel.renderNow(cards, (id, card) => this.press(id, card));
    this.fetchArt(cards);
  }

  // the cover or thumbnail of a song or video that has none yet: asked once for each, and put on its row when it arrives
  async fetchArt(cards) {
    for (const card of cards) {
      const key = `${card.appId}|${card.title}`;
      if (this.art.has(key)) continue;
      this.art.set(key, null); // (asked: not again while it is on its way, and not again if the player gives none)
      if (this.art.size > 40) this.art.delete(this.art.keys().next().value);
      const art = await this.host.nowArt?.(card.target).catch(() => null);
      if (!art || !this.active) continue;
      this.art.set(key, art);
      this.panel.setNowArt?.(key, art);
    }
  }

  async press(id, card) {
    this.voice.play('tick', { gain: 2.5 });
    this.panel.extendHold(); // you're using it: the card stays
    await this.host.nowControl(id, card?.target); // that session, and no other
    setTimeout(() => this.tick(), SETTLE_MS);
  }
}
