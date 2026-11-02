# Hold-to-dictate key watcher: prints "down" when every key of the combo is held and "up" when it is let go.
# The keys are only looked at (GetAsyncKeyState), never taken: another program that uses the same combo still gets it.
#   powershell -File dictate.ps1 -Keys 17,18,32
param([string]$Keys = '17,18,32')
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class CapriDK { [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int k); }'
$vks = $Keys.Split(',') | ForEach-Object { [int]$_ }
$held = $false
while ($true) {
  $all = $true
  foreach ($k in $vks) { if (([CapriDK]::GetAsyncKeyState($k) -band 0x8000) -eq 0) { $all = $false; break } }
  if ($all -and -not $held) { $held = $true; [Console]::Out.WriteLine('down'); [Console]::Out.Flush() }
  elseif (-not $all -and $held) { $held = $false; [Console]::Out.WriteLine('up'); [Console]::Out.Flush() }
  Start-Sleep -Milliseconds 30
}
