// Her wheel: a ring of buttons around the pointer (Ctrl+Alt+R, her menu, or a key of your macro keyboard that
// sends that). Your own apps, a "+" that adds one from what's installed, and the power buttons: sleep, restart,
// shut down. Right-click an app to take it off. Restart and shut down want a second click, and then leave
// 10 seconds to cancel (launch.js power). While it's open it takes the pointer and the keyboard: Esc closes it.

const MAX_APPS = 8;
const RADIUS = 112;      // from the middle to the middle of a button
const CONFIRM_MS = 5000; // a "restart?" waits this long for the second click
const PICK_ROWS = 8;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const plain = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
// "Google Chrome" -> "GC", "Spotify" -> "SP"
const initials = (name) => {
  const words = String(name || '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
};

// the power button: a drawing, because the symbol for it isn't in the fonts
function powerIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of [['viewBox', '0 0 24 24'], ['width', '22'], ['height', '22'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '2.4'], ['stroke-linecap', 'round']]) {
    svg.setAttribute(k, v);
  }
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M12 3v9M6.4 6.6a8 8 0 1 0 11.2 0');
  svg.append(path);
  return svg;
}

const iconKey = (app) => `${app.kind}:${app.id}`;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class Wheel {
  constructor({ host, panel, voice, brain, getCfg, keepFocus }) {
    this.host = host;
    this.panel = panel;
    this.voice = voice;
    this.brain = brain;
    this.getCfg = getCfg;
    this.keepFocus = keepFocus || (() => false); // her chat has the keyboard: don't take it away when this closes
    this.onChange = null; // (open) => void: app.js makes the overlay take the pointer, or lets go of it
    this.open = false;
    this.apps = [];
    this.catalog = null;
    this.hits = [];
    this.icons = new Map(); // 'kind:id' -> the app's icon (a data URL), or null when it has none to show
    this.center = { x: 0, y: 0 };
    this.confirming = null;
    this.confirmTimer = 0;

    this.root = el('div', 'wheel');
    this.root.hidden = true;
    this.backdrop = el('div', 'wheel__backdrop');
    this.backdrop.addEventListener('click', () => (this.picker.hidden ? this.close() : this.unpick()));
    this.backdrop.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.close();
    });
    this.ring = el('div', 'wheel__ring');
    this.hubLabel = el('span', 'wheel__label');
    this.hubHint = el('span', 'wheel__hint');
    this.hub = el('div', 'wheel__hub');
    this.hub.append(this.hubLabel, this.hubHint);
    this.ring.append(this.hub);

    this.picker = el('div', 'wheel__picker');
    this.picker.hidden = true;
    this.input = el('input', 'wheel__find');
    this.input.type = 'text';
    this.input.spellcheck = false;
    this.input.autocomplete = 'off';
    this.input.addEventListener('input', () => this.fillPicker());
    this.list = el('div', 'wheel__list');
    this.picker.append(this.input, this.list);

    this.root.append(this.backdrop, this.ring, this.picker);
    document.body.append(this.root);
    this.keys = (e) => this.onKey(e);
  }

  get t() {
    return this.brain.t.wheel;
  }

  toggle() {
    return this.open ? this.close() : this.show();
  }

  async show() {
    if (this.open) return;
    this.apps = [...(this.getCfg().wheelApps || [])].slice(0, MAX_APPS);
    for (const [key, icon] of this.icons) if (!icon) this.icons.delete(key); // the ones that had none are asked for again
    const p = await this.host.cursor().catch(() => null);
    const m = RADIUS + 70;
    this.center = {
      x: clamp(p?.inside ? p.x : innerWidth / 2, m, Math.max(m, innerWidth - m)),
      y: clamp(p?.inside ? p.y : innerHeight / 2, m, Math.max(m, innerHeight - m)),
    };
    this.open = true;
    this.root.hidden = false;
    this.picker.hidden = true;
    this.ring.hidden = false;
    this.render();
    this.host.focusOverlay(true); // the keyboard, for Esc and for searching apps
    this.onChange?.(true);
    window.addEventListener('keydown', this.keys);
    this.voice.play('blip');
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.root.hidden = true;
    this.unconfirm();
    window.removeEventListener('keydown', this.keys);
    if (!this.keepFocus()) this.host.focusOverlay(false);
    this.onChange?.(false);
  }

  // what's on the ring, in order: your apps, the "+", then the power buttons
  items() {
    const { t } = this;
    return [
      ...this.apps.map((app) => ({ type: 'app', label: app.name, glyph: initials(app.name), app })),
      ...(this.apps.length < MAX_APPS ? [{ type: 'add', label: t.add, glyph: '+' }] : []),
      { type: 'sleep', label: t.sleep, glyph: '☾', power: true },
      { type: 'restart', label: t.restart, glyph: '↻', power: true },
      { type: 'off', label: t.off, glyph: '⏻\uFE0E', power: true },
    ];
  }

  render() {
    this.ring.style.left = `${this.center.x}px`;
    this.ring.style.top = `${this.center.y}px`;
    this.resetHub();
    for (const old of this.ring.querySelectorAll('.wheel__item')) old.remove();
    const items = this.items();
    const buttons = items.map((item, i) => {
      const angle = (i / items.length) * Math.PI * 2 - Math.PI / 2; // from the top, clockwise
      const x = Math.round(Math.cos(angle) * RADIUS);
      const y = Math.round(Math.sin(angle) * RADIUS);
      const button = el('button', `wheel__item${item.power ? ' is-power' : ''}`);
      button.type = 'button';
      button.setAttribute('aria-label', item.label);
      button.dataset.type = item.type;
      const glyph = el('span', 'wheel__glyph');
      glyph.append(this.glyphOf(item));
      button.append(glyph);
      button._item = item;
      button.style.transform = 'translate(0px, 0px) scale(0.3)'; // they open out from the middle
      button.addEventListener('mouseenter', () => this.hover(item));
      button.addEventListener('mouseleave', () => this.resetHub());
      button.addEventListener('focus', () => this.hover(item));
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        this.press(item, button);
      });
      button.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (item.type === 'app') this.remove(item.app);
      });
      this.ring.append(button);
      return { button, x, y };
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      for (const { button, x, y } of buttons) {
        button.classList.add('is-in');
        button.style.transform = `translate(${x}px, ${y}px)`;
      }
    }));
    this.loadIcons(this.apps);
  }

  // an app's icon when it's known, else its letters; the power button is drawn
  glyphOf(item) {
    if (item.type === 'off') return powerIcon();
    const icon = item.type === 'app' ? this.icons.get(iconKey(item.app)) : null;
    return icon ? this.iconImage(icon, 'wheel__icon') : document.createTextNode(item.glyph);
  }

  iconImage(src, className) {
    const img = el('img', className);
    img.src = src;
    img.alt = '';
    img.draggable = false;
    return img;
  }

  // The Start menu's icons for these apps (launch.js), asked for once each; what comes back is painted on
  // their buttons, and what has none keeps its letters.
  async loadIcons(apps) {
    const missing = apps.filter((a) => a.kind === 'app' && !this.icons.has(iconKey(a)));
    if (!missing.length) return;
    const found = await this.host.appIcons(missing).catch(() => ({}));
    for (const a of missing) this.icons.set(iconKey(a), found?.[iconKey(a)] || null);
    if (!this.open) return;
    for (const button of this.ring.querySelectorAll('.wheel__item')) {
      const item = button._item;
      if (item?.type === 'app' && this.icons.get(iconKey(item.app))) button.querySelector('.wheel__glyph').replaceChildren(this.glyphOf(item));
    }
  }

  hover(item) {
    if (this.confirming) return;
    this.hubLabel.textContent = item.label;
    this.hubHint.textContent = item.type === 'app' ? this.t.hintRemove : '';
  }

  resetHub() {
    this.hubLabel.textContent = this.confirming ? this.confirmText() : '';
    this.hubHint.textContent = '';
  }

  confirmText() {
    return this.confirming === 'restart' ? this.t.confirmRestart : this.t.confirmOff;
  }

  unconfirm() {
    clearTimeout(this.confirmTimer);
    this.confirming = null;
    for (const b of this.ring.querySelectorAll('.is-confirm')) b.classList.remove('is-confirm');
    this.resetHub();
  }

  async press(item, button) {
    const { t } = this;
    if (item.type === 'add') return this.pick();
    if (item.type === 'app') {
      this.voice.play('tick', { gain: 2.5 });
      this.close();
      const res = await this.host.launch({ kind: item.app.kind, id: item.app.id }).catch(() => ({ ok: false }));
      if (!res?.ok) this.panel.say({ kind: 'info', face: 'aside', line: t.failed, hold: 4000 });
      return undefined;
    }
    if (item.type === 'sleep') {
      this.close();
      return this.host.power('sleep');
    }
    // restart and shut down: the second click on the same button
    if (this.confirming !== item.type) {
      this.unconfirm();
      this.confirming = item.type;
      button.classList.add('is-confirm');
      this.hubLabel.textContent = this.confirmText();
      this.hubHint.textContent = '';
      this.confirmTimer = setTimeout(() => this.unconfirm(), CONFIRM_MS);
      return undefined;
    }
    const shutdown = item.type === 'off';
    this.close();
    if (await this.host.power(shutdown ? 'shutdown' : 'restart')) {
      this.panel.say({
        kind: 'alert',
        face: 'wide',
        line: shutdown ? t.shuttingDown : t.restarting,
        actions: [{ id: 'cancel', label: t.cancel, primary: true }],
        onAction: async () => {
          await this.host.power('cancel');
          this.panel.say({ kind: 'info', face: 'smug', line: t.cancelled, hold: 3000 });
        },
        hold: 10000,
      });
    }
    return undefined;
  }

  async remove(app) {
    this.apps = this.apps.filter((a) => !(a.kind === app.kind && a.id === app.id));
    await this.host.setConfig({ wheelApps: this.apps });
    this.render();
  }

  // ---- adding an app: a search over what's installed, in place of the ring for a moment ----

  async pick() {
    this.catalog ??= await this.host.launchables().catch(() => []);
    this.unconfirm();
    this.ring.hidden = true;
    this.picker.hidden = false;
    this.picker.style.left = `${clamp(this.center.x - 160, 16, Math.max(16, innerWidth - 336))}px`;
    this.picker.style.top = `${clamp(this.center.y - 150, 16, Math.max(16, innerHeight - 330))}px`;
    this.input.placeholder = this.t.search;
    this.input.value = '';
    this.fillPicker();
    this.input.focus();
  }

  unpick() {
    this.picker.hidden = true;
    this.ring.hidden = false;
  }

  fillPicker() {
    const query = plain(this.input.value).trim();
    const taken = new Set(this.apps.map((a) => `${a.kind}:${a.id}`));
    this.hits = (this.catalog || [])
      .filter((a) => !taken.has(`${a.kind}:${a.id}`) && (!query || plain(a.name).includes(query)))
      .sort((a, b) => Number(plain(b.name).startsWith(query)) - Number(plain(a.name).startsWith(query)) || a.name.localeCompare(b.name))
      .slice(0, PICK_ROWS);
    this.paintRows();
    const hits = this.hits;
    this.loadIcons(hits).then(() => {
      if (this.hits === hits) this.paintRows(); // the icons came in after the names
    });
  }

  paintRows() {
    this.list.replaceChildren(...(this.hits.length
      ? this.hits.map((app) => {
        const row = el('button', 'wheel__pick');
        row.type = 'button';
        const icon = this.icons.get(iconKey(app));
        row.append(icon ? this.iconImage(icon, 'wheel__pickicon') : el('span', 'wheel__pickicon'), el('span', 'wheel__pickname', app.name));
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          this.add(app);
        });
        return row;
      })
      : [el('p', 'wheel__none', this.t.none)]));
  }

  async add(app) {
    if (this.apps.length >= MAX_APPS) return;
    this.apps = [...this.apps, { name: app.name, kind: app.kind, id: app.id }];
    await this.host.setConfig({ wheelApps: this.apps });
    this.unpick();
    this.render();
  }

  onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this.picker.hidden) this.close();
      else this.unpick();
    } else if (e.key === 'Enter' && !this.picker.hidden && this.hits[0]) {
      e.preventDefault();
      this.add(this.hits[0]);
    }
  }
}
