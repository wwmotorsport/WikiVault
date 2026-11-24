'use strict';
const test = require('node:test');
const assert = require('node:assert');

test('a turn is spoken of sooner the faster the car is going, up to a mile at 60 miles an hour', () => {
  const G = require('../src/renderer/guide');
  const mph = (n) => n * 0.44704;
  assert.deepStrictEqual(G.notice(0), { far: 400, mid: 0, near: 60 });
  assert.deepStrictEqual(G.notice(mph(10)), { far: 400, mid: 0, near: 60 });
  const town = G.notice(mph(30));
  assert.ok(Math.abs(town.far - 804.7) < 1 && town.mid > 200 && town.mid < 300 && Math.abs(town.near - 67) < 1, JSON.stringify(town));
  const road = G.notice(mph(60));
  assert.ok(Math.abs(road.far - 1609.3) < 1 && Math.abs(road.mid - 402.3) < 1 && Math.abs(road.near - 134.1) < 1, JSON.stringify(road));
  assert.strictEqual(G.notice(mph(85)).far, 1609.344); // no more than a mile, however fast
});

test('what is said about the next turn: at once when it is far off, then in time for the speed, a reminder, and at the turn', () => {
  const G = require('../src/renderer/guide');
  const mph = (n) => n * 0.44704; const mi = (n) => n * 1609.344;
  const heard = {};
  const next = (meters) => ({ index: 3, text: 'Turn left onto Elm Street', meters });
  // Just after the turn before: the next is 3.2 miles off, and the driver is told so, once.
  assert.strictEqual(G.announce(next(mi(3.2)), mph(60), heard), 'Continue for 3.2 miles, then turn left onto Elm Street.');
  assert.strictEqual(G.announce(next(mi(3.1)), mph(60), heard), null);
  assert.strictEqual(G.announce(next(mi(1.2)), mph(60), heard), null);
  // At 60 miles an hour: a mile ahead, a quarter of a mile ahead, and at the turn.
  assert.strictEqual(G.announce(next(mi(0.99)), mph(60), heard), 'In 1 mile, turn left onto Elm Street.');
  assert.strictEqual(G.announce(next(mi(0.6)), mph(60), heard), null);
  assert.strictEqual(G.announce(next(mi(0.24)), mph(60), heard), 'In 0.2 miles, turn left onto Elm Street.');
  assert.strictEqual(G.announce(next(120), mph(55), heard), 'Turn left onto Elm Street.');
  assert.strictEqual(G.announce(next(40), mph(20), heard), null);
  // In town a turn half a mile off is not spoken of until a quarter of a mile, and nothing is said "ahead" under a mile.
  const town = {};
  assert.strictEqual(G.announce({ index: 4, text: 'Turn right', meters: mi(0.5) }, mph(15), town), null);
  assert.strictEqual(G.announce({ index: 4, text: 'Turn right', meters: 380 }, mph(15), town), 'In 0.2 miles, turn right.');
  assert.strictEqual(G.announce({ index: 4, text: 'Turn right', meters: 200 }, mph(15), town), null); // no reminder when the first word came late
  assert.strictEqual(G.announce({ index: 4, text: 'Turn right', meters: 55 }, mph(15), town), 'Turn right.');
  // A turn that is already close when it becomes the next one is said once, as the turn.
  assert.strictEqual(G.announce({ index: 5, text: 'Turn left', meters: 45 }, mph(15), town), 'Turn left.');
  assert.strictEqual(G.announce(null, mph(15), town), null);
});

test('the map is zoomed so that the next turn is in view: in close for a near turn, out for a far one, less close at speed', () => {
  const G = require('../src/renderer/guide');
  const near = G.zoomFor(150, 35, 500, 5);
  const mid = G.zoomFor(1609, 35, 500, 15);
  const far = G.zoomFor(16093, 35, 500, 30);
  assert.ok(near > mid && mid > far, JSON.stringify([near, mid, far]));
  assert.ok(near <= 17 && near >= 16, String(near));
  assert.ok(mid > 13 && mid < 15.5, String(mid));
  assert.ok(far >= 9.5 && far < 12, String(far));
  assert.strictEqual(G.zoomFor(1e7, 35, 500, 30), 9.5);           // never out past the whole region
  assert.ok(G.zoomFor(50, 35, 500, 30) <= 15.9);                  // nor right in while moving fast
  assert.ok(G.zoomFor(1609, 35, 800, 15) > mid);                  // more map ahead: the same turn fits closer in
});
