'use strict';

// Files between this PC and your phone, over your own Wi-Fi, with no cloud and no app: she opens a little window with a QR code, you scan it with the phone's
// camera and the file downloads (or, the other way round, a page opens on the phone to choose what to send to the PC).
//  - send(file): the link is private (a long random token) and works for ten minutes, for that one file
//  - receive(): the page of the phone puts what you choose in Downloads\Capri celular
// Both need the PC and the phone on the same Wi-Fi. The first time, Windows asks if Capri may use private networks: say yes.
// The server only runs while there is a link open.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { app, BrowserWindow } = require('electron');
const qr = require('./qr');

const TTL_MS = 10 * 60 * 1000;
const MAX_UPLOAD = 2 * 1024 * 1024 * 1024; // 2 GB

let server = null;
let port = 0;
const sessions = new Map(); // token -> { kind, file?, name?, dir?, expires, hits, win }
let deps = { files: null, config: null, onEvent: () => {} };

// the address of this PC on the Wi-Fi: a home network (192.168.x, 10.x, 172.16-31.x) before anything else; VPNs and virtual adapters last
function lanAddress() {
  const found = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family !== 'IPv4' || n.internal) continue;
      let rank = /^192\.168\./.test(n.address) ? 0 : /^10\./.test(n.address) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(n.address) ? 2 : 9;
      if (/radmin|vpn|virtual|vmware|vbox|hyper-v|wsl|tailscale|zerotier|loopback|bluetooth/i.test(name)) rank += 5;
      found.push({ rank, address: n.address });
    }
  }
  found.sort((a, b) => a.rank - b.rank);
  return found[0]?.address || null;
}

const clean = (name) => String(name || 'archivo').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').slice(0, 120) || 'archivo';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function receiveDir() {
  const mine = deps.config?.load().phoneDir;
  return mine || path.join(app.getPath('downloads'), 'Capri celular');
}

function uniquePath(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let target = path.join(dir, name);
  for (let i = 2; fs.existsSync(target) && i < 500; i++) target = path.join(dir, `${base} (${i})${ext}`);
  return target;
}

const PAGE = (token, es) => `<!doctype html><html lang="${es ? 'es' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Capri</title>
<style>body{margin:0;background:#0b0615;color:#f3eefc;font:16px/1.5 system-ui,sans-serif;padding:22px}h1{font-size:20px;margin:0 0 6px;color:#3dff95}p{color:#b7a9d4;margin:0 0 18px}
label{display:block;padding:18px;border:2px dashed #7a3cff;text-align:center;background:#1a1030}input{display:none}ul{list-style:none;padding:0}li{padding:10px;margin:8px 0;background:#1a1030;border-left:4px solid #7a3cff;word-break:break-all}li.ok{border-color:#3dff95}li.bad{border-color:#ff3d5a}
li small{display:block;color:#b7a9d4;font-size:13px}li.ok small{color:#3dff95}li.bad small{color:#ff8a9b}.bar{height:4px;background:#2b1d4d;margin-top:6px}.bar i{display:block;height:4px;width:0;background:#7a3cff}
#s{display:none;margin:0 0 16px;padding:16px;font-weight:700;font-size:18px;border-left:6px solid #3dff95;background:#10301f;color:#3dff95}#s.bad{border-color:#ff3d5a;background:#33101a;color:#ff8a9b}#s.wait{border-color:#7a3cff;background:#1a1030;color:#f3eefc}#s small{display:block;font-weight:400;font-size:14px;margin-top:4px;color:#d7ccee}</style></head>
<body><h1>CAPRI</h1><p>${es ? 'Elige lo que quieres mandar al PC.' : 'Choose what to send to the PC.'}</p>
<div id="s"></div>
<label><input id="f" type="file" multiple><span id="t">${es ? 'Toca para elegir fotos o archivos' : 'Tap to choose photos or files'}</span></label><ul id="l"></ul>
<script>
var ES=${es ? 'true' : 'false'}, list=document.getElementById('l'), box=document.getElementById('s'), tap=document.getElementById('t');
function banner(cls,main,sub){ box.className=cls; box.style.display='block'; box.textContent=main; if(sub){ var m=document.createElement('small'); m.textContent=sub; box.append(m); } }
function up(file, li, st){
  return new Promise(function(done){
    var x=new XMLHttpRequest(), bar=li.querySelector('i'), note=li.querySelector('small');
    x.open('POST','/p/${token}'); x.setRequestHeader('x-name',encodeURIComponent(file.name));
    x.upload.onprogress=function(e){ if(e.lengthComputable){ var pc=Math.round(e.loaded*100/e.total); bar.style.width=pc+'%'; note.textContent=(ES?'Enviando… ':'Sending… ')+pc+'%'; } };
    x.onload=function(){ if(x.status===200){ li.className='ok'; note.textContent=ES?'✔ Ya llegó al PC':'✔ It is on the PC'; bar.parentNode.remove(); st.ok++; } else fail(); done(); };
    x.onerror=fail; x.onabort=fail;
    function fail(){ if(li.className==='bad') return; li.className='bad'; note.textContent=ES?'✖ No llegó. Vuelve a intentarlo':'✖ It did not arrive. Try again'; st.bad++; done(); }
    x.send(file);
  });
}
document.getElementById('f').addEventListener('change', async function(e){
  var files=Array.prototype.slice.call(e.target.files); e.target.value='';
  if(!files.length) return;
  var st={ok:0,bad:0};
  banner('wait', ES?'Enviando al PC… no cierres esta página':'Sending to the PC… keep this page open');
  for(var i=0;i<files.length;i++){
    var li=document.createElement('li'); li.innerHTML='<span></span><small>'+(ES?'En cola…':'Waiting…')+'</small><div class="bar"><i></i></div>'; li.firstChild.textContent=files[i].name; list.prepend(li);
    await up(files[i], li, st);
  }
  if(st.bad) banner('bad', (ES?'Llegaron '+st.ok+' de '+files.length+'. Falló '+st.bad+'.':'Arrived '+st.ok+' of '+files.length+'. '+st.bad+' failed.'));
  else banner('', st.ok===1?(ES?'✔ Listo: 1 archivo ya está en el PC':'✔ Done: 1 file is on the PC'):(ES?'✔ Listo: '+st.ok+' archivos ya están en el PC':'✔ Done: '+st.ok+' files are on the PC'), ES?'Los guardó Capri en Descargas / Capri celular. Mira la tarjeta de Capri en el PC para abrirlos.':'Capri saved them in Downloads / Capri celular.');
  tap.textContent=ES?'Toca para enviar más':'Tap to send more';
});
</script></body></html>`;

const LIST_PAGE = (token, files) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Capri</title>
<style>body{margin:0;background:#0b0615;color:#f3eefc;font:16px/1.5 system-ui,sans-serif;padding:22px}h1{font-size:20px;margin:0 0 6px;color:#3dff95}p{color:#b7a9d4;margin:0 0 18px}
ul{list-style:none;padding:0}li{margin:10px 0}a{display:block;padding:14px;background:#1a1030;border-left:4px solid #7a3cff;color:#f3eefc;text-decoration:none;word-break:break-all}a.got{border-color:#3dff95}a.got::after{content:" ✔";color:#3dff95}</style></head>
<body><h1>CAPRI</h1><p>Toca cada archivo para bajarlo al celular (${files.length}).</p>
<ul>${files.map((f, i) => `<li><a href="/f/${token}/${i}/${encodeURIComponent(f.name)}" download onclick="this.className='got'">${esc(f.name)}</a></li>`).join('')}</ul></body></html>`;

function ensureServer() {
  if (server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      const parts = url.pathname.split('/').filter(Boolean); // f/<token>/<name>, u/<token>, p/<token>
      const session = sessions.get(parts[1]);
      const fail = (code) => { res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }); res.end(code === 404 ? 'No encontrado' : 'Error'); };
      if (!session || session.expires < Date.now()) return fail(404);
      const es = true;
      if (req.method === 'GET' && parts[0] === 's' && session.kind === 'send') { // several files: a page with one link for each
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(LIST_PAGE(parts[1], session.files));
        return undefined;
      }
      if (req.method === 'GET' && parts[0] === 'f' && session.kind === 'send') {
        const idx = parts.length >= 4 && /^\d+$/.test(parts[2]) ? Number(parts[2]) : 0;
        const item = session.files[idx];
        if (!item) return fail(404);
        let st;
        try { st = fs.statSync(item.file); } catch { return fail(404); }
        res.writeHead(200, {
          'content-type': 'application/octet-stream', 'content-length': st.size,
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`,
        });
        session.hits += 1;
        const stream = fs.createReadStream(item.file);
        stream.on('error', () => res.destroy());
        res.on('finish', () => {
          deps.onEvent({ type: 'sent', name: item.name });
          session.done.add(idx);
          if (session.done.size >= session.files.length) setTimeout(() => close(parts[1]), 4000); // (a moment: the phone may ask once more)
        });
        stream.pipe(res);
        return undefined;
      }
      if (req.method === 'GET' && parts[0] === 'u' && session.kind === 'receive') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(PAGE(parts[1], es));
        return undefined;
      }
      if (req.method === 'POST' && parts[0] === 'p' && session.kind === 'receive') {
        const name = clean(decodeURIComponent(String(req.headers['x-name'] || 'archivo')));
        const size = Number(req.headers['content-length'] || 0);
        if (size > MAX_UPLOAD) return fail(413);
        fs.mkdirSync(receiveDir(), { recursive: true });
        const target = uniquePath(receiveDir(), name);
        const out = fs.createWriteStream(target);
        let bytes = 0;
        req.on('data', (c) => { bytes += c.length; if (bytes > MAX_UPLOAD) { req.destroy(); out.destroy(); } });
        req.pipe(out);
        out.on('finish', () => {
          try { fs.appendFileSync(path.join(__dirname, '..', '..', '_logs', 'phone.log'), `${new Date().toISOString()} received ${target} (${bytes} bytes)\n`); } catch { /* no log */ }
          deps.files?.remember([target]);
          deps.onEvent({ type: 'received', name: path.basename(target), path: target });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{"ok":true}');
        });
        out.on('error', () => fail(500));
        return undefined;
      }
      return fail(404);
    });
    server.once('error', (err) => { server = null; reject(err); });
    server.listen(0, '0.0.0.0', () => { port = server.address().port; resolve(); });
  });
}

function close(token) {
  const s = sessions.get(token);
  if (s?.win && !s.win.isDestroyed()) s.win.close();
  sessions.delete(token);
  if (!sessions.size && server) { server.close(); server = null; }
}

function windowFor(token, { title, line, url }) {
  const svg = qr.toSvg(url, { scale: 6 });
  const html = `<!doctype html><meta charset="utf-8"><title>Capri · ${esc(title)}</title><body style="margin:0;background:#0b0615;color:#f3eefc;font:14px/1.4 system-ui,sans-serif;text-align:center;padding:16px">
<div style="color:#3dff95;letter-spacing:.12em;font-weight:700;margin-bottom:8px">CAPRI // ${esc(title.toUpperCase())}</div>
<div style="display:inline-block;padding:6px;background:#fff">${svg}</div>
<div style="margin:12px 0 4px;font-weight:600;word-break:break-all">${esc(line)}</div>
<div style="color:#b7a9d4;font-size:12px">Escanéalo con la cámara del celular.<br>El celular y el PC deben estar en el mismo Wi-Fi.</div>
<div style="color:#7a6a9c;font-size:10px;margin-top:10px;word-break:break-all">${esc(url)}</div></body>`;
  const win = new BrowserWindow({
    width: 360, height: 520, title: `Capri · ${title}`, autoHideMenuBar: true, alwaysOnTop: true, resizable: false, minimizable: false, backgroundColor: '#0b0615',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.setMenu(null);
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.on('closed', () => { const s = sessions.get(token); if (s) s.win = null; });
  return win;
}

async function open(session, { route, title, line }) {
  const host = lanAddress();
  if (!host) return { ok: false, error: 'no network' };
  try { await ensureServer(); } catch (err) { return { ok: false, error: `could not open the port: ${err.message}` }; }
  const token = crypto.randomBytes(18).toString('hex');
  session.expires = Date.now() + TTL_MS;
  session.hits = 0;
  sessions.set(token, session);
  const url = `http://${host}:${port}/${route(token)}`;
  session.win = windowFor(token, { title, line, url });
  setTimeout(() => close(token), TTL_MS + 1000).unref?.();
  return { ok: true, url };
}

async function send(input) {
  const list = (Array.isArray(input) ? input : [input]).map((f) => path.resolve(String(f || '')));
  const items = [];
  for (const abs of list) {
    if (!deps.files?.isAllowed(abs)) continue;
    try { if (fs.statSync(abs).isFile()) items.push({ file: abs, name: path.basename(abs) }); } catch { /* gone */ }
  }
  if (!items.length) return { ok: false, error: 'not a file she knows' };
  const one = items.length === 1;
  const label = one ? items[0].name : `${items.length} archivos`;
  const r = await open({ kind: 'send', files: items, done: new Set() }, {
    route: (t) => (one ? `f/${t}/${encodeURIComponent(items[0].name)}` : `s/${t}`), title: 'Pasar al celular', line: label,
  });
  return { ...r, name: label, count: items.length };
}

async function receive() {
  return open({ kind: 'receive' }, { route: (t) => `u/${t}`, title: 'Traer del celular', line: 'Elige lo que quieras mandar al PC' });
}

function setup({ files, config, onEvent }) {
  deps = { files, config, onEvent: onEvent || (() => {}) };
  app.on('will-quit', () => { try { server?.close(); } catch { /* closed */ } });
}

module.exports = { setup, send, receive, lanAddress };
