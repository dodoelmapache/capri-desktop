// Her eyedropper: the picture of the screen, a magnifier at the pointer, a click takes the colour of the pixel under it. Esc (or a right click) leaves.

const screenEl = document.getElementById('screen');
const lens = document.getElementById('lens');
const zoom = document.getElementById('zoom');
const hexEl = document.getElementById('hex');
const swatch = document.getElementById('swatch');
const zctx = zoom.getContext('2d');
const GRID = 11;   // pixels shown around the pointer, each one big
const CELL = 13;
let img = null;    // the picture, as pixels we can read
let rd = null;
let at = { x: 0, y: 0 };

const hexOf = (r, g, b) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;

window.picker.onInit(({ image }) => {
  const pic = new Image();
  pic.onload = () => {
    img = pic;
    screenEl.width = pic.width;
    screenEl.height = pic.height;
    screenEl.getContext('2d').drawImage(pic, 0, 0);
    const off = document.createElement('canvas');
    off.width = pic.width;
    off.height = pic.height;
    rd = off.getContext('2d', { willReadFrequently: true });
    rd.drawImage(pic, 0, 0);
  };
  pic.src = image;
});

function pixelAt(clientX, clientY) {
  if (!img) return null;
  const px = Math.min(img.width - 1, Math.max(0, Math.floor((clientX * img.width) / window.innerWidth)));
  const py = Math.min(img.height - 1, Math.max(0, Math.floor((clientY * img.height) / window.innerHeight)));
  return { px, py };
}

window.addEventListener('mousemove', (e) => {
  const p = pixelAt(e.clientX, e.clientY);
  if (!p) return;
  at = p;
  const [r, g, b] = rd.getImageData(p.px, p.py, 1, 1).data;
  const hex = hexOf(r, g, b);
  hexEl.textContent = hex;
  swatch.style.background = hex;
  // the magnifier: the pixels around, each one big, and the one under the pointer framed
  zctx.imageSmoothingEnabled = false;
  zctx.clearRect(0, 0, zoom.width, zoom.height);
  const half = Math.floor(GRID / 2);
  zctx.drawImage(img, p.px - half, p.py - half, GRID, GRID, 0, 0, GRID * CELL, GRID * CELL);
  zctx.strokeStyle = '#000';
  zctx.lineWidth = 3;
  zctx.strokeRect(half * CELL, half * CELL, CELL, CELL);
  zctx.strokeStyle = '#fff';
  zctx.lineWidth = 1;
  zctx.strokeRect(half * CELL + 1.5, half * CELL + 1.5, CELL - 3, CELL - 3);
  lens.hidden = false;
  const w = 143;
  const h = 143 + 30;
  const x = e.clientX + 22 + w > window.innerWidth ? e.clientX - 22 - w : e.clientX + 22;
  const y = e.clientY + 22 + h > window.innerHeight ? e.clientY - 22 - h : e.clientY + 22;
  lens.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
});

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !rd) { window.picker.done(null); return; }
  const [r, g, b] = rd.getImageData(at.px, at.py, 1, 1).data;
  window.picker.done(hexOf(r, g, b));
});
window.addEventListener('contextmenu', (e) => { e.preventDefault(); window.picker.done(null); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.picker.done(null); });
