'use strict';

// What you give her in the chat: files (the "+" button, drag and drop, a pasted screenshot) and links.
// Here: look at what a file is, read small texts, shrink a picture for a model, save a pasted picture, read a web page.
// Nothing leaves your PC except a link's own request to its site, and only for links you wrote in your message.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|ya?ml|toml|ini|log|srt|vtt|html?|css|scss|js|mjs|cjs|ts|tsx|jsx|py|rb|php|java|c|h|cpp|cs|go|rs|sh|sql|svg|tex)$/i;
const TEXT_MAX = 200 * 1024; // bigger than this isn't something to paste into a small model
const TEXT_CUT = 12000;      // characters of it that go along
const MAX_FILES = 8;

// { path, name, size, kind: 'image' | 'text' | 'other', text? }
function inspect(paths) {
  const out = [];
  for (const p of (Array.isArray(paths) ? paths : []).slice(0, MAX_FILES)) {
    const abs = path.resolve(String(p || ''));
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    const name = path.basename(abs);
    const item = { path: abs, name, size: st.size, kind: 'other' };
    if (st.isFile() && IMAGE_EXT.test(name) && st.size < 25 * 1024 * 1024) item.kind = 'image';
    else if (st.isFile() && TEXT_EXT.test(name) && st.size <= TEXT_MAX) {
      try {
        const buf = fs.readFileSync(abs);
        if (!buf.includes(0)) { // a NUL byte: it's a binary pretending
          item.kind = 'text';
          item.text = buf.toString('utf8').slice(0, TEXT_CUT);
        }
      } catch { /* unreadable: stays "other", Claude may still be able to */ }
    }
    out.push(item);
  }
  return out;
}

// A picture for a model: at most 1280 px on the long side, as JPEG
function readImage(file) {
  const { nativeImage } = require('electron');
  try {
    const img = nativeImage.createFromPath(file);
    if (!img.isEmpty()) {
      const { width, height } = img.getSize();
      const big = Math.max(width, height);
      const out = big > 1280 ? img.resize({ width: Math.round((width * 1280) / big), height: Math.round((height * 1280) / big) }) : img;
      return { mime: 'image/jpeg', b64: out.toJPEG(88).toString('base64') };
    }
    const raw = fs.readFileSync(file); // a format Electron can't open (webp...): sent as it is, if it's small
    const ext = path.extname(file).slice(1).toLowerCase().replace('jpg', 'jpeg');
    return raw.length < 5 * 1024 * 1024 ? { mime: `image/${ext}`, b64: raw.toString('base64') } : null;
  } catch {
    return null;
  }
}

// A picture pasted from the clipboard (a screenshot): to a file, so it can be attached like any other
function saveClip(buffer, ext = 'png') {
  const safe = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(String(ext).toLowerCase()) ? String(ext).toLowerCase() : 'png';
  const dir = path.join(os.tmpdir(), 'capri-attach');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `pegado-${Date.now()}.${safe}`);
  fs.writeFileSync(file, buffer);
  for (const old of fs.readdirSync(dir).filter((f) => /^pegado-\d+\./.test(f)).sort().slice(0, -20)) fs.rmSync(path.join(dir, old), { force: true });
  return file;
}

// ---- links ----------------------------------------------------------------------------------------
// Never her own PC or your network: a link in a message must not be a way into them.
const PRIVATE_HOST = /^(localhost|0\.|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1?\]?$|.*\.(local|internal|lan|home|corp)$)/i;

const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)));

// The title, the description the site gives itself (what a YouTube or Instagram link has to offer), and the page's text
function htmlToText(html) {
  const meta = (name) => new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html)?.[1]
    || new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, 'i').exec(html)?.[1] || '';
  const title = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || meta('og:title')).trim());
  const description = decode((meta('og:description') || meta('description')).trim());
  const body = decode(html
    .replace(/<(script|style|noscript|svg|template|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  return { title, text: [description, body].filter(Boolean).join('\n').slice(0, 6000) };
}

async function readLink(url, { allowPrivate = false } = {}) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || (!allowPrivate && PRIVATE_HOST.test(u.hostname))) return null;
  try {
    const res = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(9000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; Capri)', accept: 'text/html,text/plain;q=0.9,*/*;q=0.5', 'accept-language': 'es,en;q=0.8' } });
    if (!allowPrivate && PRIVATE_HOST.test(new URL(res.url).hostname)) return null; // it sent her somewhere private
    if (!res.ok) return { url, title: '', text: '', error: `HTTP ${res.status}` };
    const type = res.headers.get('content-type') || '';
    if (!/text\/|json|xml/i.test(type)) return { url, title: '', text: '', error: type.split(';')[0] || 'not text' };
    const raw = Buffer.from(await res.arrayBuffer()).subarray(0, 600 * 1024).toString('utf8');
    if (/html/i.test(type)) return { url, ...htmlToText(raw) };
    return { url, title: '', text: raw.slice(0, 6000) };
  } catch (err) {
    return { url, title: '', text: '', error: err.name === 'TimeoutError' ? 'timeout' : String(err.message || err).slice(0, 80) };
  }
}

async function readLinks(urls, opts) {
  const list = [...new Set((Array.isArray(urls) ? urls : []).map(String))].slice(0, 3);
  return (await Promise.all(list.map((u) => readLink(u, opts)))).filter(Boolean);
}

module.exports = { inspect, readImage, saveClip, readLinks, htmlToText, PRIVATE_HOST };
