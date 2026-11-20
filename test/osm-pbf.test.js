'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const osm = require('../src/core/osm-pbf');
const { run } = require('../src/core/places-extract');
const { loadRegistry } = require('../src/core/maps-library');

const fixture = (name) => path.join(__dirname, 'fixtures', name);
const cats = loadRegistry().categories;
const filters = cats.flatMap((c) => c.filters);
const read = (name, f = filters) => { const els = []; const stats = osm.extract(fixture(name), { filters: f, onElement: (e) => els.push(e) }); return { els, stats }; };
const near = (a, b) => Math.abs(a - b) < 1e-7;
const B = 13000000000;

test('extract: a file written the usual way gives up its nodes, ways and relations, each with a position', () => {
  const { els, stats } = read('east-a.osm.pbf');
  assert.deepEqual([stats.nodes, stats.ways, stats.relations, stats.sorted], [9016, 5, 2, true]);
  const by = new Map(els.map((e) => [`${e.type[0]}${e.id - B}`, e]));
  assert.deepEqual([...by.keys()].sort(), ['n1', 'n3', 'n30', 'n4', 'r200', 'w100'], 'only what belongs to a kind of place: no bakery, no street, no bus route');
  // A node keeps its own position and every one of its tags, whatever the script.
  const mercy = by.get('n1');
  assert.ok(near(mercy.lat, 35.2) && near(mercy.lon, -80.8));
  assert.deepEqual([mercy.tags.name, mercy.tags.beds, mercy.tags['addr:street'], Object.keys(mercy.tags).length], ['Mercy General', '185', 'Vale Avenue', 10]);
  assert.equal(by.get('n3').tags['name:el'], 'Ρίβερτον');
  assert.equal(by.get('n1').id, 13000000001, 'ids past 2^32 come through whole');
  // A way has no position of its own: it gets the middle of its nodes.
  const fuel = by.get('w100');
  assert.ok(near(fuel.center.lat, 35.3005) && near(fuel.center.lon, -80.8995), JSON.stringify(fuel.center));
  assert.deepEqual([fuel.tags.name, fuel.tags['fuel:diesel']], ['Corner Fuel', 'yes']);
  // A relation gets the middle of its outer ring; the inner ring does not pull it aside.
  const county = by.get('r200');
  assert.ok(near(county.center.lat, 35.101) && near(county.center.lon, -80.699), JSON.stringify(county.center));
  // A way whose nodes are all in the neighbouring extract cannot be placed, and is counted, not guessed.
  assert.equal(stats.unplaced, 1);
  assert.equal(stats.matched, 6);
});

test('extract: nodes written one by one and blocks left uncompressed are read as well', () => {
  const { els, stats } = read('east-b.osm.pbf');
  assert.deepEqual([stats.nodes, stats.ways, stats.relations], [6, 1, 0]);
  assert.deepEqual(els.map((e) => `${e.type[0]}${e.id - B}:${e.tags.name}`).sort(), ['n1:Mercy General', 'n500:Far Away General', 'n501:Far Away Pharmacy', 'w600:Far Away Tower']);
  const tower = els.find((e) => e.type === 'way');
  assert.ok(near(tower.center.lat, 31.2005) && near(tower.center.lon, -89.1995));
});

test('extract: only the tags asked for are matched, progress is told, and it can be stopped', () => {
  assert.deepEqual(read('east-a.osm.pbf', [['amenity', 'fuel']]).els.map((e) => e.tags.name), ['Corner Fuel']);
  assert.deepEqual(read('east-a.osm.pbf', [['amenity', 'nothing']]).els, []);
  const seen = [];
  osm.extract(fixture('east-a.osm.pbf'), { filters, onElement: () => {}, onProgress: (p) => seen.push(p) });
  const last = seen[seen.length - 1];
  assert.ok(last && last.done === last.total && last.total >= 3, JSON.stringify(last));
  assert.throws(() => osm.extract(fixture('east-a.osm.pbf'), { filters, onElement: () => {}, stop: () => true }), /Stopped/);
});

test('extract: a file that is cut short, or is something else, is refused in plain words', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-pbf-'));
  try {
    const whole = fs.readFileSync(fixture('east-a.osm.pbf'));
    const cut = path.join(dir, 'cut.osm.pbf'); fs.writeFileSync(cut, whole.subarray(0, whole.length - 37));
    assert.throws(() => osm.extract(cut, { filters, onElement: () => {} }), /cut short/);
    const other = path.join(dir, 'other.osm.pbf'); fs.writeFileSync(other, Buffer.from('<html>Not found</html>'.repeat(20)));
    assert.throws(() => osm.extract(other, { filters, onElement: () => {} }), /not an OpenStreetMap PBF file/);
    const empty = path.join(dir, 'empty.osm.pbf'); fs.writeFileSync(empty, Buffer.alloc(0));
    assert.throws(() => osm.extract(empty, { filters, onElement: () => {} }), /not an OpenStreetMap PBF file/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('extract: the records written are the ones the places code uses, and only those inside the region', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-pbf-'));
  try {
    const out = path.join(dir, 'p0.json');
    const east = [[[-90, 30], [-75, 30], [-75, 40], [-90, 40]]];
    const r = await run({ file: fixture('east-a.osm.pbf'), out, categories: cats, rings: east });
    const recs = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(r.count, recs.length);
    assert.deepEqual(recs.map((x) => `${x.c}:${x.i}:${x.n}`).sort(), ['drinking_water:n13000000030:', 'fuel:w13000000100:Corner Fuel', 'hospital:n13000000001:Mercy General', 'hospital:r13000000200:County Hospital', 'town:n13000000003:Riverton'], 'the pharmacy outside the region is left out');
    const mercy = recs.find((x) => x.i === 'n13000000001');
    assert.deepEqual([mercy.a, mercy.o, mercy.d, mercy.p, mercy.x], [35.2, -80.8, '2001 Vale Avenue, Riverton, NC 28207', '+1 555 0100', { emergency: 'yes', beds: '185' }]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('extract: a way or relation drawn as an outline carries the ground it covers', async () => {
  const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'maps', 'registry.json'), 'utf8'));
  const els = [];
  await osm.extract(path.join(__dirname, 'fixtures', 'east-a.osm.pbf'), { filters: registry.categories.flatMap((c) => c.filters || []), onElement: (e) => els.push(e) });
  const outlines = els.filter((e) => e.type !== 'node');
  assert.ok(outlines.length >= 2 && outlines.every((e) => e.size > 100 && e.size < 1e7), JSON.stringify(outlines.map((e) => e.size)));
  assert.ok(els.filter((e) => e.type === 'node').every((e) => e.size === undefined));
  const places = require('../src/core/places');
  const rec = places.recordOf(registry.categories, outlines[0]);
  assert.ok(rec.m > 0 && String(rec.m).replace(/0+$/, '').length <= 2, `kept to two figures: ${rec.m}`);
});
