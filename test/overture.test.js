'use strict';
// Overture Maps: finding the release, fetching only the groups of rows a region needs, and what comes of them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { serve } = require('./helpers-pmtiles');
const { overtureFiles, overtureConfig, addressRows, RELEASE } = require('./helpers-overture');
const { MapsLibrary, loadRegistry } = require('../src/core/maps-library');
const overture = require('../src/core/overture');

const registry = (origin) => ({ ...loadRegistry(), overture: overtureConfig(origin) });
const fast = { pause: () => Promise.resolve() };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wv-ov-'));
const write = (file, v) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(v)); };

/** A library that already has a few places from OpenStreetMap. */
function seeded(dir) {
  const towns = [{ i: 'n1', a: 35.41, o: -80.58, n: 'Concord', x: { kind: 'city', population: '105000' } }, { i: 'n2', a: 35.32, o: -80.66, n: 'Harrisburg', x: { kind: 'town' } }, { i: 'n3', a: 40.27, o: -76.88, n: 'Harrisburg', x: { kind: 'city', population: '50000' } }];
  write(path.join(dir, 'places', 'town.json'), { items: towns });
  write(path.join(dir, 'places', 'pharmacy.json'), { items: [{ i: 'n9', a: 35.2301, o: -80.8403, n: 'CVS' }] });
  write(path.join(dir, 'places.json'), { regions: ['us48'], date: '2026-11-17T00:00:00Z', total: 4, counts: { town: 3, pharmacy: 1 }, bytes: 500 });
}

test('measuring reads only footers, and leaves out groups of rows that lie outside the regions', async () => {
  const site = await serve(overtureFiles());
  const dir = tmp();
  try {
    const lib = new MapsLibrary({ dir, registry: registry(site.origin), ...fast });
    await lib.init();
    const m = await lib.measureOverture(['us48']);
    assert.equal(m.release, RELEASE);
    const us = addressRows().filter((r) => r.country === 'US').length;
    assert.ok(m.addresses.rows >= us && m.addresses.rows < addressRows().length, `${m.addresses.rows} rows of ${addressRows().length}`);
    assert.equal(m.addresses.rows % 120, 0, 'whole groups');
    assert.ok(m.places.rows >= 11 && m.places.rows <= 16 && m.places.bytes > 0 && m.addresses.files === 1);
    assert.deepEqual(lib.status().overtureMeasured.regions, ['us48']);
    // Nothing but lists and the ends of the two files was asked for.
    const ranged = site.requests.filter((r) => r.range);
    assert.ok(ranged.length >= 2 && ranged.length <= 4, `${ranged.length} ranged requests`);
    assert.equal(lib.status().job, null);
    // Canada alone has none of these rows.
    const none = await lib.measureOverture(['hawaii']);
    assert.deepEqual([none.addresses.rows, none.places.rows], [0, 0]);
  } finally { await site.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fetching builds the address index and adds places OpenStreetMap does not have', async () => {
  const site = await serve(overtureFiles());
  const dir = tmp();
  try {
    seeded(dir);
    const lib = new MapsLibrary({ dir, registry: registry(site.origin), ...fast });
    await lib.init();
    assert.deepEqual(lib.findAddress('120 N Main St, Charlotte'), { hits: [], tried: false }, 'no index yet');
    const seen = [];
    lib.on('progress', () => { const j = lib.status().job; if (j) { assert.equal(j.kind, 'overture'); seen.push(`${j.what}:${j.stage}`); } });
    const out = await lib.downloadOverture(['us48']); // on a worker thread
    assert.equal(out.release, RELEASE);
    assert.ok(seen.includes('places:rows') && seen.includes('addresses:rows') && seen.includes('addresses:index'), [...new Set(seen)].join());

    const st = lib.status();
    assert.deepEqual(st.overture.counts, { hospital: 2, pharmacy: 2, fuel: 1, hardware: 1, weapons: 1 });
    assert.deepEqual([st.addresses.addresses, st.addresses.release, st.addresses.offsets], [146, RELEASE, undefined]);
    assert.ok(st.bytes > 500 && st.categories.find((c) => c.id === 'pharmacy').extra === 2);
    assert.ok(!fs.existsSync(path.join(dir, 'addresses.work')) && !fs.existsSync(path.join(dir, 'overture.work')));

    // Places: the CVS that OpenStreetMap already has is not listed twice; the other pharmacy is added and marked.
    const ph = lib.recordsOf('pharmacy');
    assert.deepEqual(ph.map((r) => [r.n, r.s || 'osm']), [['CVS', 'osm'], ['Corner Drugs', 'ov']]);
    const hw = lib.search({ categories: ['hardware'] }).hits;
    assert.deepEqual(hw.map((r) => [r.n, r.kind, r.d, r.p]), [['Ace Hardware', 'Hardware and building supply', '1 Test Rd, Charlotte, NC 28202', '+17045550100']]);
    assert.deepEqual(lib.search({ q: 'little ones' }).hits.map((r) => r.c), ['hospital']);

    // Addresses, through the same search as places.
    const exact = lib.search({ q: '120 N Main St, Charlotte, NC' }).hits[0];
    assert.deepEqual([exact.kind, exact.how, exact.approx, exact.n, exact.o, exact.a], ['Address', 'exact', false, '120 N Main St, Charlotte, NC 28202', -80.848, 35.23]);
    const mid = lib.search({ q: '154 n main st charlotte' }).hits[0];
    assert.deepEqual([mid.how, mid.approx], ['between', true]);
    assert.match(mid.d, /between 148 and 162/);
    assert.equal(lib.findAddress('30 Elm Ave, Concord, NC').hits[0].how, 'exact', 'the postal city is the town');
    // A street whose rows name no town is found through the town's own position, the nearer Harrisburg.
    const oak = lib.findAddress('506 Oak Hollow Rd, Harrisburg, NC', [-80.8, 35.2]).hits[0];
    assert.deepEqual([oak.how, oak.n], ['between', '506 Oak Hollow Rd, NC']);
    // Nothing to place it by but the town: better than nothing, and said to be approximate.
    const town = lib.findAddress('999 Unknown Rd, Concord, NC').hits[0];
    assert.deepEqual([town.how, town.approx, town.n, town.a], ['town', true, 'Concord, NC', 35.41]);
    assert.match(town.d, /^Approximate\. That street is not in the address data/);
    assert.deepEqual(lib.findAddress('Concord'), { hits: [], tried: false }, 'a bare name is a place, not an address');
    assert.equal(lib.search({ q: 'concord' }).hits[0].n, 'Concord');

    // After a restart everything is still there.
    const again = new MapsLibrary({ dir, registry: registry(site.origin), ...fast });
    await again.init();
    assert.equal(again.status().addresses.addresses, 146);
    assert.equal(again.findAddress('1 Main St, Monroe').hits[0].how, 'exact');
  } finally { await site.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('one kind can be fetched alone, on the main thread; a stop leaves what was there; the release is found without the list', async () => {
  const site = await serve(overtureFiles({ withReleaseList: false }));
  const dir = tmp();
  try {
    const lib = new MapsLibrary({ dir, registry: registry(site.origin), ...fast });
    await lib.init();
    const out = await lib.downloadOverture(['us48'], { kinds: ['places'], inline: true });
    assert.deepEqual([out.release, out.places.total, out.addresses], [RELEASE, 7, undefined]);
    assert.equal(lib.status().addresses, null);
    assert.equal(lib.search({ q: 'ace' }).hits[0].n, 'Ace Hardware', 'places from Overture alone can be searched');

    const going = lib.downloadOverture(['us48'], { kinds: ['addresses'] });
    lib.cancel();
    assert.equal(await going, null);
    assert.deepEqual([lib.status().job, lib.status().error, lib.status().addresses, lib.status().overture.total], [null, null, null, 7]);
    await lib.measureOverture(['us48']);
    await assert.rejects(lib.downloadOverture(['us48'], { kinds: ['addresses'], free: 1000 }), /free space/);
    assert.equal(lib.status().addresses, null);
    const got = await lib.downloadOverture(['us48'], { kinds: ['addresses'], free: 1e12 });
    assert.equal(got.addresses.addresses, 146);
    assert.equal(lib.status().addresses.addresses, 146);
  } finally { await site.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a fetch that is cut off carries on from the files it had finished', async () => {
  const files = overtureFiles();
  const key = Object.keys(files).find((k) => k.includes('theme=addresses'));
  // The same rows again as a second file, which fails the first time round.
  const second = key.replace('part-00000', 'part-00001');
  files[second] = files[key];
  const site = await serve(files);
  const dir = tmp();
  try {
    const cfg = overtureConfig(site.origin);
    const reg = loadRegistry();
    const rings = reg.regions.find((r) => r.id === 'us48').rings;
    let broken = true; let asked = 0;
    // The second file's footer can be read, and after that the connection fails every time.
    const net = () => new overture.Net({ ...fast, fetchImpl: async (u, o) => { if (u.includes('part-00001') && (asked++ > 0) && broken) throw new Error('cut'); return require('../src/core/httpx').fetchLike(u, o); } });
    const args = { dir, cfg, rings, regions: ['us48'], release: RELEASE };
    await assert.rejects(overture.importAddresses({ ...args, net: net() }), /cut/);
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'addresses.work', 'state.json'), 'utf8'));
    assert.deepEqual(state.done, [key], 'the first file was finished and noted');
    const before = site.requests.length;
    broken = false; asked = 0;
    const info = await overture.importAddresses({ ...args, net: net() });
    assert.equal(info.addresses, 146, 'the second file adds nothing new, and nothing is counted twice');
    assert.equal(site.requests.slice(before).filter((r) => r.name === key).length, 1, 'of the finished file only the footer was read again');
    assert.ok(!fs.existsSync(path.join(dir, 'addresses.work')));
    // A different release starts afresh.
    fs.mkdirSync(path.join(dir, 'addresses.work'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'addresses.work', 'state.json'), JSON.stringify({ stamp: 'old|us48', done: [key, second], bytes: 1, at: null }));
    assert.equal((await overture.importAddresses({ ...args, net: net() })).addresses, 146);
    // Large groups of rows are read a part at a time, with the same result.
    assert.equal((await overture.importAddresses({ ...args, net: net(), sliceRows: 50 })).addresses, 146);
  } finally { await site.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a release that has been taken away is reported in plain words', async () => {
  const files = overtureFiles();
  for (const k of Object.keys(files)) if (k.endsWith('.parquet')) delete files[k];
  const site = await serve(files);
  const dir = tmp();
  try {
    const lib = new MapsLibrary({ dir, registry: registry(site.origin), ...fast });
    await lib.init();
    await assert.rejects(lib.measureOverture(['us48']), /answered 404|has no places files/);
    assert.match(lib.status().error, /404|no places files/);
  } finally { await site.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('only columns at the top of a file are asked for, whatever is nested under the same name', () => {
  const col = (path, off) => ({ meta_data: { path_in_schema: path, data_page_offset: BigInt(off), total_compressed_size: 10n, statistics: path[0] === 'bbox' ? { min_value: -81, max_value: -80 } : undefined } });
  const md = {
    schema: [{ name: 'root', num_children: 4 }, { name: 'bbox', num_children: 2 }, { name: 'xmin' }, { name: 'ymin' }, { name: 'street' }, { name: 'sources', num_children: 1 }, { name: 'number' }, { name: 'extra' }],
    row_groups: [{ num_rows: 5n, columns: [col(['bbox', 'xmin'], 100), col(['bbox', 'ymin'], 110), col(['street'], 120), col(['sources', 'number'], 130), col(['extra'], 140)] }],
  };
  const plan = overture.planFile(md, 'addresses', [[-125, 24, -66, 50]]);
  assert.deepEqual(plan.columns, ['bbox', 'street'], 'the "number" inside sources is not the address number');
  assert.deepEqual(plan.groups[0].ranges, [[100, 110], [110, 120], [120, 130]]);
  // The footer gives no box for ymin's upper end, so the group cannot be ruled out, even for a region elsewhere.
  assert.equal(overture.planFile(md, 'addresses', [[0, 0, 1, 1]]).groups.length, 1);
  assert.deepEqual(overture.groupBox({ columns: [{ meta_data: { path_in_schema: ['bbox', 'xmin'], statistics: { min_value: 1, max_value: 2 } } }, { meta_data: { path_in_schema: ['bbox', 'xmax'], statistics: { min_value: 1, max_value: 3 } } }, { meta_data: { path_in_schema: ['bbox', 'ymin'], statistics: { min_value: 5, max_value: 6 } } }, { meta_data: { path_in_schema: ['bbox', 'ymax'], statistics: { min_value: 5, max_value: 7 } } }] }), [1, 5, 3, 7]);
});
