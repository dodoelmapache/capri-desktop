'use strict';

// Light mode for heavy programs ("modo ligero"): while a game or a heavy program has the PC, she stays out of its way.
//   · her big local model leaves memory (Ollama, keep_alive 0) and she talks with a small one meanwhile (config heavyModel,
//     else the smallest installed); it runs on the CPU so the video memory stays with the game (config heavyCpuOnly = false to change that)
//   · nothing is preloaded, and what she loads leaves memory 30 s after her last answer (ollama.js, "lean")
//   · when the program closes she goes back to your model by herself (it loads the next time you talk to her)
// Which programs count: config.heavyApps, a list of names ("league of legends", "blender"...; part of the program's name is enough, spaces and case do not matter).
// A full-screen program that is not a browser (what autoquiet.js calls "game") counts too, whatever it is.
// Off with config.heavyMode = false. What she decided, and why, is in _logs/heavy.log.

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const ollama = require('./ollama');

const DEFAULT_APPS = [
  'league of legends', 'valorant', 'cs2', 'dota2', 'fortniteclient', 'overwatch', 'apex', 'rocketleague', 'eldenring', 'gta5',
  'blender', 'fusion360', 'premiere', 'afterfx', 'resolve', 'illustrator',
];
// the games among them (what is not here, like Blender or Fusion, is a tool: she keeps her model out of its way but draws as usual)
const GAME_APPS = ['league of legends', 'valorant', 'cs2', 'dota2', 'fortniteclient', 'overwatch', 'apex', 'rocketleague', 'eldenring', 'gta5'];
const EVERY_MS = 6000;
const CALM_POLLS = 3; // clear this many looks in a row (≈18 s) before she lets go of the light mode
const CALM_POLLS_FULLSCREEN = 10; // (a full-screen program that is not on the list: alt-tab must not make her load and unload her model again and again)

const norm = (s) => String(s || '').toLowerCase().replace(/\.exe$/, '').replace(/[^a-z0-9]/g, '');

const log = (line) => {
  try {
    const dir = path.join(__dirname, '..', '..', '_logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'heavy.log'), `${new Date().toISOString()} ${line}\n`);
  } catch { /* a packaged app cannot write there */ }
};

// the programs running now (lowercase, no .exe); [] if the list cannot be read
function processes() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve([]); return; }
    execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      if (err || !out) { resolve([]); return; }
      const names = new Set();
      for (const line of String(out).split(/\r?\n/)) {
        const m = /^"([^"]+)"/.exec(line);
        if (m) names.add(m[1].toLowerCase().replace(/\.exe$/, ''));
      }
      resolve([...names]);
    });
  });
}

// The list of heavy programs: the built-in ones (DEFAULT_APPS) you have not switched off (config heavyOff) and the ones you added (config heavyExtra).
// (Before, one list was kept and removing a program lost it for good; heavyApps, that old list, only lends its added programs.)
const legacyExtras = (cfg) => (Array.isArray(cfg.heavyApps) ? cfg.heavyApps : []).filter((n) => !DEFAULT_APPS.some((d) => norm(d) === norm(n)));
const extrasOf = (cfg) => (Array.isArray(cfg.heavyExtra) ? cfg.heavyExtra : legacyExtras(cfg)).map(String).filter((s) => norm(s));
const offOf = (cfg) => (Array.isArray(cfg.heavyOff) ? cfg.heavyOff : []).map(norm);
const allOf = (cfg) => [...DEFAULT_APPS.map((name) => ({ name, builtin: true })), ...extrasOf(cfg).map((name) => ({ name, builtin: false }))]
  .map((a) => ({ ...a, on: !offOf(cfg).includes(norm(a.name)) }));
const listOf = (cfg) => allOf(cfg).filter((a) => a.on).map((a) => a.name);

// which of the running programs are on the list
function matches(running, cfg) {
  const wanted = listOf(cfg).map(norm);
  // (a helper of the program is not the program: blender-mcp is a server that stays up all day, blender-launcher a launcher)
  return running.filter((name) => { const n = norm(name); return n && !/mcp|launcher|crashhandler|updater/.test(n) && wanted.some((w) => n.startsWith(w)); });
}

// the small model: the one you chose (heavyModel) if it is installed, else gemma3:4b if installed, else the smallest one that talks
async function lightModel(cfg) {
  const list = await ollama.details();
  const chat = list.filter((m) => !/embed|rerank/i.test(m.name));
  if (cfg.heavyModel && chat.some((m) => m.name === cfg.heavyModel)) return cfg.heavyModel;
  const pref = chat.find((m) => /^gemma3:4b/.test(m.name)); // (small and talks well in Spanish: better than the very smallest one)
  if (pref) return pref.name;
  return chat.sort((a, b) => (a.size || Infinity) - (b.size || Infinity))[0]?.name || null;
}

// is this one a game? (the built-in games, or one you called "juego pesado")
const isGame = (name, cfg) => {
  const n = norm(name);
  return [...GAME_APPS, ...(Array.isArray(cfg.heavyGames) ? cfg.heavyGames : [])].some((g) => norm(g) && n.startsWith(norm(g)));
};

const state = { active: false, apps: [], reason: '', light: null, since: 0, running: [], game: false };
const listeners = [];

// { getCfg, game() -> the front program when a game / full-screen program has the screen (else ''), onChange(state) }
function start({ getCfg, game, onChange }) {
  let calm = 0;
  let busy = false;
  const look = async () => {
    if (busy) return;
    busy = true;
    try {
      const cfg = getCfg();
      const running = await processes();
      state.running = running;
      for (const fn of listeners) { try { fn(running); } catch { /* a listener's problem */ } }
      const apps = cfg.heavyMode === false ? [] : matches(running, cfg);
      const front = cfg.heavyMode === false ? '' : String(game?.() || '');
      const reason = apps.length ? 'program' : front ? 'fullscreen' : '';
      if (reason) {
        calm = 0;
        const shown = apps.length ? apps : [front];
        const game = reason === 'fullscreen' || apps.some((a) => isGame(a, cfg));
        if (state.active && (state.game !== game || state.apps.join() !== shown.join())) {
          // what keeps her out of the way changed (a game opened over a heavy program already there, or closed): she follows
          Object.assign(state, { apps: shown, reason, game });
          log(`light mode: now ${shown.join(', ')} (${reason})${game ? ' · a game: drawn at few frames' : ''}`);
          onChange?.({ ...state });
        }
        if (!state.active) {
          let light = null;
          try { light = await lightModel(cfg); } catch { /* Ollama is off: nothing to switch */ }
          Object.assign(state, { active: true, apps: shown, reason, light, since: Date.now(), game });
          ollama.setLean(true, { cpuOnly: cfg.heavyCpuOnly !== false });
          const out = [];
          for (const name of await ollama.loaded()) { if (name !== light && await ollama.unload(name)) out.push(name); }
          log(`light mode ON: ${state.apps.join(', ')} (${reason}) · small model: ${light || 'none'}${out.length ? ` · out of memory: ${out.join(', ')}` : ''}`);
          onChange?.({ ...state });
        }
      } else if (state.active && ++calm >= (state.reason === 'fullscreen' ? CALM_POLLS_FULLSCREEN : CALM_POLLS)) {
        const light = state.light;
        Object.assign(state, { active: false, apps: [], reason: '', light: null, since: 0, game: false });
        ollama.setLean(false);
        if (light) ollama.unload(light);
        log('light mode OFF: she goes back to her usual model');
        onChange?.({ ...state });
      }
    } catch (err) {
      log(`error: ${err.message}`);
    } finally { busy = false; }
  };
  const timer = setInterval(look, EVERY_MS);
  timer.unref?.();
  look();
  return { stop() { clearInterval(timer); }, look };
}

// lol.js and others hear the list of running programs at every look
const onProcesses = (fn) => { listeners.push(fn); };
const isRunning = (re) => state.running.some((n) => re.test(n));

module.exports = { start, state: () => ({ ...state }), onProcesses, isRunning, norm, listOf, allOf, extrasOf, matches, isGame, DEFAULT_APPS, GAME_APPS, lightModel };
