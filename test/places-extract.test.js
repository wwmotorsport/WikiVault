'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { MapsLibrary, loadRegistry } = require('../src/core/maps-library');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wv-extract-'));
const real = loadRegistry();
const box = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n]];
const A = fs.readFileSync(path.join(__dirname, 'fixtures', 'east-a.osm.pbf'));
const Bf = fs.readFileSync(path.join(__dirname, 'fixtures', 'east-b.osm.pbf'));
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');

/**
 * A stand-in for the extract server: "-latest" names send on to the file of the day, files are sent whole or
 * from a place in them, and a checksum sits beside a file when `sums` has one for it.
 */
function server() {
  const s = { files: { 'x/east-a': A, 'x/east-b': Bf }, day: '261118', sums: { 'x/east-a': md5(A) }, wrongOnce: new Set(), plain: false, log: [], cut: null, gone: new Set() };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    s.log.push(`${req.method} ${u.pathname}${req.headers.range ? ` ${req.headers.range}` : ''}`);
    let m = /^\/(.+)-latest\.osm\.pbf$/.exec(u.pathname);
    if (m && !s.plain) { if (!s.files[m[1]]) { res.writeHead(404); res.end(); return; } res.writeHead(302, { location: `/${m[1]}-${s.day}.osm.pbf` }); res.end(); return; }
    // `plain`: a server that answers the "-latest" name itself, with whatever today's file is
    m = /^\/(.+)-(\d{6}|latest)\.osm\.pbf(\.md5)?$/.exec(u.pathname);
    if (!m || !s.files[m[1]] || s.gone.has(`${m[1]}-${m[2]}`)) { res.writeHead(404); res.end('not here'); return; }
    if (m[3]) {
      if (!s.sums[m[1]]) { res.writeHead(404); res.end(); return; }
      const sum = s.wrongOnce.delete(m[1]) ? md5(Buffer.from('not this file')) : s.sums[m[1]];
      res.end(`${sum}  ${path.basename(m[1])}-${m[2]}.osm.pbf\n`); return;
    }
    const all = s.files[m[1]];
    const r = /^bytes=(\d+)-$/.exec(req.headers.range || '');
    const from = r ? Number(r[1]) : 0;
    if (from >= all.length && r) { res.writeHead(416); res.end(); return; }
    const body = all.subarray(from);
    res.writeHead(r ? 206 : 200, { 'content-length': body.length, ...(r ? { 'content-range': `bytes ${from}-${all.length - 1}/${all.length}` } : {}) });
    if (req.method === 'HEAD') { res.end(); return; }
    // The line drops: a little arrives the first time, and nothing more however often it is tried.
    if (s.cut && s.cut(m[1], from)) { if (from === 0) res.write(body.subarray(0, 100)); setTimeout(() => res.destroy(), 20); return; }
    res.end(body);
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(Object.assign(s, { origin: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => srv.close(r)) }))));
}
const registry = (origin) => ({
  ...real,
  regions: [{ id: 'east', name: 'East', default: true, rings: [box(-90, 30, -75, 40)] }, { id: 'north', name: 'North', rings: [box(-90, 41, -75, 45)] }],
  extracts: { base: `${origin}/`, regions: {
    east: [{ id: 'east-b', name: 'East B', path: 'x/east-b-latest.osm.pbf', at: [31, -89] }, { id: 'east-a', name: 'East A', path: 'x/east-a-latest.osm.pbf', at: [35, -81] }],
    north: [{ id: 'nowhere', name: 'Nowhere', path: 'x/nowhere-latest.osm.pbf', at: [43, -80] }, { id: 'east-a', name: 'East A', path: 'x/east-a-latest.osm.pbf', at: [35, -81] }],
  } },
});
const open = async (dir, origin, more = {}) => { const lib = new MapsLibrary({ dir, registry: registry(origin), pause: () => Promise.resolve(), agent: 'Wikivault/test', ...more }); await lib.init(); return lib; };
const home = { lat: 35.2, lon: -80.8 };

test('places from extracts: the sizes are asked for without downloading; then each file is fetched, checked, read and deleted, nearest first', async () => {
  const s = await server(); const dir = tmp();
  try {
    const lib = await open(dir, s.origin);
    assert.equal(lib.status().placesHow, 'extract');
    const m = await lib.measurePlaces(['east']);
    assert.deepEqual([m.files, m.bytes, m.largest, m.left, m.missing], [2, A.length + Bf.length, A.length, A.length + Bf.length, []]);
    assert.ok(s.log.every((l) => l.startsWith('HEAD ')), 'measuring reads no map data');
    s.log.length = 0;
    // While the second file is on its way, what the first held is already in use.
    let between = null;
    lib.on('progress', () => { if (!between && lib.job && lib.job.file === 'East B' && lib.status().places) between = { places: lib.status().places, found: lib.search({ q: 'mercy' }).hits.map((h) => h.n) }; });
    const info = await lib.downloadPlaces(['east'], { near: home });
    const gets = s.log.filter((l) => l.startsWith('GET ') && !l.endsWith('.md5'));
    assert.deepEqual(gets, ['GET /x/east-a-261118.osm.pbf', 'GET /x/east-b-261118.osm.pbf'], 'the file nearest home first, and each from the copy of the day');
    assert.ok(!s.log.some((l) => l.startsWith('HEAD ')), 'sizes asked for a moment ago are not asked for again');
    assert.ok(s.log.includes('GET /x/east-a-261118.osm.pbf.md5'), 'the checksum beside the file is read');
    assert.ok(between && between.places.partial && between.places.partial.done === 1 && between.places.partial.total === 2, JSON.stringify(between));
    assert.deepEqual(between.found, ['Mercy General']);
    // Whole: every place once (the hospital both files hold is not doubled), nothing marked as part of a set.
    assert.equal(info.partial, undefined);
    assert.deepEqual([info.total, info.counts.hospital, info.counts.fuel, info.counts.town, info.counts.water_tower, info.counts.pharmacy], [8, 3, 1, 1, 1, 1]);
    assert.deepEqual(lib.search({ q: 'general' }).hits.map((h) => h.n).sort(), ['Far Away General', 'Mercy General']);
    assert.equal(lib.search({ q: 'county hospital' }).hits[0].i, 'r13000000200');
    assert.equal(lib.search({ q: 'outside' }).total, 0);
    // Nothing is left behind: not the extracts, not the working folder.
    assert.equal(fs.existsSync(path.join(dir, 'places.work')), false);
    assert.equal(lib.status().placesKept, null);
    assert.equal(lib.status().placesMeasured.left, m.bytes, 'and a new fetch would be the whole of it again');
  } finally { await s.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('places from extracts: a run that fails keeps what it read and the part of a file it had; the next run carries on from there', async () => {
  const s = await server(); const dir = tmp();
  try {
    const lib = await open(dir, s.origin);
    s.cut = (name) => name === 'x/east-b'; // the far file never arrives whole
    await assert.rejects(lib.downloadPlaces(['east'], { near: home }), /1 of the 2 files could not be fetched \(East B: .*\)\. What was read is kept: fetch the places again to carry on\./);
    assert.ok(!/East B: East B/.test(lib.status().error || ''));
    assert.deepEqual(lib.status().placesKept, { regions: ['east'], done: 1, total: 2, how: 'extract' });
    assert.ok(lib.status().places.partial, 'what was read is in use meanwhile');
    assert.deepEqual(lib.search({ q: 'mercy' }).hits.map((h) => h.n), ['Mercy General']);
    const part = path.join(dir, 'places.work', 'east-b.osm.pbf.part');
    assert.ok(fs.statSync(part).size >= 100 && fs.statSync(part).size < Bf.length);
    assert.equal(fs.existsSync(path.join(dir, 'places.work', 'east-a.osm.pbf')), false, 'a file that was read is deleted at once');
    // Opened again, as after closing the app.
    const again = await open(dir, s.origin);
    assert.deepEqual(again.status().placesKept, { regions: ['east'], done: 1, total: 2, how: 'extract' });
    s.cut = null; s.log.length = 0;
    const info = await again.downloadPlaces(['east'], { near: home });
    const gets = s.log.filter((l) => l.startsWith('GET ') && !l.endsWith('.md5'));
    assert.equal(gets.length, 1);
    assert.match(gets[0], /^GET \/x\/east-b-261118\.osm\.pbf bytes=\d+-$/, 'only the missing file, and only the part of it that was missing');
    assert.deepEqual([info.total, info.partial], [8, undefined]);
    // A whole set in use is not replaced by part of a new one.
    s.cut = (name) => name === 'x/east-b';
    await assert.rejects(again.downloadPlaces(['east'], { near: home }), /could not be fetched/);
    assert.equal(again.status().places.partial, undefined);
    assert.equal(again.search({ q: 'far away' }).total, 3);
  } finally { await s.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('places from extracts: a damaged file is refused, a file the server does not have is named, and a copy that has gone is begun again from today\'s', async () => {
  const s = await server(); const dir = tmp();
  try {
    // Damaged: the checksum beside it says so, and it is not read.
    s.sums['x/east-a'] = md5(Buffer.from('something else'));
    const lib = await open(dir, s.origin);
    await assert.rejects(lib.downloadPlaces(['east'], { near: home }), /could not be fetched \(East A arrived damaged \(it does not match the server's checksum\)\)/);
    assert.equal(fs.existsSync(path.join(dir, 'places.work', 'east-a.osm.pbf')), false);
    assert.equal(lib.search({ q: 'mercy' }).total, 1, 'the other file was read all the same, and it holds that hospital too');
    s.sums['x/east-a'] = md5(A);
    // Not on the server at all: said by name, the rest fetched.
    const dir2 = tmp();
    try {
      const lib2 = await open(dir2, s.origin);
      const m = await lib2.measurePlaces(['north']);
      assert.deepEqual([m.files, m.bytes, m.missing], [2, A.length, ['Nowhere']]);
      await assert.rejects(lib2.downloadPlaces(['north'], { near: home }), /1 of the 2 files could not be fetched \(Nowhere is not on the extract server\)/);
      assert.equal(lib2.status().placesKept.done, 1);
    } finally { fs.rmSync(dir2, { recursive: true, force: true }); }
    // Part of a file from a copy the server has since taken away: begun again from today's copy.
    const dir3 = tmp();
    try {
      const lib3 = await open(dir3, s.origin);
      s.cut = (name) => name === 'x/east-a';
      await assert.rejects(lib3.downloadPlaces(['east'], { near: home }), /could not be fetched/);
      assert.ok(fs.existsSync(path.join(dir3, 'places.work', 'east-a.osm.pbf.part')));
      s.cut = null; s.gone.add('x/east-a-261118'); s.day = '261119'; s.log.length = 0;
      const lib3b = await open(dir3, s.origin);
      const info = await lib3b.downloadPlaces(['east'], { near: home });
      assert.equal(info.total, 8);
      assert.ok(s.log.includes('GET /x/east-a-261119.osm.pbf'), s.log.join(' | '));
    } finally { fs.rmSync(dir3, { recursive: true, force: true }); }
  } finally { await s.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('places from extracts: stopping keeps what is there, and the slow way can still be asked for by name', async () => {
  const s = await server(); const dir = tmp();
  try {
    const lib = await open(dir, s.origin);
    lib.on('progress', () => { if (lib.job && lib.job.file === 'East B') lib.cancel(); });
    assert.equal(await lib.downloadPlaces(['east'], { near: home }), null, 'stopped');
    assert.equal(lib.status().error, null);
    assert.equal(lib.status().placesKept.done, 1);
    // The real registry names an extract for every region it has, each once, with a place to measure from.
    for (const r of real.regions) {
      const list = real.extracts.regions[r.id];
      assert.ok(Array.isArray(list) && list.length, r.id);
      for (const e of list) assert.ok(/^[a-z-]+$/.test(e.id) && e.name && /^north-america\/[a-z/-]+-latest\.osm\.pbf$/.test(e.path) && e.at.length === 2 && e.at[0] > 14 && e.at[0] < 72 && e.at[1] < -50 && e.at[1] > -170, JSON.stringify(e));
    }
    assert.equal(real.extracts.regions.us48.length, 49);
    assert.equal(new Set(Object.values(real.extracts.regions).flat().map((e) => e.id)).size, Object.values(real.extracts.regions).flat().length);
    const all = new MapsLibrary({ dir: tmp(), registry: real });
    const first = all.extractsFor(['us48'])[0];
    assert.match(first.url, /^https:\/\/download\.geofabrik\.de\/north-america\/us\/([a-z-]+)\/\1-latest\.osm\.pbf$/);
  } finally { await s.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('places from extracts: a file replaced on the server during a long run, or a checksum that does not match once, does not fail the run', async () => {
  const s = await server(); const dir = tmp();
  const logged = [];
  try {
    // A checksum that is wrong once (the server was half-way through publishing): the file is fetched again at once, and the run goes on.
    const lib = await open(dir, s.origin, { log: (l) => logged.push(l) });
    s.wrongOnce.add('x/east-a');
    const info = await lib.downloadPlaces(['east'], { near: home });
    assert.deepEqual([info.total, info.partial], [8, undefined]);
    assert.equal(s.log.filter((l) => l === 'GET /x/east-a-261118.osm.pbf').length, 2, 'fetched a second time');
    assert.ok(logged.some((l) => /East A: east-a-261118\.osm\.pbf \(\d+ bytes\) does not match the checksum beside it: the server says [0-9a-f]{32}, the file here is [0-9a-f]{32}/.test(l)), logged.join('\n'));
    assert.ok(logged.some((l) => /places: East A \(east-a-261118\.osm\.pbf\): \d+ places/.test(l)), 'the log says which copy each file came from');

    // The day turns over between measuring and fetching: the file is asked for again just before it is fetched, and today's copy is used.
    const dir2 = tmp();
    try {
      const lib2 = await open(dir2, s.origin);
      await lib2.measurePlaces(['east']);
      lib2.sizesFresh = 0; // as if the sizes had been asked for long ago
      s.day = '261119'; s.gone.add('x/east-a-261118'); s.gone.add('x/east-b-261118'); s.log.length = 0;
      const got = await lib2.downloadPlaces(['east'], { near: home });
      assert.equal(got.total, 8);
      assert.deepEqual(s.log.filter((l) => l.startsWith('GET ') && !l.endsWith('.md5')), ['GET /x/east-a-261119.osm.pbf', 'GET /x/east-b-261119.osm.pbf']);
    } finally { fs.rmSync(dir2, { recursive: true, force: true }); }

    // A server that keeps one name for the newest file: when the file under that name grows or shrinks after it was measured,
    // that is noticed, the size is asked for again, and the new file is fetched whole. It is never fetched over and over.
    for (const [name, swap] of [['larger', Buffer.concat([A, Buffer.alloc(0)])], ['smaller', Bf]]) {
      const dir3 = tmp();
      try {
        s.plain = true; s.sums = {}; s.files = { 'x/east-a': name === 'larger' ? Bf : A, 'x/east-b': Bf };
        const lib3 = await open(dir3, s.origin);
        await lib3.measurePlaces(['east']);
        s.files['x/east-a'] = name === 'larger' ? A : swap; // replaced after it was measured
        s.log.length = 0;
        const got = await lib3.downloadPlaces(['east'], { near: home });
        assert.ok(got.total >= 4 && !got.partial, name);
        const gets = s.log.filter((l) => l.startsWith('GET /x/east-a-latest.osm.pbf') && !l.includes('.md5'));
        assert.ok(gets.length >= 2 && gets.length <= 4, `${name}: ${gets.join(' | ')}`);
      } finally { fs.rmSync(dir3, { recursive: true, force: true }); s.plain = false; }
    }
  } finally { await s.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
