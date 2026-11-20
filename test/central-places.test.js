'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const central = require('../src/core/central-places');
const { MapsLibrary } = require('../src/core/maps-library');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wv-central-'));
const registry = () => { const r = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'maps', 'registry.json'), 'utf8')); r.central = { manifest: 'https://example.test/data/places-manifest.json', maxAgeDays: 60 }; return r; };

/** A library's places as the weekly build leaves them: a few places in the United States and one in Canada. */
function built(dir) {
  const put = (folder, cat, items) => { fs.mkdirSync(path.join(dir, folder), { recursive: true }); fs.writeFileSync(path.join(dir, folder, `${cat}.json`), JSON.stringify({ v: 1, items })); };
  put('places', 'hospital', [{ i: 'w1', n: 'Mercy General Hospital', a: 35.2, o: -80.8, m: 52000, p: '+1 704-555-0100', x: { emergency: 'yes' } }, { i: 'w2', n: 'Hôpital du Nord', a: 56.0, o: -106.0, m: 30000 }]);
  put('places', 'military', [{ i: 'r1', n: 'Fort Example', a: 35.1, o: -79.0, m: 650000000 }, { i: 'w3', n: 'Signal Site', a: 35.3, o: -80.7, m: 3000 }]);
  put('overture', 'fuel', [{ i: 'ov1', n: 'Pump and Go', a: 35.21, o: -80.81, s: 'ov', k: 'gas_station' }]);
  put('overture', 'propane', [{ i: 'ov2', n: 'Blue Rhino Propane Exchange', a: 35.22, o: -80.82, s: 'ov', k: 'propane_supplier', less: true, x: { kind: 'Cylinder exchange at a shop' } }]);
  fs.writeFileSync(path.join(dir, 'places.json'), JSON.stringify({ regions: ['us48', 'canada'], date: '2026-11-16T07:30:00.000Z', total: 4, counts: { hospital: 2, military: 2 }, bytes: 1 }));
  fs.writeFileSync(path.join(dir, 'overture.json'), JSON.stringify({ release: '2026-10-21.0', regions: ['us48', 'canada'], date: '2026-11-16T07:40:00.000Z', total: 2, counts: { fuel: 1, propane: 1 }, bytes: 1, sorted: 2, sorting: { kept: 1, lesser: 1 }, brands: { version: 'x', from: 'fetched' }, others: {} }));
  fs.mkdirSync(path.join(dir, 'official'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'official', 'hospitals-us.json'), JSON.stringify({ date: '2026-11-16T07:41:00.000Z', count: 1, rows: [['MERCY GENERAL HOSPITAL', '1 MAIN ST', 'EXAMPLE', 'NC', '28001', '7045550100', 'Acute Care Hospitals', 'yes']] }));
}

/** A server that hands out the files of a folder by name, and counts what it was asked for. */
async function serve(folder, spoil = null) {
  const asked = [];
  const server = http.createServer((req, res) => {
    const name = path.basename(new URL(req.url, 'http://x').pathname); asked.push(name);
    const file = path.join(folder, name);
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    let body = fs.readFileSync(file);
    if (spoil && spoil(name)) { body = Buffer.from(body); body[body.length - 1] ^= 0xff; }
    res.writeHead(200, { 'content-length': body.length }); res.end(req.method === 'HEAD' ? undefined : body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, asked, close: () => new Promise((r) => server.close(r)) };
}

test('the weekly build is packed into small checked files, and a manifest that says what they are', () => {
  const src = tmp(); const out = tmp();
  try {
    built(src);
    const m = central.pack({ dir: src, out, app: '9.9.9', regions: ['us48', 'canada'] });
    assert.deepEqual(m.files.map((f) => [f.name, f.set, f.cat]), [['osm-hospital.json.gz', 'osm', 'hospital'], ['osm-military.json.gz', 'osm', 'military'], ['ov-fuel.json.gz', 'overture', 'fuel'], ['ov-propane.json.gz', 'overture', 'propane'], ['hospitals-us.json.gz', 'official', undefined]]);
    assert.deepEqual([m.v, m.app, m.regions, m.osm.total, m.overture.release, m.overture.sorted, m.hospitals.count], [1, '9.9.9', ['us48', 'canada'], 4, '2026-10-21.0', 2, 1]);
    for (const f of m.files) { const gz = fs.readFileSync(path.join(out, f.name)); assert.equal(gz.length, f.bytes); assert.equal(central.sha256(gz), f.sha256); }
    assert.equal(m.bytes, m.files.reduce((a, f) => a + f.bytes, 0));
    assert.equal(central.unusable(m, ['us48']), null);
    assert.match(central.unusable(m, ['us48', 'mexico']), /does not cover every region/);
    assert.match(central.unusable(m, ['us48'], 60, Date.now() + 90 * 86400000), /built 90 days ago/);
    assert.match(central.unusable({ ...m, files: [{ name: '../x.json.gz', sha256: 'a'.repeat(64), bytes: 1 }] }, ['us48']), /list of files is not in order/);
    assert.match(central.unusable({ v: 2 }, ['us48']), /not in the form/);
    // A set that is not whole is never packed.
    fs.writeFileSync(path.join(src, 'places.json'), JSON.stringify({ regions: ['us48'], total: 1, counts: {}, partial: { done: 1, total: 60 } }));
    assert.throws(() => central.pack({ dir: src, out, regions: ['us48'] }), /not complete/);
  } finally { fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true }); }
});

test('the app fetches the ready-made set, keeps the places of the regions chosen, and uses them like its own', async () => {
  const src = tmp(); const out = tmp(); const dir = tmp();
  built(src); central.pack({ dir: src, out, app: '9.9.9', regions: ['us48', 'canada'] });
  const site = await serve(out);
  try {
    const lines = [];
    const lib = new MapsLibrary({ dir, registry: registry(), base: site.base, log: (l) => lines.push(l) });
    await lib.init();
    const size = await lib.measurePlaces(['us48']);
    assert.deepEqual([size.how, size.files, size.left === size.bytes, size.osm, size.overture], ['central', 5, true, 4, 2]);
    assert.equal(lib.status().placesMeasured.how, 'central');
    const info = await lib.downloadPlaces(['us48']);
    assert.deepEqual([info.how, info.total, info.counts, info.regions, info.date], ['central', 3, { hospital: 1, military: 2 }, ['us48'], '2026-11-16T07:30:00.000Z'], 'the hospital in Canada is not kept');
    const st = lib.status();
    assert.deepEqual([st.overture.release, st.overture.total, st.overture.sorted, st.overture.how, st.job, st.error], ['2026-10-21.0', 2, 2, 'central', null, null]);
    assert.equal(fs.existsSync(path.join(dir, 'places.central')), false, 'the fetched files are cleared away');
    // Used like its own: sizes, lesser sorts, the hospital list.
    const h = lib.search({ categories: ['hospital'], near: [-80.8, 35.2] }).hits[0];
    assert.deepEqual([h.n, h.m, h.x.listed, h.x.emergency], ['Mercy General Hospital', 52000, 'Medicare hospital list', 'yes']);
    assert.deepEqual(lib.search({ categories: ['propane'], near: [-80.8, 35.2] }).hits.map((r) => [r.n, r.less]), [['Blue Rhino Propane Exchange', true]]);
    assert.deepEqual(lib.search({ categories: ['military'], near: [-80.8, 35.2] }).hits.map((r) => [r.n, Boolean(r.less)]), [['Signal Site', true], ['Fort Example', false]], 'a lot of under five acres is a lesser sort of military site');
    assert.ok(lines.some((l) => /the ready-made set of \d{4}-\d\d-\d\d: 3 places from OpenStreetMap and 2 from Overture Maps/.test(l)));
    // Every region the set covers: nothing is left out.
    assert.equal((await lib.downloadPlaces(['us48', 'canada'])).total, 4);
  } finally { await site.close(); for (const d of [src, out, dir]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('a damaged file is refused and what was there stays; with no set to be had, the places are built here as before', async () => {
  const src = tmp(); const out = tmp(); const dir = tmp();
  built(src); central.pack({ dir: src, out, app: '9.9.9', regions: ['us48', 'canada'] });
  let bad = true;
  const site = await serve(out, (name) => bad && name === 'ov-fuel.json.gz');
  try {
    const lib = new MapsLibrary({ dir, registry: registry(), base: site.base, log: () => {} });
    await lib.init();
    await assert.rejects(lib.downloadPlaces(['us48']), /ov-fuel\.json\.gz arrived damaged/);
    assert.equal(lib.status().places, null, 'nothing was put to use');
    bad = false; site.asked.length = 0;
    assert.equal((await lib.downloadPlaces(['us48'])).total, 3);
    assert.ok(!site.asked.includes('osm-hospital.json.gz') && site.asked.includes('ov-fuel.json.gz'), 'the files that arrived whole are not fetched again');
    // No set: asked for by name it is an error in plain words; left to choose, the app builds the places itself.
    fs.rmSync(path.join(out, 'places-manifest.json'));
    assert.equal(await lib.centralManifest(['us48']), null);
    assert.match(lib.status().placesCentralWhy, /the server answered 404/);
    await assert.rejects(lib.downloadPlaces(['us48'], { how: 'central' }), /ready-made set of places could not be used \(the server answered 404\)/);
    const measured = await lib.measurePlaces(['us48']).catch((e) => e);
    assert.notEqual(measured && measured.how, 'central', 'the size asked for is then that of the extracts');
  } finally { await site.close(); for (const d of [src, out, dir]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('the addresses of the extracts are read from the extract server\'s own index, and the app\'s list is used when it cannot be', async () => {
  const web = tmp(); const dir = tmp();
  fs.writeFileSync(path.join(web, 'index-v1-nogeom.json'), JSON.stringify({ features: [
    { properties: { id: 'us/delaware', parent: 'us', urls: { pbf: 'https://download.geofabrik.de/moved/again/delaware-latest.osm.pbf' } } },
    { properties: { id: 'prince-edward-island', parent: 'canada', urls: { pbf: 'https://download.geofabrik.de/north-america/canada/pei/prince-edward-island-latest.osm.pbf' } } },
    { properties: { id: 'us/maryland', parent: 'us', urls: { pbf: 'https://elsewhere.example/maryland-latest.osm.pbf' } } },
    { properties: { id: 'us/virginia', parent: 'us', urls: {} } },
  ] }));
  const site = await serve(web);
  try {
    const lines = [];
    const lib = new MapsLibrary({ dir, registry: registry(), base: site.base, log: (l) => lines.push(l) });
    await lib.init();
    const urlOf = (region, id) => lib.extractsFor([region]).find((f) => f.id === id || f.name.toLowerCase() === id).url;
    assert.equal(urlOf('us48', 'delaware'), 'https://download.geofabrik.de/north-america/us/delaware/delaware-latest.osm.pbf', 'before the index is read: the list packed with the app, each file in its own folder');
    await lib.learnExtractUrls();
    assert.equal(urlOf('us48', 'delaware'), 'https://download.geofabrik.de/moved/again/delaware-latest.osm.pbf');
    assert.equal(urlOf('canada', 'prince edward island'), 'https://download.geofabrik.de/north-america/canada/pei/prince-edward-island-latest.osm.pbf');
    assert.equal(urlOf('us48', 'maryland'), 'https://download.geofabrik.de/north-america/us/maryland/maryland-latest.osm.pbf', 'an address on another server is not taken');
    assert.equal(urlOf('us48', 'virginia'), 'https://download.geofabrik.de/north-america/us/virginia/virginia-latest.osm.pbf');
    // No index: the list packed with the app, and a line in the log.
    const bare = new MapsLibrary({ dir, registry: registry(), base: site.base.replace(/\d+$/, '1'), log: (l) => lines.push(l) });
    await bare.init(); await bare.learnExtractUrls();
    assert.equal(bare.extractsFor(['us48'])[0].url.startsWith('https://download.geofabrik.de/north-america/us/'), true);
    assert.ok(lines.some((l) => /extract server's index could not be read/.test(l)));
  } finally { await site.close(); for (const d of [web, dir]) fs.rmSync(d, { recursive: true, force: true }); }
});
