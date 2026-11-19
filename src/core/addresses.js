'use strict';
// Addresses: a compact index of known address points, and the search over it.
//
// The points come from Overture Maps (see overture.js). They are kept by street: every street name is
// reduced to a core ("N Main St" and "Main Street" both to MAIN), the cores are spread over a fixed
// number of shards, and each shard is a gzipped JSON block in one file. A search reads one shard.
//
// An address that is in the index is returned exactly. One that is not is placed by its neighbours on
// the same street: between the nearest known numbers below and above it, or at the nearest known number
// when there is only one side. The result says which, so the app can warn that it is approximate.
// Plain data work: no Electron, no network.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const fold = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

const DIRS = { NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W', NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW', NORTE: 'N', SUR: 'S', NORD: 'N', SUD: 'S', OUEST: 'O', ORIENTE: 'OTE', PONIENTE: 'PTE' };
const TYPES = {
  STREET: 'ST', STR: 'ST', AVENUE: 'AVE', AV: 'AVE', AVENIDA: 'AVE', BOULEVARD: 'BLVD', BOUL: 'BLVD', ROAD: 'RD', DRIVE: 'DR', LANE: 'LN', COURT: 'CT', CIRCLE: 'CIR',
  PLACE: 'PL', TERRACE: 'TER', TERR: 'TER', PARKWAY: 'PKWY', PKY: 'PKWY', HIGHWAY: 'HWY', TRAIL: 'TRL', SQUARE: 'SQ', ALLEY: 'ALY', EXPRESSWAY: 'EXPY', FREEWAY: 'FWY',
  CRESCENT: 'CRES', POINT: 'PT', RIDGE: 'RDG', CROSSING: 'XING', COVE: 'CV', HEIGHTS: 'HTS', EXTENSION: 'EXT', TRACE: 'TRCE', TURNPIKE: 'TPKE', ROUTE: 'RTE',
  CHEMIN: 'CH', CALLEJON: 'CJON', PRIVADA: 'PRIV', CERRADA: 'CDA', ANDADOR: 'AND', PROLONGACION: 'PROL', CAMINO: 'CAM', CARRETERA: 'CARR',
};
const OTHER = { SAINT: 'ST', SAINTE: 'STE', MOUNT: 'MT', FORT: 'FT', COUNTY: 'CO', FIRST: '1ST', SECOND: '2ND', THIRD: '3RD', FOURTH: '4TH', FIFTH: '5TH', SIXTH: '6TH', SEVENTH: '7TH', EIGHTH: '8TH', NINTH: '9TH', TENTH: '10TH' };
const WORDS = { ...DIRS, ...TYPES, ...OTHER };
const DIR_SET = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'O', 'OTE', 'PTE']);
const TYPE_SET = new Set([...Object.values(TYPES), 'WAY', 'LOOP', 'PIKE', 'RUN', 'PATH', 'PASS', 'WALK', 'ROW']);
const LEAD_SET = new Set(['CALLE', 'AVE', 'RUE', 'CH', 'BLVD', 'CJON', 'PRIV', 'CDA', 'AND', 'PROL', 'CAM', 'CARR']); // a kind of street that comes first, as in Spanish and French

const STATES = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA', COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE', 'DISTRICT OF COLUMBIA': 'DC', FLORIDA: 'FL', GEORGIA: 'GA', HAWAII: 'HI',
  IDAHO: 'ID', ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA', KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD', MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN', MISSISSIPPI: 'MS',
  MISSOURI: 'MO', MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', OHIO: 'OH',
  OKLAHOMA: 'OK', OREGON: 'OR', PENNSYLVANIA: 'PA', 'PUERTO RICO': 'PR', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT', VERMONT: 'VT',
  VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV', WISCONSIN: 'WI', WYOMING: 'WY',
  ALBERTA: 'AB', 'BRITISH COLUMBIA': 'BC', MANITOBA: 'MB', 'NEW BRUNSWICK': 'NB', 'NEWFOUNDLAND AND LABRADOR': 'NL', 'NOVA SCOTIA': 'NS', 'NORTHWEST TERRITORIES': 'NT', NUNAVUT: 'NU', ONTARIO: 'ON',
  'PRINCE EDWARD ISLAND': 'PE', QUEBEC: 'QC', SASKATCHEWAN: 'SK', YUKON: 'YT',
};
const STATE_CODES = new Set(Object.values(STATES));
const COUNTRIES = new Set(['USA', 'US', 'CANADA', 'MEXICO', 'UNITED STATES']);

const words = (s) => fold(s).replace(/[.'’`]/g, '').split(/[^A-Z0-9]+/).filter(Boolean);
/** A street name in the form it is kept and compared in: "North Main Street" and "N. Main St" are both N MAIN ST. */
const normStreet = (s) => words(s).map((w) => WORDS[w] || w).join(' ');
const normCity = (s) => words(s).map((w) => OTHER[w] || w).join(' ');
const normState = (s) => { const v = words(s).join(' '); return STATES[v] || v; };
const normZip = (s) => { const v = fold(s).replace(/[^A-Z0-9]/g, ''); return /^\d{9}$/.test(v) ? v.slice(0, 5) : v; };

/** The part of a street name that is left without its directions and its kind: N MAIN ST is MAIN. */
function core(key) {
  const t = key.split(' ');
  if (t.length > 2 && DIR_SET.has(t[t.length - 1])) t.pop();
  if (t.length > 1 && TYPE_SET.has(t[t.length - 1])) t.pop();
  if (t.length > 1 && DIR_SET.has(t[0])) t.shift();
  if (t.length > 1 && LEAD_SET.has(t[0])) t.shift();
  return t.join(' ');
}
const noDirs = (key) => { const t = key.split(' '); while (t.length > 1 && DIR_SET.has(t[t.length - 1])) t.pop(); while (t.length > 1 && DIR_SET.has(t[0])) t.shift(); return t.join(' '); };

/** The house number as a whole number: "123", "123A", "123 1/2" and "123-125" are all 123. Null when there is none. */
function numOf(s) { const m = /\d{1,9}/.exec(String(s == null ? '' : s)); return m ? Number(m[0]) : null; }

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

const title = (s) => s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (m, a, b) => a + b.toLowerCase()).replace(/\b(Ne|Nw|Se|Sw)\b/g, (m) => m.toUpperCase());

// ------------------------------------------------------------------ building

/** Many files written to in turn, each a little at a time. What was written can be measured and cut back to, so work can carry on after a stop. */
class Spool {
  constructor(dir, count, ext = 'tsv') { this.dir = dir; this.count = count; this.ext = ext; this.bufs = new Array(count).fill(null); this.used = new Array(count).fill(0); this.sizes = new Array(count).fill(0); fs.mkdirSync(dir, { recursive: true }); }
  file(i) { return path.join(this.dir, `${i.toString(36)}.${this.ext}`); }
  add(i, line) {
    const room = line.length * 3; // the most bytes the line can take
    if (room > Spool.BLOCK) { this.flushOne(i); const b = Buffer.from(line, 'utf8'); fs.appendFileSync(this.file(i), b); this.sizes[i] += b.length; return; }
    if (!this.bufs[i]) this.bufs[i] = Buffer.allocUnsafe(Spool.BLOCK);
    if (this.used[i] + room > Spool.BLOCK) this.flushOne(i);
    this.used[i] += this.bufs[i].write(line, this.used[i], 'utf8');
  }
  flushOne(i) { if (!this.used[i]) return; fs.appendFileSync(this.file(i), this.bufs[i].subarray(0, this.used[i])); this.sizes[i] += this.used[i]; this.used[i] = 0; }
  flush() { for (let i = 0; i < this.count; i++) this.flushOne(i); }
  lengths() { this.flush(); return this.sizes.slice(); }
  /** Cut every file back to a length recorded earlier; what was written after it is dropped. */
  restore(lengths) {
    this.used.fill(0);
    for (let i = 0; i < this.count; i++) {
      const want = (lengths && lengths[i]) || 0;
      let have = 0;
      try { have = fs.statSync(this.file(i)).size; } catch { have = 0; }
      if (have < want) throw new Error('The saved work is not whole.');
      if (have > want) { if (want === 0) fs.rmSync(this.file(i), { force: true }); else fs.truncateSync(this.file(i), want); }
      this.sizes[i] = want;
    }
  }
  read(i) { try { return fs.readFileSync(this.file(i), 'utf8'); } catch { return ''; } }
}
Spool.BLOCK = 32768;

const SHARDS = 2048;

/** Gathers address points and writes the index. */
class AddressBuilder {
  constructor(dir, shards = SHARDS) { this.dir = dir; this.shards = shards; this.spool = new Spool(path.join(dir, 'streets'), shards); this.locs = new Map(); this.locList = []; this.saved = 0; this.rows = 0; this.streetsSeen = new Map(); this.locsSeen = new Map(); }
  get locFile() { return path.join(this.dir, 'places.txt'); }

  /** Take one address. False when it has no usable street or number. */
  add(street, number, lon, lat, city, state, zip) {
    // The same street and the same town come up row after row, so what was worked out for them is kept a while.
    let s = this.streetsSeen.get(street);
    if (s === undefined) { const key = normStreet(street); s = key ? [key, hash(core(key)) % this.shards] : null; if (this.streetsSeen.size > 200000) this.streetsSeen.clear(); this.streetsSeen.set(street, s); }
    const n = numOf(number);
    if (!s || n == null || !Number.isFinite(lon) || !Number.isFinite(lat)) return false;
    const raw = `${city}\u0001${state}\u0001${zip}`;
    let li = this.locsSeen.get(raw);
    if (li === undefined) {
      const loc = `${normCity(city)}|${normState(state)}|${normZip(zip)}`;
      li = this.locs.get(loc);
      if (li === undefined) { li = this.locList.length; this.locs.set(loc, li); this.locList.push(loc); }
      if (this.locsSeen.size > 200000) this.locsSeen.clear();
      this.locsSeen.set(raw, li);
    }
    this.spool.add(s[1], `${s[0]}\t${n}\t${Math.round(lon * 1e6)}\t${Math.round(lat * 1e6)}\t${li}\n`);
    this.rows += 1;
    return true;
  }

  /** Write everything taken so far to disk and say where things stand, to return to with restore(). */
  checkpoint() {
    if (this.locList.length > this.saved) { fs.appendFileSync(this.locFile, this.locList.slice(this.saved).map((l) => `${l}\n`).join('')); this.saved = this.locList.length; }
    return { lengths: this.spool.lengths(), locs: this.locList.length, rows: this.rows };
  }

  restore(state) {
    this.spool.restore(state ? state.lengths : null);
    const want = state ? state.locs : 0;
    let lines = [];
    try { lines = fs.readFileSync(this.locFile, 'utf8').split('\n'); } catch { lines = []; }
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    if (lines.length < want) throw new Error('The saved work is not whole.');
    this.locList = lines.slice(0, want); this.locs = new Map(this.locList.map((l, i) => [l, i])); this.locsSeen.clear(); this.saved = want; this.rows = state ? state.rows : 0;
    fs.writeFileSync(this.locFile, this.locList.map((l) => `${l}\n`).join(''));
  }

  /** Sort what was gathered and write the index file. Returns what goes in its description. */
  finish(datFile, onProgress = () => {}) {
    this.spool.flush();
    const fd = fs.openSync(datFile, 'w');
    const offsets = [];
    let at = 0; let addresses = 0; let streets = 0;
    try {
      for (let i = 0; i < this.shards; i++) {
        const text = this.spool.read(i);
        if (!text) { offsets.push([0, 0]); continue; }
        const byCore = new Map();
        let from = 0;
        while (from < text.length) {
          let to = text.indexOf('\n', from); if (to < 0) to = text.length;
          const f = text.slice(from, to).split('\t'); from = to + 1;
          if (f.length !== 5) continue;
          const c = core(f[0]);
          let fulls = byCore.get(c); if (!fulls) byCore.set(c, fulls = new Map());
          let groups = fulls.get(f[0]); if (!groups) fulls.set(f[0], groups = new Map());
          let pts = groups.get(f[4]); if (!pts) groups.set(f[4], pts = []);
          pts.push([Number(f[1]), Number(f[2]), Number(f[3])]);
        }
        const local = new Map(); const l = []; const s = {};
        for (const [c, fulls] of byCore) {
          s[c] = [];
          for (const [full, groups] of fulls) {
            const out = [];
            for (const [li, pts] of groups) {
              pts.sort((a, b) => a[0] - b[0]);
              const flat = []; let pn = 0; let px = 0; let py = 0; let last = null; let kept = [];
              for (const p of pts) {
                // A number given again at the same spot is the same building (its flats, or the row read twice) and is kept once.
                // The same number far away is another building: rows that name no town are one group for a whole state.
                if (p[0] !== last) { last = p[0]; kept = []; }
                if (kept.some((k) => Math.abs(k[1] - p[1]) < 5000 && Math.abs(k[2] - p[2]) < 5000)) continue;
                kept.push(p);
                flat.push(p[0] - pn, p[1] - px, p[2] - py); [pn, px, py] = p; addresses += 1;
              }
              const name = this.locList[Number(li)] || '||';
              let id = local.get(name); if (id === undefined) { id = l.length; local.set(name, id); l.push(name); }
              out.push([id, flat]);
            }
            s[c].push([full, out]); streets += 1;
          }
        }
        const block = zlib.gzipSync(Buffer.from(JSON.stringify({ l, s })), { level: 6 });
        fs.writeSync(fd, block, 0, block.length, at);
        offsets.push([at, block.length]); at += block.length;
        if (i % 16 === 0) onProgress(i / this.shards);
      }
    } finally { fs.closeSync(fd); }
    // offsets: for each shard, where its block starts in the file and how long it is ([0, 0] for a shard with nothing in it).
    return { v: 1, shards: this.shards, offsets, addresses, streets, bytes: at };
  }
}

// ------------------------------------------------------------------ searching

const R = 6371008.8;
function metres(lon1, lat1, lon2, lat2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Where a typed place stops being the street and starts being the town: "Albany NY 12207" as { city, state, zip }. */
function locOf(tokens) {
  const t = tokens.slice();
  const out = { city: '', state: '', zip: '' };
  if (t.length >= 2 && t[t.length - 2] === 'OF' && t[t.length - 1] === 'AMERICA') t.splice(-2);
  while (t.length && COUNTRIES.has(t[t.length - 1])) t.pop();
  if (t.length >= 2 && t[t.length - 2] === 'UNITED' && t[t.length - 1] === 'STATES') t.splice(-2);
  if (t.length && /^\d{9}$/.test(t[t.length - 1])) t[t.length - 1] = t[t.length - 1].slice(0, 5); // a nine-digit ZIP code written as one number
  if (t.length && /^\d{4}$/.test(t[t.length - 1]) && t.length >= 2 && /^\d{5}$/.test(t[t.length - 2])) t.pop(); // the last four of a nine-digit ZIP code
  if (t.length && /^\d{5}$/.test(t[t.length - 1])) out.zip = t.pop();
  else if (t.length && /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(t[t.length - 1])) out.zip = t.pop();
  else if (t.length >= 2 && /^[A-Z]\d[A-Z]$/.test(t[t.length - 2]) && /^\d[A-Z]\d$/.test(t[t.length - 1])) out.zip = t.splice(-2).join('');
  for (const n of [4, 3, 2, 1]) {
    if (t.length < n) continue;
    const tail = t.slice(-n).join(' ');
    if (STATES[tail]) { out.state = STATES[tail]; t.splice(-n); break; }
    if (n === 1 && STATE_CODES.has(tail)) { out.state = tail; t.pop(); break; }
  }
  out.city = t.map((w) => OTHER[w] || w).join(' ');
  return out;
}

/**
 * Take a typed address apart: { number, street: [words], loc: { city, state, zip } | null }.
 * With commas the town is what follows the first one. Without, the words after the number are the street
 * and perhaps the town, and the index decides where one ends (see AddressIndex.find).
 */
const UNIT = /^(?:APT|APARTMENT|UNIT|STE|SUITE|LOT|TRLR|BLDG|BUILDING|FLOOR|FL|RM|ROOM|DEPT|PMB|NO)\b\s*#?\s*[A-Z0-9-]*$|^#\s*[A-Z0-9-]+$|^\d+(?:ST|ND|RD|TH) FLOOR$/;
const NUMBERED = /^\d+[A-Z]?(?:-(?:\d+[A-Z]?|[A-Z]))?\s+\S/;
function parse(text) {
  let segs = fold(text).replace(/[.'’`]/g, '').split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  // A line of its own for the apartment or suite says nothing about where the building is.
  segs = segs.filter((s, i) => !(UNIT.test(s) && segs.length > 1 && (i > 0 || segs.length > 2)));
  // A contact's address often begins with a name ("Acme Widgets", "c/o ...") before the line with the house number.
  if (segs.length > 1 && !NUMBERED.test(segs[0])) { const at = segs.findIndex((s, i) => i > 0 && i <= 2 && NUMBERED.test(s)); if (at > 0 && !LEAD_SET.has(WORDS[segs[0].split(/\s+/)[0]] || segs[0].split(/\s+/)[0])) segs = segs.slice(at); }
  if (!segs.length) return null;
  const first = segs[0].replace(/\s+(APT|APARTMENT|UNIT|STE|SUITE|LOT|TRLR|BLDG|FLOOR|RM|ROOM)\s*#?\s*[A-Z0-9-]+$/, '').replace(/\s*#\s*[A-Z0-9-]+$/, '');
  let t = first.split(/\s+/).filter((w) => w && !/^\d+\/\d+$/.test(w));
  let number = null;
  if (t.length > 1 && /^\d+[A-Z]?(-(\d+[A-Z]?|[A-Z]))?$/.test(t[0])) { number = numOf(t[0]); t = t.slice(1); } else if (t.length > 1 && /^\d+[A-Z]?$/.test(t[t.length - 1]) && LEAD_SET.has(WORDS[t[0]] || t[0])) { number = numOf(t[t.length - 1]); t = t.slice(0, -1); }
  const raw = t.join(' ').split(/[^A-Z0-9]+/).filter(Boolean); // as typed, for the words that turn out to be the town
  const street = raw.map((w) => WORDS[w] || w);
  if (!street.length) return null;
  const rest = segs.slice(1).join(' ').split(/[^A-Z0-9]+/).filter(Boolean);
  return { number, street, raw, loc: rest.length ? locOf(rest) : null };
}

/**
 * The town, state and ZIP code in a piece of text that may hold no street at all: "Albany, NY",
 * "PO Box 12, Utica NY 13501", "12207". Returns { city, state, zip } or null when it names none of them.
 */
function placeIn(text) {
  const t = fold(text).replace(/[.'’`]/g, '').replace(/\bP\s*O\s*BOX\s*\d*\b|\bPOST OFFICE BOX\s*\d*\b/g, ' ').split(/[^A-Z0-9]+/).filter(Boolean);
  if (!t.length) return null;
  const loc = locOf(t);
  return loc.city || loc.zip ? loc : null;
}

const LIMITS = { apart: 2500, span: 4000, town: 40000, other: 15000 };

/** Reads the index. */
class AddressIndex {
  constructor(datFile, meta) { this.file = datFile; this.meta = meta; this.cache = new Map(); }

  shard(i) {
    if (this.cache.has(i)) { const v = this.cache.get(i); this.cache.delete(i); this.cache.set(i, v); return v; }
    const [at, len] = this.meta.offsets[i] || [0, 0];
    let v = { l: [], s: {} };
    if (len) {
      const fd = fs.openSync(this.file, 'r');
      try { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, at); v = JSON.parse(zlib.gunzipSync(b).toString('utf8')); } finally { fs.closeSync(fd); }
    }
    this.cache.set(i, v);
    if (this.cache.size > 12) this.cache.delete(this.cache.keys().next().value);
    return v;
  }

  /**
   * Where every town and every ZIP code of the address data is: the middle of its addresses.
   * Returns { towns: { 'CITY|ST': [lon, lat, count] }, zips: { '12207': [lon, lat, count] } }.
   * Reads the whole index once, a shard at a time, and lets other work in between.
   */
  async gazetteer({ onProgress = () => {}, signal = null } = {}) {
    const towns = new Map(); const zips = new Map();
    const stats = { rows: 0, noTown: 0, noZip: 0, neither: 0 };
    const add = (map, key, n, x, y) => { let v = map.get(key); if (!v) { v = [0, 0, 0]; map.set(key, v); } v[0] += x; v[1] += y; v[2] += n; };
    const fd = fs.openSync(this.file, 'r');
    try {
      for (let i = 0; i < this.meta.offsets.length; i++) {
        if (signal && signal.aborted) throw new Error('Stopped.');
        const [at, len] = this.meta.offsets[i] || [0, 0];
        if (len) {
          const b = Buffer.alloc(len);
          fs.readSync(fd, b, 0, len, at);
          const sh = JSON.parse(zlib.gunzipSync(b).toString('utf8'));
          const sums = new Map(); // per place of this shard: count, sum of x, sum of y
          for (const entry of Object.values(sh.s)) for (const [, groups] of entry) for (const [li, flat] of groups) {
            let s = sums.get(li); if (!s) { s = [0, 0, 0]; sums.set(li, s); }
            let x = 0; let y = 0;
            for (let k = 0; k < flat.length; k += 3) { x += flat[k + 1]; y += flat[k + 2]; s[0] += 1; s[1] += x; s[2] += y; }
          }
          for (const [li, [n, sx, sy]] of sums) {
            const [city, state, zip] = (sh.l[li] || '||').split('|');
            const town = Boolean(city) && !/^UNINCORPORATED|^UNKNOWN$|^NOT STATED$/.test(city);
            const code = /^\d{5}$/.test(zip) || /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(zip);
            if (town) add(towns, `${city}|${state}`, n, sx, sy);
            if (code) add(zips, zip, n, sx, sy);
            stats.rows += n; if (!town) stats.noTown += n; if (!code) stats.noZip += n; if (!town && !code) stats.neither += n;
          }
        }
        if (i % 16 === 15) { onProgress((i + 1) / this.meta.offsets.length); await new Promise((r) => setImmediate(r)); }
      }
    } finally { fs.closeSync(fd); }
    const out = (map) => Object.fromEntries([...map].filter(([, v]) => v[2] >= 3).map(([k, [sx, sy, n]]) => [k, [Math.round(sx / n) / 1e6, Math.round(sy / n) / 1e6, n]]));
    return { towns: out(towns), zips: out(zips), stats };
  }

  /**
   * Find a typed address. `near` is [lon, lat] to prefer when the town is not given; `townAt(city, state)`
   * may return [lon, lat] of a named town, used when the address data names the town differently.
   * Returns { parsed, hits: [{ lon, lat, label, how, note }], street } where `how` is 'exact', 'between',
   * 'nearest' or 'street', and `street` is true when a street of that name exists somewhere.
   */
  find(text, { near = null, townAt = () => null, zipAt = () => null, limit = 5 } = {}) {
    const p = parse(text);
    if (!p) return { parsed: null, hits: [], street: false };
    let seen = false;
    for (let k = p.street.length; k >= 1; k--) {
      const key = p.street.slice(0, k).join(' ');
      const c = core(key);
      const sh = this.shard(hash(c) % this.meta.shards);
      const entry = sh.s[c];
      if (!entry) continue;
      seen = true;
      const tail = p.raw.slice(k);
      const loc = p.loc && tail.length ? { ...p.loc, city: [...tail.map((w) => OTHER[w] || w), p.loc.city].filter(Boolean).join(' ') } : p.loc || (tail.length ? locOf(tail) : null);
      const hits = this.resolve(entry, sh.l, key, p.number, loc, near, townAt, zipAt).slice(0, limit);
      if (hits.length) return { parsed: { ...p, loc }, hits, street: true };
    }
    return { parsed: p, hits: [], street: seen };
  }

  resolve(entry, locs, key, number, loc, near, townAt, zipAt = () => null) {
    const asked = loc && (loc.zip || loc.city || loc.state);
    // Where the town asked for is, for rows that name it differently or not at all: the ZIP code's own middle first.
    const anchor = (loc && loc.zip ? zipAt(loc.zip) : null) || (loc && loc.city ? townAt(loc.city, loc.state) : null);
    const plain = noDirs(key); const kc = core(key);
    const found = [];
    for (const [full, groups] of entry) {
      const rank = full === key ? 3 : noDirs(full) === plain ? 2 : core(full) === kc ? 1 : 0;
      const sets = new Map(); // which groups go together: one set per town when the town is not given
      for (const [li, flat] of groups) {
        const [city, state, zip] = (locs[li] || '||').split('|');
        let set = null;
        if (!asked) set = `${li}`;
        else if (loc.zip && zip === loc.zip) set = 'town';
        else if (loc.city && city === loc.city && (!loc.state || !state || state === loc.state)) set = 'town';
        else if (!loc.zip && !loc.city && loc.state && state === loc.state) set = `${li}`;
        else if (anchor && flat.length && (!loc.state || !state || state === loc.state)) set = `a${li}`;
        if (set === null) continue;
        // Rows found only by being near the town asked for are taken point by point: rows that name no town
        // are one group for the whole state. Where the data names another town and ZIP code, only close by.
        const reach = set[0] === 'a' ? (city && loc.city && zip && loc.zip ? LIMITS.other : LIMITS.town) : 0;
        const pts = [];
        let n = 0; let x = 0; let y = 0;
        for (let i = 0; i < flat.length; i += 3) { n += flat[i]; x += flat[i + 1]; y += flat[i + 2]; if (!reach || metres(anchor[0], anchor[1], x / 1e6, y / 1e6) <= reach) pts.push([n, x / 1e6, y / 1e6, li]); }
        if (!pts.length) continue;
        if (!sets.has(set)) sets.set(set, { pts: [], near: set[0] === 'a' });
        sets.get(set).pts.push(...pts);
      }
      for (const s of sets.values()) {
        s.pts.sort((a, b) => a[0] - b[0]);
        // Several buildings with the number asked for, all near the town: the one nearest its middle.
        if (s.near && number != null) { const same = s.pts.filter((p) => p[0] === number); if (same.length > 1) { const d = (p) => metres(anchor[0], anchor[1], p[1], p[2]); const keep = same.reduce((a, b) => (d(b) < d(a) ? b : a)); s.pts = s.pts.filter((p) => p[0] !== number || p === keep); } }
        const hit = place(s.pts, number);
        if (!hit) continue;
        const [city, state, zip] = (locs[hit.li] || '||').split('|');
        // A row that names no town, found near the one asked for, is shown under the town asked for.
        const shown = !city && s.near && loc.city ? loc.city : city;
        const where = [title(shown), [state.length <= 3 ? state : title(state), zip || (!city && s.near && loc.zip ? loc.zip : '')].filter(Boolean).join(' ')].filter(Boolean).join(', ');
        const street = title(full);
        const off = s.near ? metres(anchor[0], anchor[1], hit.lon, hit.lat) : 0;
        // Found near the town asked for, under another town's name: said, and not counted as certain.
        const elsewhere = s.near && city && loc.city && city !== loc.city ? ` The address data has it under ${title(city)}${zip ? ` ${zip}` : ''}, ${Math.max(1, Math.round(off / 1000))} km from the middle of ${loc.zip && zipAt(loc.zip) ? `ZIP code ${loc.zip}` : title(loc.city)}.` : '';
        found.push({ lon: hit.lon, lat: hit.lat, how: hit.how, rank, tier: s.near ? 0 : 1, off, sure: rank === 3 && !elsewhere, label: [`${number != null ? `${number} ` : ''}${street}`, where].filter(Boolean).join(', '), note: `${noteOf(hit, street, rank < 3 && number != null)}${elsewhere}`.trim(), far: near ? metres(near[0], near[1], hit.lon, hit.lat) : 0 });
      }
    }
    const best = Math.max(-1, ...found.map((f) => f.rank));
    let top = found.filter((f) => f.rank === best);
    if (top.some((f) => f.tier === 1)) top = top.filter((f) => f.tier === 1); // named by ZIP code or town: the merely near ones are not wanted
    const order = { exact: 0, between: 1, nearest: 2, street: 3 };
    return top.sort((a, b) => order[a.how] - order[b.how] || a.off - b.off || a.far - b.far).map(({ rank, far, tier, off, ...h }) => ({ ...h, lon: Math.round(h.lon * 1e6) / 1e6, lat: Math.round(h.lat * 1e6) / 1e6, km: near ? Math.round(far / 100) / 10 : null }));
  }
}

function noteOf(hit, street, renamed) {
  const also = renamed ? ` The street is in the data as ${street}.` : '';
  if (hit.how === 'exact') return also.trim();
  if (hit.how === 'between') return `Approximate. This number is not in the address data, so it is placed between ${hit.lo} and ${hit.hi} on the same street.${also}`;
  if (hit.how === 'nearest') return `Approximate. This number is not in the address data. The nearest known number on the street is ${hit.ref}, and that is where this points.${also}`;
  return `The street, not a house: this points at the middle of its known addresses.${also}`;
}

/** Place a number among the known points of one street, sorted by number. */
function place(pts, number) {
  if (!pts.length) return null;
  if (number == null) { const m = pts[pts.length >> 1]; return { lon: m[1], lat: m[2], li: m[3], how: 'street' }; }
  let lo = 0; let hi = pts.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid][0] < number) lo = mid + 1; else hi = mid; }
  if (lo < pts.length && pts[lo][0] === number) return { lon: pts[lo][1], lat: pts[lo][2], li: pts[lo][3], how: 'exact' };
  const below = (same) => { for (let i = lo - 1; i >= 0 && i >= lo - 40; i--) if (!same || (pts[i][0] - number) % 2 === 0) return pts[i]; return null; };
  const above = (same) => { for (let i = lo; i < pts.length && i < lo + 40; i++) if (!same || (pts[i][0] - number) % 2 === 0) return pts[i]; return null; };
  // Houses on one side of a street share odd or even numbers, so neighbours of the same kind are tried first.
  for (const same of [true, false]) {
    const a = below(same); const b = above(same);
    if (a && b && b[0] - a[0] <= LIMITS.span && metres(a[1], a[2], b[1], b[2]) <= LIMITS.apart) {
      const f = (number - a[0]) / (b[0] - a[0]);
      return { lon: a[1] + (b[1] - a[1]) * f, lat: a[2] + (b[2] - a[2]) * f, li: a[3], how: 'between', lo: a[0], hi: b[0] };
    }
  }
  // One side only, or neighbours too far apart to draw a line between: the nearest known number, on the same side of the street if it can be.
  const a = below(true) || below(false); const b = above(true) || above(false);
  const ref = !a ? b : !b ? a : number - a[0] <= b[0] - number ? a : b;
  return { lon: ref[1], lat: ref[2], li: ref[3], how: 'nearest', ref: ref[0] };
}

/** Whether typed words read as an address and not the name of a place: a house number, or a word for a kind of street. */
const looksLikeAddress = (p) => Boolean(p) && (p.number != null || p.street.some((w) => TYPE_SET.has(w) || LEAD_SET.has(w)));

module.exports = { placeIn, looksLikeAddress, AddressBuilder, AddressIndex, Spool, SHARDS, normStreet, normCity, normState, normZip, core, numOf, parse, locOf, hash, place, metres, title, fold };
