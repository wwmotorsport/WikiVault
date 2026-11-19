'use strict';
// Directions: what is asked of the routing engine, what is made of its answers, road names from the
// map, the routing data files, and (when Java is on this machine) the real engine on test data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const routing = require('../src/core/routing');
const mvt = require('../src/core/mvt');
const pm = require('../src/core/pmtiles');
const { RouteEngine } = require('../src/core/route-engine');
const { MapsLibrary, loadRegistry } = require('../src/core/maps-library');
const { makeArchive, serve } = require('./helpers-pmtiles');

const FIX = path.join(__dirname, 'fixtures', 'routing');
const ASSETS = path.join(__dirname, '..', 'assets', 'routing');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wv-route-'));
const real = loadRegistry();
const box = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n]];
const hasJava = spawnSync('java', ['-version'], { env: { ...process.env, JAVA_TOOL_OPTIONS: '' } }).status === 0;

test('the routing data files for a region are the five-degree squares it reaches into', () => {
  assert.deepEqual(routing.segmentsFor([box(-80.9, 35.2, -80.7, 35.4)]), ['W85_N35.rd5']);
  assert.deepEqual(routing.segmentsFor([box(-81, 34, -79, 36)]), ['W80_N30.rd5', 'W80_N35.rd5', 'W85_N30.rd5', 'W85_N35.rd5']);
  assert.deepEqual(routing.segmentsFor([box(2, -3, 7, 3)]), ['E0_N0.rd5', 'E0_S5.rd5', 'E5_N0.rd5', 'E5_S5.rd5']);
  const us = routing.segmentsFor(real.regions.find((r) => r.id === 'us48').rings);
  for (const name of ['W125_N45.rd5', 'W85_N35.rd5', 'W100_N25.rd5', 'W70_N45.rd5', 'W85_N20.rd5']) assert.ok(us.includes(name), name);
  for (const name of ['W135_N45.rd5', 'W65_N45.rd5', 'W100_N50.rd5', 'W100_N20.rd5']) assert.ok(!us.includes(name), name);
});

test('a route request names the points, the way of travelling and what to keep clear of', () => {
  const o = { points: [[-80.9, 35.2], [-80.7, 35.4]], mode: 'car' };
  assert.equal(routing.routeUrl('http://127.0.0.1:1', o), 'http://127.0.0.1:1/brouter?lonlats=-80.9,35.2|-80.7,35.4&profile=car-vario&alternativeidx=0&format=geojson&timode=2');
  const u = routing.routeUrl('http://x', { ...o, mode: 'car-rough', alt: 9, noMotorways: true, blocks: [{ lon: -80.8, lat: 35.3, radius: 1609.4 }, { lon: -80.75, lat: 35.25, radius: 2 }, { polygon: [[-80.9, 35.2], [-80.8, 35.2], [-80.8, 35.3]] }, { polygon: [[1, 2]] }] });
  assert.match(u, /&alternativeidx=3&/);
  assert.match(u, /&nogos=-80\.8,35\.3,1609\|-80\.75,35\.25,10&/);
  assert.match(u, /&polygons=-80\.9,35\.2,-80\.8,35\.2,-80\.8,35\.3&/);
  assert.match(u, /&profile:use_offroad=1&profile:avoid_motorways=1$/);
  assert.doesNotMatch(routing.routeUrl('http://x', { ...o, mode: 'foot', noMotorways: true }), /avoid_motorways/);
  assert.throws(() => routing.routeUrl('http://x', { ...o, mode: 'boat' }), /how you are travelling/);
  assert.throws(() => routing.routeUrl('http://x', { points: [[1, 2]], mode: 'car' }), /a start and an end/);
  assert.deepEqual(routing.MODES.map((m) => m.id), ['car', 'car-rough', 'bike', 'mtb', 'foot']);
  for (const m of routing.MODES) assert.ok(fs.existsSync(path.join(ASSETS, 'profiles2', `${m.profile}.brf`)), `${m.profile} is packed with the app`);
});

test('the engine\'s refusals are put in words', () => {
  assert.match(routing.explain('datafile W70_N45.rd5 not found'), /does not cover that far \(W70_N45\.rd5/);
  assert.match(routing.explain('from-position not mapped in existing datafile'), /no road near the start/);
  assert.match(routing.explain('to-position not mapped in existing datafile'), /no road near the destination/);
  assert.match(routing.explain('last wpt in restricted area'), /blocked leave no way to the destination/);
  assert.match(routing.explain('no track found at pass=0'), /No way through was found/);
  assert.match(routing.explain(''), /could not make a route\.$/);
});

const answer = (coords, voicehints, extra = {}) => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { 'track-length': '2000', 'total-time': '300', voicehints, ...extra }, geometry: { type: 'LineString', coordinates: coords } }] });

test('an answer becomes steps: turns named from the map, straight-on only when the road changes', () => {
  const coords = [[-80.90, 35.20, 200], [-80.89, 35.20, 200], [-80.89, 35.21, 200], [-80.89, 35.22, 200], [-80.89, 35.23, 200], [-80.88, 35.23, 200]];
  const names = (lon, lat) => (lat < 35.2001 ? 'South Road' : lat < 35.2201 ? 'Center Street' : lat < 35.2295 ? 'Upper Center Street' : 'North Road');
  const r = routing.parseRoute(answer(coords, [[1, 2, 0, 1112, -90], [2, 1, 0, 1112, 0], [3, 1, 0, 1112, 0], [4, 13, 3, 900, 90], [0, 5, 0, 1, 1], [9, 5, 0, 1, 1]]), names);
  assert.deepEqual(r.steps.map((s) => s.text), ['Start out heading east on South Road', 'Turn left onto Center Street', 'Continue onto Upper Center Street', 'At the roundabout, take the third exit onto North Road', 'Arrive at the destination']);
  assert.deepEqual([r.meters, r.seconds, r.coords.length, r.coords[0].length], [2000, 300, 6, 2]);
  assert.ok(Math.abs(r.steps[0].meters - 911) < 5 && Math.abs(r.steps[1].meters - 2224) < 8 && r.steps.at(-1).meters === 0, JSON.stringify(r.steps.map((s) => s.meters)));
  assert.deepEqual(r.steps[1].at, [-80.89, 35.20]);
  // With no names to be had, the turns still stand; a nameless straight-on is left out.
  const bare = routing.parseRoute(answer(coords, [[1, 2, 0, 1, 1], [2, 1, 0, 1, 1], [4, 7, 0, 1, 1]]));
  assert.deepEqual(bare.steps.map((s) => s.text), ['Start out heading east', 'Turn left', 'Turn sharply right', 'Arrive at the destination']);
  // A turn that keeps to the road already being driven says so, and a road with two numbers is written as both.
  const twice = routing.parseRoute(answer(coords, [[1, 2, 0, 1, 1], [2, 4, 0, 1, 1], [4, 2, 0, 1, 1]]), (lon, lat) => (lat < 35.2001 ? 'South Road' : lat < 35.2295 ? 'I 285;US 52' : 'North Road'));
  assert.deepEqual(twice.steps.map((s) => s.text), ['Start out heading east on South Road', 'Turn left onto I 285 / US 52', 'Turn sharply left to stay on I 285 / US 52', 'Turn left onto North Road', 'Arrive at the destination']);
  assert.throws(() => routing.parseRoute({ features: [] }), /not a route/);
  assert.equal(routing.heading([0, 0], [0, 1]), 'north');
  assert.equal(routing.heading([0, 0], [-1, -1]), 'south-west');
});

test('a road\'s name is read from a real vector tile', () => {
  const tile = fs.readFileSync(path.join(FIX, 'tile-9-141-202.mvt'));
  const roads = mvt.linesOf(tile, 'roads');
  assert.equal(roads.extent, 4096);
  assert.deepEqual(roads.features.map((f) => f.properties.name || f.properties.ref).sort(), ['Center Street', 'Main Road', 'SR 1001']);
  assert.equal(mvt.linesOf(tile, 'buildings'), null);
  const at = (lon, lat) => [(pm.xOfLon(lon, 9) - 141) * 4096, (pm.yOfLat(lat, 9) - 202) * 4096];
  assert.equal(mvt.nearestLine(roads.features, ...at(-80.8, 35.35), 6).feature.properties.name, 'Center Street');
  assert.equal(mvt.nearestLine(roads.features, ...at(-80.75, 35.3001), 6).feature.properties.name, 'Main Road');
  assert.equal(mvt.nearestLine(roads.features, ...at(-80.75, 35.33), 6), null, 'nothing within reach');
});

test('routing data is sized, fetched file by file, carried on after a stop, and swapped in whole', async () => {
  const rd5 = fs.readFileSync(path.join(FIX, 'W85_N35.rd5'));
  const other = Buffer.alloc(300000, 7);
  const tile = fs.readFileSync(path.join(FIX, 'tile-9-141-202.mvt'));
  const world = makeArchive({ maxZoom: 9, tileOf: (z, x, y) => (z === 9 && x === 141 && y === 202 ? zlib.gzipSync(tile) : z < 9 ? zlib.gzipSync(Buffer.from([])) : null) });
  const site = await serve({ 'seg/W85_N35.rd5': rd5, 'seg/W80_N35.rd5': other, 'builds.json': Buffer.from(JSON.stringify([{ key: 'w.pmtiles', version: '4', size: 1, uploaded: '2026-11-16T09:00:00Z' }])), 'w.pmtiles': world.bytes });
  const dir = tmp();
  try {
    const registry = { ...real, builds: { index: `${site.origin}/builds.json`, base: `${site.origin}/` }, routing: { ...real.routing, base: `${site.origin}/seg/` }, regions: [{ id: 'nc', name: 'NC', default: true, rings: [box(-84, 34, -76, 36.5)] }] };
    const lib = new MapsLibrary({ dir, registry, pause: () => Promise.resolve() });
    await lib.init();
    assert.equal(lib.status().routing, null);
    assert.deepEqual(lib.status().modes.map((m) => m.id), ['car', 'car-rough', 'bike', 'mtb', 'foot']);
    const m = await lib.measureRouting(['nc']);
    assert.deepEqual([m.files, m.bytes], [2, rd5.length + other.length], 'four squares asked about, two exist');
    assert.equal(site.requests.filter((r) => r.name.startsWith('seg/')).length, 4);
    await assert.rejects(lib.downloadRouting(['nc'], { free: 1000 }), /not enough free space/);

    // Stop part-way through the larger file, then carry on: only the rest of it is asked for.
    let swaps = 0;
    lib.onRoutingSwap = async () => { swaps += 1; };
    lib.on('progress', () => { const j = lib.status().job; if (j && j.kind === 'routing' && j.done === 0 && j.downloaded > 0) lib.cancel(); });
    assert.equal(await lib.downloadRouting(['nc']), null, 'stopped');
    assert.equal(lib.status().routing, null);
    lib.removeAllListeners('progress');
    const partial = fs.readdirSync(path.join(dir, 'routing', 'segments.new'));
    assert.ok(partial.length >= 1, partial.join());
    site.requests.length = 0;
    const got = await lib.downloadRouting(['nc']);
    assert.deepEqual([got.files, got.bytes, swaps], [2, rd5.length + other.length, 1]);
    assert.deepEqual(fs.readdirSync(lib.segmentsDir).sort(), ['W80_N35.rd5', 'W85_N35.rd5']);
    assert.deepEqual(fs.readFileSync(path.join(lib.segmentsDir, 'W85_N35.rd5')), rd5);
    assert.deepEqual(fs.readFileSync(path.join(lib.segmentsDir, 'W80_N35.rd5')), other);
    assert.ok(!fs.existsSync(path.join(dir, 'routing', 'segments.new')));
    assert.equal(lib.status().bytes, got.bytes);
    const again = new MapsLibrary({ dir, registry });
    await again.init();
    assert.equal(again.status().routing.files, 2);

    // Road names come from the map file, once there is one.
    assert.equal((await lib.roadNames([[-80.8, 35.35]])).size, 0, 'no map, no names');
    await lib.downloadMap(['nc'], 9);
    const names = await lib.roadNames([[-80.8, 35.35], [-80.75, 35.3], [-80.75, 35.33], [-80.85, 35.2]]);
    assert.deepEqual([...names.entries()], [['-80.8,35.35', 'Center Street'], ['-80.75,35.3', 'Main Road'], ['-80.85,35.2', 'SR 1001']]);
    await lib.closeArchive();
  } finally { await site.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the real engine routes on the test roads, goes round what is blocked, and takes a track only when allowed', { skip: hasJava ? false : 'Java is not on this machine' }, async () => {
  const dir = tmp();
  const segments = path.join(dir, 'segments');
  fs.mkdirSync(segments);
  fs.copyFileSync(path.join(FIX, 'W85_N35.rd5'), path.join(segments, 'W85_N35.rd5'));
  const engine = new RouteEngine({ java: 'java', jar: path.join(ASSETS, 'brouter.jar'), profiles: path.join(ASSETS, 'profiles2'), segments, scratch: path.join(dir, 'scratch'), memoryMb: 256 });
  const ask = async (o) => routing.parseRoute(await engine.ask((origin) => routing.routeUrl(origin, o)));
  const through = (r, lon, lat) => r.coords.some((c) => Math.abs(c[0] - lon) < 1e-4 && Math.abs(c[1] - lat) < 1e-4);
  try {
    const corner = { points: [[-80.9, 35.2], [-80.7, 35.4]], mode: 'car' };
    const best = await ask(corner);
    assert.ok(Math.abs(best.meters - 40368) < 50, String(best.meters));
    assert.ok(best.seconds > 1800 && best.seconds < 5400);
    assert.ok(through(best, -80.8, 35.3), 'the best way uses the main crossing');
    assert.deepEqual(best.steps.map((s) => s.text), ['Start out heading east', 'Turn left', 'Turn right', 'Arrive at the destination']);
    assert.ok(engine.running);
    const round = await ask({ ...corner, blocks: [{ lon: -80.8, lat: 35.3, radius: 1500 }] });
    assert.ok(!through(round, -80.8, 35.3) && round.meters >= best.meters - 50, 'the blocked crossing is avoided');
    const other = await ask({ ...corner, alt: 1 });
    assert.notDeepEqual(other.coords, best.coords, 'another route is another route');
    assert.ok((await ask({ ...corner, mode: 'foot' })).seconds > best.seconds * 3, 'walking takes far longer');

    // One block away the roads are cut; only the farm track is left.
    const cut = { points: [[-80.9, 35.2], [-80.85, 35.25]], blocks: [{ lon: -80.85, lat: 35.2, radius: 800 }, { lon: -80.9, lat: 35.25, radius: 800 }] };
    const viaTrack = await ask({ ...cut, mode: 'car-rough' });
    assert.ok(through(viaTrack, -80.875, 35.225) && Math.abs(viaTrack.meters - 7174) < 30);
    await assert.rejects(ask({ ...cut, mode: 'car' }), (err) => /blocked leave no way/.test(routing.explain(err.message)));
    await assert.rejects(ask({ points: [[-80.9, 35.2], [-82.5, 36.5]], mode: 'car' }), (err) => /no road near the destination/.test(routing.explain(err.message)));
    await assert.rejects(ask({ points: [[-70, 45], [-80.7, 35.4]], mode: 'car' }), (err) => /W70_N45\.rd5/.test(routing.explain(err.message)));
    engine.stop();
    assert.ok(!engine.running);
    assert.ok((await ask(corner)).meters > 0, 'it starts again when asked');
  } finally { engine.stop(); await new Promise((r) => setTimeout(r, 200)); fs.rmSync(dir, { recursive: true, force: true }); }
  const missing = new RouteEngine({ java: 'java-that-is-not-here', jar: path.join(ASSETS, 'brouter.jar'), profiles: path.join(ASSETS, 'profiles2'), segments, scratch: path.join(os.tmpdir(), 'wv-none') });
  await assert.rejects(missing.start(), /Java was not found|could not be started/);
});
