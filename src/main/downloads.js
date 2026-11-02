'use strict';

// Her watch over Downloads: when a handful of new files have piled up there (and nothing has arrived for a minute), she tells you and offers to
// organize them with your own script. She never moves anything herself: the offer is a card with buttons. She reads only the file NAMES that appear.
// config.downloadsWatch (default true) turns it off; config.downloadsMin how many new files make her speak (default 4).
// After an offer she waits half an hour before the next one.

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const PARTIAL = /\.(crdownload|part|partial|tmp|download|opdownload|aria2)$/i;
const SETTLE_MS = 6000;      // a file must stay unchanged this long to count (it may still be downloading)
const QUIET_MS = 60 * 1000;  // nothing new for this long before she speaks
const COOLDOWN_MS = 30 * 60 * 1000;

let watcher = null;
let timers = new Map();      // name -> settle timer
let ready = new Map();       // name -> { size }
let quietTimer = null;
let lastOffer = 0;

function stop() {
  try { watcher?.close(); } catch { /* already closed */ }
  watcher = null;
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  ready.clear();
  clearTimeout(quietTimer);
}

// { config, onNew({ count, names }) }
function setup({ config, onNew, onFile }) {
  const dir = app.getPath('downloads');
  const cfg = () => config.load();
  const offer = () => {
    const c = cfg();
    const min = Math.max(2, Number(c.downloadsMin) || 4);
    if (c.downloadsWatch === false || ready.size < min || Date.now() - lastOffer < COOLDOWN_MS) return;
    const names = [...ready.keys()];
    ready.clear();
    lastOffer = Date.now();
    onNew({ count: names.length, names: names.slice(0, 3) });
  };
  const settle = (name) => {
    clearTimeout(timers.get(name));
    timers.set(name, setTimeout(() => {
      timers.delete(name);
      const full = path.join(dir, name);
      try {
        const st = fs.statSync(full);
        if (!st.isFile() || !st.size) { ready.delete(name); return; }
        if (!ready.has(name)) { try { onFile?.(full); } catch { /* the scan is optional */ } } // (a new, finished file: Defender looks at it, avscan.js)
        ready.set(name, { size: st.size });
        clearTimeout(quietTimer);
        quietTimer = setTimeout(offer, QUIET_MS);
      } catch {
        ready.delete(name); // gone: moved or deleted (your organizer, for one)
      }
    }, SETTLE_MS));
  };
  try {
    watcher = fs.watch(dir, { persistent: false }, (_evt, name) => {
      if (!name || cfg().downloadsWatch === false) return;
      if (PARTIAL.test(name) || name.startsWith('.') || name.startsWith('~$') || /^desktop\.ini$/i.test(name)) return;
      settle(name);
    });
    watcher.on('error', () => stop());
  } catch (err) {
    console.error('[capri] downloads watch:', err.message);
  }
  app.on('before-quit', stop);
}

module.exports = { setup, stop };
