// Her scanner's frame: move it over what you want to show her, then SCAN (Enter). Escape closes it.

const $ = (sel) => document.querySelector(sel);
const es = String(navigator.language).toLowerCase().startsWith('es');
const T = es
  ? { scan: 'ESCANEAR', palette: 'PALETA', shot: 'CAPTURAR', title: 'CAPRI // CAPTURA', busy: 'ESCANEANDO', done: 'LISTO', fail: 'ERROR' }
  : { scan: 'SCAN', palette: 'PALETTE', shot: 'CAPTURE', title: 'CAPRI // CAPTURE', busy: 'SCANNING', done: 'DONE', fail: 'ERROR' };
const shotMode = new URLSearchParams(location.search).get('mode') === 'shot';

const btn = $('#scan');
const state = $('#state');
btn.textContent = T.scan;
$('#palette').textContent = T.palette;
let busy = false;

// the same frame to choose the part of the screen for a screenshot: only CAPTURAR, Enter does it
// (her normal scanner has the button too: ESCANEAR describes it, PALETA reads its colours, CAPTURAR takes it as a screenshot)
$('#shot').hidden = false;
$('#shot').textContent = T.shot;
if (shotMode) {
  $('#scan').hidden = true;
  $('#palette').hidden = true;
  document.querySelector('.title').textContent = T.title;
}

async function shot() {
  if (busy) return;
  busy = true;
  $('#shot').disabled = true;
  state.textContent = T.busy;
  const res = await window.scanner.shot().catch(() => ({ ok: false }));
  busy = false;
  $('#shot').disabled = false;
  state.textContent = res?.ok ? T.done : T.fail;
}
$('#shot').addEventListener('click', shot);

async function scan() {
  if (busy) return;
  busy = true;
  btn.disabled = true;
  $('#frame').classList.add('is-busy');
  state.textContent = T.busy;
  const res = await window.scanner.scan().catch(() => ({ ok: false }));
  busy = false;
  btn.disabled = false;
  $('#frame').classList.remove('is-busy');
  state.textContent = res?.ok ? T.done : T.fail;
}

// PALETA: the colours inside the frame, straight from the pixels (no model, instant)
async function palette() {
  if (busy) return;
  busy = true;
  btn.disabled = true;
  $('#palette').disabled = true;
  state.textContent = T.busy;
  const res = await window.scanner.palette().catch(() => ({ ok: false }));
  busy = false;
  btn.disabled = false;
  $('#palette').disabled = false;
  state.textContent = res?.ok ? T.done : T.fail;
}

btn.addEventListener('click', scan);
$('#palette').addEventListener('click', palette);
$('#close').addEventListener('click', () => window.scanner.close());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.scanner.close();
  if (e.key === 'Enter') (shotMode ? shot() : scan());
  if (e.key.toLowerCase() === 'p' && !e.ctrlKey && !e.altKey && !shotMode) palette();
  if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.altKey && !e.metaKey) shot();
});

// the corner to stretch it (the window is transparent: the system's own resize edge isn't reliable there)
const grip = $('#grip');
let drag = null;
grip.addEventListener('pointerdown', (e) => {
  grip.setPointerCapture(e.pointerId);
  drag = { x: e.screenX, y: e.screenY, w: window.innerWidth, h: window.innerHeight };
});
grip.addEventListener('pointermove', (e) => {
  if (!drag) return;
  window.scanner.size(drag.w + (e.screenX - drag.x), drag.h + (e.screenY - drag.y));
});
grip.addEventListener('pointerup', () => { drag = null; });
