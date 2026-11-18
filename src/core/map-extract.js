'use strict';
// Maps: cutting a region out of a PMTiles file that lives on a web server.
//
// The Protomaps world map is one file of about 140 GB. Nothing here downloads that. The file's index
// says where every tile is, so the index is read for the region wanted, and then only those tiles are
// asked for, with HTTP range requests, and written out as a new, smaller PMTiles file.
//
// measure() walks the index and adds up what each level of detail would take, without fetching tiles.
// plan() + download() do the cutting. No Electron here; the network is whatever `fetch` is given.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const pm = require('./pmtiles');

const BATCH_BYTES = 8 * 1024 * 1024; // one request asks for at most this much
const GAP_BYTES = 32 * 1024;         // bytes not wanted that are cheaper to fetch than to skip
const PARALLEL = 4;

class SourceChanged extends Error {}

/** Reads byte ranges of a file on a web server. */
class RangeSource {
  constructor(url, { fetchImpl = fetch, retries = 4, pause = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    this.url = url; this.fetch = fetchImpl; this.retries = retries; this.pause = pause; this.etag = null; this.bytes = 0;
  }

  async read(offset, length, signal) {
    let lastErr = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (signal && signal.aborted) throw new Error('Stopped.');
      try {
        const res = await this.fetch(this.url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` }, signal, redirect: 'follow' });
        if (res.status === 200 && offset !== 0) throw new Error('The map server does not serve parts of files, so a region cannot be cut from it.');
        if (res.status !== 206 && res.status !== 200) { const e = new Error(`The map server answered ${res.status}.`); e.fatal = res.status === 404 || res.status === 403; throw e; }
        const etag = res.headers.get('etag');
        if (etag) { if (this.etag && this.etag !== etag) throw new SourceChanged('The map file on the server changed during the download. Start again.'); this.etag = etag; }
        const buf = Buffer.from(await res.arrayBuffer());
        // Asking past the end of the file gives what there is: fine for a file smaller than the first read.
        const total = Number((/\/(\d+)$/.exec(res.headers.get('content-range') || '') || [])[1]);
        if (buf.length < length && !(total > 0 && offset + buf.length >= total)) throw new Error('The map server sent less than was asked for.');
        this.bytes += length;
        return buf.length === length ? buf : buf.subarray(0, length);
      } catch (err) {
        if (err instanceof SourceChanged || err.fatal || (signal && signal.aborted)) throw err;
        lastErr = err;
        await this.pause(Math.min(15000, 500 * 2 ** attempt));
      }
    }
    throw lastErr;
  }
}

/** Typed columns that grow. */
class Columns {
  constructor() { this.n = 0; this.cap = 1 << 16; this.ids = new Float64Array(this.cap); this.runs = new Uint32Array(this.cap); this.lengths = new Uint32Array(this.cap); this.offsets = new Float64Array(this.cap); }
  push(id, run, offset, length) {
    if (this.n === this.cap) {
      this.cap *= 2;
      for (const k of ['ids', 'runs', 'lengths', 'offsets']) { const next = new this[k].constructor(this.cap); next.set(this[k]); this[k] = next; }
    }
    this.ids[this.n] = id; this.runs[this.n] = run; this.offsets[this.n] = offset; this.lengths[this.n] = length; this.n += 1;
  }
}

/** All tile-number ranges wanted, for zooms 0..maxZoom, sorted. */
function wantedRanges(rings, maxZoom) {
  const out = [];
  for (let z = 0; z <= maxZoom; z++) out.push(...pm.coverRanges(rings, z));
  return out;
}

/**
 * Walk the index of the source over the wanted ranges. `onTiles(id, run, offset, length)` is called
 * for every run of tiles wanted, in tile-number order. Only the leaf directories that can hold
 * wanted tiles are fetched.
 */
async function walk(source, header, root, ranges, onTiles, { signal, onProgress } = {}) {
  let at = 0; // the first range that ends after the tile being looked at; tile numbers only go up
  const visit = async (dir, upper) => {
    let pending = []; // leaves to fetch, in order
    const flush = async () => {
      // Leaves that sit next to each other in the file are fetched together.
      for (let i = 0; i < pending.length;) {
        let j = i; let end = pending[i].offset + pending[i].length;
        while (j + 1 < pending.length && pending[j + 1].offset <= end + GAP_BYTES && pending[j + 1].offset + pending[j + 1].length - pending[i].offset <= BATCH_BYTES) { j += 1; end = pending[j].offset + pending[j].length; }
        const buf = await source.read(header.leafOffset + pending[i].offset, end - pending[i].offset, signal);
        for (let k = i; k <= j; k++) {
          const p = pending[k];
          const leaf = pm.parseDirectory(buf.subarray(p.offset - pending[i].offset, p.offset - pending[i].offset + p.length), header.internalCompression);
          await visit(leaf, p.upper);
        }
        if (onProgress) onProgress({ indexBytes: source.bytes });
        i = j + 1;
      }
      pending = [];
    };
    for (let i = 0; i < dir.n; i++) {
      const id = dir.ids[i];
      if (dir.runs[i] === 0) {
        const to = i + 1 < dir.n ? dir.ids[i + 1] : upper;
        let k = at;
        while (k < ranges.length && ranges[k][1] <= id) k += 1;
        if (k < ranges.length && ranges[k][0] < to) pending.push({ offset: dir.offsets[i], length: dir.lengths[i], upper: to });
        continue;
      }
      if (pending.length) await flush();
      const end = id + dir.runs[i];
      while (at < ranges.length && ranges[at][1] <= id) at += 1;
      for (let k = at; k < ranges.length && ranges[k][0] < end; k++) {
        const a = Math.max(id, ranges[k][0]); const b = Math.min(end, ranges[k][1]);
        if (b > a) onTiles(a, b - a, dir.offsets[i], dir.lengths[i]);
      }
    }
    if (pending.length) await flush();
  };
  await visit(root, Infinity);
}

async function open(source, signal) {
  const first = await source.read(0, pm.ROOT_BUDGET, signal);
  const header = pm.parseHeader(first);
  if (!header.clustered) throw new Error('This map file is not laid out in a way a region can be cut from.');
  const root = pm.parseDirectory(first.subarray(header.rootOffset, header.rootOffset + header.rootLength), header.internalCompression);
  return { header, root };
}

/**
 * What each level of detail would take for a region: for every zoom, the tiles and the bytes that
 * zoom adds. Tile data shared with an earlier tile is counted once. Fetches the index only.
 */
async function measure(source, rings, { signal, onProgress } = {}) {
  const { header, root } = await open(source, signal);
  const zooms = [];
  for (let z = 0; z <= header.maxZoom; z++) zooms.push({ zoom: z, tiles: 0, bytes: 0 });
  let high = -1; // tile data is laid out in tile order: an offset below the high mark was counted already
  let zoom = 0; let nextBase = pm.zoomBase(1);
  await walk(source, header, root, wantedRanges(rings, header.maxZoom), (id, run, offset, length) => {
    while (id >= nextBase) { zoom += 1; nextBase = pm.zoomBase(zoom + 1); }
    zooms[zoom].tiles += run;
    if (offset > high) { zooms[zoom].bytes += length; high = offset; }
  }, { signal, onProgress });
  let total = 0;
  for (const z of zooms) { total += z.bytes; z.upTo = total; }
  return { zooms: zooms.filter((z) => z.zoom >= header.minZoom), maxZoom: header.maxZoom, indexBytes: source.bytes };
}

/** Everything needed to write the cut: the entries, where their data is now, and where it will go. */
async function plan(source, rings, maxZoom, { signal, onProgress } = {}) {
  const { header, root } = await open(source, signal);
  const top = Math.min(maxZoom, header.maxZoom);
  const cols = new Columns();
  await walk(source, header, root, wantedRanges(rings, top), (id, run, offset, length) => cols.push(id, run, offset, length), { signal, onProgress });
  if (!cols.n) throw new Error('The map file has nothing for that region.');

  // The pieces of tile data wanted, once each, in the order they lie in the source.
  const sorted = Float64Array.from(cols.offsets.subarray(0, cols.n)).sort();
  let u = 0;
  for (let i = 0; i < sorted.length; i++) if (i === 0 || sorted[i] !== sorted[i - 1]) sorted[u++] = sorted[i];
  const oldOffsets = sorted.subarray(0, u);
  const segLengths = new Uint32Array(u);
  const find = (offset) => { let lo = 0; let hi = u - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (oldOffsets[mid] < offset) lo = mid + 1; else hi = mid; } return lo; };
  for (let i = 0; i < cols.n; i++) segLengths[find(cols.offsets[i])] = cols.lengths[i];
  const newOffsets = new Float64Array(u);
  let dataBytes = 0;
  for (let k = 0; k < u; k++) { newOffsets[k] = dataBytes; dataBytes += segLengths[k]; }

  let addressed = 0;
  const out = { n: cols.n, ids: cols.ids.subarray(0, cols.n), runs: cols.runs.subarray(0, cols.n), lengths: cols.lengths.subarray(0, cols.n), offsets: new Float64Array(cols.n) };
  for (let i = 0; i < cols.n; i++) { out.offsets[i] = newOffsets[find(cols.offsets[i])]; addressed += cols.runs[i]; }
  const { root: rootBytes, leaves } = pm.buildDirectories(out);
  const metadata = header.metadataLength ? await source.read(header.metadataOffset, header.metadataLength, signal) : Buffer.alloc(0);

  const lons = rings.flat().map((p) => p[0]); const lats = rings.flat().map((p) => p[1]);
  const bounds = [Math.max(-180, Math.min(...lons)), Math.max(-85, Math.min(...lats)), Math.min(180, Math.max(...lons)), Math.min(85, Math.max(...lats))];
  const rootOffset = pm.HEADER_BYTES;
  const metadataOffset = rootOffset + rootBytes.length;
  const leafOffset = metadataOffset + metadata.length;
  const dataOffset = leafOffset + leaves.length;
  const head = pm.serializeHeader({
    rootOffset, rootLength: rootBytes.length, metadataOffset, metadataLength: metadata.length, leafOffset, leafLength: leaves.length, dataOffset, dataLength: dataBytes,
    addressedTiles: addressed, tileEntries: cols.n, tileContents: u, clustered: true,
    internalCompression: pm.GZIP, tileCompression: header.tileCompression, tileType: header.tileType,
    minZoom: header.minZoom, maxZoom: top, bounds, centerZoom: Math.min(top, Math.max(header.minZoom, 4)), center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
  });

  // Requests: neighbouring pieces are fetched together, small gaps included.
  const batches = [];
  for (let k = 0; k < u;) {
    let j = k; let end = oldOffsets[k] + segLengths[k];
    while (j + 1 < u && oldOffsets[j + 1] <= end + GAP_BYTES && oldOffsets[j + 1] + segLengths[j + 1] - oldOffsets[k] <= BATCH_BYTES) { j += 1; end = oldOffsets[j] + segLengths[j]; }
    batches.push({ from: k, to: j + 1, offset: oldOffsets[k], length: end - oldOffsets[k] });
    k = j + 1;
  }
  const front = Buffer.concat([head, rootBytes, metadata, leaves]);
  const fingerprint = crypto.createHash('sha256').update(`${source.url}|${source.etag || ''}|${top}|${cols.n}|${u}|${dataBytes}|`).update(head).digest('hex');
  return { source: header, front, dataOffset, dataBytes, totalBytes: dataOffset + dataBytes, tiles: addressed, maxZoom: top, batches, oldOffsets, segLengths, newOffsets, fingerprint, indexBytes: source.bytes };
}

/**
 * Fetch the planned tiles into `dest`. Written to `dest.part` and renamed at the end. A download that
 * was stopped carries on from the last request that finished, as long as the plan is the same.
 */
async function download(source, p, dest, { signal, onProgress } = {}) {
  const part = `${dest}.part`;
  const note = `${dest}.part.json`;
  let done = 0; // batches finished, counted from the start with none missing
  try {
    const saved = JSON.parse(await fsp.readFile(note, 'utf8'));
    const st = await fsp.stat(part);
    if (saved.fingerprint === p.fingerprint && st.size >= p.front.length && Number.isInteger(saved.done) && saved.done <= p.batches.length) done = saved.done;
  } catch { /* nothing to carry on from */ }
  const fd = await fsp.open(part, done ? 'r+' : 'w');
  try {
    if (!done) await fd.write(p.front, 0, p.front.length, 0);
    let fetched = 0;
    for (let b = 0; b < done; b++) for (let k = p.batches[b].from; k < p.batches[b].to; k++) fetched += p.segLengths[k];
    const finished = new Set();
    let next = done;
    const report = () => { if (onProgress) onProgress({ downloaded: p.dataOffset + fetched, total: p.totalBytes }); };
    report();
    const worker = async () => {
      for (;;) {
        if (signal && signal.aborted) throw new Error('Stopped.');
        const b = next; next += 1;
        if (b >= p.batches.length) return;
        const batch = p.batches[b];
        const buf = await source.read(p.source.dataOffset + batch.offset, batch.length, signal);
        for (let k = batch.from; k < batch.to; k++) {
          const at = p.oldOffsets[k] - batch.offset;
          await fd.write(buf, at, p.segLengths[k], p.dataOffset + p.newOffsets[k]);
          fetched += p.segLengths[k];
        }
        finished.add(b);
        const before = done;
        while (finished.has(done)) { finished.delete(done); done += 1; }
        if (done !== before && (done % 8 === 0 || done === p.batches.length)) { await fd.datasync(); await fsp.writeFile(note, JSON.stringify({ fingerprint: p.fingerprint, done })); }
        report();
      }
    };
    const results = await Promise.allSettled(Array.from({ length: Math.min(PARALLEL, p.batches.length - done) || 1 }, worker));
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) { await fd.datasync().catch(() => {}); await fsp.writeFile(note, JSON.stringify({ fingerprint: p.fingerprint, done })).catch(() => {}); throw failed.reason; }
    await fd.sync();
  } finally { await fd.close(); }
  const st = await fsp.stat(part);
  if (st.size !== p.totalBytes) throw new Error('The map file came out the wrong size. Download it again.');
  await fsp.rename(part, dest);
  await fsp.rm(note, { force: true });
  return { bytes: p.totalBytes, tiles: p.tiles, fetched: source.bytes };
}

/** Reads tiles of a PMTiles file on disk. Used to check a file after it is written, and by the tests. */
class LocalArchive {
  constructor(file) { this.file = file; this.fd = null; this.header = null; this.root = null; }
  async open() {
    this.fd = await fsp.open(this.file, 'r');
    const first = Buffer.alloc(pm.ROOT_BUDGET);
    const { bytesRead } = await this.fd.read(first, 0, first.length, 0);
    this.header = pm.parseHeader(first.subarray(0, bytesRead));
    this.root = pm.parseDirectory(first.subarray(this.header.rootOffset, this.header.rootOffset + this.header.rootLength), this.header.internalCompression);
    return this;
  }
  async read(offset, length) { const buf = Buffer.alloc(length); await this.fd.read(buf, 0, length, offset); return buf; }
  /** The stored bytes of a tile (still compressed), or null when the file has no such tile. */
  async tile(z, x, y) {
    const id = pm.zxyToId(z, x, y);
    let dir = this.root;
    for (let depth = 0; depth < 4; depth++) {
      let lo = 0; let hi = dir.n - 1; let at = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (dir.ids[mid] <= id) { at = mid; lo = mid + 1; } else hi = mid - 1; }
      if (at < 0) return null;
      if (dir.runs[at] === 0) { dir = pm.parseDirectory(await this.read(this.header.leafOffset + dir.offsets[at], dir.lengths[at]), this.header.internalCompression); continue; }
      if (id >= dir.ids[at] + dir.runs[at]) return null;
      return this.read(this.header.dataOffset + dir.offsets[at], dir.lengths[at]);
    }
    return null;
  }
  async metadata() { const h = this.header; if (!h.metadataLength) return {}; const raw = await this.read(h.metadataOffset, h.metadataLength); return JSON.parse((h.internalCompression === pm.GZIP ? require('node:zlib').gunzipSync(raw) : raw).toString('utf8')); }
  async close() { if (this.fd) await this.fd.close(); this.fd = null; }
}

/** Open a finished file and read one tile from it: enough to know the cut is usable. */
async function check(file) {
  const a = await new LocalArchive(file).open();
  try {
    const st = fs.statSync(file);
    if (st.size !== a.header.dataOffset + a.header.dataLength) throw new Error('The map file is not complete.');
    if (!(await a.tile(0, 0, 0)) && a.header.minZoom === 0) throw new Error('The map file cannot be read.');
    return { bytes: st.size, minZoom: a.header.minZoom, maxZoom: a.header.maxZoom, bounds: a.header.bounds, tiles: a.header.addressedTiles };
  } finally { await a.close(); }
}

module.exports = { RangeSource, measure, plan, download, check, LocalArchive, SourceChanged, BATCH_BYTES };
