'use strict';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen, protocol, net, shell, globalShortcut, nativeImage,
  clipboard, ClipboardItem, dialog, powerMonitor,
} = require('electron');
// A full-screen or borderless game over her window makes Chromium think the window is hidden and it stops drawing and animating it (her bubbles, her stowing
// away, her GIFs wait until the game is closed). Her window is always on top and click-through: it must keep drawing.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

const config = require('./config');
const { execFile: runFile, spawn: spawnDetached } = require('node:child_process');
const { TRAY, LANGS } = require('./labels');
const { createBridge } = require('./bridge');
const { startWindowWatch } = require('./windows');
const llm = require('./llm');
const stt = require('./stt');
const whisperLocal = require('./whisperlocal');
const dictate = require('./dictate');
const avscan = require('./avscan');
const hwalerts = require('./hwalerts');
const backup = require('./backup');
const wakeWord = require('./wakeword');
const rembg = require('./rembg');
const tts = require('./tts');
const setup = require('./setup');
const apps = require('./apps');
const uia = require('./uia');
const msgwatch = require('./msgwatch');
const toasts = require('./toasts');
const cleaner = require('./cleaner');
const perf = require('./perf');
const launch = require('./launch');
const permission = require('./permission');
const scanner = require('./scanner');
const files = require('./files');
const usage = require('./usage');
const selection = require('./selection');
const sessions = require('./sessions');
const chatwin = require('./chatwin');
const design = require('./design');
const attach = require('./attach');
const imagegen = require('./imagegen');
const ollama = require('./ollama');
const capture = require('./capture');
const finder = require('./finder');
const eyedropper = require('./eyedropper');
const sendphone = require('./sendphone');
const autoQuiet = require('./autoquiet');
const resume = require('./resume');
const downloads = require('./downloads');
const heavy = require('./heavy'); // light mode with games and heavy programs
const lol = require('./lol'); // game mode for League of Legends
const settingsWin = require('./settings'); // her settings window
const voices = require('./voices'); // her voice presets: try, keep, go back to the one she had
const mediaKeysHook = require('./mediakeys');
const { ASSISTANTS, assistant } = require('./assistants');
const activeAssistant = () => assistant(config.load().assistant); // Claude Code or Codex
const activeHooks = () => activeAssistant().hooks;
const demoSteps = require('../../scripts/demo-sequence');

const ROOT = path.resolve(__dirname, '..', '..');
const DEV = process.argv.includes('--dev');
const PORT = Number(process.env.CAPRI_PORT) || 47823;
const SOUND_EXT = /\.(mp3|wav|ogg|m4a)$/i;

const OLLAMA_SITE = 'https://ollama.com';

protocol.registerSchemesAsPrivileged([
  { scheme: 'capri', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let overlay = null;
let tray = null;
let trayMenu = null; // also what she opens when you right-click her
let demoTimer = null;
let windowWatch = null;
// the watcher only speaks when something changes: the overlay asks for this when it (re)loads
let lastWindows = null;
let gameInFront = false; // a game (or anything covering the whole screen) is in front: her media keys step aside
let lolFollow = null; // follows a League of Legends match (lol.js)
let heavyNow = { active: false, apps: [], light: null }; // light mode with heavy programs (heavy.js)
let chatModels = null; // the provider's models, as last seen (null: not reached)
let chatError = null;  // why not, when the provider said
let chatErrorCode = null; // 'nokey' or 'nourl': what her setup should ask for
const chats = new Map(); // id -> AbortController of an answer being streamed

const userSoundsDir = () => path.join(app.getPath('userData'), 'sounds');

// Her memory of your chats, across restarts: { history: [{ role, content }], claude: Claude Code's session }
const memoryFile = () => path.join(app.getPath('userData'), 'memory.json');
function readMemory() {
  try {
    return JSON.parse(fs.readFileSync(memoryFile(), 'utf8'));
  } catch {
    return {};
  }
}
function saveMemory(patch) {
  try {
    fs.writeFileSync(memoryFile(), JSON.stringify({ ...readMemory(), ...patch }));
  } catch (err) {
    console.error('[capri] could not save her memory:', err.message);
  }
}
function forgetChats() {
  llm.resetClaude();
  llm.resetTask();
  sessions.clear();
  saveMemory({ history: [], claude: null });
  sendCommand('forget');
}

// The folder of her clips (clips.js): yours, outside her own files
function clipsDir() {
  const set = String(config.load().clipsDir || '').trim();
  return path.resolve(set || path.join(os.homedir(), 'Desktop', 'Organización Claude', 'video', 'Capri personaje'));
}
const CLIP_EXT = /\.(gif|webp|apng|webm|mp4)$/i;

// capri://app/...        -> files of this repo
// capri://usersounds/... -> the user's own sound overrides
function serveProtocol() {
  protocol.handle('capri', (request) => {
    const url = new URL(request.url);
    const base = url.host === 'usersounds' ? userSoundsDir() : url.host === 'clips' ? clipsDir() : ROOT;
    const target = path.resolve(base, '.' + decodeURIComponent(url.pathname));
    if (target !== base && !target.startsWith(base + path.sep)) {
      return new Response('forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(target).toString());
  });
}

function targetDisplay() {
  const { displayId } = config.load();
  return screen.getAllDisplays().find((d) => d.id === displayId) || screen.getPrimaryDisplay();
}

// Her window: the work area, or the whole screen while she rests on the taskbar (her legs hang
// over it), less its top row of pixels: a window on top covering the whole screen is a fullscreen
// app to Windows (animated wallpapers pause, notifications wait). `gap`: how much of her window is
// below the top of the taskbar (0, or its height).
function overlayArea() {
  const { workArea, bounds } = targetDisplay();
  const area = ['taskbar', 'window'].includes(config.load().rest) ? { ...bounds, y: bounds.y + 1, height: bounds.height - 1 } : workArea;
  return { area, gap: area.y + area.height - (workArea.y + workArea.height) };
}

function fitOverlay() {
  if (!overlay) return;
  const { area, gap } = overlayArea();
  overlay.setBounds(area);
  overlay.webContents.send('overlay:resize', { width: area.width, height: area.height, gap });
}

// The pointer reaches her click-through window through a mouse hook, and Windows drops a hook that
// doesn't answer in time without a word (waking from sleep, a locked screen, a stall): she can't be
// clicked anymore. Off then on puts in a new one; her place on top and her size are set again too.
function rearmOverlay() {
  if (!overlay || overlay.isDestroyed()) return;
  if (gameClickThrough()) { overlay.setIgnoreMouseEvents(true); return; } // (a game has the screen: no pointer for her)
  overlay.setIgnoreMouseEvents(false);
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  fitOverlay();
  sendCommand('rearmed'); // click-through again: she waits for the pointer to be on her
  console.log('[capri] mouse hook set up again');
}

function createOverlay() {
  overlay = new BrowserWindow({
    ...overlayArea().area,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    type: process.platform === 'win32' ? 'toolbar' : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadURL('capri://app/src/renderer/index.html');
  // always shown: put away, she's still there as her biochip in the corner. Sized again first:
  // Windows keeps a new window inside the work area, and resting on the taskbar it covers it too.
  overlay.once('ready-to-show', () => {
    fitOverlay();
    overlay.showInactive();
  });
  overlay.webContents.on('render-process-gone', (_e, details) => {
    console.error('[capri] renderer gone:', details.reason);
  });
  if (DEV) {
    overlay.webContents.on('console-message', (e) => {
      const { level, message, lineNumber, sourceId } = e;
      console.log(`[renderer:${level}] ${message} (${String(sourceId).split('/').pop()}:${lineNumber})`);
    });
    if (process.env.CAPRI_DEVTOOLS) overlay.webContents.openDevTools({ mode: 'detach' });
  }
}

// Your file organizer (a PowerShell script in your Organizacion Claude folder): she runs it when she starts
const organizeDir = () => path.join(app.getPath('desktop'), 'Organizacion Claude');
// The one you run by hand ("EJECUTAR - Organizar archivos.bat" in Desktop\Organización Claude runs this very script, and it sorts into the
// folders next to it); the older one inside Organizacion Claude\Otros only if that is not there. config.organizeScript wins over both.
const organizeScript = () => {
  const mine = config.load().organizeScript;
  if (mine) return mine;
  const handRun = path.join(app.getPath('desktop'), 'Organización Claude', 'Organizar archivos.ps1');
  return fs.existsSync(handRun) ? handRun : path.join(organizeDir(), 'Otros', 'OrganizarArchivos.ps1');
};
const sendDirPath = () => config.load().sendDir || path.join(app.getPath('desktop'), 'Para enviar');
async function openSendDir() {
  const dir = sendDirPath();
  try {
    fs.mkdirSync(dir, { recursive: true });
    const err = await shell.openPath(dir);
    return err ? { ok: false, error: err } : { ok: true, dir };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
let organizing = null;
function organizeRun() {
  if (organizing) return organizing; // one at a time
  const script = organizeScript();
  if (process.platform !== 'win32' || !fs.existsSync(script)) return Promise.resolve({ ok: false, error: `No encuentro ${script}` });
  organizing = new Promise((resolve) => {
    runFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, timeout: 10 * 60e3, maxBuffer: 4 * 1024 * 1024 }, (err, out, errOut) => {
      organizing = null;
      if (err) return resolve({ ok: false, error: String(errOut || err.message).trim().split(/\r?\n/)[0].slice(0, 200) });
      const m = /movidos\s*:\s*(\d+)/i.exec(String(out)); // ("Archivos movidos  : 12" in the one you run by hand)
      resolve({ ok: true, moved: m ? Number(m[1]) : 0 });
    });
  });
  return organizing;
}

// Ctrl+Alt+V: the microphone of her big window when that window is the one in front, else the one of her bubble
function listenKey() {
  const win = chatwin.current?.();
  if (win && !win.isDestroyed() && win.isFocused()) win.webContents.send('chatwin:listen');
  else sendCommand('listen');
}

let dictateWatch = null;
function sendCommand(name, payload = {}) {
  overlay?.webContents.send('capri:command', { name, ...payload });
}

// Ctrl+Alt+C: she folds herself away into her biochip in the corner, or comes back out of it.
// Claude Code itself: the terminal agent, in a window of its own, in the folder her menu has for it. Windows Terminal if you have it,
// else a PowerShell window. Nothing is built from text you typed: the folder is the only variable and it goes as its own argument.
// The Claude Code she opens reports your usage back: it gets a status line (for that session only, through --settings: your own settings
// are not touched) that writes the 5-hour and weekly % Claude Code gives it into a file she reads, and prints a short line of them.
const limitsFile = () => path.join(app.getPath('userData'), 'claude-limits.json');

// Near the limit, or at it: she says it, once per level. Her bubble (or chat), and her window if it's open.
function pushLimitAlerts(extra = []) {
  try {
    for (const a of [...usage.alertsDue(usage.limitsNow(limitsFile())), ...extra]) {
      sendCommand('limitAlert', a);
      chatwin.current?.()?.webContents.send('limit:alert', a);
    }
  } catch (err) {
    console.error('[capri] limit alert failed:', err.message);
  }
}
function ensureStatusBridge() {
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    const out = limitsFile().replace(/'/g, "''");
    const script = `$ErrorActionPreference = 'SilentlyContinue'
$raw = [Console]::In.ReadToEnd()
try { $j = $raw | ConvertFrom-Json } catch { exit 0 }
function Epoch($v) { if ($null -eq $v) { return $null }; if ($v -is [datetime]) { return ([DateTimeOffset]$v).ToUnixTimeSeconds() }; if ($v -is [string]) { try { return [DateTimeOffset]::Parse($v).ToUnixTimeSeconds() } catch { return $null } }; return [long]$v }
$five = $j.rate_limits.five_hour
$seven = $j.rate_limits.seven_day
$o = [ordered]@{ at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); five_hour = $null; seven_day = $null; ctx = $null }
if ($five) { $o.five_hour = @{ pct = [double]$five.used_percentage; resets = (Epoch $five.resets_at) } }
if ($seven) { $o.seven_day = @{ pct = [double]$seven.used_percentage; resets = (Epoch $seven.resets_at) } }
if ($j.context_window) { $o.ctx = @{ pct = [double]$j.context_window.used_percentage } }
$o | ConvertTo-Json -Depth 5 -Compress | Set-Content -Encoding UTF8 -Path '${out}'
$parts = @()
if ($five) { $parts += ('5 h ' + [math]::Round([double]$five.used_percentage) + '%') }
if ($seven) { $parts += ('7 d ' + [math]::Round([double]$seven.used_percentage) + '%') }
if ($j.context_window) { $parts += ('ctx ' + [math]::Round([double]$j.context_window.used_percentage) + '%') }
if ($parts.Count -eq 0) { $parts += 'sin datos de limite aun' }
Write-Output ('Capri | ' + ($parts -join ' | '))
`;
    const scriptFile = path.join(dir, 'capri-statusline.ps1');
    fs.writeFileSync(scriptFile, script, 'utf8');
    const settingsFile = path.join(dir, 'capri-claude-settings.json');
    fs.writeFileSync(settingsFile, JSON.stringify({ statusLine: { type: 'command', command: `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptFile.replace(/\\/g, '/')}"` } }));
    return settingsFile;
  } catch (err) {
    console.error('[capri] could not set up the status bridge:', err.message);
    return null;
  }
}

// Where Claude Code's own program is. Windows Terminal starts "claude" without looking through the shims (claude.cmd of npm) or the folders her
// own process may not have in its PATH ("no se puede encontrar el archivo"), so she looks for it herself, and runs it through PowerShell.
function findClaudeCli() {
  const home = os.homedir();
  const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const known = [
    path.join(home, '.local', 'bin', 'claude.exe'),
    path.join(home, '.claude', 'local', 'claude.exe'),
    path.join(home, '.claude', 'local', 'claude.cmd'),
    path.join(roaming, 'npm', 'claude.cmd'),
    path.join(local, 'Programs', 'claude', 'claude.exe'),
    path.join(local, 'Microsoft', 'WinGet', 'Links', 'claude.exe'),
  ];
  for (const f of known) if (fs.existsSync(f)) return f;
  try { // whatever the PATH of this machine says
    const out = String(require('node:child_process').execFileSync('where.exe', ['claude'], { encoding: 'utf8', timeout: 4000, windowsHide: true }));
    const hit = out.split(/\r?\n/).map((l) => l.trim()).find((l) => l && fs.existsSync(l));
    if (hit) return hit;
  } catch { /* where.exe found nothing */ }
  try { // the one the Claude app carries
    const dir = path.join(roaming, 'Claude', 'claude-code');
    const versions = fs.readdirSync(dir).sort().reverse();
    for (const v of versions) {
      const f = path.join(dir, v, 'claude.exe');
      if (fs.existsSync(f)) return f;
    }
  } catch { /* none there */ }
  return null;
}

function openClaudeCode() {
  const cfg = config.load();
  const settings = cfg.codeBridge === false ? null : ensureStatusBridge();
  const cwd = cfg.claudeCwd && fs.existsSync(cfg.claudeCwd) ? cfg.claudeCwd : os.homedir();
  const exe = findClaudeCli();
  const q = (t) => `'${String(t).replace(/'/g, "''")}'`;
  // one PowerShell line: the program (full path when she found it), her settings, and the window stays open to read an error
  const line = `& ${exe ? q(exe) : 'claude'}${settings ? ` --settings ${q(settings)}` : ''}`;
  const tryRun = (cmd, args) => new Promise((resolve) => {
    let child;
    try {
      child = spawnDetached(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false });
    } catch {
      return resolve('fail');
    }
    child.once('error', (err) => resolve(err.code === 'ENOENT' ? 'missing' : 'fail'));
    child.once('spawn', () => {
      child.unref();
      resolve('ok');
    });
    return undefined;
  });
  return (async () => {
    if (!exe) console.log('[capri] Claude Code program not found in the usual places; trying "claude" from the PATH');
    let how = 'terminal';
    let res = await tryRun('wt.exe', ['-d', cwd, 'powershell.exe', '-NoExit', '-Command', line]);
    if (res === 'missing') {
      how = 'powershell';
      res = await tryRun('cmd.exe', ['/c', 'start', '', '/D', cwd, 'powershell.exe', '-NoExit', '-Command', line]);
    }
    return { ok: res === 'ok', cwd, how, error: res === 'ok' ? null : res, found: Boolean(exe) };
  })();
}

// The keys that are hers to choose: the conversation window and the selection helper. Another program (the mouse and tablet drivers,
// say) may already hold a combination: then Windows doesn't give it to her, and she tells you, so you can pick another one in her menu.
const KEY_SLOTS = {
  windowKey: {
    opts: ['Control+Alt+W', 'Control+Alt+K', 'Control+Alt+Q', 'Control+Alt+J', 'Control+Alt+M', 'Control+Shift+Alt+W'],
    run: () => {
      sendCommand('sound', { kind: 'window' });
      chatwin.open();
    },
  },
  translateKey: {
    opts: ['Control+Alt+T', 'Control+Alt+Y', 'Control+Alt+U', 'Control+Alt+L', 'Control+Shift+Alt+T'],
    run: () => selectionHelper(),
  },
};
const WINDOW_KEYS = KEY_SLOTS.windowKey.opts;
const prettyKey = (accel) => String(accel).replace('Control', 'Ctrl');
const slotWanted = (slot) => (KEY_SLOTS[slot].opts.includes(config.load()[slot]) ? config.load()[slot] : KEY_SLOTS[slot].opts[0]);
const slotHeld = {};
function bindSlot(slot) {
  const want = slotWanted(slot);
  if (slotHeld[slot] && slotHeld[slot] !== want) {
    try { globalShortcut.unregister(slotHeld[slot]); } catch { /* it was never hers */ }
    slotHeld[slot] = null;
  }
  if (slotHeld[slot] === want) return true;
  const ok = Boolean(globalShortcut.register(want, KEY_SLOTS[slot].run));
  slotHeld[slot] = ok ? want : null;
  return ok;
}
const windowKeyWanted = () => slotWanted('windowKey');
const bindWindowKey = () => bindSlot('windowKey');

// The selection helper: you select text anywhere and press her key; she copies it, and her own model (free, on this PC) translates /
// explains / summarises it in a bubble. What the key does is in her menu; the bubble's buttons do the other two.
async function selectionHelper() {
  try {
    sendCommand('sound', { kind: 'go' });
    const got = await selection.grab();
    if (!got.ok) return sendCommand('selection', { phase: 'empty' });
    const cfg = config.load();
    const mode = ['translate', 'explain', 'summarize'].includes(cfg.selectionMode) ? cfg.selectionMode : 'translate';
    const engine = selectionEngine();
    sendCommand('selection', { phase: 'start', mode, engine, source: got.text, cut: got.cut });
    const res = await runSelection(mode, got.text, engine);
    return sendCommand('selection', { phase: res.ok ? 'done' : 'error', mode, engine, source: got.text, text: res.text, error: res.error });
  } catch (err) { // whatever it was, she says it in a bubble: it never takes her down
    console.error('[capri] selection helper failed:', err);
    return sendCommand('selection', { phase: 'error', mode: 'translate', engine: 'local', error: String(err?.message || err).slice(0, 200) });
  }
}
const selectionEngine = () => (['local', ...selection.CLAUDES].includes(config.load().selectionEngine) ? config.load().selectionEngine : 'local');
function runSelection(mode, text, engine = 'local') {
  const cfg = config.load();
  const lang = resolveLang(cfg.lang);
  return selection.run(mode, text, { llm, cfg: llmConfig({ ...cfg, lang }), lang, engine });
}

// Without `force` (her key, her tray): she decides herself by where she REALLY is (the overlay knows: out, folding, or in her biochip), not by
// what the config remembers, which can drift (a comment while put away, a timer, her showcase...) and made a press "do nothing". And a press
// within 350 ms of the last is ignored: a macro key or a key bounce sends it twice, and two toggles are none.
let lastToggle = 0;
function toggleVisible(force) {
  if (typeof force !== 'boolean') {
    const now = Date.now();
    if (now - lastToggle < (heavyNow.active && heavyNow.game ? 1600 : 350)) return; // (with a game open her fold takes a moment to be seen: a second press in that time is a bounce, and would bring her out again)
    lastToggle = now;
    sendCommand('stowToggle');
    return;
  }
  const visible = force;
  config.save({ visible });
  sendCommand('stow', { on: !visible });
  rebuildTray();
}

// ---- media keys: her player instead of Windows' pop-up ---------------------------------------------
// While she is out (and not folded away for good) and no game has the screen, the keyboard's play/pause, next and previous go to her player card.
// With a game in front, or with her not running at all, the keys are Windows' own: its player does the job.
const MEDIA_KEYS = { MediaPlayPause: 'toggle', MediaNextTrack: 'next', MediaPreviousTrack: 'previous' };
function isGameInFront(data) {
  try {
    const cfg = config.load();
    const proc = String(data?.proc || '').toLowerCase();
    if (!proc || /^(capri|electron)/.test(proc)) return false;
    // the desktop itself (everything hidden), the taskbar, the Start menu: they cover the whole screen and are never a game
    if (/^(explorer|searchhost|searchapp|shellexperiencehost|startmenuexperiencehost|applicationframehost|textinputhost|lockapp|dwm|taskmgr|snippingtool|screenclippinghost|modernflyoutshost|modernflyouts)/.test(proc)) return false;
    if (cfg.gameProcs && new RegExp(String(cfg.gameProcs), 'i').test(proc)) return true;
    // a window that covers the whole display (not just the work area) is a fullscreen game or video
    const fg = (data.wins || []).find((w) => w.id === data.fg);
    if (!fg || !overlay || overlay.isDestroyed()) return false;
    const ob = overlay.getBounds();
    const d = targetDisplay().bounds;
    const x = fg.x + ob.x;
    const y = fg.y + ob.y;
    return !fg.max && x <= d.x + 1 && y <= d.y + 1 && fg.w >= d.width - 2 && fg.h >= d.height - 2 && !/chrome|msedge|firefox|zen|brave|opera|vlc|mpv|discord|slack|teams|zoom/.test(proc); // (a maximized window is not a game: with the taskbar hidden it covers the whole display too)
  } catch {
    return false;
  }
}
let mediaHook = null;
// her global keys, in capri-desktop\_logs\keys.log: which one she got at start (or found taken by another program) and each press
function logKeys(line) {
  try {
    const dir = path.join(__dirname, '..', '..', '_logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'keys.log'), `${new Date().toISOString()} ${line}\n`);
  } catch { /* a packaged app cannot write there */ }
}
let lastMediaLog = '';
// what her media keys decide, in capri-desktop\_logs\media.log (only when it changes): for "I pressed play and her card did not come"
function logMedia(line) {
  if (line === lastMediaLog) return;
  lastMediaLog = line;
  try {
    const dir = path.join(__dirname, '..', '..', '_logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'media.log'), `${new Date().toISOString()} ${line}\n`);
  } catch { /* a packaged app cannot write there */ }
}
function syncMediaKeys() {
  const cfg = config.load();
  // she is on (out, resting in her corner or folded in her biochip: all the same) and no game has the screen
  const want = cfg.mediaKeys !== false && !gameInFront && Boolean(overlay) && !overlay.isDestroyed();
  if (!mediaHook) mediaHook = mediaKeysHook.start({ onKey: (action) => { logMedia(`key ${action} -> her card`); lastMediaLog = ''; sendCommand('mediaKey', { action }); }, onLog: (t) => { logMedia(`helper: ${t.split(/\r?\n/).slice(-3).join(' | ')}`); lastMediaLog = ''; } });
  mediaHook.setEnabled(want);
  logMedia(`keys ${want ? 'ON (hers)' : 'off (Windows)'}${want ? '' : `: ${cfg.mediaKeys === false ? 'switched off in config' : gameInFront ? `in front: ${String(lastWindows?.proc || '?')}` : 'no overlay'}`} · hook ${mediaHook.running ? 'running' : 'NOT running'}`);
  if (mediaHook.running) { // the hook has the keys: no second way of listening for them
    for (const accel of Object.keys(MEDIA_KEYS)) { try { if (globalShortcut.isRegistered(accel)) globalShortcut.unregister(accel); } catch { /* not hers */ } }
    return;
  }
  for (const [accel, action] of Object.entries(MEDIA_KEYS)) {
    try {
      const held = globalShortcut.isRegistered(accel);
      if (want && !held) globalShortcut.register(accel, () => sendCommand('mediaKey', { action }));
      else if (!want && held) globalShortcut.unregister(accel);
    } catch { /* another program has the key: Windows' own handles it */ }
  }
}

function playDemo() {
  clearTimeout(demoTimer);
  const steps = demoSteps(resolveLang(config.load().lang)); // in her language
  let i = 0;
  const next = () => {
    if (i >= steps.length) return;
    const [delay, evt] = steps[i++];
    demoTimer = setTimeout(() => {
      overlay?.webContents.send('claude:event', evt);
      next();
    }, delay);
  };
  next();
}

// During the demo, a little fake terminal for her to sit on and take over (window tracking is
// Windows only, so only there). Opened without stealing focus; closing it drops her off it.
let demoWin = null;
const DEMO_TERMINAL = `<body style="margin:0;background:#14101c;color:#8f8aa3;font:13px/1.7 Consolas,monospace;padding:14px 18px">
<div style="color:#36ff7a">PS C:\\night-city-api&gt; npm test -- gigs</div>
<div>&nbsp;&nbsp;GET /gigs</div><div style="color:#36ff7a">&nbsp;&nbsp;&nbsp;&nbsp;✓ returns 20 items per page</div>
<div style="color:#36ff7a">&nbsp;&nbsp;&nbsp;&nbsp;✓ paginates with a cursor</div><div style="color:#36ff7a">&nbsp;&nbsp;&nbsp;&nbsp;✓ rejects a bad cursor</div>
<div>&nbsp;&nbsp;6 passing (212ms)</div><div style="color:#36ff7a">PS C:\\night-city-api&gt; _</div></body>`;

function demoWindow(open) {
  demoWin?.destroy();
  demoWin = null;
  if (!open || process.platform !== 'win32') return false;
  const b = overlay.getBounds();
  demoWin = new BrowserWindow({
    x: Math.round(b.x + b.width * 0.5 - 310), y: Math.round(b.y + b.height * 0.42), width: 620, height: 300,
    show: false, alwaysOnTop: true, title: 'night-city-api — npm test', backgroundColor: '#14101c', autoHideMenuBar: true,
  });
  demoWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(DEMO_TERMINAL)}`);
  demoWin.once('ready-to-show', () => demoWin?.showInactive());
  demoWin.on('closed', () => { demoWin = null; });
  return true;
}

// 'auto' -> the first system language Capri speaks, English otherwise.
function resolveLang(setting) {
  if (LANGS.includes(setting)) return setting;
  const preferred = [...app.getPreferredSystemLanguages(), app.getSystemLocale(), app.getLocale()];
  for (const tag of preferred) {
    const base = String(tag || '').toLowerCase().split(/[-_]/)[0];
    if (LANGS.includes(base)) return base;
  }
  return 'en';
}

// What the overlay gets: `lang` is the resolved one, `langSetting` what the user picked.
function rendererConfig() {
  const { apiKeys, ...cfg } = config.load(); // the keys stay here: the overlay only learns which ones are set
  return { ...cfg, flirtVoiceOverride: voices.flirtOverride(cfg), heavyGame: heavyNow.active && heavyNow.game, heavyLite: heavyNow.active && heavyNow.game && cfg.heavyFps !== 0 ? Math.max(1, Math.min(12, Number(cfg.heavyFps) || 4)) : 0, keys: Object.keys(apiKeys || {}), assistant: activeAssistant().id, lang: resolveLang(cfg.lang), langSetting: cfg.lang, floorGap: overlayArea().gap };
}

function updateConfig(patch) {
  config.save(patch);
  if ('rest' in patch) fitOverlay(); // the taskbar in her window or not
  const cfg = rendererConfig();
  overlay?.webContents.send('capri:config', cfg);
  if ('look' in patch) chatwin.current()?.webContents.send('chatwin:look', patch.look === 'classic' ? 'classic' : 'hud'); // her conversation window follows at once
  rebuildTray();
  return cfg;
}

function rebuildTray() {
  if (!tray) return;
  const cfg = config.load();
  const hookState = activeHooks().status();
  const watched = activeAssistant();
  const t = Object.fromEntries(Object.entries(TRAY[resolveLang(cfg.lang)]).map(([key, value]) =>
    [key, typeof value === 'string' && watched.id !== 'claude' ? value.replaceAll('Claude Code', watched.name) : value]));

  const displays = screen.getAllDisplays();
  const current = targetDisplay().id;

  const menu = Menu.buildFromTemplate([
    { label: t.online(PORT), enabled: false },
    { type: 'separator' },
    { label: t.teleport, click: () => sendCommand('teleport') },
    { label: t.satellite, click: () => sendCommand('satellite') },
    { label: t.demo, click: playDemo },
    { label: t.help, click: () => sendCommand('welcome') },
    ...(cfg.claude ? [{ label: t.report, click: () => sendCommand('report') }] : []),
    { label: t.talk, click: () => sendCommand('chat') },
    { label: resolveLang(cfg.lang) === 'es' ? 'Ajustes de Capri…' : 'Capri settings…', click: () => settingsWin.open() },
    { label: t.nowPlaying, click: () => sendCommand('nowplaying') },
    { label: resolveLang(cfg.lang) === 'es' ? 'Reproductor (tarjeta aparte, a la vista)' : 'Player (card of its own, shown)', type: 'checkbox', checked: cfg.playerCard !== false && !cfg.playerHidden, click: (item) => updateConfig(item.checked ? { playerCard: true, playerHidden: false } : { playerHidden: true }) },
    ...(heavyNow.active ? [{ label: `${resolveLang(cfg.lang) === 'es' ? 'Modo ligero activo' : 'Light mode on'}: ${heavyNow.apps.join(', ')}${heavyNow.light ? ` · ${heavyNow.light}` : ''}`, enabled: false }] : []),
    { label: resolveLang(cfg.lang) === 'es' ? 'Grabar mi voz en los clips de pantalla' : 'Record my voice in screen clips', type: 'checkbox', checked: cfg.clipMic === true, click: (item) => updateConfig({ clipMic: item.checked }) },
    { label: resolveLang(cfg.lang) === 'es' ? 'Modo ligero con juegos y programas pesados' : 'Light mode with games and heavy programs', type: 'checkbox', checked: cfg.heavyMode !== false, click: (item) => updateConfig({ heavyMode: item.checked }) },
    { label: resolveLang(cfg.lang) === 'es' ? 'Programas pesados (marca o desmarca)' : 'Heavy programs (check or uncheck)', submenu: heavy.allOf(cfg).map((a) => ({ label: a.name, type: 'checkbox', checked: a.on, click: () => heavyEdit('toggle', a.name) })) },
    { label: resolveLang(cfg.lang) === 'es' ? 'Modo juego de League of Legends' : 'League of Legends game mode', type: 'checkbox', checked: cfg.lolMode === true, click: (item) => updateConfig({ lolMode: item.checked }) },
    { label: resolveLang(cfg.lang) === 'es' ? 'Reproductor suelto (moverlo donde quiera)' : 'Loose player (move it anywhere)', type: 'checkbox', checked: Boolean(cfg.playerFloat), click: (item) => updateConfig({ playerFloat: item.checked }) },
    {
      label: `${t.selectionMenu} (${prettyKey(slotWanted('translateKey'))})`,
      submenu: [
        ...['translate', 'explain', 'summarize'].map((mode) => ({
          label: t.selectionModes[mode], type: 'radio', checked: (config.load().selectionMode || 'translate') === mode,
          click: () => updateConfig({ selectionMode: mode }),
        })),
        { type: 'separator' },
        { label: t.selectionEngineHead, enabled: false },
        ...['local', ...selection.CLAUDES].map((engine) => ({
          label: t.selectionEngines[engine], type: 'radio', checked: selectionEngine() === engine,
          click: () => updateConfig({ selectionEngine: engine }),
        })),
        { type: 'separator' },
        { label: t.selectionKey, enabled: false },
        ...KEY_SLOTS.translateKey.opts.map((key) => ({
          label: prettyKey(key), type: 'radio', checked: slotWanted('translateKey') === key,
          click: () => {
            updateConfig({ translateKey: key });
            if (!bindSlot('translateKey')) sendCommand('shortcutBusy', { keys: [prettyKey(key)] });
          },
        })),
      ],
    },
    { label: t.usageMenu, click: () => sendCommand('usage') },
    { label: t.codeBridge, type: 'checkbox', checked: config.load().codeBridge !== false, click: (item) => updateConfig({ codeBridge: item.checked }) },
    { label: t.openCode, click: () => { sendCommand('sound', { kind: 'go' }); openClaudeCode(); } },
    { label: `${t.chatwin} (${prettyKey(windowKeyWanted())})`, click: () => { sendCommand('sound', { kind: 'window' }); chatwin.open(); } },
    {
      label: t.windowKeyMenu,
      submenu: WINDOW_KEYS.map((key) => ({
        label: prettyKey(key), type: 'radio', checked: windowKeyWanted() === key,
        click: () => {
          updateConfig({ windowKey: key });
          if (!bindWindowKey()) sendCommand('shortcutBusy', { keys: [prettyKey(key)] }); // that one is taken too
        },
      })),
    },
    { label: cfg.lang === 'en' ? 'Do not disturb' : 'No molestar', type: 'checkbox', checked: Boolean(cfg.dnd), click: (item) => updateConfig({ dnd: item.checked }) },
    { label: t.scanner, click: () => scanner.open() },
    { label: t.checkOllama, click: async () => sendCommand('ollamaStatus', await llm.ollamaStatus({ start: true })) },
    {
      label: t.scanEngine,
      submenu: [
        ...[['auto', t.scanAuto], ['ollama', t.scanLocal], ['gemini', t.scanGemini], ['claude', t.scanClaude]].map(([scanProvider, label]) => ({
          label, type: 'radio', checked: (cfg.scanProvider || 'auto') === scanProvider, click: () => updateConfig({ scanProvider }),
        })),
        ...((chatModels || []).filter((n) => llm.VISION_MODEL.test(n)).length > 1 ? [
          { type: 'separator' },
          { label: t.scanModel, enabled: false },
          ...(chatModels || []).filter((n) => llm.VISION_MODEL.test(n)).map((name) => ({
            label: name, type: 'radio', checked: (cfg.visionModel || (chatModels || []).find((n) => llm.VISION_MODEL.test(n))) === name, click: () => updateConfig({ visionModel: name }),
          })),
        ] : []),
      ],
    },
    { label: t.seeNow, click: () => sendCommand('ambientNow') },
    { label: t.wheel, accelerator: 'Ctrl+Alt+R', click: () => sendCommand('wheel') },
    { label: t.custom, click: () => sendCommand('customize') },
    { label: cfg.visible ? t.hide : t.show, accelerator: 'Ctrl+Alt+C', click: () => toggleVisible() },
    { type: 'separator' },
    {
      label: t.size,
      submenu: [[t.small, 0.45], [t.medium, 0.6], [t.large, 0.8]].map(([label, scale]) => ({
        label, type: 'radio', checked: Math.abs(cfg.scale - scale) < 0.01, click: () => updateConfig({ scale }),
      })),
    },
    {
      label: t.sound,
      submenu: [
        { label: t.mute, type: 'checkbox', checked: cfg.muted, click: (item) => updateConfig({ muted: item.checked }) },
        { type: 'separator' },
        {
          label: t.soundsDir,
          click: () => {
            fs.mkdirSync(userSoundsDir(), { recursive: true });
            shell.openPath(userSoundsDir());
          },
        },
      ],
    },
    {
      label: resolveLang(cfg.lang) === 'es' ? 'Voz' : 'Voice',
      submenu: [
        {
          label: resolveLang(cfg.lang) === 'es' ? 'Hablarle (Ctrl+Alt+V)' : 'Talk to her (Ctrl+Alt+V)',
          click: () => sendCommand('listen'),
        },
        {
          label: resolveLang(cfg.lang) === 'es' ? 'Manos libres (di «Capri…»)' : 'Hands free (say “Capri…”)',
          type: 'checkbox', checked: Boolean(cfg.handsFree), click: (item) => updateConfig({ handsFree: item.checked }),
        },
        {
          label: resolveLang(cfg.lang) === 'es' ? 'Modo conversación (sigue escuchando, di «eso es todo» para terminar)' : 'Conversation mode (keeps listening, say "that is all" to end)',
          type: 'checkbox', checked: cfg.convoMode === true, click: (item) => updateConfig(item.checked ? { convoMode: true, handsFree: true } : { convoMode: false }),
        },
        {
          label: resolveLang(cfg.lang) === 'es' ? 'Resumen del día solo (mañana y noche)' : 'Morning and evening summary on her own',
          type: 'checkbox', checked: cfg.briefing !== false, click: (item) => updateConfig({ briefing: item.checked }),
        },
        { type: 'separator' },
        ...[
          ['voice', resolveLang(cfg.lang) === 'es' ? 'Responder en voz solo si le hablo por voz' : 'Answer out loud only if I talk by voice'],
          ['important', resolveLang(cfg.lang) === 'es' ? 'Solo lo importante en voz alta (avisos, notas, Claude, saludos)' : 'Only what matters out loud (alerts, notes, Claude, greetings)'],
          ['always', resolveLang(cfg.lang) === 'es' ? 'Responder siempre en voz alta' : 'Always answer out loud'],
          ['never', resolveLang(cfg.lang) === 'es' ? 'Nunca en voz alta' : 'Never out loud'],
        ].map(([mode, label]) => ({
          label, type: 'radio',
          checked: (cfg.speak === false ? 'never' : cfg.speakMode || 'voice') === mode,
          click: () => updateConfig({ speak: mode !== 'never', speakMode: mode }),
        })),
        { type: 'separator' },
        {
          label: resolveLang(cfg.lang) === 'es' ? 'Avisos por voz (Claude y temporizadores)' : 'Spoken alerts (Claude and timers)',
          submenu: [
            ['away', resolveLang(cfg.lang) === 'es' ? 'Solo si estoy lejos o fue largo' : 'Only if I’m away or it was long'],
            ['always', resolveLang(cfg.lang) === 'es' ? 'Siempre' : 'Always'],
            ['never', resolveLang(cfg.lang) === 'es' ? 'Nunca' : 'Never'],
          ].map(([mode, label]) => ({
            label, type: 'radio', checked: (cfg.announce || 'away') === mode, click: () => updateConfig({ announce: mode }),
          })),
        },
      ],
    },
    {
      label: t.screen,
      enabled: displays.length > 1,
      submenu: displays.map((d, i) => ({
        label: `${i + 1} — ${d.size.width}×${d.size.height}`,
        type: 'radio',
        checked: d.id === current,
        click: () => { config.save({ displayId: d.id }); fitOverlay(); rebuildTray(); },
      })),
    },
    {
      label: t.chatModel,
      submenu: [
        { label: t.aiSetup, click: () => sendCommand('setupChat') },
        { type: 'separator' },
        ...Object.entries(llm.PROVIDERS).map(([provider, p]) => ({
          label: p.label, type: 'radio', checked: cfg.provider === provider, click: () => pickProvider(provider),
        })),
        { type: 'separator' },
        ...(chatModels?.length
          ? chatModels.map((name) => ({
            label: name, type: 'radio', checked: name === pickModel(cfg), click: () => updateConfig({ chatModel: name }),
          }))
          : [{ label: (chatError || t.noOllama).slice(0, 80), enabled: false }]),
        { type: 'separator' },
        ...(cfg.provider === 'claude' ? [
          { label: `Claude Code: ${cfg.claudeCwd || app.getPath('home')}`, click: pickClaudeFolder },
          {
            label: 'Claude Code permissions',
            submenu: llm.CLAUDE_MODES.map((mode) => ({
              label: mode, type: 'radio', checked: cfg.claudeMode === mode, click: () => updateConfig({ claudeMode: mode }),
            })),
          },
        ] : []),
        {
          label: resolveLang(cfg.lang) === 'es' ? 'Rigurosidad de Claude' : 'Claude rigor',
          submenu: [
            ['', resolveLang(cfg.lang) === 'es' ? 'Automática (la de Claude)' : 'Automatic (Claude\u2019s own)'],
            ['low', resolveLang(cfg.lang) === 'es' ? 'Baja (más rápida)' : 'Low (faster)'],
            ['medium', resolveLang(cfg.lang) === 'es' ? 'Media' : 'Medium'],
            ['high', resolveLang(cfg.lang) === 'es' ? 'Alta' : 'High'],
            ['xhigh', resolveLang(cfg.lang) === 'es' ? 'Muy alta' : 'Extra high'],
            ['max', resolveLang(cfg.lang) === 'es' ? 'Máxima (lenta, gasta más)' : 'Max (slow, uses more)'],
          ].map(([claudeEffort, label]) => ({
            label, type: 'radio', checked: (cfg.claudeEffort || '') === claudeEffort, click: () => updateConfig({ claudeEffort }),
          })),
        },
        {
          label: t.taskModel,
          submenu: ['haiku', 'sonnet', 'opus'].map((m) => ({
            label: m[0].toUpperCase() + m.slice(1), type: 'radio', checked: (cfg.claudeTaskModel || 'sonnet') === m, click: () => updateConfig({ claudeTaskModel: m }),
          })),
        },
        {
          label: t.searchModel,
          submenu: [['haiku', 'Haiku'], ['sonnet', 'Sonnet'], ['opus', 'Opus'], ['ask', t.searchAsk], ['off', t.searchOff]].map(([searchModel, label]) => ({
            label, type: 'radio', checked: (cfg.searchModel || 'haiku') === searchModel, click: () => updateConfig({ searchModel }),
          })),
        },
        { label: t.askClaude, type: 'checkbox', checked: cfg.autoEscalateAsk !== false, click: (item) => updateConfig({ autoEscalateAsk: item.checked }) },
        { label: t.autoEscalate, type: 'checkbox', checked: cfg.autoEscalate !== false, click: (item) => updateConfig({ autoEscalate: item.checked }) },
        { label: t.forget, click: forgetChats },
        // the key (or the address) of the one picked, pasted in her panel
        { label: t.apiKey, click: () => sendCommand('setupKey') },
      ],
    },
    {
      label: t.chatter,
      submenu: [
        ...[['never', t.restTalkNever], ['sometimes', t.restTalkSome], ['often', t.restTalkOften]].map(([restTalk, label]) => ({
          label, type: 'radio', checked: (cfg.restTalk || 'often') === restTalk, click: () => updateConfig({ restTalk }),
        })),
        { type: 'separator' },
        { label: t.autoLook, type: 'checkbox', checked: Boolean(cfg.autoLook), click: (item) => updateConfig({ autoLook: item.checked }) },
        { label: t.ambientActive, type: 'checkbox', checked: cfg.ambientActive !== false, click: (item) => updateConfig({ ambientActive: item.checked }) },
        { type: 'separator' },
        { label: t.ambientVoiceHead, enabled: false },
        ...[['never', t.ambientVoiceNever], ['sometimes', t.ambientVoiceSome], ['always', t.ambientVoiceAlways]].map(([ambientVoice, label]) => ({
          label, type: 'radio', checked: (cfg.ambientVoice || 'sometimes') === ambientVoice, click: () => updateConfig({ ambientVoice }),
        })),
      ],
    },
    { label: t.wander, type: 'checkbox', checked: cfg.wander, click: (item) => updateConfig({ wander: item.checked }) },
    { label: t.possess, type: 'checkbox', checked: cfg.possess, click: (item) => updateConfig({ possess: item.checked }) },
    { label: 'Sentarse en la ventana que uso', type: 'checkbox', checked: cfg.followWindow !== false, click: (item) => updateConfig({ followWindow: item.checked }) },
    { label: 'Sprites nuevos (cuerpo dibujado)', type: 'checkbox', checked: cfg.sprites !== false, click: (item) => updateConfig({ sprites: item.checked }) },
    {
      label: t.rest,
      submenu: [
        ...[['corner', t.restCorner], ['taskbar', t.restTaskbar], ['window', t.restWindow]].map(([rest, label]) => ({
          label, type: 'radio', checked: cfg.rest === rest, click: () => updateConfig({ rest }),
        })),
        { type: 'separator' },
        ...[['left', t.restLeft], ['right', t.restRight]].map(([restSide, label]) => ({
          label, type: 'radio', checked: (cfg.restSide || 'left') === restSide, click: () => updateConfig({ restSide }),
        })),
      ],
    },
    // the coding assistant she watches (a new one: she says hello and offers to plug herself in), or none
    {
      label: t.watch,
      submenu: [
        ...Object.entries(ASSISTANTS).map(([id, { name }]) => ({
          label: name,
          type: 'radio',
          checked: cfg.claude && watched.id === id,
          click: () => {
            const other = watched.id !== id;
            updateConfig({ claude: true, assistant: id, ...(other && { linked: false, welcomed: false }) });
            if (other) sendCommand('assistantChanged');
          },
        })),
        { label: t.watchNone, type: 'radio', checked: !cfg.claude, click: () => updateConfig({ claude: false }) },
      ],
    },
    {
      label: t.motion,
      submenu: [['auto', t.motionAuto], ['full', t.motionFull], ['reduced', t.motionReduced]].map(([motion, label]) => ({
        label, type: 'radio', checked: cfg.motion === motion, click: () => updateConfig({ motion, motionAsked: true }),
      })),
    },
    { label: resolveLang(cfg.lang) === 'es' ? 'Clips del personaje (carpeta tuya)' : 'Character clips (your folder)', type: 'checkbox', checked: cfg.clips !== false, click: (item) => updateConfig({ clips: item.checked }) },
    {
      label: resolveLang(cfg.lang) === 'es' ? 'Aspecto' : 'Look',
      submenu: [
        ['hud', resolveLang(cfg.lang) === 'es' ? 'Nuevo (detalles HUD en rojo)' : 'New (red HUD details)'],
        ['classic', resolveLang(cfg.lang) === 'es' ? 'Clásico' : 'Classic'],
      ].map(([look, label]) => ({
        label, type: 'radio', checked: (cfg.look === 'classic' ? 'classic' : 'hud') === look, click: () => updateConfig({ look }),
      })),
    },
    {
      label: t.lang,
      submenu: [[t.auto, 'auto'], ...LANGS.map((lang) => [TRAY[lang].name, lang])].map(([label, lang]) => ({
        label, type: 'radio', checked: cfg.lang === lang, click: () => updateConfig({ lang }),
      })),
    },
    {
      label: resolveLang(cfg.lang) === 'es' ? 'Abrir carpeta «Para enviar» (Blip)' : 'Open the “Para enviar” folder (Blip)',
      click: () => openSendDir(),
    },
    {
      label: resolveLang(cfg.lang) === 'es' ? 'Organizar mis archivos al iniciar' : 'Organize my files on start',
      type: 'checkbox', checked: cfg.organizeOnStart !== false, click: (item) => updateConfig({ organizeOnStart: item.checked }),
    },
    {
      label: resolveLang(cfg.lang) === 'es' ? 'Organizar mis archivos ahora' : 'Organize my files now',
      click: async () => sendCommand('organized', await organizeRun()),
    },
    {
      label: t.startup,
      type: 'checkbox',
      checked: app.getLoginItemSettings(loginItemOptions()).openAtLogin,
      click: (item) => app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: item.checked }),
    },
    // her hooks, while she watches Claude Code
    ...(cfg.claude ? [
      { type: 'separator' },
      hookState.installed
        ? { label: t.hooksOn, enabled: false }
        : { label: t.hooksOff, click: () => runHooks('install') },
      ...(hookState.installed ? [{ label: t.hooksRemove, click: () => runHooks('uninstall') }] : []),
    ] : []),
    { type: 'separator' },
    { label: t.quit, click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  trayMenu = menu;
}

// Run from a clone (`npm start`), electron.exe alone would open the default Electron app at login:
// it needs the project folder as argument.
function loginItemOptions() {
  return app.isPackaged ? {} : { path: process.execPath, args: [ROOT] };
}

// From the tray, she says how it went; from her welcome panel (quiet), the panel does.
function runHooks(action, { quiet = false } = {}) {
  let outcome;
  try {
    const result = action === 'install' ? activeHooks().install() : activeHooks().uninstall();
    outcome = { action, ok: true, file: result.file };
  } catch (err) {
    outcome = { action, ok: false, error: err.message };
  }
  if (!quiet) sendCommand('hooks', outcome);
  rebuildTray();
  return outcome;
}

// The model she talks with: the one picked in her menu if it's still installed, else the first.
function pickModel(cfg = config.load()) {
  if (!chatModels?.length) return null;
  // with a game or a heavy program in front she talks with the small model (heavy.js), without touching what you picked
  if (heavyNow.active && cfg.provider === 'ollama' && heavyNow.light && chatModels.includes(heavyNow.light)) return heavyNow.light;
  return chatModels.includes(cfg.chatModel) ? cfg.chatModel : chatModels[0];
}

// With a game in front her window does not take the mouse at all: a right-click near her would open her menu in the middle of your game.
// (Her keys, her voice and the tray still work; the click goes back to her when the game closes. Off with config gameClickThrough = false.)
// (only while the game is the window in front: switch to another window and she answers the mouse again)
const gameClickThrough = () => heavyNow.active && heavyNow.game && gameInFront && config.load().gameClickThrough !== false;
let mouseLocked = false;
function applyGameMouse() {
  if (!overlay || overlay.isDestroyed()) return;
  if (gameClickThrough()) { overlay.setIgnoreMouseEvents(true); mouseLocked = true; return; }
  if (mouseLocked) { mouseLocked = false; overlay.setIgnoreMouseEvents(true, { forward: true }); sendCommand('rearmed'); } // (she hears the pointer again)
}

// her list of heavy programs (heavy.js): turn one on or off, add one, or take one out; nothing is lost: a built-in one that is off stays in the list, ready to turn on
function heavyEdit(what, raw, asGame = false) {
  const name = String(raw || '').trim().replace(/\.exe$/i, '').slice(0, 60);
  const cfg = config.load();
  if (!name) return heavy.listOf(cfg);
  const key = heavy.norm(name);
  const all = heavy.allOf(cfg);
  const known = all.find((a) => heavy.norm(a.name) === key) || (key.length >= 4 ? all.find((a) => heavy.norm(a.name).startsWith(key) || key.startsWith(heavy.norm(a.name))) : null);
  let extra = heavy.extrasOf(cfg);
  let off = (Array.isArray(cfg.heavyOff) ? cfg.heavyOff : []).filter((n) => heavy.norm(n) !== (known ? heavy.norm(known.name) : key));
  const set = (known ? heavy.norm(known.name) : key);
  const on = what === 'add' ? true : what === 'remove' ? false : !(known ? known.on : false); // 'toggle'
  if (on) {
    if (!known) extra = [...extra, name];
  } else if (known?.builtin) off = [...off, known.name];
  else extra = extra.filter((n) => heavy.norm(n) !== set);
  const games = (cfg.heavyGames || []).filter((n) => heavy.norm(n) !== key);
  updateConfig({ heavyExtra: extra, heavyOff: off, heavyGames: on && asGame ? [...games, name] : games });
  return heavy.listOf(config.load());
}

async function refreshModels() {
  const cfg = config.load();
  chatError = null;
  chatErrorCode = null;
  chatModels = await llm.models(cfg.provider, llmConfig(cfg)).catch((err) => {
    chatError = err.message;
    chatErrorCode = err.code || null;
    return null;
  });
  rebuildTray();
  return chatModels;
}

async function pickProvider(provider) {
  updateConfig({ provider });
  await refreshModels();
  if (chatErrorCode) sendCommand('setupKey'); // it needs a key or an address: she asks for it
}

// What llm.js gets: the config with its keys opened (they're kept encrypted, setup.js)
function llmConfig(cfg = config.load()) {
  return { ...cfg, apiKeys: setup.openKeys(cfg.apiKeys) };
}

async function pickClaudeFolder() {
  const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'], defaultPath: config.load().claudeCwd || app.getPath('home') });
  if (canceled || !filePaths[0]) return;
  llm.resetClaude(); // a new folder, a new Claude Code conversation (hers goes on)
  saveMemory({ claude: null });
  updateConfig({ claudeCwd: filePaths[0] });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ROOT, 'assets', 'icons', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('Capri');
  tray.on('click', () => sendCommand('status'));
  rebuildTray();
}

function registerIpc() {
  ipcMain.on('overlay:interactive', (_e, on) => {
    if (gameClickThrough()) { overlay?.setIgnoreMouseEvents(true); return; } // a game has the screen: her window lets every click through (right-click is how you move in LoL)
    overlay?.setIgnoreMouseEvents(!on, { forward: true });
  });
  ipcMain.on('overlay:rearm', () => rearmOverlay()); // the pointer moved over her and she never heard of it
  ipcMain.handle('overlay:cursor', () => {
    const p = screen.getCursorScreenPoint();
    const b = overlay.getBounds();
    return { x: p.x - b.x, y: p.y - b.y, inside: p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height };
  });
  ipcMain.handle('config:get', () => rendererConfig());
  ipcMain.handle('hooks:status', () => activeHooks().status());
  ipcMain.handle('config:set', (_e, patch) => updateConfig(patch));
  ipcMain.handle('demo:window', (_e, open) => demoWindow(open));
  // right-clicking her: the same menu as the tray icon (which Windows often hides behind the ^ by the clock)
  ipcMain.on('menu:open', () => trayMenu?.popup({ window: overlay }));
  // her welcome panel's buttons
  ipcMain.handle('hooks:install', () => runHooks('install', { quiet: true }));
  ipcMain.handle('claude:found', () => fs.existsSync(path.dirname(activeHooks().status().file))); // Claude Code keeps its settings there
  ipcMain.on('claude:help', () => shell.openExternal(activeAssistant().help));
  ipcMain.handle('windows:get', () => lastWindows);
  // Open / Show-in-folder buttons for what she or Claude made (files.js: only files she was told about)
  ipcMain.handle('file:open', (_e, p) => files.open(p));
  // the colours of a picture file (one you attached, or one she made): from its pixels, copied all at once
  ipcMain.handle('palette:file', (_e, p) => {
    const s = String(p || '');
    try {
      if (!/\.(png|jpe?g|webp|bmp|gif)$/i.test(s) || !fs.existsSync(s) || fs.statSync(s).size > 60e6) return { ok: false };
      let img = nativeImage.createFromPath(s);
      if (img.isEmpty()) return { ok: false };
      const { width, height } = img.getSize();
      const big = Math.max(width, height);
      if (big > 1200) img = img.resize({ width: Math.round((width * 1200) / big), height: Math.round((height * 1200) / big) });
      const colors = scanner.colorsOf(img);
      if (!colors.length) return { ok: false };
      clipboard.writeText(colors.map((c) => c.hex).join(' '));
      return { ok: true, colors };
    } catch {
      return { ok: false };
    }
  });
  // what her Claude jobs have used (today, this week, this month), Claude Code's word on your limits, the window she's in, and how full a conversation is
  ipcMain.handle('usage:summary', (_e, { sid } = {}) => {
    const lim = usage.limitsNow(limitsFile());
    const ctx = usage.context(sid) || (lim.codeCtxPct != null ? { pct: lim.codeCtxPct } : null);
    return { ...usage.summary(), limits: { five_hour: lim.five_hour, seven_day: lim.seven_day }, window: usage.windowSoFar(), ctx, now: Date.now() };
  });
  ipcMain.handle('selection:run', (_e, { mode, text, engine } = {}) => runSelection(['translate', 'explain', 'summarize'].includes(mode) ? mode : 'translate', String(text || ''), ['local', ...selection.CLAUDES].includes(engine) ? engine : 'local')); // the bubble's buttons // what her Claude jobs have used: today, this week, this month
  ipcMain.handle('claude:code', () => openClaudeCode()); // her "Code" button: Claude Code in a terminal
  // Claude Design (a web tool) hosted by her: in a window of its own from the card, as a tab inside her big conversation window
  ipcMain.handle('design:window', () => design.openApp()); // the Claude desktop app's own Design
  ipcMain.handle('design:dock', (e, rect) => design.dock(BrowserWindow.fromWebContents(e.sender), rect));
  ipcMain.handle('design:bounds', (_e, rect) => { design.setBounds(rect); return true; });
  ipcMain.handle('design:undock', () => { design.undock(); return true; });
  // a small picture of an image she made (or Claude made), to show it inside the conversation
  ipcMain.handle('image:preview', (_e, p) => {
    if (!files.isAllowed(p) || !/\.(png|jpe?g|webp|gif|bmp)$/i.test(String(p))) return null;
    try {
      const img = nativeImage.createFromPath(path.resolve(String(p)));
      if (img.isEmpty()) return null;
      const { width, height } = img.getSize();
      const big = Math.max(width, height);
      return (big > 900 ? img.resize({ width: Math.round((width * 900) / big), height: Math.round((height * 900) / big) }) : img).toDataURL();
    } catch {
      return null;
    }
  });
  // her conversations (sessions.js): the list, one of them, saving it, deleting it
  ipcMain.handle('session:list', () => sessions.list());
  ipcMain.handle('session:get', (_e, id) => {
    const s = sessions.get(String(id));
    if (s) files.remember(s.messages.flatMap((m) => m.files || [])); // the Open buttons of what was made then still work
    return s;
  });
  ipcMain.handle('session:save', (e, s) => {
    const ok = sessions.save(s);
    for (const wc of [overlay?.webContents, chatwin.current()?.webContents]) {
      if (wc && !wc.isDestroyed() && wc !== e.sender) wc.send('sessions:changed', s?.id || null); // the bubble and the window see each other's changes
    }
    return ok;
  });
  ipcMain.handle('session:delete', (e, id) => {
    const ok = sessions.remove(String(id));
    for (const wc of [overlay?.webContents, chatwin.current()?.webContents]) {
      if (wc && !wc.isDestroyed() && wc !== e.sender) wc.send('sessions:changed', null);
    }
    return ok;
  });
  // screenshots and screen clips (capture.js): "haz una captura", "graba la pantalla"
  capture.setup({ ipcMain, getOverlay: () => overlay, getDisplay: () => targetDisplay(), files, config });
  eyedropper.setup({ overlay: () => overlay });
  ipcMain.handle('color:pick', () => eyedropper.pick());
  // files to and from your phone over the Wi-Fi, with a QR (sendphone.js)
  sendphone.setup({ files, config, onEvent: (evt) => sendCommand('phoneDone', { type: evt.type, file: evt.name, path: evt.path }) /* (not `name`: that is the command's own) */ });
  const newestIn = (dir, re) => {
    try {
      return fs.readdirSync(dir).filter((n) => re.test(n) && !/\.(?:crdownload|tmp|part)$/i.test(n))
        .map((n) => { const p = path.join(dir, n); return { p, t: fs.statSync(p).mtimeMs }; }).sort((a, b) => b.t - a.t)[0]?.p || null;
    } catch { return null; }
  };
  ipcMain.handle('phone:send', async (_e, { what, query } = {}) => {
    const c = config.load();
    const { shots, clips } = config.mediaDirs(c);
    if (what === 'pick') { // she asks which files: Windows' own window, any number
      const parent = overlay && !overlay.isDestroyed() ? overlay : undefined;
      const picked = await dialog.showOpenDialog(parent, { title: 'Elige qué mandar al celular', properties: ['openFile', 'multiSelections'] });
      if (picked.canceled || !picked.filePaths?.length) return { ok: false, cancelled: true };
      files.remember(picked.filePaths);
      return sendphone.send(picked.filePaths);
    }
    let file = null;
    if (what === 'captura') file = newestIn(shots, /\.png$/i);
    else if (what === 'clip') file = newestIn(clips, /\.(?:mp4|webm)$/i);
    else if (what === 'last') {
      const a = newestIn(shots, /\.png$/i); const b = newestIn(clips, /\.(?:mp4|webm)$/i);
      const t = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
      file = a && b ? (t(a) >= t(b) ? a : b) : (a || b);
    } else if (what === 'descarga') file = newestIn(app.getPath('downloads'), /^[^.].*\.[a-z0-9]{1,6}$/i);
    else if (what === 'archivo') file = finder.search(String(query || ''))?.matches?.[0]?.path || null;
    if (!file) return { ok: false, none: true };
    files.remember([file]);
    return sendphone.send(file);
  });
  ipcMain.handle('phone:receive', () => sendphone.receive());
  // "retomar donde quedé": the files you opened last (resume.js), and her watch over Downloads (downloads.js)
  // picture tools (renderer/js/imgtools.js): the bytes in, the new file out; the original is never written
  ipcMain.handle('img:read', async (_e, file) => {
    try {
      const f = path.resolve(String(file || ''));
      if (!/\.(png|jpe?g|webp|bmp|gif)$/i.test(f)) return { ok: false, error: 'not a picture' };
      const st = await fs.promises.stat(f);
      if (st.size > 120 * 1024 * 1024) return { ok: false, error: 'too big (over 120 MB)' };
      const buf = await fs.promises.readFile(f);
      return { ok: true, data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), bytes: st.size };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('img:write', async (_e, src, fmt, tag, data) => {
    try {
      const from = path.resolve(String(src || ''));
      const ext = { png: '.png', webp: '.webp', jpg: '.jpg' }[fmt];
      if (!ext || !data) return { ok: false, error: 'bad request' };
      const base = path.join(path.dirname(from), `${path.basename(from, path.extname(from))} (${String(tag || 'nueva').replace(/[^\p{L}\p{N} _-]/gu, '')})`);
      let out = `${base}${ext}`;
      for (let i = 2; fs.existsSync(out) && i < 500; i++) out = `${base} (${i})${ext}`;
      await fs.promises.writeFile(out, Buffer.from(data));
      files?.remember?.([out]);
      return { ok: true, path: out, bytes: (await fs.promises.stat(out)).size };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('bg:remove', (_e, file) => rembg.removeBg(file, { config, files })); // "quítale el fondo": rembg on this PC (rembg.js)
  ipcMain.on('wake:feed', (_e, buf) => wakeWord.feed(buf)); // (the microphone as 16 kHz audio, from talk.js)
  ipcMain.handle('wake:status', () => wakeWord.status(config.load()));
  ipcMain.handle('resume:recent', () => resume.recent({ config, files }).catch(() => ({ ok: false, items: [] })));
  downloads.setup({
    config,
    onNew: (evt) => sendCommand('downloadsNew', evt),
    onFile: (file) => {
      if (config.load().avScan === false) return;
      avscan.check(file).then((r) => { if (r.threat) sendCommand('avAlert', { file, name: path.basename(file), threat: r.name || '' }); }).catch(() => {});
    },
  });
  // incremental backup (backup.js): the folders and the destination are picked with a normal folder dialog
  ipcMain.handle('backup:pick', async (_e, what) => {
    const res = await dialog.showOpenDialog(overlay && !overlay.isDestroyed() ? overlay : undefined, { title: what === 'dest' ? 'Destino del respaldo (disco externo, USB o carpeta de Drive)' : 'Carpeta de trabajo a respaldar', properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths[0]) return { ok: false };
    const dir = res.filePaths[0];
    const c = config.load(true);
    if (what === 'dest') config.save({ backupDest: dir });
    else config.save({ backupSources: [...new Set([...(c.backupSources || []), dir])].slice(0, 12) });
    return { ok: true, dir };
  });
  ipcMain.handle('backup:state', () => { const c = config.load(); return { sources: c.backupSources || [], dest: c.backupDest || '' }; });
  ipcMain.handle('backup:plan', () => { const c = config.load(); return backup.plan({ sources: c.backupSources || [], dest: c.backupDest || '' }); });
  ipcMain.handle('backup:run', () => { const c = config.load(); return backup.run({ sources: c.backupSources || [], dest: c.backupDest || '' }); });
  ipcMain.handle('backup:clear', () => { config.save({ backupSources: [] }); return true; });
  hwalerts.setup({ config, onAlert: (a) => sendCommand('hwAlert', a), quiet: () => Boolean(gameInFront) });
  ipcMain.handle('av:vt', async (_e, file) => { // the hash goes to VirusTotal's page (the file does not)
    try { const h = await avscan.sha256(String(file)); await shell.openExternal(`https://www.virustotal.com/gui/file/${h}`); return { ok: true, hash: h }; } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('av:show', (_e, file) => { try { shell.showItemInFolder(String(file)); return true; } catch { return false; } });
  // messages: she notices a count in the title of WhatsApp/Discord/Telegram, reads a chat on request, and writes only when her card's Send was pressed
  const toastSvc = toasts.setup({ config, onNew: (items) => sendCommand('msgToast', { items }) }); // her own card for what WhatsApp/Discord send to Windows
  msgwatch.setup({ config, onNew: (evt) => sendCommand('msgNew', evt), skip: () => toastSvc.working() });
  ipcMain.handle('msg:read', (_e, app) => uia.read(String(app || ''), { max: 40 }).catch((err) => ({ ok: false, error: err.message })));
  ipcMain.handle('msg:send', (_e, app, text, confirmed, opts) => uia.type(String(app || ''), text, { confirmed: confirmed === true, send: opts?.send !== false, contact: String(opts?.contact || ''), stealth: config.load().msgStealth !== false }).catch((err) => ({ ok: false, error: err.message })));
  ipcMain.handle('msg:history', (_e, app) => toastSvc.history(String(app || '')));
  // cleaning caches and closing what sits in the background for nothing: each is a scan first and an action only on your OK (cleaner.js, perf.js)
  ipcMain.handle('clean:scan', () => cleaner.scan(config).catch(() => []));
  ipcMain.handle('clean:run', (_e, ids, confirmed) => (confirmed === true ? cleaner.run(ids, config).catch((err) => ({ ok: false, error: err.message })) : { ok: false, error: 'needs confirmation' }));
  ipcMain.handle('perf:scan', () => { perf.setNever(config.load().perfNever); return perf.scan().catch(() => ({ total: 0, free: 0, safe: [], heavy: [] })); });
  ipcMain.handle('perf:run', (_e, names, confirmed) => (confirmed === true ? (perf.setNever(config.load().perfNever), perf.run(names)).catch((err) => ({ ok: false, error: err.message })) : { ok: false, error: 'needs confirmation' }));
  // her eyes on any window: what is open, and what a window says (UI Automation; only what the program shows to others)
  ipcMain.handle('win:list', async () => (await apps.windows().catch(() => [])).map((w) => ({ title: String(w.title || ''), proc: String(w.proc || '') })));
  ipcMain.handle('win:read', async (_e, target) => {
    const wanted = String(target || '').trim();
    const w = wanted ? await apps.findWindow(wanted).catch(() => null) : (await apps.windows().catch(() => []))[0]; // (no name: the front-most window that is not hers)
    return uia.readWin(w ? { hwnd: w.hwnd, title: w.title, proc: w.proc } : null, { max: 60 }).catch((err) => ({ ok: false, error: err.message }));
  });
  ipcMain.handle('uia:click', (_e, app, name) => uia.click(String(app || ''), String(name || '')).catch((err) => ({ ok: false, error: err.message })));
  // what she knows about herself, for "capri, diagnóstico": the voice, her Whisper, the day's use of the cloud, the media keys, a game in front
  // "capri, instala whisper": runs the installer (tools\install-whisper-local.ps1) and starts her own Whisper when it ends
  ipcMain.handle('whisper:install', async (e, model) => {
    const root = path.join(__dirname, '..', '..');
    const res = await whisperLocal.install(root, ['small', 'medium', 'turbo'].includes(model) ? model : 'small', (n, t) => { try { e.sender.send('whisper:step', n, t); } catch { /* window gone */ } });
    if (res.ok) { const c = config.load(true); whisperLocal.start(c); }
    return res;
  });
  ipcMain.handle('diag:get', async () => {
    const c = config.load(true);
    const local = await stt.localStatus(c).catch(() => null);
    return {
      version: app.getVersion(), dnd: c.dnd === true, auto: String(c.dndAuto || ''), handsFree: Boolean(c.handsFree),
      stt: stt.status(c), local, model: whisperLocal.found(c)?.name || '', cloudToday: stt.cloudToday(), budget: Number(c.sttWakeBudget) || 1200, wake: c.sttWake || 'auto',
      media: { on: c.mediaKeys !== false, hook: Boolean(mediaHook?.running), game: gameInFront, front: String(lastWindows?.proc || '') },
      speak: c.speak !== false && c.speakMode !== 'never', quiet: c.quietStowed !== false,
      heavy: { on: c.heavyMode !== false, active: heavyNow.active, apps: heavyNow.apps, light: heavyNow.light || '', cpu: c.heavyCpuOnly !== false },
      lol: { on: c.lolMode === true, match: Boolean(lolFollow?.active()) },
    };
  });
  // light mode and game mode (heavy.js, lol.js)
  ipcMain.handle('heavy:list', () => ({ apps: heavy.listOf(config.load()), all: heavy.allOf(config.load()), on: config.load().heavyMode !== false, active: heavyNow.active }));
  ipcMain.handle('heavy:edit', (_e, what, name, game) => ({ apps: heavyEdit(what === 'add' ? 'add' : what === 'toggle' ? 'toggle' : 'remove', name, game === true), all: heavy.allOf(config.load()) }));
  ipcMain.on('lol:note', (_e, t) => lol.note(t));
  ipcMain.handle('lol:active', () => Boolean(lolFollow?.active()));
  ipcMain.handle('lol:advice', async () => {
    if (config.load().lolSafe !== false && lolFollow?.active()) return { ok: false, error: resolveLang(config.load().lang) === 'es' ? 'En plena partida no doy consejos de compra: Riot no lo permite en herramientas de terceros. Después de la partida te hago el resumen.' : 'I do not give build advice mid-match: Riot does not allow it in third-party tools. I will sum the match up afterwards.' };
    const ctx = lolFollow?.context();
    if (!ctx) return { ok: false, none: true };
    const cfg = config.load();
    const es = resolveLang(cfg.lang) === 'es';
    try {
      if (!(await ollama.ensure(8000))) return { ok: false, error: es ? 'Ollama no responde: la sugerencia la hace mi modelo local' : 'Ollama is not answering: the suggestion comes from my local model' };
      const model = heavyNow.light || await heavy.lightModel(cfg).catch(() => null) || pickModel(cfg);
      if (!model) return { ok: false, error: es ? 'No tengo ningún modelo local instalado' : 'I have no local model installed' };
      const system = es
        ? 'Eres Capri, una compañera digital cercana y con humor, que habla español neutro y directo. Eres coach de League of Legends. Con los datos de la partida que te doy, recomienda qué comprar a continuación (el objeto y por qué) teniendo en cuenta al equipo enemigo y el oro disponible, en máximo 3 frases cortas, sin listas ni markdown. No inventes datos que no estén en lo que te doy; tu conocimiento del parche actual puede estar desactualizado: si dudas, dilo en media frase.'
        : 'You are Capri, a friendly digital companion with humor, direct and concise. You are a League of Legends coach. With the match data I give you, recommend what to buy next (the item and why) considering the enemy team and the gold available, in at most 3 short sentences, no lists or markdown. Do not invent data that is not in what I give you; your knowledge of the current patch may be out of date: if you doubt, say so in half a sentence.';
      const text = await ollama.chat({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: `${ctx.text}\n\n${es ? '¿Qué debería comprar a continuación y por qué?' : 'What should I buy next and why?'}` }] }, () => {}, AbortSignal.timeout(90000));
      return { ok: true, text: String(text || '').replace(/\s+/g, ' ').trim() || (es ? 'No se me ocurre nada con esos datos.' : 'Nothing comes to mind with that data.'), model };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  finder.setup({ ipcMain, config, files }); // "abre mi carpeta de descargas", "abre el pdf de la cotización"
  ipcMain.handle('session:archive', (e, id, on) => {
    const ok = sessions.archive(String(id), on !== false);
    for (const wc of [overlay?.webContents, chatwin.current()?.webContents]) {
      if (wc && !wc.isDestroyed() && wc !== e.sender) wc.send('sessions:changed', null);
    }
    return ok;
  });
  ipcMain.handle('chatwin:open', (_e, id) => {
    chatwin.open(id || null);
    return true;
  });
  ipcMain.handle('chatwin:info', () => {
    const cfg = config.load();
    const model = pickModel(cfg);
    return {
      lang: resolveLang(cfg.lang), look: cfg.look === 'classic' ? 'classic' : 'hud', userName: cfg.userName || '', provider: cfg.provider, model,
      muted: Boolean(cfg.muted), volume: typeof cfg.volume === 'number' ? cfg.volume : 0.7, // her sound settings are the window's too
      voice: { speakVoice: cfg.speakVoice || '', speakLang: cfg.speakLang || '', ttsFx: cfg.ttsFx, announce: cfg.announce, dnd: cfg.dnd === true }, // (her voice, for the window's Voz button)
      sees: cfg.provider === 'claude' || (cfg.provider === 'ollama' ? llm.VISION_MODEL.test(model || '') : /gemini|gpt-4|gpt-5|vision|llava|qwen.*vl|pixtral|claude|grok/i.test(model || '')),
      engine: ['local', 'haiku', 'sonnet', 'opus'].includes(cfg.winEngine) ? cfg.winEngine : 'local',
      web: cfg.winWeb !== false,
      persona: [
        ({ es: 'IDIOMA: responde SIEMPRE y SOLO en español, natural y neutro, sin regionalismos (nada de parce, parcero, chamo, pana ni similares; si quieres un apelativo, usa «choom»). Casi todo en español; puedes soltar una frase corta en inglés como «good boy» (nunca «you got this»), y la jerga de Night City (choom, preem, nova).', fr: 'LANGUE : réponds TOUJOURS et UNIQUEMENT en français.', pt: 'IDIOMA: responda SEMPRE e SOMENTE em português.', ru: 'ЯЗЫК: отвечай ВСЕГДА и ТОЛЬКО по-русски.' })[resolveLang(cfg.lang)] || '',
        'You are Capri, the personality construct from Project Capricorn (Cyberpunk: Edgerunners, season 2): dozens of minds fused into one digital ghost, playful, a little mischievous, warm underneath, never cruel. Night City slang now and then, not in every sentence.',
        cfg.persona || '',
        'You are an AI-generated fan version of the character, not the real one: say so if asked.',
        'This is her conversation window: you may write longer, organized answers (markdown is rendered). Answer in the language the user writes in. You cannot open apps or touch their files from here.',
      ].filter(Boolean).join('\n'),
    };
  });
  ipcMain.handle('chatwin:prefs', (_e, patch = {}) => {
    const next = {};
    if (['local', 'haiku', 'sonnet', 'opus'].includes(patch.winEngine)) next.winEngine = patch.winEngine;
    if (typeof patch.winWeb === 'boolean') next.winWeb = patch.winWeb;
    if (Object.keys(next).length) config.save(next);
    return true;
  });
  ipcMain.handle('shell:external', (_e, url) => {
    if (!/^https?:\/\//i.test(String(url))) return false;
    shell.openExternal(String(url));
    return true;
  });
  ipcMain.handle('clipboard:write', (_e, text) => {
    clipboard.writeText(String(text || '').slice(0, 2_000_000));
    return true;
  });
  // the "+" in her chat, a pasted picture, links in your message (attach.js)
  ipcMain.handle('attach:pick', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(overlay, { properties: ['openFile', 'multiSelections'] });
    return canceled ? [] : filePaths.slice(0, 8);
  });
  ipcMain.handle('attach:inspect', (_e, paths) => attach.inspect(paths));
  ipcMain.handle('attach:clip', (_e, buffer, ext) => attach.saveClip(Buffer.from(buffer), ext));
  ipcMain.handle('link:read', (_e, urls) => attach.readLinks(urls));
  ipcMain.handle('file:reveal', (_e, p) => files.reveal(p));
  // "Imagina...": your nano-banana (Gemini), run for her; the picture lands in Pictures\Capri
  // a picture to edit: it has to exist and be a real image under 25 MB; anything that isn't a png goes to a temporary png (her script reads it as one)
  const editSource = (p) => {
    const s = String(p || '');
    try {
      if (!/\.(png|jpe?g|webp|bmp|gif)$/i.test(s) || !fs.existsSync(s) || fs.statSync(s).size > 25e6) return null;
      if (/\.png$/i.test(s)) return s;
      const img = nativeImage.createFromPath(s);
      if (img.isEmpty()) return null;
      const tmp = path.join(os.tmpdir(), `capri-edit-${Date.now()}.png`);
      fs.writeFileSync(tmp, img.toPNG());
      return tmp;
    } catch {
      return null;
    }
  };
  ipcMain.handle('image:make', async (_e, { prompt, model, refs, edit } = {}) => {
    const cfg = config.load();
    const lang = resolveLang(cfg.lang);
    const source = edit ? editSource(edit) : null;
    if (edit && !source) return { ok: false, error: lang === 'en' ? 'I cannot find the picture to edit' : 'no encuentro la imagen que hay que editar' };
    const env = { ...process.env };
    // the CLI reads GEMINI_API_KEY or its own config; if it has neither, she lends it the Gemini key she already has
    if (!env.GEMINI_API_KEY && !fs.existsSync(path.join(os.homedir(), '.config', 'nano-banana', 'config.yaml'))) {
      const key = setup.openKeys(cfg.apiKeys || {}).gemini;
      if (key) env.GEMINI_API_KEY = key;
    }
    const res = await imagegen.make({
      prompt: String(prompt || '').slice(0, 1500), model, lang, env, refs: Array.isArray(refs) ? refs.map(String) : [], edit: source,
      script: cfg.nanoBananaPath || path.join(os.homedir(), 'Documents', 'nano-banana', 'nano_banana.py'),
      outDir: path.join(os.homedir(), 'Pictures', 'Capri'),
    });
    if (res.ok) files.remember(res.files);
    return res;
  });
  // her chatter while she's put away (ambient.js): how the PC is doing, and the NAME of the program in front
  let cpuPrev = null;
  ipcMain.handle('ambient:sample', () => {
    const t = os.cpus().reduce((a, c) => {
      for (const k in c.times) a.total += c.times[k];
      a.idle += c.times.idle;
      return a;
    }, { idle: 0, total: 0 });
    let cpuPct = 0;
    if (cpuPrev && t.total > cpuPrev.total) cpuPct = Math.round(100 * (1 - (t.idle - cpuPrev.idle) / (t.total - cpuPrev.total)));
    cpuPrev = t;
    const total = os.totalmem();
    const free = os.freemem();
    return {
      app: lastWindows?.proc || '',
      cpuPct,
      ramPct: Math.round(100 * (1 - free / total)),
      ramUsed: Math.round(((total - free) / 2 ** 30) * 10) / 10,
      ramTotal: Math.round((total / 2 ** 30) * 10) / 10,
      idle: powerMonitor.getSystemIdleTime(), // seconds since you last touched the keyboard or mouse
    };
  });
  // talking to her (chat.js): is Ollama there, with a model to talk with
  ipcMain.handle('chat:warm', () => { try { const { provider } = config.load(true); llm.warm(provider, pickModel()); } catch { /* nothing to warm */ } return true; });
  ipcMain.handle('chat:status', async () => {
    const cfg = config.load(true); // keys may have been edited by hand
    const { provider } = cfg;
    const models = await refreshModels();
    if (!models) return { ok: false, error: chatError || 'offline', code: chatErrorCode, provider };
    if (!models.length) return { ok: false, error: 'nomodel', provider };
    // (no warming here any more: opening her chat for a picture or an order must not load a 19 GB model; it loads when you start typing, 'chat:warm')
    const model = pickModel();
    // whether this chat model takes pictures: Claude Code reads them from a file; Ollama only the vision ones; the others, by name
    const sees = provider === 'claude' || (provider === 'ollama' ? llm.VISION_MODEL.test(model || '') : /gemini|gpt-4|gpt-5|vision|llava|qwen.*vl|pixtral|claude|grok/i.test(model || ''));
    return { ok: true, provider, model, agent: provider === 'claude', local: llm.isLocal(provider, cfg), warmup: provider === 'ollama', sees };
  });
  // her answer, streamed to the overlay piece by piece as `chat:delta`
  ipcMain.handle('chat:send', async (e, { id, messages, task, taskModel, files: attached, images, research, session, windowChat, web }) => {
    const abort = new AbortController();
    chats.set(id, abort);
    let started = false; // Claude began this conversation (even if the job then failed or was stopped): it exists from now on
    try {
      const asker = e.sender; // her bubble or her window: the words go back to whoever asked
      const send = (text) => { if (!asker.isDestroyed()) asker.send('chat:delta', { id, text }); };
      const cfg = config.load();
      // a task ("dile a Claude que…"): Claude Code with all your MCP servers, asking on her card (llm.js)
      // what you attached: Claude reads it from its file (its folder is let in); another model gets the pictures inside the message
      const mine = (Array.isArray(attached) ? attached : []).map(String).filter((p) => fs.existsSync(p)).slice(0, 8);
      const dirs = [...new Set(mine.map((p) => path.dirname(p)))];
      const note = mine.length ? `\n\n[Files the user attached, read them with the Read tool: ${mine.join(' | ')}]` : '';
      if (task) {
        const job = messages.at(-1).content + note;
        let claudeStarted = false;
        let touch = null; // what its tools wrote and where its commands worked (files.js): so the files come back even if Claude never says them
        const raw = await llm.task({ ...llmConfig(cfg), onTouched: (t) => { touch = t; }, researchJob: Boolean(research), windowJob: Boolean(windowChat), allowWeb: Boolean(web), taskSession: session && /^[\w-]{1,64}$/.test(String(session.id)) ? { id: String(session.id), started: Boolean(session.started) } : null, onTaskStarted: () => { claudeStarted = true; started = true; }, claudeDirs: [...(cfg.claudeDirs || []), ...dirs], ...(/^(haiku|sonnet|opus)$/.test(taskModel || '') ? { claudeTaskModel: taskModel } : {}) }, job, send, abort.signal, PORT);
        const { text, files: said } = files.extract(raw); // "FILES: ..." comes off her answer and turns into Open / Show folder
        const made = [...new Set([...said, ...(touch ? files.discover(touch, { cwd: cfg.claudeCwd, dirs }) : [])])].slice(0, 6); // what it says, and what it did
        files.remember(made);
        return { ok: true, text, files: made, claudeStarted };
      }
      const msgs = messages.map((m) => ({ ...m }));
      if (cfg.provider === 'claude' && mine.length) msgs.at(-1).content += note;
      else if (Array.isArray(images) && images.length) msgs.at(-1).images = images.slice(0, 4).map((p) => attach.readImage(String(p))).filter(Boolean);
      let touch = null;
      const raw = await llm.chat(cfg.provider, llmConfig(cfg), { model: pickModel(), messages: msgs }, send, abort.signal, PORT, { dirs: cfg.provider === 'claude' ? dirs : [], onTouched: (t) => { touch = t; } });
      if (cfg.provider === 'claude') saveMemory({ claude: llm.claudeMemory() });
      if (cfg.provider === 'claude') { // her chat IS Claude Code: what it made comes back as files too
        const { text: clean, files: said } = files.extract(raw);
        const made = [...new Set([...said, ...(touch ? files.discover(touch, { cwd: cfg.claudeCwd, dirs }) : [])])].slice(0, 6);
        files.remember(made);
        return { ok: true, text: clean, files: made, turns: llm.claudeMemory().turns };
      }
      return { ok: true, text: raw, turns: llm.claudeMemory().turns };
    } catch (err) {
      if (!abort.signal.aborted) { // a job that failed because the limit is reached: she tells you, besides the error
        const hit = usage.reachedFromError(err.message);
        if (hit) pushLimitAlerts([hit]);
      }
      return { ok: false, error: abort.signal.aborted ? 'stopped' : err.message, claudeStarted: Boolean(started) };
    } finally {
      chats.delete(id);
    }
  });
  ipcMain.on('chat:stop', (_e, id) => chats.get(id)?.abort());
  // your MCP servers, as Claude Code lists them (she tells you which ones she could use in a task)
  ipcMain.handle('claude:mcp', async () => {
    try {
      return { ok: true, list: await llm.mcpList() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  // voice notes: a file on your Desktop, one line each ("anota comprar tinta")
  const notesFile = () => path.join(app.getPath('desktop'), 'Capri notas.md');
  ipcMain.handle('notes:add', async (_e, { text, project } = {}) => {
    try {
      const body = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
      if (!body) return { ok: false };
      const d = new Date();
      const p2 = (n) => String(n).padStart(2, '0');
      const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
      const file = notesFile();
      const fresh = !fs.existsSync(file);
      fs.appendFileSync(file, `${fresh ? '# Notas de Capri\n\n' : ''}- [${stamp}] ${project ? `(${String(project).slice(0, 80)}) ` : ''}${body}\n`);
      return { ok: true, file };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  // mode: 'last' (the newest), 'all', or 'match' (the newest one containing `text`); → { ok, removed: [lines] }
  ipcMain.handle('notes:delete', (_e, { mode, text } = {}) => {
    try {
      const file = notesFile();
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      const idx = lines.map((l, i) => (l.startsWith('- ') ? i : -1)).filter((i) => i >= 0);
      let drop = [];
      if (mode === 'all') drop = idx;
      else if (mode === 'last') drop = idx.slice(-1);
      else if (mode === 'match') {
        const want = String(text || '').toLowerCase();
        drop = want ? idx.filter((i) => lines[i].toLowerCase().includes(want)).slice(-1) : [];
      }
      const removed = drop.map((i) => lines[i].slice(2));
      fs.writeFileSync(file, lines.filter((_l, i) => !drop.includes(i)).join('\n'));
      return { ok: true, removed };
    } catch (err) {
      return { ok: false, removed: [], error: err.message };
    }
  });
  ipcMain.handle('organize:run', () => organizeRun());
  ipcMain.handle('send:open', () => openSendDir());
  ipcMain.handle('notes:read', () => {
    try {
      return fs.readFileSync(notesFile(), 'utf8').split(/\r?\n/).filter((l) => l.startsWith('- ')).map((l) => l.slice(2)).slice(-12);
    } catch {
      return [];
    }
  });
  ipcMain.handle('chat:memory', () => readMemory().history || []);
  // how long Claude Code's conversation with her has got, and starting it over (her card asks you first)
  ipcMain.handle('chat:session', () => ({ provider: config.load().provider, turns: llm.claudeMemory().turns }));
  ipcMain.handle('chat:reset', () => {
    llm.resetClaude();
    saveMemory({ history: [], claude: null });
    return { ok: true };
  });
  // voice out (tts.js): ElevenLabs makes the audio, the overlay plays it
  ipcMain.handle('tts:status', () => tts.status(config.load(true)));
  setTimeout(() => tts.prewarm(config.load(true), resolveLang(config.load().lang)), 4000); // (her voice's connections, ready before her first words)
  // her settings window (settings.js)
  ipcMain.handle('settings:get', () => settingsWin.read(config.load(true)));
  ipcMain.handle('settings:set', (_e, patch) => {
    const clean = settingsWin.clean(patch);
    if (Object.keys(clean).length) updateConfig(clean);
    return clean;
  });
  ipcMain.on('settings:open', () => settingsWin.open());
  // her voice presets (voices.js)
  ipcMain.handle('voice:preset', (_e, name) => { const p = voices.preset(config, name); return p ? { ok: true, ...p } : { ok: false, list: voices.list() }; });
  ipcMain.handle('voice:save', (_e, override) => ({ ok: true, voice: voices.save(config, override) }));
  ipcMain.handle('voice:back', () => voices.back(config));
  ipcMain.handle('voice:list', () => voices.list());
  ipcMain.handle('voice:english', (_e, mode) => { updateConfig({ englishVoice: mode === 'english' ? 'english' : 'mine' }); return { ok: true, mode: config.load().englishVoice }; });
  ipcMain.handle('voice:flirt', (_e, what, name) => {
    if (what === 'off') updateConfig({ flirtVoiceOn: false });
    else if (what === 'on') updateConfig({ flirtVoiceOn: true });
    else { const key = voices.resolveKey(name); if (!key) return { ok: false }; updateConfig({ flirtVoice: key, flirtVoiceOn: true }); }
    return { ok: true, label: voices.PRESETS[config.load().flirtVoice]?.label, on: config.load().flirtVoiceOn === true };
  });
  ipcMain.handle('tts:speak', async (_e, request) => {
    try {
      // (a voice being tried says its sample with its own voice, speed and pitch, without changing hers)
      const cfg = { ...config.load(true), ...voices.clean(request?.override) };
      return { ok: true, audio: await tts.speak(cfg, request || {}) };
    } catch (err) {
      return { ok: false, error: err.message, code: err.code };
    }
  });
  // voice in (stt.js): the overlay records, a Whisper service gives back the words
  ipcMain.handle('stt:status', async () => ({ ...stt.status(config.load(true)), local: await stt.localStatus(config.load(true)).catch(() => null) }));
  ipcMain.handle('dictate:paste', (_e, text) => dictate.paste(String(text || '').slice(0, 20000)));
  ipcMain.handle('stt:transcribe', async (_e, request) => {
    try {
      const r = await stt.transcribeEx(config.load(true), request || {});
      return { ok: true, text: r.text, provider: r.provider };
    } catch (err) {
      return { ok: false, error: err.message, code: err.code };
    }
  });
  ipcMain.on('chat:remember', (_e, history) => Array.isArray(history) && saveMemory({ history }));
  ipcMain.on('chat:ollama', () => shell.openExternal(OLLAMA_SITE));
  // setting her up with buttons (setup.js): Ollama and a model, or a key, or an address
  const progress = (payload) => overlay?.webContents.send('setup:progress', payload);
  let pulling = null; // AbortController of the model being fetched
  ipcMain.handle('setup:info', () => ({ models: setup.MODELS, ram: os.totalmem(), keyed: Object.keys(setup.KEY_PAGES) }));
  ipcMain.handle('setup:ollama', () => setup.ollamaState());
  ipcMain.handle('setup:install', () => setup.installOllama((line) => progress({ kind: 'install', line })));
  ipcMain.handle('setup:start', async () => {
    const res = await setup.startOllama();
    await refreshModels();
    return res;
  });
  // "capri, instala el modelo qwen3:8b": downloads a model into Ollama and nothing else (she does not switch to it: you pick it in her menu)
  let installing = null;
  ipcMain.handle('model:install', async (e, name) => {
    const model = String(name || '').trim().toLowerCase();
    if (!/^(qwen3|qwen2\.5|gemma3|llama3\.[12]|mistral|phi4-mini|deepseek-r1):[0-9a-z.-]{1,16}$/.test(model)) return { ok: false, error: 'unknown model name' };
    if (installing) return { ok: false, error: 'already downloading one' };
    installing = new AbortController();
    try {
      await setup.pullModel(model, (p) => { try { e.sender.send('model:progress', { name: model, completed: p.completed, total: p.total, status: p.status }); } catch { /* window gone */ } }, installing.signal);
      await refreshModels();
      return { ok: true, model };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally { installing = null; }
  });
  ipcMain.handle('setup:pull', async (_e, name) => {
    if (!setup.MODELS.some((m) => m.name === name)) return { ok: false, error: 'unknown model' };
    pulling?.abort();
    const abort = new AbortController();
    pulling = abort;
    try {
      await setup.pullModel(name, (p) => progress({ kind: 'pull', ...p }), abort.signal);
      updateConfig({ provider: 'ollama' });
      await refreshModels();
      const model = chatModels?.find((m) => m === name || m.startsWith(`${name}:`));
      if (model) updateConfig({ chatModel: model });
      return { ok: true, model };
    } catch (err) {
      return { ok: false, error: abort.signal.aborted ? 'stopped' : err.message };
    } finally {
      if (pulling === abort) pulling = null;
    }
  });
  ipcMain.on('setup:cancel', () => pulling?.abort());
  // who answers her chat, with its key or address if it needs one: saved, tried, and undone if it fails
  ipcMain.handle('setup:use', async (_e, { provider, key, url }) => {
    if (!llm.PROVIDERS[provider]) return { ok: false, error: 'unknown provider' };
    const before = config.load();
    const patch = { provider };
    if (key) patch.apiKeys = { ...before.apiKeys, [provider]: setup.sealKey(String(key).trim()) };
    if (url) patch.customUrl = String(url).trim();
    updateConfig(patch);
    const models = await refreshModels();
    if (models?.length) return { ok: true, model: pickModel() };
    const error = models ? 'no model' : chatError || 'offline';
    updateConfig({ provider: before.provider, apiKeys: before.apiKeys, customUrl: before.customUrl });
    await refreshModels();
    return { ok: false, error };
  });
  ipcMain.on('setup:keyPage', (_e, provider) => setup.KEY_PAGES[provider] && shell.openExternal(setup.KEY_PAGES[provider]));
  ipcMain.handle('setup:launch', (_e, integration) => setup.launchThroughOllama(integration));
  // closing an app you asked her to close, once you've clicked to confirm (apps.js)
  const appInfo = (app) => app && { name: app.process, label: app.label };
  ipcMain.handle('apps:list', async () => (await apps.list().catch(() => [])).map(appInfo));
  ipcMain.handle('apps:find', async (_e, wanted) => appInfo(await apps.find(wanted).catch(() => null)));
  ipcMain.handle('apps:closeExplorer', () => apps.closeExplorer().catch((err) => ({ closed: 0, error: err.message })));
  // her big window asks the overlay (where her orders are carried out) whether a message is an order for the PC, and gets the answer back
  const orderWaits = new Map();
  ipcMain.handle('order:try', (_e, request) => new Promise((resolve) => {
    if (!overlay || overlay.isDestroyed()) { resolve({ handled: false }); return; }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timer = setTimeout(() => { orderWaits.delete(id); resolve({ handled: false }); }, 25000);
    orderWaits.set(id, (r) => { clearTimeout(timer); resolve(r); });
    overlay.webContents.send('order:ask', { id, text: String(request?.text || '').slice(0, 500), engine: String(request?.engine || 'local') });
  }));
  ipcMain.on('order:answer', (_e, r) => {
    const done = orderWaits.get(r?.id);
    if (!done) return;
    orderWaits.delete(r.id);
    done({ handled: Boolean(r.handled), line: String(r.line || '').slice(0, 800), face: String(r.face || 'smug'), files: Array.isArray(r.files) ? r.files.map(String).slice(0, 3) : [] });
  });
  ipcMain.handle('apps:closeAll', (_e, wanted) => apps.closeAllOf(String(wanted || '')).catch((err) => ({ closed: 0, error: err.message })));
  ipcMain.handle('apps:findWindow', (_e, wanted) => apps.findWindow(String(wanted || '')).catch(() => null));
  ipcMain.handle('apps:closeWindow', (_e, hwnd) => apps.closeWindow(hwnd).catch((err) => ({ error: err.message })));
  ipcMain.handle('apps:close', (_e, { name, force }) => apps.close(name, { force }).catch((err) => ({ error: err.message })));
  // opening things you ask her to (launch.js): an app or a game, your music, a website
  ipcMain.handle('apps:findLaunch', (_e, text) => launch.find(String(text || '')).catch(() => null));
  ipcMain.handle('apps:launch', (_e, item) => launch.launch(item).then(() => ({ ok: true }), (err) => ({ ok: false, error: err.message })));
  ipcMain.handle('apps:media', (_e, action) => launch.mediaSmart(action));
  ipcMain.handle('apps:nowArt', (_e, target) => launch.nowArt(target));
  // Her YouTube Music playlists: a name you give each one and its id (from the link you copy), kept in her config (ytPlaylists)
  const ytKey = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const ytId = (t) => /[?&]list=([\w-]{10,64})/.exec(String(t || ''))?.[1] || null;
  ipcMain.handle('ytm:save', (_e, { name, url } = {}) => {
    const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const id = ytId(url || clipboard.readText());
    if (!clean || !ytKey(clean)) return { ok: false, error: 'name' };
    if (!id) return { ok: false, error: 'link' };
    const all = { ...(config.load().ytPlaylists || {}) };
    all[ytKey(clean)] = { name: clean, id };
    const main = /^(?:principal|por defecto|favorita|de siempre|mi musica|musica|default)$/.test(ytKey(clean)); // "guarda esta playlist como principal"
    updateConfig({ ytPlaylists: all, ...(main || !config.load().ytDefault ? { ytDefault: id } : {}) }); // (the first one saved is the main one until you say another)
    return { ok: true, name: clean, main: main || !config.load().ytDefault };
  });
  ipcMain.handle('ytm:list', () => Object.values(config.load().ytPlaylists || {}).map((p) => p.name));
  ipcMain.handle('ytm:shuffle', (_e, mode, target) => (mode === 'play' ? launch.ytmShuffle('play') : launch.shuffleNow(target && typeof target === 'object' ? { title: String(target.title || ''), appId: String(target.appId || '') } : null))); // shuffle: the player's own, or the button of YouTube Music's bar
  ipcMain.handle('ytm:play', async (_e, name, opts = {}) => {
    let want = ytKey(name);
    if (!want) { // "pon música": the main playlist, else the first saved
      const cfg0 = config.load();
      const list0 = Object.entries(cfg0.ytPlaylists || {});
      const main0 = list0.find(([, p]) => p.id === cfg0.ytDefault) || list0[0];
      if (main0) { want = main0[0]; name = main0[1].name; }
    }
    // a playlist opens and plays at once, as it did; shuffled only if you ask ("en aleatorio") or set ytmShuffleOn in her config. Otherwise the ALEATORIO button of her player
    const shuffle = typeof opts?.shuffle === 'boolean' ? opts.shuffle : config.load().ytmShuffleOn === true;
    if (!want) return { ok: false, error: 'name' };
    const all = Object.entries(config.load().ytPlaylists || {});
    const hit = all.find(([key]) => key === want) || all.find(([key]) => key.includes(want) || want.includes(key));
    if (hit && /^[\w-]{10,64}$/.test(hit[1].id)) {
      // shuffled (only when asked): the playlist's own page, and its Shuffle button pressed once the page is up (in the background)
      const how = await launch.ytMusicOpen(shuffle ? `https://music.youtube.com/playlist?list=${hit[1].id}` : `https://music.youtube.com/watch?list=${hit[1].id}`);
      if (how && shuffle) launch.ytmShuffle('play').catch(() => {});
      return how ? { ok: true, found: true, name: hit[1].name, how, shuffle } : { ok: false, error: 'open' };
    }
    const how = await launch.ytMusicOpen(`https://music.youtube.com/search?q=${encodeURIComponent(String(name).slice(0, 100))}`); // not saved: its search
    return how ? { ok: true, found: false, name: String(name).trim(), how } : { ok: false, error: 'open' };
  }); // (the volume still uses the keys)
  ipcMain.handle('apps:nowPlaying', () => launch.nowPlaying().catch(() => null));
  ipcMain.handle('apps:nowSessions', () => launch.nowSessions().catch(() => []));
  // her wheel (wheel.js): what she can open, to put on it, and its power buttons (nothing else gets through)
  ipcMain.handle('apps:launchables', async () => (await launch.launchables().catch(() => [])).map(({ name, kind, id }) => ({ name, kind, id })));
  ipcMain.handle('apps:icons', (_e, items) => launch.icons(items).catch(() => ({})));
  ipcMain.handle('power:do', (_e, action) => (['sleep', 'restart', 'shutdown', 'cancel'].includes(action) ? launch.power(action, (info) => sendCommand('powerFailed', info)).catch(() => false) : false));
  ipcMain.handle('apps:nowControl', (_e, action, target, seconds) => launch.nowControl(String(action), target && typeof target === 'object' ? { title: String(target.title || ''), appId: String(target.appId || '') } : null, Number(seconds) || 0).catch(() => false));
  ipcMain.handle('apps:music', (_e, query) => launch.music(query).catch(() => false));
  ipcMain.handle('apps:site', (_e, address) => launch.site(address).catch(() => false));
  // typing to her: the overlay takes the keyboard while the chat is open, and gives it back after
  // The keyboard for her chat. Windows often refuses to hand the keyboard to a window while other windows are open (the one in front keeps it
  // and the first letters go there), more so when the window was just made focusable: so she asks for it right away and again a moment
  // later, until the overlay really has it.
  let focusTimers = [];
  // Her chat box is up and the window still does not have the keyboard (what Windows refuses to a program that is not in front): the helper
  // clicks the box for you, as you would by hand, and puts the pointer back. Only when the keyboard did not arrive by itself.
  let lastBoxClick = 0;
  ipcMain.on('overlay:focusInput', (_e, r) => {
    if (!overlay || overlay.isDestroyed() || !r || overlay.isFocused()) return;
    if (Date.now() - lastBoxClick < 3000) return;
    lastBoxClick = Date.now();
    const o = overlay.getBounds();
    const p = screen.dipToScreenPoint({ x: Math.round(o.x + r.x + r.width / 2), y: Math.round(o.y + r.y + Math.min(r.height / 2, 24)) });
    overlay.setIgnoreMouseEvents(false); // (it lets the click through to the box)
    windowWatch?.click(p.x, p.y);
    setTimeout(() => {
      if (!overlay || overlay.isDestroyed()) return;
      overlay.setIgnoreMouseEvents(true, { forward: true });
      sendCommand('rearmed'); // (the overlay forgets what it thought about the pointer, and decides again)
    }, 700);
  });
  ipcMain.on('overlay:focus', (_e, on) => {
    if (!overlay) return;
    focusTimers.forEach(clearTimeout);
    focusTimers = [];
    overlay.setFocusable(Boolean(on));
    if (!on) {
      overlay.blur();
      return;
    }
    const grab = () => {
      if (!overlay || overlay.isDestroyed()) return;
      if (overlay.isFocused()) return;
      overlay.setAlwaysOnTop(true, 'screen-saver');
      overlay.moveTop();
      overlay.focus();
      overlay.webContents.focus();
    };
    grab();
    windowWatch?.focus(); // (the helper that sees her windows takes the keyboard for her too: the part Windows refuses to a program that is not in front)
    focusTimers = [60, 180, 400, 800].map((ms) => setTimeout(grab, ms));
    setTimeout(() => { if (overlay && !overlay.isDestroyed() && !overlay.isFocused()) windowWatch?.focus(); }, 300); // (once more if it did not take)
  });
  // her report card's copy button: a picture of that part of the overlay, on the clipboard
  ipcMain.handle('panel:copy', async (_e, rect) => {
    const image = await overlay.webContents.capturePage(rect);
    if (image.isEmpty()) return false;
    const png = new Blob([image.toPNG()], { type: 'image/png' });
    await clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  });
  // her guide: where her tray icon is (it lives in the taskbar, off the overlay, hence overlay
  // coordinates past its edge), and the corner by the clock in case Windows hid it behind the ^
  ipcMain.handle('guide:tray', () => {
    const o = overlay.getBounds();
    const d = targetDisplay().bounds;
    const b = tray?.getBounds();
    const icon = b && b.width > 0 ? { x: b.x - o.x, y: b.y - o.y, w: b.width, h: b.height } : null;
    const corner = { x: d.x + d.width - 150 - o.x, y: d.y + d.height - 44 - o.y, w: 140, h: 40 };
    return { icon, corner };
  });
  // her guide: Claude Code's folder (~/.claude) in Explorer, its settings file selected
  ipcMain.handle('guide:claudeFolder', () => {
    const file = activeHooks().status().file;
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) return { found: false, dir };
    if (fs.existsSync(file)) shell.showItemInFolder(file);
    else shell.openPath(dir);
    return { found: true, dir, file: fs.existsSync(file), label: fs.existsSync(file) ? path.basename(file) : path.basename(dir) };
  });
  ipcMain.handle('clips:list', () => {
    try {
      return fs.readdirSync(clipsDir(), { withFileTypes: true })
        .filter((d) => d.isFile() && CLIP_EXT.test(d.name))
        .slice(0, 200)
        .map((d) => ({ name: d.name, url: `capri://clips/${encodeURIComponent(d.name)}` }));
    } catch {
      return []; // no such folder yet
    }
  });
  ipcMain.handle('sounds:list', () => {
    try {
      return fs.readdirSync(userSoundsDir())
        .filter((f) => SOUND_EXT.test(f))
        .map((f) => ({ name: f.replace(SOUND_EXT, '').toLowerCase(), url: `capri://usersounds/${encodeURIComponent(f)}` }));
    } catch {
      return [];
    }
  });
}

// Only in --dev: lets scripts drive the overlay and grab frames of it (no desktop content, just our window).
const testWins = new Map(); // name -> test window

async function debugHandler(route, body) {
  if (!DEV) throw new Error('debug routes need --dev');
  if (route === 'command') {
    sendCommand(body.name, body);
    return { ok: true };
  }
  if (route === 'reload') {
    overlay.webContents.reloadIgnoringCache();
    return { ok: true };
  }
  if (route === 'unhook') {
    // the pointer no longer passed on to her, as when Windows drops the mouse hook
    overlay.setIgnoreMouseEvents(true);
    return { ok: true };
  }
  if (route === 'testwin') {
    // plain windows to sit on, opened without stealing focus, by name (`id`, default "main");
    // each one opened goes in front of the others. { open: false } without an id closes them all.
    const id = body.id ?? 'main';
    if (!body.open && body.id === undefined) {
      for (const win of testWins.values()) win.destroy();
      testWins.clear();
      return { ok: true };
    }
    testWins.get(id)?.destroy();
    testWins.delete(id);
    if (body.open) {
      const b = overlay.getBounds();
      const win = new BrowserWindow({
        x: b.x + (body.x ?? 300), y: b.y + (body.y ?? 380), width: body.w ?? 720, height: body.h ?? 380,
        show: false, alwaysOnTop: true, title: `Capri test window ${id}`, backgroundColor: '#1b1726',
      });
      win.loadURL('data:text/html,<body style="background:%231b1726"></body>');
      win.showInactive();
      testWins.set(id, win);
    }
    return { ok: true };
  }
  if (route === 'movewin' && testWins.has(body.id ?? 'main')) {
    const win = testWins.get(body.id ?? 'main');
    const [x, y] = win.getPosition();
    win.setPosition(x + (body.dx || 0), y + (body.dy || 0));
    return { ok: true };
  }
  if (route === 'mouse') {
    // the pointer moving over the overlay (css px), and clicking if asked, without touching the real one
    const at = { x: Math.round(body.x), y: Math.round(body.y) };
    overlay.webContents.sendInputEvent({ type: 'mouseMove', ...at });
    if (body.click) {
      overlay.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...at });
      overlay.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...at });
    }
    return { ok: true };
  }
  if (route === 'type') {
    // typing into the overlay (her chat), and Enter if asked
    if (body.text) await overlay.webContents.insertText(body.text);
    if (body.enter) {
      overlay.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
      overlay.webContents.sendInputEvent({ type: 'char', keyCode: 'Return' });
      overlay.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    }
    return { ok: true };
  }
  if (route === 'capture') {
    const image = await overlay.webContents.capturePage();
    // installed, the app's own folder is read-only: its data folder instead
    const dir = path.join(app.isPackaged ? app.getPath('userData') : ROOT, 'captures');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${(body.name || 'frame').replace(/[^\w-]/g, '')}.png`);
    fs.writeFileSync(file, image.toPNG());
    return { ok: true, file };
  }
  throw new Error('unknown debug route');
}

function main() {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => sendCommand('status'));
  if (process.platform === 'win32') app.setAppUserModelId('capri.desktop');

  app.whenReady().then(() => {
    if (!['codex', 'claude'].includes(config.load().assistant)) config.save({ assistant: activeAssistant().id });
    serveProtocol();
    registerIpc();
    permission.registerPermissionIpc();
    // her scanner (Ctrl+Alt+S): what's inside its frame, described by a model that sees
    // one routine for "look at this picture": the scanner's, and her own look at your screen
    const describeShot = async ({ file, png, signal, mode, noClaude = false }) => {
      const cfg = llmConfig({ ...config.load(), lang: resolveLang(config.load().lang) });
      const { id, model } = await llm.scanTarget(cfg, pickModel(cfg));
      if (noClaude && id === 'claude') throw new Error('never on its own with Claude');
      try {
        const text = await llm.describeImage(id, cfg, { model, file, png, lang: cfg.lang, signal, mode });
        return { text, engine: id === 'claude' ? `Claude ${cfg.claudeScanModel || 'haiku'}` : model };
      } catch (err) {
        if (id !== 'gemini') throw err;
        // Gemini is down or busy: a model that sees, on this PC, takes it (slower, but it answers)
        const st = await llm.ollamaStatus({ start: true });
        if (!st.vision.length) throw err;
        const text = await llm.describeImage('ollama', cfg, { model: st.vision[0], file, png, lang: cfg.lang, signal, mode });
        return { text, engine: `${st.vision[0]} (local: Gemini no pudo)` };
      }
    };
    // her own look at your screen, now and then, if you turned it on: ONE remark in her voice. Never with Claude.
    let looking = false;
    ipcMain.handle('ambient:look', async () => {
      if (looking || !config.load().autoLook) return { ok: false };
      looking = true;
      const stop = new AbortController();
      const timer = setTimeout(() => stop.abort(), 120000);
      try {
        const { png, file } = await scanner.grabScreen();
        const text = String((await describeShot({ file, png, signal: stop.signal, mode: 'remark', noClaude: true }))?.text || '').trim();
        return { ok: Boolean(text) && !/^\W*nothing\W*$/i.test(text), text };
      } catch (err) {
        console.error('[capri] look:', err.message);
        return { ok: false };
      } finally {
        clearTimeout(timer);
        looking = false;
      }
    });
    llm.setUsageSink((entry) => usage.record(entry)); // what each Claude job used
    llm.setLimitSink((info) => { // Claude Code's own word on your 5-hour and weekly limits
      usage.noteLimit(info);
      pushLimitAlerts();
    });
    setInterval(pushLimitAlerts, 20000).unref?.(); // and what the Claude Code she opened reports (its file)
    scanner.register({
      describe: ({ file, png, signal }) => describeShot({ file, png, signal }),
      warm: async () => {
        const cfg = llmConfig({ ...config.load(), lang: resolveLang(config.load().lang) });
        const { id, model } = await llm.scanTarget(cfg, pickModel(cfg));
        if (id === 'ollama') ollama.warm(model);
      },
      onResult: (res) => sendCommand('scanResult', res),
      onPalette: (res) => sendCommand('palette', res), // the scanner's PALETA
      onShot: (res) => sendCommand('shotDone', res), // the scanner's CAPTURAR
    });
    createOverlay();
    createTray();
    { const c = config.load(); if (c.sttLocal === true || (c.sttLocal !== false && whisperLocal.installed(c))) whisperLocal.start(c); } // her own Whisper, if it is installed
    wakeWord.start(config.load(), (score) => sendCommand('wakeHit', { score })); // her name heard on this PC (openWakeWord), if it is installed
    try { fs.mkdirSync(sendDirPath(), { recursive: true }); } catch { /* not allowed: she makes it when she needs it */ }
    // once per start, a little after she's up: it files what's loose in Downloads, Desktop, Documents and Pictures
    if (config.load().organizeOnStart !== false) {
      setTimeout(async () => {
        const res = await organizeRun();
        if (res.ok ? res.moved > 0 : !/No encuentro/.test(res.error || '')) sendCommand('organized', { ...res, quiet: true });
      }, 25000);
    }
    config.save({ dndAuto: '' }); // (a quiet left over from the last run)
    autoQuiet.start({ getCfg: () => config.load(), game: () => gameInFront, recording: () => capture.recording(), onChange: (reason) => updateConfig({ dndAuto: reason }) });
    // a game or a heavy program has the PC: she steps aside (small model, nothing preloaded); a League match is followed through its own data
    lolFollow = lol.start({ getCfg: () => config.load(), lang: () => resolveLang(config.load().lang), onSay: (m) => sendCommand('gameSay', m) });
    heavy.onProcesses((running) => lolFollow.setPresent(running.some((n) => heavy.norm(n) === 'leagueoflegends')));
    heavy.start({
      getCfg: () => config.load(),
      game: () => (gameInFront && !/leagueclient/i.test(String(lastWindows?.proc || '')) ? String(lastWindows?.proc || 'fullscreen') : ''), // (League's lobby is not the game)
      onChange: (st) => {
        const was = heavyNow.active;
        heavyNow = st;
        if (st.active && !was && config.load().heavyClose !== false) sendCommand('heavyOn', { apps: st.apps, game: Boolean(st.game), light: st.light || '' }); // (she offers to close the background things that are safe to close)
        if (!st.active && was) sendCommand('heavyOff', {});
        updateConfig({});
        applyGameMouse();
      }, // (the overlay hears it in the config: with a game in front she is drawn at a few frames a second)
    });
    windowWatch = startWindowWatch({
      overlay,
      onUpdate: (data) => {
        lastWindows = data;
        overlay?.webContents.send('windows:update', data);
        const wasInFront = gameInFront;
        gameInFront = isGameInFront(data);
        if (wasInFront !== gameInFront) applyGameMouse();
        syncMediaKeys();
      },
    });
    syncMediaKeys();
    setInterval(syncMediaKeys, 4000); // (a program that grabbed a key for a moment, a config change)
    createBridge({
      port: PORT,
      // her own Claude Code chat's hooks would cover its answer with theirs
      onEvent: (evt) => {
        permission.settledElsewhere(evt); // answered in the terminal: her card goes away
        // (a task she handed Claude is marked: she already tells you how it went in her chat)
        if (!llm.isChatSession(evt.session_id)) overlay?.webContents.send('claude:event', llm.isTaskSession(evt.session_id) ? { ...evt, capri_task: true } : evt);
      },
      // every question gets her card, her own chat's too (the chat runs headless: it has nowhere else to ask)
      onPermission: (evt, signal) => permission.ask(evt, { lang: resolveLang(config.load().lang), signal }),
      onDebug: DEV ? debugHandler : null,
    });
    // her keys; one another program already has isn't given to her, and she says so (a moment after she's up)
    const taken = [];
    const bind = (accel, run) => {
      const ok = globalShortcut.register(accel, () => { logKeys(`pressed ${accel}`); run(); });
      logKeys(`${accel}: ${ok ? 'hers' : 'TAKEN by another program'}`);
      if (!ok) taken.push(prettyKey(accel));
    };
    // hold-to-dictate (only watches the keys: the combo is never taken from another program)
    if (config.load().dictate !== false) dictateWatch = dictate.start(config.load().dictateKey, { onDown: () => sendCommand('dictate', { phase: 'down' }), onUp: () => sendCommand('dictate', { phase: 'up' }) });
    bind('Control+Alt+C', () => toggleVisible());
    bind('Control+Alt+S', () => scanner.open()); // her scanner
    if (!bindWindowKey()) taken.push(prettyKey(windowKeyWanted())); // her conversations
    if (!bindSlot('translateKey')) taken.push(prettyKey(slotWanted('translateKey'))); // the selection helper
    bind('Control+Alt+V', () => listenKey()); // talk to her (to her big window if it is the one in front)
    bind('Control+Alt+R', () => sendCommand('wheel')); // her wheel: your apps, sleep, restart, shut down
    bind('Control+Alt+Shift+R', () => sendCommand('recordToggle')); // starts / stops recording the screen
    bind(config.load().colorKey || 'Alt+C', () => sendCommand('colorKey')); // the eyedropper
    if (taken.length) setTimeout(() => sendCommand('shortcutBusy', { keys: taken }), 9000);
    // her keys are checked now and then: if Windows (or a program that grabbed one for a moment) took one away, she takes it back
    const KEYS = [['Control+Alt+C', () => toggleVisible()], ['Control+Alt+S', () => scanner.open()], ['Control+Alt+V', () => listenKey()], ['Control+Alt+R', () => sendCommand('wheel')], ['Control+Alt+Shift+R', () => sendCommand('recordToggle')], [config.load().colorKey || 'Alt+C', () => sendCommand('colorKey')]];
    const holdKeys = () => {
      for (const [accel, run] of KEYS) {
        try { if (!globalShortcut.isRegistered(accel)) globalShortcut.register(accel, run); } catch { /* another program has it */ }
      }
    };
    setInterval(holdKeys, 30 * 1000);
    powerMonitor.on('resume', () => setTimeout(holdKeys, 3000));
    powerMonitor.on('unlock-screen', () => setTimeout(holdKeys, 1500));
    llm.restoreClaude(readMemory().claude);
    refreshModels(); // for her menu's model list
    setTimeout(() => launch.launchables().catch(() => {}), 20000); // what she can open, before you ask
    screen.on('display-metrics-changed', fitOverlay);
    screen.on('display-added', () => { fitOverlay(); rebuildTray(); });
    screen.on('display-removed', () => { fitOverlay(); rebuildTray(); });
    // after sleep or a locked screen, once Windows has settled
    powerMonitor.on('resume', () => setTimeout(rearmOverlay, 2000));
    powerMonitor.on('unlock-screen', () => setTimeout(rearmOverlay, 1000));
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  mediaHook?.stop();
    whisperLocal.stop();
    dictateWatch?.stop();
    wakeWord.stop();
    windowWatch?.stop();
  });
  app.on('window-all-closed', (e) => e.preventDefault());
}

main();
