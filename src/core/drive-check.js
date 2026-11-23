'use strict';
// What kind of drive a folder is on (inside the computer, or plugged in by USB), and how fast it is. Used when the
// library is given a home, so that a slow or unsuitable external drive is noticed before 100 GB is sent to it.

const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const MB = 1024 * 1024;
const EXTERNAL = new Set(['usb', 'sd', 'mmc', '1394', 'thunderbolt']);

/** What Windows said of a drive, read into plain facts. `raw` is the JSON the query printed. */
function readDrive(raw) {
  let j = null;
  try { j = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { j = null; }
  if (!j || typeof j !== 'object') return null;
  const bus = String(j.bus == null ? '' : j.bus).trim();
  const type = String(j.type == null ? '' : j.type).trim();
  const fsName = String(j.fs == null ? '' : j.fs).trim();
  // Windows prints these as words on some versions and as numbers on others (7 is USB; 2 is a removable drive).
  const usb = EXTERNAL.has(bus.toLowerCase()) || bus === '7' || bus === '12' || bus === '13';
  const removable = /^removable$/i.test(type) || type === '2';
  const network = /^network$/i.test(type) || type === '4' || Boolean(j.network);
  return { bus: bus === '7' ? 'USB' : bus, model: String(j.model || '').trim().slice(0, 80), fs: fsName, external: usb || removable, network };
}

/** Ask Windows about the drive a folder is on. Null when it cannot be told (not Windows, or the query failed). */
function describeDrive(dir) {
  if (process.env.WIKIVAULT_DRIVE_SIM) return Promise.resolve(readDrive(process.env.WIKIVAULT_DRIVE_SIM));
  const full = path.resolve(String(dir || ''));
  if (/^\\\\/.test(full)) return Promise.resolve({ bus: '', model: '', fs: '', external: false, network: true });
  const letter = (/^([A-Za-z]):/.exec(full) || [])[1];
  if (process.platform !== 'win32' || !letter) return Promise.resolve(null);
  const script = `$ErrorActionPreference='Stop'; $v = Get-Volume -DriveLetter ${letter}; $d = $null; try { $d = Get-Partition -DriveLetter ${letter} | Get-Disk } catch {}; [pscustomobject]@{ bus = if ($d) { "$($d.BusType)" } else { '' }; model = if ($d) { "$($d.FriendlyName)" } else { '' }; fs = "$($v.FileSystem)"; type = "$($v.DriveType)" } | ConvertTo-Json -Compress`;
  return new Promise((resolve) => {
    execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 15000 }, (err, stdout) => resolve(err ? null : readDrive(String(stdout).trim())));
  });
}

/** The nearest folder that exists, going up from `dir`: where a test file can be written before the library's own folder is made. */
function existing(dir) {
  let d = path.resolve(dir);
  for (let i = 0; i < 40 && !fs.existsSync(d); i += 1) { const up = path.dirname(d); if (up === d) break; d = up; }
  return d;
}

/**
 * Time the drive by writing to it: a run of large pieces (how fast a download can be laid down) and a number of
 * small ones each made to reach the drive before the next (how quickly it answers, which is what looking things
 * up feels like). The test file is removed. Reading back is not timed: Windows would answer from its own memory.
 * @returns {Promise<{writeMBs:number, syncMs:number, bytes:number}>}
 */
async function speedTest(dir, { bytes = 96 * MB, maxMs = 9000, small = 48, signal } = {}) {
  const at = existing(dir);
  const file = path.join(at, `wikivault-speed-test-${process.pid}.tmp`);
  const piece = crypto.randomBytes(4 * MB); // not compressible, so that a drive which squeezes data cannot flatter itself
  let fh = null;
  try {
    fh = await fsp.open(file, 'w');
    let written = 0;
    const t0 = process.hrtime.bigint();
    while (written < bytes) {
      if (signal && signal.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
      await fh.write(piece, 0, piece.length, written);
      written += piece.length;
      if (written % (16 * MB) === 0) await fh.datasync();
      if (Number(process.hrtime.bigint() - t0) / 1e6 > maxMs) break;
    }
    await fh.datasync();
    const seqMs = Number(process.hrtime.bigint() - t0) / 1e6;
    const tiny = piece.subarray(0, 4096);
    const t1 = process.hrtime.bigint();
    let done = 0;
    for (; done < small; done += 1) {
      await fh.write(tiny, 0, 4096, Math.floor(Math.random() * (written / 4096 - 1)) * 4096);
      await fh.datasync();
      if (Number(process.hrtime.bigint() - t1) / 1e6 > maxMs / 2) { done += 1; break; }
    }
    const smallMs = Number(process.hrtime.bigint() - t1) / 1e6;
    return { writeMBs: Math.round((written / MB) / (seqMs / 1000) * 10) / 10, syncMs: Math.round((smallMs / Math.max(1, done)) * 10) / 10, bytes: written };
  } finally {
    if (fh) await fh.close().catch(() => {});
    await fsp.rm(file, { force: true }).catch(() => {});
  }
}

const SHOPPING = [
  'Look for a portable SSD (solid state drive). A "flash drive" or "thumb drive" is too slow, and a spinning hard disk is slow to look things up on.',
  'USB 3.2 Gen 2 (10 Gbps) or faster, sold with a USB-C cable. Plug it into a USB-C port or a blue USB port on the computer, with the cable it came with.',
  '1 TB holds everything this app can fetch, with room to grow. 500 GB holds Wikipedia with pictures, the maps and the guides.',
  'Format it as exFAT or NTFS (most are sold that way).',
];

/**
 * What to say of a drive, from what Windows said of it and how the test went.
 * @returns {{level:'good'|'fair'|'poor'|'unusable', title:string, lines:string[]}}
 */
function verdict(drive, speed) {
  const d = drive || {}; const s = speed || {};
  if (/^fat(32|16|12)?$/i.test(d.fs || '')) {
    return { level: 'unusable', title: `This drive is formatted as ${d.fs.toUpperCase()}, which cannot hold a file larger than 4 GB. Wikipedia is one file of about 100 GB, so it cannot go here.`, lines: ['Reformat the drive as exFAT or NTFS (this erases what is on it), or choose another drive.', ...SHOPPING.slice(0, 3)] };
  }
  if (d.network) return { level: 'poor', title: 'This is a network folder. The library is read all the time and will be slow, or will stop, whenever the network does.', lines: ['A drive plugged into this computer is a better home for it.', ...SHOPPING.slice(0, 3)] };
  if (s.writeMBs == null) return { level: 'fair', title: 'This is an external drive, and its speed could not be measured.', lines: SHOPPING };
  const rate = `It writes at about ${s.writeMBs >= 10 ? Math.round(s.writeMBs) : s.writeMBs} MB a second`;
  if (s.writeMBs < 25) {
    return { level: 'poor', title: `${rate}, which is too slow for a good experience: fetching Wikipedia onto it would take hours longer, and searching and Ask would lag.`, lines: ['If it is in a black USB port or on a hub, try a blue or USB-C port on the computer itself first, and press Test again: a slow port holds any drive to about 30 MB a second.', ...SHOPPING] };
  }
  if (s.writeMBs < 90 || s.syncMs > 25) {
    return { level: 'fair', title: `${rate}${s.syncMs > 25 ? ' and is slow to answer small requests' : ''}. It will work, but downloads, searching and Ask will be slower than on the drive inside the computer.`, lines: s.writeMBs < 45 ? ['If it is in a black USB port or on a hub, try a blue or USB-C port on the computer itself.', ...SHOPPING] : SHOPPING };
  }
  return { level: 'good', title: `${rate} and answers quickly. It is a good home for the library.`, lines: ['Keep it plugged in while you use the app, and use the same port so that it keeps its drive letter.'] };
}

module.exports = { readDrive, describeDrive, speedTest, verdict, existing };
