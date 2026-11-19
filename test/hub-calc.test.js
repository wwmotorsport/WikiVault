'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { driveParts, Rate, timeLeft } = require('../src/renderer/hub-calc');

const GB = 1e9;
test('the drive bar: other files, what the app has, what is to come, and what stays free', () => {
  const d = driveParts({ total: 1000 * GB, free: 500 * GB }, 150 * GB, 100 * GB);
  assert.deepEqual([d.other, d.app, d.add, d.short, d.freeAfter].map((n) => n / GB), [350, 150, 100, 0, 400]);
  assert.deepEqual(d.parts.map((p) => [p.key, Math.round(p.share * 100)]), [['other', 35], ['app', 15], ['add', 10], ['free', 40]]);
  assert.equal(Math.round(d.parts.reduce((n, p) => n + p.share, 0) * 1000), 1000);
  // More to come than there is room for: the bar fills, and the shortfall is told apart.
  const s = driveParts({ total: 200 * GB, free: 30 * GB }, 120 * GB, 80 * GB);
  assert.deepEqual([s.add / GB, s.short / GB, s.freeAfter], [30, 50, 0]);
  assert.deepEqual(s.parts.map((p) => p.key), ['other', 'app', 'over']);
  // Nothing of the app's yet, nothing to come; and figures that do not add up are kept within the drive.
  assert.deepEqual(driveParts({ total: 100, free: 60 }).parts.map((p) => [p.key, p.bytes]), [['other', 40], ['free', 60]]);
  assert.deepEqual(driveParts({ total: 100, free: 60 }, 90, 0).parts.map((p) => [p.key, p.bytes]), [['app', 40], ['free', 60]]);
  assert.equal(driveParts(null, 1, 1), null);
  assert.equal(driveParts({ total: 0, free: 0 }), null);
});

test('download speed: worked out from the bytes seen over the last seconds', () => {
  const r = new Rate(10000);
  assert.equal(r.get(0), null);
  r.push(0, 0); r.push(1e6, 500);
  assert.equal(r.get(500), null, 'half a second is too little to go by');
  r.push(4e6, 2000);
  assert.equal(r.get(2000), 2e6);
  for (let t = 3000; t <= 20000; t += 1000) r.push(4e6 + (t - 2000) * 1000, t); // then a steady megabyte a second
  assert.equal(Math.round(r.get(20000) / 1e5) / 10, 1, 'old readings are let go');
  assert.ok(r.get(26000) < r.get(20000) && r.get(60000) > 0, 'a stall brings the speed down');
  r.push(100, 61000);
  assert.equal(r.get(61000), null, 'a count that starts again starts the sum again');
  assert.equal(timeLeft(30e6, 1e6), 'under a minute left');
  assert.equal(timeLeft(600e6, 1e6), 'about 10 minutes left');
  assert.equal(timeLeft(60e6, 1e6), 'about 1 minute left');
  assert.equal(timeLeft(9000e6, 1e6), 'about 2.5 hours left');
  assert.equal(timeLeft(72000e6, 1e6), 'about 20 hours left');
  assert.equal(timeLeft(1e15, 1e6), 'about 11574 days left');
  assert.equal(timeLeft(100, 0), '');
  assert.equal(timeLeft(0, 5), '');
});
