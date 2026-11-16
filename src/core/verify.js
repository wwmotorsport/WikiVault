'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const { abortError } = require('./httpx');

/** Streaming SHA-256 of a file. Reports progress about twice a second. */
function sha256File(file, { signal, onProgress = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file, { highWaterMark: 4 * 1024 * 1024 });
    let done = 0;
    let last = 0;
    const onAbort = () => stream.destroy(abortError(signal));
    signal?.addEventListener('abort', onAbort, { once: true });
    stream.on('data', (chunk) => {
      hash.update(chunk);
      done += chunk.length;
      const now = Date.now();
      if (now - last > 500) { last = now; onProgress(done); }
    });
    stream.on('error', (err) => { signal?.removeEventListener('abort', onAbort); reject(err); });
    stream.on('end', () => {
      signal?.removeEventListener('abort', onAbort);
      onProgress(done);
      resolve(hash.digest('hex'));
    });
  });
}

/** ZIM files start with the magic number 0x044D495A, stored little-endian: 5A 49 4D 04. */
async function looksLikeZim(file) {
  let fh;
  try {
    fh = await fsp.open(file, 'r');
    const buf = Buffer.alloc(4);
    const { bytesRead } = await fh.read(buf, 0, 4, 0);
    return bytesRead === 4 && buf[0] === 0x5a && buf[1] === 0x49 && buf[2] === 0x4d && buf[3] === 0x04;
  } catch {
    return false;
  } finally {
    await fh?.close();
  }
}

module.exports = { sha256File, looksLikeZim };
