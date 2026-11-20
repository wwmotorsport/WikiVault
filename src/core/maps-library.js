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
const crypto = require('node:crypto');
const places = require('./places');
const placeSort = require('./place-sort');
const hospitals = require('./hospitals');
const central = require('./central-places');
/** The name an extract goes by in the extract server's index: the last part of its path, without the ending. */
const extractKey = (p) => String(p).split('/').pop().replace(/-latest\.osm\.pbf$/, '');
const read1 = (dir, kind) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'overture', `${kind}.json`), 'utf8')).items; } catch { return []; } };
const placesExtract = require('./places-extract');
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

// What one question to a places server claims of it, and how long the app waits for the answer: the claim, a wait
// for a free slot, and the sending. A question that claims little is let in sooner, and one that is too big for
// its claim says so quickly and is cut into four.
const PLACES_CLAIM = { timeout: 120, maxsize: 256 * 1024 * 1024 };
const PLACES_WAIT = 170000;

/** Free bytes on the drive a folder is on, or null when that cannot be asked. */
async function freeAt(dir) {
  try { const s = await fsp.statfs(dir); const free = Number(s.bavail) * Number(s.bsize); return Number.isFinite(free) ? free : null; } catch { return null; }
}
const bytesText = (n) => (n >= 1e9 ? `${Math.round(n / 1e8) / 10} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);
/** The MD5 of a file, read in pieces. */
function md5Of(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    fs.createReadStream(file).on('data', (c) => hash.update(c)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}

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
    this.sizesFresh = 5 * 60000; // how long an answer about an extract's size is trusted before the file is fetched
    this.dir = dir; this.registry = registry; this.fetch = fetchImpl; this.base = base; this.rewrite = rewrite; this.pause = pause; this.agent = agent; this.log = log;
    this.map = null; this.placesInfo = null; this.measured = null; this.job = null; this.error = null;
    this.loaded = new Map(); // category id -> records
    this.routing = null; this.routingMeasured = null;
    this.onRoutingSwap = async () => {}; // called before the routing files are replaced: the engine must let go of them
    this.archive = null; this.tiles = new Map(); // the map file, open for reading road names
    this.overture = null; this.addresses = null; this.addressIndex = null; this.overtureMeasured = null; this.gaz = null; this.gazCities = new Map(); this.gazBuilding = false; // places and addresses from Overture Maps
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
    this.placesDone = new Set(); this.placesMeasured = null; this.placesSizes = null;
    { const st = await readJson(path.join(this.dir, 'places.work', 'state.json')); if (st && st.v === 2 && st.done) this.placesDone = new Set(Object.keys(st.done)); this.placesKept = st && st.v === 2 && st.done && Object.keys(st.done).length ? { regions: st.regions || [], done: Object.keys(st.done).length, total: st.total || Object.keys(st.done).length, how: 'extract' } : st && st.v === 1 && st.done && st.done.length ? { regions: st.regions || [], done: st.done.length, total: st.done.length + st.todo.length } : null; } // a fetch of the places that did not finish
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
      placesKept: this.placesKept || null,
      placesMeasured: this.placesMeasured ? { ...this.placesMeasured, left: this.placesMeasured.how === 'central' ? this.placesMeasured.bytes : this.placesLeft() } : null,
      placesHow: this.registry.extracts ? 'extract' : 'pieces',
      placesCentralWhy: this.centralWhy || null,
      measured: this.measured,
      routing: this.routing, routingMeasured: this.routingMeasured, routingCredit: this.registry.routing.credit,
      overture: this.overture, addresses: this.addresses, addressTowns: this.gaz ? { towns: Object.keys(this.gaz.towns).length, zips: Object.keys(this.gaz.zips).length, ...(this.gaz.stats || {}) } : null, overtureMeasured: this.overtureMeasured, overtureCredit: this.registry.overture.credit,
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

  /** Put one question to a places server. `prefer` says which server to try first, so two questions at once go to two servers. */
  async ask(query, signal, prefer = 0) {
    let lastErr = null;
    const servers = this.registry.overpass;
    for (let attempt = 0; attempt < 4; attempt++) {
      const url = servers[(prefer + attempt) % servers.length];
      if (signal.aborted) throw new Error('Stopped.');
      try {
        const res = await this.fetch(this.rewrite(url), { method: 'POST', signal, timeoutMs: PLACES_WAIT, gzip: true, headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': this.agent }, body: `data=${encodeURIComponent(query)}` });
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

  placesKey(regionIds) { return crypto.createHash('sha1').update(JSON.stringify([regionIds.slice().sort(), this.registry.categories.map((c) => [c.id, c.filters])])).digest('hex').slice(0, 16); }

  /**
   * Fetch every category of places for these regions. The places in use stay until the new set is complete.
   *
   * The places server is free and shared, and answers one area at a time, slowly and not always. So the regions
   * are cut into pieces, the pieces are asked for two at a time (one of each server), and every answer is put on
   * disk in `places.work` as it arrives. A run that fails or is stopped keeps what it has: the next run for the
   * same regions asks only for the pieces still missing. A piece that fails goes to the back of the queue and is
   * tried again later; the run gives up only when one piece has failed three times.
   *
   * The servers let a question in sooner the less time and memory it claims, and their rules allow one question
   * at a time from one program. So speed comes from asking for little at once, not from asking more at once:
   * small pieces, a short time limit, and an answer that is sent compressed. The pieces nearest `near` ({lat, lon})
   * come first, and while no complete set is in use, what has arrived is put to use as it comes.
   */
  async downloadPlaces(regionIds, { near = null, how = null, free = null } = {}) {
    // The ready-made set first, when there is one for these regions; else the places are built here from extracts.
    if (how === null || how === 'central') {
      const m = await this.centralManifest(regionIds);
      if (m) return this.downloadPlacesCentral(regionIds, m);
      if (how === 'central') throw new Error(`The ready-made set of places could not be used (${this.centralWhy || 'it could not be reached'}). The places can still be built on this computer: see Another way.`);
    }
    const via = how === 'pieces' || how === 'extract' ? how : this.registry.extracts ? 'extract' : 'pieces';
    return via === 'extract' ? this.downloadPlacesExtracts(regionIds, { near, free }) : this.downloadPlacesPieces(regionIds, { near });
  }

  async downloadPlacesPieces(regionIds, { near = null } = {}) {
    const job = this.begin('places', { how: 'pieces', done: 0, total: 0, found: 0 });
    const fresh = path.join(this.dir, 'places.new');
    const work = path.join(this.dir, 'places.work');
    const stateFile = path.join(work, 'state.json');
    let state = null;
    try {
      const rings = this.rings(regionIds);
      const cats = this.registry.categories;
      const signal = job.controller.signal;
      const key = this.placesKey(regionIds);
      const step = this.registry.placesStep || 2.5;
      state = await readJson(stateFile);
      if (!state || state.v !== 1 || state.key !== key) {
        await fsp.rm(work, { recursive: true, force: true });
        await fsp.mkdir(work, { recursive: true });
        state = { v: 1, key, step, regions: regionIds, next: 0, found: 0, done: [], todo: places.boxesOf(rings, step).map((box) => ({ box, depth: 0 })) };
        await writeJson(stateFile, state);
      } else {
        // Pieces left over from a version that asked for larger ones are cut down to today's size; what is here is kept.
        for (let was = state.step || 5; was > step * 1.5; was /= 2) state.todo = state.todo.flatMap((p) => (p.depth ? [p] : places.quarter(p.box).filter((b) => places.boxTouches(rings, b)).map((box) => ({ box, depth: 0 }))));
        state.step = step;
        if (state.done.length) this.log(`places: carrying on, ${state.done.length} of ${state.done.length + state.todo.length} pieces already here`);
      }
      for (const p of state.todo) { p.busy = false; p.fails = 0; }
      // Nearest first: the places around home are the ones wanted soonest.
      if (near && Number.isFinite(near.lat) && Number.isFinite(near.lon)) {
        const far = (p) => places.km(near.lat, near.lon, (p.box[0] + p.box[2]) / 2, (p.box[1] + p.box[3]) / 2);
        state.todo.sort((a, b) => far(a) - far(b));
      }
      // What arrives is put to use as it comes, unless a complete set is in use: that one stays until the new one is whole.
      const early = !this.placesInfo || Boolean(this.placesInfo.partial);
      let shown = this.placesInfo && this.placesInfo.partial && this.placesInfo.partial.key === key ? this.placesInfo.partial.done : 0;
      const started = Date.now(); let answered = 0; let spent = 0;
      const save = () => writeJson(stateFile, { ...state, todo: state.todo.map(({ box, depth }) => ({ box, depth })) });
      const tell = () => { const at = { done: state.done.length, total: state.done.length + state.todo.length }; this.placesKept = at.done ? { regions: regionIds, ...at } : null; this.progress({ ...at, found: state.found }); };
      tell();
      let failure = null;
      let writing = Promise.resolve();
      const worker = async (n) => {
        for (;;) {
          if (failure || signal.aborted) return;
          const piece = state.todo.find((p) => !p.busy);
          if (!piece) { if (!state.todo.length) return; await new Promise((r) => setTimeout(r, 40)); continue; } // another may still cut its piece into smaller ones
          piece.busy = true;
          let r = null;
          const asked = Date.now();
          try { r = await this.ask(places.queryFor(cats, piece.box, PLACES_CLAIM), signal, n); } catch (err) {
            if (signal.aborted) return;
            piece.fails += 1; piece.busy = false;
            this.log(`places: a piece failed (${piece.fails} of 3): ${err.message}`);
            if (piece.fails >= 3) { failure = err; return; }
            state.todo.splice(state.todo.indexOf(piece), 1); state.todo.push(piece); // later, after the others
            await this.pause(10000);
            continue;
          }
          if (r.tooBig) {
            if (piece.depth >= 4) { failure = new Error('The places server could not answer for one area even in small pieces. Try again later.'); return; }
            state.todo.splice(state.todo.indexOf(piece), 1, ...places.quarter(piece.box).map((b) => ({ box: b, depth: piece.depth + 1, busy: false, fails: 0 })));
          } else {
            const recs = [];
            for (const el of r.elements) { const rec = places.recordOf(cats, el); if (rec && places.inRings(rings, rec.o, rec.a)) recs.push(rec); }
            const name = `p${state.next++}.json`;
            // One answer at a time goes to disk, and the list of what is done is only updated once it is there.
            writing = writing.then(async () => {
              await fsp.writeFile(path.join(work, name), JSON.stringify(recs)); state.todo.splice(state.todo.indexOf(piece), 1); state.done.push(name); state.found += recs.length; await save();
              answered += 1; spent += Date.now() - asked;
              if (answered % 20 === 0) this.log(`places: ${state.done.length} of ${state.done.length + state.todo.length} pieces, ${state.found} places; the last 20 answers took ${Math.round(spent / 20000)} s each on average, ${Math.round((Date.now() - started) / 60000)} min since this run began`), spent = 0;
              // The first piece at once (it is the nearest), then every so often.
              const every = Math.max(10, Math.ceil((state.done.length + state.todo.length) / 20));
              if (early && state.todo.length && (!shown || state.done.length - shown >= every)) {
                shown = state.done.length;
                await this.putPlaces(work, state.done, cats, regionIds, { key, done: state.done.length, total: state.done.length + state.todo.length }).catch((err) => this.log(`places: what is here could not be put to use yet: ${err.message}`));
              }
            });
            await writing;
          }
          tell();
          if (state.todo.length) await this.pause(1500); // the server is shared and free: no hurry
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, Math.min(3, this.registry.overpass.length)) }, (_, n) => worker(n)));
      await writing.catch(() => {});
      if (signal.aborted) throw new Error('Stopped.');
      if (failure) throw failure;

      // Every piece is here: put them together.
      await this.putPlaces(work, state.done, cats, regionIds, null);
      await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
      this.placesKept = null;
      this.end();
      return this.placesInfo;
    } catch (err) {
      await fsp.rm(fresh, { recursive: true, force: true }).catch(() => {});
      const kept = state && state.done && state.done.length ? ` ${state.done.length} of ${state.done.length + state.todo.length} pieces are already here and are kept: fetch the places again and it carries on from there.` : '';
      const r = this.end(kept && !/carries on from there/.test(err.message) ? Object.assign(err, { message: `${err.message}${kept}` }) : err);
      if (r.stopped) return null;
      throw err;
    }
  }

  // ---------------------------------------------------------------- places, from regional extracts

  /** The extract files that hold these regions: [{ id, name, url, at: [lat, lon] }]. */
  /**
   * Where each extract is today, from the extract server's own index. The server has moved its files before (each into
   * a folder of its own, in November 2026), and its index is the one place that always says where they are. The
   * addresses in the app's list are used when the index cannot be read, or does not name a file.
   */
  async learnExtractUrls(signal = null) {
    const x = this.registry.extracts;
    if (!x || !x.index || (this.extractUrlsAt && Date.now() - this.extractUrlsAt < 6 * 3600000)) return;
    try {
      const res = await this.fetch(this.rewrite(x.index), { signal, timeoutMs: 30000, headers: { 'user-agent': this.agent } });
      if (!res.ok) throw new Error(`the server answered ${res.status}`);
      const urls = new Map();
      for (const f of (await res.json()).features || []) { const p = f.properties || {}; const u = p.urls && p.urls.pbf; if (typeof p.id === 'string' && typeof u === 'string' && u.startsWith(x.base) && /-latest\.osm\.pbf$/.test(u)) urls.set(p.id.split('/').pop(), u); }
      if (urls.size) { this.extractUrls = urls; this.extractUrlsAt = Date.now(); }
    } catch (err) { if (signal && signal.aborted) throw err; this.log(`places: the extract server's index could not be read (${err.message}); the addresses in the app's list are used`); }
  }

  extractsFor(regionIds) {
    const x = this.registry.extracts;
    if (!x) throw new Error('This version has no list of regional extracts.');
    const out = [];
    for (const id of regionIds) for (const e of (x.regions[id] || [])) if (!out.some((o) => o.id === e.id)) out.push({ id: e.id, name: e.name, url: (this.extractUrls && this.extractUrls.get(extractKey(e.path))) || x.base + e.path, at: e.at });
    if (!out.length) throw new Error('Choose at least one region.');
    return out;
  }

  /** How many bytes of the measured extracts are still to download: what was measured, less the files already read. */
  placesLeft() {
    const m = this.placesMeasured;
    if (!m) return null;
    let left = 0;
    for (const [id, bytes] of Object.entries(m.per)) if (!this.placesDone || !this.placesDone.has(id)) left += bytes;
    return left;
  }

  /**
   * Ask the server where today's copy of each extract is and how big it is. Nothing is downloaded.
   * Returns { id: { dated, bytes } | { missing: true } }. An answer less than an hour old is used again.
   */
  async extractSizes(files, signal, onOne = () => {}, anew = false) {
    const fresh = !anew && this.placesSizes && Date.now() - this.placesSizes.at < 3600000 ? this.placesSizes.by : {};
    const by = {};
    let n = 0;
    for (const f of files) {
      if (signal.aborted) throw new Error('Stopped.');
      if (fresh[f.id] && !fresh[f.id].missing) by[f.id] = fresh[f.id];
      else {
        const res = await this.fetch(this.rewrite(f.url), { method: 'HEAD', signal, timeoutMs: 30000, headers: { 'user-agent': this.agent } });
        drop(res);
        const bytes = Number(res.headers.get('content-length'));
        if (res.status === 404) { by[f.id] = { missing: true }; this.log(`places: ${f.name} is not where it was looked for (${res.url || f.url} answered 404)`); }
        else if (!res.ok || !(bytes > 0)) throw new Error(`The extract server could not say how big ${f.name} is (it answered ${res.status}). Try again later.`);
        else by[f.id] = { dated: res.url || this.rewrite(f.url), bytes, asked: Date.now() };
      }
      onOne(++n);
    }
    this.placesSizes = { at: this.placesSizes && !anew ? this.placesSizes.at : Date.now(), by: { ...(this.placesSizes ? this.placesSizes.by : {}), ...by } };
    return by;
  }

  /** Throw away what an unfinished fetch of the places had got: the working files, not the places in use. Nothing while one is running. */
  async discardPlacesWork() {
    if (this.job) return false;
    await fsp.rm(path.join(this.dir, 'places.work'), { recursive: true, force: true }).catch(() => {});
    this.placesKept = null; this.placesDone = new Set();
    return true;
  }

  /** How much there is to download for the places of these regions. Reads no map data. */
  /**
   * The manifest of the ready-made set of places (see central-places.js), or null when there is none that this
   * version can use for these regions; `this.centralWhy` then says why, for the log and the window.
   */
  async centralManifest(regionIds, signal = null) {
    const c = this.registry.central; this.centralWhy = null;
    if (!c || !c.manifest) { this.centralWhy = 'this version has no address for it'; return null; }
    try {
      const res = await this.fetch(this.rewrite(c.manifest), { signal, timeoutMs: 20000, headers: { 'user-agent': this.agent } });
      if (!res.ok) { this.centralWhy = `the server answered ${res.status}`; return null; }
      const m = await res.json();
      const why = central.unusable(m, regionIds, c.maxAgeDays || 60);
      if (why) { this.centralWhy = why; return null; }
      return m;
    } catch (err) { if (signal && signal.aborted) throw err; this.centralWhy = `it could not be reached (${err.message})`; return null; } finally { if (this.centralWhy) this.log(`places: no ready-made set (${this.centralWhy}); they will be built here`); }
  }

  /** Fetch the ready-made set of places and put it to use. A few dozen small files, each checked against the list. */
  async downloadPlacesCentral(regionIds, m) {
    const job = this.begin('places', { how: 'central', stage: 'files', done: 0, total: m.files.length, bytes: m.bytes, downloaded: 0, left: m.bytes, found: 0 });
    const work = path.join(this.dir, 'places.central');
    try {
      const signal = job.controller.signal;
      const rings = this.rings(regionIds);
      await fsp.mkdir(work, { recursive: true });
      const base = this.registry.central.manifest.replace(/[^/]+$/, '');
      let got = 0;
      for (const [n, f] of m.files.entries()) {
        if (signal.aborted) throw new Error('Stopped.');
        const dest = path.join(work, f.name);
        // A file already here from a try that was stopped is kept when it is the file the list describes.
        const have = await fsp.readFile(dest).then((b) => central.sha256(b), () => null);
        if (have !== f.sha256) {
          await fsp.rm(dest, { force: true });
          await this.fetchFile(this.rewrite(base + f.name), dest, f.bytes, signal, (b) => this.progress({ downloaded: got + b, left: Math.max(0, m.bytes - got - b) }), 'places');
          if (central.sha256(await fsp.readFile(dest)) !== f.sha256) { await fsp.rm(dest, { force: true }); throw new Error(`${f.name} arrived damaged (it does not match its checksum). Fetch the places again; if it keeps failing, the places can be built on this computer instead (Other ways, under Fetch the places).`); }
        }
        got += f.bytes; this.progress({ done: n + 1, downloaded: got, left: m.bytes - got });
      }
      this.progress({ stage: 'read', readDone: 0, readTotal: m.files.length });
      const all = (m.regions || []).every((r) => regionIds.includes(r));
      const out = await central.install({ dir: this.dir, from: work, manifest: m, regionIds, inside: all ? null : (lon, lat) => places.inRings(rings, lon, lat), onProgress: (p) => this.progress(p) });
      await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
      await fsp.rm(path.join(this.dir, 'places.work'), { recursive: true, force: true }).catch(() => {});
      this.placesInfo = out.places; this.placesKept = null;
      this.log(`places: the ready-made set of ${String(m.built).slice(0, 10)}: ${out.places.total} places from OpenStreetMap${out.overture ? ` and ${out.overture.total} from Overture Maps (release ${out.overture.release})` : ''}, ${m.bytes} bytes fetched`);
      this.loadOverture();
      this.end();
      return this.placesInfo;
    } catch (err) {
      // What is on the computer is untouched. The other way to the same places is always there, and is named.
      if (!/Other ways/.test(err.message) && !/Stopped/.test(err.message)) err.message = `The ready-made set of places could not be fetched (${err.message}). What is on this computer is unchanged. Try again, or build the places on this computer instead: Other ways, under Fetch the places.`;
      const r = this.end(err); if (r.stopped) return null; throw err;
    }
  }

  async measurePlaces(regionIds) {
    // The ready-made set, when there is one: its size is in its list.
    const m = await this.centralManifest(regionIds);
    if (m) {
      this.placesMeasured = { regions: regionIds, how: 'central', files: m.files.length, bytes: m.bytes, largest: Math.max(...m.files.map((f) => f.raw || f.bytes)), per: {}, missing: [], date: new Date().toISOString(), built: m.built, osm: m.osm.total, overture: m.overture ? m.overture.total : 0 };
      return { ...this.placesMeasured, left: m.bytes };
    }
    await this.learnExtractUrls();
    const files = this.extractsFor(regionIds);
    const job = this.begin('places-measure', { done: 0, total: files.length });
    try {
      const by = await this.extractSizes(files, job.controller.signal, (done) => this.progress({ done }));
      const per = {}; const missing = [];
      for (const f of files) { if (by[f.id].missing) missing.push(f.name); else per[f.id] = by[f.id].bytes; }
      const sizes = Object.values(per);
      this.placesMeasured = { regions: regionIds, files: files.length, bytes: sizes.reduce((a, b) => a + b, 0), largest: sizes.length ? Math.max(...sizes) : 0, per, missing, date: new Date().toISOString() };
      this.end();
      return { ...this.placesMeasured, left: this.placesLeft() };
    } catch (err) { const r = this.end(err); if (r.stopped) return null; throw err; }
  }

  /**
   * Fetch the places from regional OpenStreetMap extracts: one file to a state or province, downloaded whole,
   * read on this computer, and deleted. A download server is glad to send a whole file, where the servers that
   * answer questions are slow and often busy; so this is quicker by far, at the price of downloading much more
   * than is kept. The files nearest `near` come first, and (while no complete set is in use) what has been read
   * is put to use as it comes. A run that stops keeps what it has read and the part of a file it had fetched.
   */
  async downloadPlacesExtracts(regionIds, { near = null } = {}) {
    const job = this.begin('places', { how: 'extract', stage: 'sizes', done: 0, total: 0, found: 0 });
    const work = path.join(this.dir, 'places.work');
    const stateFile = path.join(work, 'state.json');
    try {
      const rings = this.rings(regionIds);
      const cats = this.registry.categories;
      const signal = job.controller.signal;
      const key = `x:${this.placesKey(regionIds)}`;
      await this.learnExtractUrls(signal);
      const files = this.extractsFor(regionIds);
      let state = await readJson(stateFile);
      if (!state || state.v !== 2 || state.key !== key) {
        await fsp.rm(work, { recursive: true, force: true });
        await fsp.mkdir(work, { recursive: true });
        state = { v: 2, how: 'extract', key, regions: regionIds, total: files.length, next: 0, found: 0, at: {}, done: {} };
        await writeJson(stateFile, state);
      } else if (Object.keys(state.done).length) this.log(`places: carrying on, ${Object.keys(state.done).length} of ${files.length} extracts already read`);
      state.total = files.length;
      this.placesDone = new Set(Object.keys(state.done));
      const save = () => writeJson(stateFile, state);
      const count = () => Object.keys(state.done).length;
      const tell = (patch = {}) => { this.placesKept = count() ? { regions: regionIds, done: count(), total: files.length, how: 'extract' } : null; this.progress({ done: count(), total: files.length, found: state.found, ...patch }); };
      // Nearest first: the places around home are the ones wanted soonest.
      const todo = files.filter((f) => !state.done[f.id]);
      if (near && Number.isFinite(near.lat) && Number.isFinite(near.lon)) todo.sort((a, b) => places.km(near.lat, near.lon, a.at[0], a.at[1]) - places.km(near.lat, near.lon, b.at[0], b.at[1]));
      // Where today's copy of each file is, and how big. A file part-fetched on an earlier day is carried on from the copy it came from.
      tell({ stage: 'sizes', sized: 0, sizes: todo.length });
      const asked = await this.extractSizes(todo.filter((f) => !(state.at[f.id] && fs.existsSync(path.join(work, `${f.id}.osm.pbf.part`)))), signal, (sized) => this.progress({ sized }));
      for (const [id, v] of Object.entries(asked)) state.at[id] = v;
      await save();
      const sizeOf = (f) => (state.at[f.id] && state.at[f.id].bytes) || 0;
      const bytes = todo.reduce((a, f) => a + sizeOf(f), 0);
      let downloaded = 0;
      const early = !this.placesInfo || Boolean(this.placesInfo.partial);
      let shown = this.placesInfo && this.placesInfo.partial && this.placesInfo.partial.key === key ? this.placesInfo.partial.done : 0;
      const every = Math.max(3, Math.ceil(files.length / 10));
      const started = Date.now();
      const failed = new Map(); // file id -> why

      const copyOf = (info) => { try { return path.posix.basename(new URL(info.dated).pathname); } catch { return String(info.dated); } };
      const ask = async (f) => { const info = (await this.extractSizes([f], signal, () => {}, true))[f.id]; state.at[f.id] = info; await save(); return info; };
      const one = async (f) => {
        let info = state.at[f.id];
        const dest = path.join(work, `${f.id}.osm.pbf`);
        const before = downloaded;
        // Room for the file while it is read: it is deleted straight after.
        const room = await freeAt(this.dir);
        let have = 0;
        try { have = (await fsp.stat(`${dest}.part`)).size; } catch { have = 0; }
        // The server replaces every file once a day, and a long run can straddle that. So unless part of this file is
        // already here, where it is and how big is asked again just before it is fetched, not taken from the start of the run.
        if (!have && !fs.existsSync(dest) && (!info || info.missing || !(Date.now() - (info.asked || 0) < this.sizesFresh))) info = await ask(f);
        if (!info || info.missing) throw Object.assign(new Error(`${f.name} is not on the extract server.`), { fatal: true });
        if (room != null && info.bytes - have + 300 * 1024 * 1024 > room) throw Object.assign(new Error(`There is not enough free space to fetch ${f.name}: it needs ${bytesText(info.bytes - have)} while it is read, and ${bytesText(room)} is free. Free some space, or fetch the places the slow way, which needs very little.`), { fatal: true, stop: true });
        tell({ stage: 'download', file: f.name, fileBytes: info.bytes, bytes, downloaded: downloaded + have });
        downloaded += have;
        let whole = false; // fetched on an earlier run, and not yet read
        try { whole = (await fsp.stat(dest)).size === info.bytes; } catch { whole = false; }
        if (whole) { downloaded += info.bytes; this.progress({ downloaded }); }
        else try {
          await this.fetchFile(this.rewrite(info.dated), dest, info.bytes, signal, (n) => { downloaded += n; this.progress({ downloaded }); }, 'extract');
        } catch (err) {
          if (!(err.status === 404 || err.status === 416 || err.changed) || signal.aborted) throw err;
          // The copy this was coming from has been taken off the server or replaced: begin again from today's.
          this.log(`places: ${f.name}: ${copyOf(info)} is no longer what it was on the server (${err.message}); beginning again from today's copy`);
          await fsp.rm(`${dest}.part`, { force: true });
          info = await ask(f);
          if (info.missing) throw Object.assign(new Error(`${f.name} is not on the extract server.`), { fatal: true });
          downloaded = before;
          await this.fetchFile(this.rewrite(info.dated), dest, info.bytes, signal, (n) => { downloaded += n; this.progress({ downloaded }); }, 'extract');
        }
        // The server publishes a checksum beside each file. When it is there, the file must match it.
        this.progress({ stage: 'check' });
        const sum = await this.fetch(`${this.rewrite(info.dated)}.md5`, { signal, timeoutMs: 30000, headers: { 'user-agent': this.agent } }).then(async (res) => (res.ok ? /^[0-9a-f]{32}/i.exec((await res.text()).trim()) : (drop(res), null))).catch(() => null);
        const got = sum ? await md5Of(dest) : '';
        if (sum && got !== sum[0].toLowerCase()) {
          // Damaged on the way, or replaced on the server between being measured and being fetched. Either way what was
          // known of it is forgotten, so that the next go asks the server afresh.
          this.log(`places: ${f.name}: ${copyOf(info)} (${info.bytes} bytes) does not match the checksum beside it: the server says ${sum[0].toLowerCase()}, the file here is ${got}`);
          await fsp.rm(dest, { force: true });
          delete state.at[f.id]; await save();
          throw Object.assign(new Error(`${f.name} arrived damaged (it does not match the server's checksum).`), { again: true });
        }
        this.progress({ stage: 'read', readDone: 0, readTotal: 1 });
        const name = `p${state.next++}.json`;
        let result = null;
        try { result = await this.runExtract({ file: dest, out: path.join(work, name), categories: cats, rings }, job); } catch (err) {
          if (!signal.aborted) await fsp.rm(dest, { force: true }); // a file that cannot be read is no use: fetched again next time
          throw err;
        }
        await fsp.rm(dest, { force: true });
        state.done[f.id] = name; state.found += result.count; delete state.at[f.id];
        await save();
        this.placesDone.add(f.id);
        this.log(`places: ${f.name} (${copyOf(info)}): ${result.count} places from ${result.nodes} nodes, ${result.ways} ways and ${result.relations} relations, read in ${Math.round(result.ms / 100) / 10} s${result.unplaced ? `; ${result.unplaced} had no position in this extract` : ''}${sum ? '' : '; no checksum was on the server'}`);
        tell();
        if (early && count() < files.length && (!shown || count() - shown >= every)) {
          shown = count();
          await this.putPlaces(work, Object.values(state.done), cats, regionIds, { key, done: count(), total: files.length }).catch((err) => this.log(`places: what is here could not be put to use yet: ${err.message}`));
        }
      };

      // Each file in turn. One that fails is left for a second go after the others; what cannot be had even then is named.
      for (const round of [1, 2]) {
        for (const f of todo) {
          if (signal.aborted) throw new Error('Stopped.');
          if (state.done[f.id]) continue;
          if (state.at[f.id] && state.at[f.id].missing && round === 1) { failed.set(f.id, `${f.name} is not on the extract server`); continue; }
          if (round === 2 && !failed.has(f.id)) continue;
          try {
            // A file that does not match its checksum is fetched once more straight away, from wherever the server now says it is.
            try { await one(f); } catch (err) { if (!err.again || signal.aborted) throw err; this.log(`places: ${f.name}: fetching it again`); await one(f); }
            failed.delete(f.id);
          } catch (err) {
            if (signal.aborted) throw err;
            if (err.stop) throw err;
            failed.set(f.id, err.message.startsWith(f.name) ? err.message.replace(/\.$/, '') : `${f.name}: ${err.message}`);
            this.log(`places: ${f.name} failed (go ${round} of 2): ${err.message}`);
            downloaded = todo.filter((x) => state.done[x.id]).reduce((a, x) => a + sizeOf(x), 0);
            if (round === 1 && !err.fatal) await this.pause(5000);
          }
        }
        if (!failed.size) break;
      }
      if (failed.size) {
        if (count() && early) await this.putPlaces(work, Object.values(state.done), cats, regionIds, { key, done: count(), total: files.length }).catch(() => {});
        const why = [...failed.values()];
        throw new Error(`${failed.size} of the ${files.length} files could not be fetched (${why.slice(0, 3).join('; ')}${why.length > 3 ? '; and others' : ''}). What was read is kept: fetch the places again to carry on.`);
      }
      // Every file is read: put the pieces together.
      await this.putPlaces(work, Object.values(state.done), cats, regionIds, null);
      await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
      this.placesKept = null; this.placesDone = new Set();
      this.log(`places: finished, ${this.placesInfo.total} places from ${files.length} extracts in ${Math.round((Date.now() - started) / 60000)} min`);
      this.end();
      return this.placesInfo;
    } catch (err) {
      const r = this.end(err);
      if (r.stopped) return null;
      throw err;
    }
  }

  /** Read one extract, off the main thread where that is possible. */
  runExtract(data, job, inline) {
    const signal = job.controller.signal;
    const onProgress = (p) => this.progress({ readDone: p.done, readTotal: p.total });
    if (inline) return placesExtract.run(data, onProgress);
    return new Promise((resolve, reject) => {
      // In the installed app the worker's files are kept outside the archive the rest of the app is in.
      let file = path.join(__dirname, 'places-extract-worker.js');
      const outside = file.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
      if (outside !== file && fs.existsSync(outside)) file = outside;
      let worker = null; let settled = false; let heard = false;
      const onAbort = () => { if (worker) worker.terminate(); settle(reject, new Error('Stopped.')); };
      const settle = (fn, v) => { if (settled) return; settled = true; signal.removeEventListener('abort', onAbort); fn(v); };
      const fallBack = (why) => { this.log(`maps: the worker thread could not start (${why}); reading the extract on the main thread`); settle(resolve, this.runExtract(data, job, true)); };
      try { worker = new Worker(file, { workerData: data, resourceLimits: { maxOldGenerationSizeMb: 4096 } }); } catch (err) { fallBack(err.message); return; }
      signal.addEventListener('abort', onAbort, { once: true });
      worker.on('message', (m) => { heard = true; if (m.type === 'progress') onProgress(m.patch); else if (m.type === 'done') settle(resolve, m.result); else settle(reject, new Error(m.message)); });
      worker.on('error', (err) => { if (!heard) fallBack(err.message); else settle(reject, err); });
      worker.on('exit', (code) => settle(reject, new Error(`Reading the extract stopped unexpectedly (code ${code}).`)));
    });
  }

  /**
   * Put the pieces named together as the places in use. A place on the edge of two pieces came twice.
   * `partial` ({key, done, total}) marks a set that is not whole yet.
   */
  async putPlaces(work, names, cats, regionIds, partial) {
    const fresh = path.join(this.dir, 'places.new');
    const byCat = new Map(cats.map((c) => [c.id, []]));
    const seen = new Set();
    for (const name of names) {
      for (const rec of JSON.parse(await fsp.readFile(path.join(work, name), 'utf8'))) {
        if (seen.has(rec.i) || !byCat.has(rec.c)) continue;
        seen.add(rec.i);
        byCat.get(rec.c).push(rec);
      }
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
    this.placesInfo = { regions: regionIds, date: new Date().toISOString(), total: seen.size, counts, bytes, ...(partial ? { partial } : {}) };
    await writeJson(path.join(this.dir, 'places.json'), this.placesInfo);
    this.loaded.clear(); this.hospitalList = undefined; this.bands = null;
    return this.placesInfo;
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
  async fetchFile(url, dest, bytes, signal, onBytes, what = 'routing data') {
    const part = `${dest}.part`;
    let over = 0;
    for (let attempt = 0; ; attempt++) {
      let have = 0;
      try { have = (await fsp.stat(part)).size; } catch { have = 0; }
      // More than the whole file: once, that is a part left from an older copy. Twice, the file on the server is not the size it was said to be.
      if (have > bytes) { await fsp.rm(part, { force: true }); have = 0; if (++over > 1) throw Object.assign(new Error(`The file on the ${what} server is not the size it was said to be: it has been replaced.`), { changed: true, fatal: true }); }
      if (have === bytes) break;
      try {
        const res = await this.fetch(url, { signal, timeoutMs: 60000, headers: { 'user-agent': this.agent, ...(have ? { range: `bytes=${have}-` } : {}) } });
        if (res.status === 200 && have) { await fsp.rm(part, { force: true }); have = 0; } else if (res.status !== 200 && res.status !== 206) { drop(res); throw Object.assign(new Error(`The ${what} server answered ${res.status}.`), { fatal: res.status === 404 || res.status === 403 || res.status === 416, status: res.status }); }
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

  /** The brand index packed with the app, for sorting places fetched before they were sorted when fetched. */
  brands() {
    if (this.brandIndex === undefined) { try { this.brandIndex = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'maps', 'brands.json'), 'utf8')); } catch { this.brandIndex = null; } }
    return this.brandIndex;
  }

  baseRecords(id) {
    {
      const read = (folder) => { try { return JSON.parse(fs.readFileSync(path.join(this.dir, folder, `${id}.json`), 'utf8')).items; } catch { return []; } };
      let items = this.placesInfo ? read('places') : [];
      if (id === 'outdoor' || id === 'military') items = items.filter((r) => placeSort.keepsOsm(id, r.n));
      if (id === 'military') items = items.map((r) => { const l = placeSort.osmLesser(id, r); return l ? { ...r, less: true, x: { ...(r.x || {}), kind: l.kind } } : r; });
      // Overture's places are put under the right kind first (see place-sort.js): a doctor's office fetched as a
      // "hospital" is a clinic, a gun shop fetched as "sporting goods" is a gun shop, an airport gate is nothing.
      // Places fetched since 0.29 were sorted as they were fetched; older ones are sorted here, by brand and name.
      const ov = this.overture ? (kind) => (this.overture.counts[kind] ? read1(this.dir, kind) : []) : null;
      const more = !ov ? [] : this.overture.sorted >= 2 ? ov(id) : placeSort.sorted(id, ov, this.brands());
      // Places from Overture are added only where OpenStreetMap has no place of a like name close by.
      const extra = more.length ? places.fresh(items, more) : [];
      const all = extra.length ? items.concat(extra) : items;
      for (const it of all) it.c = id;
      return all;
    }
  }

  /**
   * What counts as large and small among the places of these kinds: the sizes that mark off the largest and the
   * smallest third of those that have a size. Null when fewer than thirty have one.
   */
  sizeBands(cats) {
    const key = (cats || []).slice().sort().join(',');
    if (!this.bands) this.bands = new Map();
    if (!this.bands.has(key)) {
      const sizes = [];
      for (const id of cats || []) { try { for (const r of this.recordsOf(id)) if (r.m) sizes.push(r.m); } catch { /* none of this kind */ } }
      sizes.sort((a, b) => a - b);
      this.bands.set(key, sizes.length < 30 ? null : { small: sizes[Math.floor(sizes.length / 3)], large: sizes[Math.floor((sizes.length * 2) / 3)], sized: sizes.length });
    }
    return this.bands.get(key);
  }

  /** Medicare's list of the hospitals of the United States, when it has been fetched (see hospitals.js). */
  hospitalRows() {
    if (this.hospitalList === undefined) { try { this.hospitalList = JSON.parse(fs.readFileSync(path.join(this.dir, 'official', 'hospitals-us.json'), 'utf8')); } catch { this.hospitalList = null; } }
    return this.hospitalList && Array.isArray(this.hospitalList.rows) ? this.hospitalList.rows : null;
  }

  /** The places of one kind: OpenStreetMap's, Overture's sorted, and for hospitals and clinics the official list laid over both. */
  recordsOf(id) {
    if (!this.loaded.has(id)) {
      const rows = id === 'hospital' || id === 'clinic' ? this.hospitalRows() : null;
      if (rows) {
        const out = hospitals.lay(rows, this.baseRecords('hospital'), this.baseRecords('clinic'));
        this.loaded.set('hospital', out.hospital); this.loaded.set('clinic', out.clinic);
        if (out.stats) this.log(`places: the hospital list of ${String(this.hospitalList.date).slice(0, 10)}: ${out.stats.matched} of its ${out.stats.rows} hospitals found among the places (${out.stats.places} places, ${out.stats.promoted} of them taken from the clinics); ${out.stats.lowered} places Overture calls hospitals are not on it and are marked so`);
      } else this.loaded.set(id, this.baseRecords(id));
    }
    return this.loaded.get(id);
  }

  /** Search the places, and the addresses when the words read as one. `categories` limits it to some places; with none given, all are searched. */
  search({ q = '', categories = null, near = null, box = null, around = null, limit = 50 } = {}) {
    const chosen = Boolean(categories && categories.length);
    // `around` is where the map is looking: of two streets of one name, the nearer is listed first.
    const found = !chosen && !box && q.trim() ? this.findAddress(q, around || near).hits : [];
    // A kind has places when either source has some, or when Overture has places fetched under another kind that belong to it.
    const has = (id) => (this.placesInfo && this.placesInfo.counts[id]) || (this.overture && (this.overture.counts[id] || (!(this.overture.sorted >= 2) && (placeSort.FROM[id] || []).some((src) => this.overture.counts[src]))));
    const ids = (chosen ? categories : this.registry.categories.map((c) => c.id)).filter(has);
    let r = { total: 0, hits: [] };
    const exact = found.some((h) => h.sure && h.how === 'exact') && /^\s*\d/.test(q);
    if (!exact && ids.length && (q.trim() || box || near || ids.length === 1)) {
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
    // The towns and ZIP codes of the address data, worked out from it once (see buildGazetteer).
    const gaz = this.addresses ? readJsonSync(path.join(this.dir, 'address-towns.json')) : null;
    this.setGazetteer(gaz && gaz.v === 1 && gaz.of === this.gazStamp() ? gaz : null);
    this.loaded.clear(); this.hospitalList = undefined; this.bands = null;
  }
  gazStamp() { return this.addresses ? `${this.addresses.addresses}:${this.addresses.date || ''}:${this.addresses.bytes || ''}` : ''; }
  setGazetteer(gaz) {
    this.gaz = gaz;
    this.gazCities = new Map(); // town name -> [[state, lon, lat, count]]
    if (!gaz) return;
    for (const [key, [lon, lat, n]] of Object.entries(gaz.towns)) { const [city, state] = key.split('|'); if (!this.gazCities.has(city)) this.gazCities.set(city, []); this.gazCities.get(city).push([state, lon, lat, n]); }
  }
  /**
   * Work out where each town and ZIP code of the address data is, from the data itself, and keep the list.
   * It is what lets an address be found when its row names no town or another one, and what an address that
   * cannot be found falls back on. Done once per set of address data; a minute or so for a whole country.
   * Returns true when a list was built now.
   */
  async buildGazetteer() {
    if (!this.addressIndex || this.gaz || this.gazBuilding) return false;
    this.gazBuilding = true;
    const index = this.addressIndex; const of = this.gazStamp();
    try {
      const t0 = Date.now();
      const g = await index.gazetteer();
      if (this.addressIndex !== index) return false; // the address data was replaced meanwhile
      const gaz = { v: 1, of, ...g };
      await writeJson(path.join(this.dir, 'address-towns.json'), gaz);
      this.setGazetteer(gaz);
      const pc = (n) => `${Math.round((1000 * n) / Math.max(1, g.stats.rows)) / 10}%`;
      this.log(`addresses: ${Object.keys(g.towns).length} towns and ${Object.keys(g.zips).length} ZIP codes placed from the address data in ${Math.round((Date.now() - t0) / 100) / 10} s. Of ${g.stats.rows} addresses, ${pc(g.stats.noTown)} name no town, ${pc(g.stats.noZip)} no ZIP code, ${pc(g.stats.neither)} neither.`);
      this.emit('changed');
      return true;
    } catch (err) { this.log(`addresses: the list of towns could not be built: ${err.message}`); return false; } finally { this.gazBuilding = false; }
  }

  /**
   * Where a named town is: { a, o, n }. From the places when they are here (they know the larger town of a name),
   * else from the address data's own towns. Used for an address whose row names the town differently or not at all.
   */
  townAt(city, state, near) {
    const want = addresses.normCity(city);
    if (!want) return null;
    const st = state ? addresses.normState(state) : '';
    const known = this.gazCities.get(want) || null;
    if (this.placesInfo && this.placesInfo.counts.town) {
      // With the state known, the town of that name there comes first: the address data says where that is.
      const there = st && known ? known.find((g) => g[0] === st) : null;
      const mid = st ? this.stateMiddles().get(st) || null : null;
      let best = null;
      for (const t of this.recordsOf('town')) {
        if (addresses.normCity(t.n) !== want) continue;
        const pop = t.x && t.x.population ? Number(String(t.x.population).replace(/\D/g, '')) || 0 : 0;
        // A state the address data does not cover yet still says which town of that name is meant: the one in that
        // state, never a namesake across the country (Portland, Maine is not Portland, Oregon).
        if (!there && mid && !this.inState(st, t.a, t.o)) continue;
        const score = there ? -places.km(there[2], there[1], t.a, t.o) : mid ? -places.km(mid[0], mid[1], t.a, t.o) : near ? -places.km(near[1], near[0], t.a, t.o) : pop;
        if (!best || score > best.score) best = { score, t };
      }
      if (best) return best.t;
      if (!there && mid) return null; // no town of that name in the state named
    }
    if (!known) return null;
    const pick = st ? known.find((g) => g[0] === st) || null : known.slice().sort((x, y) => (near ? places.km(near[1], near[0], x[2], x[1]) - places.km(near[1], near[0], y[2], y[1]) : y[3] - x[3]))[0];
    return pick ? { a: pick[2], o: pick[1], n: addresses.title(want) } : null;
  }
  /** The middle of each state the app knows: a Map from 'NC' to [lat, lon]. */
  stateMiddles() {
    if (!this.mids) {
      this.mids = new Map();
      const groups = (this.registry.extracts && this.registry.extracts.regions) || {};
      for (const list of Object.values(groups)) for (const r of list) { const code = addresses.normState(r.name); if (/^[A-Z]{2}$/.test(code) && r.at) this.mids.set(code, r.at); }
    }
    return this.mids;
  }
  /**
   * Whether a point can be in a state, told from the middles of the states alone: it is when no other state's
   * middle is much nearer to it than the named state's. Rough at the borders, which is all a namesake needs.
   */
  inState(st, lat, lon) {
    const mids = this.stateMiddles(); const mid = mids.get(st);
    if (!mid) return true;
    const d = places.km(mid[0], mid[1], lat, lon);
    let nearest = d;
    for (const m of mids.values()) nearest = Math.min(nearest, places.km(m[0], m[1], lat, lon));
    return d <= 1.6 * nearest + 150;
  }
  /** The middle of a ZIP code's addresses: [lon, lat], or null. */
  zipAt(zip) { const z5 = addresses.normZip(zip); const g = this.gaz && this.gaz.zips[z5]; return g ? [g[0], g[1]] : null; }
  /** A town or ZIP code as somewhere to point at when the address itself cannot be found: { a, o, n, by } or null. */
  areaOf(loc, near) {
    if (!loc) return null;
    const z5 = loc.zip ? this.zipAt(loc.zip) : null;
    if (z5) return { a: z5[1], o: z5[0], n: `ZIP code ${addresses.normZip(loc.zip)}${loc.city ? ` (${addresses.title(loc.city)}${loc.state ? `, ${loc.state}` : ''})` : ''}`, by: 'zip' };
    // The town may be the last words of a longer run: with no commas, the street's words come before it.
    const words = String(loc.city || '').split(' ').filter(Boolean);
    for (let k = 0; k < words.length; k++) {
      if (k > 0 && words.length - k > 4) continue; // a town's name is a few words at most
      const t = this.townAt(words.slice(k).join(' '), loc.state, near);
      if (t) return { a: t.a, o: t.o, n: `${t.n}${loc.state ? `, ${loc.state}` : ''}`, by: 'town' };
      if (loc.fixed) break; // the town was set apart by a comma: it is all of it or nothing
    }
    return null;
  }

  /**
   * Find a typed address. Returns { hits, tried }: hits are records like places, with `how` saying how the
   * point was arrived at ('exact', 'between', 'nearest', 'street' or 'town') and `approx` true for all but exact.
   */
  findAddress(text, near = null) {
    if (!this.addressIndex) return { hits: [], tried: false };
    const parsed = addresses.parse(text);
    if (!addresses.looksLikeAddress(parsed)) return { hits: [], tried: false };
    const r = this.addressIndex.find(text, { near, townAt: (city, state) => { const t = this.townAt(city, state || '', near); return t ? [t.o, t.a] : null; }, zipAt: (zip) => this.zipAt(zip) });
    const hits = r.hits.map((h) => ({ c: 'address', i: `ad${h.lon},${h.lat}`, a: h.lat, o: h.lon, n: h.label, d: h.note, kind: 'Address', how: h.how, approx: h.how !== 'exact', sure: h.sure, km: h.km }));
    const loc = r.parsed && r.parsed.loc;
    if (!hits.length && parsed.number != null && loc && (loc.city || loc.zip)) {
      // Neither the number nor the street could be placed: the ZIP code or the town is still somewhere to head for.
      const t = this.areaOf(loc, near);
      if (t) hits.push({ c: 'address', i: `ad${t.o},${t.a}`, a: t.a, o: t.o, n: t.n, d: `Approximate. ${r.street ? 'That street was not found in this town' : 'That street is not'} in the address data, so this points at the middle of ${t.by === 'zip' ? 'the ZIP code' : 'the town'}.`, kind: 'Address', how: 'town', approx: true, sure: true, km: near ? Math.round(places.km(near[1], near[0], t.a, t.o) * 10) / 10 : null });
    }
    return { hits, tried: true, street: r.street, loc: loc || null };
  }

  /**
   * Where a contact's address is, as well as it can be told. A contact's address is not always a street address:
   * it may be a town alone, a post office box, or a street the data does not have.
   * Returns { lat, lon, how, why } when it can be put on the map ('exact', 'between', 'nearest', 'street' or 'town'),
   * else { why } saying what stood in the way.
   */
  locateAddress(text) {
    if (!this.addressIndex) return { why: 'The street addresses have not been fetched yet. They are on the Setup page.' };
    const r = this.findAddress(text);
    if (r.hits[0]) { const h = r.hits[0]; return { lat: h.a, lon: h.o, how: h.how, why: h.d || '' }; }
    // The town as the address was read (after its street), or, for something that is no street address, whatever town it names.
    const loc = r.tried && r.loc && (r.loc.city || r.loc.zip) ? { ...r.loc, fixed: true } : addresses.placeIn(text);
    const t = this.areaOf(loc);
    if (t) return { lat: t.a, lon: t.o, how: 'town', why: r.tried ? `The street is not in the address data, so this points at the middle of ${t.by === 'zip' ? 'its ZIP code' : 'the town'}.` : `This is not a street address the data can place, so it points at the middle of ${t.by === 'zip' ? 'its ZIP code' : 'the town'}.` };
    if (!this.gaz) return { why: 'The list of towns is still being worked out from the address data. This is tried again when it is ready.' };
    if (loc && !loc.zip && !loc.state && !loc.fixed) return { why: 'No town or ZIP code that the address data knows could be read from this address.' };
    if (!loc) return { why: r.tried && r.street ? 'A street of that name is in the address data, but not in a town that could be told from this address. Add the town, state or ZIP code.' : 'No town, state or ZIP code could be read from this address.' };
    const town = loc.fixed ? addresses.title(loc.city) : addresses.title(String(loc.city || '').split(' ').slice(-2).join(' '));
    const what = [loc.zip ? `ZIP code ${loc.zip}` : '', town ? `${town}${loc.state ? `, ${loc.state}` : ''}` : ''].filter(Boolean).join(' nor ');
    const towns = this.placesInfo && this.placesInfo.counts.town ? '' : ' Fetching the places (towns, water, power and services) on the Setup page adds the towns of every state, which would at least place it at its town.';
    return { why: `Neither the street nor ${what} is in the address data, which does not cover every state and county.${towns} It can also be placed by hand, on the map.` };
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
      const data = { dir: this.dir, cfg: this.registry.overture, categories: this.registry.categories.map(({ id, overture: o, overtureLess: l }) => ({ id, overture: o || [], overtureLess: l || {} })), rings, regions: regionIds, kinds, base: this.base, agent: this.agent, fast: Boolean(this.base), brands: kinds.includes('places') ? this.brands() : null };
      const result = await this.runOverture(data, job, inline);
      if (result && result.places) { const s = result.places.sorting || {}; this.log(`maps: Overture places sorted as fetched: ${s.kept || 0} kept, ${s.moved || 0} moved to another kind, ${s.lesser || 0} marked as a lesser sort, ${s.out || 0} left out (by brand ${s['by brand'] || 0}, by Overture's kind ${s['by kind'] || 0}, by name ${s['by name'] || 0}); brand index ${result.places.brands ? `${result.places.brands.from} ${result.places.brands.version}` : 'none'}`); }
      if (result && result.hospitals) this.log(result.hospitals.error ? `maps: the hospital list could not be fetched (${result.hospitals.error}); hospitals are sorted without it` : `maps: hospital list fetched, ${result.hospitals.count} hospitals`);
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
