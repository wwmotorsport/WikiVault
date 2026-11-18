'use strict';
// PMTiles version 3: the single-file map format (https://github.com/protomaps/PMTiles, spec v3).
// Reading and writing of the header and the directories, tile numbering, and working out which
// tiles cover a region. Plain data work: no Electron, no network.

const zlib = require('node:zlib');

const HEADER_BYTES = 127;
const ROOT_BUDGET = 16384; // the header and the root directory must fit in the first 16 KiB
const GZIP = 2;

// ---------------------------------------------------------------- tile numbers

/** Tiles before zoom z: 1 + 4 + 16 + ... */
const zoomBase = (z) => (4 ** z - 1) / 3;

/** Position of a tile along the Hilbert curve of its zoom level. */
function hilbert(z, x, y) {
  let d = 0;
  let px = x;
  let py = y;
  for (let s = 2 ** z / 2; s >= 1; s /= 2) {
    const rx = Math.floor(px / s) % 2;
    const ry = Math.floor(py / s) % 2;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) { px = s - 1 - (px % s); py = s - 1 - (py % s); } else { px %= s; py %= s; }
      const t = px; px = py; py = t;
    } else { px %= s; py %= s; }
  }
  return d;
}
const zxyToId = (z, x, y) => zoomBase(z) + hilbert(z, x, y);
/** The zoom level a tile number belongs to. */
function zoomOfId(id) { let z = 0; while (zoomBase(z + 1) <= id) z += 1; return z; }

// ---------------------------------------------------------------- header

function parseHeader(buf) {
  if (buf.length < HEADER_BYTES || buf.toString('latin1', 0, 7) !== 'PMTiles') throw new Error('This is not a PMTiles file.');
  if (buf[7] !== 3) throw new Error(`PMTiles version ${buf[7]} is not supported (version 3 is).`);
  const u64 = (at) => Number(buf.readBigUInt64LE(at));
  const deg = (at) => buf.readInt32LE(at) / 1e7;
  return {
    rootOffset: u64(8), rootLength: u64(16), metadataOffset: u64(24), metadataLength: u64(32),
    leafOffset: u64(40), leafLength: u64(48), dataOffset: u64(56), dataLength: u64(64),
    addressedTiles: u64(72), tileEntries: u64(80), tileContents: u64(88),
    clustered: buf[96] === 1, internalCompression: buf[97], tileCompression: buf[98], tileType: buf[99],
    minZoom: buf[100], maxZoom: buf[101],
    bounds: [deg(102), deg(106), deg(110), deg(114)], centerZoom: buf[118], center: [deg(119), deg(123)],
  };
}

function serializeHeader(h) {
  const buf = Buffer.alloc(HEADER_BYTES);
  buf.write('PMTiles', 0, 'latin1');
  buf[7] = 3;
  const u64 = (at, v) => buf.writeBigUInt64LE(BigInt(v), at);
  const deg = (at, v) => buf.writeInt32LE(Math.round(v * 1e7), at);
  u64(8, h.rootOffset); u64(16, h.rootLength); u64(24, h.metadataOffset); u64(32, h.metadataLength);
  u64(40, h.leafOffset); u64(48, h.leafLength); u64(56, h.dataOffset); u64(64, h.dataLength);
  u64(72, h.addressedTiles); u64(80, h.tileEntries); u64(88, h.tileContents);
  buf[96] = h.clustered ? 1 : 0; buf[97] = h.internalCompression; buf[98] = h.tileCompression; buf[99] = h.tileType;
  buf[100] = h.minZoom; buf[101] = h.maxZoom;
  deg(102, h.bounds[0]); deg(106, h.bounds[1]); deg(110, h.bounds[2]); deg(114, h.bounds[3]);
  buf[118] = h.centerZoom; deg(119, h.center[0]); deg(123, h.center[1]);
  return buf;
}

// ---------------------------------------------------------------- directories

function inflate(buf, compression) {
  if (compression === GZIP) return zlib.gunzipSync(buf);
  if (compression === 1 || compression === 0) return buf;
  throw new Error('This map file packs its index in a way this version cannot read.');
}

/**
 * A directory as four columns. An entry with run length 0 points at a leaf directory (its offset is
 * within the leaf section); any other entry is `run` tiles in a row sharing one piece of tile data.
 */
function parseDirectory(raw, compression = GZIP) {
  const buf = inflate(raw, compression);
  let at = 0;
  const varint = () => {
    let v = 0; let mul = 1;
    for (;;) { const b = buf[at++]; v += (b & 0x7f) * mul; if (b < 0x80) return v; mul *= 128; }
  };
  const n = varint();
  const ids = new Float64Array(n); const runs = new Uint32Array(n); const lengths = new Uint32Array(n); const offsets = new Float64Array(n);
  let id = 0;
  for (let i = 0; i < n; i++) { id += varint(); ids[i] = id; }
  for (let i = 0; i < n; i++) runs[i] = varint();
  for (let i = 0; i < n; i++) lengths[i] = varint();
  for (let i = 0; i < n; i++) { const v = varint(); offsets[i] = v === 0 && i > 0 ? offsets[i - 1] + lengths[i - 1] : v - 1; }
  return { n, ids, runs, lengths, offsets };
}

function serializeDirectory(dir, from = 0, to = dir.n) {
  const out = [];
  const varint = (v) => { let x = v; while (x >= 128) { out.push((x % 128) | 0x80); x = Math.floor(x / 128); } out.push(x); };
  varint(to - from);
  let last = 0;
  for (let i = from; i < to; i++) { varint(dir.ids[i] - last); last = dir.ids[i]; }
  for (let i = from; i < to; i++) varint(dir.runs[i]);
  for (let i = from; i < to; i++) varint(dir.lengths[i]);
  for (let i = from; i < to; i++) varint(i > from && dir.offsets[i] === dir.offsets[i - 1] + dir.lengths[i - 1] ? 0 : dir.offsets[i] + 1);
  return zlib.gzipSync(Buffer.from(out));
}

/**
 * The root directory and the leaf section for a set of tile entries. The root is written alone when
 * it fits in the first 16 KiB with the header; otherwise the entries go into leaves that the root points at.
 */
function buildDirectories(dir) {
  const whole = serializeDirectory(dir);
  if (whole.length + HEADER_BYTES <= ROOT_BUDGET) return { root: whole, leaves: Buffer.alloc(0) };
  for (let size = 4096; ; size = Math.ceil(size * 1.2)) {
    const count = Math.ceil(dir.n / size);
    const root = { n: count, ids: new Float64Array(count), runs: new Uint32Array(count), lengths: new Uint32Array(count), offsets: new Float64Array(count) };
    const parts = [];
    let at = 0;
    for (let k = 0; k < count; k++) {
      const leaf = serializeDirectory(dir, k * size, Math.min(dir.n, (k + 1) * size));
      root.ids[k] = dir.ids[k * size]; root.lengths[k] = leaf.length; root.offsets[k] = at;
      parts.push(leaf); at += leaf.length;
    }
    const rootBytes = serializeDirectory(root);
    if (rootBytes.length + HEADER_BYTES <= ROOT_BUDGET) return { root: rootBytes, leaves: Buffer.concat(parts) };
  }
}

// ---------------------------------------------------------------- regions

const lonOfX = (x, z) => (x / 2 ** z) * 360 - 180;
const latOfY = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
const xOfLon = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const yOfLat = (lat, z) => { const r = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z; };

function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
/** Does a ring (in tile units of some zoom) touch the square [x, x+1] x [y, y+1]? */
function ringTouchesCell(ring, x, y) {
  const corners = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
  if (ring.some(([px, py]) => px >= x && px <= x + 1 && py >= y && py <= y + 1)) return true;
  if (corners.some(([cx, cy]) => inRing(ring, cx, cy))) return true;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) for (let k = 0; k < 4; k++) if (segmentsCross(ring[j], ring[i], corners[k], corners[(k + 1) % 4])) return true;
  return false;
}

/**
 * The tiles of zoom `z` that cover a set of outlines, as ranges of tile numbers [from, to), sorted
 * and merged. `rings` are outlines in [lon, lat]. Above zoom 10 the cover is worked out at zoom 10
 * and widened to whole zoom-10 squares: on the Hilbert curve a square's children are one unbroken range.
 */
function coverRanges(rings, z, coverZoom = 10) {
  const c = Math.min(z, coverZoom);
  const scale = 4 ** (z - c);
  const base = zoomBase(z);
  const ranges = [];
  const seen = new Set();
  for (const ring of rings) {
    const pts = ring.map(([lon, lat]) => [xOfLon(lon, c), yOfLat(lat, c)]);
    const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
    const max = 2 ** c - 1;
    const x0 = Math.max(0, Math.floor(Math.min(...xs))); const x1 = Math.min(max, Math.floor(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys))); const y1 = Math.min(max, Math.floor(Math.max(...ys)));
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const key = x * 4096 + y;
      if (seen.has(key) || !ringTouchesCell(pts, x, y)) continue;
      seen.add(key);
      const h = hilbert(c, x, y);
      ranges.push([base + h * scale, base + (h + 1) * scale]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) { const last = merged[merged.length - 1]; if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([r[0], r[1]]); }
  return merged;
}

module.exports = { HEADER_BYTES, ROOT_BUDGET, GZIP, zoomBase, hilbert, zxyToId, zoomOfId, parseHeader, serializeHeader, parseDirectory, serializeDirectory, buildDirectories, coverRanges, lonOfX, latOfY, xOfLon, yOfLat };
