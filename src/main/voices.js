'use strict';

// Her voice presets ("prueba la voz de Salomé", "usa esta voz", "vuelve a la voz de antes"): the Edge voice, its speed and its pitch.
// The voice she had when you first tried one is saved as "original" (config.voiceOriginal, and a copy in _versions\voz-original.json),
// so "vuelve a la voz de antes" always brings it back exactly. Trying a voice does not change anything; only "usa esta voz" does.

const fs = require('node:fs');
const path = require('node:path');

// the flirtier ones a little slower and lower than her usual (+14 % and +10 Hz, bright and quick)
const PRESETS = {
  salome: { label: 'Salomé (Colombia)', edgeVoice: 'es-CO-SalomeNeural', edgeRate: '-3%', edgePitch: '-2Hz' },
  dalia: { label: 'Dalia (México)', edgeVoice: 'es-MX-DaliaNeural', edgeRate: '-4%', edgePitch: '-2Hz' },
  elena: { label: 'Elena (Argentina)', edgeVoice: 'es-AR-ElenaNeural', edgeRate: '-3%', edgePitch: '-1Hz' },
  paloma: { label: 'Paloma (EE. UU., latina)', edgeVoice: 'es-US-PalomaNeural', edgeRate: '-3%', edgePitch: '-2Hz' },
  paola: { label: 'Paola (Venezuela), más lenta y grave', edgeVoice: 'es-VE-PaolaNeural', edgeRate: '-3%', edgePitch: '-3Hz' },
};
const ALIASES = { coqueta: 'salome', salomé: 'salome', salome: 'salome', dalia: 'dalia', elena: 'elena', paloma: 'paloma', paola: 'paola' };

const KEYS = ['edgeVoice', 'edgeRate', 'edgePitch'];
const pickVoice = (cfg) => ({ edgeVoice: cfg.edgeVoice || '', edgeRate: cfg.edgeRate ?? '+14%', edgePitch: cfg.edgePitch ?? '+10Hz' });

// Called before anything changes: keeps the voice she has now, once
function ensureOriginal(config) {
  const cfg = config.load();
  if (cfg.voiceOriginal) return cfg.voiceOriginal;
  const original = pickVoice(cfg);
  config.save({ voiceOriginal: original });
  try {
    const dir = path.join(__dirname, '..', '..', '_versions');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'voz-original.json'), JSON.stringify({ saved: new Date().toISOString(), ...original }, null, 2));
  } catch { /* a packaged app cannot write there */ }
  return original;
}

// { label, override } for a name ('original' too), or null
function preset(config, raw) {
  const name = String(raw || '').toLowerCase().normalize('NFC').trim();
  if (name === 'original' || name === 'actual' || name === 'anterior') {
    const o = ensureOriginal(config);
    return { name: 'original', label: 'tu voz de siempre', override: o };
  }
  const key = ALIASES[name] || ALIASES[name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')];
  const p = key && PRESETS[key];
  if (!p) return null;
  ensureOriginal(config);
  return { name: key, label: p.label, override: Object.fromEntries(KEYS.map((k) => [k, p[k]])) };
}

// keeps a voice (only the three things a voice is made of)
function save(config, override) {
  ensureOriginal(config);
  const patch = {};
  for (const k of KEYS) if (override && k in override) patch[k] = String(override[k]);
  config.save(patch);
  return pickVoice(config.load());
}

// back to the voice she had
function back(config) {
  const cfg = config.load();
  const o = cfg.voiceOriginal;
  if (!o) return { ok: true, already: true };
  const now = pickVoice(cfg);
  const same = KEYS.every((k) => String(now[k]) === String(o[k]));
  config.save(Object.fromEntries(KEYS.map((k) => [k, o[k]])));
  return { ok: true, already: same };
}

// the voice for her flirty moments (config flirtVoice: a preset; flirtVoiceMode false turns it off): the override the overlay speaks those lines with
function flirtOverride(cfg) {
  if (cfg.flirtVoiceOn !== true) return null; // (off by default: her usual voice says everything; "activa la voz coqueta" turns it on)
  const p = PRESETS[cfg.flirtVoice] || PRESETS.salome;
  return Object.fromEntries(KEYS.map((k) => [k, p[k]]));
}
const resolveKey = (raw) => {
  const name = String(raw || '').toLowerCase().trim();
  return ALIASES[name] || ALIASES[name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')] || null;
};

const list = () => Object.entries(PRESETS).map(([key, p]) => ({ key, label: p.label }));
const clean = (override) => Object.fromEntries(KEYS.filter((k) => override && typeof override[k] === 'string').map((k) => [k, override[k].slice(0, 60)]));

module.exports = { PRESETS, preset, save, back, list, clean, ensureOriginal, flirtOverride, resolveKey };
