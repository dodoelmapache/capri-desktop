'use strict';

// "Imagina...": her images come from YOUR nano-banana (Documents\nano-banana\nano_banana.py), the Gemini CLI you built:
// the same models, the same key, the same account. She only runs it and brings the file back.

const fs = require('node:fs');
const geminiweb = require('./geminiweb');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MODELS = new Set(['flash', 'pro']); // nano_banana.py: flash = Nano Banana 2, pro = Nano Banana Pro

const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'imagen';

function run(cmd, args, { env, timeout }) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let child;
    try {
      child = spawn(cmd, args, { env, windowsHide: true });
    } catch (e) {
      return resolve({ missing: true, out, err: String(e.message) });
    }
    const timer = setTimeout(() => { child.kill(); err += '\ntimeout'; }, timeout);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ missing: e.code === 'ENOENT', out, err: String(e.message) }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

// Plain-words reason from whatever the script printed
function why(text, es) {
  const t = String(text);
  const L = (a, b) => (es ? a : b);
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(t)) return L('la clave de Gemini (API) se quedó sin cupo de imágenes, y ese cupo es aparte de tu Gemini normal. Activa facturación en aistudio.google.com o usa gemini.google.com mientras tanto', 'the Gemini API key is out of image quota (separate from your normal Gemini). Enable billing at aistudio.google.com, or use gemini.google.com meanwhile');
  if (/GEMINI_API_KEY|API key|API_KEY_INVALID|PERMISSION_DENIED|401|403/i.test(t)) return L('falta o no sirve la clave de Gemini (corre «python nano_banana.py init»)', 'the Gemini key is missing or not valid (run "python nano_banana.py init")');
  if (/503|UNAVAILABLE|overloaded|high demand/i.test(t)) return L('Gemini está saturado ahora mismo, prueba en un rato', 'Gemini is overloaded right now, try again in a bit');
  if (/SAFETY|blocked|PROHIBITED|policy/i.test(t)) return L('Gemini no quiso hacer ese pedido (sus filtros)', 'Gemini would not do that one (its filters)');
  const line = t.split(/\r?\n/).find((l) => /error|no se generaron/i.test(l));
  return (line || L('no salió ninguna imagen', 'no image came out')).replace(/^Error intento \d+:\s*/i, '').slice(0, 160);
}

async function make({ prompt, model = 'flash', refs = [], edit = null, script, outDir, env = process.env, pythons = ['python', 'py'], timeout = 180000, lang = 'es', via = 'web', windowMode = 'show', browser = 'auto' }) {
  const es = String(lang).startsWith('es');
  // 1) Your Gemini (Plus) through its web page: no API key, no API quota. A picture to edit or pictures to copy the style of still go through the API.
  let webNote = '';
  if (via !== 'api' && !edit && !(Array.isArray(refs) && refs.length)) {
    const w = await geminiweb.make({ prompt, outDir, lang, windowMode, browser });
    if (w.ok || w.needLogin) return w;
    webNote = w.error;
  }
  if (!script || !fs.existsSync(script)) {
    return { ok: false, error: es ? `no encuentro nano_banana.py (${script})` : `cannot find nano_banana.py (${script})` };
  }
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const out = path.join(outDir, `${stamp}-${edit ? 'edit-' : ''}${slug(prompt)}.png`);
  const extra = [];
  if (edit && fs.existsSync(edit)) extra.push('--edit', edit); // the picture to change; the result is a new file, the original stays
  for (const ref of (Array.isArray(refs) ? refs : []).slice(0, 4)) if (fs.existsSync(ref)) extra.push('--reference', ref); // pictures you attached: nano_banana.py's --reference
  // Each model has its own quota on the API key: if the first one is out ("sin cupo"), the next one is tried before giving up
  const first = MODELS.has(model) ? model : 'flash';
  const chain = [first, ...['flash-2.5', first === 'flash' ? 'pro' : 'flash'].filter((m) => m !== first)];
  let res = null;
  let lastText = '';
  for (const m of chain) {
    const args = [script, String(prompt), out, '--model', m, ...extra];
    res = null;
    for (const py of pythons) {
      res = await run(py, args, { env: { ...env, PYTHONIOENCODING: 'utf-8' }, timeout });
      if (!res.missing) break;
    }
    if (res?.missing) return { ok: false, error: es ? 'no encuentro Python en tu PC (la orden «python»)' : 'cannot find Python on your PC (the "python" command)' };
    const files = [...String(res.out).matchAll(/^Guardado:\s*(.+)$/gm)].map((x) => x[1].trim()).filter((q) => fs.existsSync(q));
    if (files.length) return { ok: true, files, model: m };
    lastText = `${res.out}\n${res.err}`;
    if (!/429|RESOURCE_EXHAUSTED|quota|503|UNAVAILABLE|overloaded|not found|404/i.test(lastText)) break; // only quota / overload / missing-model failures are worth another model
  }
  return { ok: false, error: why(lastText, es) + (webNote ? (es ? ` (por la web de Gemini también falló: ${webNote})` : ` (the Gemini web way failed too: ${webNote})`) : '') };
}

module.exports = { make, why };
