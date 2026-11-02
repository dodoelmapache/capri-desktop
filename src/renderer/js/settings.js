// Her settings window: switches, sliders and lists for what we tuned together. Each row: the config key it changes, how it is shown, a hint.
// A slider shows `stored * scale` (a share as %, milliseconds as seconds) and keeps `shown / scale`.

const SECTIONS = [
  { title: 'Modo juego (League of Legends)', rows: [
    { key: 'lolMode', type: 'toggle', label: 'Comentarios en la partida', hint: 'Comenta kills, objetivos, compras y avisos. «Qué compro» funciona aunque esté apagado.' },
    { key: 'lolSpeak', type: 'toggle', label: 'Con voz', hint: 'Dice los comentarios en voz alta, con tu voz de siempre.' },
    { key: 'lolVolume', type: 'range', label: 'Volumen de esa voz', min: 10, max: 100, step: 5, scale: 100, unit: '%' },
    { key: 'lolClips', type: 'toggle', label: 'GIFs en la esquina superior izquierda', hint: 'Uno de sus GIFs con cada comentario.' },
    { key: 'lolShout', type: 'toggle', label: 'Grita «¡Pum!» en cada kill', hint: 'Una onomatopeya corta con cada kill tuya, además de sus comentarios.' },
    { key: 'lolSfx', type: 'toggle', label: 'Efectos de sonido', hint: 'Un sonido distinto para una kill, un objetivo, un aviso, una muerte…' },
    { key: 'lolSfxVol', type: 'range', label: 'Volumen de los efectos', min: 5, max: 100, step: 5, scale: 100, unit: '%' },
    { key: 'lolGap', type: 'range', label: 'Tiempo mínimo entre comentarios', min: 10, max: 300, step: 5, scale: 1, unit: ' s' },
  ] },
  { title: 'Con un juego abierto', rows: [
    { key: 'heavyMode', type: 'toggle', label: 'Modo ligero', hint: 'Mientras juegas (o con un programa pesado) usa un modelo chico y suelta el grande de la memoria.' },
    { key: 'heavyFps', type: 'range', label: 'Cuadros por segundo de Capri', hint: '0 = como siempre. Menos cuadros, menos gasto.', min: 0, max: 12, step: 1, scale: 1, unit: ' fps' },
    { key: 'gameClickThrough', type: 'toggle', label: 'Que los clics pasen al juego', hint: 'Evita que el clic derecho abra su menú en pleno juego.' },
  ] },
  { title: 'Su tarjeta', rows: [
    { key: 'cardAutoClose', type: 'range', label: 'Se quita sola a los…', hint: '0 = se queda hasta que la cierres. No se quita si tienes el mouse encima o hay texto escrito.', min: 0, max: 15, step: 0.5, scale: 0.001, unit: ' s' },
  ] },
  { title: 'Sonido', rows: [
    { key: 'muted', type: 'toggle', label: 'Silenciar sus sonidos', hint: 'No afecta a su voz.' },
    { key: 'volume', type: 'range', label: 'Volumen general', min: 0, max: 100, step: 5, scale: 100, unit: '%' },
    { key: 'quietVolume', type: 'range', label: 'Voz suave (guardada y comentarios propios)', min: 10, max: 100, step: 5, scale: 100, unit: '%' },
    { key: 'boomVol', type: 'range', label: 'Volumen del BOOM', hint: 'El golpe y su «¡Buuuuum!».', min: 5, max: 100, step: 5, scale: 100, unit: '%' },
    { key: 'boomSay', type: 'toggle', label: 'Dice «¡Buuum!»', hint: 'Cuando termina una tarea pesada, dice el BOOM en voz alta además del sonido.' },
    { key: 'giggle', type: 'toggle', label: 'Su risita', hint: 'Suave, de vez en cuando, cuando se ríe.' },
    { key: 'giggleLevel', type: 'range', label: 'Volumen de la risita', min: 10, max: 100, step: 5, scale: 100, unit: '%' },
    { key: 'dnd', type: 'toggle', label: 'No molestar', hint: 'No habla ni comenta por su cuenta.' },
  ] },
  { title: 'Voces', rows: [
    { key: 'englishVoice', type: 'select', label: 'Las frases en inglés', hint: 'Con tu voz y su acento de siempre, o con una voz en inglés.', options: [['mine', 'Mi voz y mi acento'], ['english', 'Una voz en inglés']] },
    { key: 'flirtVoiceOn', type: 'toggle', label: 'Voz distinta para lo coqueto', hint: 'Apagado: tu voz de siempre dice todo.' },
    { key: 'flirtVoice', type: 'select', label: 'Esa voz', options: [['salome', 'Salomé (Colombia)'], ['dalia', 'Dalia (México)'], ['elena', 'Elena (Argentina)'], ['paloma', 'Paloma (EE. UU., latina)'], ['paola', 'Paola, más lenta y grave']] },
  ] },
];

const heavyBox = el0('section');
function el0(tag) { return document.createElement(tag); }
const main = document.getElementById('main');
const foot = document.getElementById('foot');
const rows = new Map();
let values = {};
let timer = 0;

const el = (tag, attrs = {}, ...kids) => {
  const node = Object.assign(document.createElement(tag), attrs);
  node.append(...kids.filter((k) => k !== null && k !== undefined));
  return node;
};

function saved() {
  foot.textContent = 'Guardado.';
  foot.classList.add('saved');
  clearTimeout(timer);
  timer = setTimeout(() => { foot.textContent = 'Los cambios se guardan solos.'; foot.classList.remove('saved'); }, 1400);
}

async function change(key, value) {
  await window.settings.set({ [key]: value });
  values[key] = value;
  refreshDims();
  saved();
}

// a row whose switch is off greys the rows of the same group that depend on it
const DEPENDS = { lolSpeak: 'lolMode', lolVolume: 'lolSpeak', lolClips: 'lolMode', lolSfx: 'lolMode', lolSfxVol: 'lolSfx', lolGap: 'lolMode', giggleLevel: 'giggle', flirtVoice: 'flirtVoiceOn' };
function refreshDims() {
  for (const [key, parent] of Object.entries(DEPENDS)) rows.get(key)?.row.classList.toggle('off', !values[parent] || (key === 'lolVolume' && !values.lolMode));
}

function build() {
  main.replaceChildren();
  rows.clear();
  for (const section of SECTIONS) {
    const box = el('section', {}, el('h2', { textContent: section.title }));
    for (const def of section.rows) {
      const control = el('div', { className: 'control' });
      const row = el('div', { className: 'row' }, el('div', { className: 'label', textContent: def.label }), def.hint ? el('div', { className: 'hint', textContent: def.hint }) : null, control);
      let set = () => {};
      if (def.type === 'toggle') {
        const input = el('input', { type: 'checkbox' });
        input.addEventListener('change', () => change(def.key, input.checked));
        control.append(el('label', { className: 'switch' }, input, el('span')));
        set = (v) => { input.checked = Boolean(v); };
      } else if (def.type === 'range') {
        const input = el('input', { type: 'range', min: def.min, max: def.max, step: def.step });
        const shown = el('span', { className: 'value' });
        const show = () => { shown.textContent = `${Number(input.value)}${def.unit}`; };
        input.addEventListener('input', show);
        input.addEventListener('change', () => change(def.key, Number(input.value) / def.scale));
        control.append(input, shown);
        set = (v) => { input.value = Math.round((Number(v) || 0) * def.scale * 100) / 100; show(); };
      } else if (def.type === 'select') {
        const select = el('select');
        for (const [value, text] of def.options) select.append(el('option', { value, textContent: text }));
        select.addEventListener('change', () => change(def.key, select.value));
        control.append(select);
        set = (v) => { select.value = def.options.some(([o]) => o === v) ? v : def.options[0][0]; };
      }
      rows.set(def.key, { row, set });
      box.append(row);
    }
    main.append(box);
  }
}

async function load() {
  values = (await window.settings.get().catch(() => null)) || {};
  for (const [key, { set }] of rows) set(values[key]);
  refreshDims();
  foot.textContent = 'Los cambios se guardan solos.';
}

// the programs that make her step aside (modo ligero): each one with a check mark; the ones you uncheck stay in the list, ready to check again
async function loadHeavy() {
  const r = await window.settings.heavyList().catch(() => null);
  heavyBox.replaceChildren(el('h2', { textContent: 'Programas pesados (modo ligero)' }),
    el('div', { className: 'hint note', textContent: 'Con uno de estos abierto, Capri usa su modelo chico y suelta el grande de la memoria. Marca o desmarca los que quieras; nada se pierde.' }));
  const grid = el('div', { className: 'chips' });
  for (const app of r?.all || []) {
    const input = el('input', { type: 'checkbox', checked: app.on });
    input.addEventListener('change', async () => { await window.settings.heavyEdit('toggle', app.name); saved(); loadHeavy(); });
    grid.append(el('label', { className: `chip${app.on ? ' on' : ''}` }, input, el('span', { textContent: app.name })));
  }
  heavyBox.append(grid);
  const add = el('input', { type: 'text', className: 'addbox', placeholder: 'Añadir un programa (por ejemplo: photoshop)…', maxLength: 60 });
  const go = el('button', { type: 'button', className: 'addbtn', textContent: 'Añadir' });
  const submit = async () => { const name = add.value.trim(); if (!name) return; await window.settings.heavyEdit('add', name); add.value = ''; saved(); loadHeavy(); };
  go.addEventListener('click', submit);
  add.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  heavyBox.append(el('div', { className: 'addrow' }, add, go));
}

build();
main.insertBefore(heavyBox, main.children[2] || null); // (after "Con un juego abierto")
loadHeavy();
load();
window.addEventListener('focus', () => { load(); loadHeavy(); }); // (something changed by voice meanwhile: it shows)
