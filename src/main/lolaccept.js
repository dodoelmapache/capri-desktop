'use strict';

// Auto-accept for League of Legends ("partida encontrada"): when the queue pops she presses ACCEPT for you, a second
// or so later (like a person would), so a coffee break does not cost you the match.
// She uses the League client's own local API (LCU, https://127.0.0.1:<port>, only on this PC, password in the client's
// "lockfile"): the same one lots of tools use. She never reads the game or your screen and only presses the accept button
// of the ready check; she does not queue, pick champions or decide anything else for you. Off until config lolAutoAccept is true
// ("capri, activa la aceptación automática del LoL"). It is an unofficial API: Riot does not support it, but it does not touch the game.

const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

const IDLE_MS = 5000;   // the client is closed or the feature is off: look again in a few seconds (a file check, nothing more)
const LIVE_MS = 1000;   // the client is open and you are queuing: look every second
const DEFAULT_DIRS = ['C:\\Riot Games\\League of Legends', 'D:\\Riot Games\\League of Legends', 'E:\\Riot Games\\League of Legends', 'C:\\Program Files\\Riot Games\\League of Legends', 'C:\\Program Files (x86)\\Riot Games\\League of Legends'];

const log = (line) => {
  try {
    const dir = path.join(__dirname, '..', '..', '_logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'lol.log'), `${new Date().toISOString()} accept: ${line}\n`);
  } catch { /* a packaged app cannot write there */ }
};

// where League is installed: config lolPath, then Riot's own settings file, then the usual folders
function installDirs(cfg) {
  const dirs = [];
  if (cfg?.lolPath) dirs.push(String(cfg.lolPath));
  try {
    const pd = process.env.ProgramData || 'C:\\ProgramData';
    const f = path.join(pd, 'Riot Games', 'Metadata', 'league_of_legends.live', 'league_of_legends.live.product_settings.yaml');
    const m = /product_install_full_path:\s*"?([^"\r\n]+?)"?\s*$/m.exec(fs.readFileSync(f, 'utf8'));
    if (m) dirs.push(m[1].replace(/\//g, '\\'));
  } catch { /* not installed that way */ }
  return [...new Set([...dirs, ...DEFAULT_DIRS])];
}

// the client writes "LeagueClient:pid:port:password:https" while it is open
function readLock(cfg) {
  for (const dir of installDirs(cfg)) {
    try {
      const [, , port, password] = fs.readFileSync(path.join(dir, 'lockfile'), 'utf8').trim().split(':');
      if (port && password) return { port: Number(port), password };
    } catch { /* no lockfile here */ }
  }
  return null;
}

function call(lock, method, pathname, timeout = 2500) {
  return new Promise((resolve) => {
    const req = https.request({
      host: '127.0.0.1', port: lock.port, path: pathname, method, rejectUnauthorized: false, timeout, agent: false,
      headers: { Authorization: `Basic ${Buffer.from(`riot:${lock.password}`).toString('base64')}`, Accept: 'application/json', 'Content-Length': 0 },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
      res.on('end', () => { let json = null; try { json = JSON.parse(body); } catch { /* empty body */ } resolve({ status: res.statusCode, json }); });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', (e) => resolve({ error: e.code || String(e.message) }));
    req.end();
  });
}

// { getCfg, onAccepted() }  ->  { stop(), status() }
function start({ getCfg, onAccepted }) {
  let timer = null;
  let stopped = false;
  let lock = null;
  let acceptedThis = false;   // this ready check is already pressed
  let pending = false;        // waiting the human-looking second before pressing
  let phase = '';
  let total = 0;

  const next = (ms) => { if (!stopped) { timer = setTimeout(tick, ms); timer.unref?.(); } };

  async function tick() {
    const cfg = getCfg() || {};
    if (cfg.lolAutoAccept !== true) { lock = null; return next(IDLE_MS); }
    if (!lock) lock = readLock(cfg);
    if (!lock) { phase = ''; return next(IDLE_MS); }
    const ph = await call(lock, 'GET', '/lol-gameflow/v1/gameflow-phase');
    if (ph.error || ph.status !== 200) { lock = null; phase = ''; return next(IDLE_MS); } // the client closed (or the lockfile is old)
    phase = String(ph.json || '');
    if (phase !== 'ReadyCheck') { acceptedThis = false; pending = false; return next(phase === 'Matchmaking' || phase === 'Lobby' ? LIVE_MS : 2500); }
    if (acceptedThis || pending) return next(LIVE_MS);
    const rc = await call(lock, 'GET', '/lol-matchmaking/v1/ready-check');
    // only if you have not answered yourself: if you pressed decline she does not press accept behind your back
    if (rc.status === 200 && rc.json?.state === 'InProgress' && rc.json?.playerResponse === 'None') {
      pending = true;
      const wait = Math.max(0, Math.min(5, Number(cfg.lolAcceptDelay ?? 1))) * 1000 + Math.round(Math.random() * 600);
      setTimeout(async () => {
        const again = lock ? await call(lock, 'GET', '/lol-matchmaking/v1/ready-check') : null;
        if (again?.status === 200 && again.json?.state === 'InProgress' && again.json?.playerResponse === 'None') {
          const res = await call(lock, 'POST', '/lol-matchmaking/v1/ready-check/accept');
          if (res.status === 204 || res.status === 200) { acceptedThis = true; total += 1; log(`accepted (#${total})`); try { onAccepted?.(); } catch { /* the card is not important */ } }
          else log(`accept failed: ${res.status || res.error}`);
        }
        pending = false;
      }, wait).unref?.();
    }
    return next(LIVE_MS);
  }
  next(3000);
  return { stop: () => { stopped = true; clearTimeout(timer); }, status: () => ({ client: Boolean(lock), phase, accepted: total }) };
}

module.exports = { start, readLock, installDirs };
