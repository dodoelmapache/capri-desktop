'use strict';

// Opening things when you ask her to (chat.js): an app from the Start menu (Store apps like Spotify
// included), a Steam or Epic game, your music (the media keys: pause, next…, so it works with
// Spotify and most players), a Spotify search, or a website. Windows only.

const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { shell, app, nativeImage } = require('electron');
const { powershell } = require('./apps');

const WIN = process.platform === 'win32';
// not things to open from a chat: uninstallers, help pages and the like
const SKIP = /uninstall|désinstaller|desinstalar|deinstall|readme|documentation|release notes|support center|website|manual/i;
const STEAM_SKIP = /redistributable|dedicated server|steamworks/i;
// words that don't tell apps apart ("Roblox Player" is "roblox")
const FILLER = new Set(['player', 'launcher', 'app', 'the', 'for', 'windows', 'desktop', 'client', 'x64', 'x86', 'beta']);
const CACHE_MS = 10 * 60 * 1000; // installed apps hardly change

let cache = null; // { at, items }

const plain = (text) => String(text || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
const words = (text) => plain(text).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);

// Everything she can open: [{ name, kind: 'app' | 'steam' | 'epic', id }]
async function launchables() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.items;
  if (!WIN) return [];
  const items = [];
  const seen = new Set();
  const add = (item) => {
    const key = words(item.name).join(' ');
    if (!key || seen.has(key) || SKIP.test(item.name)) return;
    seen.add(key);
    items.push(item);
  };
  // games first: a game's own entry wins over a shortcut to it
  for (const game of [...steamGames(await steamRoot()), ...epicGames()]) add(game);
  // the Start menu's list is slow the first time (PowerShell starting cold): main.js asks for it early
  const out = await powershell('Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress', 45000).catch(() => null);
  for (const { Name, AppID } of [].concat(out ? JSON.parse(out) : [])) {
    if (Name && AppID && !/^https?:/i.test(AppID)) add({ name: Name, kind: 'app', id: AppID });
  }
  if (out !== null) cache = { at: Date.now(), items }; // a list that failed isn't kept: next time, again
  return items;
}

function steamRoot() {
  return new Promise((resolve) => {
    execFile('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true, timeout: 5000 }, (err, out) => {
      const found = !err && /SteamPath\s+REG_SZ\s+(.+)/.exec(String(out))?.[1].trim();
      resolve(found ? path.normalize(found) : null);
    });
  });
}

// Steam's games, from the manifests in each of its libraries
function steamGames(root) {
  if (!root) return [];
  const libraries = new Set([root]);
  try {
    const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libraries.add(path.normalize(m[1].replace(/\\\\/g, '\\')));
  } catch {
    // one library, the main one
  }
  const games = [];
  for (const library of libraries) {
    let files = [];
    try {
      files = fs.readdirSync(path.join(library, 'steamapps')).filter((f) => /^appmanifest_\d+\.acf$/.test(f));
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const acf = fs.readFileSync(path.join(library, 'steamapps', file), 'utf8');
        const id = /"appid"\s+"(\d+)"/.exec(acf)?.[1];
        const name = /"name"\s+"([^"]+)"/.exec(acf)?.[1];
        if (id && name && !STEAM_SKIP.test(name)) games.push({ name, kind: 'steam', id });
      } catch {
        // a manifest being written: skip it
      }
    }
  }
  return games;
}

// Epic's games, from its launcher's manifests (not the Unreal Engine plugins it also keeps there)
function epicGames() {
  const dir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.item'));
  } catch {
    return [];
  }
  const games = [];
  for (const file of files) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (m.bIsIncompleteInstall || m.CatalogNamespace === 'ue' || !m.DisplayName || !m.AppName) continue;
      games.push({ name: m.DisplayName, kind: 'epic', id: `${m.CatalogNamespace}:${m.CatalogItemId}:${m.AppName}` });
    } catch {
      // not one of its manifests
    }
  }
  return games;
}

// The one of `items` named in `text` (your message, or the name in her tag): all the words of its
// name in it, else at least half of them; the closest wins. null if nothing fits well enough.
function match(items, text) {
  const said = new Set(words(text));
  if (said.has('yt') || said.has('ytm') || said.has('youtub')) { said.add('youtube'); if (said.has('ytm')) said.add('music'); } // ("yt music", "ytm": how you say it)
  const joined = words(text).join('');
  let best = null;
  for (const item of items) {
    const key = words(item.name).filter((w) => !FILLER.has(w));
    if (!key.length) continue;
    const hits = key.filter((w) => said.has(w) || (w.length >= 5 && joined.includes(w)));
    if (!hits.some((w) => w.length >= 3) || hits.length / key.length < 0.5) continue;
    const rank = (hits.length / key.length) * 10 + hits.join('').length / 10;
    if (!best || rank > best.rank) best = { item, rank };
  }
  return best?.item || null;
}

// "mi navegador", "el browser": not the name of any app, but you mean the one you use: your default browser, else the first one installed.
const BROWSER_WORD = /\b(?:navegador|navigateur|browser|internet)\b/i;
const BROWSERS = [ // [ProgId of the default-browser setting, name in the Start menu]
  [/ChromeHTML/i, /\bchrome\b/i], [/MSEdgeHTM/i, /\bedge\b/i], [/Firefox/i, /\bfirefox\b/i], [/Brave/i, /\bbrave\b/i],
  [/Opera/i, /\bopera\b/i], [/Vivaldi/i, /\bvivaldi\b/i], [/Zen/i, /\bzen\b/i],
];
const NOT_A_BROWSER = /remote|helper|updater|update|setup|install|uninstall|crash|proxy|beta|dev\b|canary/i;
function defaultBrowserProgId() {
  return new Promise((resolve) => {
    execFile('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', '/v', 'ProgId'], { windowsHide: true, timeout: 5000 }, (err, out) => {
      resolve(!err && /ProgId\s+REG_SZ\s+(\S+)/.exec(String(out))?.[1] || '');
    });
  });
}
async function browserOf(items) {
  const usable = items.filter((i) => i.kind === 'app' && !NOT_A_BROWSER.test(i.name));
  const progId = await defaultBrowserProgId();
  for (const [prog, app] of BROWSERS) {
    if (!prog.test(progId)) continue;
    const found = usable.find((i) => app.test(i.name));
    if (found) return found;
  }
  for (const [, app] of BROWSERS) { // the default one isn't in the list (or unknown): the first browser that is
    const found = usable.find((i) => app.test(i.name));
    if (found) return found;
  }
  return null;
}

// "el navegador": the one you named in her config (browserApp: "zen", "chrome"...), else your default browser, else the first one installed
async function preferredBrowser(items) {
  let pref = '';
  try { pref = String(require('./config').load().browserApp || '').trim(); } catch { /* no config */ }
  if (pref) {
    const re = new RegExp(pref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const hit = items.find((i) => i.kind === 'app' && re.test(i.name) && !NOT_A_BROWSER.test(i.name));
    if (hit) return hit;
  }
  return browserOf(items);
}

async function find(text) {
  const items = await launchables();
  return match(items, text) || (BROWSER_WORD.test(String(text)) ? preferredBrowser(items) : null);
}

// Opens one of them (only something she listed herself): a Start menu app through its AppsFolder
// entry (desktop and Store apps alike), a game through its launcher's link.
async function launch({ kind, id } = {}) {
  const item = (await launchables()).find((i) => i.kind === kind && i.id === id);
  if (!item) throw new Error('not found');
  if (kind === 'steam') return shell.openExternal(`steam://rungameid/${id}`);
  if (kind === 'epic') return shell.openExternal(`com.epicgames.launcher://apps/${encodeURIComponent(id)}?action=launch&silent=true`);
  spawn('explorer.exe', [`shell:AppsFolder\\${id}`], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  return undefined;
}

// The media keys, as if pressed on the keyboard: whatever plays music (Spotify, a browser…) reacts.
// Play and pause are the same key; the volume moves a few steps at a time.
const MEDIA = { pause: [179, 1], play: [179, 1], next: [176, 1], previous: [177, 1], volup: [175, 5], voldown: [174, 5], mute: [173, 1] };

async function media(action) {
  if (!WIN || !MEDIA[action]) return false;
  const [key, times] = MEDIA[action];
  try { require('./mediakeys').pass(); } catch { /* no helper: nothing to tell */ } // (her keys let this one through to Windows)
  return powershell(`$w = New-Object -ComObject WScript.Shell; 1..${times} | ForEach-Object { $w.SendKeys([string][char]${key}) }`)
    .then(() => true, () => false);
}

// Pause and play on Windows' own media sessions instead of the one key that toggles: "pausa" pauses everything that plays (a video in a tab and your
// music), "reproduce" resumes the current one, and neither turns the other around (the key would start the music if it was already paused).
const SMART_PS = {
  pause: "$n = 0; foreach ($x in $mgr.GetSessions()) { if ([string]$x.GetPlaybackInfo().PlaybackStatus -eq 'Playing') { if (Await ($x.TryPauseAsync()) ([bool])) { $n++ } } }; $n",
  play: '$s = $mgr.GetCurrentSession(); if (-not $s) { $s = $mgr.GetSessions() | Select-Object -First 1 }; if ($s -and (Await ($s.TryPlayAsync()) ([bool]))) { 1 } else { 0 }',
};

// What plays, from Windows' own media sessions (what browsers, Spotify and most players report to): every
// one of them, [{ title, artist, album, app, appId, playing, kind }], kind 'music' (YouTube Music's app,
// Spotify and the like, or anything that says it's music or has an album) or 'video' (the rest: a tab in
// your browser, a player). WinRT from PowerShell 5.1.
const MUSIC_APP = /cinhimbnkk[a-z]+|youtubemusic|ytmusic|spotify|zune|itunes|deezer|tidal|amazonmusic|applemusic/i;
const PRELUDE_PS = [
  'Add-Type -AssemblyName System.Runtime.WindowsRuntime;',
  "$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0];",
  'function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result };',
  '$M = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime];',
  '$P = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime];',
  '$mgr = Await ($M::RequestAsync()) $M;',
].join(' ');

const NOW_SESSIONS_PS = `${PRELUDE_PS} $rows = @(); foreach ($x in $mgr.GetSessions()) { $pp = Await ($x.TryGetMediaPropertiesAsync()) $P; `
  + '$pos = 0; $dur = 0; $age = 0; try { $tl = $x.GetTimelineProperties(); if ($tl) { $pos = [math]::Round($tl.Position.TotalSeconds, 1); $dur = [math]::Round(($tl.EndTime - $tl.StartTime).TotalSeconds); $age = [math]::Round(([datetime]::UtcNow - $tl.LastUpdatedTime.UtcDateTime).TotalSeconds, 1) } } catch { }; '
  + '$rows += [pscustomobject]@{ title = $pp.Title; artist = $pp.Artist; album = $pp.AlbumTitle; app = $x.SourceAppUserModelId; type = [string]$pp.PlaybackType; status = [string]$x.GetPlaybackInfo().PlaybackStatus; pos = $pos; dur = $dur; age = $age } }; '
  + 'ConvertTo-Json -Compress -InputObject @($rows)';

// "Chrome._crx_cinhim…" (YouTube Music's app), "SpotifyAB.SpotifyMusic_zpd…!Spotify" or "chrome.exe" -> "YT Music", "Spotify", "Chrome"
function appName(id) {
  if (/cinhimbnkk[a-z]+|youtubemusic|ytmusic/i.test(String(id || ''))) return 'YT Music';
  if (/^Chrome\._crx_/i.test(String(id || ''))) return 'App de Chrome'; // (another app of Chrome: its id is not a name)
  const name = String(id || '').split('!').pop().replace(/\.exe$/i, '').replace(/_.*$/, '').split('.').pop().trim();
  return name ? name[0].toUpperCase() + name.slice(1) : '';
}

function kindOf(row) {
  if (MUSIC_APP.test(String(row.app || ''))) return 'music';
  if (row.type === 'Video') return 'video';
  // A browser says "Music" for everything it plays (YouTube videos too): there, only an album makes it music
  if (/^(?:chrome|msedge|firefox|brave|opera|vivaldi|zen)\b|^Chrome\._crx_|^MSEdge/i.test(String(row.app || ''))) return String(row.album || '').trim() ? 'music' : 'video';
  return row.type === 'Music' || String(row.album || '').trim() ? 'music' : 'video';
}

async function nowSessions() {
  if (!WIN) return [];
  try {
    const out = await powershell(NOW_SESSIONS_PS, 8000);
    const rows = [].concat(out ? JSON.parse(out) : []);
    const seen = new Set();
    const list = [];
    for (const row of rows) {
      const title = String(row.title || '').trim().slice(0, 200);
      if (!title || !['Playing', 'Paused'].includes(row.status)) continue;
      const key = `${row.app}|${title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({
        title,
        artist: String(row.artist || '').trim().slice(0, 120),
        album: String(row.album || '').trim().slice(0, 120),
        app: appName(row.app),
        appId: String(row.app || '').slice(0, 300),
        playing: row.status === 'Playing',
        kind: kindOf(row),
        pos: Math.max(0, Number(row.pos) || 0), // seconds in at the player's last report, and how long it is (0: the player does not say)
        dur: Math.max(0, Number(row.dur) || 0),
        age: (() => { // how long ago it said that position: it has moved on by that much since, if it plays (a date from the year 1 is no date)
          const a = Number(row.age) || 0;
          return a > 0 && a < 36000 && a < (Number(row.dur) || 0) ? a : 0;
        })(),
      });
    }
    return list;
  } catch {
    return [];
  }
}

// The picture of what plays (the album's cover, a video's thumbnail), as Windows' media session carries it, as a data URL. One session: the one of that
// app and title. Asked for when a row of the strip shows a new song, not on every look. null when the player gives none.
const ART_PS = '$S = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]; '
  + '$DR = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]; '
  + "$asStream = [System.IO.WindowsRuntimeStreamExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsStreamForRead' -and $_.GetParameters().Count -eq 1 } | Select-Object -First 1; "
  + "$out = ''; try { foreach ($x in $mgr.GetSessions()) { if ($env:CAPRI_APP -and $x.SourceAppUserModelId -ne $env:CAPRI_APP) { continue }; "
  + '$pp = Await ($x.TryGetMediaPropertiesAsync()) $P; if ($env:CAPRI_TITLE -and $pp.Title -ne $env:CAPRI_TITLE) { continue }; '
  + "if (-not $pp.Thumbnail) { $out = 'NOTHUMB'; continue }; $st = Await ($pp.Thumbnail.OpenReadAsync()) $S; "
  + 'try { $net = $asStream.Invoke($null, @($st)); $ms = New-Object System.IO.MemoryStream; $net.CopyTo($ms); $bytes = $ms.ToArray() } '
  + "catch { $n = [uint32]$st.Size; $rd = $DR::new($st.GetInputStreamAt(0)); [void](Await ($rd.LoadAsync($n)) ([uint32])); $bytes = New-Object byte[] $n; $rd.ReadBytes($bytes) }; "
  + "$out = [Convert]::ToBase64String($bytes); break } } catch { $out = 'ERR:' + $_.Exception.Message }; $out";
// what the picture's search says when there is none (capri-desktop\_logs\art.log), so a player that gives no cover can be told from a mistake
const ART_LOG = path.join(__dirname, '..', '..', '_logs', 'art.log');
function artLog(line) {
  try {
    fs.mkdirSync(path.dirname(ART_LOG), { recursive: true });
    fs.appendFileSync(ART_LOG, `${new Date().toISOString()} ${line}\n`);
  } catch { /* a packaged app can't write there: no record */ }
}
async function nowArt(target = {}) {
  if (!WIN || !target?.appId) return null;
  const ask = async (title) => String(await powershell(`${PRELUDE_PS} ${ART_PS}`, 10000, { CAPRI_TITLE: title, CAPRI_APP: String(target.appId || '') }).catch((err) => `ERR:${err.message}`) || '').trim();
  try {
    let b64 = await ask(String(target.title || ''));
    if (!b64 && target.title) b64 = await ask(''); // (the title moved on a moment ago: that app's picture, whichever it is)
    if (!/^[A-Za-z0-9+/=]{100,}$/.test(b64)) {
      artLog(`no picture for "${String(target.title || '').slice(0, 60)}" (${String(target.appId).slice(0, 60)}): ${b64.slice(0, 160) || 'the player gave nothing'}`);
      return null;
    }
    const head = Buffer.from(b64.slice(0, 16), 'base64');
    const mime = head[0] === 0x89 && head[1] === 0x50 ? 'image/png' : head[0] === 0xff && head[1] === 0xd8 ? 'image/jpeg' : head.slice(0, 4).toString() === 'RIFF' ? 'image/webp' : 'image/jpeg';
    return `data:${mime};base64,${b64}`;
  } catch (err) {
    artLog(`picture failed: ${err.message}`);
    return null;
  }
}

// The one for a single answer ("¿qué suena?"): what plays, music first; else music, else the first.
async function nowPlaying() {
  const list = await nowSessions();
  const score = (s) => (s.playing ? 2 : 0) + (s.kind === 'music' ? 1 : 0);
  return [...list].sort((x, y) => score(y) - score(x))[0] || null;
}

// ⏮ ⏯ ⏭ on one session: the one on the card you pressed (matched by its song and app), so a video in a tab
// doesn't skip your music. With no card (a button in her chat): what plays, music first. The media keys
// (media(), above) when that doesn't work.
const SESSION_CALL = { previous: 'TrySkipPreviousAsync', toggle: 'TryTogglePlayPauseAsync', next: 'TrySkipNextAsync', seek: 'TryChangePlaybackPositionAsync([int64]([double]$env:CAPRI_SEEK * 10000000))' };
const BEST_PS = '$best = $null; $top = -1; '
  + "foreach ($x in $mgr.GetSessions()) { $score = 0; if ([string]$x.GetPlaybackInfo().PlaybackStatus -eq 'Playing') { $score += 2 }; "
  + "if ($x.SourceAppUserModelId -match 'cinhimbnkk[a-z]+|youtubemusic|ytmusic|spotify') { $score += 1 }; if ($score -gt $top) { $top = $score; $best = $x } }; "
  + 'if (-not $best) { $best = $mgr.GetCurrentSession() };';
// the title and the app come in the environment, never inside the script
const PICK_PS = '$hit = $null; if ($env:CAPRI_TITLE) { '
  + 'foreach ($x in $mgr.GetSessions()) { if (-not $hit -and $x.SourceAppUserModelId -eq $env:CAPRI_APP) { $pp = Await ($x.TryGetMediaPropertiesAsync()) $P; if ($pp.Title -eq $env:CAPRI_TITLE) { $hit = $x } } }; '
  + 'if (-not $hit) { foreach ($x in $mgr.GetSessions()) { if (-not $hit -and $x.SourceAppUserModelId -eq $env:CAPRI_APP) { $hit = $x } } } }; '
  + `${BEST_PS} if (-not $hit) { $hit = $best };`;

// What the media orders of her chat use: the sessions first, the keys when Windows has no session to talk to
async function mediaSmart(action) {
  if (WIN && SMART_PS[action]) {
    const out = await powershell(`${PRELUDE_PS} ${SMART_PS[action]}`, 8000).catch(() => null);
    if (out !== null && (action === 'pause' || /[1-9]/.test(String(out)))) return true; // (to pause what is not playing is done)
  }
  if (WIN && (action === 'next' || action === 'previous') && await nowControl(action).catch(() => false)) return true;
  return media(action);
}

async function nowControl(action, target = null, seconds = 0) {
  if (!SESSION_CALL[action]) return false;
  if (WIN) {
    const env = { CAPRI_TITLE: String(target?.title || ''), CAPRI_APP: String(target?.appId || ''), CAPRI_SEEK: String(Math.max(0, Number(seconds) || 0)) };
    const done = await powershell(`${PRELUDE_PS} ${PICK_PS} if ($hit) { Await ($hit.${SESSION_CALL[action]}()) ([bool]) }`, 8000, env)
      .then((out) => /true/i.test(out), () => false);
    if (done) return true;
  }
  return action === 'seek' ? false : media(action === 'toggle' ? 'pause' : action);
}

// The icons of the apps on her wheel (wheel.js), the ones the Start menu shows: a shortcut there gives the app's
// own icon (a Chrome app's too), else the file its id points to. { 'app:<id>': 'data:image/png;base64,…' };
// what has no icon here (a game, a Store app with no shortcut) is left out, and the wheel keeps its letters.
let linkIndex = null; // the .lnk files of the Start menu: [{ file, name }]
const iconCache = new Map(); // 'kind:id' -> { data URL or null, at }: a miss is tried again after a couple of minutes
const ICON_RETRY_MS = 2 * 60 * 1000;
let packages = null; // the Store apps installed: { at, dirs: Map(package family -> its folder) }

function startMenuLinks() {
  if (linkIndex && Date.now() - linkIndex.at < CACHE_MS) return linkIndex.list;
  const list = [];
  const roots = [
    process.env.ProgramData && path.join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    process.env.APPDATA && path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ].filter(Boolean);
  for (const root of roots) {
    try {
      for (const rel of fs.readdirSync(root, { recursive: true })) {
        if (/\.lnk$/i.test(rel)) list.push({ file: path.join(root, rel), name: plain(path.basename(rel, '.lnk')) });
      }
    } catch { /* a Start menu folder that isn't there */ }
  }
  linkIndex = { at: Date.now(), list };
  return list;
}

const expandEnv = (text) => String(text || '').replace(/%([^%]+)%/g, (all, name) => process.env[name] ?? all);

// the picture of a file's icon, at most 64 px: an .ico as it is, else Windows' own picture of the icon
async function imageOf(file) {
  let img = null;
  try {
    if (/\.(ico|png)$/i.test(file)) img = nativeImage.createFromPath(file);
    if (!img || img.isEmpty()) img = await nativeImage.createThumbnailFromPath(file, { width: 64, height: 64 });
  } catch { img = null; }
  if (!img || img.isEmpty()) {
    try { img = await app.getFileIcon(file, { size: 'large' }); } catch { img = null; }
  }
  if (!img || img.isEmpty()) return null;
  return img.getSize().width > 64 ? img.resize({ width: 64, height: 64, quality: 'best' }) : img;
}

// A Store app (WhatsApp, say) has no shortcut in the Start menu: its icon is in its package, the logo its manifest
// names, in the biggest size it ships. Windows' own picture of it first, when Windows hands it over.
async function packageDirs() {
  if (packages && Date.now() - packages.at < CACHE_MS) return packages.dirs;
  const dirs = new Map();
  const out = await powershell('Get-AppxPackage | Select-Object PackageFamilyName, InstallLocation | ConvertTo-Json -Compress', 30000).catch(() => null);
  for (const row of [].concat(out ? JSON.parse(out) : [])) {
    if (row?.PackageFamilyName && row.InstallLocation) dirs.set(row.PackageFamilyName, row.InstallLocation);
  }
  if (out !== null) packages = { at: Date.now(), dirs };
  return dirs;
}

// of the files that go by that logo's name (…scale-200.png, …targetsize-48.png), the biggest up to 256 px,
// the ones with their colours before the single-colour "unplated" ones
function biggestLogo(dir, logo) {
  const name = logo.replaceAll('\\', '/'); // the manifest writes Windows paths
  const ext = path.posix.extname(name);
  const base = path.posix.basename(name, ext).toLowerCase();
  const rank = (name) => {
    const n = name.toLowerCase();
    const size = Number(/targetsize-(\d+)/.exec(n)?.[1]) || Number(/scale-(\d+)/.exec(n)?.[1]) || 100;
    return [n.includes('altform') ? 0 : 1, Math.min(size, 256)];
  };
  const names = fs.readdirSync(dir).filter((n) => n.toLowerCase().startsWith(base) && n.toLowerCase().endsWith(ext.toLowerCase()));
  names.sort((a, b) => {
    const [pa, sa] = rank(a);
    const [pb, sb] = rank(b);
    return pb - pa || sb - sa;
  });
  return names[0] ? path.join(dir, names[0]) : null;
}

async function storeIcon(id) {
  try {
    const own = await nativeImage.createThumbnailFromPath(`shell:AppsFolder\\${id}`, { width: 64, height: 64 }).catch(() => null);
    if (own && !own.isEmpty()) return own.toDataURL();
  } catch { /* Windows doesn't give it this way */ }
  try {
    const [family, appId] = id.split('!');
    const root = (await packageDirs()).get(family);
    if (!root) return null;
    const manifest = fs.readFileSync(path.join(root, 'AppxManifest.xml'), 'utf8');
    const blocks = [...manifest.matchAll(/<Application\b([^>]*)>([\s\S]*?)<\/Application>/g)];
    const block = blocks.find((m) => new RegExp(`\\bId="${appId}"`, 'i').test(m[1])) || blocks[0];
    const logo = (/\bSquare44x44Logo="([^"]+)"/.exec(block?.[2] || '') || /\bSquare150x150Logo="([^"]+)"/.exec(block?.[2] || ''))?.[1];
    if (!logo) return null;
    const rel = path.join(root, logo.replaceAll('\\', path.sep));
    const file = biggestLogo(path.dirname(rel), logo) || (fs.existsSync(rel) ? rel : null);
    const img = file && await imageOf(file);
    return img ? img.toDataURL() : null;
  } catch {
    return null;
  }
}

async function iconOf(item) {
  const key = `${item.kind}:${item.id}`;
  const kept = iconCache.get(key);
  if (kept && (kept.data || Date.now() - kept.at < ICON_RETRY_MS)) return kept.data;
  const files = [];
  if (item.kind === 'app') {
    const direct = expandEnv(item.id);
    if (path.isAbsolute(direct) && /\.(exe|ico)$/i.test(direct) && fs.existsSync(direct)) files.push(direct);
    const want = plain(item.name);
    const links = startMenuLinks();
    const link = links.find((l) => l.name === want)
      || links.filter((l) => want.length >= 4 && (l.name.includes(want) || want.includes(l.name))).sort((a, b) => a.name.length - b.name.length)[0];
    if (link) {
      try {
        const details = shell.readShortcutLink(link.file);
        const icon = expandEnv(details.icon);
        if (icon && fs.existsSync(icon) && (/\.ico$/i.test(icon) || !details.iconIndex)) files.push(icon);
        const target = expandEnv(details.target);
        if (target && fs.existsSync(target)) files.push(target);
      } catch { /* a shortcut that can't be read */ }
    }
  }
  let data = null;
  for (const file of files) {
    const img = await imageOf(file);
    if (img) {
      data = img.toDataURL();
      break;
    }
  }
  if (!data && item.kind === 'app' && item.id.includes('!')) data = await storeIcon(item.id); // a Store app
  iconCache.set(key, { data, at: Date.now() });
  return data;
}

// only what she can open herself (launchables): the wheel can't ask for any other file's icon
async function icons(items) {
  const known = await launchables().catch(() => []);
  const out = {};
  for (const wanted of (Array.isArray(items) ? items : []).slice(0, 24)) {
    const item = known.find((k) => k.kind === wanted?.kind && k.id === wanted?.id);
    const data = item && await iconOf(item);
    if (data) out[`${item.kind}:${item.id}`] = data;
  }
  return out;
}

// The power buttons of her wheel (wheel.js, which asks you first for restart and shut down): sleep at once; restart and shut down in 10 seconds,
// without forcing anything shut so your apps can still ask to save; `cancel` stops them in that time.
// A record of what the power buttons did and what Windows answered (capri-desktop\_logs\power.log): when one doesn't work, it says why.
const POWER_LOG = process.env.CAPRI_POWER_LOG || path.join(__dirname, '..', '..', '_logs', 'power.log');
function powerLog(line) {
  try {
    fs.mkdirSync(path.dirname(POWER_LOG), { recursive: true });
    fs.appendFileSync(POWER_LOG, `${new Date().toISOString()} ${line}\n`);
  } catch { /* a packaged app can't write there: no record, nothing breaks */ }
}

// What this PC says about sleeping: the states it supports, what woke it last, which devices may wake it, its sleep settings, any policy
// about it, and what the power system logged in the last quarter of an hour (it says when a sleep started and why one was cancelled)
function diagnoseSleep() {
  const q = "*[System[Provider[@Name='Microsoft-Windows-Kernel-Power'] and TimeCreated[timediff(@SystemTime) <= 900000]]]";
  for (const [label, file, args] of [
    ['powercfg /a', 'powercfg.exe', ['/a']],
    ['powercfg /lastwake', 'powercfg.exe', ['/lastwake']],
    ['powercfg /devicequery wake_armed', 'powercfg.exe', ['/devicequery', 'wake_armed']],
    ['powercfg /query SUB_SLEEP', 'powercfg.exe', ['/query', 'SCHEME_CURRENT', 'SUB_SLEEP']],
    ['policy', 'reg.exe', ['query', 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Power', '/s']],
    ['Kernel-Power events (15 min)', 'wevtutil.exe', ['qe', 'System', `/q:${q}`, '/c:15', '/rd:true', '/f:text']],
  ]) {
    execFile(file, args, { windowsHide: true, timeout: 10000, encoding: 'latin1', maxBuffer: 1024 * 1024 }, (err, out, errout) => {
      powerLog(`--- ${label} ---\n${String(out || errout || err?.message || '').trim().slice(0, 3500)}\n--- end ---`);
    });
  }
}

// One try, watched: the program's own answer, and above all whether the PC really slept. A PC that sleeps freezes this process too, and
// when it wakes the clock has jumped: that jump is the proof. (Windows may say "done" and do nothing; that is what this is for.)
function watchSleep(watchMs, gapMs, clock) {
  return new Promise((resolve) => {
    const t0 = clock();
    let last = t0;
    const iv = setInterval(() => {
      const now = clock();
      if (now - last > gapMs) {
        clearInterval(iv);
        return resolve(true);
      }
      last = now;
      if (now - t0 > watchMs) {
        clearInterval(iv);
        return resolve(false);
      }
      return undefined;
    }, Math.max(50, Math.min(400, Math.floor(gapMs / 4)))); // (it ends by itself within watchMs)
  });
}

function runCapture(file, args, waitMs) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let settled = false;
    let timer = null;
    const done = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    let child;
    try {
      child = spawn(file, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      return done({ code: null, err: e.message });
    }
    child.stdout?.on('data', (d) => { out += d; });
    child.stderr?.on('data', (d) => { err += d; });
    child.on('error', (e) => done({ code: null, err: e.message }));
    child.on('close', (code) => done({ code, out: out.trim().slice(0, 200), err: err.trim().replace(/\s+/g, ' ').slice(0, 200) }));
    timer = setTimeout(() => { // still running: for a sleep, it may be asleep
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
      done({ code: null, pending: true, out: out.trim().slice(0, 200), err: err.trim().slice(0, 200) });
    }, waitMs);
  });
}

const ps = (script) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
// 1) what Windows Forms offers
const SLEEP_DOTNET = `try {
  Add-Type -AssemblyName System.Windows.Forms
  $ok = [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)
  [Console]::Out.WriteLine('returned=' + $ok)
  if (-not $ok) { [Console]::Error.WriteLine('Windows rechazo el reposo (SetSuspendState dio false)'); exit 2 }
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 3 }`;
// 3) the same call, straight to powrprof.dll, forcing it
const SLEEP_PINVOKE = `try {
  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class CapriP { [DllImport("powrprof.dll", SetLastError=true)] public static extern bool SetSuspendState(bool hibernate, bool force, bool disableWake); }'
  $r = [CapriP]::SetSuspendState($false, $true, $false)
  [Console]::Out.WriteLine('returned=' + $r + ' err=' + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 3 }`;
// 4) the old API, with the shutdown privilege switched on first
const SLEEP_SYSTEMSTATE = `try {
  Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class CapriS {
  [StructLayout(LayoutKind.Sequential, Pack=1)] struct TP { public int Count; public long Luid; public int Attr; }
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr h, int acc, out IntPtr tok);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool LookupPrivilegeValue(string host, string name, out long luid);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool AdjustTokenPrivileges(IntPtr tok, bool all, ref TP tp, int len, IntPtr prev, IntPtr relen);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetSystemPowerState(bool suspend, bool force);
  public static string Go() {
    IntPtr tok; OpenProcessToken(GetCurrentProcess(), 0x28, out tok);
    TP tp = new TP(); tp.Count = 1; LookupPrivilegeValue(null, "SeShutdownPrivilege", out tp.Luid); tp.Attr = 2;
    AdjustTokenPrivileges(tok, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero);
    bool r = SetSystemPowerState(true, false);
    return "returned=" + r + " err=" + Marshal.GetLastWin32Error();
  }
}
'@
  [Console]::Out.WriteLine([CapriS]::Go())
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 3 }`;

const SLEEP_WAYS = [
  ['powershell .NET', 'powershell.exe', ps(SLEEP_DOTNET)],
  ['rundll32', 'rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']],
  ['powrprof forzado', 'powershell.exe', ps(SLEEP_PINVOKE)],
  ['SetSystemPowerState', 'powershell.exe', ps(SLEEP_SYSTEMSTATE)],
];

// Did Windows log a suspend (Kernel-Power, event 42) since `sinceMs` ago? A PC that slept and was woken at once (the mouse you just clicked with
// moves, and it's armed to wake the PC) leaves no clock gap, but it does leave this record: that is the real proof of a sleep.
function suspendLogged(sinceMs) {
  return new Promise((resolve) => {
    const q = `*[System[Provider[@Name='Microsoft-Windows-Kernel-Power'] and (EventID=42) and TimeCreated[timediff(@SystemTime) <= ${Math.ceil(sinceMs + 3000)}]]]`;
    execFile('wevtutil.exe', ['qe', 'System', `/q:${q}`, '/c:1', '/f:xml'], { windowsHide: true, timeout: 8000, encoding: 'latin1' }, (err, out) => {
      resolve(!err && /<EventID[^>]*>42</.test(String(out || '')));
    });
  });
}

// Sleep: each way in turn, until the PC really sleeps. Returns true when it did (the call comes back after you wake it).
// A grace second or two first: the click that pressed the button is still moving the mouse, and a mouse armed to wake the PC would wake it
// the very moment it slept (which looked like "it didn't sleep", and she kept trying the other ways).
async function sleepNow(onFail, { watchMs = 5000, gapMs = 4000, clock = Date.now, graceMs = 2500, checkLog = suspendLogged } = {}) {
  const said = [];
  if (graceMs > 0) await new Promise((r) => setTimeout(r, graceMs));
  for (const [id, file, args] of SLEEP_WAYS) {
    const t0 = clock();
    const [gapSlept, r] = await Promise.all([watchSleep(watchMs, gapMs, clock), runCapture(file, args, watchMs)]);
    const logged = gapSlept ? true : await checkLog(clock() - t0).catch(() => false);
    const slept = gapSlept || logged;
    powerLog(`sleep via ${id}: ${JSON.stringify({ ...r, slept, byLog: !gapSlept && logged })}`);
    if (slept) {
      if (!gapSlept) powerLog('it did sleep (Windows logged it) and something woke it at once: a mouse or keyboard armed to wake the PC');
      setTimeout(diagnoseSleep, 6000).unref?.(); // (what the PC says about it, now it's awake)
      return true;
    }
    said.push(`${id}: ${r.err || r.out || (r.code === 0 ? 'Windows dijo "hecho" y no se durmió' : `código ${r.code}`)}`);
    if (clock() - t0 < 0) break;
  }
  diagnoseSleep();
  onFail({ action: 'sleep', reason: said[0] || 'no se durmió', hint: 'noefecto', tried: said });
  return false;
}

// Restart and shut down are asked of Windows (shutdown.exe), which answers at once if it refuses. She doesn't take them for done because
// the command started: she waits for its answer.
async function power(action, onFail = () => {}, opts = {}) {
  if (!WIN) return false;
  powerLog(`pressed: ${action}`);
  if (action === 'sleep') return sleepNow(onFail, opts);
  if (action === 'restart' || action === 'shutdown' || action === 'cancel') {
    const flags = { restart: ['/r', '/t', '10'], shutdown: ['/s', '/t', '10'], cancel: ['/a'] }[action];
    const r = await runCapture('shutdown.exe', flags, 4000);
    powerLog(`${action}, shutdown.exe: ${JSON.stringify(r)}`);
    if (r.code === 0 || r.pending) return true;
    onFail({ action, reason: r.err || `código ${r.code}`, hint: '' });
    return false;
  }
  return false;
}

// A Spotify search for it: in the app if it's installed, else on the web.
async function music(query) {
  const q = String(query || '').trim().slice(0, 200);
  if (!q) return false;
  try {
    await shell.openExternal(`spotify:search:${encodeURIComponent(q)}`);
  } catch {
    await shell.openExternal(`https://open.spotify.com/search/${encodeURIComponent(q)}`);
  }
  return true;
}

// A website: http or https, with a real host name.
function siteUrl(address) {
  try {
    const url = new URL(/^https?:\/\//i.test(address) ? address : `https://${address}`);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname.includes('.') ? url : null;
  } catch {
    return null;
  }
}

async function site(address) {
  const url = siteUrl(String(address || '').trim());
  if (!url) return false;
  await shell.openExternal(url.toString());
  return true;
}

// YouTube Music, in its own app (a Chrome app) when you have one: the Start menu's shortcut to it says how it is started (which Chrome profile, which app
// id), and the page you want goes along as the page to open. Without that app, a Chrome window in app mode; without Chrome, your browser.
async function ytMusicOpen(url) {
  const target = String(url || '');
  if (!/^https:\/\/music\.youtube\.com\/[\w\-./?=&%]*$/.test(target)) return null;
  if (!WIN) {
    await shell.openExternal(target);
    return 'browser';
  }
  try {
    const ps = "$w = New-Object -ComObject WScript.Shell; $roots = @(\"$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\", \"$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\"); "
      + "foreach ($r in $roots) { if (Test-Path $r) { foreach ($f in Get-ChildItem -Path $r -Recurse -Filter '*.lnk' -ErrorAction SilentlyContinue) { "
      + "if ($f.BaseName -match 'YouTube Music') { $l = $w.CreateShortcut($f.FullName); if ($l.Arguments -match '--app-id=') { [pscustomobject]@{ exe = $l.TargetPath; args = $l.Arguments } | ConvertTo-Json -Compress; exit } } } } }";
    const raw = String(await powershell(ps, 15000) || '').trim();
    const link = raw ? JSON.parse(raw) : null;
    if (link?.exe && fs.existsSync(link.exe)) {
      const args = (String(link.args).match(/"[^"]*"|\S+/g) || []).map((a) => a.replace(/^"|"$/g, ''));
      spawn(link.exe, [...args, `--app-launch-url-for-shortcuts-menu-item=${target}`], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
      return 'app';
    }
  } catch { /* no such app: the next way */ }
  const chrome = [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
    .filter(Boolean).map((d) => path.join(d, d === process.env.LOCALAPPDATA ? 'Google\\Chrome\\Application\\chrome.exe' : 'Google\\Chrome\\Application\\chrome.exe')).find((f) => fs.existsSync(f));
  if (chrome) {
    spawn(chrome, [`--app=${target}`], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    return 'window';
  }
  await shell.openExternal(target);
  return 'browser';
}

// Shuffle in YouTube Music: its own button, pressed through Windows' accessibility (as a hand would; neither Chrome nor the site give any other way).
// mode 'play': the "Shuffle" button at the top of a playlist's page, which starts it shuffled (the same each time: it does not depend on a state).
// mode 'bar': the shuffle button of the player bar, which turns shuffle on or off (it does not say which it is now, so it is a toggle).
// Waits up to 14 s for the window and the page (a playlist that has just been opened is not there yet).
const SHUFFLE_PS = String.raw`$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$root = $A::RootElement
$types = @([System.Windows.Automation.ControlType]::Button, [System.Windows.Automation.ControlType]::CheckBox, [System.Windows.Automation.ControlType]::Hyperlink, [System.Windows.Automation.ControlType]::MenuItem, [System.Windows.Automation.ControlType]::SplitButton)
$deadline = (Get-Date).AddSeconds(14)
$result = 'nowindow'
# a narrow window hides the shuffle button (YouTube Music folds its bar): if it is not there, the window is made wide for a moment and put back after
$widened = $false
$restore = $null
$wpat = $null
function Put-Back { if ($script:restore -ne $null -and $script:wpat -ne $null) { try { $script:wpat.SetWindowVisualState($script:restore) } catch {} } }
while ((Get-Date) -lt $deadline) {
  foreach ($w in $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
    if ($w.Current.Name -notmatch 'YouTube Music') { continue }
    $wr = $w.Current.BoundingRectangle
    $limit = $wr.Top + $wr.Height * 0.8
    $found = @()
    $names = @()
    foreach ($t in $types) {
      $c = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, $t)
      foreach ($b in $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $c)) {
        $n = $b.Current.Name
        if ($n -match 'aleatori|shuffle|mezcl|random|orden al') { $found += $b }
        # what is in the player bar (the bottom fifth of the window), uncapped: if the button isn't found this says what is there instead
        if ($n -and $b.Current.BoundingRectangle.Top -gt $limit -and $names -notcontains $n) { $names += $n }
      }
    }
    # a few controls are not a button to Windows (a switch, a plain element): look at those with the name too
    if (-not $found.Count) {
      foreach ($n2 in @('Aleatorio', 'Mezclar', 'Shuffle', 'Activar aleatorio', 'Desactivar aleatorio', 'Orden aleatorio')) {
        $cn = New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, $n2)
        $hit = $w.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cn)
        if ($hit) { $found += $hit; break }
      }
    }
    $pick = $null
    if ($env:CAPRI_SHUF -eq 'bar') { $pick = $found | Where-Object { $_.Current.BoundingRectangle.Top -gt $limit } | Select-Object -First 1 }
    else { $pick = $found | Where-Object { $_.Current.BoundingRectangle.Top -le $limit } | Sort-Object { $_.Current.BoundingRectangle.Top } | Select-Object -First 1 }
    if (-not $pick -and $found.Count) { $pick = $found | Select-Object -First 1 }
    if ($pick) {
      $ip = $null
      $tp = $null
      if ($pick.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$ip)) { $ip.Invoke(); Start-Sleep -Milliseconds 250; Put-Back; Write-Output 'ok'; exit 0 }
      if ($pick.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$tp)) { $tp.Toggle(); Start-Sleep -Milliseconds 250; Put-Back; Write-Output 'ok'; exit 0 }
      $result = 'noinvoke'
    } elseif (-not $widened) {
      $widened = $true
      $wp2 = $null
      if ($w.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$wp2)) {
        $wpat = $wp2
        $restore = $wp2.Current.WindowVisualState
        if ($restore -ne 'Maximized') { try { $wp2.SetWindowVisualState('Maximized'); Start-Sleep -Milliseconds 1100 } catch { $restore = $null } } else { $restore = $null }
      }
      $result = 'widened'
    } else {
      Put-Back
      $result = 'nobutton|win ' + [int]$wr.Width + 'x' + [int]$wr.Height + '|bar: ' + ($names -join ' ; ')
    }
  }
  Start-Sleep -Milliseconds 700
}
Write-Output $result`;
async function ytmShuffle(mode = 'bar') {
  if (!WIN) return { ok: false, error: 'nowindows' };
  try {
    const out = String(await powershell(SHUFFLE_PS, 20000, { CAPRI_SHUF: mode === 'play' ? 'play' : 'bar' }) || '').trim().split(/\r?\n/).pop();
    if (out !== 'ok') artLog(`shuffle (${mode}): ${out}`);
    return { ok: out === 'ok', error: out === 'ok' ? '' : out };
  } catch (err) {
    artLog(`shuffle (${mode}) failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// The shuffle button of her player: the player's own control when it has one (Spotify and the like: Windows says whether it is on and sets it), and
// else the button of YouTube Music's window (which only toggles). { ok, how: 'session' | 'window', on? }
async function shuffleNow(target = null) {
  if (!WIN) return { ok: false, error: 'nowindows' };
  try {
    const env = { CAPRI_TITLE: String(target?.title || ''), CAPRI_APP: String(target?.appId || ''), CAPRI_SEEK: '0' };
    const out = String(await powershell(`${PRELUDE_PS} ${PICK_PS} if ($hit) { $pb = $hit.GetPlaybackInfo(); if ($pb.Controls.IsShuffleEnabled) { $on = [bool]$pb.IsShuffleActive; if (Await ($hit.TryChangeShuffleActiveAsync(-not $on)) ([bool])) { 'session:' + (-not $on) } else { 'fail' } } else { 'unsupported' } }`, 8000, env).catch(() => '') || '').trim();
    if (out.startsWith('session:')) return { ok: true, how: 'session', on: /true/i.test(out) };
  } catch { /* the window, then */ }
  return { ...(await ytmShuffle('bar')), how: 'window' };
}

module.exports = { shuffleNow, ytmShuffle, nowArt, ytMusicOpen, launchables, match, find, launch, media, mediaSmart, nowPlaying, nowSessions, nowControl, power, icons, music, site, siteUrl };
