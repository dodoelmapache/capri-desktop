'use strict';

// Alerts about the PC itself: a drive that is almost full, the processor running hot, the laptop battery, and the battery of Bluetooth
// keyboards and mice that report it to Windows. She looks every few minutes (a short PowerShell, nothing is installed) and speaks only when something
// crosses a line, once per level, with a long wait before she repeats it. config.hwAlerts: false turns it off.
// What she can NOT see: the temperature on PCs that do not give it to Windows, and the battery of devices that only report it to their own software
// (Logitech G Hub, Razer Synapse...). In those cases she stays silent about it.

const apps = require('./apps');

const EVERY_MS = 5 * 60 * 1000;
const DEVICES_EVERY = 3; // (the Bluetooth batteries are slower to ask: every third look)
const WAIT = { disk: 24 * 3600e3, temp: 30 * 60e3, battery: 20 * 60e3, device: 12 * 3600e3 };

const PS = String.raw`
$o = @{}
try { $o.disks = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { @{ d = $_.DeviceID; free = [double]$_.FreeSpace; size = [double]$_.Size } }) } catch { }
try {
  $t = (Get-Counter '\Thermal Zone Information(*)\Temperature' -ErrorAction Stop).CounterSamples | ForEach-Object { $_.CookedValue - 273.15 } | Where-Object { $_ -gt 1 -and $_ -lt 130 }
  if ($t) { $o.temp = [math]::Round(($t | Measure-Object -Maximum).Maximum, 0) }
} catch { }
try { $b = Get-CimInstance Win32_Battery -ErrorAction Stop | Select-Object -First 1; if ($b) { $o.battery = @{ pct = [int]$b.EstimatedChargeRemaining; plugged = ($b.BatteryStatus -ne 1) } } } catch { }
if ($env:CAPRI_DEVICES -eq '1') {
  try {
    $o.devices = @(Get-PnpDevice -PresentOnly -ErrorAction Stop | Where-Object { $_.InstanceId -match '^(BTHENUM|BTHLE|HID)' -and $_.FriendlyName } | ForEach-Object {
      $p = Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2' -ErrorAction SilentlyContinue
      if ($p -and $p.Data -ne $null -and $p.Data -ge 0 -and $p.Data -le 100) { @{ name = $_.FriendlyName; pct = [int]$p.Data } }
    } | Sort-Object { $_.name } -Unique)
  } catch { }
}
$o | ConvertTo-Json -Compress -Depth 4
`;

function setup({ config, onAlert, quiet }) {
  if (process.platform !== 'win32') return { stop() {} };
  const last = {}; // what she said, and when
  const hot = { n: 0 };
  let looks = 0;
  const say = (key, kind, payload) => {
    const now = Date.now();
    if (now - (last[key] || 0) < (WAIT[kind] || WAIT.disk)) return;
    last[key] = now;
    onAlert({ kind, ...payload });
  };
  const look = async () => {
    const c = config.load();
    if (c.hwAlerts === false || quiet?.()) return;
    const withDevices = looks++ % DEVICES_EVERY === 0;
    let r;
    try { r = JSON.parse(await apps.powershell(PS, 45000, { CAPRI_DEVICES: withDevices ? '1' : '0' })); } catch { return; }
    for (const d of r.disks || []) {
      if (!d.size) continue;
      const usedPct = Math.round((1 - d.free / d.size) * 100);
      const freeGb = Math.round(d.free / 1073741824);
      const level = usedPct >= 95 || freeGb < 15 ? 'crit' : (usedPct >= 90 || freeGb < 40 ? 'warn' : '');
      if (level) say(`disk:${d.d}:${level}`, 'disk', { drive: d.d, usedPct, freeGb, level });
    }
    if (typeof r.temp === 'number') {
      hot.n = r.temp >= (Number(c.hwTempAt) || 90) ? hot.n + 1 : 0;
      if (hot.n >= 2) say('temp', 'temp', { temp: r.temp }); // (two looks in a row: a spike is not heat)
    }
    const b = r.battery;
    if (b && !b.plugged && b.pct <= (Number(c.hwBatteryAt) || 20)) say(`battery:${b.pct <= 10 ? 10 : 20}`, 'battery', { pct: b.pct });
    for (const dev of r.devices || []) if (dev.pct <= (Number(c.hwDeviceAt) || 20)) say(`device:${dev.name}`, 'device', { name: dev.name, pct: dev.pct });
  };
  const first = setTimeout(look, 90 * 1000);
  const timer = setInterval(look, EVERY_MS);
  return { stop() { clearTimeout(first); clearInterval(timer); } };
}

module.exports = { setup };
