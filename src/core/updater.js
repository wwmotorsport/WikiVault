'use strict';
// Keeps one verified Wikipedia edition on disk and replaces it when a newer
// one is published. The order is deliberate and never changes:
//   download to a .part file → SHA-256 against the published hash → trial-open
//   with the engine → switch the app over → only then delete the old edition.
//
// Staged updates (settings.stagingDir set, used with a small dedicated
// partition): the new edition is downloaded and verified on another drive, the
// app switches to that verified copy, and only then is the old edition deleted
// and the new one copied into the library, re-verified, and the staging copy
// removed. A verified edition is being served at every moment.

const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const catalog = require('./catalog');
const { downloadParallel, partialBytes, removePartial } = require('./downloader');
const mirrorList = require('./mirrors');
const { sha256File, looksLikeZim } = require('./verify');
const { abortError } = require('./httpx');

const GB = 1024 ** 3;

async function exists(p) { try { await fsp.access(p); return true; } catch { return false; } }

async function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
  await fsp.rename(tmp, file);
}

async function freeBytes(dir) {
  try {
    const s = await fsp.statfs(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch { return null; }
}

/** Copy a large file, continuing from where an interrupted copy stopped, and flush it to disk. */
async function copyResumable(src, dest, { signal, onProgress = () => {} } = {}) {
  const total = (await fsp.stat(src)).size;
  let pos = 0;
  try { pos = (await fsp.stat(dest)).size; } catch { /* fresh copy */ }
  if (pos > total) pos = 0;
  const out = await fsp.open(dest, pos > 0 ? 'r+' : 'w');
  try {
    if (pos < total) {
      let last = 0;
      const input = fs.createReadStream(src, { start: pos, highWaterMark: 4 * 1024 * 1024 });
      for await (const chunk of input) {
        if (signal?.aborted) throw abortError(signal);
        await out.write(chunk, 0, chunk.length, pos);
        pos += chunk.length;
        const now = Date.now();
        if (now - last > 500) { last = now; onProgress(pos, total); }
      }
    }
    await out.sync();
    onProgress(pos, total);
  } finally {
    await out.close();
  }
  return total;
}

function dateFromFile(file) {
  return (/(\d{4}-\d{2})\.zim$/i.exec(file || '') || [])[1] || null;
}

class EditionManager extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.dataDir
   * @param {() => object} o.getSettings  returns { baseUrl, language, flavour, autoUpdate, checkIntervalHours }
   * @param {(zimPath:string) => Promise<{ok:boolean,error?:string}>} o.probe  trial-open a file with the engine
   * @param {(zimPath:string) => Promise<void>} o.activate  point the running app at the file
   * @param {() => Promise<void>} [o.releaseFiles]  called before old files are deleted
   */
  constructor({ dataDir, getSettings, probe, activate, releaseFiles, log = () => {}, now = () => Date.now(), freeBytes: freeFn = freeBytes }) {
    super();
    this.dataDir = dataDir;
    this.zimDir = path.join(dataDir, 'zim');
    this.partDir = path.join(dataDir, 'downloads');
    this.stateFile = path.join(dataDir, 'state.json');
    this.getSettings = getSettings;
    this.probe = probe;
    this.activate = activate;
    this.releaseFiles = releaseFiles || (async () => {});
    this.log = log;
    this.now = now;
    this.freeBytesFn = freeFn;
    this.saved = { active: null, pending: null, relocating: null, lastCheck: null, lastCheckOk: null, latest: null };
    this.phase = 'idle'; // idle | checking | downloading | paused | verifying | switching | moving | error
    this.progress = null;
    this.error = null;
    this.abort = null;
    this.running = null;
    this.timer = null;
    this.errorAt = 0;
  }

  // ---- state -------------------------------------------------------------

  snapshot() {
    const s = this.saved;
    const interval = (this.getSettings().checkIntervalHours || 24) * 3600e3;
    return {
      phase: this.phase,
      active: s.active,
      pending: s.pending,
      latest: s.latest,
      lastCheck: s.lastCheck,
      lastCheckOk: s.lastCheckOk,
      nextCheck: s.lastCheck ? s.lastCheck + interval : null,
      updateAvailable: this.updateAvailable(),
      progress: this.progress,
      error: this.error,
      dataDir: this.dataDir,
      stagingDir: this.stagingDir(),
      relocating: Boolean(s.relocating),
    };
  }

  /** Where staged updates are downloaded, or null when updates are downloaded inside the library folder. */
  stagingDir() { return this.getSettings().stagingDir || null; }

  updateAvailable() {
    const { active, latest } = this.saved;
    if (!latest) return false;
    if (!active) return true;
    if (!active.date) return active.file !== latest.file;
    // A different kind of the same library (with or without images, say) is wanted whatever its date.
    if (kindOf(active.file) !== kindOf(latest.file)) return true;
    return latest.date > active.date;
  }

  /** Forget what the server last offered, so the next check asks again. Used when the wanted kind changes. */
  async forgetLatest() { this.saved.latest = null; await this._save(); this.emit('change', this.snapshot()); }

  _set(phase, patch = {}) {
    this.phase = phase;
    if ('progress' in patch) this.progress = patch.progress;
    if ('error' in patch) this.error = patch.error;
    this.emit('change', this.snapshot());
  }

  async _save() {
    await fsp.mkdir(this.dataDir, { recursive: true });
    await writeJsonAtomic(this.stateFile, this.saved);
  }

  async init() {
    await fsp.mkdir(this.zimDir, { recursive: true });
    await fsp.mkdir(this.partDir, { recursive: true });
    try {
      this.saved = { ...this.saved, ...JSON.parse(await fsp.readFile(this.stateFile, 'utf8')) };
    } catch { /* first run */ }

    if (this.stagingDir()) await fsp.mkdir(this.stagingDir(), { recursive: true }).catch(() => {});
    if (this.saved.relocating) {
      // The app stopped while moving a staged edition into the library.
      const r = this.saved.relocating;
      if (this.saved.active?.path === r.finalPath && (await exists(r.finalPath))) {
        await fsp.rm(r.stagedPath, { force: true }).catch(() => {});
        this.saved.relocating = null;
      } else if (!(await exists(r.stagedPath))) {
        this.log(`staged edition is missing: ${r.stagedPath}`);
        this.saved.relocating = null;
      } // otherwise the staged copy is still the active edition and the move resumes on the next tick
    }
    if (this.saved.active && !(await exists(this.saved.active.path))) {
      this.log(`active edition is missing on disk: ${this.saved.active.path}`);
      this.saved.active = null;
    }
    if (this.saved.pending && this.saved.pending.partPath) {
      const p = this.saved.pending;
      p.downloaded = (await exists(p.partPath)) ? await partialBytes(p.partPath) : 0;
      this.phase = 'paused';
      this.progress = { downloaded: p.downloaded, total: p.size, bytesPerSec: 0 };
    }
    await this._save();
    this.emit('change', this.snapshot());
    return this.snapshot();
  }

  // ---- checking ----------------------------------------------------------

  /** Ask the download server for the newest edition. Never throws for network trouble. */
  async check() {
    if (this.phase === 'checking') return this.snapshot();
    const busy = ['downloading', 'verifying', 'switching', 'moving'].includes(this.phase);
    const prev = this.phase;
    if (!busy) this._set('checking', { error: null });
    try {
      const s = this.getSettings();
      const latest = await catalog.findLatestEdition({ baseUrl: s.baseUrl, project: s.project, language: s.language, flavour: s.flavour });
      this.saved.latest = latest;
      this.saved.lastCheck = this.now();
      this.saved.lastCheckOk = this.now();
      await this._save();
      if (!busy) this._set(prev === 'checking' || prev === 'error' ? 'idle' : prev);
    } catch (err) {
      this.saved.lastCheck = this.now();
      await this._save();
      this.log(`check failed: ${err.message}`);
      if (!busy) {
        const offline = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|ETIMEDOUT|Timed out|ECONNRESET/i.test(err.message);
        this._set(prev === 'paused' ? 'paused' : 'idle', {
          error: this.saved.active
            ? null // an existing library keeps working; the next scheduled check will retry
            : (offline ? 'Could not reach the Kiwix download server. Check the internet connection and try again.' : err.message),
        });
      }
    }
    return this.snapshot();
  }

  /** Begin the daily check. Downloads start on their own only when autoUpdate is on and a library already exists. */
  startSchedule() {
    this.stopSchedule();
    const tick = async () => {
      const s = this.getSettings();
      const interval = (s.checkIntervalHours || 24) * 3600e3;
      const due = !this.saved.lastCheck || this.now() - this.saved.lastCheck >= interval;
      if (['downloading', 'verifying', 'switching', 'moving', 'checking'].includes(this.phase)) return;
      if (this.phase === 'error' && this.now() - (this.errorAt || 0) < 6 * 3600e3) return;
      if (due && this.saved.active) await this.check();
      // An interrupted download (network loss, app closed) resumes by itself; one the user paused does not.
      const resumable = this.phase === 'paused' && this.saved.pending && !this.saved.pending.userPaused;
      const wanted = s.autoUpdate && this.saved.active && this.updateAvailable();
      if (resumable || wanted || this.saved.relocating) this.update().catch(() => {});
    };
    this.timer = setInterval(() => tick().catch((e) => this.log(`schedule: ${e.message}`)), 15 * 60 * 1000);
    this.timer.unref?.();
    setTimeout(() => tick().catch((e) => this.log(`schedule: ${e.message}`)), 5000).unref?.();
  }

  stopSchedule() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  // ---- download / verify / switch ---------------------------------------

  /** Download the newest edition (or resume it), verify it, switch to it, remove the old one. */
  update() {
    if (this.running) return this.running;
    this.running = this._update()
      .catch(async (err) => {
        if (err.name === 'AbortError') return;
        this.log(`update failed: ${err.stack || err.message}`);
        if (err.status === 404 && this.saved.pending) {
          // The server no longer has that edition (a newer one replaced it): forget it and look again next time.
          await removePartial(this.saved.pending.partPath).catch(() => {});
          this.saved.pending = null;
          this.saved.latest = null;
          await this._save().catch(() => {});
        }
        const phase = err.retryLater && this.saved.pending ? 'paused' : 'error';
        this.errorAt = this.now();
        this._set(phase, { error: err.message });
      })
      .finally(() => { this.running = null; this.abort = null; });
    return this.running;
  }

  async _update() {
    this.abort = new AbortController();
    const { signal } = this.abort;
    const s = this.getSettings();
    this.error = null;

    // A staged edition that is verified and in use, but not yet moved into the library, is finished first.
    if (this.saved.relocating) { await this._relocate(signal); return; }

    // 1. Decide what to fetch. A half-finished download is resumed unless a newer edition has appeared.
    let pending = this.saved.pending;
    if (!this.saved.latest || !pending) {
      this._set('checking', { error: null });
      this.saved.latest = await catalog.findLatestEdition({ baseUrl: s.baseUrl, project: s.project, language: s.language, flavour: s.flavour, signal });
      this.saved.lastCheck = this.saved.lastCheckOk = this.now();
    }
    const latest = this.saved.latest;
    if (pending && latest && pending.file !== latest.file && latest.date > (pending.date || '')) {
      await removePartial(pending.partPath);
      pending = null;
    }
    if (!pending) {
      if (this.saved.active && this.saved.active.file === latest.file) { this._set('idle'); return; }
      // With an edition already in place and a staging folder configured, download beside it on
      // the other drive. A first download has nothing to protect, so it goes straight into the library.
      const staged = Boolean(this.stagingDir() && this.saved.active);
      const dir = staged ? this.stagingDir() : this.partDir;
      await fsp.mkdir(dir, { recursive: true });
      pending = {
        file: latest.file, url: latest.url, date: latest.date,
        partPath: path.join(dir, `${latest.file}.part`),
        size: null, sha256: null, downloaded: 0, staged,
      };
    }
    pending.userPaused = false;
    this.saved.pending = pending;
    this._set('downloading', { progress: { downloaded: pending.downloaded || 0, total: pending.size, bytesPerSec: 0 } });

    if (!pending.sha256) pending.sha256 = await catalog.fetchPublishedSha256(pending.url, { signal });
    if (!pending.size) pending.size = await catalog.fetchRemoteSize(pending.url, { signal });
    await this._save();
    if (!pending.sha256) {
      const e = new Error('The download server did not publish a checksum for this edition, so it cannot be verified. Nothing was changed.');
      e.retryLater = true;
      throw e;
    }

    // 2. Room for the new edition alongside the old one.
    const have = (await exists(pending.partPath)) ? await partialBytes(pending.partPath) : 0;
    const partDir = path.dirname(pending.partPath);
    const free = await this.freeBytesFn(partDir);
    if (pending.size && free != null) {
      // A staged download borrows space from the Windows drive, so leave it more breathing room.
      const need = pending.size - have + (pending.staged ? 10 : 2) * GB;
      if (free < need) {
        throw new Error(pending.staged
          ? `The update needs ${(need / GB).toFixed(0)} GB free in ${partDir} while it is downloaded and checked, and only ${(free / GB).toFixed(0)} GB is free there. Your current edition is untouched; the update will be tried again once there is room.`
          : `Not enough free space: this edition needs ${(need / GB).toFixed(0)} GB more, and ${(free / GB).toFixed(0)} GB is free on that drive.`);
      }
    }
    if (pending.staged && pending.size) {
      const room = await this.freeBytesFn(this.zimDir);
      const reclaim = await this._libraryBytes();
      if (room != null && room + reclaim < pending.size + GB) {
        throw new Error(`The new edition is ${(pending.size / GB).toFixed(0)} GB, which no longer fits in the library's partition (${((room + reclaim) / GB).toFixed(0)} GB usable). Your current edition is untouched. Enlarge the partition, or move the library to a folder.`);
      }
    }

    // 3. Download.
    let lastSave = 0;
    // Several connections, to the fastest mirrors Kiwix lists for this file. After a download that
    // failed its checksum, the same edition is fetched the plain way, in case one mirror is bad.
    const plain = this.saved.plainRetry === pending.file;
    const connections = plain ? 1 : Math.max(1, Math.min(16, Number(s.downloadConnections) || 8));
    let mirrors = [];
    if (connections > 1 && pending.size) {
      this.progress = { ...this.progress, note: 'Finding the fastest mirrors' };
      this.emit('change', this.snapshot());
      try {
        mirrors = await mirrorList.rankMirrors(await mirrorList.listMirrors(pending.url, { signal }), { signal });
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        this.log(`mirror list unavailable: ${err.message}`);
      }
      this.log(mirrors.length
        ? `mirrors, fastest first: ${mirrors.map((m) => `${new URL(m.url).host} ${(m.bytesPerSec / 1048576).toFixed(1)} MB/s`).join(', ')}`
        : 'no mirror list; using the main download address');
    }
    const result = await downloadParallel({
      url: pending.url, mirrors, dest: pending.partPath, expectedSize: pending.size, signal, connections,
      log: this.log,
      onProgress: (p) => {
        pending.downloaded = p.downloaded;
        this.progress = {
          downloaded: p.downloaded, total: p.total ?? pending.size, bytesPerSec: p.bytesPerSec,
          retrying: p.state === 'retrying' ? p.message : null,
          connections: p.connections || 0, mirrors: p.mirrors || 0,
        };
        this.emit('change', this.snapshot());
        if (this.now() - lastSave > 30000) { lastSave = this.now(); this._save().catch(() => {}); }
      },
    });
    if (result?.sources?.length) this.log(`download finished; average per connection: ${result.sources.map((x) => `${x.host} ${(x.bytesPerSec / 1048576).toFixed(1)} MB/s`).join(', ')}`);

    // 4. Verify the bytes.
    const size = (await fsp.stat(pending.partPath)).size;
    this._set('verifying', { progress: { verified: 0, total: size } });
    const actual = await sha256File(pending.partPath, {
      signal,
      onProgress: (n) => { this.progress = { verified: n, total: size }; this.emit('change', this.snapshot()); },
    });
    if (actual !== pending.sha256) {
      await removePartial(pending.partPath);
      this.saved.plainRetry = pending.file;
      this.saved.pending = null;
      await this._save();
      throw new Error('The downloaded edition did not match its published checksum, so it was discarded. Your current edition is untouched. Start the download again to retry.');
    }
    this.saved.plainRetry = null;
    if (!(await looksLikeZim(pending.partPath))) {
      await removePartial(pending.partPath);
      this.saved.pending = null;
      await this._save();
      throw new Error('The downloaded file is not a valid Wikipedia archive. Your current edition is untouched.');
    }

    if (pending.staged) { await this._adoptStaged(pending, actual, size, signal); return; }

    // 5. Move into place and trial-open it while the old edition is still being served.
    this._set('switching', { progress: null });
    const finalPath = path.join(this.zimDir, pending.file);
    await fsp.rm(finalPath, { force: true });
    await fsp.rename(pending.partPath, finalPath);
    const trial = await this.probe(finalPath);
    if (!trial.ok) {
      await fsp.rm(finalPath, { force: true });
      this.saved.pending = null;
      await this._save();
      throw new Error(`The new edition passed its checksum but the reader could not open it (${trial.error}). Your current edition is untouched.`);
    }

    // 6. Switch over, then remove what it replaces.
    const previous = this.saved.active;
    this.saved.active = {
      file: pending.file, path: finalPath, date: pending.date, bytes: size,
      sha256: actual, verifiedAt: this.now(), source: pending.url, managed: true,
    };
    this.saved.pending = null;
    await this._save();
    await this.activate(finalPath);
    await this._removeOldEditions(previous);
    this._set('idle', { progress: null, error: null });
    this.emit('updated', this.saved.active);
  }

  /** Total size of the edition files currently in the library folder. */
  async _libraryBytes() {
    let sum = 0;
    for (const name of await fsp.readdir(this.zimDir).catch(() => [])) {
      if (!/\.zim(\.copying)?$/i.test(name)) continue;
      try { sum += (await fsp.stat(path.join(this.zimDir, name))).size; } catch { /* vanished */ }
    }
    return sum;
  }

  /**
   * Staged update, part one: the verified download becomes the edition in use,
   * straight from the staging folder. Nothing in the library has been touched yet.
   */
  async _adoptStaged(pending, sha256, size, signal) {
    this._set('switching', { progress: null });
    const stagedPath = path.join(path.dirname(pending.partPath), pending.file);
    await fsp.rm(stagedPath, { force: true });
    await fsp.rename(pending.partPath, stagedPath);
    const trial = await this.probe(stagedPath);
    if (!trial.ok) {
      await fsp.rm(stagedPath, { force: true });
      this.saved.pending = null;
      await this._save();
      throw new Error(`The new edition passed its checksum but the reader could not open it (${trial.error}). Your current edition is untouched.`);
    }
    this.saved.relocating = {
      file: pending.file, stagedPath, finalPath: path.join(this.zimDir, pending.file),
      sha256, bytes: size, date: pending.date,
    };
    this.saved.active = {
      file: pending.file, path: stagedPath, date: pending.date, bytes: size,
      sha256, verifiedAt: this.now(), source: pending.url, managed: true, staged: true,
    };
    this.saved.pending = null;
    await this._save();
    await this.activate(stagedPath);
    await this._relocate(signal);
  }

  /**
   * Staged update, part two: with the app running from the staged copy, clear the
   * old edition out of the library, copy the new one in, check the copy against the
   * same checksum, switch to it, and delete the staged copy. Safe to re-run after
   * an interruption.
   */
  async _relocate(signal) {
    const r = this.saved.relocating;
    const tmp = `${r.finalPath}.copying`;
    const report = (moved) => { this.progress = { moved, total: r.bytes }; this.emit('change', this.snapshot()); };
    this._set('moving', { progress: { moved: 0, total: r.bytes }, error: null });

    // The staged copy is the edition in use, so every other edition file in the library can go.
    for (const name of await fsp.readdir(this.zimDir).catch(() => [])) {
      const p = path.join(this.zimDir, name);
      if (p === r.finalPath || p === tmp || !/\.zim(\.copying)?$/i.test(name)) continue;
      await fsp.rm(p, { force: true, maxRetries: 10, retryDelay: 500 });
      this.log(`removed ${p}`);
    }
    for (const name of await fsp.readdir(this.partDir).catch(() => [])) await fsp.rm(path.join(this.partDir, name), { force: true }).catch(() => {});

    for (let attempt = 1; ; attempt++) {
      if (!(await exists(r.finalPath))) {
        const have = (await exists(tmp)) ? (await fsp.stat(tmp)).size : 0;
        const room = await this.freeBytesFn(this.zimDir);
        if (room != null && room < r.bytes - have) {
          throw new Error(`The library's partition has ${(room / GB).toFixed(0)} GB free, which is not enough for this ${(r.bytes / GB).toFixed(0)} GB edition. Wikipedia keeps working from the verified copy in ${path.dirname(r.stagedPath)} until there is room.`);
        }
        await copyResumable(r.stagedPath, tmp, { signal, onProgress: report });
        await fsp.rename(tmp, r.finalPath);
      }
      this._set('verifying', { progress: { verified: 0, total: r.bytes, copy: true } });
      const sum = await sha256File(r.finalPath, {
        signal,
        onProgress: (n) => { this.progress = { verified: n, total: r.bytes, copy: true }; this.emit('change', this.snapshot()); },
      });
      if (sum === r.sha256) break;
      await fsp.rm(r.finalPath, { force: true });
      this.log(`copy in the library did not match its checksum (attempt ${attempt})`);
      if (attempt >= 2) {
        throw new Error(`The copy made in the library's partition did not match the checksum, twice. Wikipedia keeps working from the verified copy in ${path.dirname(r.stagedPath)}. The drive may have a fault; check it before trying again.`);
      }
      this._set('moving', { progress: { moved: 0, total: r.bytes } });
    }

    this._set('switching', { progress: null });
    this.saved.active = { ...this.saved.active, path: r.finalPath, staged: false, verifiedAt: this.now() };
    this.saved.relocating = null;
    await this._save();
    await this.activate(r.finalPath);
    await fsp.rm(r.stagedPath, { force: true, maxRetries: 10, retryDelay: 500 }).catch((err) => this.log(`could not remove ${r.stagedPath}: ${err.message}`));
    this._set('idle', { progress: null, error: null });
    this.emit('updated', this.saved.active);
  }

  async _removeOldEditions(previous) {
    const keep = this.saved.active?.path;
    const targets = new Set();
    if (previous?.managed && previous.path !== keep) targets.add(previous.path);
    for (const name of await fsp.readdir(this.zimDir).catch(() => [])) {
      const p = path.join(this.zimDir, name);
      if (p !== keep && /\.zim$/i.test(name)) targets.add(p);
    }
    for (const name of await fsp.readdir(this.partDir).catch(() => [])) targets.add(path.join(this.partDir, name));
    if (!targets.size) return;
    await this.releaseFiles();
    for (const p of targets) {
      try {
        await fsp.rm(p, { force: true, maxRetries: 10, retryDelay: 500 });
        this.log(`removed ${p}`);
      } catch (err) {
        this.log(`could not remove ${p}: ${err.message}`);
      }
    }
  }

  /** Stop the transfer but keep what has been downloaded so far. */
  async pause() {
    if (this.phase !== 'downloading' && this.phase !== 'verifying') return;
    if (this.saved.relocating) return; // the move into the library finishes on its own
    if (this.saved.pending) this.saved.pending.userPaused = true;
    this.abort?.abort('paused');
    await this.running;
    await this._save();
    const p = this.saved.pending;
    this._set('paused', { progress: p ? { downloaded: p.downloaded || 0, total: p.size, bytesPerSec: 0 } : null });
  }

  /** Stop and throw away the partial download. */
  async cancel() {
    if (this.saved.relocating) return; // nothing to cancel: the new edition is already verified and in use
    this.abort?.abort('cancelled');
    await this.running;
    if (this.saved.pending) {
      await removePartial(this.saved.pending.partPath);
      this.saved.pending = null;
      await this._save();
    }
    this._set('idle', { progress: null, error: null });
  }

  /** Adopt a .zim file the user already has. It is used where it is and never deleted by the app. */
  async useLocalFile(file) {
    if (!(await looksLikeZim(file))) throw new Error('That file is not a .zim archive.');
    const trial = await this.probe(file);
    if (!trial.ok) throw new Error(`The reader could not open that file: ${trial.error}`);
    const stat = await fsp.stat(file);
    const inside = path.dirname(path.resolve(file)) === path.resolve(this.zimDir);
    this.saved.active = {
      file: path.basename(file), path: file, date: dateFromFile(file), bytes: stat.size,
      sha256: null, verifiedAt: null, source: 'local file', managed: inside,
    };
    await this._save();
    await this.activate(file);
    this._set('idle', { error: null });
    return this.snapshot();
  }
}

const BUSY_PHASES = ['checking', 'downloading', 'verifying', 'switching', 'moving'];

/**
 * Copy the edition in use into a new library folder and verify the copy.
 * The current library is left exactly as it was: the caller switches the app
 * to the new folder and only then calls removeLibraryFiles() on the old one.
 *
 * @param {object} o
 * @param {EditionManager} o.manager   the library being moved
 * @param {string} o.toDir             new library folder (created if needed)
 * @param {(p:{stage:'copy'|'verify',done:number,total:number})=>void} [o.onProgress]
 */
/** "wikipedia_en_all_nopic_2026-10.zim" -> "wikipedia_en_all_nopic": everything but the date. */
function kindOf(file) { return String(file || '').replace(/_\d{4}-\d{2}\.zim$/i, ''); }

async function copyLibrary({ manager, toDir, signal, onProgress = () => {}, freeBytes: freeFn = freeBytes, now = () => Date.now() }) {
  const active = manager.saved.active;
  if (!active) throw new Error('There is no edition to move yet.');
  if (manager.saved.relocating) throw new Error('An update is still being moved into the library. Let it finish, then try again.');
  if (BUSY_PHASES.includes(manager.phase)) throw new Error('An update is in progress. Pause or finish it, then try again.');

  const from = path.resolve(manager.dataDir);
  const to = path.resolve(toDir);
  if (to === from || to.startsWith(from + path.sep) || from.startsWith(to + path.sep)) {
    throw new Error('Choose a folder that is not inside the current library folder.');
  }
  if (await exists(path.join(to, 'state.json'))) {
    throw new Error('That folder already holds a Wikivault library. Choose a different folder.');
  }
  const zimDir = path.join(to, 'zim');
  await fsp.mkdir(zimDir, { recursive: true });
  await fsp.mkdir(path.join(to, 'downloads'), { recursive: true });

  const total = (await fsp.stat(active.path)).size;
  const finalPath = path.join(zimDir, active.file);
  const tmp = `${finalPath}.copying`;
  const have = (await exists(tmp)) ? (await fsp.stat(tmp)).size : 0;
  const room = await freeFn(to);
  if (room != null && room < total - have + 2 * GB) {
    throw new Error(`The library is ${(total / GB).toFixed(0)} GB and that drive has ${(room / GB).toFixed(0)} GB free. Choose a folder on a drive with more room.`);
  }

  await copyResumable(active.path, tmp, { signal, onProgress: (done) => onProgress({ stage: 'copy', done, total }) });

  // Check the copy against the published checksum; for a file the user supplied, against the original.
  let expected = active.sha256;
  if (!expected) expected = await sha256File(active.path, { signal, onProgress: (done) => onProgress({ stage: 'verify', done: done / 2, total }) });
  const sum = await sha256File(tmp, { signal, onProgress: (done) => onProgress({ stage: 'verify', done: active.sha256 ? done : total / 2 + done / 2, total }) });
  if (sum !== expected) {
    await fsp.rm(tmp, { force: true });
    throw new Error('The copy did not match the checksum, so the library was not moved. The original is untouched.');
  }
  await fsp.rename(tmp, finalPath);

  const record = { ...active, path: finalPath, managed: true, staged: false, sha256: expected, verifiedAt: now() };
  await writeJsonAtomic(path.join(to, 'state.json'), {
    active: record, pending: null, relocating: null,
    lastCheck: manager.saved.lastCheck, lastCheckOk: manager.saved.lastCheckOk, latest: manager.saved.latest,
  });
  return { activePath: finalPath, active: record };
}

/**
 * Remove a library folder's own files: editions, partial downloads and its
 * state file. Anything else in the folder is left alone, and the folders are
 * only removed if that leaves them empty.
 */
async function removeLibraryFiles(dir, { log = () => {} } = {}) {
  const removed = [];
  const rm = async (p) => {
    try { await fsp.rm(p, { force: true, maxRetries: 10, retryDelay: 500 }); removed.push(p); } catch (err) { log(`could not remove ${p}: ${err.message}`); }
  };
  for (const name of await fsp.readdir(path.join(dir, 'zim')).catch(() => [])) {
    if (/\.zim(\.copying)?$/i.test(name)) await rm(path.join(dir, 'zim', name));
  }
  for (const name of await fsp.readdir(path.join(dir, 'downloads')).catch(() => [])) {
    if (/\.part$/i.test(name)) await rm(path.join(dir, 'downloads', name));
  }
  for (const name of ['state.json', 'state.json.tmp']) if (await exists(path.join(dir, name))) await rm(path.join(dir, name));
  for (const sub of ['zim', 'downloads', '']) await fsp.rmdir(path.join(dir, sub)).catch(() => {});
  return removed;
}

module.exports = { EditionManager, dateFromFile, freeBytes, copyResumable, copyLibrary, removeLibraryFiles, kindOf };
