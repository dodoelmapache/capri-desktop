// While a screen clip is being recorded: a small bar at the top, in her interface, with the time, PAUSAR / SEGUIR and DETENER.
// (Her window is out of the clip unless you asked for her in it, and this bar is part of her window: out of the picture too.)
// It also gives the recorder what it did not have: pause and resume (MediaRecorder's), with the time limit counted only while it records.

import { Capturer } from './capture.js';

const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---- what the recorder lacked ----
const proto = Capturer.prototype;
if (!proto.pause) {
  proto.elapsedOf = function elapsedOf(rec) {
    if (!rec) return 0;
    const upTo = rec.paused ? rec.pauseAt : performance.now();
    return Math.max(0, (upTo - rec.began - (rec.pausedMs || 0)) / 1000);
  };
  Object.defineProperty(proto, 'paused', { get() { return Boolean(this.rec?.paused); } });
  proto.pause = function pause() {
    const rec = this.rec;
    if (!rec || rec.paused || rec.recorder.state !== 'recording') return false;
    try { rec.recorder.pause(); } catch { return false; }
    rec.paused = true;
    rec.pauseAt = performance.now();
    clearTimeout(rec.timer); // (the time limit is of what is recorded, not of the pause)
    return true;
  };
  proto.resume = function resume() {
    const rec = this.rec;
    if (!rec || !rec.paused) return false;
    try { rec.recorder.resume(); } catch { return false; }
    rec.pausedMs = (rec.pausedMs || 0) + (performance.now() - rec.pauseAt);
    rec.paused = false;
    const left = rec.limit - this.elapsedOf(rec);
    rec.timer = setTimeout(() => this.stop(), Math.max(1000, left * 1000));
    return true;
  };
  const finish = proto.finish;
  proto.finish = function finishWithoutPause(rec) { // (the length of the clip does not count the pauses)
    if (rec) rec.began = performance.now() - this.elapsedOf(rec) * 1000;
    return finish.call(this, rec);
  };
}

export class RecBar {
  constructor({ capture, getCfg, voice, onChange }) {
    Object.assign(this, { capture, getCfg, voice, onChange });
    this.shown = false;
    this.build();
    setInterval(() => this.tick(), 250);
  }

  build() {
    const el = document.createElement('aside');
    el.className = 'recbar';
    el.hidden = true;
    el.innerHTML = `
      <span class="recbar__dot"></span>
      <b class="recbar__state">REC</b>
      <span class="recbar__time">00:00</span>
      <small class="recbar__limit"></small>
      <button type="button" class="recbar__btn" data-act="pause">⏸&#xFE0E; PAUSAR</button>
      <button type="button" class="recbar__btn is-stop" data-act="stop">■&#xFE0E; DETENER</button>`;
    document.body.append(el);
    this.el = el;
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    el.querySelector('[data-act="pause"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.voice?.play('tick', { gain: 2.5 });
      if (this.capture.paused) this.capture.resume(); else this.capture.pause();
      this.tick();
    });
    el.querySelector('[data-act="stop"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.voice?.play('tick', { gain: 2.5 });
      this.capture.stop();
    });
  }

  contains(x, y, margin = 0) {
    if (this.el.hidden) return false;
    const r = this.el.getBoundingClientRect();
    return x >= r.left - margin && x <= r.right + margin && y >= r.top - margin && y <= r.bottom + margin;
  }

  tick() {
    const rec = this.capture.rec;
    if (!rec) {
      if (this.shown) { this.shown = false; this.el.hidden = true; this.onChange?.(); }
      return;
    }
    if (!this.shown) {
      this.shown = true;
      this.el.hidden = false;
      this.el.querySelector('.recbar__limit').textContent = `/ ${clock(rec.limit)}`;
      this.onChange?.();
    }
    const paused = this.capture.paused;
    this.el.classList.toggle('is-paused', paused);
    this.el.querySelector('.recbar__state').textContent = paused ? 'PAUSA' : 'REC';
    this.el.querySelector('.recbar__time').textContent = clock(this.capture.elapsedOf(rec));
    this.el.querySelector('[data-act="pause"]').innerHTML = paused ? '▶&#xFE0E; SEGUIR' : '⏸&#xFE0E; PAUSAR';
    const w = this.el.offsetWidth || 340;
    const view = window.innerWidth;
    this.el.style.transform = `translate3d(${Math.round((view - w) / 2)}px, 14px, 0)`;
  }
}
