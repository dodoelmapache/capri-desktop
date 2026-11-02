// Her clips: short animations of the character (GIF, animated WebP, WebM, MP4) that you put in a folder of your own, played as a little
// framed "hologram" beside her now and then and when something happens. The files are yours: she only reads the folder (config `clipsDir`,
// by default Desktop\Organización Claude\video\Capri personaje); nothing of them is kept in her own files.
//
// The first word of a file's name says when it fits (saludo-1.gif, risa-2.webm...):
//   saludo     you click her and her chat opens        risa       Claude finished something
//   sorpresa   an alert or an error                    trabajando Claude started working
//   voz        she speaks out loud or explains something   idle       now and then, when nothing is going on
//   musica     she remarks on the song that plays (optional)
//
// Never over something that matters: not while you write to her, not while her guide runs, not put away, not with reduced motion.

import { reducedMotion } from './util.js';

const GAP = 25 * 1000;                  // at least this long between two clips
const GAP_KIND = { trabajando: 120 * 1000, saludo: 40 * 1000 };
const IDLE_EVERY = [6 * 60 * 1000, 14 * 60 * 1000];
const MIN_SHOW = 1800;
const MAX_SHOW = 8000;
const KIND_OF_PANEL = { alert: 'sorpresa', error: 'sorpresa', done: 'risa', work: 'trabajando', chat: 'saludo' };

// the little status in the monitor's corner, by what is going on
const STATE = { saludo: 'LISTENING', voz: 'TALKING', musica: 'VIBING', trabajando: 'WORKING', risa: 'DONE', sorpresa: 'ALERT', idle: 'ONLINE' };
const pad2 = (n) => String(n).padStart(2, '0');

const plain = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const kindOf = (name) => plain(name).replace(/\.[a-z0-9]+$/, '').split(/[-_. (]/)[0];

// how long a GIF runs once: the sum of its frames' delays (a GIF has no length of its own)
function gifLength(bytes) {
  const b = new Uint8Array(bytes);
  if (b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return 0;
  let total = 0;
  for (let i = 13; i < b.length - 6; i += 1) {
    if (b[i] === 0x21 && b[i + 1] === 0xf9 && b[i + 2] === 0x04) total += (b[i + 4] | (b[i + 5] << 8)) * 10 || 100; // 0 delay: browsers show it as 100 ms
  }
  return total;
}

export class ClipPlayer {
  constructor({ host, capri, panel, chip, chat, guide, getConfig }) {
    Object.assign(this, { host, capri, panel, chip, chat, guide, getConfig });
    this.list = [];
    this.loadedAt = 0;
    this.last = -Infinity;
    this.lastByKind = {};
    this.playing = null;
    this.nextIdle = performance.now() + IDLE_EVERY[0];
    this.recent = {}; // kind -> the file she showed last, so she doesn't repeat one right away
    setInterval(() => this.tick(), 30 * 1000);
  }

  get enabled() {
    return this.getConfig()?.clips !== false && !reducedMotion.matches;
  }

  async refresh() {
    if (performance.now() - this.loadedAt < 60 * 1000 && this.list.length) return;
    this.loadedAt = performance.now();
    const found = await this.host.clipsList?.().catch(() => []);
    this.list = (found || []).map((f) => ({ ...f, kind: kindOf(f.name) }));
  }

  // a panel went up: some of them call for a clip
  onPanel(msg) {
    const kind = KIND_OF_PANEL[msg?.kind];
    if (kind) this.play(kind);
  }

  // something she can do on her own now and then, when nothing is going on
  tick() {
    if (performance.now() < this.nextIdle) return;
    this.nextIdle = performance.now() + IDLE_EVERY[0] + Math.random() * (IDLE_EVERY[1] - IDLE_EVERY[0]);
    this.play('idle');
  }

  // (a greeting is for the very moment her chat opens: the chat being open does not stop it)
  // away: she is put away in her biochip, and the clip comes out of it, over her small card
  busy(kind, away = false, corner = false) {
    const { capri, chat, guide } = this;
    if (corner) return guide.running || Boolean(chat.turn); // in the corner of the screen (a game): it does not depend on where she is
    const inChip = capri.stowed && away;
    return (capri.stowed && !away) || capri.stowing || (capri.hidden && !inChip) || capri.dormant || capri.busy || capri.dragging
      || (kind !== 'saludo' && kind !== 'voz' && chat.open) || (kind !== 'voz' && chat.turn) || guide.running;
  }

  // kind: which clips fit. away: from her biochip (put away). fallback: another kind to try when there is none of the first.
  async play(kind, { away = false, fallback = '', corner = false, force = false } = {}) {
    if (!this.enabled || this.playing || this.busy(kind, away, corner)) return false;
    const now = performance.now();
    if (!force && (now - this.last < GAP || now - (this.lastByKind[kind] || -Infinity) < (GAP_KIND[kind] || 0))) return false; // (force: a BOOM always gets its GIF)
    await this.refresh();
    let pool = this.list.filter((c) => c.kind === kind);
    if (!pool.length && fallback) {
      kind = fallback;
      pool = this.list.filter((c) => c.kind === kind);
    }
    if (!pool.length) return false;
    const fresh = pool.filter((c) => c.name !== this.recent[kind]);
    const clip = (fresh.length ? fresh : pool)[Math.floor(Math.random() * (fresh.length || pool.length))];
    this.recent[kind] = clip.name;
    this.last = now;
    this.lastByKind[kind] = now;
    return this.show(clip, kind, away, corner);
  }

  async show(clip, kind, away = false, corner = false) {
    const url = `${clip.url}${clip.url.includes('?') ? '&' : '?'}t=${Date.now()}`; // (a GIF starts over from its first frame)
    const video = /\.(webm|mp4)$/i.test(clip.name);
    const el = document.createElement('div');
    el.className = corner ? 'clip clip--corner' : 'clip';
    el.style.visibility = 'hidden';
    const media = document.createElement(video ? 'video' : 'img');
    media.alt = '';
    media.draggable = false;
    if (video) Object.assign(media, { muted: true, autoplay: true, playsInline: true, loop: false });
    el.append(media);
    // the monitor around it: a tab with her name, scanlines, her mark in katakana, the state in a corner and a REC counter
    const tab = Object.assign(document.createElement('span'), { className: 'clip__tab', textContent: 'CAPRI // ONLINE' });
    const scan = Object.assign(document.createElement('span'), { className: 'clip__scan' });
    const mark = Object.assign(document.createElement('span'), { className: 'clip__mark', textContent: 'カプリ' });
    const pill = Object.assign(document.createElement('span'), { className: 'clip__pill', textContent: STATE[kind] || 'ONLINE' });
    const rec = Object.assign(document.createElement('span'), { className: 'clip__rec', textContent: 'REC 00:00' });
    el.append(scan, tab, mark, pill, rec);
    const length = !video && /\.gif$/i.test(clip.name)
      ? await fetch(url).then((r) => r.arrayBuffer()).then(gifLength).catch(() => 0)
      : 0;
    const ready = new Promise((resolve) => {
      media.addEventListener(video ? 'loadeddata' : 'load', resolve, { once: true });
      media.addEventListener('error', () => resolve(false), { once: true });
      setTimeout(() => resolve(false), 4000);
    });
    media.src = url;
    document.body.append(el);
    if ((await ready) === false) { // it didn't load: not a clip she can use
      el.remove();
      return false;
    }
    if (this.busy(kind, away, corner)) {
      el.remove();
      return false;
    }
    this.place(el, away, corner);
    el.style.visibility = '';
    el.classList.add('is-in');
    this.playing = el;
    const t0 = performance.now();
    const counter = setInterval(() => {
      const sec = Math.floor((performance.now() - t0) / 1000);
      rec.textContent = `REC ${pad2(Math.floor(sec / 60))}:${pad2(sec % 60)}`;
    }, 250);
    const shown = Math.min(MAX_SHOW, Math.max(MIN_SHOW, video ? (media.duration || 4) * 1000 : length || 4000));
    if (video) media.play?.().catch(() => {});
    await new Promise((r) => setTimeout(r, shown));
    clearInterval(counter);
    el.classList.remove('is-in');
    el.classList.add('is-out');
    await new Promise((r) => setTimeout(r, 200));
    el.remove();
    this.playing = null;
    return true;
  }

  // beside her, on the side toward the middle of the screen, standing on her floor; put away: over her small card, out of her biochip
  place(el, away = false, corner = false) {
    const { capri, panel, chip } = this;
    const view = capri.view;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x;
    let y;
    if (corner) { // the top left corner of the screen: with a game in front, away from her and from where the game's own bars are
      x = 20;
      y = 20;
    } else if (away && capri.stowed) {
      const r = panel.rect(); // her card, if it is up; else straight over the biochip
      const c = chip.center();
      const cx = r ? r.left + r.width / 2 : c.x;
      x = cx - w / 2;
      y = (r ? r.top : c.y - 62) - h - 10;
    } else {
      const s = capri.scale;
      const side = capri.pos.x > view.w / 2 ? -1 : 1;
      const reach = 80 * s;
      x = side > 0 ? capri.pos.x + reach : capri.pos.x - reach - w;
      y = capri.pos.y - h;
    }
    x = Math.min(Math.max(x, 12), view.w - w - 12);
    y = Math.min(Math.max(y, 12), view.h - h - 12);
    el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  }
}
