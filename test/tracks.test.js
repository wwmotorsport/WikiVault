'use strict';
// Breadcrumbs: positions become trips, split where the receiver stood still, measured, named from the towns the
// map data knows, kept on disk, found again by place and by date, and removed when asked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TrackStore, simplify, metres, GAP_MS } = require('../src/core/tracks');

const T0 = Date.UTC(2026, 10, 23, 12, 50, 0);
// The towns of this test's world, by longitude: a drive east goes from Westville through Midway to Eastham.
const describe = (lat, lon) => (lon < -74.95 ? 'Westville' : lon < -74.6 ? 'Midway' : lon < -74.3 ? 'Eastham' : 'Far Harbor');
/** A drive due east at 40 N: `n` positions, `step` degrees apart, two seconds apart, from `lon0` at `t0`. */
const drive = (t0, lon0, n, step = 0.001, lat = 40) => Array.from({ length: n }, (_, i) => ({ t: t0 + i * 2000, lat, lon: lon0 + i * step, speed: 20 }));

test('a line is thinned without losing its shape', () => {
  const straight = Array.from({ length: 200 }, (_, i) => [-75 + i * 0.0005, 40]);
  assert.deepEqual(simplify(straight), [straight[0], straight[199]]);
  const corner = [...straight.slice(0, 100), ...Array.from({ length: 100 }, (_, i) => [-75 + 99 * 0.0005, 40 + (i + 1) * 0.0005])];
  const thin = simplify(corner);
  assert.equal(thin.length, 3, 'two ends and the corner');
  assert.deepEqual(thin[1], [-75 + 99 * 0.0005, 40]);
  assert.deepEqual(simplify([[1, 1]]), [[1, 1]]);
  assert.ok(Math.abs(metres(40, -75, 40, -74) - 85180) < 300);
});

test('positions become trips: split at a stop, measured, named, kept and found again', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-tracks-'));
  try {
    const s = new TrackStore(path.join(dir, 'tracks'), { describe }).load();
    assert.deepEqual(s.summary(), { count: 0, meters: 0, first: null, last: null, recording: null });
    // Morning: Westville to Eastham, in batches as the window sends them.
    const out = drive(T0, -75.0, 600);
    assert.deepEqual(s.add(out.slice(0, 5)), { id: '20261123T125000', started: true });
    assert.deepEqual(s.add(out.slice(5, 300)), { id: '20261123T125000', started: false });
    assert.equal(s.summary().recording.count, 300);
    assert.equal(s.lines().length, 1, 'the trip being recorded can be drawn as it grows');
    assert.equal(s.lines()[0].live, true);
    s.add(out.slice(300));
    assert.equal(s.idle(out[599].t + GAP_MS - 1000), null, 'a short stop does not end it');
    const first = s.idle(out[599].t + GAP_MS + 1000);
    assert.deepEqual([first.id, first.count, first.from, first.to, first.via], ['20261123T125000', 600, 'Westville', 'Eastham', ['Midway']]);
    assert.ok(Math.abs(first.meters - 51025) < 300, `about 51 km, said ${first.meters}`);
    assert.deepEqual(first.box, [-75, 40, -74.401, 40]);
    // Evening: back again, begun by the first position after the long stop. And a wander in a car park, not kept.
    const back = drive(T0 + 8 * 3600e3, -74.401, 600, -0.001);
    assert.equal(s.add(back).started, true);
    const park = [0, 1, 2, 3, 4].map((i) => ({ t: back[599].t + GAP_MS + 60000 + i * 2000, lat: 40.2, lon: -75 + i * 0.0001, speed: 1 }));
    assert.deepEqual(s.add(park), { id: s.summary().recording.id, started: true });
    assert.equal(s.close(), null, 'forty metres is not a trip');
    assert.deepEqual(s.summary().count, 2);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'tracks')).sort(), ['20261123T125000.csv', '20261123T125000.line.json', '20261123T205000.csv', '20261123T205000.line.json', 'index.json']);

    // Found by place (the ends and what was passed), by date, and both; newest first.
    assert.deepEqual(s.list().map((t) => t.id), ['20261123T205000', '20261123T125000']);
    assert.deepEqual(s.list({ text: 'midway' }).length, 2);
    assert.deepEqual(s.list({ text: 'eastham west' }).length, 2);
    assert.deepEqual(s.list({ text: 'harbor' }), []);
    assert.deepEqual(s.list({ after: T0 + 4 * 3600e3 }).map((t) => t.id), ['20261123T205000']);
    assert.deepEqual(s.list({ before: T0 + 4 * 3600e3 }).map((t) => t.id), ['20261123T125000']);
    assert.deepEqual(s.list({ text: 'Westville', after: T0 - 86400e3, before: T0 - 3600e3 }), []);

    // For the map: thin lines, and the positions themselves, newest first and no more than asked for.
    assert.deepEqual(s.lines().map((l) => [l.id, l.c.length]), [['20261123T125000', 2], ['20261123T205000', 2]]);
    assert.equal(s.dots().length, 1200);
    assert.deepEqual(s.dots(3), [[-74.401, 40], [-74.402, 40], [-74.403, 40]]);
    assert.deepEqual(s.points('20261123T125000')[1], [-74.999, 40, T0 + 2000, 20]);
    assert.deepEqual(s.points('../index'), []);

    // Read again another day: the same trips. One that was being recorded when the app stopped is finished from its file.
    fs.appendFileSync(path.join(dir, 'tracks', '20261124T090000.csv'), drive(T0 + 86400e3, -75, 80).map((p) => `${p.t},${p.lat},${p.lon},20\n`).join(''));
    const again = new TrackStore(path.join(dir, 'tracks'), { describe }).load();
    assert.deepEqual(again.list().map((t) => [t.id, t.from, t.to]), [['20261124T090000', 'Westville', 'Midway'], ['20261123T205000', 'Eastham', 'Westville'], ['20261123T125000', 'Westville', 'Eastham']]);

    // One removed, then all.
    assert.equal(again.remove('20261123T205000'), true);
    assert.equal(again.remove('20261123T205000'), false);
    assert.equal(fs.existsSync(path.join(dir, 'tracks', '20261123T205000.csv')), false);
    assert.equal(again.clear(), true);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'tracks')), ['index.json']);
    assert.equal(new TrackStore(path.join(dir, 'tracks')).load().summary().count, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('nonsense is not recorded, and a store with no map data still keeps trips', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-tracks-'));
  try {
    const s = new TrackStore(dir).load();
    assert.equal(s.add([{ t: 'x', lat: 1, lon: 1 }, { t: 1, lat: 99, lon: 1 }, null, { t: 2, lat: 1, lon: 999 }]), null);
    assert.equal(s.add('not a list'), null);
    s.add(drive(T0, -75, 30));
    const t = s.close();
    assert.deepEqual([t.from, t.to, t.via], ['', '', []]);
    // A clock that went backwards starts a new trip instead of drawing a line through time.
    s.add(drive(T0 + 3600e3, -75, 30)); s.add(drive(T0, -75, 30));
    assert.equal(s.close().start, T0);
    assert.equal(s.summary().count, 3);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
