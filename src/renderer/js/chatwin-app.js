// Her conversation window: the list of conversations on the left, the messages on the right (scroll, select, copy), and a
// box to write in that grows. Who answers is picked above it: her own model, or a Claude (Haiku, Sonnet, Opus).

import { parse, render } from './md.js';
import { imageAsk, imageEditAsk, imageEditFollow, paletteAsk } from './intents.js';
import { ui } from './uisound.js';
import { limitLine } from './usagefmt.js';

const TEXT = {
  es: {
    fresh: '+ Nueva', find: 'Buscar conversaciones…', untitled: '(sin título)', send: 'Enviar', stop: 'Detener',
    placeholder: 'Escribe tu mensaje…', engine: 'Responde', local: 'Capri (local)', web: 'Internet',
    hint: 'Enter envía · Shift+Enter salto de línea · arrastra o pega archivos e imágenes aquí', drop: 'Suelta para adjuntar',
    you: 'Tú', capri: 'Capri', copy: 'Copiar', copied: 'Copiado', copyCode: 'Copiar', open: 'Abrir', reveal: 'Ver carpeta', sure: '¿Borrar?',
    working: 'Claude está trabajando… si necesita permiso, sale una tarjeta de Capri', thinking: 'Pensando', stopped: '(detenido)',
    startTitle: 'Conversación nueva', start: 'Escribe abajo. Arriba eliges quién responde: Capri con tu modelo local (gratis) o un Claude (Haiku para lo rápido, Sonnet para lo normal, Opus para lo difícil).',
    needClaude: (names) => `Esto necesita Claude: mi modelo local no puede abrir ${names}. Elige Haiku, Sonnet u Opus arriba y vuelve a enviarlo.`,
    failedLocal: (e) => `No pude hablar con el modelo local: ${e}. Elige un Claude arriba, o enciende Ollama.`, failed: (e) => `No salió: ${e}`,
    note: (model) => `Local: ${model || 'sin modelo'} · gratis, en tu PC.\nClaude: gasta de tu límite, recuerda cada conversación por separado.`, look: 'Mira esto.',
    filesLabel: 'Archivos', files: 'archivos', empty: 'Aún no hay conversaciones.', none: 'Nada coincide.',
    edit: 'Editar', editHint: 'Qué le cambio a esta imagen…', palette: 'Paleta', paletteFail: 'No pude leer los colores de esa imagen.', paletteOf: (n) => `${n} colores, del que más hay al que menos. Ya los copié todos; toca uno para copiar solo ese.`,
    image: 'Imagen', imageHint: 'Describe la imagen que quieres…', imageWorking: 'Pidiéndosela a Nano Banana… tarda unos segundos', again: 'Otra versión',
    failedImg: (e) => `No salió la imagen: ${e}`, onLocal: 'LOCAL', onClaude: 'CLAUDE',
    design: 'Design', designHint: 'Abre Claude Design en la app de Claude.',
    listening: 'ESCUCHANDO…', transcribing: 'TRANSCRIBIENDO…', noMic: 'No pude abrir el micrófono. Revisa Configuración › Privacidad › Micrófono.', noStt: 'Para oírte necesito una clave de Groq u OpenAI (config.json › apiKeys) o el Whisper local instalado.', heardNothing: 'No te escuché. Prueba otra vez.', micTip: 'Hablarle a Capri',
  },
  en: {
    fresh: '+ New', find: 'Search conversations…', untitled: '(untitled)', send: 'Send', stop: 'Stop',
    placeholder: 'Write your message…', engine: 'Answers', local: 'Capri (local)', web: 'Internet',
    hint: 'Enter sends · Shift+Enter new line · drag or paste files and pictures here', drop: 'Drop to attach',
    you: 'You', capri: 'Capri', copy: 'Copy', copied: 'Copied', copyCode: 'Copy', open: 'Open', reveal: 'Show folder', sure: 'Delete?',
    working: 'Claude is working… if it needs permission, a Capri card appears', thinking: 'Thinking', stopped: '(stopped)',
    startTitle: 'New conversation', start: 'Write below. Up top you choose who answers: Capri on your local model (free) or a Claude (Haiku for quick, Sonnet for normal, Opus for hard).',
    needClaude: (names) => `This needs Claude: my local model cannot open ${names}. Pick Haiku, Sonnet or Opus above and send it again.`,
    failedLocal: (e) => `I could not reach the local model: ${e}. Pick a Claude above, or turn Ollama on.`, failed: (e) => `It did not work: ${e}`,
    note: (model) => `Local: ${model || 'no model'} · free, on your PC.\nClaude: spends your limit, remembers each conversation separately.`, look: 'Take a look at this.',
    filesLabel: 'Files', files: 'files', empty: 'No conversations yet.', none: 'Nothing matches.',
    edit: 'Edit', editHint: 'What should I change in this picture…', palette: 'Palette', paletteFail: "I couldn't read the colours of that picture.", paletteOf: (n) => `${n} colours, most to least present. All copied; press one to copy just that.`,
    image: 'Image', imageHint: 'Describe the image you want…', imageWorking: 'Asking Nano Banana… a few seconds', again: 'Another one',
    failedImg: (e) => `No image: ${e}`, onLocal: 'LOCAL', onClaude: 'CLAUDE',
    design: 'Design', designHint: 'Opens Claude Design in the Claude app.',
    listening: 'LISTENING…', transcribing: 'TRANSCRIBING…', noMic: 'I cannot open the microphone. Check Settings › Privacy › Microphone.', noStt: 'To hear you I need a Groq or OpenAI key (config.json › apiKeys) or the local Whisper installed.', heardNothing: 'I did not hear you. Try again.', micTip: 'Talk to Capri',
  },
};

const uuid = () => globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0;
  return (c === 'x' ? r : (r & 3) | 8).toString(16);
});

// her faces, as in the bubble: the one she shows follows what she says
const FACE_DIR = '../../assets/capri/';
const FACES = { calm: 'face-calm.png', aside: 'face-aside.png', smug: 'face-smug.png', wide: 'face-wide.png', look: 'face-look.png', laugh: 'face-laugh.png', many: 'face-many.png', grin: 'capri-face.png' };
export function moodOf(text) {
  if (/(ha){2,}|lol|jaja|kkk/i.test(text)) return 'laugh';
  if (text.includes('!')) return 'grin';
  if (text.trim().endsWith('?')) return 'smug';
  return 'look';
}
const IMAGE_FILE = /\.(png|jpe?g|webp|gif|bmp)$/i;

const linksIn = (text) => [...new Set(String(text).match(/https?:\/\/[^\s<>"')\]]+/gi) || [])].slice(0, 3);
const stripFiles = (text) => String(text).replace(/\bFILES?:[ \t]*[^\n]*/g, '').replace(/\n{3,}/g, '\n\n').trimEnd(); // the FILES line is for buttons, not for reading

export function whenOf(ms, lang, nowMs = Date.now()) {
  const d = new Date(ms);
  const now = new Date(nowMs);
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  const en = lang === 'en';
  if (days <= 0) return `${en ? 'today' : 'hoy'} ${d.toLocaleTimeString(en ? 'en-US' : 'es-CO', { hour: 'numeric', minute: '2-digit' })}`;
  if (days === 1) return en ? 'yesterday' : 'ayer';
  return d.toLocaleDateString(en ? 'en-US' : 'es-CO', { day: 'numeric', month: 'short' });
}

export function createApp({ doc, cw, info, voice = null, now = () => Date.now() }) {
  const T = TEXT[info.lang === 'en' ? 'en' : 'es'];
  // her look (hud: the red HUD details of chatwin-hud.css; classic: as she was), from her menu
  const applyLook = (look) => { if (doc.documentElement) doc.documentElement.dataset.look = look === 'classic' ? 'classic' : 'hud'; };
  applyLook(info.look);
  cw.onLook?.(applyLook);
  const $ = (id) => doc.getElementById(id);
  const els = {
    list: $('list'), thread: $('thread'), input: $('input'), send: $('send'), stop: $('stop'), plus: $('plus'), chips: $('chips'), find: $('find'),
    fresh: $('new'), title: $('title'), web: $('web'), webWrap: $('webWrap'), jump: $('jump'), engine: $('engine'), engineLabel: $('engineLabel'),
    webLabel: $('webLabel'), hint: $('hint'), note: $('engineNote'), imageMode: $('imageMode'), topFace: $('topFace'), mic: $('mic'), app: doc.querySelector?.('.app') || null, composer: $('composer'), designTab: $('designTab'),
  };
  // the last picture she made in this conversation (what "ahora hazla azul" refers to), and the readable colour on top of one
  const recentImage = (s) => {
    const ms = s?.messages || [];
    for (let i = ms.length - 1; i >= Math.max(0, ms.length - 8); i--) if (ms[i].role === 'assistant' && ms[i].via === 'image' && ms[i].files?.length) return ms[i].files[0];
    return null;
  };
  const onColor = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? '#FFFFFF' : '#000000';
  };
  // a sound of hers for what you do, and the jolt of a button pressed
  const motion = () => !(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  let lastSound = 0;
  const sfx = (kind) => {
    lastSound = now();
    ui(voice, kind);
  };
  const jolt = (el, cls = 'is-pressed', ms = 260) => {
    if (!el || !motion()) return;
    el.classList.remove(cls);
    void el.offsetWidth; // restart the animation
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  };
  const state = {
    sessions: [], session: null, engine: info.engine || 'local', web: info.web !== false,
    attachments: [], sending: null, stick: true, filter: '', armed: null, imageMode: false, editTarget: null, showArchived: false, orders: [], listening: null,
  };
  const ES = info.lang !== 'en' && info.lang !== 'fr' && info.lang !== 'pt' && info.lang !== 'ru';
  const AT = { archive: ES ? 'Archivar' : 'Archive', restore: ES ? 'Desarchivar' : 'Restore', shelf: (n) => (ES ? `Archivadas (${n})` : `Archived (${n})`), back: ES ? '← Conversaciones' : '← Conversations' };

  const blank = () => ({ id: uuid(), title: '', createdAt: now(), updatedAt: now(), messages: [], claude: { id: uuid(), started: false }, engine: state.engine, web: state.web });
  const el = (tag, className, text) => {
    const e = doc.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  // ---------- the list ----------
  function renderList() {
    const q = state.filter.trim().toLowerCase();
    const archivedCount = state.sessions.filter((s) => s.archived).length;
    if (!archivedCount) state.showArchived = false;
    const mine = state.sessions.filter((s) => Boolean(s.archived) === state.showArchived);
    const shown = mine.filter((s) => !q || (s.title || '').toLowerCase().includes(q));
    const shelf = () => {
      if (!archivedCount) return [];
      const row = el('div', 'item item--shelf');
      row.append(el('span', 'item__title', state.showArchived ? AT.back : AT.shelf(archivedCount)));
      row.addEventListener('click', () => { state.showArchived = !state.showArchived; renderList(); });
      return [row];
    };
    if (!shown.length) {
      els.list.replaceChildren(el('div', 'empty', mine.length ? T.none : T.empty), ...shelf());
      return;
    }
    els.list.replaceChildren(...shown.map((s) => {
      const item = el('div', s.id === state.session?.id ? 'item is-active' : 'item');
      item.dataset.id = s.id;
      item.append(el('span', 'item__title', s.title || T.untitled), el('span', 'item__when', whenOf(s.updatedAt, info.lang, now())));
      const a = el('button', 'item__a', state.showArchived ? '↩' : '▣');
      a.type = 'button';
      a.title = state.showArchived ? AT.restore : AT.archive;
      a.addEventListener('click', (e) => {
        e.stopPropagation();
        sfx('switch');
        archiveSession(s.id, !state.showArchived);
      });
      item.append(a);
      const x = el('button', 'item__x', '✕');
      x.type = 'button';
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.armed !== s.id) { // a second press confirms
          sfx('warn');
          state.armed = s.id;
          x.textContent = T.sure;
          x.className = 'item__x is-armed';
          setTimeout(() => { if (state.armed === s.id) { state.armed = null; renderList(); } }, 2800);
          return;
        }
        state.armed = null;
        sfx('delete');
        removeSession(s.id);
      });
      item.append(x);
      item.addEventListener('click', () => { jolt(item); openSession(s.id); });
      return item;
    }), ...shelf());
  }

  async function refreshList() {
    state.sessions = await cw.sessionList().catch(() => []);
    renderList();
  }

  // ---------- the thread ----------
  function bodyOf(m) {
    if (m.role === 'user') return el('div', 'msg__body', m.content);
    const body = el('div', 'msg__body');
    if (m.via === 'palette') { // the colours of a picture: a square for each one, which copies itself
      body.append(el('p', 'msg__ask', T.paletteOf((m.content.match(/#[0-9A-F]{6}/gi) || []).length)));
      const row = el('div', 'msg__swatches');
      for (const hex of m.content.match(/#[0-9A-F]{6}/gi) || []) {
        const sw = el('button', 'sw');
        sw.type = 'button';
        sw.style.setProperty('--c', hex);
        sw.style.setProperty('--on', onColor(hex));
        const label = el('b', '', hex);
        sw.append(label);
        sw.addEventListener('click', () => {
          cw.copy(hex);
          label.textContent = '✓';
          setTimeout(() => { label.textContent = hex; }, 900);
        });
        row.append(sw);
      }
      body.append(row);
      return body;
    }
    if (m.via === 'image') { // a picture she made: what was asked, and the picture(s)
      body.append(el('p', 'msg__ask', m.content));
      for (const f of (m.files || []).filter((x) => IMAGE_FILE.test(x)).slice(0, 4)) {
        const img = el('img', 'msg__img');
        img.alt = '';
        img.title = f;
        img.addEventListener('click', () => cw.openFile(f));
        cw.preview(f).then((url) => { if (url) img.src = url; }).catch(() => {});
        body.append(img);
      }
      return body;
    }
    body.append(render(parse(stripFiles(m.content)), doc, { onLink: (u) => cw.openExternal(u), onCopy: (t) => cw.copy(t), labels: { copy: T.copyCode, copied: T.copied } }));
    for (const f of (m.files || []).filter((x) => IMAGE_FILE.test(x)).slice(0, 4)) { // a picture Claude made
      const img = el('img', 'msg__img');
      img.alt = '';
      img.title = f;
      img.addEventListener('click', () => cw.openFile(f));
      cw.preview(f).then((url) => { if (url) img.src = url; }).catch(() => {});
      body.append(img);
    }
    return body;
  }

  // her face (or your initial), cut like the bubble's; talking = it moves while she writes
  function faceEl(role, mood = 'look', { talking = false, fresh = false } = {}) {
    const fig = el('figure', role === 'user' ? 'msg__face msg__face--me' : 'msg__face');
    if (role === 'user') {
      fig.append(el('span', '', (info.userName || T.you).trim().charAt(0).toUpperCase() || 'T'));
      return fig;
    }
    const img = el('img', [talking ? 'is-talking' : '', fresh ? 'is-swapping' : ''].filter(Boolean).join(' '));
    img.src = FACE_DIR + (FACES[mood] || FACES.look);
    img.alt = '';
    fig.append(img);
    return fig;
  }

  function messageEl(m, { fresh = false } = {}) {
    const mine = m.role === 'user';
    const row = el('article', `${mine ? 'msg msg--user' : 'msg msg--capri'}${fresh ? ' is-new' : ''}`);
    const main = el('div', 'msg__main');
    const who = el('div', 'msg__who', mine ? T.you : T.capri);
    if (!mine && m.via === 'palette') who.append(el('span', 'msg__badge', T.palette));
    if (!mine && m.via === 'order') who.append(el('span', 'msg__badge', T === TEXT.es ? 'Orden' : 'Order'));
    if (!mine && m.via && m.via !== 'local' && m.via !== 'image' && m.via !== 'palette' && m.via !== 'order') who.append(el('span', 'msg__badge', m.via[0].toUpperCase() + m.via.slice(1)));
    if (!mine && m.via === 'image') who.append(el('span', 'msg__badge', 'Nano Banana'));
    const plate = el('div', 'msg__plate');
    plate.append(bodyOf(m));
    main.append(who, plate);
    const tools = el('div', 'msg__tools');
    const copy = el('button', 'tool', T.copy);
    copy.type = 'button';
    copy.addEventListener('click', () => {
      cw.copy(m.role === 'assistant' ? stripFiles(m.content) : m.content);
      copy.textContent = T.copied;
      setTimeout(() => { copy.textContent = T.copy; }, 1400);
    });
    tools.append(copy);
    for (const f of m.files || []) {
      const name = String(f).split(/[\\/]/).pop();
      const open = el('button', 'tool tool--file', `${T.open} ${name.length > 26 ? `${name.slice(0, 23)}...` : name}`);
      open.type = 'button';
      open.addEventListener('click', () => cw.openFile(f));
      const reveal = el('button', 'tool', T.reveal);
      reveal.type = 'button';
      reveal.addEventListener('click', () => cw.revealFile(f));
      tools.append(open, reveal);
    }
    if (m.via === 'image') { // the same picture asked again: a new version
      const again = el('button', 'tool', T.again);
      again.type = 'button';
      again.addEventListener('click', () => {
        if (state.sending) return;
        const pro = / · Pro$/.test(m.content);
        els.input.value = `${m.content.replace(/^🖼\s*/, '').replace(/ · Pro$/, '')}${pro ? ' con pro' : ''}`;
        state.imageMode = true;
        send();
      });
      tools.append(again);
      const file = (m.files || [])[0];
      if (file) {
        const edit = el('button', 'tool', T.edit); // change something in THIS picture: the next thing you write is what to change
        edit.type = 'button';
        edit.addEventListener('click', () => {
          if (state.sending) return;
          state.editTarget = file;
          state.imageMode = true;
          applyImageMode();
          els.input.focus();
        });
        const pal = el('button', 'tool', T.palette);
        pal.type = 'button';
        pal.addEventListener('click', () => {
          if (!state.sending) paletteOf(T.palette, file);
        });
        tools.append(edit, pal);
      }
    }
    main.append(tools);
    row.append(...(mine ? [main, faceEl('user')] : [faceEl('assistant', m.via === 'image' ? 'smug' : moodOf(m.content), { fresh }), main]));
    return row;
  }

  function renderThread({ keepScroll = false, animateLast = false, animateUser = false } = {}) {
    const s = state.session;
    const nodes = [];
    const orders = s ? state.orders.filter((o) => o.sid === s.id) : [];
    const orderNodes = (o) => { const n = [messageEl({ role: 'user', content: o.text }), messageEl({ role: 'assistant', content: o.line, via: 'order', files: o.files }, { fresh: o.fresh })]; o.fresh = false; return n; };
    if (!s?.messages.length && !orders.length) {
      const start = el('div', 'start');
      start.append(el('h2', '', T.startTitle), el('div', '', T.start));
      nodes.push(start);
    } else {
      // (what she did for you at that point of the talk: orders for the PC, shown but never kept in the conversation)
      s.messages.forEach((m, i) => {
        for (const o of orders.filter((x) => x.at === i)) nodes.push(...orderNodes(o));
        nodes.push(messageEl(m, { fresh: (animateLast && i === s.messages.length - 1 && m.role === 'assistant') || (animateUser && i === s.messages.length - 1 && m.role === 'user') }));
      });
      for (const o of orders.filter((x) => x.at >= s.messages.length)) nodes.push(...orderNodes(o));
    }
    els.thread.replaceChildren(...nodes);
    if (state.sending) {
      const sending = state.sending;
      sending.row = el('article', 'msg msg--capri is-new');
      const main = el('div', 'msg__main');
      const who = el('div', 'msg__who', T.capri);
      if (sending.engine !== 'local') who.append(el('span', 'msg__badge', sending.engine === 'image' ? 'Nano Banana' : sending.engine[0].toUpperCase() + sending.engine.slice(1)));
      const plate = el('div', 'msg__plate');
      sending.body = el('div', 'msg__body');
      plate.append(sending.body);
      main.append(who, plate);
      sending.row.append(faceEl('assistant', 'calm', { talking: true }), main);
      els.thread.append(sending.row);
      paintStream();
    }
    if (!keepScroll) els.thread.scrollTop = els.thread.scrollHeight;
    state.stick = true;
    els.jump.hidden = true;
    const lastCapri = [...(s?.messages || [])].reverse().find((m) => m.role === 'assistant');
    const face = FACE_DIR + (FACES[state.sending ? 'calm' : lastCapri ? (lastCapri.via === 'image' ? 'smug' : moodOf(lastCapri.content)) : 'look'] || FACES.look);
    if (els.topFace.src !== face) {
      els.topFace.src = face;
      jolt(els.topFace, 'is-swapping', 200); // her face changes with a jolt, as in the bubble
    }
  }

  // what's arriving: re-drawn as it comes (the formatting settles as the answer does)
  let paintQueued = false;
  function paintStream() {
    const s = state.sending;
    if (!s?.body) return;
    s.body.replaceChildren();
    if (!s.text.trim()) {
      s.body.append(el('div', 'working', s.engine === 'image' ? T.imageWorking : s.engine === 'local' ? T.thinking : T.working));
    } else {
      s.body.append(render(parse(stripFiles(s.text)), doc, { onLink: (u) => cw.openExternal(u), onCopy: (t) => cw.copy(t), labels: { copy: T.copyCode, copied: T.copied } }));
    }
    if (state.stick) els.thread.scrollTop = els.thread.scrollHeight;
  }
  const schedulePaint = () => {
    if (paintQueued) return;
    paintQueued = true;
    (globalThis.requestAnimationFrame || ((f) => setTimeout(f, 40)))(() => {
      paintQueued = false;
      paintStream();
    });
  };

  function notice(text) {
    els.thread.append(el('div', 'notice', text));
    if (state.stick) els.thread.scrollTop = els.thread.scrollHeight;
  }

  // ---------- engine ----------
  function applyEngine() {
    for (const b of els.engine.querySelectorAll('[data-engine]')) {
      const on = b.dataset.engine === state.engine;
      if (on && !b.classList.contains('is-on')) jolt(b, 'is-flash', 300);
      b.classList.toggle('is-on', on);
    }
    els.webWrap.hidden = state.engine === 'local';
    els.web.checked = state.web;
  }

  function setEngine(engine, { persist = true } = {}) {
    if (persist && engine !== state.engine) sfx('on'); // she answers differently now
    state.engine = engine;
    if (state.session) state.session.engine = engine;
    applyEngine();
    if (persist) cw.prefs({ winEngine: engine });
  }

  // ---------- conversations ----------
  async function saveNow() {
    const s = state.session;
    if (!s || !s.messages.length) return;
    s.updatedAt = now();
    s.engine = state.engine;
    s.web = state.web;
    await cw.sessionSave(s).catch(() => {});
  }

  // ---------- Claude Design, as a tab under the top bar ----------
  // It's a web page of Claude's, hosted by the main process over the conversation (a view over this area); here only its button and its place.
  let designOn = false;
  const designRect = () => {
    const m = doc.querySelector('.main')?.getBoundingClientRect();
    const t = doc.querySelector('.top')?.getBoundingClientRect();
    return m && t ? { x: m.left, y: t.bottom, width: m.width, height: m.bottom - t.bottom } : null;
  };
  const paintDesign = () => {
    els.designTab?.classList.toggle('is-on', designOn);
    if (els.designTab) els.designTab.title = T.designHint;
  };
  async function setDesign(on, { quiet = false } = {}) {
    if (on === designOn) return;
    const rect = designRect();
    if (on && !rect) return;
    designOn = on;
    paintDesign();
    if (!quiet) sfx(on ? 'on' : 'off');
    if (on) {
      const ok = await cw.designDock(rect).catch(() => false);
      if (!ok) { designOn = false; paintDesign(); }
    } else {
      await cw.designUndock().catch(() => {});
      if (!quiet) els.input.focus();
    }
  }
  const followDesign = () => { const r = designRect(); if (designOn && r) cw.designBounds(r); };

  async function openSession(id) {
    if (state.sending) return;
    sfx('switch'); // she arrives in the other conversation
    if (designOn) setDesign(false, { quiet: true }); // (a conversation was picked: the chat comes back)
    state.editTarget = null;
    await saveNow();
    const s = await cw.sessionGet(id).catch(() => null);
    if (!s) return;
    s.claude ||= { id: uuid(), started: false };
    if (s.archived) s.archived = false; // you went back to it: no longer put away
    state.session = s;
    state.attachments = [];
    renderChips();
    if (s.engine) setEngine(s.engine, { persist: false });
    if (typeof s.web === 'boolean') state.web = s.web;
    applyEngine();
    els.title.value = s.title || '';
    await refreshList();
    renderThread();
    jolt(els.thread, 'is-switching', 300);
    els.input.focus();
  }

  async function freshSession() {
    if (state.sending) return;
    sfx('fresh');
    if (designOn) setDesign(false, { quiet: true });
    state.editTarget = null;
    await saveNow();
    state.session = blank();
    state.attachments = [];
    renderChips();
    els.title.value = '';
    renderList();
    renderThread();
    jolt(els.thread, 'is-switching', 300);
    els.input.focus();
  }

  async function archiveSession(id, on) {
    if (on && state.session?.id === id) await saveNow();
    await cw.sessionArchive(id, on).catch(() => {});
    if (on && state.session?.id === id) {
      state.session = blank();
      els.title.value = '';
      renderThread();
    }
    await refreshList();
  }

  async function removeSession(id) {
    await cw.sessionDelete(id).catch(() => {});
    if (state.session?.id === id) {
      state.session = blank();
      els.title.value = '';
      renderThread();
    }
    await refreshList();
  }

  // ---------- what you attach ----------
  function renderChips() {
    els.chips.replaceChildren(...state.attachments.map((a, i) => {
      const chip = el('span', 'chip');
      chip.title = a.path;
      const name = el('span', '', a.name);
      const x = el('button', '', '✕');
      x.type = 'button';
      x.addEventListener('click', () => {
        state.attachments.splice(i, 1);
        renderChips();
      });
      chip.append(name, x);
      return chip;
    }));
    els.chips.hidden = !state.attachments.length;
  }

  async function addFiles(paths) {
    const found = await cw.inspectFiles(paths).catch(() => []);
    for (const f of found) {
      if (state.attachments.length >= 8 || state.attachments.some((a) => a.path === f.path)) continue;
      state.attachments.push(f);
    }
    if (found.length) sfx('drop'); // a file lands in her hands
    renderChips();
    els.input.focus();
  }

  // ---------- sending ----------
  async function send() {
    if (state.sending || state.asking) return;
    const text = els.input.value.trim();
    const items = state.attachments.slice();
    if (!text && !items.length) return;
    const engine = state.engine;
    // a plain order for the PC ("abre Figma", "cierra el explorador", "pon música", "gracias"): she does it, here, and it is not part of the talk (not saved, not sent to a model)
    if (text && !items.length && !state.imageMode && !state.editTarget) {
      state.asking = true;
      let order = null;
      try { order = await cw.orderTry({ text, engine }); } catch { order = null; } finally { state.asking = false; }
      if (order?.handled) {
        els.input.value = '';
        grow();
        if (!state.session) state.session = blank();
        state.orders.push({ sid: state.session.id, at: state.session.messages.length, text, line: order.line, files: order.files || [], fresh: true });
        state.orders = state.orders.slice(-60);
        sfx('send');
        renderThread({ animateLast: false });
        return;
      }
    }
    const prompt = text || T.look;
    const images = items.filter((i) => i.kind === 'image');
    const texts = items.filter((i) => i.kind === 'text');
    const others = items.filter((i) => i.kind === 'other');
    // the colours of a picture: from its pixels, no model
    const recent = recentImage(state.session);
    if (paletteAsk(prompt) && (images.length || recent)) return paletteOf(prompt, images[0]?.path || recent, items);
    // a picture to change: its own (attached, or the one EDITAR points at, or the last she made when you say "ahora hazla azul")
    const editFile = state.editTarget || (images.length && imageEditAsk(prompt) ? images[0].path : null) || (recent && imageEditFollow(prompt) ? recent : null);
    const refImages = editFile && !state.editTarget && images.length && images[0].path === editFile ? images.slice(1) : images;
    // a picture: her image maker (your nano-banana) makes it, and it shows up right here in the conversation
    if (editFile || state.imageMode || imageAsk(prompt)) {
      const askText = editFile ? prompt : imageAsk(prompt) || prompt;
      const proRe = /\b(?:con|en|usando|using|with)\s+(?:nano\s*banana\s+)?pro\b/i;
      const pro = proRe.test(askText);
      const clean = askText.replace(proRe, '').trim() || askText;
      if (!state.session) state.session = blank();
      const s = state.session;
      els.input.value = '';
      grow();
      state.attachments = [];
      renderChips();
      state.imageMode = false;
      state.editTarget = null;
      applyImageMode();
      s.messages.push({ role: 'user', content: items.length ? `${prompt}\n\n📎 ${items.map((i) => i.name).join(', ')}` : prompt });
      if (!s.title) {
        s.title = prompt.replace(/\s+/g, ' ').slice(0, 60);
        els.title.value = s.title;
      }
      sfx('send');
      state.sending = { id: now(), engine: 'image', text: '' };
      setBusy(true, { stoppable: false });
      renderThread({ animateUser: true });
      saveNow().then(refreshList);
      const made = await cw.imageMake({ prompt: clean, model: pro ? 'pro' : 'flash', refs: refImages.map((i) => i.path), ...(editFile ? { edit: editFile } : {}) }).catch((err) => ({ ok: false, error: String(err.message || err) }));
      state.sending = null;
      setBusy(false);
      if (!made.ok) {
        sfx('error');
        renderThread({ keepScroll: true });
        notice(T.failedImg(made.error));
        await saveNow();
        return;
      }
      sfx('image'); // her satellite ping
      s.messages.push({ role: 'assistant', content: `🖼 ${editFile ? '✎ ' : ''}${clean}${pro ? ' · Pro' : ''}`, via: 'image', files: made.files });
      await saveNow();
      renderThread({ animateLast: true });
      refreshList();
      return;
    }
    if (engine === 'local') { // her own model: pictures it sees and small texts only; the rest needs a Claude
      const blind = images.length && !info.sees;
      if (others.length || blind) {
        notice(T.needClaude((blind ? images : others).map((i) => i.name).slice(0, 3).join(', ')));
        return;
      }
    }
    if (!state.session) state.session = blank();
    const s = state.session;
    sfx(engine === 'local' ? 'send' : 'go'); // yours goes; to Claude, it goes out with the whoosh
    els.input.value = '';
    grow();
    state.attachments = [];
    renderChips();
    const shownText = items.length ? `${prompt}\n\n📎 ${items.map((i) => i.name).join(', ')}` : prompt;
    s.messages.push({ role: 'user', content: shownText });
    if (!s.title) {
      s.title = prompt.replace(/\s+/g, ' ').slice(0, 60);
      els.title.value = s.title;
    }
    s.engine = engine;
    s.web = state.web;
    const id = now();
    state.sending = { id, engine, text: '' };
    setBusy(true);
    renderThread({ animateUser: true });
    saveNow().then(refreshList);

    let request;
    if (engine === 'local') {
      let context = texts.map((t) => `[${T === TEXT.es ? 'Archivo' : 'File'}: ${t.name}]\n${t.text}`).join('\n\n');
      const urls = linksIn(prompt);
      if (urls.length) {
        const pages = await cw.readLinks(urls).catch(() => []);
        context = [context, ...pages.map((p) => `[Link: ${p.url}${p.title ? ` — ${p.title}` : ''}]\n${p.text || (p.error ? `(${p.error})` : '')}`)].filter(Boolean).join('\n\n');
      }
      const history = s.messages.slice(-21).map(({ role, content }) => ({ role, content }));
      if (context) history[history.length - 1] = { ...history.at(-1), content: `${prompt}\n\n${context}` };
      const nudge = { es: '(Responde solo en español, sin mezclar inglés.)', fr: '(Réponds uniquement en français.)', pt: '(Responda apenas em português.)', ru: '(Отвечай только по-русски.)' }[info.lang];
      if (nudge) history[history.length - 1] = { ...history.at(-1), content: `${history.at(-1).content}\n\n${nudge}` }; // a small model drifts into English: reminded every time
      request = { id, messages: [{ role: 'system', content: info.persona }, ...history], task: false, images: images.map((i) => i.path) };
    } else {
      request = {
        id, messages: [{ role: 'user', content: prompt }], task: true, taskModel: engine, windowChat: true, web: state.web,
        files: items.map((i) => i.path), session: { id: s.claude.id, started: s.claude.started },
      };
    }
    const res = await cw.chatSend(request).catch((err) => ({ ok: false, error: String(err.message || err) }));
    const partial = state.sending?.text || '';
    state.sending = null;
    setBusy(false);
    if (res.claudeStarted && s.claude && !s.claude.started) { // Claude began this conversation, even if the job failed or was stopped: the next one continues it
      s.claude.started = true;
      saveNow();
    }
    if (res.ok) {
      s.messages.push({ role: 'assistant', content: res.text || partial || '…', via: engine, ...(res.files?.length ? { files: res.files } : {}) });
      if (res.claudeStarted) s.claude.started = true;
      if (engine !== 'local') {
        sfx('done'); // Claude is back: the bright arpeggio
      }
    } else if (res.error === 'stopped') {
      if (partial.trim()) s.messages.push({ role: 'assistant', content: `${partial.trim()}\n\n${T.stopped}`, via: engine });
    } else {
      sfx('error');
      renderThread({ keepScroll: true });
      notice(engine === 'local' ? T.failedLocal(res.error) : T.failed(res.error));
      saveNow().then(refreshList);
      return;
    }
    await saveNow();
    renderThread({ animateLast: true });
    refreshList();
  }

  function setBusy(busy, { stoppable = true } = {}) {
    els.send.hidden = busy;
    els.stop.hidden = !busy || !stoppable;
  }

  function applyImageMode() {
    els.imageMode.classList.toggle('is-on', state.imageMode);
    els.input.placeholder = state.editTarget ? T.editHint : state.imageMode ? T.imageHint : T.placeholder;
  }

  // the colours of a picture (attached, or one she made): her answer is the swatches, each one a button
  async function paletteOf(prompt, file, items = []) {
    if (!state.session) state.session = blank();
    const s = state.session;
    els.input.value = '';
    grow();
    state.attachments = [];
    renderChips();
    s.messages.push({ role: 'user', content: items.length ? `${prompt}\n\n📎 ${items.map((i) => i.name).join(', ')}` : prompt });
    if (!s.title) {
      s.title = prompt.replace(/\s+/g, ' ').slice(0, 60);
      els.title.value = s.title;
    }
    sfx('send');
    const res = await cw.paletteOf(file).catch(() => ({ ok: false }));
    if (res?.ok) {
      sfx('image');
      s.messages.push({ role: 'assistant', content: `🎨 ${res.colors.map((c) => c.hex).join(' ')}`, via: 'palette' });
    } else {
      sfx('error');
      s.messages.push({ role: 'assistant', content: T.paletteFail });
    }
    await saveNow();
    renderThread({ animateLast: true, animateUser: false });
    refreshList();
  }

  function grow() {
    els.input.style.height = 'auto';
    els.input.style.height = `${Math.min(els.input.scrollHeight + (els.input.offsetHeight - els.input.clientHeight), 280)}px`;
  }

  // ---------- wiring ----------
  els.fresh.textContent = T.fresh;
  els.find.placeholder = T.find;
  els.send.textContent = T.send;
  els.stop.textContent = T.stop;
  els.input.placeholder = T.placeholder;
  els.engineLabel.textContent = T.engine;
  els.webLabel.textContent = T.web;
  els.hint.textContent = T.hint;
  // what her Claude jobs have used today, under the note (after each one, and when the window opens)
  els.note.textContent = T.note(info.model);
  for (const b of els.engine.querySelectorAll('[data-engine="local"]')) b.textContent = T.local;
  if (els.app) els.app.dataset.drop = T.drop;

  els.imageMode.textContent = T.image;
  els.imageMode.addEventListener('click', () => {
    state.imageMode = !state.imageMode;
    sfx(state.imageMode ? 'image' : 'off');
    applyImageMode();
    els.input.focus();
  });
  if (els.designTab) {
    els.designTab.textContent = T.design;
    els.designTab.title = T.designHint;
    els.designTab.addEventListener('click', async () => { // Claude Design lives in the Claude app: this takes you there (the web one in your browser if there's no app)
      sfx('go');
      const ok = await cw.designApp?.().catch(() => false);
      if (!ok) cw.openExternal('https://claude.ai/design');
    });
    cw.onDesignFailed?.(() => { designOn = false; paintDesign(); }); // it couldn't load here: the main process sent it to your browser
    globalThis.addEventListener?.('resize', followDesign);
    if (globalThis.ResizeObserver) {
      const ro = new globalThis.ResizeObserver(followDesign);
      for (const q of ['.main', '.top']) { const n = doc.querySelector?.(q); if (n) ro.observe(n); }
    }
  }
  els.fresh.addEventListener('click', freshSession);
  els.find.addEventListener('input', () => { state.filter = els.find.value; renderList(); });
  els.composer.addEventListener('submit', (e) => { e.preventDefault(); send(); });
  els.stop.addEventListener('click', () => { if (state.sending) cw.chatStop(state.sending.id); });
  els.mic.title = T.micTip;
  els.mic.addEventListener('click', () => listen());
  cw.onListen?.(() => listen()); // Ctrl+Alt+V with this window in front
  els.plus.addEventListener('click', async () => addFiles(await cw.pickFiles().catch(() => [])));
  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  els.input.addEventListener('input', grow);
  els.engine.addEventListener('click', (e) => {
    const b = e.target?.closest?.('[data-engine]') || (e.target?.dataset?.engine ? e.target : null);
    if (b) setEngine(b.dataset.engine);
  });
  els.web.addEventListener('change', () => {
    state.web = els.web.checked;
    sfx(state.web ? 'on' : 'off');
    cw.prefs({ winWeb: state.web });
  });
  els.title.addEventListener('change', () => {
    if (!state.session) return;
    state.session.title = els.title.value.trim().slice(0, 60);
    saveNow().then(refreshList);
  });
  els.thread.addEventListener('scroll', () => {
    const away = els.thread.scrollHeight - els.thread.scrollTop - els.thread.clientHeight;
    state.stick = away < 80;
    els.jump.hidden = state.stick;
  });
  els.jump.addEventListener('click', () => { els.thread.scrollTop = els.thread.scrollHeight; });
  els.input.addEventListener('paste', async (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    const paths = [];
    for (const f of files) {
      const own = cw.pathOf(f);
      if (own) paths.push(own);
      else {
        const saved = await cw.saveClip(await f.arrayBuffer(), (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg'));
        if (saved) paths.push(saved);
      }
    }
    if (paths.length) addFiles(paths);
  });
  const overWindow = (e) => [...(e.dataTransfer?.types || [])].some((t) => ['Files', 'text/uri-list', 'text/plain'].includes(t));
  doc.addEventListener?.('dragover', (e) => { if (overWindow(e)) { e.preventDefault(); els.app?.classList.add('is-drop'); } });
  doc.addEventListener?.('dragleave', (e) => { if (!e.relatedTarget) els.app?.classList.remove('is-drop'); });
  doc.addEventListener?.('drop', (e) => {
    if (!overWindow(e)) return;
    e.preventDefault();
    els.app?.classList.remove('is-drop');
    const dt = e.dataTransfer;
    const paths = [...(dt.files || [])].map((f) => cw.pathOf(f)).filter(Boolean);
    if (paths.length) return addFiles(paths);
    const link = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').trim();
    if (link) {
      els.input.value = `${els.input.value}${els.input.value && !/\s$/.test(els.input.value) ? ' ' : ''}${link}`;
      grow();
      els.input.focus();
    }
    return undefined;
  });
  doc.addEventListener?.('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      freshSession();
    }
  });
  cw.onDelta(({ id, text }) => {
    if (state.sending?.id !== id) return;
    state.sending.text += text;
    voice?.play('blip', { mood: 'talk' }); // her blips as the words come in, as in the bubble
    schedulePaint();
  });
  cw.onSessionsChanged(async () => {
    await refreshList();
    if (state.sending || !state.session) return;
    const fresh = await cw.sessionGet(state.session.id).catch(() => null);
    if (fresh && fresh.messages.length !== state.session.messages.length) { // the bubble added to the one you're looking at
      state.session = fresh;
      fresh.claude ||= { id: uuid(), started: false };
      renderThread();
    }
  });
  cw.onOpenSession((id) => openSession(id));
  cw.onLimit?.((a) => { // near the limit of Claude, or at it: a notice here too, and her alert sound
    sfx('warn');
    notice(limitLine(a, info.lang === 'en' ? 'en' : 'es'));
  });
  doc.addEventListener?.('click', (e) => {
    const t = e.target?.closest?.('button, label');
    if (!t) return;
    jolt(t);
    if (now() - lastSound > 80) sfx('press'); // nothing sounded for it yet: the plain click
  });

  // ---------- talk to her from here ----------
  // the microphone: it listens until you go quiet, a Whisper writes it down, and it goes as if you had typed it (an order for the PC is carried out, the rest goes to who answers here)
  async function blobToWav(blob) {
    const ctx = new AudioContext();
    try {
      const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
      const data = decoded.getChannelData(0);
      const ratio = decoded.sampleRate / 16000;
      const out = new Int16Array(Math.floor(data.length / ratio));
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v));
      const gain = peak > 0 ? Math.min(8, 0.8 / peak) : 1;
      for (let i = 0; i < out.length; i++) {
        const a = Math.floor(i * ratio);
        const z = Math.min(data.length, Math.max(a + 1, Math.floor((i + 1) * ratio)));
        let sum = 0;
        for (let j = a; j < z; j++) sum += data[j];
        out[i] = Math.max(-1, Math.min(1, (sum / (z - a)) * gain)) * 0x7fff;
      }
      const buf = new ArrayBuffer(44 + out.length * 2);
      const v = new DataView(buf);
      const put = (at, str) => { for (let i = 0; i < str.length; i++) v.setUint8(at + i, str.charCodeAt(i)); };
      put(0, 'RIFF'); v.setUint32(4, 36 + out.length * 2, true); put(8, 'WAVE'); put(12, 'fmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
      put(36, 'data'); v.setUint32(40, out.length * 2, true);
      new Int16Array(buf, 44).set(out);
      return buf;
    } finally {
      ctx.close().catch(() => {});
    }
  }

  async function listen() {
    if (state.listening) { state.listening.finish(); return; }
    if (state.sending || state.asking) return;
    const st = await cw.sttStatus().catch(() => null);
    if (!st?.ok) { notice(T.noStt); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch { notice(T.noMic); return; }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const s = { began: performance.now(), heard: false, last: 0, done: false };
    s.finish = async () => {
      if (s.done) return;
      s.done = true;
      clearInterval(s.timer);
      state.listening = null;
      els.mic.classList.remove('btn--mic-on');
      await new Promise((resolve) => { rec.onstop = resolve; try { rec.stop(); } catch { resolve(); } });
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
      const restore = () => { applyImageMode(); };
      try {
        if (!s.heard) { notice(T.heardNothing); return; }
        els.input.placeholder = T.transcribing;
        const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
        const wav = await blobToWav(blob).catch(() => null);
        state.names ||= (await cw.launchables().catch(() => [])).map((a) => a.name);
        const res = await cw.sttTranscribe({ audio: wav || await blob.arrayBuffer(), mime: wav ? 'audio/wav' : blob.type, language: String(info.lang || 'es').slice(0, 2), vocab: state.names });
        if (!res?.ok) { notice(res?.code === 'nokey' ? T.noStt : T.failed(res?.error || '')); return; }
        const heard = String(res.text || '').trim();
        if (!heard || /^[\s\[\(♪*]*(?:aplausos?|m[uú]sica|risas?|silencio)[\s\]\)♪*.!]*$|amara\.org|subt[ií]tulos/i.test(heard)) { notice(T.heardNothing); return; }
        els.input.value = heard;
        grow();
        restore();
        await send();
      } finally {
        restore();
      }
    };
    s.timer = setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      for (const v of samples) peak = Math.max(peak, Math.abs(v - 128));
      const t = performance.now();
      if (peak > LISTEN.level) { s.heard = true; s.last = t; }
      if (s.heard && t - s.last > LISTEN.silence) s.finish();
      else if (!s.heard && t - s.began > LISTEN.nobody) s.finish();
      else if (t - s.began > LISTEN.max) s.finish();
    }, 100);
    state.listening = s;
    els.mic.classList.add('btn--mic-on');
    els.input.placeholder = T.listening;
    rec.start(250);
    sfx('send');
  }
  const LISTEN = { silence: 1000, nobody: 7000, max: 30000, level: 14 };

  // ---------- start ----------
  async function boot() {
    applyEngine();
    await refreshList();
    const wanted = decodeURIComponent((doc.location?.hash || '').replace(/^#/, ''));
    const first = state.sessions.find((s) => s.id === wanted)?.id || state.sessions.find((s) => !s.archived)?.id;
    if (first) await openSession(first);
    else {
      state.session = blank();
      renderThread();
    }
    els.input.focus();
  }
  const ready = boot();

  return { state, els, send, openSession, freshSession, removeSession, addFiles, setEngine, saveNow, renderThread, ready, refreshList };
}
