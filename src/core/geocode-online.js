'use strict';
// Looking up addresses on the internet, for the ones the downloaded address data cannot place.
//
// The service is the United States Census Bureau's geocoder: free, no key, and it takes a whole list in one
// request. Only street addresses are sent, as the body of a POST (never in a web address): no names, no
// telephone numbers, nothing else from the address book. It knows the United States and Puerto Rico only, and
// it places a number along its street from the range of numbers on that block, so a result is the right
// stretch of road rather than the roof of the house. The app says so wherever it shows one.
const { normState, fold } = require('./addresses');

const URL_BATCH = 'https://geocoding.geo.census.gov/geocoder/locations/addressbatch';
const BENCHMARK = 'Public_AR_Current';
const MAX = 1000; // to a request; the service takes 10,000, and smaller lists come back sooner

const UNIT_TAIL = /\s+(?:APT|APARTMENT|UNIT|STE|SUITE|LOT|TRLR|BLDG|BUILDING|FLOOR|FL|RM|ROOM|#)\s*#?\s*[A-Z0-9-]*$/;
const UNIT_ONLY = /^(?:APT|APARTMENT|UNIT|STE|SUITE|LOT|TRLR|BLDG|BUILDING|FLOOR|FL|RM|ROOM|DEPT|PMB|NO)\b\s*#?\s*[A-Z0-9-]*$|^#\s*[A-Z0-9-]+$/;
const NUMBERED = /^\d+[A-Z]?(?:-(?:\d+[A-Z]?|[A-Z]))?\s+\S/;
/** A state's two letters, from its letters or its name; '' for anything else. */
const stateOf = (s) => { const v = normState(s); return CODES.has(v) ? v : ''; };
const CODES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AS MP'.split(' '));
const KINDS = new Set('ST STREET AVE AVENUE RD ROAD DR DRIVE LN LANE CT COURT PL PLACE WAY BLVD BOULEVARD TRL TRAIL CIR CIRCLE PKWY PARKWAY TER TERRACE HWY HIGHWAY LOOP RUN PATH PIKE ROW SQ SQUARE XING CROSSING CV COVE PT POINT RDG RIDGE'.split(' '));
const SIDES = new Set('N S E W NE NW SE SW NORTH SOUTH EAST WEST'.split(' '));

/**
 * What the service needs of an address: { street, city, state, zip }, or null when the address has no house
 * number and street, or neither a ZIP code nor a town with its state (the service places nothing else).
 */
function rowOf(text) {
  const segs = fold(String(text || '')).replace(/[.'’`]/g, '').split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  const at = segs.findIndex((s) => NUMBERED.test(s));
  if (at < 0 || /^(?:P ?O ?)?BOX\b/.test(segs[at])) return null;
  let street = segs[at].replace(UNIT_TAIL, '').trim();
  let city = ''; let state = ''; let zip = '';
  // After the street: the town, the state and the ZIP code. People write them in every order and sometimes twice, and a
  // town can be called what a state is called (New York, Washington, Indiana), so the state is the last thing that reads as one.
  const tail = [];
  for (const seg of segs.slice(at + 1)) {
    if (UNIT_ONLY.test(seg)) continue;
    for (const w of seg.split(/\s+/).filter(Boolean)) {
      if (/^\d{5}(?:-?\d{4})?$/.test(w)) { if (!zip) zip = w.slice(0, 5); } else if (!/^(?:USA?|UNITED|STATES|AMERICA)$/.test(w) || w === 'UNITED') tail.push(w);
    }
  }
  while (tail.length > 1 && /^(?:UNITED|OF)$/.test(tail[tail.length - 1])) tail.pop();
  for (let i = tail.length - 1; i >= 0 && !state; i -= 1) {
    const two = i > 0 ? stateOf(`${tail[i - 1]} ${tail[i]}`) : '';
    const one = stateOf(tail[i]);
    if (two && (i > 1 || !zip)) { state = two; tail.length = i - 1; } else if (one && (i > 0 || !zip || tail[i].length === 2)) { state = one; tail.length = i; } else if (two) { break; }
  }
  // "Springfield IL 62701, Springfield, IL": the town and state written twice. The town ends where the state is first named.
  if (state) { const again = tail.findIndex((w, i) => i > 0 && stateOf(w) === state); if (again > 0) tail.length = again; }
  if (tail.length && !/^\d/.test(tail[0])) city = tail.join(' ');
  // Everything on one line ("12 Main St Springfield IL 62701"), or the town left on the street's line: cut at the kind of street.
  const t = street.split(/\s+/);
  if (!zip && /^\d{5}$/.test(t[t.length - 1]) && t.length > 3) zip = t.pop();
  if (!state && t.length > 3 && t[t.length - 1].length === 2 && stateOf(t[t.length - 1])) state = stateOf(t.pop());
  if (!city) {
    let k = -1;
    for (let i = t.length - 1; i >= 2; i -= 1) if (KINDS.has(t[i])) { k = i; break; }
    if (k > 0) { while (k + 1 < t.length - 1 && SIDES.has(t[k + 1])) k += 1; if (k < t.length - 1) { city = t.slice(k + 1).join(' '); t.length = k + 1; } }
  }
  street = t.join(' ');
  if (!zip && !(city && state)) return null;
  return { street: street.slice(0, 100), city: city.slice(0, 60), state, zip };
}

const cell = (s) => `"${String(s == null ? '' : s).replace(/"/g, "'").replace(/[\r\n]+/g, ' ')}"`;
/** The list as the service wants it: a line an address, `id, street, town, state, ZIP`, no heading. */
function csv(rows) { return rows.map((r) => [r.id, r.street, r.city, r.state, r.zip].map(cell).join(',')).join('\r\n'); }

/** One line of comma-separated values, with quoted cells that may hold commas. */
function cells(line) {
  const out = []; let cur = ''; let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i += 1; } else quoted = false; } else cur += c; } else if (c === '"') quoted = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * The service's answer, read: a Map from id to { lat, lon, exact, matched } for the addresses it placed.
 * An address it could not place, or placed in two ways it could not choose between, is left out.
 */
function readAnswer(text) {
  const found = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const c = cells(line);
    if (c.length < 6 || c[2] !== 'Match') continue;
    const [lon, lat] = c[5].split(',').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) continue;
    found.set(c[0], { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, exact: c[3] === 'Exact', matched: c[4] });
  }
  return found;
}

/** The body of the request: a form with the list as a file, built by hand so that nothing but Node is needed. */
function formBody(list, boundary) {
  const part = (name, value, file) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"${file ? `; filename="${file}"\r\nContent-Type: text/csv` : ''}\r\n\r\n${value}\r\n`;
  return Buffer.from(`${part('benchmark', BENCHMARK)}${part('addressFile', list, 'addresses.csv')}--${boundary}--\r\n`, 'utf8');
}

/**
 * Look a list of addresses up. `items` is [{ id, address }]; `post(url, body, headers, signal)` sends the request
 * and resolves to the text of the answer. Returns { found: Map(id -> { lat, lon, exact, matched }), asked,
 * skipped } where `skipped` counts the addresses that were not sent because the service could not use them.
 */
async function lookup(items, { post, url = URL_BATCH, signal = null, onProgress = () => {} } = {}) {
  const rows = [];
  for (const it of items) { const r = rowOf(it.address); if (r) rows.push({ id: String(it.id), ...r }); }
  const found = new Map();
  for (let i = 0; i < rows.length; i += MAX) {
    const boundary = `----wikivault${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    const text = await post(url, formBody(csv(rows.slice(i, i + MAX)), boundary), { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, signal);
    for (const [id, hit] of readAnswer(text)) found.set(id, hit);
    onProgress({ done: Math.min(rows.length, i + MAX), total: rows.length });
  }
  return { found, asked: rows.length, skipped: items.length - rows.length };
}

module.exports = { rowOf, csv, readAnswer, formBody, lookup, URL_BATCH, BENCHMARK };
