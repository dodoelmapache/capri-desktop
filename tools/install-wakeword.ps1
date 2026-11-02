# Puts openWakeWord on this PC for Capri: a small Python environment in %LOCALAPPDATA%\Capri\wake (nothing is installed system-wide).
# Capri finds it by herself the next time she starts. It needs ONE more thing from you: a model file for the word "Capri" (capri.onnx) in that same folder.
# openWakeWord has no ready-made "Capri": it is trained once (a few minutes to an hour, free) with the training notebook of
# https://github.com/dscripka/openWakeWord (or any tool that exports an .onnx). Until then you can try the install with any of its stock models.
#
#   powershell -ExecutionPolicy Bypass -File tools\install-wakeword.ps1
#
# Needs Python 3.9+ (winget install Python.Python.3.12) and internet only now.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$target = Join-Path $env:LOCALAPPDATA 'Capri\wake'
New-Item -ItemType Directory -Force -Path $target | Out-Null

Write-Host '1/3  Looking for Python...'
$py = $null
foreach ($c in @('py -3', 'python')) {
  try { $v = & cmd /c "$c --version 2>&1"; if ($v -match 'Python 3\.(\d+)' -and [int]$Matches[1] -ge 9) { $py = $c; break } } catch {}
}
if (-not $py) { throw 'No Python 3.9+ found. Install it first:  winget install Python.Python.3.12   (then open a new window and run this again)' }
Write-Host "     $py"

Write-Host '2/3  Making the environment and installing openWakeWord (a few minutes)...'
$venv = Join-Path $target 'venv'
if (-not (Test-Path (Join-Path $venv 'Scripts\python.exe'))) { & cmd /c "$py -m venv `"$venv`"" }
$vpy = Join-Path $venv 'Scripts\python.exe'
& $vpy -m pip install --upgrade pip | Out-Null
& $vpy -m pip install openwakeword onnxruntime numpy
if ($LASTEXITCODE -ne 0) { throw 'pip could not install openwakeword (see the lines above).' }

Write-Host '3/3  Downloading its base models...'
& $vpy -c "import openwakeword; openwakeword.utils.download_models()"
Copy-Item (Join-Path $PSScriptRoot 'wakeword\capri_wake.py') (Join-Path $target 'capri_wake.py') -Force

Write-Host ''
Write-Host "Done. Installed in $target"
if (-not (Get-ChildItem $target -Filter *.onnx -ErrorAction SilentlyContinue)) {
  Write-Host 'Last step (yours): put your "Capri" model there as capri.onnx. Until it is there, Capri keeps listening the way she did.'
}
Write-Host 'Close Capri and open her again. In her config: wakeEngine "auto" (default) uses it when it is installed; wakeStrict: true also stops sending phrases without her name to the speech service.'
