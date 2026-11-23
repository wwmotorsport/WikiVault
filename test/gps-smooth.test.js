'use strict';
// The mark on the map glides from one GPS reading to the next instead of hopping, and the map turns the short
// way round. A reading far away, or after a silence, is jumped to.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Glide, turn, metres } = require('../src/renderer/gps-smooth');

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('the mark sets off from where it is showing and arrives when the next reading is due', () => {
  const g = new Glide();
  assert.equal(g.at(0), null, 'nothing to show before the first reading');
  g.to({ lat: 40, lon: -74, course: 90, speed: 13 }, 1000);
  assert.deepEqual(g.at(1000), { lat: 40, lon: -74, bearing: 90, moving: false }, 'the first reading is shown at once');
  // A second later the receiver is 13 m east. The mark glides there over that second.
  g.to({ lat: 40, lon: -73.99985, course: 90, speed: 13 }, 2000);
  const start = g.at(2000); const half = g.at(2500); const end = g.at(3000);
  assert.ok(near(start.lon, -74) && start.moving);
  assert.ok(near(half.lon, -73.999925) && half.moving, 'half way at half time');
  assert.ok(near(end.lon, -73.99985) && !end.moving && near(g.at(9000).lon, -73.99985), 'there, and it stays there');
  // A reading that comes while it is still on its way starts from where the mark is showing, not from the old goal.
  g.to({ lat: 40, lon: -73.9997, course: 90, speed: 13 }, 3000);
  g.to({ lat: 40, lon: -73.9995, course: 90, speed: 13 }, 3400);
  assert.ok(near(g.at(3400).lon, -73.99985 + (-73.9997 + 73.99985) * 0.4), 'no hop back or forward when readings come early');
  // The glide lasts as long as the readings were apart, within limits: never a twitch, never a crawl.
  assert.equal(g.ms, 400);
  g.to({ lat: 40, lon: -73.9994, course: 90, speed: 13 }, 3450); assert.equal(g.ms, 250);
  g.to({ lat: 40, lon: -73.9993, course: 90, speed: 13 }, 8000); assert.equal(g.ms, 1600);
});

test('a reading far away or after a silence is jumped to', () => {
  const g = new Glide();
  g.to({ lat: 40, lon: -74, course: 0, speed: 10 }, 0);
  g.to({ lat: 40.01, lon: -74, course: 0, speed: 10 }, 1000); // more than a kilometre in a second
  assert.deepEqual([g.at(1000).lat, g.at(1000).moving], [40.01, false]);
  g.to({ lat: 40.0101, lon: -74, course: 0, speed: 10 }, 9000); // eight seconds of nothing
  assert.deepEqual([g.at(9000).lat, g.at(9000).moving], [40.0101, false]);
  g.reset(); assert.equal(g.at(9000), null);
});

test('the heading turns the short way round, and is left alone while standing still', () => {
  assert.deepEqual([turn(350, 10), turn(10, 350), turn(0, 180), turn(90, 270), turn(100, 100)], [20, -20, 180, 180, 0]);
  const g = new Glide();
  g.to({ lat: 40, lon: -74, course: 350, speed: 10 }, 0);
  g.to({ lat: 40.0001, lon: -74, course: 10, speed: 10 }, 1000);
  assert.ok(near(g.at(1500).bearing, 0, 1e-6), 'through north, not the long way through south');
  assert.ok(near(g.at(2000).bearing, 10, 1e-6));
  // Stopped at a light: the receiver reports any course it likes. The map does not spin.
  g.to({ lat: 40.0001, lon: -74, course: 213, speed: 0.2 }, 3000);
  g.to({ lat: 40.0001, lon: -74, course: 71, speed: 0 }, 4000);
  assert.ok(near(g.at(4500).bearing, 10, 1e-6));
  // A receiver that has never moved has no heading to give.
  const still = new Glide(); still.to({ lat: 1, lon: 1, course: 44, speed: 0 }, 0);
  assert.equal(still.at(10).bearing, null);
  still.to({ lat: 1.00001, lon: 1, course: null, speed: null }, 1000);
  assert.equal(still.at(1500).bearing, null);
  assert.ok(metres({ lat: 40, lon: -74 }, { lat: 40.001, lon: -74 }) > 110 && metres({ lat: 40, lon: -74 }, { lat: 40.001, lon: -74 }) < 112);
});
