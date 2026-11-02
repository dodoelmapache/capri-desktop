# Puts rembg (https://github.com/danielgatis/rembg) on this PC for Capri: a small Python environment in %LOCALAPPDATA%\Capri\rembg.
# With it she takes the background off a picture HERE, with no Claude and no Nano Banana: "quítale el fondo" costs nothing and the picture never leaves the PC.
#
#   powershell -ExecutionPolicy Bypass -File tools\install-rembg.ps1
#
# Needs Python 3.9+ (winget install Python.Python.3.12). The first picture downloads the model (about 170 MB), once.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$target = Join-Path $env:LOCALAPPDATA 'Capri\rembg'
New-Item -ItemType Directory -Force -Path $target | Out-Null

Write-Host '1/2  Looking for Python...'
$py = $null
foreach ($c in @('py -3', 'python')) {
  try { $v = & cmd /c "$c --version 2>&1"; if ($v -match 'Python 3\.(\d+)' -and [int]$Matches[1] -ge 9) { $py = $c; break } } catch {}
}
if (-not $py) { throw 'No Python 3.9+ found. Install it first:  winget install Python.Python.3.12   (then open a new window and run this again)' }

Write-Host '2/2  Installing rembg (a few minutes)...'
$venv = Join-Path $target 'venv'
if (-not (Test-Path (Join-Path $venv 'Scripts\python.exe'))) { & cmd /c "$py -m venv `"$venv`"" }
$vpy = Join-Path $venv 'Scripts\python.exe'
& $vpy -m pip install --upgrade pip | Out-Null
& $vpy -m pip install "rembg[cli]" onnxruntime
if ($LASTEXITCODE -ne 0) { throw 'pip could not install rembg (see the lines above).' }
if (-not (Test-Path (Join-Path $venv 'Scripts\rembg.exe'))) { throw 'rembg.exe is not in the environment: the install did not finish.' }

Write-Host ''
Write-Host "Done. Installed in $target"
Write-Host 'Close Capri and open her again, then tell her "quítale el fondo" with a picture attached (or about the last one she made).'
