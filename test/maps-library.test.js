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
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; }).on('end', () => {
      const q = decodeURIComponent(body.replace(/^data=/, ''));
      asked.push({ q, agent: req.headers['user-agent'] });
      if (busy > 0) { busy -= 1; res.writeHead(429); res.end(); return; }
      const m = /\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)/.exec(q);
      const [s, w, n, e] = m.slice(1).map(Number);
      if (slow > 0 && e - w > 6) { slow -= 1; res.end(JSON.stringify({ elements: [], remark: 'runtime error: Query timed out in "query" at line 3 after 301 seconds.' })); return; }
      // Like the real server: everything in the box, and the same thing again from a neighbouring box now and then.
      const inBox = all.filter((x) => { const lat = x.lat ?? x.center.lat; const lon = x.lon ?? x.center.lon; return lat >= s && lat <= n && lon >= w && lon <= e; });
      res.end(JSON.stringify({ elements: [...inBox, all[0]] }));
    });
  });
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
    assert.match(asked[0].q, /^\[out:json\]\[timeout:300\];/);
    assert.match(asked[0].q, /nwr\["amenity"="hospital"\]\(30,-90,40,-82\.5\);/);
    assert.match(asked[0].q, /out center tags qt;$/);
    assert.ok(waits.includes(15000), 'a busy server is waited for');
    assert.equal(asked.length, 7, 'busy once, timed out once and asked again in four pieces, and the second box');
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
  } finally { await new Promise((r) => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); }
});
