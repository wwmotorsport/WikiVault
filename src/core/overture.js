'use strict';
// Overture Maps: address points, and places to add to those from OpenStreetMap.
//
// Overture publishes its data as Parquet files in a public store, a new release about once a month, with
// older releases removed. Each file's footer says, for every group of rows, the box the rows lie in and
// where each column is, so only the groups that touch the chosen regions, and only the columns that are
// used, are downloaded. Nothing here needs an account or a key.
//
// This file finds the release and its files, measures what a region needs, and turns the rows into the
// app's own address index (addresses.js) and place records. No Electron. It runs in a worker thread.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { parquetMetadataAsync, parquetRead } = require('../vendor/parquet/hyparquet.cjs');
const { fetchLike } = require('./httpx');
const { AddressBuilder, Spool } = require('./addresses');

const bytesOf = (b) => new Uint8Array(b.buffer, b.byteOffset, b.length);
const compressors = {
  ZSTD: (input) => { if (!zlib.zstdDecompressSync) throw new Error('This build cannot read zstd-compressed files.'); return bytesOf(zlib.zstdDecompressSync(input)); },
  GZIP: (input) => bytesOf(zlib.gunzipSync(input)),
  BROTLI: (input) => bytesOf(zlib.brotliDecompressSync(input)),
};

const THEMES = { addresses: ['addresses', 'address'], places: ['places', 'place'] };
const COLUMNS = {
  addresses: ['bbox', 'postcode', 'street', 'number', 'address_levels', 'postal_city'],
  places: ['id', 'bbox', 'names', 'taxonomy', 'basic_category', 'categories', 'confidence', 'operating_status', 'addresses', 'phones'],
};

class Stopped extends Error { constructor() { super('Stopped.'); this.stopped = true; } }

/** How the servers are reached: with retries, and from a stand-in server in tests. */
class Net {
  constructor({ fetchImpl = fetchLike, rewrite = (u) => u, agent = 'Wikivault', signal = null, pause = (ms) => new Promise((r) => setTimeout(r, ms)), onBytes = () => {} } = {}) { Object.assign(this, { fetch: fetchImpl, rewrite, agent, signal, pause, onBytes }); }

  async get(url, { range = null, tries = 5, timeoutMs = 60000 } = {}) {
    let last = null;
    for (let attempt = 0; attempt < tries; attempt++) {
      if (this.signal && this.signal.aborted) throw new Stopped();
      try {
        const res = await this.fetch(this.rewrite(url), { signal: this.signal, timeoutMs, headers: { 'user-agent': this.agent, ...(range ? { range: `bytes=${range[0]}-${range[1] - 1}` } : {}) } });
        if (res.status === 404 || res.status === 403) { if (res.body && res.body.destroy) res.body.destroy(); throw Object.assign(new Error(`The Overture server answered ${res.status} for ${new URL(url).pathname.split('/').pop() || 'the list'}.`), { fatal: true, status: res.status }); }
        if (res.status !== 200 && res.status !== 206) { if (res.body && res.body.destroy) res.body.destroy(); throw new Error(`The Overture server answered ${res.status}.`); }
        const buf = Buffer.from(await res.arrayBuffer());
        if (range && res.status === 206 && buf.length !== range[1] - range[0]) throw new Error('The Overture server sent less than was asked for.');
        this.onBytes(buf.length);
        return range && res.status === 200 ? buf.subarray(range[0], range[1]) : buf;
      } catch (err) {
        if (err.fatal || (this.signal && this.signal.aborted)) throw this.signal && this.signal.aborted ? new Stopped() : err;
        last = err;
        await this.pause(2000 * (attempt + 1));
      }
    }
    throw last;
  }
}

/** The newest release, as "2026-10-21.0". Asked of Overture's own list first, and read off the store's folders if that fails. */
async function latestRelease(net, cfg) {
  try {
    const j = JSON.parse((await net.get(cfg.releases, { tries: 2 })).toString('utf8'));
    if (j && typeof j.latest === 'string' && /^\d{4}-\d\d-\d\d\.\d+$/.test(j.latest)) return j.latest;
  } catch (err) { if (err.stopped) throw err; }
  const xml = (await net.get(`${cfg.bucket}?list-type=2&prefix=release/&delimiter=/`)).toString('utf8');
  const all = [...xml.matchAll(/<Prefix>release\/(\d{4}-\d\d-\d\d\.\d+)\/<\/Prefix>/g)].map((m) => m[1]).sort();
  if (!all.length) throw new Error('The list of Overture releases could not be read.');
  return all[all.length - 1];
}

const unxml = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/** The files of one kind in a release: [{ key, url, bytes }]. */
async function listFiles(net, cfg, release, kind) {
  const [theme, type] = THEMES[kind];
  const prefix = `release/${release}/theme=${theme}/type=${type}/`;
  const out = [];
  let token = '';
  for (let page = 0; page < 200; page++) {
    const xml = (await net.get(`${cfg.bucket}?list-type=2&prefix=${encodeURIComponent(prefix)}${token ? `&continuation-token=${encodeURIComponent(token)}` : ''}`)).toString('utf8');
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = unxml((/<Key>([\s\S]*?)<\/Key>/.exec(m[1]) || [])[1] || ''); const bytes = Number((/<Size>(\d+)<\/Size>/.exec(m[1]) || [])[1]);
      if (key.endsWith('.parquet') && bytes > 0) out.push({ key, bytes, url: cfg.bucket + key.split('/').map(encodeURIComponent).join('/').replace(/%3D/g, '=') });
    }
    const next = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml);
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml) || !next) break;
    token = unxml(next[1]);
  }
  if (!out.length) throw new Error(`Release ${release} has no ${kind} files. It may have just been replaced: try again.`);
  return out.sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** A file on the server, read a piece at a time. Pieces fetched ahead are kept until let go. */
class RemoteFile {
  constructor(net, url, bytes) { this.net = net; this.url = url; this.byteLength = bytes; this.blocks = []; }
  async slice(start, end = this.byteLength) {
    for (const b of this.blocks) if (start >= b.start && end <= b.end) { const buf = await b.data; return buf.buffer.slice(buf.byteOffset + start - b.start, buf.byteOffset + end - b.start); }
    const buf = await this.net.get(this.url, { range: [start, end] });
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
  }
  /** Start fetching these [start, end) ranges, joined where they nearly touch. */
  prefetch(ranges, tag) {
    const sorted = ranges.slice().sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const r of sorted) { const last = merged[merged.length - 1]; if (last && r[0] - last[1] <= 262144 && r[1] - last[0] <= 64 * 1024 * 1024) last[1] = Math.max(last[1], r[1]); else merged.push([r[0], r[1]]); }
    for (const [start, end] of merged) { const data = this.net.get(this.url, { range: [start, end] }); data.catch(() => {}); this.blocks.push({ start, end, data, tag }); }
  }
  release(tag) { this.blocks = this.blocks.filter((b) => b.tag !== tag); }
}

const boxOfRing = (ring) => { let w = 180; let s = 90; let e = -180; let n = -90; for (const [x, y] of ring) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; } return [w, s, e, n]; };
function inRing(ring, x, y) { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i]; const [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside; } return inside; }

/** The box the rows of a group lie in, from the footer, or null when the footer does not say. */
function groupBox(group) {
  const v = {};
  for (const c of group.columns) {
    const p = c.meta_data && c.meta_data.path_in_schema; const st = c.meta_data && c.meta_data.statistics;
    if (!p || p[0] !== 'bbox' || !st) continue;
    if (typeof st.min_value === 'number') v[`${p[1]}.min`] = st.min_value;
    if (typeof st.max_value === 'number') v[`${p[1]}.max`] = st.max_value;
  }
  const box = [v['xmin.min'], v['ymin.min'], v['xmax.max'], v['ymax.max']];
  return box.every((n) => typeof n === 'number' && Number.isFinite(n)) ? box : null;
}

/** For one file: the groups that touch the regions, with the byte ranges of the wanted columns. */
function planFile(md, kind, boxes) {
  // The columns at the top of the file's schema: the schema is a flattened tree, so the children of each are stepped over.
  const top = new Set();
  const skip = (i) => { let next = i + 1; for (let c = 0; c < (md.schema[i].num_children || 0); c++) next = skip(next); return next; };
  for (let i = 1; i < md.schema.length; i = skip(i)) top.add(md.schema[i].name);
  const columns = COLUMNS[kind].filter((c) => top.has(c));
  const wanted = new Set(columns);
  const groups = [];
  let rowStart = 0;
  md.row_groups.forEach((g, index) => {
    const rows = Number(g.num_rows);
    const box = groupBox(g);
    if (!box || boxes.some((b) => box[0] <= b[2] && box[2] >= b[0] && box[1] <= b[3] && box[3] >= b[1])) {
      const ranges = []; let bytes = 0;
      for (const c of g.columns) {
        const m = c.meta_data;
        if (!m || !wanted.has(m.path_in_schema[0])) continue;
        const d = m.dictionary_page_offset != null && Number(m.dictionary_page_offset) > 0 ? Number(m.dictionary_page_offset) : null;
        const start = d != null ? Math.min(d, Number(m.data_page_offset)) : Number(m.data_page_offset);
        const size = Number(m.total_compressed_size);
        ranges.push([start, start + size]); bytes += size;
      }
      groups.push({ index, rowStart, rows, ranges, bytes });
    }
    rowStart += rows;
  });
  return { columns, groups, rows: groups.reduce((a, g) => a + g.rows, 0), bytes: groups.reduce((a, g) => a + g.bytes, 0) };
}

/** Read the footers of a kind's files and plan each. `onFile(done, total)` reports progress. */
async function planKind(net, cfg, release, kind, rings, onFile = () => {}) {
  const files = await listFiles(net, cfg, release, kind);
  const boxes = rings.map(boxOfRing);
  const out = [];
  let done = 0;
  // A few footers at a time: they are small, and there can be hundreds of files.
  const queue = files.slice();
  const work = async () => {
    for (;;) {
      const f = queue.shift(); if (!f) return;
      const file = new RemoteFile(net, f.url, f.bytes);
      const md = await parquetMetadataAsync(file);
      const plan = planFile(md, kind, boxes);
      if (plan.groups.length) out.push({ ...f, plan }); // the footer itself is let go: there can be hundreds, and each is read again when its file's turn comes
      done += 1; onFile(done, files.length);
    }
  };
  await Promise.all([work(), work(), work(), work()]);
  out.sort((a, b) => (a.key < b.key ? -1 : 1));
  return { files: out, rows: out.reduce((a, f) => a + f.plan.rows, 0), bytes: out.reduce((a, f) => a + f.plan.bytes, 0), listed: files.length };
}

/** What the chosen regions need, without downloading the rows: { release, addresses: { rows, bytes, files }, places: {...} }. */
async function measure({ cfg, rings, kinds = ['places', 'addresses'], net, onProgress = () => {} }) {
  const release = await latestRelease(net, cfg);
  const out = { release };
  for (const kind of kinds) {
    const p = await planKind(net, cfg, release, kind, rings, (done, total) => onProgress({ stage: 'measure', what: kind, done, total }));
    out[kind] = { rows: p.rows, bytes: p.bytes, files: p.files.length };
  }
  return out;
}

/** Go through the planned groups of the planned files in order, a group at a time, fetching the next ones meanwhile. */
async function eachGroup(net, files, skip, onRows, onFileDone, signal, sliceRows = 200000) {
  for (const f of files) {
    if (skip.has(f.key)) continue;
    const file = new RemoteFile(net, f.url, f.bytes);
    const md = await parquetMetadataAsync(file);
    const groups = f.plan.groups;
    const ahead = 2;
    for (let i = 0; i < Math.min(ahead, groups.length); i++) file.prefetch(groups[i].ranges, i);
    for (let i = 0; i < groups.length; i++) {
      if (signal && signal.aborted) throw new Stopped();
      const g = groups[i];
      // A very large group is read a part at a time, so its rows are never all in memory at once.
      for (let from = 0; from < g.rows; from += sliceRows) {
        let rows = null;
        await parquetRead({ file, metadata: md, columns: f.plan.columns, rowStart: g.rowStart + from, rowEnd: g.rowStart + Math.min(g.rows, from + sliceRows), rowFormat: 'object', compressors, geoparquet: false, onComplete: (r) => { rows = r; } });
        await onRows(rows || [], from + sliceRows >= g.rows ? g : { ...g, bytes: 0 });
        if (signal && signal.aborted) throw new Stopped();
      }
      file.release(i);
      if (i + ahead < groups.length) file.prefetch(groups[i + ahead].ranges, i + ahead);
    }
    await onFileDone(f);
  }
}

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const writeJson = (p, v) => { fs.writeFileSync(`${p}.tmp`, JSON.stringify(v)); fs.renameSync(`${p}.tmp`, p); };
const levelsOf = (row) => (Array.isArray(row.address_levels) ? row.address_levels.map((l) => (l && typeof l.value === 'string' ? l.value : '')) : []);

/**
 * Fetch the address points of the regions and build the index at `<dir>/addresses.dat`, described by
 * `<dir>/addresses.json`. Work in hand is kept in `<dir>/addresses.work`, so a stopped run carries on.
 */
async function importAddresses({ dir, cfg, rings, regions, release, net, signal, onProgress = () => {}, sliceRows }) {
  const work = path.join(dir, 'addresses.work');
  const stateFile = path.join(work, 'state.json');
  const stamp = `${release}|${regions.slice().sort().join(',')}`;
  let state = readJson(stateFile);
  if (!state || state.stamp !== stamp) { fs.rmSync(work, { recursive: true, force: true }); state = null; }
  fs.mkdirSync(work, { recursive: true });
  let builder = new AddressBuilder(work);
  try { builder.restore(state ? state.at : null); } catch { fs.rmSync(work, { recursive: true, force: true }); state = null; builder = new AddressBuilder(work); builder.restore(null); }
  state = state || { stamp, done: [], bytes: 0, at: null };

  onProgress({ stage: 'list', what: 'addresses' });
  const plan = await planKind(net, cfg, release, 'addresses', rings, (done, total) => onProgress({ stage: 'list', what: 'addresses', done, total }));
  const skip = new Set(state.done);
  let downloaded = state.bytes;
  let seen = 0;
  onProgress({ stage: 'rows', what: 'addresses', bytes: plan.bytes, downloaded, kept: builder.rows });
  await eachGroup(net, plan.files, skip, async (rows, g) => {
    for (const row of rows) {
      const b = row.bbox; if (!b) continue;
      const lon = b.xmin; const lat = b.ymin;
      if (!row.street || !row.number || !rings.some((r) => inRing(r, lon, lat))) continue;
      const lv = levelsOf(row);
      const st = lv.length >= 2 ? lv[0] : '';
      const city = row.postal_city || (lv.length >= 2 ? lv[lv.length - 1] : lv[0] || '');
      builder.add(row.street, row.number, lon, lat, city, st, row.postcode || '');
    }
    seen += rows.length; downloaded += g.bytes;
    onProgress({ downloaded, kept: builder.rows });
    await new Promise((r) => setImmediate(r));
  }, async (f) => {
    state.done.push(f.key); state.bytes = downloaded; state.at = builder.checkpoint();
    writeJson(stateFile, state);
  }, signal, sliceRows);

  onProgress({ stage: 'index', what: 'addresses', done: 0, total: 100 });
  const fresh = path.join(dir, 'addresses.new.dat');
  const meta = builder.finish(fresh, (f) => onProgress({ done: Math.round(f * 100) }));
  const info = { ...meta, release, regions, date: new Date().toISOString(), read: builder.rows };
  fs.rmSync(path.join(dir, 'addresses.dat'), { force: true });
  fs.renameSync(fresh, path.join(dir, 'addresses.dat'));
  writeJson(path.join(dir, 'addresses.json'), info);
  fs.rmSync(work, { recursive: true, force: true });
  const { offsets, ...summary } = info;
  return { ...summary, seen };
}

// Overture renamed some four hundred categories in 2026, mostly from plural to singular ("banks" to "bank"), so names are compared
// with each word brought to a rough singular: food_banks and food_bank, hunting_supplies and hunting_supply, are the same.
const singular = (s) => String(s || '').toLowerCase().split('_').map((w) => (w.length > 3 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 2 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).join('_');
const clean = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, 200) : '');

/** Which of the app's categories an Overture place belongs to, by the names in its place in Overture's tree of categories. */
function matcher(categories) {
  const map = new Map();
  for (const c of categories) for (const name of c.overture || []) if (!map.has(singular(name))) map.set(singular(name), c.id);
  return (row) => {
    const t = row.taxonomy || {};
    const names = [t.primary, row.basic_category, row.categories && row.categories.primary, ...(Array.isArray(t.hierarchy) ? t.hierarchy.slice().reverse() : [])];
    for (const n of names) { const id = n && map.get(singular(n)); if (id) return id; }
    return null;
  };
}

/** An Overture place as the app's small record, or null when it is not wanted. */
function placeRecord(row, categoryOf, minConfidence) {
  const b = row.bbox; if (!b) return null;
  if (row.operating_status && row.operating_status !== 'open') return null;
  if (typeof row.confidence === 'number' && row.confidence < minConfidence) return null;
  const cat = categoryOf(row); if (!cat) return null;
  const name = clean(row.names && row.names.primary); if (!name) return null;
  const r = { c: cat, i: `ov${String(row.id || '').replace(/-/g, '').slice(0, 16)}`, a: Math.round(b.ymin * 1e5) / 1e5, o: Math.round(b.xmin * 1e5) / 1e5, n: name, s: 'ov' };
  const ad = Array.isArray(row.addresses) ? row.addresses[0] : null;
  if (ad) { const d = clean([ad.freeform, [ad.locality, [ad.region, ad.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ')); if (d) r.d = d; }
  const phone = Array.isArray(row.phones) ? clean(row.phones[0]) : ''; if (phone) r.p = phone;
  return r;
}

/** Fetch the places of the regions that belong to the app's categories, into `<dir>/overture/<category>.json`. */
async function importPlaces({ dir, cfg, categories, rings, regions, release, net, signal, onProgress = () => {} }) {
  const work = path.join(dir, 'overture.work');
  const stateFile = path.join(work, 'state.json');
  const stamp = `${release}|${regions.slice().sort().join(',')}|${cfg.minConfidence}`;
  let state = readJson(stateFile);
  if (!state || state.stamp !== stamp) { fs.rmSync(work, { recursive: true, force: true }); state = null; }
  const ids = categories.map((c) => c.id);
  let spool = new Spool(path.join(work, 'found'), ids.length, 'jsonl');
  try { spool.restore(state ? state.lengths : null); } catch { fs.rmSync(work, { recursive: true, force: true }); state = null; spool = new Spool(path.join(work, 'found'), ids.length, 'jsonl'); spool.restore(null); }
  state = state || { stamp, done: [], bytes: 0, lengths: null, kept: 0 };
  const categoryOf = matcher(categories);

  onProgress({ stage: 'list', what: 'places' });
  const plan = await planKind(net, cfg, release, 'places', rings, (done, total) => onProgress({ stage: 'list', what: 'places', done, total }));
  const skip = new Set(state.done);
  let downloaded = state.bytes; let kept = state.kept;
  const passed = new Map(); // kinds of place that were not kept, counted, so the list of kinds can be tuned to what Overture really uses
  onProgress({ stage: 'rows', what: 'places', bytes: plan.bytes, downloaded, kept });
  await eachGroup(net, plan.files, skip, async (rows, g) => {
    for (const row of rows) {
      const r = placeRecord(row, categoryOf, cfg.minConfidence);
      if (!r) { const k = (row.taxonomy && row.taxonomy.primary) || row.basic_category; if (k && !categoryOf(row)) passed.set(k, (passed.get(k) || 0) + 1); continue; }
      if (!rings.some((ring) => inRing(ring, r.o, r.a))) continue;
      const { c, ...rest } = r;
      spool.add(ids.indexOf(c), `${JSON.stringify(rest)}\n`); kept += 1;
    }
    downloaded += g.bytes;
    onProgress({ downloaded, kept });
    await new Promise((r) => setImmediate(r));
  }, async (f) => {
    state.done.push(f.key); state.bytes = downloaded; state.kept = kept; state.lengths = spool.lengths();
    writeJson(stateFile, state);
  }, signal);

  const fresh = path.join(dir, 'overture.new');
  fs.rmSync(fresh, { recursive: true, force: true }); fs.mkdirSync(fresh, { recursive: true });
  const counts = {}; let bytes = 0;
  ids.forEach((id, i) => {
    const seen = new Set(); const items = [];
    for (const line of spool.read(i).split('\n')) { if (!line) continue; let r; try { r = JSON.parse(line); } catch { continue; } if (seen.has(r.i)) continue; seen.add(r.i); items.push(r); }
    if (!items.length) return;
    const text = JSON.stringify({ items });
    fs.writeFileSync(path.join(fresh, `${id}.json`), text); counts[id] = items.length; bytes += Buffer.byteLength(text);
  });
  const others = Object.fromEntries([...passed].sort((a, b) => b[1] - a[1]).slice(0, 400));
  const info = { release, regions, date: new Date().toISOString(), counts, total: Object.values(counts).reduce((a, n) => a + n, 0), bytes, others };
  fs.rmSync(path.join(dir, 'overture'), { recursive: true, force: true });
  fs.renameSync(fresh, path.join(dir, 'overture'));
  writeJson(path.join(dir, 'overture.json'), info);
  fs.rmSync(work, { recursive: true, force: true });
  return info;
}

/** Do a whole fetch: places, addresses or both. `post` receives progress. Used in a worker thread and, in tests, directly. */
async function run({ dir, cfg, categories, rings, regions, kinds, base = null, agent = 'Wikivault', signal = null, fast = false }, post = () => {}) {
  const net = new Net({ agent, signal, rewrite: base ? (u) => { const x = new URL(u); return base + x.pathname + x.search; } : (u) => u, ...(fast ? { pause: () => new Promise((r) => setTimeout(r, 10)) } : {}) });
  const release = await latestRelease(net, cfg);
  const out = { release };
  for (const kind of kinds) {
    const onProgress = (patch) => post({ what: kind, ...patch });
    if (kind === 'places') out.places = await importPlaces({ dir, cfg, categories, rings, regions, release, net, signal, onProgress });
    if (kind === 'addresses') out.addresses = await importAddresses({ dir, cfg, rings, regions, release, net, signal, onProgress });
  }
  return out;
}

module.exports = { Net, RemoteFile, Stopped, latestRelease, listFiles, planFile, planKind, measure, importAddresses, importPlaces, matcher, placeRecord, run, groupBox, COLUMNS };
