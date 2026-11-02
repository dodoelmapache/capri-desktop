'use strict';

// The notifications Windows keeps for WhatsApp, Discord and Telegram, shown by her in her own style.
// Windows writes every toast it gets into a small database (wpndatabase.db) before it paints the banner. She reads that database (winsqlite3, which Windows
// ships), takes the toasts of the chat apps that are new, and sends them to her card. Those toasts are the ones the apps themselves decided to send, so a chat
// you muted in WhatsApp, or a server you muted in Discord, never makes one.
//
// To have only her show them: Windows Settings > System > Notifications > the app: turn OFF "Show notification banners" and leave
// "Show notifications in notification center" ON. (If you turn the app's notifications off completely, there is nothing for her to read.)
// Config: toasts (default on), msgApps (which apps). What she saw is counted in _logs/msg.log, never the text.

const fs = require('node:fs');
const path = require('node:path');
const apps = require('./apps');

const APP_ID = { whatsapp: /whatsapp/i, discord: /discord/i, telegram: /telegram/i };
const EVERY_MS = 1500;

function log(line) {
  try {
    const dir = path.join(__dirname, '..', '..', '_logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'msg.log'), `${new Date().toISOString()} toasts: ${line}\n`);
  } catch { /* a courtesy */ }
}

const SQ_PS = String.raw`Add-Type -TypeDefinition @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public static class Sq {
  const string D = "winsqlite3.dll";
  [DllImport(D, CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_open_v2(byte[] file, out IntPtr db, int flags, IntPtr vfs);
  [DllImport(D, CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_close(IntPtr db);
  [DllImport(D, CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_prepare_v2(IntPtr db, byte[] sql, int n, out IntPtr stmt, IntPtr tail);
  [DllImport(D, CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_bind_int64(IntPtr stmt, int i, long v);
  [DllImport(D, CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_step(IntPtr stmt);
  [DllImport(D, CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_finalize(IntPtr stmt);
  [DllImport(D, CallingConvention = CallingConvention.Cdecl)] static extern long sqlite3_column_int64(IntPtr stmt, int i);
  [DllImport(D, CallingConvention = CallingConvention.Cdecl)] static extern IntPtr sqlite3_column_text(IntPtr stmt, int i);
  [DllImport(D, CallingConvention = CallingConvention.Cdecl)] static extern IntPtr sqlite3_column_blob(IntPtr stmt, int i);
  [DllImport(D, CallingConvention = CallingConvention.Cdecl)] static extern int sqlite3_column_bytes(IntPtr stmt, int i);
  static byte[] Z(string s) { return Encoding.UTF8.GetBytes(s + "\0"); }
  static byte[] Raw(IntPtr p, int n) { var b = new byte[n]; if (n > 0 && p != IntPtr.Zero) Marshal.Copy(p, b, 0, n); return b; }
  static string Utf8(IntPtr st, int i) { return Encoding.UTF8.GetString(Raw(sqlite3_column_text(st, i), sqlite3_column_bytes(st, i))); }
  static string Blob(IntPtr st, int i) {
    var b = Raw(sqlite3_column_blob(st, i), sqlite3_column_bytes(st, i));
    if (b.Length > 1 && b[1] == 0) return Encoding.Unicode.GetString(b);
    return Encoding.UTF8.GetString(b);
  }
  public static string[][] Rows(string file, int flags, long after, long afterArr, bool maxOnly) {
    IntPtr db;
    if (sqlite3_open_v2(Z(file), out db, flags, IntPtr.Zero) != 0) return null;
    var list = new List<string[]>();
    try {
      // a toast that the app REPLACES (WhatsApp updates one toast per chat) may keep its Id: ArrivalTime says it is new. If that column is not there, only the Id is used.
      string[] sqls = maxOnly
        ? new string[] { "SELECT IFNULL(MAX(Id),0), IFNULL(MAX(ArrivalTime),0) FROM Notification", "SELECT IFNULL(MAX(Id),0), 0 FROM Notification" }
        : new string[] { "SELECT n.Id, IFNULL(h.PrimaryId,''), n.Payload, IFNULL(n.ArrivalTime,0) FROM Notification n LEFT JOIN NotificationHandler h ON n.HandlerId = h.RecordId WHERE n.Id > ?1 OR n.ArrivalTime > ?2 ORDER BY n.ArrivalTime, n.Id LIMIT 40",
                         "SELECT n.Id, IFNULL(h.PrimaryId,''), n.Payload, 0 FROM Notification n LEFT JOIN NotificationHandler h ON n.HandlerId = h.RecordId WHERE n.Id > ?1 ORDER BY n.Id LIMIT 40" };
      IntPtr st = IntPtr.Zero;
      bool ok = false;
      foreach (var sql in sqls) { if (sqlite3_prepare_v2(db, Z(sql), -1, out st, IntPtr.Zero) == 0) { ok = true; break; } }
      if (!ok) return null;
      if (!maxOnly) { sqlite3_bind_int64(st, 1, after); sqlite3_bind_int64(st, 2, afterArr); }
      while (sqlite3_step(st) == 100) {
        if (maxOnly) list.Add(new string[] { sqlite3_column_int64(st, 0).ToString(), sqlite3_column_int64(st, 1).ToString() });
        else list.Add(new string[] { sqlite3_column_int64(st, 0).ToString(), Utf8(st, 1), Blob(st, 2), sqlite3_column_int64(st, 3).ToString() });
      }
      sqlite3_finalize(st);
    } finally { sqlite3_close(db); }
    return list.ToArray();
  }
}
'@
$dir = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Notifications'
$db = Join-Path $dir 'wpndatabase.db'
$after = [long]$env:CAPRI_AFTER
$afterArr = [long]$env:CAPRI_AFTERARR
$maxOnly = ($env:CAPRI_MAXONLY -eq '1')
$rows = $null
try { $rows = [Sq]::Rows($db, 1, $after, $afterArr, $maxOnly) } catch { }
if ($null -eq $rows) { # (in use or in the middle of a write: a copy of it, with its log, is read instead)
  try {
    $tmp = Join-Path $env:TEMP 'capri_wpn'
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    foreach ($f in 'wpndatabase.db', 'wpndatabase.db-wal', 'wpndatabase.db-shm') { $src = Join-Path $dir $f; if (Test-Path $src) { Copy-Item $src (Join-Path $tmp $f) -Force } }
    $rows = [Sq]::Rows((Join-Path $tmp 'wpndatabase.db'), 2, $after, $afterArr, $maxOnly)
  } catch { }
}
if ($null -eq $rows) { @{ ok = $false; error = 'cannot open the notification database' } | ConvertTo-Json -Compress; exit }
$out = foreach ($r in $rows) { if ($maxOnly) { @{ id = $r[0]; arr = $r[1] } } else { @{ id = $r[0]; app = $r[1]; xml = $r[2]; arr = $r[3] } } }
@{ ok = $true; rows = @($out) } | ConvertTo-Json -Compress -Depth 4
`;

const decode = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
const textsOf = (xml) => [...String(xml).matchAll(/<text[^>]*>([\s\S]*?)<\/text>/gi)].map((m) => decode(m[1]).replace(/\s+/g, ' ').trim()).filter(Boolean);

function setup({ config, onNew }) {
  const state = { last: null, arr: 0, ok: false, stamp: '' };
  const seen = new Set(); // (id:arrival of what was already shown: a replaced toast has a new arrival)
  const history = []; // what came in since she started (in memory only): { t, app, title, body }
  const api = { working: () => state.ok, history: (app = '') => history.filter((h) => !app || h.app === app).slice(-40) };
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return { ...api, working: () => false };
  const dir = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Notifications');
  const stampOf = () => ['wpndatabase.db', 'wpndatabase.db-wal'].map((f) => { try { return fs.statSync(path.join(dir, f)).mtimeMs; } catch { return 0; } }).join('|');
  let busy = false;
  let fails = 0;
  const poll = async () => {
    if (busy || config.load().toasts === false) return;
    const stamp = stampOf();
    if (state.last !== null && stamp === state.stamp) return; // (nothing written since the last look)
    busy = true;
    try {
      const first = state.last === null;
      const out = await apps.powershell(SQ_PS, 20000, { CAPRI_AFTER: String(state.last ?? 0), CAPRI_AFTERARR: String(state.arr || 0), CAPRI_MAXONLY: first ? '1' : '0' }).catch((err) => JSON.stringify({ ok: false, error: err.message }));
      let res;
      try { res = JSON.parse(out); } catch { res = { ok: false, error: 'no answer' }; }
      if (!res.ok) {
        state.ok = false;
        if (++fails === 1 || fails % 50 === 0) log(`not available: ${res.error}`);
        return;
      }
      fails = 0;
      state.stamp = stamp;
      const rows = [].concat(res.rows || []);
      if (first) {
        state.last = Number(rows[0]?.id || 0); // (what was already there is not news)
        state.arr = Number(rows[0]?.arr || 0);
        state.ok = true;
        log(`ready (from ${state.last})`);
        return;
      }
      state.ok = true;
      const allowed = [].concat(config.load().msgApps || Object.keys(APP_ID)).map((a) => String(a).toLowerCase());
      const items = [];
      for (const row of rows) {
        state.last = Math.max(state.last, Number(row.id) || 0);
        state.arr = Math.max(state.arr, Number(row.arr) || 0);
        const key = `${row.id}:${row.arr}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (seen.size > 400) seen.delete(seen.values().next().value);
        const app = Object.keys(APP_ID).find((k) => APP_ID[k].test(String(row.app || '')));
        if (!app || !allowed.includes(app)) continue;
        const texts = textsOf(row.xml);
        if (!texts.length) continue;
        // WhatsApp adds its own summary line ("✉ 2 mensajes no leídos"): it is not what was said
        const SUMMARY = /^[✉📩\s]*\d+\s+(?:mensajes?|messages?|chats?)\s+(?:no\s+le[ií]dos?|unread|sin\s+leer)\.?$/i;
        const rest = texts.slice(1).filter((t) => !SUMMARY.test(t));
        const item = { app, title: texts[0], body: rest.join(' · ') };
        items.push(item);
        history.push({ t: Date.now(), ...item });
        if (history.length > 100) history.shift();
      }
      if (items.length) {
        log(`${items.length} new (${[...new Set(items.map((i) => i.app))].join(', ')})`);
        onNew(items);
      }
    } finally {
      busy = false;
    }
  };
  setTimeout(poll, 8000);
  setInterval(poll, EVERY_MS);
  return api;
}

module.exports = { setup, textsOf };
