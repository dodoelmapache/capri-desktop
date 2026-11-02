'use strict';

// Images through YOUR Gemini (gemini.google.com, with your Plus), not through the API key: she opens a Chrome of her own
// (its own profile folder, so your normal Chrome is not touched), types the request in Gemini as you would, waits for the picture and saves it.
// The first time Gemini asks you to sign in: do it once in that window and ask again; the login stays in her profile.
// It drives the web page, so it is slower than the API (20-60 s) and can break if Google changes the page.
// Talks to Chrome through its debugging port (CDP) on this PC only (127.0.0.1).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const PORT = 9333;
const PROFILE = path.join(os.homedir(), '.capri', 'gemini-profile');
const MARK = path.join(os.homedir(), '.capri', 'gemini-signed-in'); // written once a picture came out: from then on her Chrome runs with no window at all
const log = (line) => { try { const d = path.join(__dirname, '..', '..', '_logs'); fs.mkdirSync(d, { recursive: true }); fs.appendFileSync(path.join(d, 'gemini.log'), `${new Date().toISOString()} ${line}\n`); } catch { /* a packaged app cannot write there */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chromePath() {
  const dirs = [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
  const rel = ['Google\\Chrome\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe'];
  for (const r of rel) for (const d of dirs) { const f = path.join(d, r); if (fs.existsSync(f)) return f; }
  return null;
}

function req(method, urlPath, timeout = 3000) {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, timeout }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(b || null); } });
    });
    r.on('timeout', () => r.destroy());
    r.on('error', () => resolve(null));
    r.end();
  });
}

async function ensureBrowser({ visible = false } = {}) {
  if (await req('GET', '/json/version')) return { ok: true };
  const exe = chromePath();
  if (!exe) return { ok: false, error: 'no encuentro Chrome (ni Edge) en tu PC' };
  fs.mkdirSync(PROFILE, { recursive: true });
  // signed in already: no window at all (headless, with a normal browser name so Google does not mind). Not yet, or to sign in: a visible window.
  const hidden = !visible && fs.existsSync(MARK);
  if (visible && hidden) { /* (never) */ }
  const args = [`--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--window-size=1100,900',
    ...(hidden ? ['--headless=new', '--disable-gpu', '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'] : []), 'about:blank'];
  spawn(exe, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  for (let i = 0; i < 40; i++) { await sleep(500); if (await req('GET', '/json/version')) return { ok: true, hidden }; }
  return { ok: false, error: 'Chrome no abrió a tiempo' };
}

async function closeBrowser() {
  const v = await req('GET', '/json/version');
  if (!v?.webSocketDebuggerUrl) return;
  try { const b = await connect(v.webSocketDebuggerUrl); await b.send('Browser.close').catch(() => {}); b.close(); } catch { /* already gone */ }
  for (let i = 0; i < 20 && await req('GET', '/json/version'); i++) await sleep(300);
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const waiting = new Map();
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result); }
    };
    ws.onerror = () => reject(new Error('no pude hablar con Chrome'));
    ws.onopen = () => resolve({
      send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; waiting.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params })); }),
      close: () => { try { ws.close(); } catch { /* closed */ } },
    });
  });
}

const ev = async (c, expression) => {
  const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return r?.result?.value;
};

const EDITOR = `document.querySelector('rich-textarea .ql-editor, div.ql-editor[contenteditable="true"], div[role="textbox"][contenteditable="true"]')`;
const IMAGES = `Array.from(document.querySelectorAll('img')).filter((i) => i.naturalWidth >= 300 && /googleusercontent|^blob:/.test(i.src) && !i.closest('rich-textarea') && !i.closest('bard-avatar')).map((i) => i.src)`;

async function make({ prompt, outDir, timeout = 150000, lang = 'es', windowMode = 'show' }, retried = false) {
  const es = String(lang).startsWith('es');
  const L = (a, b) => (es ? a : b);
  const wantShow = windowMode !== 'hidden';
  let up = await ensureBrowser({ visible: wantShow });
  if (!up.ok) return { ok: false, error: up.error };
  const target = await req('PUT', `/json/new?${encodeURIComponent('https://gemini.google.com/app')}`, 8000);
  if (!target?.webSocketDebuggerUrl) return { ok: false, error: L('Chrome no me dejó abrir Gemini', 'Chrome would not open Gemini') };
  let c;
  let keep = false; // (signing in: the tab stays for you)
  const closeTab = () => { try { c?.close(); } catch { /* closed */ } req('GET', `/json/close/${target.id}`).catch(() => {}); };
  try {
    c = await connect(target.webSocketDebuggerUrl);
    await c.send('Runtime.enable');
    if (wantShow) {
      // her Chrome's window where you can see it (an old one may be sitting off the screen, or have no window at all)
      let shown = false;
      try { const w = await c.send('Browser.getWindowForTarget', { targetId: target.id }); await c.send('Browser.setWindowBounds', { windowId: w.windowId, bounds: { left: 120, top: 80, width: 1100, height: 900, windowState: 'normal' } }); shown = true; } catch { /* no window: it is the hidden kind */ }
      if (!shown && !retried) { closeTab(); await closeBrowser(); return make({ prompt, outDir, timeout, lang, windowMode }, true); }
      await c.send('Page.bringToFront').catch(() => {});
    }
    // wait for the box to write in; if there is none, Gemini wants you to sign in
    let ready = false;
    for (let i = 0; i < 50 && !ready; i++) { await sleep(500); ready = Boolean(await ev(c, `Boolean(${EDITOR})`)); if (!ready && i > 14 && /accounts\.google\.com/.test(String(await ev(c, 'location.href')))) break; }
    if (!ready) {
      try { const w = await c.send('Browser.getWindowForTarget', { targetId: target.id }); await c.send('Browser.setWindowBounds', { windowId: w.windowId, bounds: { left: 120, top: 80, width: 1100, height: 900, windowState: 'normal' } }); } catch { /* it stays where it is */ }
      if (up.hidden && !retried && !wantShow) { // the hidden one lost its login: close it and do it again with a window, to sign in
        try { fs.unlinkSync(MARK); } catch { /* no mark */ }
        closeTab(); await closeBrowser();
        return make({ prompt, outDir, timeout, lang }, true);
      }
      keep = true;
      return { ok: false, needLogin: true, error: L('Inicia sesión en Gemini en la ventana de Chrome que se abrió (una sola vez) y vuélveme a pedir la imagen', 'Sign in to Gemini in the Chrome window that just opened (once) and ask me again') };
    }
    log(`chrome: editor found at ${String(await ev(c, 'location.href'))}`);
    const before = new Set(await ev(c, `${IMAGES}`) || []);
    await ev(c, `(${EDITOR}).focus()`);
    await c.send('Input.insertText', { text: `${L('Crea una imagen: ', 'Create an image: ')}${prompt}` });
    await sleep(500);
    const clicked = await ev(c, `(() => { const b = document.querySelector('button.send-button, button[aria-label*="Enviar"], button[aria-label*="Send message"], button[aria-label*="Send"]'); if (b && !b.disabled) { b.click(); return true; } return false; })()`);
    if (!clicked) { for (const type of ['keyDown', 'keyUp']) await c.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: type === 'keyDown' ? '\r' : undefined }); }
    // wait for the picture
    const t0 = Date.now();
    let src = null;
    let lastText = '';
    while (Date.now() - t0 < timeout) {
      await sleep(2000);
      const now = await ev(c, `${IMAGES}`) || [];
      src = now.find((s) => !before.has(s));
      if (src) { await sleep(2500); break; } // (a moment more: the first one can be a preview)
      lastText = String(await ev(c, `(document.querySelector('model-response, .response-container, message-content')?.innerText || '').slice(-300)`) || '');
      if (Date.now() - t0 > 25000 && lastText && !(await ev(c, `Boolean(document.querySelector('button[aria-label*="Detener"], button[aria-label*="Stop"], .stop'))`))) break; // answered with words only
    }
    if (!src) {
      return { ok: false, error: lastText ? `Gemini: ${lastText.replace(/\s+/g, ' ').slice(0, 160)}` : L('Gemini no devolvió ninguna imagen', 'Gemini returned no image') };
    }
    const all = await ev(c, `${IMAGES}`) || [];
    src = all.filter((s) => !before.has(s)).pop() || src;
    const big = src.replace(/=s\d+(-[a-z0-9-]+)?$/i, '=s0');
    // 1) from inside the page without cookies (the picture's address is already signed), 2) from here with the browser's cookies, 3) a shot of the picture itself
    let data = await ev(c, `(async () => {
      const get = async (u, cred) => { const r = await fetch(u, { credentials: cred }); if (!r.ok) throw new Error(r.status); const b = await r.blob(); return await new Promise((ok) => { const f = new FileReader(); f.onload = () => ok(f.result); f.readAsDataURL(b); }); };
      for (const [u, cred] of [[${JSON.stringify(big)}, 'omit'], [${JSON.stringify(src)}, 'omit'], [${JSON.stringify(big)}, 'include']]) { try { return await get(u, cred); } catch { /* the next one */ } }
      return '';
    })()`);
    if (!/^data:image\//.test(String(data)) && /^https:/.test(src)) {
      try {
        const { cookies } = await c.send('Network.getCookies', { urls: ['https://lh3.googleusercontent.com/', 'https://gemini.google.com/', 'https://google.com/'] });
        const r = await fetch(big, { headers: { Cookie: cookies.map((k) => `${k.name}=${k.value}`).join('; '), 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', Referer: 'https://gemini.google.com/' } });
        if (r.ok) data = `data:${r.headers.get('content-type') || 'image/png'};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
      } catch { /* the shot */ }
    }
    if (!/^data:image\//.test(String(data))) {
      try {
        const box = await ev(c, `(() => { const i = Array.from(document.querySelectorAll('img')).find((x) => x.src === ${JSON.stringify(src)}); if (!i) return null; i.scrollIntoView({ block: 'center' }); const r = i.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
        if (box) { const shot = await c.send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 2 } }); data = `data:image/png;base64,${shot.data}`; }
      } catch { /* nothing more to try */ }
    }
    if (!/^data:image\//.test(String(data))) return { ok: false, error: L('no pude bajar la imagen de Gemini', 'could not download the image from Gemini') };
    const ext = /^data:image\/jpe?g/.test(data) ? 'jpg' : /^data:image\/webp/.test(data) ? 'webp' : 'png';
    const out = path.join(outDir, `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-gemini-${String(prompt).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30)}.${ext}`);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(out, Buffer.from(String(data).split(',')[1], 'base64'));
    try { fs.mkdirSync(path.dirname(MARK), { recursive: true }); fs.writeFileSync(MARK, new Date().toISOString()); } catch { /* the window just stays visible */ }
    return { ok: true, files: [out], via: 'web' };
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 160) };
  } finally {
    if (!keep) {
      closeTab();
      if (wantShow) setTimeout(() => { closeBrowser().catch(() => {}); }, 1500); // (done: no empty Chrome window left behind; the login stays in her profile)
    }
  }
}


// ---------- Zen (Firefox): her own Zen, with its own profile, driven through WebDriver BiDi on a local port ----------
const ZPORT = 9223;
const ZPROFILE = path.join(os.homedir(), '.capri', 'gemini-zen-profile');
function zenPath() {
  const dirs = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA, path.join(process.env.LOCALAPPDATA || '', 'Programs')].filter(Boolean);
  for (const d of dirs) for (const n of ['Zen Browser\\zen.exe', 'Zen\\zen.exe']) { const f = path.join(d, n); if (fs.existsSync(f)) return f; }
  return null;
}
// YOUR Zen profile (the one you use every day): its folder, from Zen's profiles.ini. Two Zens cannot share a profile folder, so hers never opens it:
// it takes a copy of your cookies (your Google login) into her own profile each time, and your Zen can stay open meanwhile.
function zenUserProfile() {
  try {
    const base = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'zen');
    const ini = fs.readFileSync(path.join(base, 'profiles.ini'), 'utf8');
    const sections = ini.split(/\r?\n(?=\[)/).map((blk) => { const o = { _name: (/^\[(.+)\]/.exec(blk) || [])[1] || '' }; for (const l of blk.split(/\r?\n/)) { const m = /^([^=\[]+)=(.*)$/.exec(l); if (m) o[m[1].trim()] = m[2].trim(); } return o; });
    const install = sections.find((x) => /^Install/.test(x._name) && x.Default);
    const prof = install ? sections.find((x) => x.Path === install.Default) || { Path: install.Default, IsRelative: '1' } : sections.find((x) => /^Profile/.test(x._name) && x.Default === '1') || sections.find((x) => /^Profile/.test(x._name) && /default/i.test(x.Path || ''));
    if (!prof?.Path) return null;
    const dir = prof.IsRelative === '0' ? prof.Path : path.join(base, prof.Path);
    return fs.existsSync(dir) ? dir : null;
  } catch { return null; }
}
function copyZenLogin() {
  const src = zenUserProfile();
  if (!src) return false;
  fs.mkdirSync(ZPROFILE, { recursive: true });
  let any = false;
  for (const f of ['cookies.sqlite', 'cookies.sqlite-wal', 'cookies.sqlite-shm']) {
    try { fs.copyFileSync(path.join(src, f), path.join(ZPROFILE, f)); if (f === 'cookies.sqlite') any = true; } catch { /* locked or missing: the next one */ }
  }
  return any;
}
const zenUp = () => new Promise((resolve) => {
  const r = http.request({ host: '127.0.0.1', port: ZPORT, path: '/status', method: 'GET', timeout: 1500 }, (res) => { res.resume(); resolve(true); });
  r.on('timeout', () => r.destroy()); r.on('error', () => resolve(false)); r.end();
});
function bidi() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${ZPORT}/session`);
    let id = 0; const waiting = new Map();
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (m.id && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); m.type === 'error' ? w.reject(new Error(m.message || m.error)) : w.resolve(m.result); } };
    ws.onerror = () => reject(new Error('no pude hablar con Zen'));
    ws.onopen = () => {
      const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; waiting.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params })); });
      send('session.new', { capabilities: {} }).then(() => resolve({ send, close: () => { try { ws.close(); } catch { /* closed */ } } })).catch(reject);
    };
  });
}

async function makeZen({ prompt, outDir, timeout = 150000, lang = 'es', windowMode = 'show' }) {
  const es = String(lang).startsWith('es');
  const L = (a, b) => (es ? a : b);
  const exe = zenPath();
  if (!exe) return { ok: false, error: L('no encuentro Zen en tu PC', 'cannot find Zen on your PC') };
  let launched = false;
  if (!(await zenUp())) {
    launched = true;
    fs.mkdirSync(ZPROFILE, { recursive: true });
    copyZenLogin(); // your Google login, so Gemini opens as you
    spawn(exe, ['-profile', ZPROFILE, '--no-remote', '--remote-debugging-port', String(ZPORT), 'https://gemini.google.com/app'], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    for (let i = 0; i < 60 && !(await zenUp()); i++) await sleep(500);
    if (!(await zenUp())) return { ok: false, error: L('Zen no abrió a tiempo', 'Zen did not open in time') };
    await sleep(2500);
  }
  let c;
  let keepZ = false; // (signing in: the window stays)
  let ctxId = null;
  try {
    c = await bidi();
    // a tab of her own (never one of yours); if Zen was already open with the port, it is YOUR Zen and your own session
    const ctx = (await c.send('browsingContext.create', { type: 'tab' })).context;
    ctxId = ctx;
    log(`zen: ${launched ? 'opened by her' : 'yours, already open'}; tab ${ctx}`);
    const ev = async (expression) => {
      const r = await c.send('script.evaluate', { expression: `(async () => { const v = await (${expression}); return JSON.stringify(v === undefined ? null : v); })()`, target: { context: ctx }, awaitPromise: true, resultOwnership: 'none' });
      if (r.type !== 'success') return undefined;
      try { return JSON.parse(r.result.value); } catch { return undefined; }
    };
    await c.send('browsingContext.navigate', { context: ctx, url: 'https://gemini.google.com/app', wait: 'complete' });
    let ready = false;
    for (let i = 0; i < 50 && !ready; i++) { await sleep(500); ready = Boolean(await ev(`Boolean(${EDITOR})`)); }
    log(`zen: editor ${ready ? 'found' : 'NOT found'}; at ${String(await ev('location.href'))}; page: ${String(await ev("(document.body?.innerText || '').slice(0, 200).replace(/\\s+/g, ' ')"))}`);
    if (!ready) { keepZ = true; return { ok: false, needLogin: true, error: L('Inicia sesión en Gemini en la ventana de Zen que se abrió (una sola vez) y vuélveme a pedir la imagen', 'Sign in to Gemini in the Zen window that just opened (once) and ask me again') }; }
    const before = new Set(await ev(IMAGES) || []);
    const text = `${L('Crea una imagen: ', 'Create an image: ')}${prompt}`;
    await ev(`(() => { const ed = ${EDITOR}; ed.focus(); document.execCommand('selectAll'); document.execCommand('insertText', false, ${JSON.stringify(text)}); return true; })()`);
    await sleep(600);
    const clicked = await ev(`(() => { const b = document.querySelector('button.send-button, button[aria-label*="Enviar"], button[aria-label*="Send message"], button[aria-label*="Send"]'); if (b && !b.disabled) { b.click(); return true; } return false; })()`);
    log(`zen: send button ${clicked ? 'clicked' : 'NOT found'}`);
    if (!clicked) return { ok: false, error: L('no encontré el botón de enviar de Gemini', 'could not find the send button in Gemini') };
    const t0 = Date.now();
    let src = null;
    let lastText = '';
    while (Date.now() - t0 < timeout) {
      await sleep(2000);
      const now = await ev(IMAGES) || [];
      src = now.find((u) => !before.has(u));
      if (src) {
        // Gemini shows a placeholder while it still says "Creando tu imagen": wait until it stops generating and the picture stops changing
        let last = '';
        for (let k = 0; k < 45; k++) {
          await sleep(2000);
          const busy = await ev(`Boolean(document.querySelector('button[aria-label*="Detener"], button[aria-label*="Stop"], .stop')) || /Creando tu imagen|Creating your image/i.test((document.querySelector('model-response, .response-container, message-content')?.innerText || ''))`);
          const cur = ((await ev(IMAGES)) || []).filter((u) => !before.has(u)).join('|');
          if (!busy && cur && cur === last) break;
          last = cur;
        }
        break;
      }
      lastText = String(await ev(`(document.querySelector('model-response, .response-container, message-content')?.innerText || '').slice(-300)`) || '');
      if (Date.now() - t0 > 25000 && lastText && !(await ev(`Boolean(document.querySelector('button[aria-label*="Detener"], button[aria-label*="Stop"], .stop'))`))) break;
    }
    log(`zen: image ${src ? 'appeared' : 'NEVER appeared'}; last text: ${lastText.replace(/\s+/g, ' ').slice(0, 200)}; images on page: ${JSON.stringify((await ev("Array.from(document.querySelectorAll('img')).map((i) => i.naturalWidth + ' ' + i.src.slice(0, 60))")) || []).slice(0, 600)}`);
    if (!src) return { ok: false, error: lastText ? `Gemini: ${lastText.replace(/\s+/g, ' ').slice(0, 160)}` : L('Gemini no devolvió ninguna imagen', 'Gemini returned no image') };
    src = (await ev(IMAGES) || []).filter((u) => !before.has(u)).pop() || src;
    log(`zen: final image ${src.slice(0, 90)}`);
    const big = src.replace(/=s\d+(-[a-z0-9-]+)?$/i, '=s0');
    let data = await ev(`(async () => {
      const get = async (u) => { const r = await fetch(u, { credentials: 'omit' }); if (!r.ok) throw new Error(r.status); const b = await r.blob(); return await new Promise((ok) => { const f = new FileReader(); f.onload = () => ok(f.result); f.readAsDataURL(b); }); };
      for (const u of [${JSON.stringify(big)}, ${JSON.stringify(src)}]) { try { return await get(u); } catch { /* the next */ } }
      return '';
    })()`);
    if (!/^data:image\//.test(String(data))) {
      try {
        const box = await ev(`(() => { const i = Array.from(document.querySelectorAll('img')).find((x) => x.src === ${JSON.stringify(src)}); if (!i) return null; i.scrollIntoView({ block: 'center' }); const r = i.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
        if (box) { await sleep(400); const shot = await c.send('browsingContext.captureScreenshot', { context: ctx, origin: 'viewport', clip: { type: 'box', ...box } }); data = `data:image/png;base64,${shot.data}`; }
      } catch { /* nothing more */ }
    }
    log(`zen: download ${/^data:image\//.test(String(data)) ? 'ok' : 'FAILED'}`);
    if (!/^data:image\//.test(String(data))) return { ok: false, error: L('no pude bajar la imagen de Gemini', 'could not download the image from Gemini') };
    const ext = /^data:image\/jpe?g/.test(data) ? 'jpg' : /^data:image\/webp/.test(data) ? 'webp' : 'png';
    const out = path.join(outDir, `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-gemini-${String(prompt).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30)}.${ext}`);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(out, Buffer.from(String(data).split(',')[1], 'base64'));
    log(`zen: saved ${out}`);
    if (windowMode !== 'hidden') keepZ = true; // you see the result in Gemini: the tab and Zen stay open (imageWindow: 'hidden' closes them)
    return { ok: true, files: [out], via: 'web-zen' };
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 160) };
  } finally {
    if (!keepZ) {
      try { await c?.send('browsingContext.close', { context: ctxId }); } catch { /* already closed */ }
      if (launched) { try { await c?.send('browser.close'); } catch { /* it stays open: harmless */ } }
    }
    try { await c?.send('session.end', {}); } catch { /* it ends with the socket anyway */ } // (Zen only allows ONE session: leaving it open would lock out the Zen MCP, and the next image)
    try { c?.close(); } catch { /* closed */ }
  }
}

// Zen only answers a program (like the Zen MCP, or her) if it was started with --remote-debugging-port. This puts that in YOUR Zen shortcuts
// (desktop, Start menu, taskbar), once; open Zen from one of them (closing Zen first, the first time). Only the port on this PC is opened.
function fixZenShortcuts(shell) {
  const roots = [shell && process.env.APPDATA && path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), process.env.APPDATA && path.join(process.env.APPDATA, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'),
    path.join(os.homedir(), 'Desktop'), path.join(os.homedir(), 'OneDrive', 'Desktop'), process.env.PUBLIC && path.join(process.env.PUBLIC, 'Desktop'), process.env.ProgramData && path.join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs')].filter(Boolean);
  const changed = [];
  const walk = (dir, depth) => {
    let items = [];
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const f = path.join(dir, it.name);
      if (it.isDirectory() && depth < 2) walk(f, depth + 1);
      else if (/^zen.*\.lnk$/i.test(it.name)) {
        try {
          const l = shell.readShortcutLink(f);
          if (/zen\.exe$/i.test(l.target || '') && !/remote-debugging-port/.test(l.args || '')) { shell.writeShortcutLink(f, 'update', { ...l, args: `${l.args || ''} --remote-debugging-port ${ZPORT}`.trim() }); changed.push(f); }
        } catch { /* no permission (all-users folders): the next one */ }
      }
    }
  };
  for (const r of roots) walk(r, 0);
  if (changed.length) log(`zen shortcuts updated: ${changed.join(' | ')}`);
  return changed;
}

// which browser: 'zen', 'chrome', or 'auto' (Zen if it is installed)
async function makeAny(opts) {
  const pick = opts.browser === 'chrome' ? 'chrome' : opts.browser === 'zen' ? 'zen' : (zenPath() ? 'zen' : 'chrome');
  return pick === 'zen' ? makeZen(opts) : make(opts);
}

module.exports = { make: makeAny, chromePath, zenPath, fixZenShortcuts };

