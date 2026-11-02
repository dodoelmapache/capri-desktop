# Puts a Whisper on this PC for Capri: whisper.cpp's server plus a model, in %LOCALAPPDATA%\Capri\whisper.
# Capri finds it by itself the next time she starts: no key, no limit, no cost, and your voice never leaves the PC.
#
#   powershell -ExecutionPolicy Bypass -File tools\install-whisper-local.ps1            (the quick model: "small")
#   powershell -ExecutionPolicy Bypass -File tools\install-whisper-local.ps1 -Model medium
#   powershell -ExecutionPolicy Bypass -File tools\install-whisper-local.ps1 -Model turbo   (the most accurate; slow without an NVIDIA card)
#
# Needs internet only now, to download (about 200 MB for small, 500 MB medium/turbo).

param([ValidateSet('small', 'medium', 'turbo')][string]$Model = 'small')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$target = Join-Path $env:LOCALAPPDATA 'Capri\whisper'
New-Item -ItemType Directory -Force -Path $target | Out-Null
$files = @{ small = 'ggml-small-q5_1.bin'; medium = 'ggml-medium-q5_0.bin'; turbo = 'ggml-large-v3-turbo-q5_0.bin' }
$modelFile = $files[$Model]

Write-Host "1/3  Looking for whisper.cpp for Windows..."
# the latest release is sometimes published before its files are uploaded: the recent releases are looked through until one has the program
$asset = $null
try {
  $releases = Invoke-RestMethod -Uri 'https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=12' -Headers @{ 'User-Agent' = 'capri-desktop' }
  foreach ($rel in $releases) {
    $asset = $rel.assets | Where-Object { $_.name -match 'vulkan' -and $_.name -match 'x64' -and $_.name -match '\.zip$' } | Select-Object -First 1
    if (-not $asset) { $asset = $rel.assets | Where-Object { $_.name -eq 'whisper-bin-x64.zip' } | Select-Object -First 1 }
    if ($asset) { break }
  }
} catch { Write-Host "     (GitHub's list did not answer: $($_.Exception.Message))" }
if ($asset) { $zipName = $asset.name; $zipUrl = $asset.browser_download_url }
else { # a release that is known to have it
  $zipName = 'whisper-bin-x64.zip'
  $zipUrl = 'https://github.com/ggml-org/whisper.cpp/releases/download/b4938/whisper-bin-x64.zip'
}
Write-Host "     $zipName"
$zip = Join-Path $env:TEMP $zipName
Invoke-WebRequest -Uri $zipUrl -OutFile $zip
$tmp = Join-Path $env:TEMP 'capri-whisper-unzip'
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $tmp -Force
$server = Get-ChildItem -Path $tmp -Recurse -Filter 'whisper-server.exe' | Select-Object -First 1
if (-not $server) { $server = Get-ChildItem -Path $tmp -Recurse -Filter 'server.exe' | Select-Object -First 1 }
if (-not $server) { Write-Host 'Inside the zip:'; Get-ChildItem -Path $tmp -Recurse -Filter '*.exe' | ForEach-Object { Write-Host "   $($_.Name)" }; throw 'That zip has no whisper-server.exe or server.exe. Send me the list above.' }
Copy-Item -Path (Join-Path $server.DirectoryName '*') -Destination $target -Recurse -Force
if ($server.Name -eq 'server.exe') { Copy-Item (Join-Path $target 'server.exe') (Join-Path $target 'whisper-server.exe') -Force }
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "2/3  Downloading the model $modelFile (a few minutes)..."
$dest = Join-Path $target $modelFile
if (-not (Test-Path $dest)) { Invoke-WebRequest -Uri "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$modelFile" -OutFile $dest }

Write-Host "3/3  Checking that it runs..."
$p = Start-Process -FilePath (Join-Path $target 'whisper-server.exe') -ArgumentList '--help' -NoNewWindow -Wait -PassThru -RedirectStandardOutput (Join-Path $env:TEMP 'capri-whisper-help.txt') -RedirectStandardError (Join-Path $env:TEMP 'capri-whisper-err.txt')
Write-Host ''
Write-Host "Done. Installed in $target  (model: $modelFile)."
Write-Host 'Close Capri and open her again: she starts it with herself. In her config, sttLocalFirst: true makes her use it before the cloud.'
