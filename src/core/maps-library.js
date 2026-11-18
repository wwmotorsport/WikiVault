'use strict';
// Maps: what is kept on disk and how it gets there.
//
//   <dir>/map.pmtiles        the map itself, cut from the Protomaps world file for the regions chosen
//   <dir>/map.json           what that file is: build, regions, level of detail, size, date
//   <dir>/places/<id>.json   the places of one category
//   <dir>/places.json        counts and date of the places
//   <dir>/routing/segments/  the routing data: BRouter's *.rd5 files, one per 5-degree square
//   <dir>/routing.json       which squares, their sizes and date
//
// A new map or a new set of places is fetched beside the old one and swapped in only when complete,
// so a failed update leaves what was there. No Electron here.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const extract = require('./map-extract');
const places = require('./places');
const routing = require('./routing');
const pm = require('./pmtiles');
const mvt = require('./mvt');
const zlib = require('node:zlib');
const { fetchLike } = require('./httpx');
const { Worker } = require('node:worker_threads');
const overture = require('./overture');
const addresses = require('./addresses');

/** Let go of an answer whose body will not be read, so its connection is not left open. */
function drop(res) { try { if (res.body && res.body.destroy) res.body.destroy(); else if (res.body && res.body.cancel) res.body.cancel().catch(() => {}); } catch { /* nothing to let go of */ } }

const REGISTRY = path.join(__dirname, '..', '..', 'assets', 'maps', 'registry.json');
const loadRegistry = (file = REGISTRY) => JSON.parse(fs.readFileSync(file, 'utf8'));

async function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value));
  await fsp.rename(tmp, file);
}
async function readJson(file) { try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return null; } }

class MapsLibrary extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.dir            where the map files live
   * @param {object} [o.registry]     regions, levels and categories (assets/maps/registry.json)
   * @param {Function} [o.fetchImpl]  fetch
   * @param {Function} [o.rewrite]    (url) => url, for tests
   * @param {Function} [o.pause]      (ms) => Promise, the wait between questions to the places server
   * @param {string} [o.agent]        how the app names itself to the servers
   */
  constructor({ dir, registry = loadRegistry(), fetchImpl = fetchLike, base = null, rewrite = base ? (u) => { const x = new URL(u); return base + x.pathname + x.search; } : (u) => u, pause = (ms) => new Promise((r) => setTimeout(r, ms)), agent = 'Wikivault', log = () => {} }) {
    super();
    this.dir = dir; this.registry = registry; this.fetch = fetchImpl; this.base = base; this.rewrite = rewrite; this.pause = pause; this.agent = agent; this.log = log;
    this.map = null; this.placesInfo = null; this.measured = null; this.job = null; this.error = null;
    this.loaded = new Map(); // category id -> records
    this.routing = null; this.routingMeasured = null;
    this.onRoutingSwap = async () => {}; // called before the routing files are replaced: the engine must let go of them
    this.archive = null; this.tiles = new Map(); // the map file, open for reading road names
    this.overture = null; this.addresses = null; this.addressIndex = null; this.overtureMeasured = null; // places and addresses from Overture Maps
  }

  get mapFile() { return path.join(this.dir, 'map.pmtiles'); }
  get segmentsDir() { return path.join(this.dir, 'routing', 'segments'); }

  async init() {
    await fsp.mkdir(this.dir, { recursive: true });
    this.map = await readJson(path.join(this.dir, 'map.json'));
    if (this.map && !fs.existsSync(this.mapFile)) this.map = null;
    this.placesInfo = await readJson(path.join(this.dir, 'places.json'));
    this.routing = await readJson(path.join(this.dir, 'routing.json'));
    if (this.routing && !fs.existsSync(this.segmentsDir)) this.routing = null;
    // Leftovers of an update that did not finish are not kept, except a map download that can carry on.
    await fsp.rm(path.join(this.dir, 'places.new'), { recursive: true, force: true });
    await fsp.rm(path.join(this.dir, 'overture.new'), { recursive: true, force: true });
    await fsp.rm(path.join(this.dir, 'addresses.new.dat'), { force: true });
    this.loadOverture();
  }

  rings(regionIds) {
    const picked = this.registry.regions.filter((r) => regionIds.includes(r.id));
    if (!picked.length) throw new Error('Choose at least one region.');
    return picked.flatMap((r) => r.rings);
  }

  status() {
    return {
      credit: this.registry.credit,
      regions: this.registry.regions.map(({ id, name, note, default: d }) => ({ id, name, note: note || '', default: Boolean(d) })),
      levels: this.registry.levels,
      map: this.map,
      places: this.placesInfo,
      measured: this.measured,
      routing: this.routing, routingMeasured: this.routingMeasured, routingCredit: this.registry.routing.credit,
      overture: this.overture, addresses: this.addresses, overtureMeasured: this.overtureMeasured, overtureCredit: this.registry.overture.credit,
      modes: routing.MODES.map(({ id, name, what }) => ({ id, name, what })),
      job: this.job ? { ...this.job, controller: undefined } : null,
      error: this.error,
      categories: this.registry.categories.map((c) => ({ id: c.id, group: c.group, name: c.name, note: c.note || '', count: this.placesInfo ? this.placesInfo.counts[c.id] || 0 : 0, extra: this.overture ? this.overture.counts[c.id] || 0 : 0 })),
      bytes: (this.map ? this.map.bytes : 0) + (this.placesInfo ? this.placesInfo.bytes || 0 : 0) + (this.routing ? this.routing.bytes : 0) + (this.overture ? this.overture.bytes || 0 : 0) + (this.addresses ? this.addresses.bytes || 0 : 0),
    };
  }

  begin(kind, extra = {}) {
    if (this.job) throw new Error('Something is already being fetched for the map. Wait for it, or stop it first.');
    this.error = null;
    this.job = { kind, controller: new AbortController(), ...extra };
    this.emit('changed');
    return this.job;
  }
  progress(patch) { if (this.job) { Object.assign(this.job, patch); this.emit('progress'); } }
  end(err) {
    const stopped = this.job && this.job.controller.signal.aborted;
    this.job = null;
    if (err && !stopped) this.error = err.message || String(err);
    this.emit('changed');
    return { stopped: Boolean(stopped) };
  }
  cancel() { if (this.job) this.job.controller.abort(); }

  /** The newest world map on the build server. */
  async latestBuild(signal) {
    const res = await this.fetch(this.rewrite(this.registry.builds.index), { signal, headers: { 'user-agent': this.agent } });
    if (!res.ok) throw new Error(`The list of map builds could not be read (the server answered ${res.status}).`);
    const list = (await res.json()).filter((b) => b && typeof b.key === 'string' && /\.pmtiles$/.test(b.key) && typeof b.size === 'number' && !Number.isNaN(Date.parse(b.uploaded)));
    if (!list.length) throw new Error('The list of map builds is empty.');
    list.sort((a, b) => Date.parse(b.uploaded) - Date.parse(a.uploaded));
    const b = list[0];
    return { key: b.key, version: b.version || '', uploaded: b.uploaded, size: b.size, url: this.registry.builds.base + b.key };
  }

  source(build) { return new extract.RangeSource(this.rewrite(build.url), { fetchImpl: this.fetch }); }

  /** How big each level of detail would be for these regions. Reads the world file's index only. */
  async measure(regionIds) {
    const job = this.begin('measure', { indexBytes: 0 });
    try {
      const rings = this.rings(regionIds);
      const build = await this.latestBuild(job.controller.signal);
      const m = await extract.measure(this.source(build), rings, { signal: job.controller.signal, onProgress: (p) => this.progress(p) });
      const sizes = new Map(m.zooms.map((z) => [z.zoom, z]));
      this.measured = {
        regions: regionIds, build: { key: build.key, uploaded: build.uploaded }, at: new Date().toISOString(),
        levels: this.registry.levels.filter((l) => l.zoom <= m.maxZoom).map((l) => ({ ...l, bytes: sizes.get(l.zoom).upTo, tiles: m.zooms.filter((z) => z.zoom <= l.zoom).reduce((a, z) => a + z.tiles, 0) })),
      };
      this.end();
      return this.measured;
    } catch (err) { const r = this.end(err); if (r.stopped) return null; throw err; }
  }

  /** Fetch the map for these regions down to `maxZoom`. The map in use stays until the new one is complete and checked. */
  async downloadMap(regionIds, maxZoom, { free = null } = {}) {
    const job = this.begin('map', { downloaded: 0, total: 0, stage: 'index' });
    const fresh = path.join(this.dir, 'map.new.pmtiles');
    try {
      const rings = this.rings(regionIds);
      const build = await this.latestBuild(job.controller.signal);
      const src = this.source(build);
      const p = await extract.plan(src, rings, maxZoom, { signal: job.controller.signal, onProgress: (x) => this.progress(x) });
      if (free != null && p.totalBytes + 512 * 1024 * 1024 > free) throw new Error(`The map needs ${Math.ceil(p.totalBytes / 1e9 * 10) / 10} GB and there is not enough free space for it. Choose less detail or fewer regions.`);
      this.progress({ stage: 'tiles', total: p.totalBytes });
      await extract.download(src, p, fresh, { signal: job.controller.signal, onProgress: (x) => this.progress(x) });
      this.progress({ stage: 'check' });
      const c = await extract.check(fresh);
      await this.closeArchive();
      await fsp.rm(this.mapFile, { force: true });
      await fsp.rename(fresh, this.mapFile);
      this.map = { build: build.key, version: build.version, built: build.uploaded, regions: regionIds, maxZoom: c.maxZoom, minZoom: c.minZoom, bounds: c.bounds, bytes: c.bytes, tiles: c.tiles, date: new Date().toISOString() };
      await writeJson(path.join(this.dir, 'map.json'), this.map);
      this.end();
      return this.map;
    } catch (err) { const r = this.end(err); if (r.stopped) return null; throw err; }
  }

  async ask(query, signal) {
    let lastErr = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const url = this.registry.overpass[attempt % this.registry.overpass.length];
      if (signal.aborted) throw new Error('Stopped.');
      try {
        const res = await this.fetch(this.rewrite(url), { method: 'POST', signal, timeoutMs: 330000, headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': this.agent }, body: `data=${encodeURIComponent(query)}` });
        if (!res.ok) drop(res);
        if (res.status === 429 || res.status === 504 || res.status === 503) { lastErr = new Error(`The places server is busy (it answered ${res.status}).`); await this.pause(15000 * (attempt + 1)); continue; }
        if (!res.ok) { lastErr = new Error(`The places server answered ${res.status}.`); await this.pause(5000); continue; }
        const body = await res.json();
        if (body.remark && /timed out|out of memory/i.test(body.remark)) return { tooBig: true };
        if (!Array.isArray(body.elements)) throw new Error('The places server sent something that is not a list of places.');
        return { elements: body.elements };
      } catch (err) {
        if (signal.aborted) throw err;
        lastErr = err;
        await this.pause(5000);
      }
    }
    throw lastErr;
  }

  /** Fetch every category of places for these regions. The places in use stay until the new set is complete. */
  async downloadPlaces(regionIds) {
    const job = this.begin('places', { done: 0, total: 0, found: 0 });
    const fresh = path.join(this.dir, 'places.new');
    try {
      const rings = this.rings(regionIds);
      const cats = this.registry.categories;
      const queue = places.boxesOf(rings, 10).map((box) => ({ box, depth: 0 }));
      const byCat = new Map(cats.map((c) => [c.id, []]));
      const seen = new Set();
      let done = 0;
      this.progress({ total: queue.length });
      while (queue.length) {
        const { box, depth } = queue.shift();
        const r = await this.ask(places.queryFor(cats, box), job.controller.signal);
        if (r.tooBig) {
          if (depth >= 4) throw new Error('The places server could not answer for one area even in small pieces. Try again later.');
          queue.unshift(...places.quarter(box).map((b) => ({ box: b, depth: depth + 1 })));
          this.progress({ total: done + queue.length });
          continue;
        }
        for (const el of r.elements) {
          const rec = places.recordOf(cats, el);
          if (!rec || seen.has(rec.i) || !places.inRings(rings, rec.o, rec.a)) continue;
          seen.add(rec.i);
          byCat.get(rec.c).push(rec);
        }
        done += 1;
        this.progress({ done, total: done + queue.length, found: seen.size });
        if (queue.length) await this.pause(2000); // the server is shared and free: no hurry
      }
      await fsp.rm(fresh, { recursive: true, force: true });
      await fsp.mkdir(fresh, { recursive: true });
      const counts = {}; let bytes = 0;
      for (const [id, items] of byCat) {
        items.sort((a, b) => a.a - b.a || a.o - b.o);
        for (const it of items) delete it.c;
        const file = path.join(fresh, `${id}.json`);
        await fsp.writeFile(file, JSON.stringify({ v: 1, items }));
        counts[id] = items.length; bytes += (await fsp.stat(file)).size;
      }
      const live = path.join(this.dir, 'places');
      await fsp.rm(live, { recursive: true, force: true });
      await fsp.rename(fresh, live);
      this.placesInfo = { regions: regionIds, date: new Date().toISOString(), total: seen.size, counts, bytes };
      await writeJson(path.join(this.dir, 'places.json'), this.placesInfo);
      this.loaded.clear();
      this.end();
      return this.placesInfo;
    } catch (err) { await fsp.rm(fresh, { recursive: true, force: true }).catch(() => {}); const r = this.end(err); if (r.stopped) return null; throw err; }
  }

  // ---------------------------------------------------------------- routing data

  /** The routing files for these regions as they are on the server now: name and size. Squares with no roads have no file. */
  async listRouting(regionIds, signal) {
    const names = routing.segmentsFor(this.rings(regionIds));
    const files = [];
    for (let i = 0; i < names.length; i++) {
      if (signal.aborted) throw new Error('Stopped.');
      const res = await this.fetch(this.rewrite(this.registry.routing.base + names[i]), { method: 'HEAD', signal, headers: { 'user-agent': this.agent } });
      drop(res);
      if (res.status === 404) { this.progress({ done: i + 1, total: names.length }); continue; }
      if (!res.ok) throw new Error(`The routing data server answered ${res.status} for ${names[i]}.`);
      const bytes = Number(res.headers.get('content-length'));
      if (!(bytes > 0)) throw new Error(`The routing data server did not say how big ${names[i]} is.`);
      files.push({ name: names[i], bytes });
      this.progress({ done: i + 1, total: names.length });
    }
    if (!files.length) throw new Error('The routing data server has no files for those regions.');
    return files;
  }

  /** How much routing data these regions take. Asks the server for sizes only. */
  async measureRouting(regionIds) {
    const job = this.begin('routing-measure', { done: 0, total: 0 });
    try {
      const files = await this.listRouting(regionIds, job.controller.signal);
      this.routingMeasured = { regions: regionIds, files: files.length, bytes: files.reduce((a, f) => a + f.bytes, 0), at: new Date().toISOString() };
      this.end();
      return this.routingMeasured;
    } catch (err) { const r = this.end(err); if (r.stopped) return null; throw err; }
  }

  /** One file, carried on from where a stopped download left it. */
  async fetchFile(url, dest, bytes, signal, onBytes) {
    const part = `${dest}.part`;
    for (let attempt = 0; ; attempt++) {
      let have = 0;
      try { have = (await fsp.stat(part)).size; } catch { have = 0; }
      if (have > bytes) { await fsp.rm(part, { force: true }); have = 0; }
      if (have === bytes) break;
      try {
        const res = await this.fetch(url, { signal, timeoutMs: 60000, headers: { 'user-agent': this.agent, ...(have ? { range: `bytes=${have}-` } : {}) } });
        if (res.status === 200 && have) { await fsp.rm(part, { force: true }); have = 0; } else if (res.status !== 200 && res.status !== 206) { drop(res); throw Object.assign(new Error(`The routing data server answered ${res.status}.`), { fatal: res.status === 404 || res.status === 403 }); }
        const fd = await fsp.open(part, have ? 'a' : 'w');
        try { for await (const chunk of res.body) { await fd.write(chunk); onBytes(chunk.length); if (signal.aborted) throw new Error('Stopped.'); } } finally { await fd.close(); }
      } catch (err) {
        let now = 0;
        try { now = (await fsp.stat(part)).size; } catch { now = 0; }
        if (now > have) attempt = -1; // it got further: a long file may be cut many times, and each time it carries on from there
        if (signal.aborted || err.fatal || attempt >= 5) throw err;
        await this.pause(3000 * (attempt + 2));
      }
    }
    await fsp.rename(part, dest);
  }

  /** Fetch the routing data for these regions. The data in use stays until every file of the new set is here. */
  async downloadRouting(regionIds, { free = null } = {}) {
    const job = this.begin('routing', { stage: 'list', done: 0, total: 0, downloaded: 0, bytes: 0 });
    const fresh = path.join(this.dir, 'routing', 'segments.new');
    try {
      const files = await this.listRouting(regionIds, job.controller.signal);
      const total = files.reduce((a, f) => a + f.bytes, 0);
      await fsp.mkdir(fresh, { recursive: true });
      // Files already fetched whole by a download that was stopped are kept; anything else in the folder is not.
      const wanted = new Map(files.map((f) => [f.name, f.bytes]));
      let downloaded = 0;
      for (const name of await fsp.readdir(fresh)) {
        const base = name.replace(/\.part$/, '');
        const size = (await fsp.stat(path.join(fresh, name))).size;
        if (!wanted.has(base) || (!name.endsWith('.part') && size !== wanted.get(base))) await fsp.rm(path.join(fresh, name), { force: true }); else downloaded += size;
      }
      if (free != null && total - downloaded + 256 * 1024 * 1024 > free) throw new Error(`The routing data needs ${Math.ceil(total / 1e8) / 10} GB and there is not enough free space for it. Choose fewer regions.`);
      this.progress({ stage: 'files', done: 0, total: files.length, bytes: total, downloaded });
      let done = 0;
      for (const f of files) {
        if (job.controller.signal.aborted) throw new Error('Stopped.');
        const dest = path.join(fresh, f.name);
        if (!fs.existsSync(dest)) await this.fetchFile(this.rewrite(this.registry.routing.base + f.name), dest, f.bytes, job.controller.signal, (n) => { downloaded += n; this.progress({ downloaded }); });
        if ((await fsp.stat(dest)).size !== f.bytes) throw new Error(`${f.name} came out the wrong size. Download the routing data again.`);
        done += 1;
        this.progress({ done });
      }
      await this.onRoutingSwap();
      await fsp.rm(this.segmentsDir, { recursive: true, force: true });
      await fsp.rename(fresh, this.segmentsDir);
      this.routing = { regions: regionIds, files: files.length, bytes: total, date: new Date().toISOString() };
      await writeJson(path.join(this.dir, 'routing.json'), this.routing);
      this.end();
      return this.routing;
    } catch (err) { const r = this.end(err); if (r.stopped) return null; throw err; }
  }

  // ---------------------------------------------------------------- road names, from the map

  async closeArchive() { const a = this.archive; this.archive = null; this.tiles.clear(); if (a) await a.close().catch(() => {}); }

  /**
   * The names of the roads at some points, read from the map file: Map of "lon,lat" to a name (or a
   * road number when the road has no name). The routing data has no names in it.
   */
  async roadNames(points) {
    const out = new Map();
    if (!this.map) return out;
    try {
      if (!this.archive) this.archive = await new extract.LocalArchive(this.mapFile).open();
      const a = this.archive;
      const z = Math.min(a.header.maxZoom, 14);
      for (const [lon, lat] of points) {
        const fx = pm.xOfLon(lon, z); const fy = pm.yOfLat(lat, z);
        const x = Math.floor(fx); const y = Math.floor(fy);
        const key = `${z}/${x}/${y}`;
        if (!this.tiles.has(key)) {
          let roads = null;
          const raw = await a.tile(z, x, y);
          if (raw) { try { roads = mvt.linesOf(a.header.tileCompression === pm.GZIP ? zlib.gunzipSync(raw) : raw, 'roads'); } catch { roads = null; } }
          if (this.tiles.size > 300) this.tiles.delete(this.tiles.keys().next().value);
          this.tiles.set(key, roads);
        }
        const roads = this.tiles.get(key);
        if (!roads) continue;
        // 30 metres, in the tile's own units, and never less than a few units: lines are simplified at low zooms.
        const metresPerUnit = (40075016.7 * Math.cos((lat * Math.PI) / 180)) / 2 ** z / roads.extent;
        const hit = mvt.nearestLine(roads.features, (fx - x) * roads.extent, (fy - y) * roads.extent, Math.max(6, 30 / metresPerUnit), (f) => f.properties.name || f.properties.ref);
        if (hit) out.set(`${lon},${lat}`, String(hit.feature.properties.name || hit.feature.properties.ref));
      }
    } catch (err) { this.log(`road names: ${err.message}`); }
    return out;
  }

  recordsOf(id) {
    if (!this.loaded.has(id)) {
      const read = (folder) => { try { return JSON.parse(fs.readFileSync(path.join(this.dir, folder, `${id}.json`), 'utf8')).items; } catch { return []; } };
      const items = this.placesInfo ? read('places') : [];
      // Places from Overture are added only where OpenStreetMap has no place of a like name close by.
      const extra = this.overture && this.overture.counts[id] ? places.fresh(items, read('overture')) : [];
      const all = extra.length ? items.concat(extra) : items;
      for (const it of all) it.c = id;
      this.loaded.set(id, all);
    }
    return this.loaded.get(id);
  }

  /** Search the places, and the addresses when the words read as one. `categories` limits it to some places; with none given, all are searched. */
  search({ q = '', categories = null, near = null, box = null, around = null, limit = 50 } = {}) {
    const chosen = Boolean(categories && categories.length);
    // `around` is where the map is looking: of two streets of one name, the nearer is listed first.
    const found = !chosen && !box && q.trim() ? this.findAddress(q, around || near).hits : [];
    const has = (id) => (this.placesInfo && this.placesInfo.counts[id]) || (this.overture && this.overture.counts[id]);
    const ids = (chosen ? categories : this.registry.categories.map((c) => c.id)).filter(has);
    let r = { total: 0, hits: [] };
    if (ids.length && (q.trim() || box || near || ids.length === 1)) {
      const all = [];
      for (const id of ids) for (const rec of this.recordsOf(id)) all.push(rec);
      r = places.search(all, { q, near, box, limit: Math.min(2000, Math.max(1, limit)) });
    }
    const names = new Map(this.registry.categories.map((c) => [c.id, c.name]));
    const hits = r.hits.map((h) => ({ ...h, kind: names.get(h.c) }));
    // An address found under the street name as typed goes first; a looser match goes after the places.
    return { total: r.total + found.length, hits: [...found.filter((h) => h.sure), ...hits, ...found.filter((h) => !h.sure)] };
  }

  // ---------------------------------------------------------------- Overture Maps: addresses and more places

  /** Read what has been fetched from Overture. */
  loadOverture() {
    this.overture = readJsonSync(path.join(this.dir, 'overture.json'));
    if (this.overture) delete this.overture.others; // a tally kept in the file for tuning, of no use to the window
    if (this.overture && !fs.existsSync(path.join(this.dir, 'overture'))) this.overture = null;
    const meta = readJsonSync(path.join(this.dir, 'addresses.json'));
    const dat = path.join(this.dir, 'addresses.dat');
    if (meta && Array.isArray(meta.offsets) && fs.existsSync(dat)) { const { offsets, ...summary } = meta; this.addresses = summary; this.addressIndex = new addresses.AddressIndex(dat, meta); } else { this.addresses = null; this.addressIndex = null; }
    this.loaded.clear();
  }

  /** Where a named town is, from the places, for an address whose town the address data names differently. */
  townAt(city, state, near) {
    if (!this.placesInfo || !this.placesInfo.counts.town) return null;
    const want = addresses.normCity(city);
    let best = null;
    for (const t of this.recordsOf('town')) {
      if (addresses.normCity(t.n) !== want) continue;
      const pop = t.x && t.x.population ? Number(String(t.x.population).replace(/\D/g, '')) || 0 : 0;
      const score = near ? -places.km(near[1], near[0], t.a, t.o) : pop;
      if (!best || score > best.score) best = { score, t };
    }
    return best ? best.t : null;
  }

  /**
   * Find a typed address. Returns { hits, tried }: hits are records like places, with `how` saying how the
   * point was arrived at ('exact', 'between', 'nearest', 'street' or 'town') and `approx` true for all but exact.
   */
  findAddress(text, near = null) {
    if (!this.addressIndex) return { hits: [], tried: false };
    const parsed = addresses.parse(text);
    if (!addresses.looksLikeAddress(parsed)) return { hits: [], tried: false };
    const r = this.addressIndex.find(text, { near, townAt: (city) => { const t = this.townAt(city, '', near); return t ? [t.o, t.a] : null; } });
    const hits = r.hits.map((h) => ({ c: 'address', i: `ad${h.lon},${h.lat}`, a: h.lat, o: h.lon, n: h.label, d: h.note, kind: 'Address', how: h.how, approx: h.how !== 'exact', sure: h.sure, km: h.km }));
    const loc = r.parsed && r.parsed.loc;
    if (!hits.length && parsed.number != null && loc && loc.city) {
      // Neither the number nor the street could be placed: the town is still a place to head for.
      const t = this.townAt(loc.city, loc.state, near);
      if (t) hits.push({ c: 'address', i: `ad${t.o},${t.a}`, a: t.a, o: t.o, n: `${t.n}${loc.state ? `, ${loc.state}` : ''}`, d: `Approximate. ${r.street ? 'That street was not found in this town' : 'That street is not'} in the address data, so this points at the town itself.`, kind: 'Address', how: 'town', approx: true, sure: true, km: near ? Math.round(places.km(near[1], near[0], t.a, t.o) * 10) / 10 : null });
    }
    return { hits, tried: true };
  }

  /** Measure what the regions need from Overture: rows and bytes of addresses and of places. Downloads only the files' footers. */
  async measureOverture(regionIds) {
    const job = this.begin('overture', { stage: 'measure', what: 'places', done: 0, total: 0 });
    try {
      const net = new overture.Net({ fetchImpl: this.fetch, rewrite: this.rewrite, agent: this.agent, signal: job.controller.signal, ...(this.base ? { pause: this.pause } : {}) });
      const m = await overture.measure({ cfg: this.registry.overture, rings: this.rings(regionIds), net, onProgress: (p) => this.progress(p) });
      this.overtureMeasured = { ...m, regions: regionIds, at: Date.now() };
      this.end();
      return this.overtureMeasured;
    } catch (err) { const r = this.end(err); if (r.stopped) return null; throw err; }
  }

  /**
   * Fetch places, addresses or both from Overture for these regions. What is in use stays until the new
   * set is complete. The work is done on another thread; a stopped fetch carries on where it was next time.
   */
  async downloadOverture(regionIds, { kinds = ['places', 'addresses'], free = null, inline = false } = {}) {
    const job = this.begin('overture', { stage: 'list', what: kinds[0], done: 0, total: 0, downloaded: 0, bytes: 0, kept: 0 });
    try {
      const rings = this.rings(regionIds);
      const m = this.overtureMeasured;
      if (free != null && m && kinds.includes('addresses') && m.addresses) {
        // While it is built, the index needs room for its working files as well as itself.
        const need = m.addresses.rows * 60 + 512 * 1024 * 1024;
        if (need > free) throw new Error(`Building the address index needs about ${Math.ceil(need / 1e8) / 10} GB of free space while it works, and there is not that much. Choose fewer regions.`);
      }
      const data = { dir: this.dir, cfg: this.registry.overture, categories: this.registry.categories.map(({ id, overture: o }) => ({ id, overture: o || [] })), rings, regions: regionIds, kinds, base: this.base, agent: this.agent, fast: Boolean(this.base) };
      const result = await this.runOverture(data, job, inline);
      this.loadOverture();
      this.end();
      return result;
    } catch (err) { this.loadOverture(); const r = this.end(err); if (r.stopped) return null; throw err; }
  }

  runOverture(data, job, inline) {
    const signal = job.controller.signal;
    if (inline) return overture.run({ ...data, signal }, (patch) => this.progress(patch));
    return new Promise((resolve, reject) => {
      // In the installed app the worker's files are kept outside the archive the rest of the app is in.
      let file = path.join(__dirname, 'overture-worker.js');
      const outside = file.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
      if (outside !== file && fs.existsSync(outside)) file = outside;
      let worker = null; let settled = false; let heard = false;
      const onAbort = () => { if (worker) worker.terminate(); settle(reject, new Error('Stopped.')); };
      const settle = (fn, v) => { if (settled) return; settled = true; signal.removeEventListener('abort', onAbort); fn(v); };
      const fallBack = (why) => { this.log(`maps: the worker thread could not start (${why}); doing the work on the main thread`); settle(resolve, this.runOverture(data, job, true)); };
      try { worker = new Worker(file, { workerData: data, resourceLimits: { maxOldGenerationSizeMb: 4096 } }); } catch (err) { fallBack(err.message); return; }
      signal.addEventListener('abort', onAbort, { once: true });
      worker.on('message', (m) => { heard = true; if (m.type === 'progress') this.progress(m.patch); else if (m.type === 'done') settle(resolve, m.result); else settle(reject, new Error(m.message)); });
      worker.on('error', (err) => { if (!heard) fallBack(err.message); else settle(reject, err); });
      worker.on('exit', (code) => settle(reject, new Error(`The work on the Overture data stopped unexpectedly (code ${code}).`)));
    });
  }
}

const readJsonSync = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

module.exports = { MapsLibrary, loadRegistry };
