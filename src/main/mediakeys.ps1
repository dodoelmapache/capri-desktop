# Takes the keyboard's media keys (play/pause, next, previous) away from Windows while she is out, so its own pop-up does not open
# next to her player card. A low-level keyboard hook swallows them and prints one word per press: toggle, next, previous.
# Reads "on" / "off" lines on its input: off, the keys go through to Windows untouched. Its own end of input ends it.
# Keys that a program sent (a keyboard's own software such as Logitech's, a macro pad) are taken like real presses: many keyboards' media keys arrive that way.
# The exception is a moment after her own "pass": she is about to send a media key herself and it must reach Windows.
#
#   powershell -STA -File mediakeys.ps1

$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

public static class CapriMediaKeys {
  delegate IntPtr Proc(int code, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, Proc p, IntPtr mod, uint tid);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int c, IntPtr w, IntPtr l);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string n);

  static Proc proc = Hook;
  static IntPtr hook = IntPtr.Zero;
  static volatile bool on = false;
  static int passUntil = 0;

  static IntPtr Hook(int code, IntPtr w, IntPtr l) {
    if (code >= 0 && on) {
      int vk = Marshal.ReadInt32(l, 0);
      int flags = Marshal.ReadInt32(l, 8);
      bool injected = (flags & 0x10) != 0;
      bool hers = injected && Environment.TickCount < passUntil;
      if (vk == 0xB3 || vk == 0xB0 || vk == 0xB1) Console.Error.WriteLine("seen vk=" + vk + " injected=" + injected + " hers=" + hers + " on=" + on);
      if (!hers && (vk == 0xB3 || vk == 0xB0 || vk == 0xB1)) {
        int msg = (int)w;
        if (msg == 0x100 || msg == 0x104) {
          Console.Out.WriteLine(vk == 0xB3 ? "toggle" : (vk == 0xB0 ? "next" : "previous"));
          Console.Out.Flush();
        }
        return (IntPtr)1; // swallowed, key up as well
      }
    }
    return CallNextHookEx(hook, code, w, l);
  }

  public static void Run() {
    using (Process p = Process.GetCurrentProcess())
    using (ProcessModule m = p.MainModule) {
      hook = SetWindowsHookEx(13, proc, GetModuleHandle(m.ModuleName), 0);
    }
    if (hook == IntPtr.Zero) { Console.Error.WriteLine("hook failed"); Environment.Exit(2); }
    Thread reader = new Thread(delegate () {
      string line;
      while ((line = Console.In.ReadLine()) != null) {
        string cmd = line.Trim();
        if (cmd == "pass") passUntil = Environment.TickCount + 5000;
        else on = cmd == "on";
      }
      Environment.Exit(0);
    });
    reader.IsBackground = true;
    reader.Start();
    Application.Run();
  }
}
"@
[CapriMediaKeys]::Run()
