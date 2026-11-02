// Her player card: what plays on your PC (your music, a video in the browser...), as a card of its own with the cover, the title, a bar of how far it is
// and its buttons, bigger than the small strip inside her chat card. Two ways to have it:
//   - fixed (the default): under her main card, beside her (where the chat is, her models and the buttons)
//   - loose: you take it by its bar and put it where you want (a corner...); it stays there. "Fijar" puts it back under her card.
// It can be hidden (✕) and shown again from her menu, her chat's REPRODUCTOR button, or by saying "muestra el reproductor".

const POLL_MS = 3000;
const WIDTH = 350;
const GAP = 12;
const pad2 = (n) => String(n).padStart(2, '0');
const clock = (sec) => `${Math.floor(sec / 60)}:${pad2(Math.floor(sec % 60))}`;

export class PlayerCard {
  constructor({ host, capri, panel, voice, getConfig, pickCards }) {
    Object.assign(this, { host, capri, panel, voice, getConfig, pickCards });
    this.cards = [];
    this.index = 0; // which of the things that play it shows (a button switches, when there are two)
    this.art = new Map(); // app|title -> picture (data URL) or null
    this.artTries = new Map(); // app|title -> how many times its picture was asked for, and when
    this.asking = new Set();
    this.polled = 0;
    this.busy = false;
    this.dragging = false;
    this.flashUntil = 0; // after a media key: the card shows itself until then, even with no card above it
    this.playing = new Set(); // which sources were playing at the last look (kind|app): to know which one has just started
    this.pickedAt = 0; // when you last chose a source yourself with ⇄
    this.at = 0; // when the last look at the sessions was
    this.build();
    setInterval(() => this.tick(), 500);
    setInterval(() => this.place(), 120);
  }

  // ---- state kept in her config ---------------------------------------------------------------
  get cfg() { return this.getConfig() || {}; }
  get enabled() { return this.cfg.playerCard !== false; }
  get hidden() { return Boolean(this.cfg.playerHidden); }
  get loose() { return Boolean(this.cfg.playerFloat); }
  get pos() { return this.cfg.playerPos || null; }
  save(patch) { this.host.setConfig(patch); }

  // a media key of the keyboard: the source on the card does it (what plays, else your music), and the card shows itself for a few seconds
  async mediaKey(action) {
    this.voice?.play('tick', { gain: 2.5 });
    const show = () => { if (this.enabled && !this.hidden) this.flashUntil = performance.now() + 3600; };
    show(); // first: the sources are only read while the card is wanted, so with her put away there would be nothing to show
    if (!this.cards.length || performance.now() - this.at > 4000) await this.tick(true);
    const c = this.card;
    if (action === 'toggle' && c) { c.playing = !c.playing; c.age = 0; this.at = performance.now(); } // (the card already says what the key does; the player confirms a moment later)
    show(); // (at once, like Windows' own: in the top right corner, whatever she is doing)
    this.render();
    await this.host.nowControl(action, c?.target || null);
    show();
    setTimeout(() => this.tick(true), 350); // (the new state: paused, or the next song)
    setTimeout(() => this.tick(true), 1100);
  }

  command(action) { // "muestra el reproductor", "esconde el reproductor", "fija / suelta el reproductor"
    if (action === 'show') this.save({ playerHidden: false, playerCard: true });
    else if (action === 'hide') this.save({ playerHidden: true });
    else if (action === 'toggle') this.save({ playerHidden: !this.hidden, playerCard: true });
    else if (action === 'dock') this.save({ playerFloat: false });
    else if (action === 'float') this.floatHere();
    this.cfgNow = { ...this.cfg }; // (the config comes back a moment later: act on what was asked at once)
    this.tick(true);
  }

  // ---- the element ------------------------------------------------------------------------------
  build() {
    const el = document.createElement('aside');
    el.className = 'player';
    el.hidden = true;
    el.innerHTML = `
      <div class="player__plate">
        <header class="player__bar">
          <span class="player__label">AHORA SUENA</span>
          <span class="player__app"></span>
          <button type="button" class="player__btn player__pin" title="Fijar bajo su tarjeta / soltar"></button>
          <button type="button" class="player__btn player__x" title="Esconder">✕</button>
        </header>
        <div class="player__body">
          <div class="player__art"><img alt="" draggable="false" hidden><span class="player__note">♪</span></div>
          <div class="player__info">
            <b class="player__title"></b>
            <span class="player__artist"></span>
            <span class="player__status"></span>
          </div>
        </div>
        <div class="player__time">
          <small class="player__now">0:00</small>
          <div class="player__track" title="Pulsa para ir a ese punto"><i></i><b></b></div>
          <small class="player__left">0:00</small>
        </div>
        <div class="player__ctl">
          <button type="button" class="player__btn" data-id="previous" title="Anterior">⏮&#xFE0E;</button>
          <button type="button" class="player__btn is-main" data-id="toggle" title="Pausa / reproducir">⏯&#xFE0E;</button>
          <button type="button" class="player__btn" data-id="next" title="Siguiente">⏭&#xFE0E;</button>
          <span class="player__gap"></span>
          <button type="button" class="player__btn player__shuffle" data-id="shuffle" title="Aleatorio: activar o quitar">🔀&#xFE0E;</button>
          <button type="button" class="player__btn" data-id="voldown" title="Bajar volumen">🔉&#xFE0E;</button>
          <button type="button" class="player__btn" data-id="volup" title="Subir volumen">🔊&#xFE0E;</button>
          <button type="button" class="player__btn player__switch" data-id="switch" title="Cambiar entre lo que suena" hidden>⇄</button>
          <button type="button" class="player__btn" data-id="pauseother" title="Pausar lo otro que suena" hidden>⏸ OTRO</button>
        </div>
        <div class="player__others" hidden></div>
      </div>`;
    document.body.append(el);
    this.el = el;
    this.q = (s) => el.querySelector(s);
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    this.q('.player__x').addEventListener('click', () => this.command('hide'));
    this.q('.player__pin').addEventListener('click', () => (this.loose ? this.command('dock') : this.command('float')));
    for (const b of el.querySelectorAll('.player__ctl [data-id]')) {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.press(b.dataset.id);
      });
    }
    this.q('.player__track').addEventListener('click', (e) => {
      const c = this.card;
      if (!c?.dur) return;
      const r = e.currentTarget.getBoundingClientRect();
      const to = Math.max(0, Math.min(c.dur, ((e.clientX - r.left) / r.width) * c.dur));
      c.pos = to; // (the bar is already there: the player says so a moment later)
      c.age = 0;
      this.at = performance.now();
      this.progress();
      this.host.nowControl('seek', c.target, to);
    });
    this.drag();
  }

  // the bar is the handle: take it and the card is loose, wherever you leave it
  drag() {
    const bar = this.q('.player__bar');
    let from = null;
    bar.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      const r = this.el.getBoundingClientRect();
      from = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      this.dragging = true;
      this.el.classList.add('is-dragging');
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!from) return;
      const pos = this.clampPos({ x: e.clientX - from.dx, y: e.clientY - from.dy });
      this.cfgNow = { ...this.cfg, playerFloat: true, playerPos: pos };
      this.el.style.transform = `translate3d(${Math.round(pos.x)}px, ${Math.round(pos.y)}px, 0)`;
      this.dragPos = pos;
      this.paintPin(true);
    });
    window.addEventListener('mouseup', () => {
      if (!from) return;
      from = null;
      this.dragging = false;
      this.el.classList.remove('is-dragging');
      if (this.dragPos) this.save({ playerFloat: true, playerPos: { x: Math.round(this.dragPos.x), y: Math.round(this.dragPos.y) } });
      this.dragPos = null;
    });
  }

  // loose, from where it is now (so it does not jump)
  floatHere() {
    const r = this.el.getBoundingClientRect();
    const pos = this.clampPos({ x: r.left, y: r.top });
    this.save({ playerFloat: true, playerPos: { x: Math.round(pos.x), y: Math.round(pos.y) } });
  }

  clampPos({ x, y }) {
    const view = this.capri.view;
    const w = this.el.offsetWidth || WIDTH;
    const h = this.el.offsetHeight || 160;
    return { x: Math.min(Math.max(x, 6), Math.max(6, view.w - w - 6)), y: Math.min(Math.max(y, 6), Math.max(6, view.h - h - 6)) };
  }

  // ---- what to show ------------------------------------------------------------------------------
  // docked: only while the card above (her chat, or the one for when you click her) is up; loose: always, while something plays
  wanted() {
    if (!this.enabled || this.hidden) return false;
    if (this.loose) return true;
    if (performance.now() < this.flashUntil) return true; // (a media key: also with her resting in her corner)
    return this.baseWanted();
  }

  // without the key's flash: only because her chat or her card is up (or it is loose)
  baseWanted() {
    if (!this.enabled || this.hidden) return false;
    if (this.loose) return true;
    const cur = this.panel.current;
    return Boolean(this.panel.visible && (cur?.chat || cur?.nowStrip) && !this.capri.stowed);
  }

  contains(x, y, margin = 0) {
    if (this.el.hidden) return false;
    const r = this.el.getBoundingClientRect();
    return x >= r.left - margin && x <= r.right + margin && y >= r.top - margin && y <= r.bottom + margin;
  }

  async tick(force = false) {
    const want = this.wanted();
    if (!want) {
      if (!this.el.hidden) this.el.hidden = true;
      this.flashPlaced = false;
      return;
    }
    const now = performance.now();
    if (!force && (this.busy || now - this.polled < POLL_MS)) {
      this.progress();
      return;
    }
    this.busy = true;
    this.polled = now;
    const list = await this.host.nowSessions().catch(() => []);
    this.busy = false;
    this.at = performance.now();
    const before = this.card ? `${this.card.kind}|${this.card.appId}` : '';
    this.cards = this.pickCards(list);
    // two things can play at once (a video in a tab and your music): the card follows the one that has just started, unless you chose with ⇄ a moment ago
    const nowSet = new Set(this.cards.filter((c) => c.playing).map((c) => `${c.kind}|${c.appId}`));
    const started = this.cards.findIndex((c) => c.playing && !this.playing.has(`${c.kind}|${c.appId}`));
    this.playing = nowSet;
    if (this.cards.length > 1 && performance.now() - this.pickedAt > 20000) {
      if (started >= 0 && this.playing.size > 0 && before) this.index = started;
      else {
        const keep = this.cards.findIndex((c) => `${c.kind}|${c.appId}` === before);
        if (keep >= 0 && this.cards[keep].playing) this.index = keep; // (what it showed is still playing: it stays)
        else this.index = Math.max(0, this.cards.findIndex((c) => c.playing)); // (else, the one that plays)
      }
    }
    if (this.index >= this.cards.length) this.index = 0;
    this.render();
  }

  get card() { return this.cards[this.index] || null; }

  render() {
    const c = this.card;
    if (!c || !this.wanted()) {
      this.el.hidden = true;
      this.flashPlaced = false;
      return;
    }
    const wasHidden = this.el.hidden;
    this.el.hidden = false;
    this.q('.player__app').textContent = c.app || '';
    this.q('.player__title').textContent = c.title;
    this.q('.player__title').title = c.title;
    this.q('.player__artist').textContent = c.artist || (c.kind === 'video' ? 'Video' : '');
    this.q('[data-id="toggle"]').textContent = `${c.playing ? '⏸' : '▶'}\uFE0E`;
    this.q('.player__switch').hidden = this.cards.length < 2;
    this.renderOthers();
    const others = this.cards.filter((x) => x !== c && x.playing);
    this.q('.player__status').textContent = c.playing ? (others.length ? `TAMBIÉN SUENA: ${others[0].app || others[0].kind}` : '') : 'EN PAUSA';
    this.q('[data-id="pauseother"]').hidden = !others.length;
    this.el.classList.toggle('is-paused', !c.playing);
    this.el.classList.toggle('is-video', c.kind === 'video');
    this.paintPin(this.loose);
    this.paintArt(c);
    this.progress();
    if (wasHidden) {
      this.el.classList.remove('is-in');
      void this.el.offsetWidth;
      this.el.classList.add('is-in');
    }
    this.place();
  }

  // every other thing that plays or is paused (a video in a tab and your music): a row each with its own ⏮ ⏯ ⏭, as Windows' list does; pressing its name makes it the main one
  renderOthers() {
    const box = this.q('.player__others');
    const others = this.cards.map((c, i) => ({ c, i })).filter(({ i }) => i !== this.index);
    box.hidden = !others.length;
    const sig = others.map(({ c }) => `${c.appId}|${c.title}|${c.playing}`).join('~');
    if (box.dataset.sig === sig) return; // (nothing changed: the buttons are not rebuilt under the pointer)
    box.dataset.sig = sig;
    box.replaceChildren(...others.map(({ c, i }) => {
      const row = document.createElement('div');
      row.className = c.playing ? 'player__row is-on' : 'player__row';
      const name = document.createElement('button');
      name.type = 'button';
      name.className = 'player__rname';
      name.title = 'Controlar este';
      const app = document.createElement('small');
      app.textContent = [c.app, c.playing ? 'SUENA' : 'EN PAUSA'].filter(Boolean).join(' · ');
      const title = document.createElement('b');
      title.textContent = c.title;
      name.append(app, title);
      name.addEventListener('click', (e) => {
        e.stopPropagation();
        this.index = i;
        this.pickedAt = performance.now();
        this.render();
      });
      row.append(name);
      for (const [act, label] of [['previous', '⏮'], ['toggle', c.playing ? '⏸' : '▶'], ['next', '⏭']]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'player__btn player__rbtn';
        b.textContent = `${label}\uFE0E`;
        b.addEventListener('click', async (e) => {
          e.stopPropagation();
          this.voice?.play('tick', { gain: 2.5 });
          await this.host.nowControl(act, c.target);
          setTimeout(() => this.tick(true), 600);
        });
        row.append(b);
      }
      return row;
    }));
  }

  paintPin(loose) {
    const pin = this.q('.player__pin');
    pin.textContent = loose ? 'FIJAR' : 'SOLTAR';
    pin.title = loose ? 'Volver bajo su tarjeta' : 'Soltarla para moverla donde quieras';
  }

  paintArt(c) {
    const key = `${c.appId}|${c.title}`;
    const img = this.q('.player__art img');
    const note = this.q('.player__note');
    const src = this.art.get(key);
    if (src) {
      if (img.src !== src) img.src = src;
      img.hidden = false;
      note.hidden = true;
    } else {
      img.hidden = true;
      note.hidden = false;
      note.textContent = c.kind === 'video' ? '▣' : '♪';
      // asked for the first time, and again (a few times, a few seconds apart) if the player had not put its cover up yet
      const tries = this.artTries.get(key) || { n: 0, at: 0 };
      if (!this.asking.has(key) && tries.n < 4 && performance.now() - tries.at > 4000) {
        this.artTries.set(key, { n: tries.n + 1, at: performance.now() });
        this.asking.add(key);
        if (this.art.size > 40) this.art.delete(this.art.keys().next().value);
        this.host.nowArt?.(c.target).then((art) => {
          this.asking.delete(key);
          if (!art) return;
          this.art.set(key, art);
          if (this.card && `${this.card.appId}|${this.card.title}` === key) this.paintArt(this.card);
        }).catch(() => this.asking.delete(key));
      }
    }
  }

  // the bar: where it was when the player last said so, plus what has gone by since (the player says its position when something changes, not every
  // second), moving on by itself while it plays; the time gone on the left and what is left on the right
  progress() {
    const c = this.card;
    if (!c) return;
    const track = this.q('.player__track');
    const time = this.q('.player__time');
    if (!c.dur) {
      time.hidden = true;
      return;
    }
    time.hidden = false;
    const gone = c.playing ? c.age + (performance.now() - this.at) / 1000 : c.age * 0; // (paused: where it stopped)
    const pos = Math.min(c.dur, Math.max(0, c.pos + gone));
    const k = pos / c.dur;
    this.q('.player__track i').style.transform = `scaleX(${k.toFixed(4)})`;
    this.q('.player__track b').style.left = `${(k * 100).toFixed(2)}%`;
    this.q('.player__now').textContent = clock(pos);
    this.q('.player__left').textContent = `-${clock(Math.max(0, c.dur - pos))}`;
    track.classList.toggle('is-paused', !c.playing);
  }

  async press(id) {
    this.voice?.play('tick', { gain: 2.5 });
    if (id === 'switch') {
      this.index = (this.index + 1) % Math.max(1, this.cards.length);
      this.pickedAt = performance.now();
      this.render();
      return;
    }
    if (id === 'pauseother') { // two things at once: the other one is paused, this one goes on
      for (const o of this.cards.filter((x) => x !== this.card && x.playing)) await this.host.nowControl('toggle', o.target);
      setTimeout(() => this.tick(true), 900);
      return;
    }
    if (id === 'shuffle') {
      const btn = this.q('.player__shuffle');
      btn.textContent = '…';
      const res = await this.host.ytmShuffle?.('bar', this.card?.target).catch(() => null);
      // the player's own shuffle says whether it is on now; YouTube Music's window button only toggles
      btn.textContent = res?.ok ? (res.on === true ? 'SÍ' : res.on === false ? 'NO' : 'OK') : '✕'; // (on / off / done / could not)
      btn.classList.toggle('is-on', Boolean(res?.ok && res.on === true));
      setTimeout(() => { btn.textContent = '🔀\uFE0E'; }, 1800);
      return;
    }
    if (id === 'volup' || id === 'voldown') {
      await this.host.media?.(id);
      return;
    }
    await this.host.nowControl(id, this.card?.target); // that session, and no other
    setTimeout(() => this.tick(true), 900);
  }

  // ---- where it is -------------------------------------------------------------------------------
  place() {
    if (this.el.hidden || this.dragging) return;
    const view = this.capri.view;
    const w = Math.min(WIDTH, view.w - 12);
    this.el.style.width = `${w}px`;
    // her main card grown big (a long answer, her report): the player does not pile up on it. By default it shrinks to a slim bar (title and ⏮ ⏯ ⏭);
    // config playerBigCard: 'hide' hides it meanwhile (not turned off), 'show' leaves it as it is. Docked only: a loose one, or a key's card, stay as they are.
    const card = this.panel.rect();
    const cardH = card ? card.bottom - card.top : 0;
    const docked = !this.loose && performance.now() >= this.flashUntil && !this.flashPlaced;
    const bigMode = this.cfg.playerBigCard || 'compact';
    this.bigCard = docked && Boolean(card) && bigMode !== 'show' && (this.bigCard ? cardH > 380 : cardH > 430); // (two limits, so it does not flicker while the text grows)
    this.el.classList.toggle('is-compact', this.bigCard && bigMode === 'compact');
    this.el.classList.toggle('is-away', this.bigCard && bigMode === 'hide');
    const h = this.el.offsetHeight || 160;
    let x;
    let y;
    const pos = this.pos;
    // a media key's card stays in the corner until it is gone: no jump back to her card on the way out
    const flashing = !this.loose && (performance.now() < this.flashUntil || (this.flashPlaced && !this.baseWanted()));
    this.flashPlaced = flashing;
    if (flashing) {
      x = view.w - w - 18; // a media key: the card on its own, top right, as Windows' flyout does
      y = 18;
    } else if (this.loose && pos) {
      ({ x, y } = this.clampPos(pos)); // (a corner stays a corner, even if the screen changed)
    } else {
      // under her main card, beside her (not over her): on the side toward the middle of the screen
      const r = this.panel.rect();
      const s = this.capri.scale;
      const side = this.capri.pos.x > view.w / 2 ? -1 : 1;
      const beside = 90 * s;
      x = side > 0 ? this.capri.pos.x + beside : this.capri.pos.x - beside - w;
      // above her main card (it is tall now: below it, it covered the chat); under it only when there is no room above
      if (r) {
        y = r.top - h - GAP;
        if (y < 6) y = r.bottom + GAP + 14;
        x = r.left; // aligned to the left edge of her main card, as a stack (not centred beside it)
      } else {
        y = this.capri.head().y - h - GAP;
      }
      x = Math.min(Math.max(x, 6), view.w - w - 6);
      y = Math.min(Math.max(y, 6), view.h - h - 6);
    }
    this.el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  }
}
