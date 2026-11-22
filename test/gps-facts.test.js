'use strict';
// The GPS panel on the map: the rows it shows for a receiver with and without a position, standing and moving,
// and on a trip.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../src/renderer/gps-facts');

const clock = (ms) => new Date(ms).toISOString().slice(11, 19);
const show = (rows) => rows.map((r) => (r.sep ? '--' : `${r.name}: ${r.value}${r.big ? ' [big]' : ''}`));

test('headings and speeds are put in plain words', () => {
  assert.deepEqual([0, 44, 48, 90, 181, 270, 337, 338, 359.6, -45].map(F.heading), ['North (0°)', 'North-east (44°)', 'North-east (48°)', 'East (90°)', 'South (181°)', 'West (270°)', 'North-west (337°)', 'North (338°)', 'North (360°)', 'North-west (315°)']);
  assert.deepEqual([null, 0, 0.5, 0.9, 13.4, 31.3].map(F.mph), [null, 0, 0, 2, 30, 70]);
  assert.deepEqual(Object.keys(F.LABELS).sort(), ['fix', 'lost', 'off', 'searching', 'waiting']);
});

test('a receiver with no position yet shows what it has; one with a position shows where, how fast and how sure', () => {
  const info = { speed: 4800, usbVendorId: 0x067b };
  assert.deepEqual(show(F.facts({ fix: null, info, clock })), ['Receiver: USB (Prolific), 4800 baud']);
  assert.deepEqual(show(F.facts({ fix: { has: false, sats: 5, time: null }, info, clock })), ['Satellites: 5 in view so far', 'Receiver: USB (Prolific), 4800 baud']);
  // Standing still: no heading, which would be noise.
  const still = { has: true, lat: 40.7128, lon: -74.006, speed: 0.2, course: 211, sats: 34, accuracy: 4, alt: 10, time: Date.UTC(2026, 10, 22, 22, 16, 4) };
  assert.deepEqual(show(F.facts({ fix: still, info, clock })), ['Speed: 0 mph [big]', 'Position: 40.71280, -74.00600', 'Good to about: 13 feet', 'Height: 33 feet above sea level', 'Satellites: 34 in use', 'Satellite time: 22:16:04', 'Receiver: USB (Prolific), 4800 baud']);
  // Moving: the heading joins in.
  assert.deepEqual(show(F.facts({ fix: { ...still, speed: 16.5, course: 48 }, info: { speed: 9600 }, clock })).slice(0, 2), ['Speed: 37 mph [big]', 'Heading: North-east (48°)']);
  assert.equal(show(F.facts({ fix: { ...still, speed: 16.5, course: 48 }, info: { speed: 9600 }, clock })).pop(), 'Receiver: Serial port, 9600 baud');
});

test('on a trip the next turn, the distance left and the time of arrival come first', () => {
  const fix = { has: true, lat: 40.7128, lon: -74.006, speed: 13.4, course: 90, sats: 12, accuracy: 5, alt: null, time: null };
  const route = { meters: 20000, seconds: 1800 };
  const now = Date.UTC(2026, 10, 22, 12, 0, 0);
  const rows = show(F.facts({ fix, route, now, clock, progress: { remaining: 10000, next: { meters: 480, text: 'Turn right onto Main Street' } }, said: (m) => `${Math.round(m)} m` }));
  assert.deepEqual(rows.slice(0, 5), ['Next turn: In 480 m: Turn right onto Main Street', 'To go: 6.2 miles', 'Arriving about: 12:15:00', '--', 'Speed: 30 mph [big]']);
  assert.deepEqual(show(F.facts({ fix, route, now, clock, progress: { remaining: 300, next: null } })).slice(0, 2), ['Next turn: Continue to the end of the route', 'To go: 0.2 miles']);
  assert.deepEqual(show(F.facts({ fix, route, now, clock, progress: { remaining: 0, arrived: true } })).slice(0, 2), ['Trip: You have arrived', '--']);
  assert.deepEqual(show(F.facts({ fix, route, now, clock, progress: { remaining: 9000, off: true } }))[0], 'Trip: Off the route: a new one is being worked out');
  // No position, no trip rows: there is nothing to measure them from.
  assert.deepEqual(show(F.facts({ fix: { has: false, sats: 3 }, route, now, clock, progress: { remaining: 10000, next: null } })), ['Satellites: 3 in view so far']);
});
