'use strict';
// Optional first-run step on Windows: carve a dedicated NTFS partition out of
// the system drive so everyday use of Windows cannot eat the space the library
// needs. The disk work is done by partition.ps1 (see the safety rules at the
// top of that file); this module sizes the partition, runs the script (with a
// UAC prompt for the part that changes the disk) and reads its result.

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const GB = 1024 ** 3;
const FALLBACK_EDITION_BYTES = 115 * GB;   // used only when the download server cannot be asked
const WINDOWS_RESERVE_BYTES = 50 * GB;     // never leave the system drive with less free space than this
const GROWTH = 1.15;                       // English Wikipedia editions keep growing
const SLACK_BYTES = 4 * GB;                // file-system overhead and partial downloads

const floorGb = (n) => Math.floor(n / GB) * GB;
const ceilGb = (n) => Math.ceil(n / GB) * GB;

/**
 * Work out the smallest, recommended and largest partition sizes.
 *
 * Two ways to run a dedicated partition:
 *   editions = 1  "staged": each update is downloaded and verified on the system
 *                 drive, then moved in. The partition holds one edition, and the
 *                 system drive must have room for one more while an update runs.
 *   editions = 2  "self-contained": updates are downloaded and verified inside
 *                 the partition, next to the current edition.
 *
 * @param {object} a
 * @param {number} a.editionBytes   size of the current edition
 * @param {number} a.volumeFree     free bytes on the drive being shrunk
 * @param {number} a.partitionSize  current size of that drive's partition
 * @param {number|null} a.sizeMin   smallest size Windows says it can shrink to (null if unknown)
 * @param {1|2} [a.editions]
 * @param {number} [a.otherBytes]   other libraries already downloaded, which will live on the partition too
 * @param {number} [a.otherAllowance]  room to recommend for other libraries and their updates
 */
function sizePlan({ editionBytes, volumeFree, partitionSize, sizeMin, editions = 2, reserveBytes = WINDOWS_RESERVE_BYTES, otherBytes = 0, otherAllowance = 0 }) {
  const staged = editions === 1;
  const minBytes = (staged
    ? ceilGb(editionBytes * 1.05 + 2 * GB)
    : ceilGb(2 * editionBytes + SLACK_BYTES)) + ceilGb(otherBytes);
  // Other libraries are small and always update inside the partition, next to the copy in use.
  const others = Math.max(otherAllowance, 2 * otherBytes);
  const raw0 = staged
    ? editionBytes * 1.3 + SLACK_BYTES            // one edition and several years of growth; the partition cannot borrow space later
    : 2 * editionBytes * GROWTH + SLACK_BYTES;
  const raw = raw0 + others;
  const wanted = Math.ceil(raw / (10 * GB)) * 10 * GB;
  // Staged updates borrow room for one edition from the system drive, so do not let the partition take it.
  const stagingBytes = staged ? ceilGb(editionBytes * GROWTH) : 0;
  const byFree = volumeFree - reserveBytes - stagingBytes;
  const byShrink = sizeMin != null ? partitionSize - sizeMin : Infinity;
  const maxBytes = Math.max(0, floorGb(Math.min(byFree, byShrink)));
  const feasible = maxBytes >= minBytes;
  let reason = null;
  if (!feasible) {
    reason = byShrink < byFree
      ? `Windows can only shrink this drive by ${Math.floor(byShrink / GB)} GB right now, and the library needs at least ${minBytes / GB} GB.`
      : `The library needs at least ${minBytes / GB} GB, and this drive should keep ${(reserveBytes + stagingBytes) / GB} GB free${staged ? ' for Windows and for downloading updates' : ' for Windows'}. There is not enough free space for both.`;
  }
  return {
    editions,
    minBytes,
    maxBytes,
    recommendedBytes: feasible ? Math.min(Math.max(wanted, minBytes), maxBytes) : null,
    feasible,
    reason,
    shrinkLimitKnown: sizeMin != null,
    reserveBytes,
    stagingBytes,
    otherBytes: others,
  };
}

/**
 * Limit a size plan to what the drive can give up at the moment it is shrunk, which can be less than
 * what it will have free once everything is in place (the library may be sitting on it meanwhile).
 */
function capPlan(plan, capBytes, sourceLetter = 'C') {
  const maxBytes = Math.max(0, Math.min(plan.maxBytes, floorGb(capBytes)));
  const feasible = maxBytes >= plan.minBytes;
  return {
    ...plan, maxBytes, feasible,
    recommendedBytes: feasible ? Math.min(Math.max(plan.recommendedBytes ?? plan.minBytes, plan.minBytes), maxBytes) : null,
    reason: feasible ? null : plan.reason || `The partition needs at least ${plan.minBytes / GB} GB, and drive ${sourceLetter}: can give up ${maxBytes / GB} GB at the moment. Free up space on ${sourceLetter}: first.`,
  };
}

const SCRIPT_SOURCE = path.join(__dirname, 'partition.ps1');

function powershellPath() {
  const root = process.env.SystemRoot || 'C:\\Windows';
  return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function run(file, args, { timeoutMs }) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), spawnError: err && typeof err.code !== 'number' ? err : null });
    });
  });
}

class PartitionTool {
  constructor({ log = () => {}, shell = powershellPath() } = {}) {
    this.log = log;
    this.shell = shell;
  }

  async _workDir(params) {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wikivault-partition-'));
    // Read-then-write rather than copy: the source sits inside the packaged app archive.
    await fsp.writeFile(path.join(dir, 'partition.ps1'), await fsp.readFile(SCRIPT_SOURCE));
    await fsp.writeFile(path.join(dir, 'params.json'), JSON.stringify(params));
    return dir;
  }

  async _result(dir) {
    try {
      const raw = (await fsp.readFile(path.join(dir, 'result.json'), 'utf8')).replace(/^\uFEFF/, '');
      return JSON.parse(raw);
    } catch { return null; }
  }

  async _steps(dir) {
    try { return (await fsp.readFile(path.join(dir, 'steps.log'), 'utf8')).trim(); } catch { return ''; }
  }

  /** Read-only look at the drive. Runs without administrator rights; some fields may come back null. */
  async analyze(driveLetter) {
    const dir = await this._workDir({ mode: 'analyze', driveLetter });
    try {
      const r = await run(this.shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(dir, 'partition.ps1')], { timeoutMs: 60000 });
      const result = await this._result(dir);
      if (!result) throw new Error(`Windows did not return information about drive ${driveLetter}:. ${(r.stderr || r.stdout).trim().split(/\r?\n/)[0] || ''}`.trim());
      if (!result.ok) throw new Error(result.error);
      return result;
    } finally {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Read-only look at a partition Wikivault created, and whether it is safe to merge back. */
  async inspect(driveLetter, otherLetter, label = 'Wikivault') {
    const dir = await this._workDir({ mode: 'inspect', driveLetter, otherLetter, label });
    try {
      await run(this.shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(dir, 'partition.ps1')], { timeoutMs: 120000 });
      const result = await this._result(dir);
      if (!result) throw new Error(`Windows did not return information about drive ${otherLetter}:.`);
      if (!result.ok) throw new Error(result.error);
      return result;
    } finally {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Remove the partition Wikivault created and extend the original drive over
   * it. Shows the Windows administrator prompt. The script re-checks, with
   * administrator rights, that the partition is the right one and is empty.
   */
  async merge(driveLetter, otherLetter, label = 'Wikivault') {
    if (!/^[A-Z]$/.test(driveLetter) || !/^[A-Z]$/.test(otherLetter) || driveLetter === otherLetter) throw new Error('The drive letters are not valid.');
    const dir = await this._workDir({ mode: 'merge', driveLetter, otherLetter, label });
    try {
      this.log(`partition: asking Windows to remove ${otherLetter}: and extend ${driveLetter}:`);
      const r = await this._elevated(path.join(dir, 'partition.ps1'));
      const result = await this._result(dir);
      const steps = await this._steps(dir);
      if (steps) this.log(`partition steps:\n${steps}`);
      if (!result) {
        const declined = r.code === 1223 || /cancell?ed by the user/i.test(r.stderr);
        const e = new Error(declined
          ? 'Administrator approval was not given, so nothing was changed.'
          : `Windows did not report a result (exit code ${r.code}). Check Disk Management before trying again.`);
        e.code = declined ? 'DECLINED' : 'NO_RESULT';
        throw e;
      }
      if (!result.ok) {
        const e = new Error(result.error || 'The partition could not be removed.');
        e.code = result.code || 'ERROR';
        e.problems = result.problems || [];
        throw e;
      }
      this.log(`partition: removed ${result.removedLetter}:, ${driveLetter}: is now ${Math.round(result.sourceSizeAfter / GB)} GB`);
      return result;
    } finally {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Run the script with administrator rights (UAC prompt). The script reports through result.json. */
  _elevated(script) {
    const inner = `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${script}"`;
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `try { $p = Start-Process -FilePath '${this.shell.replace(/'/g, "''")}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '${inner.replace(/'/g, "''")}'; exit $p.ExitCode }`,
      'catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1223 }',
    ].join('\n');
    const encoded = Buffer.from(command, 'utf16le').toString('base64');
    return run(this.shell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { timeoutMs: 2 * 3600e3 });
  }

  /**
   * Shrink the drive and create the new volume. Shows the Windows administrator
   * prompt. Resolves with the script's result; throws with a plain message on
   * failure (err.code is the script's code, err.maxBytes is set for TOO_LARGE).
   */
  async create(driveLetter, sizeBytes, label = 'Wikivault') {
    if (!/^[A-Z]$/.test(driveLetter)) throw new Error('The drive letter is not valid.');
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < GB) throw new Error('The partition size is not valid.');
    const dir = await this._workDir({ mode: 'create', driveLetter, sizeBytes, label });
    const script = path.join(dir, 'partition.ps1');
    try {
      this.log(`partition: asking Windows to shrink ${driveLetter}: and create ${Math.round(sizeBytes / GB)} GB`);
      const r = await this._elevated(script);
      const result = await this._result(dir);
      const steps = await this._steps(dir);
      if (steps) this.log(`partition steps:\n${steps}`);
      if (!result) {
        const declined = r.code === 1223 || /cancell?ed by the user/i.test(r.stderr);
        const e = new Error(declined
          ? 'Administrator approval was not given, so nothing was changed.'
          : `Windows did not report a result (exit code ${r.code}). Check Disk Management before trying again. ${r.stderr.trim().split(/\r?\n/)[0] || ''}`.trim());
        e.code = declined ? 'DECLINED' : 'NO_RESULT';
        throw e;
      }
      if (!result.ok) {
        const e = new Error(result.error || 'The partition could not be created.');
        e.code = result.code || 'ERROR';
        if (result.maxBytes != null) e.maxBytes = Number(result.maxBytes);
        if (result.driveLetter) e.driveLetter = result.driveLetter;
        throw e;
      }
      this.log(`partition: created ${result.driveLetter}: (${Math.round(result.sizeBytes / GB)} GB)`);
      return result;
    } finally {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/**
 * Stand-in used for development and UI tests (WIKIVAULT_PARTITION_SIM points at
 * a JSON file describing a pretend drive). It never touches a disk.
 */
class SimulatedPartitionTool {
  constructor(file) { this.file = file; this.created = null; }
  _read() { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
  async analyze(driveLetter) {
    const s = this._read();
    return {
      ok: true, mode: 'analyze', driveLetter, diskNumber: 0, partitionStyle: 'GPT',
      partitionSize: s.partitionSize, sizeMin: s.sizeMin ?? null, sizeMax: s.partitionSize,
      volumeSize: s.volumeSize, volumeFree: s.volumeFree, fileSystem: 'NTFS', largestFreeExtent: 0,
      bitLocker: s.bitLocker || 'Unknown', freeLetter: 'W', elevated: false,
    };
  }
  async create(driveLetter, sizeBytes) {
    const s = this._read();
    await new Promise((r) => setTimeout(r, s.delayMs ?? 600));
    if (s.shrinkLimit != null && sizeBytes > s.shrinkLimit) {
      const e = new Error(`Windows can shrink drive ${driveLetter}: by at most ${Math.floor(s.shrinkLimit / GB)} GB right now, because some system files cannot be moved.`);
      e.code = 'TOO_LARGE'; e.maxBytes = s.shrinkLimit;
      throw e;
    }
    fs.mkdirSync(s.mountAt, { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify({ ...s, merged: false, lastCreate: { driveLetter, sizeBytes } }));
    return { ok: true, mode: 'create', driveLetter: 'W', sizeBytes, label: 'Wikivault', shrunk: true, sourceLetter: driveLetter, mountAt: s.mountAt };
  }
  _leftovers(s) {
    const out = [];
    const walk = (dir, rel) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const r = rel ? `${rel}\\${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(dir, e.name), r); else out.push(r);
      }
    };
    if (fs.existsSync(s.mountAt)) walk(s.mountAt, '');
    return out;
  }
  async inspect(driveLetter, otherLetter) {
    const s = this._read();
    if (!s.lastCreate || s.merged || !fs.existsSync(s.mountAt)) return { ok: true, mode: 'inspect', exists: false, otherLetter, driveLetter };
    const leftovers = this._leftovers(s);
    const problems = leftovers.length ? [`Drive ${otherLetter}: still contains ${leftovers.length} item(s) that would be lost: ${leftovers.slice(0, 5).join(', ')}.`] : [];
    return {
      ok: true, mode: 'inspect', exists: true, otherLetter, driveLetter, label: 'Wikivault',
      otherSize: s.lastCreate.sizeBytes, partitionSize: s.partitionSize - s.lastCreate.sizeBytes, volumeFree: s.volumeFree - s.lastCreate.sizeBytes,
      leftovers, problems, mergeable: problems.length === 0,
    };
  }
  async merge(driveLetter, otherLetter) {
    const s = this._read();
    await new Promise((r) => setTimeout(r, s.delayMs ?? 600));
    const info = await this.inspect(driveLetter, otherLetter);
    if (!info.exists) throw new Error(`Drive ${otherLetter}: was not found.`);
    if (!info.mergeable) { const e = new Error(`Nothing was changed. ${info.problems.join(' ')}`); e.code = 'NOT_SAFE'; e.problems = info.problems; throw e; }
    fs.rmSync(s.mountAt, { recursive: true, force: true });
    fs.writeFileSync(this.file, JSON.stringify({ ...s, merged: true }));
    return { ok: true, mode: 'merge', removedLetter: otherLetter, removedBytes: s.lastCreate.sizeBytes, extended: true, sourceLetter: driveLetter, sourceSizeBefore: s.partitionSize - s.lastCreate.sizeBytes, sourceSizeAfter: s.partitionSize };
  }
}

module.exports = {
  PartitionTool, SimulatedPartitionTool, sizePlan, capPlan,
  GB, FALLBACK_EDITION_BYTES, WINDOWS_RESERVE_BYTES, SCRIPT_SOURCE,
};
