'use strict';
// Maps: places of use in an emergency, taken from OpenStreetMap through the Overpass API.
// This file builds the questions to ask, turns the answers into small records, and searches them.
// Plain data work: no Electron, no network.

/** Split the outlines' bounding box into boxes of at most `step` degrees, as [south, west, north, east]. */
function boxesOf(rings, step = 10) {
  const out = [];
  for (const ring of rings) {
    const lons = ring.map((p) => p[0]); const lats = ring.map((p) => p[1]);
    const w = Math.min(...lons); const e = Math.max(...lons); const s = Math.min(...lats); const n = Math.max(...lats);
    const nx = Math.max(1, Math.ceil((e - w) / step)); const ny = Math.max(1, Math.ceil((n - s) / step));
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const box = [s + ((n - s) * j) / ny, w + ((e - w) * i) / nx, s + ((n - s) * (j + 1)) / ny, w + ((e - w) * (i + 1)) / nx];
      const corners = [[box[1], box[0]], [box[3], box[0]], [box[3], box[2]], [box[1], box[2]]];
      // Keep a box only if the outline reaches into it.
      if (corners.some(([x, y]) => inRing(ring, x, y)) || ring.some(([x, y]) => x >= box[1] && x <= box[3] && y >= box[0] && y <= box[2])) out.push(box.map((v) => Math.round(v * 1e4) / 1e4));
    }
  }
  return out;
}

function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inRings = (rings, lon, lat) => rings.some((r) => inRing(r, lon, lat));

/** Split a box into four. */
const quarter = ([s, w, n, e]) => { const my = (s + n) / 2; const mx = (w + e) / 2; return [[s, w, my, mx], [s, mx, my, e], [my, w, n, mx], [my, mx, n, e]]; };

/** One Overpass question: everything in a box that belongs to any of the categories. */
function queryFor(categories, box, { timeout = 300 } = {}) {
  const b = box.join(',');
  const seen = new Set();
  const lines = [];
  for (const c of categories) for (const [k, v] of c.filters) { const key = `${k}=${v}`; if (!seen.has(key)) { seen.add(key); lines.push(`  nwr["${k}"="${v}"](${b});`); } }
  return `[out:json][timeout:${timeout}];\n(\n${lines.join('\n')}\n);\nout center tags qt;`;
}

/** The category an element belongs to: the first whose filter its tags meet. */
function categoryOf(categories, tags) {
  for (const c of categories) for (const [k, v] of c.filters) if (tags[k] === v) return c.id;
  return null;
}

const clean = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, 200) : '');

/** An Overpass element as the small record that is kept, or null when it has no position or is not wanted. */
function recordOf(categories, el) {
  const t = el.tags || {};
  const lat = el.lat ?? (el.center && el.center.lat);
  const lon = el.lon ?? (el.center && el.center.lon);
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  const cat = categoryOf(categories, t);
  if (!cat) return null;
  const name = clean(t.name || t['name:en'] || t.official_name || t.brand || t.operator || '');
  if (cat === 'military' && !name) return null; // a nameless patch of fenced land tells nobody anything
  if (cat === 'town' && !name) return null;
  const street = clean([t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '));
  const town = clean([t['addr:city'], t['addr:state'], t['addr:postcode']].filter(Boolean).join(', ').replace(/, (\d{5})/, ' $1'));
  const r = { c: cat, i: `${el.type[0]}${el.id}`, a: Math.round(lat * 1e5) / 1e5, o: Math.round(lon * 1e5) / 1e5, n: name };
  const addr = [street, town].filter(Boolean).join(', ');
  if (addr) r.d = addr;
  const phone = clean(t.phone || t['contact:phone'] || '');
  if (phone) r.p = phone;
  if (t.opening_hours) r.h = clean(t.opening_hours);
  if (t.operator && clean(t.operator) !== name) r.w = clean(t.operator);
  const x = {};
  if (cat === 'hospital') { if (t.emergency) x.emergency = t.emergency; if (t.beds) x.beds = clean(t.beds); if (t['healthcare:speciality']) x.speciality = clean(t['healthcare:speciality']); }
  if (cat === 'power_plant') { if (t['plant:source']) x.source = clean(t['plant:source']); if (t['plant:output:electricity']) x.output = clean(t['plant:output:electricity']); }
  if (cat === 'fuel') { for (const k of ['fuel:diesel', 'fuel:lpg', 'fuel:e85']) if (t[k] === 'yes') x[k.slice(5)] = 'yes'; }
  if (cat === 'town') { x.kind = t.place; if (t.population) x.population = clean(t.population); }
  if (cat === 'spring' || cat === 'drinking_water') { if (t.drinking_water) x.drinkable = t.drinking_water; if (t.seasonal) x.seasonal = t.seasonal; }
  if (cat === 'airfield') { if (t.iata) x.iata = t.iata; if (t.icao) x.icao = t.icao; if (t.aerodrome || t['aerodrome:type']) x.kind = clean(t.aerodrome || t['aerodrome:type']); }
  if (t.access && t.access !== 'yes') x.access = clean(t.access);
  if (Object.keys(x).length) r.x = x;
  return r;
}

const R = 6371.0088;
const rad = (d) => (d * Math.PI) / 180;
/** Distance in kilometres between two points. */
function km(lat1, lon1, lat2, lon2) {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Search records. `q` is words that must all appear in the name, address or operator; `near` is
 * [lon, lat] to measure from; `box` is [west, south, east, north]. With `near`, nearest first;
 * without, names that start with the words first, larger towns before smaller.
 */
function search(records, { q = '', near = null, box = null, limit = 50 } = {}) {
  const words = fold(q).split(/[^a-z0-9]+/).filter(Boolean);
  const out = [];
  for (const r of records) {
    if (box && (r.o < box[0] || r.o > box[2] || r.a < box[1] || r.a > box[3])) continue;
    let score = 0;
    if (words.length) {
      const name = fold(r.n || '');
      const hay = `${name} ${fold(r.d || '')} ${fold(r.w || '')}`;
      if (!words.every((w) => hay.includes(w))) continue;
      score = name === words.join(' ') ? 3 : name.startsWith(words[0]) ? 2 : words.every((w) => name.includes(w)) ? 1 : 0;
    }
    const pop = r.x && r.x.population ? Number(String(r.x.population).replace(/\D/g, '')) || 0 : 0;
    out.push({ r, score, pop, km: near ? km(near[1], near[0], r.a, r.o) : null });
  }
  out.sort(near ? (a, b) => a.km - b.km : (a, b) => b.score - a.score || b.pop - a.pop || (a.r.n || '').localeCompare(b.r.n || ''));
  return { total: out.length, hits: out.slice(0, limit).map((h) => ({ ...h.r, km: h.km == null ? null : Math.round(h.km * 10) / 10 })) };
}

const nameKey = (s) => fold(s || '').replace(/[^a-z0-9]+/g, ' ').trim();
/** Two names for what is likely one place: the same, one inside the other, or sharing a first word of some length. A missing name matches anything. */
function sameName(a, b) {
  if (!a || !b) return true;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const first = a.split(' ')[0];
  return first.length >= 4 && first === b.split(' ')[0];
}

/**
 * The records of `extra` that are not already in `base`: no record of a like name within `reach`
 * kilometres. Used to add places from a second source without listing a place twice.
 */
function fresh(base, extra, reach = 0.15) {
  const cell = 0.003; // about 300 m of latitude: neighbours within reach are in the same cell or the next
  const grid = new Map();
  const put = (r, name) => { const k = `${Math.floor(r.o / cell)},${Math.floor(r.a / cell)}`; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push([r, name]); };
  for (const r of base) put(r, nameKey(r.n));
  const out = [];
  for (const r of extra) {
    const name = nameKey(r.n); const cx = Math.floor(r.o / cell); const cy = Math.floor(r.a / cell);
    let dup = false;
    for (let dx = -1; dx <= 1 && !dup; dx++) for (let dy = -1; dy <= 1 && !dup; dy++) for (const [o, on] of grid.get(`${cx + dx},${cy + dy}`) || []) if (km(r.a, r.o, o.a, o.o) <= reach && sameName(name, on)) { dup = true; break; }
    if (!dup) { out.push(r); put(r, name); }
  }
  return out;
}

module.exports = { boxesOf, quarter, queryFor, categoryOf, recordOf, inRings, km, search, fresh, sameName };
