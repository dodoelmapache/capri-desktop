'use strict';

// The dominant colours of a picture, from its pixels: no model, no network, instant. Used by her scanner's PALETA button and for
// pictures you attach and ask the palette of. Colours are grouped in coarse buckets (16 levels per channel), the most common
// distinct ones are kept (two close shades count as one), and each is the true average of everything near it.

const MIN_DISTANCE = 52; // between two chosen colours, in RGB steps: closer than this and they are "the same colour"
const SAMPLES = 60000;   // enough pixels to know a picture; the rest add nothing but time

const hex2 = (n) => n.toString(16).padStart(2, '0').toUpperCase();
const toHex = (r, g, b) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

// WCAG relative luminance, to know which text colour reads on top of it
function luminance(r, g, b) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const contrast = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

// buf: raw pixels, 4 bytes each (BGRA like Electron's toBitmap(), or RGBA with { bgra: false })
function extract(buf, width, height, { k = 5, bgra = true } = {}) {
  const total = width * height;
  if (!total || buf.length < total * 4) return [];
  const step = Math.max(1, Math.floor(Math.sqrt(total / SAMPLES)));
  const buckets = new Map();
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (buf[i + 3] < 200) continue; // transparent: not a colour of the picture
      const r = bgra ? buf[i + 2] : buf[i];
      const g = buf[i + 1];
      const b = bgra ? buf[i] : buf[i + 2];
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const cur = buckets.get(key);
      if (cur) {
        cur.n += 1;
        cur.r += r;
        cur.g += g;
        cur.b += b;
      } else buckets.set(key, { n: 1, r, g, b });
    }
  }
  const all = [...buckets.values()].map((c) => ({ n: c.n, r: c.r / c.n, g: c.g / c.n, b: c.b / c.n })).sort((a, b) => b.n - a.n);
  if (!all.length) return [];
  const dist = (p, q) => Math.hypot(p.r - q.r, p.g - q.g, p.b - q.b);
  const chosen = [];
  for (const c of all) {
    if (chosen.every((p) => dist(p, c) >= MIN_DISTANCE)) chosen.push({ r: c.r, g: c.g, b: c.b });
    if (chosen.length === k) break;
  }
  // everything counts for its nearest chosen colour; each colour becomes the average of its own
  const acc = chosen.map(() => ({ n: 0, r: 0, g: 0, b: 0 }));
  let sampled = 0;
  for (const c of all) {
    let best = 0;
    for (let j = 1; j < chosen.length; j++) if (dist(chosen[j], c) < dist(chosen[best], c)) best = j;
    acc[best].n += c.n;
    acc[best].r += c.r * c.n;
    acc[best].g += c.g * c.n;
    acc[best].b += c.b * c.n;
    sampled += c.n;
  }
  const white = luminance(255, 255, 255);
  return acc
    .filter((a) => a.n)
    .map((a) => {
      const r = Math.round(a.r / a.n);
      const g = Math.round(a.g / a.n);
      const b = Math.round(a.b / a.n);
      const l = luminance(r, g, b);
      return { hex: toHex(r, g, b), r, g, b, share: a.n / sampled, on: contrast(l, white) >= contrast(l, 0) ? '#FFFFFF' : '#000000' };
    })
    .sort((p, q) => q.share - p.share);
}

module.exports = { extract, toHex, luminance, contrast };
