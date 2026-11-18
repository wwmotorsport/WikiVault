'use strict';
// Maps: cutting a region out of a PMTiles file on a web server.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pm = require('../src/core/pmtiles');
const { RangeSource, measure, plan, download, check, LocalArchive } = require('../src/core/map-extract');
const { makeArchive, serve } = require('./helpers-pmtiles');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wv-map-'));
const OCEAN = Buffer.from('ocean');
const md5 = (t) => require('node:crypto').createHash('md5').update(t).digest();
// A world to zoom 8, stored unpacked. West of longitude -30 is "land" with a tile of its own everywhere, each of a
// different length so that the index is large; the rest is one shared ocean tile.
const tileOf = (z, x, y) => (pm.lonOfX(x + 0.5, z) < -30 ? Buffer.from(`${z}/${x}/${y}:${md5(`${z}.${x}.${y}`).toString('hex').repeat(8).slice(0, md5(`n${z}.${x}.${y}`).readUInt8(0))}`) : OCEAN);
const world = makeArchive({ maxZoom: 8, tileOf, tileCompression: 1, metadata: { name: 'test world', vector_layers: [{ id: 'earth' }] } });
const box = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n]];
const REGION = [box(-100, 30, -80, 45)];
const fast = { pause: () => Promise.resolve() };

test('tile numbers follow the format, and a directory survives writing and reading', async () => {
  const ref = await import('pmtiles');
  for (const [z, x, y] of [[0, 0, 0], [1, 1, 0], [5, 17, 9], [12, 1205, 1539], [15, 9000, 12000], [20, 123456, 654321]]) assert.equal(pm.zxyToId(z, x, y), ref.zxyToTileId(z, x, y));
  assert.equal(pm.zoomOfId(pm.zxyToId(9, 3, 4)), 9);
  const dir = { n: 4, ids: Float64Array.of(5, 6, 900, 2 ** 40), runs: Uint32Array.of(1, 3, 0, 7), lengths: Uint32Array.of(10, 20, 30, 40), offsets: Float64Array.of(0, 10, 500, 2 ** 37) };
  const back = pm.parseDirectory(pm.serializeDirectory(dir));
  for (const k of ['ids', 'runs', 'lengths', 'offsets']) assert.deepEqual([...back[k]], [...dir[k]]);
  assert.ok(world.leaves > 0, 'the test world is big enough to need leaf directories');
});

test('the tiles covering a region are whole ranges, and nothing outside it', () => {
  const inside = (id, ranges) => ranges.some(([a, b]) => id >= a && id < b);
  for (const z of [3, 7, 12]) {
    const ranges = pm.coverRanges(REGION, z);
    const tile = (lon, lat) => pm.zxyToId(z, Math.floor(pm.xOfLon(lon, z)), Math.floor(pm.yOfLat(lat, z)));
    assert.ok(inside(tile(-90, 38), ranges) && inside(tile(-99.9, 30.1), ranges) && inside(tile(-80.1, 44.9), ranges), `zoom ${z}: inside`);
    assert.ok(!inside(tile(100, -30), ranges), `zoom ${z}: far outside`);
    if (z >= 7) assert.ok(!inside(tile(-120, 38), ranges) && !inside(tile(-90, 60), ranges) && !inside(tile(-70, 38), ranges), `zoom ${z}: just outside`);
    for (let i = 1; i < ranges.length; i++) assert.ok(ranges[i][0] > ranges[i - 1][1], 'sorted and merged');
  }
});

test('measuring adds up each level of detail from the index alone', async () => {
  const site = await serve({ 'world.pmtiles': world.bytes });
  try {
    const src = new RangeSource(`${site.origin}/world.pmtiles`, fast);
    const m = await measure(src, REGION);
    assert.equal(m.maxZoom, 8);
    assert.deepEqual(m.zooms.map((z) => z.zoom), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    // Count by hand: every tile of the region at zoom 7 is land with its own data.
    const z7 = pm.coverRanges(REGION, 7).reduce((a, [f, t]) => a + (t - f), 0);
    assert.equal(m.zooms[7].tiles, z7);
    let bytes = 0;
    for (let x = 0; x < 128; x++) for (let y = 0; y < 128; y++) if (pm.coverRanges(REGION, 7).some(([a, b]) => pm.zxyToId(7, x, y) >= a && pm.zxyToId(7, x, y) < b)) bytes += tileOf(7, x, y).length;
    assert.equal(m.zooms[7].bytes, bytes);
    assert.equal(m.zooms[8].upTo, m.zooms.reduce((a, z) => a + z.bytes, 0));
    assert.ok(m.zooms[8].bytes > m.zooms[7].bytes * 3, 'each level is about four times the one before');
    assert.ok(m.indexBytes < world.bytes.length / 4, `only part of the file was read (${m.indexBytes} of ${world.bytes.length})`);
    assert.ok(site.requests.every((r) => r.range), 'every request asked for a range');
  } finally { await site.close(); }
});

test('a region is cut into a file that an independent reader accepts, tile for tile', async () => {
  const site = await serve({ 'world.pmtiles': world.bytes });
  const dir = tmp();
  try {
    const src = new RangeSource(`${site.origin}/world.pmtiles`, fast);
    const p = await plan(src, REGION, 6);
    const dest = path.join(dir, 'map.pmtiles');
    const seen = [];
    const r = await download(src, p, dest, { onProgress: (x) => seen.push(x.downloaded) });
    assert.equal(fs.statSync(dest).size, r.bytes);
    assert.ok(r.bytes < world.bytes.length / 5 && r.fetched < world.bytes.length / 3, 'far less than the whole file was fetched');
    assert.equal(seen.at(-1), r.bytes);
    assert.ok(!fs.existsSync(`${dest}.part`) && !fs.existsSync(`${dest}.part.json`));
    const c = await check(dest);
    assert.deepEqual([c.minZoom, c.maxZoom], [0, 6]);

    // Read it back with the reference library.
    const ref = await import('pmtiles');
    const fd = fs.openSync(dest, 'r');
    const source = { getKey: () => dest, getBytes: async (offset, length) => { const b = Buffer.alloc(length); const n = fs.readSync(fd, b, 0, length, offset); return { data: b.buffer.slice(b.byteOffset, b.byteOffset + n) }; } };
    const archive = new ref.PMTiles(source);
    const header = await archive.getHeader();
    assert.equal(header.maxZoom, 6);
    assert.deepEqual((await archive.getMetadata()).name, 'test world');
    const at = (z, lon, lat) => [z, Math.floor(pm.xOfLon(lon, z)), Math.floor(pm.yOfLat(lat, z))];
    for (const [z, x, y] of [at(0, 0, 0), at(3, -90, 38), at(6, -90, 38), at(6, -99, 31), at(6, -81, 44)]) {
      const got = await archive.getZxy(z, x, y);
      assert.ok(got, `tile ${z}/${x}/${y} is there`);
      assert.equal(Buffer.from(got.data).toString(), tileOf(z, x, y).toString(), `tile ${z}/${x}/${y} is the right one`);
    }
    assert.equal(await archive.getZxy(...at(6, 100, 0)), undefined, 'a tile far outside the region was left out');
    assert.equal(await archive.getZxy(...at(7, -90, 38)), undefined, 'zoom 7 was left out');
    fs.closeSync(fd);
    const mine = await new LocalArchive(dest).open();
    assert.deepEqual(await mine.tile(...at(6, -90, 38)), tileOf(...at(6, -90, 38)));
    assert.equal(await mine.tile(...at(6, 100, 0)), null);
    await mine.close();
  } finally { await site.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a stopped download carries on where it was, and a dropped connection is retried', async () => {
  const site = await serve({ 'world.pmtiles': world.bytes });
  const dir = tmp();
  try {
    const dest = path.join(dir, 'map.pmtiles');
    const big = [box(-179, -60, -31, 70)]; // most of the land: many requests
    const src = new RangeSource(`${site.origin}/world.pmtiles`, fast);
    const p = await plan(src, big, 7);
    assert.ok(p.batches.length >= 1);
    // Stop after the first progress report past the front matter.
    const stop = new AbortController();
    let calls = 0;
    await assert.rejects(download(src, p, dest, { signal: stop.signal, onProgress: () => { calls += 1; if (calls === 2) stop.abort(); } }));
    assert.ok(fs.existsSync(`${dest}.part`) && !fs.existsSync(dest));
    // Again, with two requests failing on the way.
    const src2 = new RangeSource(`${site.origin}/world.pmtiles`, fast);
    const p2 = await plan(src2, big, 7);
    assert.equal(p2.fingerprint, p.fingerprint);
    site.fail(2);
    const r = await download(src2, p2, dest);
    assert.equal(fs.statSync(dest).size, r.bytes);
    const a = await new LocalArchive(dest).open();
    const z = 7; const x = Math.floor(pm.xOfLon(-100, z)); const y = Math.floor(pm.yOfLat(40, z));
    assert.deepEqual(await a.tile(z, x, y), tileOf(z, x, y));
    await a.close();
    // A server that will not serve ranges is refused in words.
    const whole = await serve({ 'world.pmtiles': () => world.bytes });
    const noRange = new RangeSource(`${whole.origin}/world.pmtiles`, { ...fast, retries: 0, fetchImpl: (u, o) => fetch(u, { ...o, headers: {} }) });
    await assert.rejects(noRange.read(100, 10), /does not serve parts of files/);
    await whole.close();
    await assert.rejects(new RangeSource(`${site.origin}/missing.pmtiles`, fast).read(0, 10), /answered 404/);
  } finally { await site.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
