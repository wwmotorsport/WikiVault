'use strict';
// GPS: reading what a receiver sends, and following a route with it.
const test = require('node:test');
const assert = require('node:assert/strict');
const nmea = require('../src/renderer/nmea');
const { Guide, said } = require('../src/renderer/guide');

const sum = (body) => { let s = 0; for (const ch of body) s ^= ch.charCodeAt(0); return `$${body}*${s.toString(16).toUpperCase().padStart(2, '0')}`; };
const dm = (deg, width) => { const a = Math.abs(deg); const d = Math.floor(a); return `${String(d).padStart(width, '0')}${((a - d) * 60).toFixed(4).padStart(7, '0')}`; };
const rmc = (lat, lon, knots = 20, course = 90, ok = 'A') => sum(`GPRMC,123519,${ok},${dm(lat, 2)},${lat < 0 ? 'S' : 'N'},${dm(lon, 3)},${lon < 0 ? 'W' : 'E'},${knots},${course},181126,,,A`);
const gga = (lat, lon, q = 1, sats = 9, hdop = 0.9) => sum(`GPGGA,123519,${dm(lat, 2)},N,${dm(lon, 3)},W,${q},${String(sats).padStart(2, '0')},${hdop},210.0,M,-33.0,M,,`);

test('sentences are checked and read', () => {
  const line = rmc(35.2271, -80.8431);
  assert.ok(nmea.valid(line));
  assert.ok(!nmea.valid(line.replace('A*', 'V*')) && !nmea.valid('$GPRMC,1') && !nmea.valid('noise'));
  const r = nmea.parse(line);
  assert.equal(r.type, 'RMC');
  assert.ok(Math.abs(r.lat - 35.2271) < 1e-5 && Math.abs(r.lon + 80.8431) < 1e-5 && r.ok);
  assert.ok(Math.abs(r.speed - 10.29) < 0.01 && r.course === 90);
  assert.equal(new Date(r.time).toISOString(), '2026-11-18T12:35:19.000Z');
  const g = nmea.parse(gga(35.2271, -80.8431));
  assert.deepEqual([g.type, g.quality, g.sats, g.hdop, g.alt], ['GGA', 1, 9, 0.9, 210]);
  assert.equal(nmea.parse(sum('GNRMC,123519,A,3513.6260,S,08050.5860,E,0,,181126,,,A')).lat < 0, true, 'other satellite systems and hemispheres');
  assert.deepEqual(nmea.parse(sum('GPGSV,3,1,11,03,03,111,00')), { type: 'GSV' });
});

test('text arriving in pieces becomes positions; no fix and noise are told apart', () => {
  const fixes = [];
  const r = new nmea.Reader((f) => fixes.push(f));
  const text = `${gga(35.2, -80.9)}\r\n${rmc(35.2, -80.9, 20, 45)}\r\n\x00\xff garbage\r\n${rmc(35.2, -80.9, 0, 300)}\r\n${rmc(35.2, -80.9, 5, 90, 'V')}\r\n`;
  for (let i = 0; i < text.length; i += 7) r.push(text.slice(i, i + 7));
  assert.equal(fixes.length, 3);
  assert.deepEqual([fixes[0].has, fixes[0].sats, fixes[0].accuracy, fixes[0].course], [true, 9, 5, 45]);
  assert.ok(Math.abs(fixes[0].lat - 35.2) < 1e-5 && Math.abs(fixes[0].lon + 80.9) < 1e-5);
  assert.equal(fixes[1].course, 45, 'standing still keeps the last heading');
  assert.equal(fixes[2].has, false, 'the receiver says it has no fix');
  assert.deepEqual([r.sentences, r.bad], [4, 1]);
  const quiet = new nmea.Reader();
  quiet.push('x'.repeat(20000));
  assert.ok(quiet.buf.length <= 8192 && quiet.sentences === 0);
});

test('a journey is followed: the next turn, the distance left, leaving the route and arriving', () => {
  // East along 35.20 for about 4.5 km, then north for about 2.2 km.
  const coords = []; for (let i = 0; i <= 50; i++) coords.push([-80.9 + i * 0.001, 35.2]); for (let i = 1; i <= 20; i++) coords.push([-80.85, 35.2 + i * 0.001]);
  const route = { coords, steps: [{ at: coords[0], text: 'Head east on South Road' }, { at: coords[50].slice(), text: 'Turn left onto Center Street' }, { at: coords[70].slice(), text: 'You have arrived' }] };
  const g = new Guide(route);
  assert.ok(Math.abs(g.total - 6787) < 40, String(g.total));
  let u = g.update([-80.89, 35.20005], 5);
  assert.deepEqual([u.step, u.next.index, u.next.text, u.off, u.arrived], [0, 1, 'Turn left onto Center Street', false, false]);
  assert.ok(Math.abs(u.next.meters - 3634) < 30 && u.dist < 8, `${u.next.meters} ${u.dist}`);
  u = g.update([-80.85, 35.205], 5);
  assert.deepEqual([u.step, u.next.text], [1, 'You have arrived']);
  // Three positions well off the road in a row mean the route has been left; one alone does not.
  assert.equal(g.update([-80.84, 35.205], 5).off, false);
  assert.equal(g.update([-80.85, 35.206], 5).off, false, 'back on it: the count starts again');
  g.update([-80.84, 35.207], 5); g.update([-80.84, 35.208], 5);
  assert.equal(g.update([-80.84, 35.209], 5).off, true);
  // A poor signal allows a wider margin.
  const loose = new Guide(route);
  for (let i = 0; i < 4; i++) assert.equal(loose.update([-80.89, 35.2008], 60).off, false);
  // A journey that begins away from the road is not off the route while it is no further away than it began.
  const park = new Guide(route);
  for (let i = 0; i < 4; i++) assert.equal(park.update([-80.89, 35.2012], 5, 170).off, false);
  for (let i = 0; i < 2; i++) park.update([-80.89, 35.2012], 5);
  assert.equal(park.update([-80.89, 35.2012], 5).off, true);
  u = g.update([-80.85, 35.2199], 5);
  assert.deepEqual([u.arrived, u.off, u.next], [true, false, null]);
  assert.deepEqual([said(60), said(250), said(700), said(1609), said(4000), said(40000)], ['200 feet', '800 feet', '0.4 miles', '1 mile', '2.5 miles', '25 miles']);
});
