'use strict';
// Lists what is inside a .zim file by reading its directory: each entry's path, title and kind. The contents
// themselves are compressed and are left to the reader engine; this only finds what is there, which the engine
// has no way to be asked. Used to find the PDF documents in a library that is a copy of a web site.

const fsp = require('node:fs/promises');

const MAGIC = 0x044D495A;

/**
 * @param {string} file
 * @param {(mime:string) => boolean} [want]  which kinds of entry to return; all of them when left out
 * @returns {Promise<Array<{path:string,title:string,mime:string,ns:string}>>}
 */
async function listZim(file, want = () => true, { limit = 200000 } = {}) {
  const fh = await fsp.open(file, 'r');
  try {
    const size = (await fh.stat()).size;
    const head = Buffer.alloc(80);
    await fh.read(head, 0, 80, 0);
    if (head.readUInt32LE(0) !== MAGIC) throw new Error('Not a .zim file.');
    const count = head.readUInt32LE(24);
    const pathPtrPos = Number(head.readBigUInt64LE(32));
    const mimeListPos = Number(head.readBigUInt64LE(56));
    if (pathPtrPos + count * 8 > size || mimeListPos > size) throw new Error('The .zim file is cut short or damaged.');

    // The kinds of content, as a list of names each ended by a zero byte; an empty name ends the list.
    const mimes = [];
    const mbuf = Buffer.alloc(Math.min(16384, size - mimeListPos));
    await fh.read(mbuf, 0, mbuf.length, mimeListPos);
    for (let i = 0; i < mbuf.length;) { const z = mbuf.indexOf(0, i); if (z < 0 || z === i) break; mimes.push(mbuf.toString('utf8', i, z)); i = z + 1; }
    const wanted = new Set(mimes.map((m, i) => (want(m) ? i : -1)).filter((i) => i >= 0));

    const ptrs = Buffer.alloc(count * 8);
    await fh.read(ptrs, 0, ptrs.length, pathPtrPos);
    const offsets = new Array(count);
    for (let i = 0; i < count; i += 1) offsets[i] = Number(ptrs.readBigUInt64LE(i * 8));
    offsets.sort((a, b) => a - b); // entries are read in the order they lie in the file, a large piece at a time

    const out = [];
    const WINDOW = 4 * 1024 * 1024;
    let buf = Buffer.alloc(0); let at = 0;
    for (const off of offsets) {
      if (off < at || off + 4096 > at + buf.length) {
        const len = Math.min(WINDOW, size - off);
        if (len < 12) continue;
        buf = Buffer.alloc(len); at = off;
        await fh.read(buf, 0, len, off);
      }
      const p = off - at;
      const mime = buf.readUInt16LE(p);
      if (mime >= 0xFFFD || !wanted.has(mime)) continue; // a redirect, or a kind that is not wanted
      const start = p + 16;
      const z1 = buf.indexOf(0, start); if (z1 < 0) continue;
      const z2 = buf.indexOf(0, z1 + 1); if (z2 < 0) continue;
      const path = buf.toString('utf8', start, z1);
      out.push({ path, title: buf.toString('utf8', z1 + 1, z2) || path, mime: mimes[mime], ns: String.fromCharCode(buf[p + 3]) });
      if (out.length >= limit) break;
    }
    return out;
  } finally { await fh.close(); }
}

module.exports = { listZim };
