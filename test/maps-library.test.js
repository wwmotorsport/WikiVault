'use strict';
// Maps: measuring, fetching the map, fetching places, searching them. The servers are stand-ins.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const pm = require('../src/core/pmtiles');
const places = require('../src/core/places');
const { MapsLibrary, loadRegistry } = require('../src/core/maps-library');
const { makeArchive, serve } = require('./helpers-pmtiles');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wv-maps-'));
const world = makeArchive({ maxZoom: 9, tileCompression: 1, tileOf: (z, x, y) => Buffer.from(`${z}/${x}/${y}:${'x'.repeat((x * 31 + y * 17) % 50)}`) });
const real = loadRegistry();
const box = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n]];
const registry = (origin) => ({
  ...real,
  builds: { index: `${origin}/builds.json`, base: `${origin}/` },
  overpass: [`${origin}/overpass`],
  regions: [{ id: 'east', name: 'East', default: true, rings: [box(-90, 30, -75, 40)] }, { id: 'west', name: 'West', rings: [box(-120, 35, -110, 40)] }],
});
const builds = Buffer.from(JSON.stringify([
  { key: '20261101.pmtiles', version: '4.15.2', size: 5, uploaded: '2026-11-01T09:00:00Z' },
  { key: '20261116.pmtiles', version: '4.15.2', size: world.bytes.length, uploaded: '2026-11-16T09:00:00Z' },
  { key: 'notes.txt', size: 1, uploaded: '2026-11-17T09:00:00Z' },
]));

test('the registry is sound', () => {
  assert.ok(real.regions.find((r) => r.id === 'us48' && r.default));
  for (const r of real.regions) for (const ring of r.rings) { assert.ok(ring.length >= 4); for (const [lon, lat] of ring) assert.ok(lon >= -180 && lon <= -50 && lat >= 14 && lat <= 72, `${r.id} ${lon},${lat}`); }
  // The outline of the lower 48 holds its corners and leaves out its neighbours' capitals.
  const us = real.regions.find((r) => r.id === 'us48').rings;
  for (const [name, lon, lat] of [['Seattle', -122.33, 47.6], ['San Diego', -117.16, 32.72], ['Brownsville', -97.5, 25.9], ['Key West', -81.78, 24.56], ['Eastport', -66.98, 44.9], ['Charlotte', -80.84, 35.23], ['Detroit', -83.05, 42.33], ['El Paso', -106.49, 31.76]]) assert.ok(places.inRings(us, lon, lat), name);
  for (const [name, lon, lat] of [['Ottawa', -75.7, 45.42], ['Monterrey', -100.32, 25.69], ['Havana', -82.37, 23.11], ['Calgary', -114.07, 51.05]]) assert.ok(!places.inRings(us, lon, lat), name);
  assert.deepEqual(real.levels.map((l) => l.zoom), [...real.levels.map((l) => l.zoom)].sort((a, b) => a - b));
  const ids = real.categories.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ['hospital', 'pharmacy', 'fire', 'water_works', 'power_plant', 'fuel', 'supermarket', 'hardware', 'weapons', 'military', 'town']) assert.ok(ids.includes(id), id);
  assert.match(real.credit, /OpenStreetMap/);
});

test('measure, then fetch the map; a second fetch replaces the first only when it is complete', async () => {
  const site = await serve({ 'builds.json': builds, '20261116.pmtiles': world.bytes });
  const dir = tmp();
  try {
    const lib = new MapsLibrary({ dir, registry: registry(site.origin) });
    await lib.init();
    assert.equal(lib.status().map, null);
    const m = await lib.measure(['east']);
    assert.equal(m.build.key, '20261116.pmtiles', 'the newest build that is a map');
    assert.deepEqual(m.levels.map((l) => l.zoom), [8], 'only the levels this file has');
    assert.ok(m.levels[0].bytes > 0 && m.levels[0].tiles > 0);
    await assert.rejects(lib.downloadMap(['east'], 8, { free: 1000 }), /not enough free space/);
    assert.match(lib.status().error, /not enough free space/);
    const got = await lib.downloadMap(['east'], 8);
    assert.deepEqual([got.maxZoom, got.regions, got.build], [8, ['east'], '20261116.pmtiles']);
    assert.equal(fs.statSync(lib.mapFile).size, got.bytes);
    assert.ok(Math.abs(got.bytes - m.levels[0].bytes) < got.bytes * 0.25, `measured ${m.levels[0].bytes}, got ${got.bytes}`);
    assert.equal(lib.status().error, null);

    // A second library on the same folder sees it. A fetch that fails leaves it alone.
    const again = new MapsLibrary({ dir, registry: registry(site.origin) });
    await again.init();
    assert.equal(again.status().map.bytes, got.bytes);
    const before = fs.readFileSync(lib.mapFile);
    const broken = new MapsLibrary({ dir, registry: { ...registry(site.origin), builds: { index: `${site.origin}/builds.json`, base: `${site.origin}/gone/` } } });
    await broken.init();
    await assert.rejects(broken.downloadMap(['east', 'west'], 7), /answered 404/);
    assert.deepEqual(fs.readFileSync(lib.mapFile), before);
    assert.equal(broken.status().map.maxZoom, 8);
    await assert.rejects(lib.measure(['nowhere']), /Choose at least one region/);
  } finally { await site.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('places are fetched box by box, cut to the region, and searched', async () => {
  const asked = [];
  let busy = 1; let slow = 1;
  const el = (type, id, lat, lon, tags) => (type === 'node' ? { type, id, lat, lon, tags } : { type, id, center: { lat, lon }, tags });
  const all = [
    el('way', 1, 35.2, -80.8, { amenity: 'hospital', name: 'Atrium Health Mercy', emergency: 'yes', beds: '185', 'addr:housenumber': '2001', 'addr:street': 'Vail Avenue', 'addr:city': 'Charlotte', 'addr:state': 'NC', 'addr:postcode': '28207', phone: '+1 704 555 0100' }),
    el('node', 2, 35.3, -80.7, { amenity: 'pharmacy', name: 'Corner Pharmacy', opening_hours: 'Mo-Fr 09:00-18:00' }),
    el('node', 3, 35.9, -79.0, { amenity: 'hospital', name: 'UNC Hospitals', emergency: 'yes' }),
    el('node', 4, 36.1, -86.8, { shop: 'hardware', name: 'Mercy Hardware' }),
    el('relation', 5, 35.1, -79.0, { landuse: 'military', name: 'Fort Liberty' }),
    el('way', 6, 35.0, -79.1, { landuse: 'military' }),
    el('node', 7, 35.22, -80.84, { place: 'city', name: 'Charlotte', population: '874579' }),
    el('node', 8, 34.0, -81.0, { place: 'town', name: 'Charlotte Court House', population: '500' }),
    el('node', 9, 45.0, -80.0, { amenity: 'hospital', name: 'Outside The Region' }),
    el('node', 10, 35.5, -80.0, { amenity: 'cafe', name: 'Not Wanted' }),
  ];
  let fail = null;
  const answer = (req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; }).on('end', () => {
      const q = decodeURIComponent(body.replace(/^data=/, ''));
      asked.push({ q, agent: req.headers['user-agent'], gzip: req.headers['accept-encoding'] });
      if (busy > 0) { busy -= 1; res.writeHead(429); res.end(); return; }
      const m = /\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)/.exec(q);
      const [s, w, n, e] = m.slice(1).map(Number);
      if (fail && fail(w)) { res.writeHead(500); res.end(); return; }
      if (slow > 0 && e - w > 2) { slow -= 1; res.end(JSON.stringify({ elements: [], remark: 'runtime error: Query timed out in "query" at line 3 after 301 seconds.' })); return; }
      // Like the real server: everything in the box, and the same thing again from a neighbouring box now and then.
      const inBox = all.filter((x) => { const lat = x.lat ?? x.center.lat; const lon = x.lon ?? x.center.lon; return lat >= s && lat <= n && lon >= w && lon <= e; });
      // Compressed, as the real servers send it when asked.
      res.writeHead(200, { 'content-encoding': 'gzip' });
      res.end(require('node:zlib').gzipSync(JSON.stringify({ elements: [...inBox, all[0]] })));
    });
  };
  const server = http.createServer(answer);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const dir = tmp();
  try {
    const waits = [];
    const lib = new MapsLibrary({ dir, registry: registry(origin), pause: (ms) => { waits.push(ms); return Promise.resolve(); }, agent: 'Wikivault/test' });
    await lib.init();
    const seen = [];
    lib.on('progress', () => seen.push({ ...lib.status().job }));
    const info = await lib.downloadPlaces(['east']);
    assert.equal(asked[0].agent, 'Wikivault/test');
    assert.match(asked[0].q, /^\[out:json\]\[timeout:120\]\[maxsize:268435456\];/, 'a question claims little of the server, so that it is let in sooner');
    assert.equal(asked[0].gzip, 'gzip', 'the answer is asked for compressed');
    assert.match(asked[0].q, /nwr\["amenity"="hospital"\]\(30,-90,32\.5,-87\.5\);/, 'the region is asked for in pieces of two and a half degrees');
    assert.match(asked[0].q, /out center tags qt;$/);
    assert.ok(waits.includes(15000), 'a busy server is waited for');
    const pieces = require('../src/core/places').boxesOf(lib.rings(['east']), 2.5).length;
    assert.equal(asked.length, pieces + 1 + 4, 'every piece once, one asked again after the server was busy, and one that timed out asked again as four smaller ones');
    assert.ok(!fs.existsSync(path.join(dir, 'places.work')), 'the working files are gone once the places are in');
    assert.equal(lib.status().placesKept, null);
    assert.deepEqual(info.counts.hospital, 2);
    assert.deepEqual([info.counts.pharmacy, info.counts.hardware, info.counts.military, info.counts.town, info.total], [1, 1, 1, 2, 7]);
    assert.equal(seen.at(-1).done, seen.at(-1).total);

    const st = lib.status();
    assert.equal(st.categories.find((c) => c.id === 'hospital').count, 2);
    assert.equal(st.places.total, 7);
    // By name, across every category: the name that starts with the word comes first.
    const mercy = lib.search({ q: 'mercy' });
    assert.deepEqual(mercy.hits.map((h) => [h.n, h.kind]), [['Mercy Hardware', 'Hardware and building supply'], ['Atrium Health Mercy', 'Hospitals']]);
    const h = lib.search({ q: 'atrium' }).hits[0];
    assert.deepEqual([h.d, h.p, h.x.emergency, h.x.beds, h.i], ['2001 Vail Avenue, Charlotte, NC 28207', '+1 704 555 0100', 'yes', '185', 'w1']);
    // Nearest first, in one category.
    const near = lib.search({ categories: ['hospital'], near: [-79.05, 35.9] });
    assert.deepEqual(near.hits.map((x) => x.n), ['UNC Hospitals', 'Atrium Health Mercy']);
    assert.ok(near.hits[0].km < 10 && near.hits[1].km > 150 && near.hits[1].km < 200);
    // The larger town first; an address search word matches too.
    assert.deepEqual(lib.search({ q: 'charlotte', categories: ['town'] }).hits.map((x) => x.n), ['Charlotte', 'Charlotte Court House']);
    assert.equal(lib.search({ q: 'vail avenue' }).hits[0].n, 'Atrium Health Mercy');
    assert.deepEqual(lib.search({ categories: ['pharmacy'], box: [-81, 35, -80, 36] }).hits.map((x) => x.n), ['Corner Pharmacy']);
    assert.equal(lib.search({ q: '' }).total, 0, 'nothing asked, nothing listed');

    // An update that fails keeps the places that were there.
    server.removeAllListeners('request');
    server.on('request', (req, res) => { req.resume(); res.writeHead(500); res.end(); });
    await assert.rejects(lib.downloadPlaces(['east']), /answered 500/);
    assert.equal(lib.search({ q: 'mercy' }).total, 2);
    assert.ok(!fs.existsSync(path.join(dir, 'places.new')));
    assert.equal(lib.status().placesKept, null, 'nothing arrived, so there is nothing to carry on from');

    // A run that fails part of the way keeps the pieces that arrived, and the next run asks only for the rest.
    server.removeAllListeners('request');
    server.on('request', answer);
    fail = (w) => w >= -80; // the eastern pieces fail for now
    asked.length = 0;
    await assert.rejects(lib.downloadPlaces(['east']), /answered 500\. (\d+) of (\d+) pieces are already here and are kept: fetch the places again and it carries on from there\.$/);
    const kept = lib.status().placesKept;
    assert.ok(kept.done > 0 && kept.done < kept.total && kept.total === pieces, JSON.stringify(kept));
    assert.match(lib.status().error, /carries on from there/);
    assert.equal(lib.search({ q: 'mercy' }).total, 2, 'the places in use are untouched meanwhile');
    // The app is closed and opened again: what was kept is still known.
    const again = new MapsLibrary({ dir, registry: registry(origin), pause: () => Promise.resolve(), agent: 'Wikivault/test' });
    await again.init();
    assert.deepEqual(again.status().placesKept, kept);
    fail = null; asked.length = 0;
    const info2 = await again.downloadPlaces(['east']);
    assert.equal(asked.length, kept.total - kept.done, 'only the pieces still missing are asked for');
    assert.deepEqual([info2.total, info2.counts.hospital, info2.counts.town], [7, 2, 2]);
    assert.equal(again.status().placesKept, null);
    // Other regions do not carry on from these pieces.
    fail = (w) => w >= -80; asked.length = 0;
    await assert.rejects(again.downloadPlaces(['east']), /carries on from there/);
    fail = null; asked.length = 0;
    await again.downloadPlaces(['west']).catch(() => null);
    assert.ok(asked.length >= 1 && again.status().placesKept === null);
  } finally { await new Promise((r) => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('places: the pieces nearest home come first, what has arrived is in use before the rest, and larger pieces left by an older version are cut down', async () => {
  const el = (id, lat, lon, tags) => ({ type: 'node', id, lat, lon, tags });
  const all = [el(1, 35.2, -80.8, { amenity: 'hospital', name: 'Atrium Health Mercy' }), el(2, 31.0, -89.0, { amenity: 'hospital', name: 'Far Away General' }), el(3, 39.0, -76.0, { amenity: 'pharmacy', name: 'Corner Pharmacy' })];
  const asked = []; let fail = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; }).on('end', () => {
      const [s, w, n, e] = /\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)/.exec(decodeURIComponent(body)).slice(1).map(Number);
      asked.push([s, w, n, e]);
      if (fail && fail(s, w, n, e)) { res.writeHead(500); res.end(); return; }
      res.end(JSON.stringify({ elements: all.filter((x) => x.lat >= s && x.lat <= n && x.lon >= w && x.lon <= e) }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const dir = tmp();
  try {
    const lib = new MapsLibrary({ dir, registry: registry(origin), pause: () => Promise.resolve(), agent: 'Wikivault/test' });
    await lib.init();
    const total = places.boxesOf(lib.rings(['east']), 2.5).length;
    // The far south-west fails for now: the run stops part of the way, with the pieces around home already in.
    fail = (s, w) => s < 32.5 && w < -87.5;
    await assert.rejects(lib.downloadPlaces(['east'], { near: { lat: 35.2, lon: -80.8 } }), /carries on from there/);
    assert.deepEqual(asked[0], [35, -82.5, 37.5, -80], 'the piece home is in is asked for first');
    const km = (b) => places.km(35.2, -80.8, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
    assert.ok(km(asked[1]) <= km(asked[5]) && km(asked[5]) <= km(asked[asked.length - 1]), 'and the others in order of distance');
    const part = lib.status().places;
    assert.ok(part && part.partial && part.partial.done >= 1 && part.partial.done < part.partial.total && part.partial.total === total, JSON.stringify(part));
    assert.deepEqual(lib.search({ q: 'mercy' }).hits.map((h) => h.n), ['Atrium Health Mercy'], 'what has arrived can be searched before the rest is here');
    assert.equal(lib.search({ q: 'far away' }).total, 0);
    // Opened again and carried on: the set becomes whole, and is no longer marked as part of one.
    const again = new MapsLibrary({ dir, registry: registry(origin), pause: () => Promise.resolve(), agent: 'Wikivault/test' });
    await again.init();
    assert.ok(again.status().places.partial, 'the part that is in use is remembered');
    fail = null; asked.length = 0;
    const info = await again.downloadPlaces(['east'], { near: { lat: 35.2, lon: -80.8 } });
    assert.ok(asked.length >= 1 && asked.length < total, 'only what was missing is asked for');
    assert.equal(info.partial, undefined);
    assert.deepEqual([info.total, again.search({ q: 'far away' }).total], [3, 1]);
    // A whole set in use is not replaced by part of a new one.
    fail = (s, w) => s < 32.5 && w < -87.5; asked.length = 0;
    await assert.rejects(again.downloadPlaces(['east']), /carries on from there/);
    assert.equal(again.status().places.partial, undefined);
    assert.equal(again.search({ q: 'far away' }).total, 1);

    // Pieces of five degrees, left unfinished by an older version, are cut into today's size; the one that had arrived is kept.
    const dir2 = tmp();
    try {
      const old = new MapsLibrary({ dir: dir2, registry: registry(origin), pause: () => Promise.resolve(), agent: 'Wikivault/test' });
      await old.init();
      const big = places.boxesOf(old.rings(['east']), 5);
      fs.mkdirSync(path.join(dir2, 'places.work'), { recursive: true });
      fs.writeFileSync(path.join(dir2, 'places.work', 'p0.json'), JSON.stringify([]));
      fs.writeFileSync(path.join(dir2, 'places.work', 'state.json'), JSON.stringify({ v: 1, key: old.placesKey(['east']), regions: ['east'], next: 1, found: 0, done: ['p0.json'], todo: big.slice(1).map((box) => ({ box, depth: 0 })) }));
      fail = null; asked.length = 0;
      const got = await old.downloadPlaces(['east']);
      assert.equal(asked.length, (big.length - 1) * 4);
      assert.ok(asked.every(([s, w, n, e]) => Math.abs(n - s - 2.5) < 1e-6 && Math.abs(e - w - 2.5) < 1e-6));
      assert.ok(got.total >= 2 && !got.partial);
    } finally { fs.rmSync(dir2, { recursive: true, force: true }); }
  } finally { await new Promise((r) => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); }
});
