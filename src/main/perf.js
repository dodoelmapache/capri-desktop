'use strict';

// "Optimizar": what is running in the background that you do not need open. She lists it with its memory and, on your OK, closes only what is on a short
// list of things that are safe to close (Adobe's background helpers, Phone Link, Widgets, Game Bar... and Teams, Skype, Zoom when they have no window).
// She never closes anything else by herself: the rest of what weighs a lot is shown so you can say "cierra Chrome" if you want.
// Never touched: Windows, her own programs, Ollama/Whisper, and the chat apps she watches (Discord, WhatsApp, Telegram).

const os = require('node:os');
const apps = require('./apps');

const ALWAYS = /^(?:ccxprocess|adobeipcbroker|adobe desktop service|creative cloud helper|creative cloud ui helper|adobecollabsync|cclibrary|coresync|acrotray|yourphone|phoneexperiencehost|widgets|widgetservice|gamebar|gamebarftserver|gamebarpresencewriter|cortana)$/i;
const IF_NO_WINDOW = /^(?:ms-teams|teams|skype|skypeapp|skypehost|zoom|slack)$/i;
const PROTECTED = /^(?:system|idle|registry|memcompression|memory compression|svchost|csrss|wininit|winlogon|services|lsass|dwm|explorer|msmpeng|audiodg|fontdrvhost|electron|ollama.*|whisper.*|capri.*|searchhost|startmenuexperiencehost|shellexperiencehost|runtimebroker|sihost|ctfmon|taskhostw|conhost|powershell|pwsh|discord|whatsapp.*|telegram|nvcontainer.*|nvdisplay.*|securityhealth.*|wudfhost|dllhost|smartscreen|spoolsv|searchindexer)$/i;
const HEAVY_MB = 400;

const mb = (n) => Math.round(n / 1048576);

async function rows() {
  if (process.platform !== 'win32') return [];
  const out = await apps.powershell("Get-Process | ForEach-Object { [pscustomobject]@{ n = $_.ProcessName; ws = $_.WorkingSet64; win = [bool]($_.MainWindowHandle -ne 0) } } | ConvertTo-Json -Compress", 20000).catch(() => '');
  try { return [].concat(out ? JSON.parse(out) : []); } catch { return []; }
}

// { total, free, safe: [{ name, count, mb }], heavy: [{ name, count, mb, win }] }
// programs she must never touch, on top of the built-in list: config.perfNever (names, any case). Set by main.js before each scan / run.
let never = new Set();
function setNever(list) { never = new Set([].concat(list || []).map((n) => String(n).toLowerCase().replace(/\.exe$/, '')).filter(Boolean)); }

async function scan() {
  const by = new Map();
  for (const r of await rows()) {
    const name = String(r.n || '');
    if (!name || PROTECTED.test(name) || never.has(name.toLowerCase())) continue;
    const g = by.get(name.toLowerCase()) || { name, count: 0, ws: 0, win: false };
    g.count += 1;
    g.ws += Number(r.ws) || 0;
    g.win = g.win || Boolean(r.win);
    by.set(name.toLowerCase(), g);
  }
  const safe = [];
  const heavy = [];
  for (const g of by.values()) {
    const closable = ALWAYS.test(g.name) || (IF_NO_WINDOW.test(g.name) && !g.win);
    if (closable) safe.push({ name: g.name, count: g.count, mb: mb(g.ws) });
    else if (mb(g.ws) >= HEAVY_MB) heavy.push({ name: g.name, count: g.count, mb: mb(g.ws), win: g.win });
  }
  safe.sort((a, b) => b.mb - a.mb);
  heavy.sort((a, b) => b.mb - a.mb);
  return { total: mb(os.totalmem()), free: mb(os.freemem()), safe, heavy: heavy.slice(0, 6) };
}

// Closes the processes in `names`, but only those on the safe lists (whatever else comes in is ignored): { ok, closed }
async function run(names) {
  if (process.platform !== 'win32') return { ok: false, error: 'windows only' };
  const ok = [].concat(names || []).map(String).filter((n) => /^[\w .-]{2,60}$/.test(n) && !never.has(n.toLowerCase()) && (ALWAYS.test(n) || IF_NO_WINDOW.test(n)));
  if (!ok.length) return { ok: false, error: 'nothing to close' };
  const out = await apps.powershell(
    "$closed = 0; foreach ($n in $env:CAPRI_NAMES.Split('|')) { foreach ($p in @(Get-Process -Name $n -ErrorAction SilentlyContinue)) { try { if ($p.MainWindowHandle -ne 0) { [void]$p.CloseMainWindow(); Start-Sleep -Milliseconds 500 }; if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }; $closed++ } catch { } } }; $closed",
    30000, { CAPRI_NAMES: ok.join('|') },
  ).catch(() => '0');
  return { ok: true, closed: Number(out) || 0 };
}

module.exports = { scan, run, setNever };
