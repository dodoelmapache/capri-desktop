// Her sprite-sheet body: the drawn animations in assets/sprites (idle, blink, perch, sleep, wake, dangle, dance, glitch, grin, mouth...),
// played on a 2D canvas that sits exactly over the shader's canvas and shares its transform (flip, lean, squash, bob).
//
// The two bodies are different drawings of her, so the sprite frames are registered to the shader's landmarks (sprite px, see sprite.js):
//  - standing: her face on SPRITE.head and her feet on SPRITE.feet.y
//  - perched:  her face on SPRITE.head.x and her seat on SPRITE.hip (the ledge), so she neither floats nor sinks into a window
// One scale for all of them (K), so she does not change size when she sits, wakes or is picked up.
// Everything the strips cannot do (arm acts, lightning, teleport, the biochip) stays with the shader: capri.js decides frame by frame
// and cross-fades between the two. Off with config.sprites = false (her menu: "Sprites nuevos").

import { SPRITE } from './sprite.js';

export const K = 1.22; // sprite-sheet px -> her sprite px (same drawn size as the shader body: head to feet matches)
const FRAME_H = 384;
const STAND = { x: SPRITE.head.x - 127.8 * K, y: SPRITE.feet.y - 367 * K }; // eyes at x = 127.8, feet at y = 367 in the strips
const SIT = { x: SPRITE.head.x - 168 * K, y: SPRITE.hip - 299 * K };         // eyes at x = 168, her seat at y = 299 in the perch strips
export const SIT_HEAD = { x: SPRITE.head.x, y: 201 * K + SIT.y };            // where her face is on the ledge (bubbles and effects follow it)

// name: [frames, fps, frame width, registration]
const CLIPS = {
  idle: [16, 8, 240, STAND],
  blink: [4, 8, 240, STAND],
  blink_glitch: [4, 8, 240, STAND],
  grin: [16, 8, 240, STAND],
  glitch: [10, 15, 240, STAND],
  dangle: [24, 10, 240, STAND],
  sleep: [16, 6, 240, STAND],
  wake: [13, 15, 240, STAND],
  walk: [12, 12, 240, STAND],
  dance: [16, 10, 240, STAND],
  mouth: [5, 12, 240, STAND],
  perch: [16, 8, 384, SIT],
  perch_blink: [4, 8, 384, SIT],
  perch_blink_glitch: [4, 8, 384, SIT],
  perch_glitch: [10, 15, 384, SIT],
  perch_dance: [16, 10, 384, SIT],
};
const BLINK_FROM = 9; // the blink drawings replace cells 9..12 of an idle cycle
const MOUTH = [0, 2, 3, 1, 4, 2, 0, 3, 1, 2]; // shapes while she talks (0 closed ... 4 wide)

export class SpriteBody {
  constructor(root, glCanvas) {
    this.ready = false;
    this.scale = null;
    this.frames = {}; // clip -> ImageBitmap[]
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'capri__sprite capri__frames';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;opacity:0';
    root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.gl = glCanvas;
    this.reset(performance.now());
  }

  reset(now) {
    this.clip = '';
    this.t0 = now;
    this.shot = null;        // a one-shot drawing over the base one: { clip, t0 }
    this.cycle = -1;
    this.blink = null;       // 'blink' | 'blink_glitch' | null, for the current idle cycle
    this.nextGlitch = now + 20000 + Math.random() * 30000;
    this.wasSleeping = false;
    this.sitting = false;
  }

  // every strip, cut into frames, in memory before she needs them
  async load(base) {
    try {
      await Promise.all(Object.entries(CLIPS).map(async ([name, [count, , width]]) => {
        const img = new Image();
        img.src = `${base}/${name}.png`;
        await img.decode();
        if (img.naturalWidth < count * width - 2 || img.naturalHeight !== FRAME_H) throw new Error(`${name}.png is not ${count} x ${width}`);
        this.frames[name] = await Promise.all(Array.from({ length: count }, (_, i) => createImageBitmap(img, i * width, 0, width, FRAME_H)));
      }));
      this.ready = true;
    } catch (err) {
      console.error('[capri] sprites not loaded:', err);
      this.ready = false;
    }
    return this.ready;
  }

  resize(scale) {
    this.scale = scale;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round((SPRITE.width + SPRITE.pad * 2) * scale);
    const height = Math.round((SPRITE.height + SPRITE.pad * 2) * scale);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
  }

  // a one-shot reaction (a grin when you click her)
  react(name, now = performance.now()) {
    if (name === 'grin' && !this.sitting && !this.shot) this.shot = { clip: 'grin', t0: now, cells: CLIPS.grin[0] * 2 };
    if (name === 'glitch' && !this.shot) this.shot = { clip: this.sitting ? 'perch_glitch' : 'glitch', t0: now };
  }

  // choose and draw this frame. c: { stance, sleeping, dragging, walking, talking, dance, alpha, still }
  frame(now, c) {
    const sitting = c.stance === 'sit';
    if (sitting !== this.sitting) { this.sitting = sitting; this.shot = null; this.clip = ''; }
    const base = this.pickBase(now, c, sitting);
    if (base !== this.clip) { this.clip = base; this.t0 = now; this.cycle = -1; }
    let name = this.clip;
    let cell = c.still ? 0 : Math.floor(((now - this.t0) / 1000) * CLIPS[name][1]);
    let mouth = -1;

    // a one-shot drawing (wake, glitch, grin) on top of the base one
    if (this.shot && !c.dragging) {
      const [count, fps] = CLIPS[this.shot.clip];
      const i = Math.floor(((now - this.shot.t0) / 1000) * fps);
      if (i >= (this.shot.cells || count)) this.shot = null;
      else { name = this.shot.clip; cell = i % count; }
    } else if (this.shot) this.shot = null;

    if (!this.shot && (name === 'idle' || name === 'perch')) {
      const [count] = CLIPS[name];
      const cycle = Math.floor(cell / count);
      if (cycle !== this.cycle) { // a new breath: blink, glitch-blink or nothing
        this.cycle = cycle;
        const roll = Math.random();
        this.blink = roll < 0.1 ? 'blink_glitch' : roll < 0.55 ? 'blink' : null;
        if (now >= this.nextGlitch && !c.talking && !c.dance) {
          this.nextGlitch = now + 30000 + Math.random() * 30000;
          this.shot = { clip: sitting ? 'perch_glitch' : 'glitch', t0: now };
        }
      }
      cell %= count;
      if (this.shot) { name = this.shot.clip; cell = 0; }
      else if (this.blink && cell >= BLINK_FROM && cell < BLINK_FROM + CLIPS.blink[0]) {
        name = sitting ? `perch_${this.blink}` : this.blink;
        cell -= BLINK_FROM;
      } else if (c.talking && !sitting) mouth = MOUTH[Math.floor(now / 83) % MOUTH.length];
    } else if (!this.shot) cell %= CLIPS[name][0];

    this.draw(name, cell, mouth, c.alpha);
  }

  // what she is doing underneath: her stance and mood decide the base drawing
  pickBase(now, c, sitting) {
    const was = this.wasSleeping;
    this.wasSleeping = Boolean(c.sleeping);
    if (c.dragging || c.stance === 'fall') return 'dangle';
    if (c.walking && !sitting) return 'walk';
    if (c.sleeping && !sitting) return 'sleep';
    if (was && !c.sleeping && !sitting && !c.still) this.shot = { clip: 'wake', t0: now };
    if (c.dance && !c.talking) return sitting ? 'perch_dance' : 'dance';
    return sitting ? 'perch' : 'idle';
  }

  draw(name, cell, mouth, alpha = 1) {
    const frames = this.frames[name];
    const bitmap = frames?.[cell % frames.length];
    if (!bitmap) return;
    const { ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const sc = this.scale * dpr;
    const reg = CLIPS[name][3];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(sc, 0, 0, sc, SPRITE.pad * sc, SPRITE.pad * sc);
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, reg.x, reg.y, bitmap.width * K, FRAME_H * K);
    if (mouth >= 0) {
      const lips = this.frames.mouth?.[mouth];
      if (lips) ctx.drawImage(lips, STAND.x, STAND.y, lips.width * K, FRAME_H * K);
    }
    ctx.globalAlpha = 1;
  }

  // is there body at this point (sprite px, un-flipped)? What is drawn on the canvas right now answers.
  hit(sx, sy, reach = 7) {
    if (!this.scale) return false;
    const dpr = window.devicePixelRatio || 1;
    const sc = this.scale * dpr;
    for (const [dx, dy] of [[0, 0], [reach, 0], [-reach, 0], [0, reach], [0, -reach]]) {
      const px = Math.round((sx + dx + SPRITE.pad) * sc);
      const py = Math.round((sy + dy + SPRITE.pad) * sc);
      if (px < 0 || py < 0 || px >= this.canvas.width || py >= this.canvas.height) continue;
      try { if (this.ctx.getImageData(px, py, 1, 1).data[3] > 40) return true; } catch { return false; }
    }
    return false;
  }
}
