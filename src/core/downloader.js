'use strict';
// Resumable large-file download. Writes to `dest` (normally a .part file) and
// picks up where it left off using HTTP Range requests. Integrity is NOT
// decided here: the caller verifies the SHA-256 of the finished file.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { open, HttpError, abortError } = require('./httpx');

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(abortError(signal));
  const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(t); reject(abortError(signal)); };
  signal?.addEventListener('abort', onAbort, { once: true });
});

async function sizeOf(file) {
  try { return (await fsp.stat(file)).size; } catch { return 0; }
}

function parseContentRange(value) {
  // "bytes 100-999/1000" or "bytes */1000"
  const m = /bytes\s+(?:(\d+)-(\d+)|\*)\/(\d+|\*)/i.exec(value || '');
  if (!m) return null;
  return {
    start: m[1] != null ? Number(m[1]) : null,
    end: m[2] != null ? Number(m[2]) : null,
    total: m[3] === '*' ? null : Number(m[3]),
  };
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * @param {object} o
 * @param {string} o.url
 * @param {string} o.dest             file to write (appended to when resuming)
 * @param {number} [o.expectedSize]   total bytes if known
 * @param {AbortSignal} [o.signal]
 * @param {(p:{downloaded:number,total:number|null,bytesPerSec:number,state:string,message?:string})=>void} [o.onProgress]
 * @param {number} [o.stallMs]        abort a connection that sends nothing for this long
 * @param {number} [o.maxStalledAttempts] consecutive attempts with zero progress before giving up
 * @param {number} [o.baseDelayMs]
 * @returns {Promise<{size:number}>}
 */
async function downloadFile(o) {
  const {
    url, dest, expectedSize = null, signal, onProgress = () => {},
    stallMs = 60000, maxStalledAttempts = 12, baseDelayMs = 2000,
  } = o;

  await fsp.mkdir(path.dirname(dest), { recursive: true });
  let offset = await sizeOf(dest);
  let total = expectedSize;
  let stalled = 0;
  let speed = 0;

  const report = (state, message) => onProgress({ downloaded: offset, total, bytesPerSec: speed, state, message });

  for (;;) {
    if (signal?.aborted) throw abortError(signal);
    if (total != null && offset === total) return { size: offset };
    if (total != null && offset > total) { await fsp.truncate(dest, 0); offset = 0; }

    const before = offset;
    try {
      const headers = offset > 0 ? { Range: `bytes=${offset}-` } : {};
      const { res, url: finalUrl } = await open(url, { headers, signal, timeoutMs: stallMs });

      if (res.statusCode === 416) {
        res.resume();
        const cr = parseContentRange(res.headers['content-range']);
        if (cr?.total != null && cr.total === offset) return { size: offset };
        await fsp.truncate(dest, 0); offset = 0;
        continue;
      }
      if (res.statusCode >= 400) {
        res.resume();
        throw new HttpError(res.statusCode, finalUrl);
      }
      if (res.statusCode === 200 && offset > 0) {
        // Server ignored the Range header: start over rather than corrupt the file.
        await fsp.truncate(dest, 0); offset = 0;
      }
      if (res.statusCode === 206) {
        const cr = parseContentRange(res.headers['content-range']);
        if (cr && cr.start !== offset) {
          res.destroy();
          await fsp.truncate(dest, 0); offset = 0;
          continue;
        }
        if (cr?.total != null) total = total ?? cr.total;
      } else if (res.headers['content-length'] && total == null) {
        total = Number(res.headers['content-length']);
      }

      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(dest, { flags: offset > 0 ? 'a' : 'w' });
        let lastTick = Date.now();
        let lastBytes = offset;
        let finished = false;
        const done = (err, { keepReceived = false } = {}) => {
          if (finished) return; finished = true;
          clearInterval(timer);
          if (!err) return resolve();
          res.destroy();
          // A dropped connection is normal on a transfer this size: flush what
          // arrived so the next attempt resumes from there instead of redoing it.
          if (keepReceived && !out.destroyed) return out.end(() => reject(err));
          out.destroy();
          return reject(err);
        };
        const timer = setInterval(() => {
          const now = Date.now();
          const inst = ((offset - lastBytes) * 1000) / Math.max(1, now - lastTick);
          speed = speed ? speed * 0.7 + inst * 0.3 : inst;
          lastTick = now; lastBytes = offset;
          report('downloading');
        }, 500);
        timer.unref?.();

        res.on('data', (chunk) => {
          offset += chunk.length;
          if (!out.write(chunk)) { res.pause(); out.once('drain', () => res.resume()); }
        });
        res.on('end', () => out.end());
        res.on('aborted', () => done(new Error('Connection dropped'), { keepReceived: true }));
        res.on('error', (err) => done(err, { keepReceived: true }));
        out.on('error', (err) => done(err));
        out.on('finish', () => done());
      });

      offset = await sizeOf(dest);
      if (total != null && offset < total) throw new Error('Connection closed before the file was complete');
      report('downloading');
      if (total == null) return { size: offset };
      // loop: top of the loop returns when offset === total
    } catch (err) {
      if (err.name === 'AbortError' || signal?.aborted) throw abortError(signal);
      offset = await sizeOf(dest);
      const fatal = (err instanceof HttpError && !RETRYABLE_STATUS.has(err.status))
        || err.code === 'ENOSPC' || err.code === 'EACCES' || err.code === 'EPERM';
      if (fatal) throw err;

      stalled = offset > before ? 0 : stalled + 1;
      if (stalled >= maxStalledAttempts) {
        const e = new Error(`Download kept failing without progress: ${err.message}`);
        e.cause = err; e.retryLater = true;
        throw e;
      }
      const delay = Math.min(60000, baseDelayMs * 2 ** Math.min(stalled, 5));
      speed = 0;
      report('retrying', `${err.message}. Trying again in ${Math.round(delay / 1000)}s`);
      await sleep(delay, signal);
    }
  }
}

// ---------------------------------------------------------------------------
// Parallel download
//
// The file is cut into fixed-size chunks. Several connections each fetch one
// chunk at a time with an HTTP Range request and write it at its own offset in
// the destination file. Chunks are handed out in order, so the file fills from
// the front. A small side file records which chunks are complete (and how far
// the unfinished ones got) so an interrupted download carries on, and so a
// download begun by the older one-connection method is continued, not redone.
//
// Each connection picks the source that is currently giving the best speed per
// connection, up to a cap per mirror, and a source that keeps failing is set
// aside. Integrity is still decided by the caller's SHA-256 of the whole file.

const MB = 1024 * 1024;

/** Side file that records chunk progress. Ends in .part so every clean-up that removes partial downloads removes it too. */
function chunkMetaPath(dest) {
  return `${dest.replace(/\.part$/i, '')}.chunks.part`;
}

function readMeta(dest) {
  try { return JSON.parse(fs.readFileSync(chunkMetaPath(dest), 'utf8')); } catch { return null; }
}

/** Bytes of a partial download that are already on disk, whichever method wrote it. */
async function partialBytes(dest) {
  const meta = readMeta(dest);
  if (meta && typeof meta.done === 'string') {
    let sum = 0;
    const n = meta.done.length;
    for (let i = 0; i < n; i++) {
      const len = Math.min(meta.chunkSize, meta.size - i * meta.chunkSize);
      sum += meta.done[i] === '1' ? len : Math.min(len, Number(meta.partial?.[i]) || 0);
    }
    return sum;
  }
  return sizeOf(dest);
}

/** Remove a partial download and its progress record. */
async function removePartial(dest) {
  await fsp.rm(dest, { force: true });
  await fsp.rm(chunkMetaPath(dest), { force: true });
}

/**
 * @param {object} o
 * @param {string} o.url              the file's main URL (used as a source of last resort)
 * @param {Array<{url:string,bytesPerSec?:number}>} [o.mirrors]  direct mirror URLs, best first
 * @param {string} o.dest
 * @param {number} o.expectedSize     required; without it the download falls back to one connection
 * @param {number} [o.connections]    simultaneous connections (default 8)
 * @param {number} [o.maxPerSource]   most connections to any one mirror (default 4)
 * @param {number} [o.chunkSize]
 * @param {(p:object)=>void} [o.onProgress]
 */
async function downloadParallel(o) {
  const {
    url, dest, expectedSize: total, mirrors = [], signal, onProgress = () => {},
    connections = 8, maxPerSource = 4, chunkSize = 32 * MB,
    stallMs = 30000, saveEveryMs = 10000, baseDelayMs = 2000, maxIdleMs = 5 * 60 * 1000,
    log = () => {},
  } = o;
  if (!total || connections <= 1) return downloadFile(o);

  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const metaPath = chunkMetaPath(dest);
  const nChunks = Math.ceil(total / chunkSize);
  const lenOf = (i) => Math.min(chunkSize, total - i * chunkSize);
  const state = new Uint8Array(nChunks);        // 0 waiting, 1 in progress, 2 complete
  const partial = new Float64Array(nChunks);    // bytes already written of an unfinished chunk

  // ---- pick up whatever is already on disk
  const meta = readMeta(dest);
  const have = await sizeOf(dest);
  if (meta && meta.size === total && meta.chunkSize === chunkSize && typeof meta.done === 'string' && meta.done.length === nChunks && have > 0) {
    for (let i = 0; i < nChunks; i++) {
      if (meta.done[i] === '1') state[i] = 2;
      else partial[i] = Math.min(lenOf(i), Number(meta.partial?.[i]) || 0);
    }
  } else if (!meta && have > 0 && have <= total) {
    // Written front-to-back by the one-connection downloader: everything up to its length is good.
    const full = Math.floor(have / chunkSize);
    for (let i = 0; i < full; i++) state[i] = 2;
    if (full < nChunks) partial[full] = have - full * chunkSize;
    if (have === total) state.fill(2);
  } else if (have > 0) {
    await fsp.truncate(dest, 0); // a record that does not match this file: start clean
  }
  await fsp.rm(metaPath, { force: true });

  const fh = await fsp.open(dest, (await sizeOf(dest)) > 0 ? 'r+' : 'w+');

  // Stops every connection at once, whether the caller cancelled or something fatal happened here.
  const inner = new AbortController();
  const onOuterAbort = () => inner.abort(signal.reason);
  if (signal?.aborted) inner.abort(signal.reason); else signal?.addEventListener('abort', onOuterAbort, { once: true });

  // ---- sources
  const sources = mirrors.map((m, rank) => ({
    url: m.url, host: new URL(m.url).host, rank, speed: m.bytesPerSec || 0, active: 0, fails: 0, banned: false, cap: maxPerSource, primary: false,
  }));
  // The main URL redirects to a mirror of the server's choosing. With no mirror list it carries every connection.
  sources.push({ url, host: new URL(url).host, rank: sources.length, speed: 0, active: 0, fails: 0, banned: false, cap: sources.length ? Math.min(2, maxPerSource) : connections, primary: true });

  const pickSource = () => {
    let best = null;
    for (const s of sources) {
      if (s.banned || s.active >= s.cap) continue;
      // Known speed per connection decides. An untried mirror gets one connection to prove itself.
      // The main address is the last resort when mirrors are known: it only redirects to one of them.
      let score = s.speed;
      if (!(score > 0)) score = s.primary && sources.length > 1 ? 1e-6 : (s.active === 0 ? Infinity : 0);
      if (!best || score > best.score || (score === best.score && s.rank < best.s.rank)) best = { s, score };
    }
    return best ? best.s : null;
  };

  let received = 0;            // bytes written in this run
  let lastByteAt = Date.now();
  let lastError = null;
  let fatal = null;
  let noRange = false;
  const doneBytes = () => {
    let sum = 0;
    for (let i = 0; i < nChunks; i++) sum += state[i] === 2 ? lenOf(i) : partial[i];
    return sum;
  };

  const snapshot = () => {
    let done = '';
    const part = {};
    for (let i = 0; i < nChunks; i++) {
      done += state[i] === 2 ? '1' : '0';
      if (state[i] !== 2 && partial[i] > 0) part[i] = partial[i];
    }
    return { version: 1, size: total, chunkSize, done, partial: part };
  };
  let saving = Promise.resolve();
  const save = () => {
    saving = saving.then(async () => {
      const snap = snapshot();     // captured first, flushed second: the record never claims more than is on disk
      await fh.sync();
      const tmp = `${metaPath}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(snap));
      await fsp.rename(tmp, metaPath);
    }).catch((err) => log(`could not save download progress: ${err.message}`));
    return saving;
  };

  let speed = 0;
  let lastTick = Date.now();
  let lastReceived = 0;
  const report = (stateName = 'downloading', message) => {
    const used = sources.filter((s) => s.active > 0);
    onProgress({
      downloaded: doneBytes(), total, bytesPerSec: speed, state: stateName, message,
      connections: used.reduce((n, s) => n + s.active, 0), mirrors: used.length,
    });
  };
  const ticker = setInterval(() => {
    const now = Date.now();
    const inst = ((received - lastReceived) * 1000) / Math.max(1, now - lastTick);
    speed = speed ? speed * 0.7 + inst * 0.3 : inst;
    lastTick = now; lastReceived = received;
    report();
  }, 500);
  const saver = setInterval(save, saveEveryMs);
  ticker.unref?.(); saver.unref?.();

  const takeChunk = () => {
    for (let i = 0; i < nChunks; i++) if (state[i] === 0) { state[i] = 1; return i; }
    return -1;
  };

  async function fetchChunk(i, src) {
    const start = i * chunkSize + partial[i];
    const end = i * chunkSize + lenOf(i) - 1;
    if (start > end) return;
    const began = Date.now();
    let got = 0;
    const { res } = await open(src.url, { headers: { Range: `bytes=${start}-${end}` }, signal: inner.signal, timeoutMs: stallMs });
    if (res.statusCode !== 206) {
      res.destroy();
      const e = new HttpError(res.statusCode, src.url);
      e.sourceUnusable = true;
      if (res.statusCode === 200) e.noRange = true;
      throw e;
    }
    const cr = parseContentRange(res.headers['content-range']);
    if (cr && cr.start !== start) { res.destroy(); const e = new Error('Mirror answered with the wrong byte range'); e.sourceUnusable = true; throw e; }
    if (cr && cr.total != null && cr.total !== total) { res.destroy(); const e = new Error('Mirror has a different version of the file'); e.sourceUnusable = true; throw e; }
    let pos = start;
    for await (const chunk of res) {
      const buf = pos + chunk.length > end + 1 ? chunk.subarray(0, end + 1 - pos) : chunk;
      await fh.write(buf, 0, buf.length, pos);
      pos += buf.length;
      got += buf.length;
      partial[i] = pos - i * chunkSize;
      received += buf.length;
      lastByteAt = Date.now();
      if (pos > end) break;
    }
    if (pos <= end) throw new Error('Connection closed before the chunk was complete');
    const rate = got / Math.max(0.05, (Date.now() - began) / 1000);
    src.speed = src.speed ? src.speed * 0.6 + rate * 0.4 : rate;
  }

  const stopAll = (err) => { if (!fatal) fatal = err; inner.abort('stopped'); };

  async function worker() {
    for (;;) {
      if (inner.signal.aborted) return;
      const i = takeChunk();
      if (i < 0) return;
      const src = pickSource();
      if (!src) { state[i] = 0; await sleep(300, inner.signal).catch(() => {}); continue; }
      src.active += 1;
      try {
        await fetchChunk(i, src);
        state[i] = 2;
        src.fails = 0;
      } catch (err) {
        state[i] = 0; // what was written stays; the next attempt continues from partial[i]
        if (inner.signal.aborted) return;
        if (err.code === 'ENOSPC' || err.code === 'EACCES' || err.code === 'EPERM') { stopAll(err); return; }
        lastError = err;
        src.fails += 1;
        if (err.noRange && sources.length === 1) { noRange = true; stopAll(err); return; }
        const others = sources.some((s) => s !== src && !s.banned);
        if ((err.sourceUnusable || src.fails >= 3) && others) {
          src.banned = true;
          log(`setting aside ${src.host}: ${err.message}`);
        }
        if (Date.now() - lastByteAt > maxIdleMs) {
          const e = new Error(`Download kept failing without progress: ${err.message}`);
          e.cause = err; e.retryLater = true;
          stopAll(e);
          return;
        }
        report('retrying', `${err.message}. Trying again`);
        await sleep(Math.min(30000, baseDelayMs * 2 ** Math.min(src.fails, 4)), inner.signal).catch(() => {});
      } finally {
        src.active -= 1;
      }
    }
  }

  const stopTimers = () => { clearInterval(ticker); clearInterval(saver); signal?.removeEventListener('abort', onOuterAbort); };
  try {
    const room = sources.reduce((n, s) => n + s.cap, 0);
    const n = Math.max(1, Math.min(connections, nChunks, room));
    report();
    // Every connection has stopped by the time this returns, so nothing is still writing below.
    await Promise.all(Array.from({ length: n }, () => worker()));
  } catch (err) {
    stopAll(err);
  }
  stopTimers();

  if (noRange) {
    // The server cannot serve byte ranges, so several connections are no use here.
    await saving;
    await fh.close().catch(() => {});
    await removePartial(dest);
    return downloadFile(o);
  }

  const complete = state.every((v) => v === 2);
  if (signal?.aborted || fatal || !complete) {
    await save();
    await fh.close().catch(() => {});
    if (signal?.aborted) throw abortError(signal);
    if (fatal) throw fatal;
    throw Object.assign(new Error(`Download stopped early: ${lastError?.message || 'unknown reason'}`), { retryLater: true });
  }

  await saving;
  await fh.truncate(total);
  await fh.sync();
  await fh.close();
  await fsp.rm(metaPath, { force: true });
  onProgress({ downloaded: total, total, bytesPerSec: speed, state: 'downloading', connections: 0, mirrors: 0 });
  return { size: total, sources: sources.filter((x) => x.speed > 0).map((x) => ({ host: x.host, bytesPerSec: x.speed })) };
}

module.exports = { downloadFile, downloadParallel, partialBytes, removePartial, chunkMetaPath, parseContentRange, sleep };
