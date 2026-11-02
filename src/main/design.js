'use strict';

// Claude Design (claude.ai/design) is a web tool of Claude's: it has no API, and Claude Code can't drive it. So she hosts it:
//  - in her big conversation window, as a tab under the top bar (dock / undock), and
//  - in a window of its own (openWindow), for the card that comes out when you click her.
// Both share one session (the partition below), so you sign in once and it stays signed in, apart from your browser.

const path = require('node:path');
const { execFile } = require('node:child_process');
const { BrowserWindow, WebContentsView, session, shell, screen } = require('electron');

const URL_DESIGN = 'https://claude.ai/design';
const PARTITION = 'persist:claude-design';
// Where the page itself, and signing in to it, may go. Anything else it links to opens in your own browser.
const SITE = /(^|\.)(claude\.ai|claude\.com|anthropic\.com)$/i;
const SIGN_IN = /(^|\.)(accounts\.google\.com|appleid\.apple\.com|login\.microsoftonline\.com|login\.live\.com)$/i;
const PERMISSIONS = new Set(['clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'pointerLock', 'window-management']);

let win = null; // her own Design window
let view = null; // the Design tab in her conversation window
let viewParent = null;
let ready = false;

const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ''; } };
const isHttp = (url) => /^https?:\/\//i.test(url);

function prepareSession() {
  if (ready) return session.fromPartition(PARTITION);
  ready = true;
  const ses = session.fromPartition(PARTITION);
  // The page sees a plain Chrome, not "Electron/x": some sign-in pages turn an embedded app away
  ses.setUserAgent(`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(PERMISSIONS.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => PERMISSIONS.has(permission));
  return ses;
}

// Keeps the page where it belongs: its own site and the sign-in pages stay here; everything else is for your browser.
function guard(wc, { onFail } = {}) {
  wc.setWindowOpenHandler(({ url }) => {
    const h = hostOf(url);
    if (isHttp(url) && (SIGN_IN.test(h) || SITE.test(h))) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, autoHideMenuBar: true, backgroundColor: '#14101c', title: 'Claude' } };
    }
    if (isHttp(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    const h = hostOf(url);
    if (isHttp(url) && (SITE.test(h) || SIGN_IN.test(h))) return;
    e.preventDefault();
    if (isHttp(url)) shell.openExternal(url);
  });
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* aborted: a redirect, not a failure */) return;
    onFail?.({ code, desc, url });
  });
}

// The Design of the Claude desktop app (the one in its sidebar). The app has no link for it (claude:// only knows chats, projects, Code and
// Cowork), so she does what a hand would: brings the app forward and presses "Design" in its sidebar, through Windows' accessibility
// (UI Automation). Exit codes of the script: 0 pressed it, 3 no Claude window, 4 a Claude window without that item (it stays in front).
const PRESS_DESIGN = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class CapriW { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern void mouse_event(int f, int dx, int dy, int d, int e); }'
  $p = Get-Process -Name claude -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $p) { exit 3 }
  [CapriW]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
  [CapriW]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
  $win = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
  $names = @('Design', 'Diseño')
  for ($try = 0; $try -lt 8; $try++) {
    foreach ($n in $names) {
      $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $n)
      foreach ($el in $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)) {
        $obj = $null
        if ($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$obj)) { $obj.Invoke(); exit 0 }
        if ($el.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$obj)) { $obj.Select(); exit 0 }
      }
    }
    Start-Sleep -Milliseconds 600 # (the page's accessibility tree is built the first time it's asked about)
  }
  exit 4
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 5 }`;

function runPress() {
  return new Promise((resolve) => {
    const enc = Buffer.from(PRESS_DESIGN, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], { windowsHide: true, timeout: 20000 }, (err, _out, errout) => {
      const code = err ? (typeof err.code === 'number' ? err.code : 5) : 0;
      if (code === 5 || (errout && code !== 0 && code !== 3 && code !== 4)) console.log(`[capri] pressing Design in the Claude app: ${String(errout || err?.message).trim().slice(0, 200)}`);
      resolve(code);
    });
  });
}

// Resolves 'app' when the Claude app is in front (on Design, or at least in front); false when there's no app to bring.
async function openApp() {
  if (process.platform !== 'win32') return false;
  let code = await runPress();
  if (code === 3) { // not running (or minimised to the tray with no window): start it, give it a moment, try again
    try {
      await shell.openExternal('claude://claude.ai/new');
    } catch {
      return false;
    }
    for (let i = 0; i < 4 && code === 3; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      code = await runPress();
    }
  }
  console.log(`[capri] Claude app, Design: ${code === 0 ? 'pressed' : code === 4 ? 'app in front, no Design item found' : `code ${code}`}`);
  return code === 0 || code === 4 ? 'app' : false;
}

// Her own window
function openWindow() {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return true;
  }
  const ses = prepareSession();
  const { workArea: a } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const w = Math.min(1360, a.width - 60);
  const h = Math.min(900, a.height - 60);
  win = new BrowserWindow({
    width: w, height: h, minWidth: 720, minHeight: 520,
    x: Math.round(a.x + (a.width - w) / 2), y: Math.round(a.y + (a.height - h) / 2),
    backgroundColor: '#14101c', title: 'Capri — Claude Design', autoHideMenuBar: true, show: false,
    icon: path.join(__dirname, '..', '..', 'assets', 'icons', 'capri.ico'),
    webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => { win = null; });
  win.webContents.on('page-title-updated', (e) => e.preventDefault()); // (the title stays hers)
  guard(win.webContents, {
    onFail: ({ desc }) => { // it couldn't load here: your browser can
      console.log(`[capri] Claude Design did not load in her window (${desc}); opening it in the browser`);
      shell.openExternal(URL_DESIGN);
      if (win && !win.isDestroyed()) win.close();
    },
  });
  win.loadURL(URL_DESIGN);
  return true;
}

// The tab in her conversation window: `rect` is the area (in the window's own pixels) the tab fills, under her top bar
const whole = (r) => ({
  x: Math.max(0, Math.round(Number(r?.x) || 0)), y: Math.max(0, Math.round(Number(r?.y) || 0)),
  width: Math.max(50, Math.round(Number(r?.width) || 0)), height: Math.max(50, Math.round(Number(r?.height) || 0)),
});

function dock(parent, rect) {
  if (!parent || parent.isDestroyed()) return false;
  if (!view || view.webContents.isDestroyed()) {
    const ses = prepareSession();
    view = new WebContentsView({ webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true } });
    view.setBackgroundColor('#14101c');
    guard(view.webContents, {
      onFail: ({ desc }) => {
        console.log(`[capri] Claude Design did not load in her window (${desc}); opening it in the browser`);
        shell.openExternal(URL_DESIGN);
        if (viewParent && !viewParent.isDestroyed()) viewParent.webContents.send('design:failed');
        undock();
      },
    });
    view.webContents.loadURL(URL_DESIGN);
  }
  if (viewParent && viewParent !== parent) undock();
  viewParent = parent;
  parent.contentView.addChildView(view); // (adding it again just brings it to the front)
  view.setBounds(whole(rect));
  return true;
}

function setBounds(rect) {
  if (view && viewParent && !viewParent.isDestroyed()) view.setBounds(whole(rect));
}

// Takes the tab off the window but keeps the page alive, so coming back finds it as you left it
function undock() {
  if (view && viewParent && !viewParent.isDestroyed()) {
    try { viewParent.contentView.removeChildView(view); } catch { /* (it wasn't there) */ }
  }
  viewParent = null;
}

// Her conversation window closed: the tab goes with it
function release() {
  undock();
  if (view && !view.webContents.isDestroyed()) view.webContents.close();
  view = null;
}

module.exports = { openApp, openWindow, dock, setBounds, undock, release, URL: URL_DESIGN };
