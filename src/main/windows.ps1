# Watches the top-level windows so Capri can sit on them.
# Prints one JSON line whenever something changes: the foreground window and the visible
# windows in z-order (front first), as physical-pixel frame bounds, and the NAME of the foreground
# program ("proc"). No window titles, no contents.
#
#   powershell -File windows.ps1 <capri hwnd> <capri pid> [<focus request file>]
#
# It also does one more thing for her: when the file named in the third argument shows up (holding a window handle), it makes that window the
# one with the keyboard. Windows refuses that to a window of a program that isn't in front (more so with other windows open); the tap of an
# unused key and the link to the input of the window in front are the usual way past it (Alt+Tab launchers and the like do the same).

param([long]$Self = 0, [int]$ParentPid = 0, [string]$FocusFile = '')
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class CapriWindows {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hwnd);
  [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr hwnd, bool alt);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint attach, uint to, bool on);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT value, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);

  const int GWL_EXSTYLE = -20;
  const int WS_EX_TOOLWINDOW = 0x80;
  const int WS_EX_NOACTIVATE = 0x08000000;
  const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
  const int DWMWA_CLOAKED = 14;

  public static void Init() {
    SetProcessDpiAwarenessContext(new IntPtr(-4)); // per-monitor v2: real pixels everywhere
  }

  static long lastFg = 0;
  static string lastProc = "";

  // The name of the program that owns that window ("chrome", "Illustrator"): only the name, no titles
  static string ProcOf(IntPtr h) {
    long id = h.ToInt64();
    if (id == lastFg) return lastProc;
    string name = "";
    try {
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      if (pid != 0) name = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName;
    } catch { name = ""; }
    name = System.Text.RegularExpressions.Regex.Replace(name, "[^A-Za-z0-9 ._-]", "");
    lastFg = id;
    lastProc = name;
    return name;
  }

  // Give the keyboard to this window (hwnd), even if another program has it
  public static bool Focus(long hwnd) {
    IntPtr h = new IntPtr(hwnd);
    uint pid;
    uint front = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
    uint me = GetCurrentThreadId();
    keybd_event(0x87, 0, 0, UIntPtr.Zero); // F24 down and up: a key nobody uses, so it counts as input of ours and does nothing
    keybd_event(0x87, 0, 2, UIntPtr.Zero);
    bool linked = front != 0 && front != me && AttachThreadInput(me, front, true);
    BringWindowToTop(h);
    bool ok = SetForegroundWindow(h);
    if (GetForegroundWindow() != h) { // it did not take: the other way, which Windows is more lenient with
      SwitchToThisWindow(h, true);
      ok = GetForegroundWindow() == h;
    }
    if (linked) AttachThreadInput(me, front, false);
    return ok;
  }

  // The last resort for the keyboard: a real click on her box (what you do by hand, which Windows always accepts), and the pointer back where it was
  public static void Click(int x, int y) {
    POINT old;
    GetCursorPos(out old);
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(140); // her window needs a moment to notice the pointer over it and let the click through
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero); // left button down
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero); // and up
    System.Threading.Thread.Sleep(60);
    SetCursorPos(old.X, old.Y);
  }

  public static string Snapshot(long self) {
    var sb = new StringBuilder();
    IntPtr fgh = GetForegroundWindow();
    sb.Append("{\"fg\":").Append(fgh.ToInt64()).Append(",\"proc\":\"").Append(ProcOf(fgh)).Append("\",\"wins\":[");
    int count = 0;
    EnumWindows((h, l) => {
      if (count >= 40) return false;
      if (h.ToInt64() == self || !IsWindowVisible(h) || IsIconic(h)) return true;
      int ex = GetWindowLong(h, GWL_EXSTYLE);
      if ((ex & WS_EX_TOOLWINDOW) != 0 || (ex & WS_EX_NOACTIVATE) != 0) return true;
      int cloaked;
      if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0) return true;
      var cls = new StringBuilder(64);
      GetClassName(h, cls, 64);
      string c = cls.ToString();
      if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") return true;
      RECT r;
      if (DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out r, 16) != 0) return true;
      if (r.Right - r.Left < 200 || r.Bottom - r.Top < 120) return true;
      if (count > 0) sb.Append(',');
      count++;
      sb.Append("{\"id\":").Append(h.ToInt64())
        .Append(",\"x\":").Append(r.Left).Append(",\"y\":").Append(r.Top)
        .Append(",\"w\":").Append(r.Right - r.Left).Append(",\"h\":").Append(r.Bottom - r.Top)
        .Append(",\"max\":").Append(IsZoomed(h) ? "true" : "false").Append('}');
      return true;
    }, IntPtr.Zero);
    sb.Append("]}");
    return sb.ToString();
  }
}
"@

[CapriWindows]::Init()
$last = ''
$tick = 0
while ($true) {
  $snap = [CapriWindows]::Snapshot($Self)
  if ($snap -ne $last) {
    [Console]::Out.WriteLine($snap)
    [Console]::Out.Flush()
    $last = $snap
  }
  # stop with Capri, even if she crashed without telling us
  $tick++
  if ($ParentPid -and ($tick % 20 -eq 0) -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }
  # (the wait between two looks at the windows, in thirds: a request for the keyboard is answered within 50 ms)
  for ($i = 0; $i -lt 3; $i++) {
    if ($FocusFile -and (Test-Path -LiteralPath $FocusFile)) {
      $req = ''
      try {
        $req = (Get-Content -LiteralPath $FocusFile -Raw).Trim()
        Remove-Item -LiteralPath $FocusFile -Force
      } catch { $req = '' }
      if ($req -match '^[0-9]+$') { try { [void][CapriWindows]::Focus([long]$req) } catch { } }
      elseif ($req -match '^click (-?[0-9]+) (-?[0-9]+)$') { try { [CapriWindows]::Click([int]$Matches[1], [int]$Matches[2]) } catch { } }
    }
    Start-Sleep -Milliseconds 50
  }
}
