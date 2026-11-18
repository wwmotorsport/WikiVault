'use strict';
// Directions: what to ask the routing engine (BRouter), and what to make of its answer.
// Plain data work: no Electron, no network, no engine.

const { km } = require('./places');

/** How to travel. `profile` is one of BRouter's own; `params` are options of that profile. */
const MODES = [
  { id: 'car', name: 'Car', profile: 'car-vario', params: {}, what: 'Roads open to cars, fastest first.' },
  { id: 'car-rough', name: 'Car, farm and forest tracks allowed', profile: 'car-vario', params: { use_offroad: 1 }, what: 'As Car, but unpaved tracks may be used when they help. For a vehicle that can take them.' },
  { id: 'bike', name: 'Bicycle', profile: 'trekking', params: {}, what: 'Quiet roads and cycle ways.' },
  { id: 'mtb', name: 'Bicycle, off road', profile: 'mtb', params: {}, what: 'Tracks and paths are used freely.' },
  { id: 'foot', name: 'On foot', profile: 'hiking-mountain', params: {}, what: 'Paths, tracks and roads that can be walked. No motorways.' },
];

/** The 5-degree routing data files that cover a set of outlines, e.g. "W85_N35.rd5". */
function segmentsFor(rings) {
  const names = new Set();
  const inRing = (ring, x, y) => { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i]; const [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside; } return inside; };
  for (const ring of rings) {
    const lons = ring.map((p) => p[0]); const lats = ring.map((p) => p[1]);
    for (let w = Math.floor(Math.min(...lons) / 5) * 5; w < Math.max(...lons); w += 5) for (let s = Math.floor(Math.min(...lats) / 5) * 5; s < Math.max(...lats); s += 5) {
      // Kept when the outline reaches into the square: a corner or the middle inside, or a point of the outline in it.
      const probes = [[w, s], [w + 5, s], [w + 5, s + 5], [w, s + 5], [w + 2.5, s + 2.5], [w + 2.5, s], [w, s + 2.5], [w + 5, s + 2.5], [w + 2.5, s + 5]];
      if (probes.some(([x, y]) => inRing(ring, x, y)) || ring.some(([x, y]) => x >= w && x <= w + 5 && y >= s && y <= s + 5)) names.add(`${w < 0 ? 'W' : 'E'}${Math.abs(w)}_${s < 0 ? 'S' : 'N'}${Math.abs(s)}.rd5`);
    }
  }
  return [...names].sort();
}

const num = (v) => String(Math.round(v * 1e6) / 1e6);

/**
 * The address to ask a BRouter server for a route.
 * @param {string} origin  e.g. http://127.0.0.1:17777
 * @param {object} o
 * @param {number[][]} o.points   [lon, lat] of the start, any stops between, and the end
 * @param {string} o.mode         id of one of MODES
 * @param {number} [o.alt]        0 for the best route, 1 to 3 for others
 * @param {object[]} [o.blocks]   places not to go: { lon, lat, radius } in metres, or { polygon: [[lon, lat], ...] }
 * @param {boolean} [o.noMotorways]
 */
function routeUrl(origin, { points, mode, alt = 0, blocks = [], noMotorways = false }) {
  const m = MODES.find((x) => x.id === mode);
  if (!m) throw new Error('Choose how you are travelling.');
  if (!Array.isArray(points) || points.length < 2) throw new Error('A route needs a start and an end.');
  const q = [`lonlats=${points.map(([lon, lat]) => `${num(lon)},${num(lat)}`).join('|')}`, `profile=${m.profile}`, `alternativeidx=${Math.max(0, Math.min(3, alt | 0))}`, 'format=geojson', 'timode=2'];
  const circles = blocks.filter((b) => !b.polygon);
  const polys = blocks.filter((b) => b.polygon && b.polygon.length >= 3);
  if (circles.length) q.push(`nogos=${circles.map((b) => `${num(b.lon)},${num(b.lat)},${Math.max(10, Math.round(b.radius))}`).join('|')}`);
  if (polys.length) q.push(`polygons=${polys.map((b) => b.polygon.map(([lon, lat]) => `${num(lon)},${num(lat)}`).join(',')).join('|')}`);
  const params = { ...m.params, ...(noMotorways && m.profile === 'car-vario' ? { avoid_motorways: 1 } : {}) };
  for (const [k, v] of Object.entries(params)) q.push(`profile:${k}=${v}`);
  return `${origin}/brouter?${q.join('&')}`;
}

/** What the engine's refusals mean, in words. */
function explain(text, where = '') {
  const t = String(text || '').trim();
  let m;
  if ((m = /datafile (\S+\.rd5) not found/.exec(t))) return `The routing data does not cover that far (${m[1]} is not on this computer). Add the region under Change or update.`;
  if (/from-position not mapped/.test(t)) return 'There is no road near the start. Move it closer to a road.';
  if (/to-position not mapped|-position not mapped/.test(t)) return 'There is no road near the destination. Move it closer to a road.';
  if (/wpt in restricted area/i.test(t)) return 'The areas you marked as blocked leave no way to the destination for this way of travelling, or the destination is inside one. Remove or shrink a block, or choose a way of travelling that may use tracks.';
  if (/no track found|target island|island detected|not found|no route/i.test(t)) return `No way through was found${where}. If you marked areas as blocked, they may cut every road; otherwise the two places may not be joined by roads this way of travelling may use.`;
  if (/timeout|maxRunningTime/i.test(t)) return 'The route took too long to work out. Try a shorter trip, or one stage at a time.';
  return t ? `The routing engine could not make a route: ${t.slice(0, 200)}` : 'The routing engine could not make a route.';
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
function heading(a, b) {
  const rad = Math.PI / 180;
  const y = Math.sin((b[0] - a[0]) * rad) * Math.cos(b[1] * rad);
  const x = Math.cos(a[1] * rad) * Math.sin(b[1] * rad) - Math.sin(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos((b[0] - a[0]) * rad);
  return COMPASS[Math.round((((Math.atan2(y, x) / rad) + 360) % 360) / 45) % 8];
}

const TURNS = { 2: 'Turn left', 3: 'Turn slightly left', 4: 'Turn sharply left', 5: 'Turn right', 6: 'Turn slightly right', 7: 'Turn sharply right', 8: 'Keep left', 9: 'Keep right', 10: 'Make a U-turn', 11: 'Make a U-turn', 15: 'Make a U-turn', 17: 'Take the exit on the left', 18: 'Take the exit on the right' };
const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];

/**
 * The engine's answer as a route: its line, length, time, and steps to follow.
 * `nameAt(lon, lat)` gives the name of the road at a point, or '' (the engine's data has no names;
 * they come from the map). Each step has the text, the point it happens at, and how far it is to the next.
 */
function parseRoute(geojson, nameAt = () => '') {
  const f = geojson && geojson.features && geojson.features[0];
  if (!f || !f.geometry || !Array.isArray(f.geometry.coordinates) || f.geometry.coordinates.length < 2) throw new Error('The routing engine sent something that is not a route.');
  const coords = f.geometry.coordinates.map((c) => [c[0], c[1]]);
  const p = f.properties || {};
  const along = [0];
  for (let i = 1; i < coords.length; i++) along.push(along[i - 1] + km(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]) * 1000);
  const total = along[along.length - 1];
  // The road a step leads onto is named from a point a little way past the turn.
  const after = (i) => { const want = along[i] + 40; let j = i; while (j + 1 < coords.length && along[j + 1] < want) j += 1; if (j + 1 >= coords.length) return coords[coords.length - 1]; const t = (want - along[j]) / Math.max(1e-9, along[j + 1] - along[j]); return [coords[j][0] + (coords[j + 1][0] - coords[j][0]) * t, coords[j][1] + (coords[j + 1][1] - coords[j][1]) * t]; };
  const name = (i) => { try { return String(nameAt(...after(i)) || ''); } catch { return ''; } };
  const hints = (Array.isArray(p.voicehints) ? p.voicehints : []).filter((h) => Array.isArray(h) && h[0] > 0 && h[0] < coords.length - 1).sort((a, b) => a[0] - b[0]);
  const steps = [];
  const first = name(0);
  steps.push({ at: coords[0], index: 0, text: `Start out heading ${heading(coords[0], coords[1])}${first ? ` on ${first}` : ''}` });
  let last = first;
  for (const [index, cmd, exit] of hints) {
    const road = name(index);
    let text;
    if (cmd === 13 || cmd === 14) text = `At the roundabout, take the ${ORDINALS[exit] || `${exit}th`} exit${road ? ` onto ${road}` : ''}`;
    else if (cmd === 16) text = 'Go straight on towards the next point; no road is mapped here';
    else if (cmd === 1) { if (!road || road === last) { continue; } text = `Continue onto ${road}`; } else text = `${TURNS[cmd] || 'Continue'}${road ? ` onto ${road}` : ''}`;
    steps.push({ at: coords[index], index, text });
    if (road) last = road;
  }
  steps.push({ at: coords[coords.length - 1], index: coords.length - 1, text: 'Arrive at the destination' });
  for (let i = 0; i < steps.length; i++) steps[i].meters = i + 1 < steps.length ? Math.round(along[steps[i + 1].index] - along[steps[i].index]) : 0;
  return { meters: Math.round(Number(p['track-length']) || total), seconds: Math.round(Number(p['total-time']) || 0), coords, steps: steps.map(({ index, ...s }) => s) };
}

module.exports = { MODES, segmentsFor, routeUrl, explain, parseRoute, heading };
