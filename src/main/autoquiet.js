'use strict';

// Automatic quiet ("silencio automático"): she keeps quiet by herself, like her do-not-disturb button, while something is going on that she must not step on:
//   call   – a program other than her is using the microphone (a video call, Meet in a browser, Discord voice...). Windows keeps that record in the registry
//            (ConsentStore\microphone: an app that is listening right now has LastUsedTimeStop = 0). Only program names are read, nothing of what is said.
//   record – she is recording the screen
//   game   – a game or a full-screen program (a slideshow) has the screen
// It sets config.dndAuto ('' or e.g. 'call,record'); talk.js and ambient.js treat it as do-not-disturb. Your own switch (config.dnd) is untouched.
// Off with config.autoQuiet = false. What it decided, and why, is in _logs/autoquiet.log.

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';
const SELF = /capri|electron/i; // (her own listening, for "Capri" and your voice orders)
const NOISE = /cortana|searchapp|searchhost|speechruntime|gamebar|xbox|backgroundtask|textinputhost|shellexperience|riotclient|riot games|league of legends|leagueclient|vanguard|vgc/i; // (League's own client keeps the microphone open for its voice chat: that is the game, not a call)
const EVERY_MS = 5000;
const CALM_POLLS = 2; // it must stay clear this many looks in a row before she speaks again (a call that blips off for a second)

const log = (line) => {
  try {
    const dir = path.join(__dirname, '..', '..', '_logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'autoquiet.js'.replace('.js', '.log')), `${new Date().toISOString()} ${line}\n`);
  } catch { /* a packaged app cannot write there */ }
};

// the programs that have the microphone open right now (names only), [] if it cannot be read
function micUsers() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve([]); return; }
    execFile('reg', ['query', KEY, '/s'], { windowsHide: true, timeout: 4000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
      if (err || !out) { resolve([]); return; }
      const users = [];
      let name = '';
      let start = 0n;
      let stop = 1n;
      const flush = () => { if (name && start !== 0n && stop === 0n) users.push(name); };
      for (const raw of String(out).split(/\r?\n/)) {
        if (/^HKEY/i.test(raw)) {
          flush();
          const last = raw.split('\\').pop() || '';
          name = last === 'NonPackaged' || last === 'microphone' ? '' : last.replace(/#/g, '\\');
          start = 0n;
          stop = 1n;
          continue;
        }
        const m = /^\s*(LastUsedTimeStart|LastUsedTimeStop)\s+REG_QWORD\s+(0x[0-9a-fA-F]+)/.exec(raw);
        if (!m) continue;
        try { if (m[1] === 'LastUsedTimeStart') start = BigInt(m[2]); else stop = BigInt(m[2]); } catch { /* not a number */ }
      }
      flush();
      resolve(users);
    });
  });
}

// { getCfg, game(), recording(), onChange(reason) }  ->  { stop() }
function start({ getCfg, game, recording, onChange }) {
  let current = '';
  let calm = 0;
  let busy = false;
  const look = async () => {
    if (busy) return;
    busy = true;
    try {
      if (getCfg().autoQuiet === false) {
        if (current) { current = ''; onChange(''); log('switched off in config: she may talk'); }
        return;
      }
      const why = [];
      const mics = (await micUsers()).filter((n) => !SELF.test(n) && !NOISE.test(n));
      if (mics.length) why.push('call');
      if (recording?.()) why.push('record');
      if (game?.()) why.push('game');
      const reason = why.join(',');
      if (reason) {
        calm = 0;
        if (reason !== current) { current = reason; onChange(reason); log(`quiet: ${reason}${mics.length ? ` (mic: ${mics.map((n) => n.split('\\').pop()).join(', ')})` : ''}`); }
      } else if (current && ++calm >= CALM_POLLS) {
        current = '';
        onChange('');
        log('clear: she may talk');
      }
    } finally { busy = false; }
  };
  const timer = setInterval(look, EVERY_MS);
  timer.unref?.();
  look();
  return { stop() { clearInterval(timer); } };
}

module.exports = { start, micUsers };
