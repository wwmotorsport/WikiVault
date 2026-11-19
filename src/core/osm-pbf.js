'use strict';
// Reads OpenStreetMap extracts in the PBF format (the .osm.pbf files that Geofabrik and others publish),
// and takes out of one the things whose tags are wanted, each with a position.
//
// The format: a file is a run of blobs, each a small header followed by a block that is usually compressed.
// The first block describes the file; every other block holds up to a few thousand nodes, ways or relations.
// Nodes carry a position. A way is a line through nodes and a relation is a group of ways and nodes, so the
// position of either has to be looked up from its nodes. Files are written nodes first, then ways, then
// relations, which is the wrong order for that: so the file is read from disk in three goes, last part first.
//
// Plain work on a file: no Electron, no network. Numbers are kept exact up to 2^53, which OpenStreetMap ids
// (about 1.3e10 today) are far below.

const fs = require('node:fs');
const zlib = require('node:zlib');

// ---------------------------------------------------------------- protocol buffers, as much as is needed

/** A cursor over protocol-buffer bytes. */
class Pb {
  constructor(buf, pos = 0, end = buf.length) { this.buf = buf; this.pos = pos; this.end = end; }
  more() { return this.pos < this.end; }
  varint() {
    const buf = this.buf;
    let b = buf[this.pos++];
    if (b < 0x80) return b;
    let x = b & 0x7f; let mul = 128;
    for (;;) {
      b = buf[this.pos++];
      x += (b & 0x7f) * mul;
      if (b < 0x80) return x;
      mul *= 128;
      if (this.pos > this.end) throw new Error('The file is damaged: a number runs past the end of its block.');
    }
  }
  /** A signed number written zig-zag. */
  svarint() { const x = this.varint(); return x % 2 ? -(x + 1) / 2 : x / 2; }
  /** The next field as [number, wire type], or null at the end. */
  field() {
    if (this.pos >= this.end) return null;
    const tag = this.varint();
    return [Math.floor(tag / 8), tag % 8];
  }
  /** The bytes of a length-delimited field, as a cursor over them. */
  sub() { const n = this.varint(); const at = this.pos; this.pos += n; if (this.pos > this.end) throw new Error('The file is damaged: a field runs past the end of its block.'); return new Pb(this.buf, at, at + n); }
  bytes() { const n = this.varint(); const at = this.pos; this.pos += n; if (this.pos > this.end) throw new Error('The file is damaged: a field runs past the end of its block.'); return this.buf.subarray(at, at + n); }
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 2) { const n = this.varint(); this.pos += n; } // not `pos += varint()`: that would add to the place before the length was read
    else if (wire === 1) this.pos += 8;
    else if (wire === 5) this.pos += 4;
    else throw new Error('The file is damaged: an unknown kind of field.');
  }
}

// ---------------------------------------------------------------- the blobs of a file

/**
 * Where every blob of a file is: [{ type, at, size }], `at` being where its bytes start. Only the small
 * headers are read, so this is quick however large the file.
 */
function indexBlobs(fd, fileSize) {
  const out = [];
  const head = Buffer.alloc(4);
  let pos = 0;
  let small = Buffer.alloc(256);
  while (pos < fileSize) {
    if (fs.readSync(fd, head, 0, 4, pos) !== 4) throw new Error('The file is cut short.');
    const len = head.readUInt32BE(0);
    if (len <= 0 || len > 64 * 1024) throw new Error('This is not an OpenStreetMap PBF file, or it is damaged.');
    if (small.length < len) small = Buffer.alloc(len);
    if (fs.readSync(fd, small, 0, len, pos + 4) !== len) throw new Error('The file is cut short.');
    const p = new Pb(small, 0, len);
    let type = ''; let size = -1;
    for (let f = p.field(); f; f = p.field()) {
      if (f[0] === 1 && f[1] === 2) type = p.bytes().toString('latin1');
      else if (f[0] === 3 && f[1] === 0) size = p.varint();
      else p.skip(f[1]);
    }
    if (size < 0 || size > 64 * 1024 * 1024) throw new Error('This is not an OpenStreetMap PBF file, or it is damaged.');
    const at = pos + 4 + len;
    if (at + size > fileSize) throw new Error('The file is cut short: its last part is missing.');
    out.push({ type, at, size });
    pos = at + size;
  }
  return out;
}

/** The bytes of one blob, uncompressed. */
function readBlob(fd, blob, scratch) {
  const raw = scratch && scratch.length >= blob.size ? scratch : Buffer.alloc(blob.size);
  if (fs.readSync(fd, raw, 0, blob.size, blob.at) !== blob.size) throw new Error('The file is cut short.');
  const p = new Pb(raw, 0, blob.size);
  for (let f = p.field(); f; f = p.field()) {
    if (f[0] === 1 && f[1] === 2) return Buffer.from(p.bytes()); // stored as it is
    if (f[0] === 3 && f[1] === 2) return zlib.inflateSync(p.bytes());
    if ((f[0] === 4 || f[0] === 6 || f[0] === 7) && f[1] === 2) throw new Error('This file is compressed in a way Wikivault cannot read (not zlib).');
    p.skip(f[1]);
  }
  throw new Error('The file is damaged: a block with nothing in it.');
}

/** What the first block says of the file: { required, optional, program, sorted }. */
function parseHeader(buf) {
  const out = { required: [], optional: [], program: '', sorted: false };
  const p = new Pb(buf);
  for (let f = p.field(); f; f = p.field()) {
    if (f[0] === 4 && f[1] === 2) out.required.push(p.bytes().toString('utf8'));
    else if (f[0] === 5 && f[1] === 2) out.optional.push(p.bytes().toString('utf8'));
    else if (f[0] === 16 && f[1] === 2) out.program = p.bytes().toString('utf8');
    else p.skip(f[1]);
  }
  out.sorted = out.optional.includes('Sort.Type_then_ID');
  const unknown = out.required.filter((x) => x !== 'OsmSchema-V0.6' && x !== 'DenseNodes');
  if (unknown.length) throw new Error(`This file needs something Wikivault cannot read (${unknown.join(', ')}).`);
  return out;
}

/** What kinds of thing a block holds, without reading them: { node, way, relation }. */
function kindsOf(buf) {
  const out = { node: false, way: false, relation: false };
  const p = new Pb(buf);
  for (let f = p.field(); f; f = p.field()) {
    if (f[0] === 2 && f[1] === 2) {
      const g = p.sub();
      for (let h = g.field(); h; h = g.field()) {
        if (h[0] === 1 || h[0] === 2) out.node = true; else if (h[0] === 3) out.way = true; else if (h[0] === 4) out.relation = true;
        g.skip(h[1]);
      }
    } else p.skip(f[1]);
  }
  return out;
}

// ---------------------------------------------------------------- reading a block

/** What is wanted, from [[key, value], ...]: Map(key -> Set(values)). */
function wantedOf(filters) {
  const out = new Map();
  for (const [k, v] of filters) { if (!out.has(k)) out.set(k, new Set()); out.get(k).add(v); }
  return out;
}

/**
 * The parts of a block that every kind of thing in it shares: its strings, and how positions are scaled.
 * `wanted` marks the strings that are wanted keys, so that tags can be tested by number, without making strings.
 */
function openBlock(buf, wanted) {
  const strings = []; const groups = [];
  let gran = 100; let latOff = 0; let lonOff = 0;
  const p = new Pb(buf);
  for (let f = p.field(); f; f = p.field()) {
    if (f[0] === 1 && f[1] === 2) { const s = p.sub(); for (let h = s.field(); h; h = s.field()) { if (h[0] === 1 && h[1] === 2) strings.push(s.bytes()); else s.skip(h[1]); } }
    else if (f[0] === 2 && f[1] === 2) groups.push(p.sub());
    else if (f[0] === 17 && f[1] === 0) gran = p.varint();
    else if (f[0] === 19 && f[1] === 0) latOff = p.varint();
    else if (f[0] === 20 && f[1] === 0) lonOff = p.varint();
    else p.skip(f[1]);
  }
  // Which strings are keys that are wanted, and the values wanted for each.
  const keyOf = new Array(strings.length).fill(null);
  let any = false;
  if (wanted) {
    for (let i = 0; i < strings.length; i++) {
      const b = strings[i];
      if (b.length > 40) continue;
      const set = wanted.get(b.toString('utf8'));
      if (set) { keyOf[i] = set; any = true; }
    }
  }
  const cache = new Map();
  const str = (i) => { let s = cache.get(i); if (s === undefined) { s = strings[i] ? strings[i].toString('utf8') : ''; cache.set(i, s); } return s; };
  const fits = (k, v) => { const set = keyOf[k]; return Boolean(set) && set.has(str(v)); };
  return { groups, str, fits, anyKey: any, lat: (v) => 1e-9 * (latOff + gran * v), lon: (v) => 1e-9 * (lonOff + gran * v) };
}

/** A packed field of numbers, read into an array. `signed` for zig-zag, `delta` when each is the change from the one before. */
function packed(p, signed, delta) {
  const s = p.sub();
  const out = [];
  let last = 0;
  while (s.more()) { const v = signed ? s.svarint() : s.varint(); last = delta ? last + v : v; out.push(last); }
  return out;
}

const tagsOf = (keys, vals, str) => { const t = {}; for (let i = 0; i < keys.length; i++) t[str(keys[i])] = str(vals[i]); return t; };

/**
 * The nodes of a block. `onMatch(id, lat, lon, tags)` for every node with a wanted tag; `need` (a sorted
 * Float64Array of ids) and `put(index, lat, lon)` for the nodes whose position was asked for.
 * Returns how many nodes the block held.
 */
function readNodes(buf, wanted, onMatch, need, put) {
  const b = openBlock(buf, wanted);
  let count = 0;
  for (const g of b.groups) {
    for (let f = g.field(); f; f = g.field()) {
      if (f[0] === 2 && f[1] === 2) { // dense nodes: the usual form
        const d = g.sub();
        let ids = null; let lats = null; let lons = null; let kv = null;
        for (let h = d.field(); h; h = d.field()) {
          if (h[0] === 1 && h[1] === 2) ids = packed(d, true, true);
          else if (h[0] === 8 && h[1] === 2) lats = packed(d, true, true);
          else if (h[0] === 9 && h[1] === 2) lons = packed(d, true, true);
          else if (h[0] === 10 && h[1] === 2) kv = b.anyKey ? packed(d, false, false) : (d.skip(2), null);
          else d.skip(h[1]);
        }
        if (!ids || !lats || !lons || lats.length !== ids.length || lons.length !== ids.length) throw new Error('The file is damaged: a block of nodes does not add up.');
        const n = ids.length;
        count += n;
        // The nodes whose position a way or relation needs. Both lists are in order, so they are walked together.
        if (need && need.length && n) {
          let lo = 0; let hi = need.length;
          const first = ids[0] < ids[n - 1] ? ids[0] : Math.min(...ids);
          while (lo < hi) { const mid = (lo + hi) >> 1; if (need[mid] < first) lo = mid + 1; else hi = mid; }
          let at = lo; let ordered = true;
          for (let j = 0; j < n && at < need.length; j++) {
            const id = ids[j];
            if (j && id < ids[j - 1]) { ordered = false; break; }
            while (at < need.length && need[at] < id) at++;
            if (at < need.length && need[at] === id) put(at, b.lat(lats[j]), b.lon(lons[j]));
          }
          if (!ordered) { // not in order after all: look each one up
            for (let j = 0; j < n; j++) {
              let a = 0; let z = need.length;
              while (a < z) { const mid = (a + z) >> 1; if (need[mid] < ids[j]) a = mid + 1; else z = mid; }
              if (a < need.length && need[a] === ids[j]) put(a, b.lat(lats[j]), b.lon(lons[j]));
            }
          }
        }
        // The nodes that are themselves wanted. Tags are one run of numbers: key, value, ..., 0 at the end of each node.
        if (kv && kv.length && onMatch) {
          let j = 0; let start = 0; let hit = false;
          for (let i = 0; i < kv.length; i++) {
            if (kv[i] === 0) {
              if (hit) { const t = {}; for (let x = start; x < i; x += 2) t[b.str(kv[x])] = b.str(kv[x + 1]); onMatch(ids[j], b.lat(lats[j]), b.lon(lons[j]), t); }
              j++; start = i + 1; hit = false;
            } else { if (!hit && b.fits(kv[i], kv[i + 1])) hit = true; i++; }
          }
        }
      } else if (f[0] === 1 && f[1] === 2) { // nodes written one by one: rare
        const d = g.sub();
        let id = 0; let lat = 0; let lon = 0; let keys = []; let vals = [];
        for (let h = d.field(); h; h = d.field()) {
          if (h[0] === 1 && h[1] === 0) id = d.svarint();
          else if (h[0] === 2 && h[1] === 2) keys = packed(d, false, false);
          else if (h[0] === 3 && h[1] === 2) vals = packed(d, false, false);
          else if (h[0] === 8 && h[1] === 0) lat = d.svarint();
          else if (h[0] === 9 && h[1] === 0) lon = d.svarint();
          else d.skip(h[1]);
        }
        count += 1;
        if (need && need.length) { let a = 0; let z = need.length; while (a < z) { const mid = (a + z) >> 1; if (need[mid] < id) a = mid + 1; else z = mid; } if (a < need.length && need[a] === id) put(a, b.lat(lat), b.lon(lon)); }
        if (onMatch && keys.some((k, i) => b.fits(k, vals[i]))) onMatch(id, b.lat(lat), b.lon(lon), tagsOf(keys, vals, b.str));
      } else g.skip(f[1]);
    }
  }
  return count;
}

/** Up to `most` of a list, spread evenly over it, the first and the last among them. */
function spread(list, most) {
  if (list.length <= most) return list;
  const out = [];
  for (let i = 0; i < most; i++) out.push(list[Math.round((i * (list.length - 1)) / (most - 1))]);
  return out;
}

/**
 * The ways of a block. `onMatch(id, tags, refs)` for every way with a wanted tag, and `onNeeded(id, refs)` for
 * every way in `needWays` (a Set), `refs` being a few of its nodes, spread along it. Returns how many ways.
 */
function readWays(buf, wanted, onMatch, needWays, onNeeded, most = 12) {
  const b = openBlock(buf, wanted);
  let count = 0;
  const asked = needWays && needWays.size;
  for (const g of b.groups) {
    for (let f = g.field(); f; f = g.field()) {
      if (f[0] !== 3 || f[1] !== 2) { g.skip(f[1]); continue; }
      count += 1;
      const d = g.sub();
      let id = 0; let keys = null; let vals = null; let refsAt = null;
      for (let h = d.field(); h; h = d.field()) {
        if (h[0] === 1 && h[1] === 0) id = d.varint();
        else if (h[0] === 2 && h[1] === 2) keys = b.anyKey ? packed(d, false, false) : (d.skip(2), null);
        else if (h[0] === 3 && h[1] === 2) vals = b.anyKey ? packed(d, false, false) : (d.skip(2), null);
        else if (h[0] === 8 && h[1] === 2) { refsAt = d.pos; d.skip(2); }
        else d.skip(h[1]);
      }
      let hit = false;
      if (keys && vals) for (let i = 0; i < keys.length; i++) if (b.fits(keys[i], vals[i])) { hit = true; break; }
      const need = asked && needWays.has(id);
      if ((!hit && !need) || refsAt === null) continue;
      const refs = spread(packed(new Pb(d.buf, refsAt, d.end), true, true), most);
      if (hit && onMatch) onMatch(id, tagsOf(keys, vals, b.str), refs);
      if (need && onNeeded) onNeeded(id, refs);
    }
  }
  return count;
}

/**
 * The relations of a block. `onMatch(id, tags, ways, nodes)` for every relation with a wanted tag: `ways` are
 * a few of its member ways (the outer ones when it says which are), `nodes` a few of its member nodes.
 */
function readRelations(buf, wanted, onMatch, most = 4) {
  const b = openBlock(buf, wanted);
  let count = 0;
  for (const g of b.groups) {
    for (let f = g.field(); f; f = g.field()) {
      if (f[0] !== 4 || f[1] !== 2) { g.skip(f[1]); continue; }
      count += 1;
      if (!b.anyKey) { g.skip(2); continue; }
      const d = g.sub();
      let id = 0; let keys = []; let vals = []; let roles = []; let mem = []; let types = [];
      for (let h = d.field(); h; h = d.field()) {
        if (h[0] === 1 && h[1] === 0) id = d.varint();
        else if (h[0] === 2 && h[1] === 2) keys = packed(d, false, false);
        else if (h[0] === 3 && h[1] === 2) vals = packed(d, false, false);
        else if (h[0] === 8 && h[1] === 2) roles = packed(d, false, false);
        else if (h[0] === 9 && h[1] === 2) mem = packed(d, true, true);
        else if (h[0] === 10 && h[1] === 2) types = packed(d, false, false);
        else d.skip(h[1]);
      }
      if (!keys.some((k, i) => b.fits(k, vals[i]))) continue;
      const ways = []; const outer = []; const nodes = [];
      for (let i = 0; i < mem.length; i++) {
        if (types[i] === 1) { ways.push(mem[i]); if (b.str(roles[i]) === 'outer') outer.push(mem[i]); } else if (types[i] === 0) nodes.push(mem[i]);
      }
      onMatch(id, tagsOf(keys, vals, b.str), spread(outer.length ? outer : ways, most), spread(nodes, most));
    }
  }
  return count;
}

// ---------------------------------------------------------------- a whole file

/**
 * Everything in a file whose tags meet one of `filters` ([[key, value], ...]), as the elements the places
 * code already knows: { type: 'node', id, lat, lon, tags } and { type: 'way' | 'relation', id, center: { lat, lon }, tags }.
 * The centre of a way or a relation is the middle of the box around a few of its nodes.
 *
 * @param {string} file
 * @param {{ filters: Array, onElement: (el) => void, onProgress?: (p: { stage: string, done: number, total: number }) => void, stop?: () => boolean }} o
 * @returns {{ nodes: number, ways: number, relations: number, matched: number, unplaced: number, program: string, sorted: boolean }}
 */
function extract(file, { filters, onElement, onProgress = () => {}, stop = () => false }) {
  const wanted = wantedOf(filters);
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const blobs = indexBlobs(fd, size);
    if (!blobs.length || blobs[0].type !== 'OSMHeader') throw new Error('This is not an OpenStreetMap PBF file.');
    const header = parseHeader(readBlob(fd, blobs[0]));
    const data = blobs.filter((b) => b.type === 'OSMData');
    if (!data.length) throw new Error('The file holds no map data.');
    let scratch = Buffer.alloc(Math.max(...data.map((b) => b.size)));
    const block = (i) => readBlob(fd, data[i], scratch);

    // Where the ways and the relations begin. The file is in order (nodes, ways, relations), so two searches find it.
    const kinds = new Map();
    const kind = (i) => { let k = kinds.get(i); if (!k) { k = kindsOf(block(i)); kinds.set(i, k); } return k; };
    const first = (test) => { let lo = 0; let hi = data.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (test(kind(mid))) hi = mid; else lo = mid + 1; } return lo; };
    let wayFrom = first((k) => k.way || k.relation);
    let relFrom = first((k) => k.relation);
    let nodeTo = first((k) => !k.node); // the first block with no nodes in it
    let wayTo = first((k) => !k.node && !k.way); // the first block with nothing but relations
    // A file that is not in order: a few blocks spread over it show it up, and then every block is read each time.
    let inOrder = true;
    for (let s = 0; s < 24 && inOrder; s++) {
      const i = Math.floor((s * (data.length - 1)) / 23);
      const k = kind(i);
      if ((k.node && i >= nodeTo) || (k.way && (i < wayFrom || i >= wayTo)) || (k.relation && i < relFrom)) inOrder = false;
    }
    if (!inOrder) { wayFrom = 0; relFrom = 0; nodeTo = data.length; wayTo = data.length; }

    const total = (data.length - relFrom) + (wayTo - wayFrom) + nodeTo;
    let done = 0; let last = 0;
    const tick = (stage) => { done += 1; const now = Date.now(); if (now - last > 250 || done === total) { last = now; onProgress({ stage, done, total }); } };
    const stats = { nodes: 0, ways: 0, relations: 0, matched: 0, unplaced: 0, program: header.program, sorted: inOrder };

    // 1. Relations: which are wanted, and which of their ways and nodes would place them.
    const rels = []; const needWays = new Set();
    for (let i = relFrom; i < data.length; i++) {
      if (stop()) throw new Error('Stopped.');
      stats.relations += readRelations(block(i), wanted, (id, tags, ways, nodes) => { rels.push({ id, tags, ways, nodes, refs: [] }); for (const w of ways) needWays.add(w); });
      tick('relations');
    }
    // 2. Ways: which are wanted, and a few nodes of each; and a few nodes of the ways the relations asked for.
    const ways = []; const wayRefs = new Map();
    for (let i = wayFrom; i < wayTo; i++) {
      if (stop()) throw new Error('Stopped.');
      stats.ways += readWays(block(i), wanted, (id, tags, refs) => ways.push({ id, tags, refs }), needWays, (id, refs) => wayRefs.set(id, spread(refs, 4)));
      tick('ways');
    }
    for (const r of rels) { for (const w of r.ways) for (const n of wayRefs.get(w) || []) r.refs.push(n); for (const n of r.nodes) r.refs.push(n); }
    // 3. Nodes: the wanted ones, and the positions asked for.
    const ask = new Set();
    for (const w of ways) for (const n of w.refs) ask.add(n);
    for (const r of rels) for (const n of r.refs) ask.add(n);
    const need = Float64Array.from(ask).sort();
    const lat = new Float64Array(need.length).fill(NaN); const lon = new Float64Array(need.length).fill(NaN);
    const put = (at, a, o) => { lat[at] = a; lon[at] = o; };
    for (let i = 0; i < nodeTo; i++) {
      if (stop()) throw new Error('Stopped.');
      stats.nodes += readNodes(block(i), wanted, (id, a, o, tags) => { stats.matched += 1; onElement({ type: 'node', id, lat: a, lon: o, tags }); }, need, put);
      tick('nodes');
    }
    scratch = null;
    // The middle of the box around the nodes that were found.
    const centre = (refs) => {
      let s = Infinity; let n = -Infinity; let w = Infinity; let e = -Infinity;
      for (const id of refs) {
        let a = 0; let z = need.length;
        while (a < z) { const mid = (a + z) >> 1; if (need[mid] < id) a = mid + 1; else z = mid; }
        if (a >= need.length || need[a] !== id || Number.isNaN(lat[a])) continue;
        if (lat[a] < s) s = lat[a]; if (lat[a] > n) n = lat[a]; if (lon[a] < w) w = lon[a]; if (lon[a] > e) e = lon[a];
      }
      return s === Infinity ? null : { lat: (s + n) / 2, lon: (w + e) / 2 };
    };
    for (const [type, list] of [['way', ways], ['relation', rels]]) {
      for (const x of list) {
        const c = centre(x.refs);
        if (!c) { stats.unplaced += 1; continue; } // its nodes lie outside this extract
        stats.matched += 1;
        onElement({ type, id: x.id, center: c, tags: x.tags });
      }
    }
    return stats;
  } finally { fs.closeSync(fd); }
}

module.exports = { extract, indexBlobs, readBlob, parseHeader, kindsOf, wantedOf, readNodes, readWays, readRelations, Pb };
