// A small pill beside her that says she is taking in your voice, for when her chat is closed
// (with the chat open the bar already says ESCUCHANDO / TRANSCRIBIENDO). It follows her, says
// nothing else, and goes away by itself if the "done" cue never arrives.

const LABELS = {
  es: { listening: 'ESCUCHANDO', thinking: 'TRANSCRIBIENDO', speaking: 'HABLANDO' },
  en: { listening: 'LISTENING', thinking: 'TRANSCRIBING', speaking: 'SPEAKING' },
};
const FAILSAFE_MS = { listening: 12000, thinking: 25000, speaking: 60000 };
const MIC = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0V4A2.5 2.5 0 0 0 8 1.5zM3.5 7.5v.5a4.5 4.5 0 0 0 9 0v-.5h-1.3v.5a3.2 3.2 0 0 1-6.4 0v-.5zM7.35 12.4h1.3V15h-1.3z"/></svg>';

export class HearPill {
  constructor(panel, getCfg) {
    this.panel = panel;
    this.getCfg = getCfg;
    this.kind = null;
    this.timer = 0;
    this.raf = 0;
    this.el = document.createElement('div');
    this.el.className = 'hearpill';
    this.el.hidden = true;
    this.el.setAttribute('role', 'status');
    this.el.innerHTML = `<span class="hearpill__bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="hearpill__label"></span><span class="hearpill__mic">${MIC}</span>`;
    this.label = this.el.querySelector('.hearpill__label');
    document.body.append(this.el);
    this.follow = this.follow.bind(this);
  }

  // kind: 'listening' | 'thinking' | 'speaking' | null (gone)
  set(kind) {
    const cfg = this.getCfg?.() || {};
    if (kind && cfg.hearPill === false) kind = null;
    clearTimeout(this.timer);
    if (!kind) {
      this.kind = null;
      this.el.hidden = true;
      cancelAnimationFrame(this.raf);
      return;
    }
    const lang = String(cfg.lang || 'es').slice(0, 2);
    this.label.textContent = (LABELS[lang] || LABELS.en)[kind];
    this.el.dataset.kind = kind;
    this.kind = kind;
    this.el.hidden = false;
    this.timer = setTimeout(() => this.set(null), FAILSAFE_MS[kind]);
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.follow);
  }

  follow() {
    if (!this.kind) return;
    const { x, y, top: crown = y - 80 } = this.panel.anchor || {};
    const w = this.panel.view?.w || window.innerWidth;
    const pw = this.el.offsetWidth;
    const left = Math.min(Math.max(x - pw / 2, 8), w - pw - 8);
    const top = Math.max(8, crown - this.el.offsetHeight - 8);
    this.el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    this.raf = requestAnimationFrame(this.follow);
  }
}
