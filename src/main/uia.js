'use strict';

// Her eyes and hands on other programs, through Windows' UI Automation (the same tree a screen reader uses): she reads the text a window shows
// and, when you confirm, writes into one of its boxes. No pictures, no pixels. Three levels, set here and not by whoever asks:
//   read     free: what a window says (read)
//   act      a click on something harmless (click); names like delete, pay, install, shut down never go through here
//   confirm  anything that leaves your PC as you (type with send): only with `confirmed: true`, which only her card's Send button sets, and only in chat apps
// Windows only. It never runs by itself: something has to ask.

const fs = require('node:fs');
const path = require('node:path');
const apps = require('./apps');

// What she did and what came back, in _logs/msg.log (no message text, only counts and errors)
function log(line) {
  try {
    const dir = path.join(__dirname, '..', '..', '_logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'msg.log'), `${new Date().toISOString()} ${line}\n`);
  } catch { /* the log is a courtesy */ }
}

const CHAT_APPS = /whatsapp|discord|telegram|signal|messenger|slack|teams|instagram/i;
const DANGER = /eliminar|borrar|delete|remove|quitar|pagar|pay\b|comprar|buy|purchase|instalar|install|apagar|shut\s?down|reiniciar|restart|formatear|format|publicar|post\b|enviar|send|confirmar pago/i;

const PS_HEAD = String.raw`Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Windows.Forms
$ErrorActionPreference = 'Stop'
$UA = [System.Windows.Automation.AutomationElement]
$CT = [System.Windows.Automation.ControlType]
$PC = [System.Windows.Automation.PropertyCondition]
$h = [IntPtr][long]$env:CAPRI_HWND
$root = $UA::FromHandle($h)
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);' -Name W -Namespace CapriU
$wasMin = [CapriU.W]::IsIconic($h)
`;

const READ_PS = `${PS_HEAD}
$cond = [System.Windows.Automation.OrCondition]::new([System.Windows.Automation.Condition[]]@(
  $PC::new($UA::ControlTypeProperty, $CT::Text),
  $PC::new($UA::ControlTypeProperty, $CT::ListItem),
  $PC::new($UA::ControlTypeProperty, $CT::Hyperlink)))
function Grab {
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
  $lines = New-Object System.Collections.Generic.List[string]
  $n = [Math]::Min($all.Count, 1500)
  for ($i = 0; $i -lt $n; $i++) {
    try { $name = $all.Item($i).Current.Name } catch { continue }
    if ($name -and $name.Length -ge 2) { [void]$lines.Add($name) }
  }
  return $lines
}
function GrabAny {
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $lines = New-Object System.Collections.Generic.List[string]
  $n = [Math]::Min($all.Count, 2500)
  for ($i = 0; $i -lt $n; $i++) {
    try { $name = $all.Item($i).Current.Name } catch { continue }
    if ($name -and $name.Length -ge 3) { [void]$lines.Add($name) }
  }
  return $lines
}
function Kinds {
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $k = @{}
  $n = [Math]::Min($all.Count, 800)
  for ($i = 0; $i -lt $n; $i++) { try { $t = $all.Item($i).Current.ControlType.ProgrammaticName; $k[$t] = 1 + [int]$k[$t] } catch { } }
  return @{ total = $all.Count; kinds = $k }
}
try {
  if ($wasMin) { [void][CapriU.W]::ShowWindow($h, 4); Start-Sleep -Milliseconds 1300 } # (minimized: it is shown again without taking the keyboard, so the program paints itself)
  $lines = Grab
  for ($try = 0; $try -lt 3 -and $lines.Count -lt 5; $try++) { Start-Sleep -Milliseconds 1500; $lines = Grab } # (browsers build their tree when someone first asks)
  $mode = 'text'
  if ($lines.Count -lt 3) { $lines = GrabAny; $mode = 'any' }
  $diag = $null
  if ($lines.Count -lt 3) { $diag = Kinds }
  @{ ok = $true; title = $root.Current.Name; lines = @($lines); wasMin = [bool]$wasMin; mode = $mode; diag = $diag } | ConvertTo-Json -Compress -Depth 5
} finally {
  if ($wasMin) { [void][CapriU.W]::ShowWindow($h, 7) } # (and back down, without taking the keyboard)
}
`;

const CLICK_PS = `${PS_HEAD}
$want = $env:CAPRI_NAME
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$hit = $null
for ($i = 0; $i -lt [Math]::Min($all.Count, 3000); $i++) {
  try { $e = $all.Item($i); if ($e.Current.Name -eq $want -and $e.Current.IsEnabled) { $hit = $e; break } } catch { }
}
if (-not $hit) { @{ ok = $false; error = 'not found' } | ConvertTo-Json -Compress; exit }
try { $hit.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() } catch { $hit.SetFocus() }
@{ ok = $true } | ConvertTo-Json -Compress
`;

const TYPE_PS = `${PS_HEAD}
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r); [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int hh, uint f); [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }' -Name V -Namespace CapriU2
$stealth = ($env:CAPRI_STEALTH -eq '1')
$prev = [CapriU2.V]::GetForegroundWindow()
$rect = New-Object CapriU2.V+RECT
$moved = $false
$NOSIZE_NOZ_NOACT = 0x15
if ($stealth) { # (the window is shown where nobody looks: far outside the screens; the program still paints and listens)
  if ($wasMin) { [void][CapriU.W]::ShowWindow($h, 4); Start-Sleep -Milliseconds 250 }
  if ([CapriU2.V]::GetWindowRect($h, [ref]$rect)) { $moved = [CapriU2.V]::SetWindowPos($h, [IntPtr]::Zero, -30000, -30000, 0, 0, $NOSIZE_NOZ_NOACT) }
} elseif ($wasMin) { [void][CapriU.W]::ShowWindow($h, 9) }
try {
  [System.Windows.Forms.SendKeys]::SendWait('{F16}') # (a tap of an unused key: Windows then lets another program take the keyboard)
  [void][CapriU.W]::SetForegroundWindow($h)
  Start-Sleep -Milliseconds 350
  $contact = $env:CAPRI_CONTACT
  $pick = $null
  if (-not $contact) { # (with a contact it goes by keys: some apps, like WhatsApp for Windows, show no boxes to Automation)
    $edits = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $PC::new($UA::ControlTypeProperty, $CT::Edit))
    $hint = $env:CAPRI_HINT
    foreach ($e in $edits) { try { if ($e.Current.IsEnabled -and $e.Current.Name -match $hint) { $pick = $e } } catch { } }
    if (-not $pick) { foreach ($e in $edits) { try { if ($e.Current.IsEnabled -and $e.Current.IsKeyboardFocusable) { $pick = $e } } catch { } } }
    if (-not $pick) { @{ ok = $false; error = 'no box to write in' } | ConvertTo-Json -Compress; exit }
    $pick.SetFocus()
    Start-Sleep -Milliseconds 250
  }
  $old = $null; try { $old = Get-Clipboard -Raw } catch { }
  if ($contact) {
    [System.Windows.Forms.SendKeys]::SendWait('^f') # (the search of chats)
    Start-Sleep -Milliseconds 700
    Set-Clipboard -Value $contact
    [System.Windows.Forms.SendKeys]::SendWait('^v')
    Start-Sleep -Milliseconds 1400
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}') # (the first result opens its chat, with the box ready)
    Start-Sleep -Milliseconds 1200
  }
  Set-Clipboard -Value $env:CAPRI_TEXT
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Start-Sleep -Milliseconds 300
  if ($env:CAPRI_SEND -eq '1') { [System.Windows.Forms.SendKeys]::SendWait('{ENTER}'); Start-Sleep -Milliseconds 250 }
  if ($null -ne $old) { try { Set-Clipboard -Value $old } catch { } }
  @{ ok = $true; box = $(if ($pick) { $pick.Current.Name } else { 'by keys' }); stealth = [bool]$moved } | ConvertTo-Json -Compress
} finally {
  # everything back as it was: the window where it lived, minimized again if it was, and the keyboard to what you were doing
  if ($moved) { [void][CapriU2.V]::SetWindowPos($h, [IntPtr]::Zero, $rect.L, $rect.T, 0, 0, $NOSIZE_NOZ_NOACT) }
  if ($wasMin) { Start-Sleep -Milliseconds 300; [void][CapriU.W]::ShowWindow($h, 6) }
  if ($prev -ne [IntPtr]::Zero -and $prev -ne $h) { [void][CapriU.W]::SetForegroundWindow($prev) }
}
`;

const parse = (out) => { try { return JSON.parse(out); } catch { return { ok: false, error: 'no answer' }; } };
const fail = (error) => ({ ok: false, error });

// The window of a program by the name you say it ("whatsapp", "discord"), or null.
async function windowOf(wanted) {
  const w = await apps.findWindow(String(wanted || '')).catch(() => null);
  return w || null;
}

// What a window says, in order: { ok, title, lines: [text...] }. Whatever is on screen in it (a chat open, a list).
async function readWin(w, { max = 40 } = {}) {
  if (process.platform !== 'win32') return fail('windows only');
  if (!w) return fail('window not found');
  log(`read ${w.proc}: window "${w.title}"`);
  const out = parse(await apps.powershell(READ_PS, 45000, { CAPRI_HWND: w.hwnd }).catch((err) => JSON.stringify({ ok: false, error: err.message })));
  if (!out.ok) { log(`read ${w.proc}: failed: ${out.error}`); return out; }
  log(`read ${w.proc}: ${[].concat(out.lines || []).length} lines (${out.mode}${out.wasMin ? ', was minimized' : ''})${out.diag ? ` tree: ${JSON.stringify(out.diag)}` : ''}`);
  const seen = new Set();
  const lines = [].concat(out.lines || []).map((l) => String(l).replace(/\s+/g, ' ').trim()).filter((l) => l.length >= 2 && !seen.has(l) && seen.add(l));
  return { ok: true, title: w.title, proc: w.proc, lines: lines.slice(-max), mode: out.mode };
}

async function read(wanted, opts = {}) {
  if (process.platform !== 'win32') return fail('windows only');
  const w = await windowOf(wanted);
  if (!w) { log(`read ${wanted}: window not found`); return fail('window not found'); }
  return readWin(w, opts);
}

// A click on a button or link by its name. Harmful names never go.
async function click(wanted, name) {
  if (process.platform !== 'win32') return fail('windows only');
  if (!name || DANGER.test(name)) return fail('that one needs you');
  const w = await windowOf(wanted);
  if (!w) return fail('window not found');
  return parse(await apps.powershell(CLICK_PS, 25000, { CAPRI_HWND: w.hwnd, CAPRI_NAME: String(name) }).catch((err) => JSON.stringify({ ok: false, error: err.message })));
}

// Writes into the message box of a chat app that is open, and sends it. Only with `confirmed` (her card's Send button) and only in chat apps.
async function type(wanted, text, { confirmed = false, send = true, contact = '', stealth = true } = {}) {
  if (process.platform !== 'win32') return fail('windows only');
  if (confirmed !== true) return fail('needs confirmation');
  const msg = String(text || '').trim();
  if (!msg || msg.length > 2000) return fail('empty or too long');
  const w = await windowOf(wanted);
  if (!w) return fail('window not found');
  if (!CHAT_APPS.test(`${w.title} ${w.proc}`)) return fail('not a chat app');
  log(`write ${wanted}: ${contact ? 'by keys to a contact' : 'in the open chat'}, ${send ? 'with send' : 'without send'}`);
  const hint = '(?i)mensaj|message|escribe|type a|write a|send a|enviar';
  return parse(await apps.powershell(TYPE_PS, 30000, { CAPRI_HWND: w.hwnd, CAPRI_TEXT: msg, CAPRI_SEND: send ? '1' : '0', CAPRI_HINT: hint, CAPRI_CONTACT: String(contact || '').slice(0, 80), CAPRI_STEALTH: stealth ? '1' : '0' }).catch((err) => JSON.stringify({ ok: false, error: err.message })));
}

module.exports = { read, readWin, click, type, windowOf, CHAT_APPS };
