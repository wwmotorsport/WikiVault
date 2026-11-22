'use strict';
// What Windows knows about its serial ports and about USB devices it could not set up. Asked of Windows itself,
// read-only and without administrator rights, when a GPS receiver is looked for and not found: the answer tells
// a missing driver from a receiver that is not plugged in. Nothing here leaves the computer.
const { execFile } = require('child_process');
const path = require('path');

const SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  "$d = Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPClass -eq 'Ports' -or ($_.DeviceID -like 'USB\\VID_*' -and $_.ConfigManagerErrorCode -ne 0) } | Select-Object Name, DeviceID, PNPClass, ConfigManagerErrorCode",
  'ConvertTo-Json @($d) -Compress',
].join('; ');

/** The rows Windows gives (Name, DeviceID, PNPClass, ConfigManagerErrorCode), or null when it cannot be asked. */
function query({ timeoutMs = 20000, shell = null } = {}) {
  if (process.platform !== 'win32' && !shell) return Promise.resolve(null);
  const exe = shell || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve) => {
    execFile(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT], { windowsHide: true, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) { resolve(null); return; }
      try { const rows = JSON.parse(String(stdout || '').replace(/^\uFEFF/, '').trim() || '[]'); resolve(Array.isArray(rows) ? rows : [rows]); } catch { resolve(null); }
    });
  });
}

module.exports = { query, SCRIPT };
