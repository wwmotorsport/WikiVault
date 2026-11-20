'use strict';
// Maps: the official list of hospitals, laid over the places.
//
// Neither source of places says reliably what is a hospital. OpenStreetMap misses some and Overture files every kind of
// medical office as one; a rule on names ("has the word hospital") loses the many hospitals named like "Riverside
// Health Northside". For the United States there is a list that settles it: Medicare's Hospital General Information
// (data.cms.gov, public domain), every certified hospital with its address, telephone, type and whether it has
// emergency services. It has no positions, so it cannot be a source of places on its own; it is matched to the places
// that are there, by telephone number, or by postcode or town and name.
//
// A place that matches is a hospital whatever its name, and carries the list's word on its emergency room. A place
// from Overture filed as a hospital that matches nothing, in a state where the list was matched well, is kept but
// marked as a lesser sort, so that it cannot crowd the listed hospitals out of a list of the nearest.

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
// Words that say "this is a hospital" or nothing at all: two names are compared by the words that are left.
const PLAIN = new Set(['hospital', 'hospitals', 'medical', 'center', 'centre', 'ctr', 'health', 'healthcare', 'care', 'regional', 'memorial', 'community', 'general', 'system', 'systems', 'services', 'the', 'of', 'and', 'at', 'inc', 'llc', 'campus', 'main', 'county', 'university', 'st', 'saint', 'clinic', 'emergency', 'department', 'room', 'er']);
const wordsOf = (name) => { const all = fold(name).split(' ').filter(Boolean); const some = all.filter((w) => !PLAIN.has(w) && w.length > 1); return some.length ? some : all; };
const phoneOf = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
const zipOf = (d) => { const m = /\b(\d{5})(?:-\d{4})?\s*$/.exec(String(d || '')) || /\b[A-Z]{2}\s+(\d{5})\b/.exec(String(d || '')); return m ? m[1] : ''; };
const stateOf = (d) => { const m = /,\s*([A-Z]{2})\s+\d{5}/.exec(String(d || '')); return m ? m[1] : ''; };

// A part of a hospital, or an office in its grounds, shares its postcode, its switchboard and half its name. These
// words, or a doctor's letters after a name, mark a place that is not the hospital itself.
const PART = /\b(?:suite|ste|plaza|pavilion|tower|building|bldg|annex|ambulatory|outpatient|primary care|family (?:medicine|practice|health)|internal medicine|pediatrics?|ob\/?gyn|obstetrics|gynecolog\w*|women s|physical therapy|speech therapy|therapy|rehab\w*|sports medicine|orthop\w*|dermatolog\w*|urgent care|sleep|endoscopy|imaging|radiolog\w*|breast|vein|spine|neuro\w*|cardiolog\w*|heart|vascular|oncolog\w*|cancer|dental|eye|hearing|audiolog\w*|pharmacy|laborator\w*|lab|associates|institute|group|practice|clinic|office|unit|gift shop|cafeteria|parking|foundation|auxiliary|volunteer\w*|school|college|dialysis|hospice|home health|at home|nursing|wellness|weight|surgery center|surgical|urolog\w*|gastro\w*|allerg\w*|podiatr\w*|pain|diabetes|anesthesi\w*|ems|ear|nose|throat|ent|support|billing|records|md|do|np|pa|dds|phd|msc|rn)\b/;
const isPart = (name) => PART.test(fold(name));

/**
 * How alike two names are, from 0 to 1: the share of the shorter name's telling words that the other has.
 * `town` is left out of both: every hospital and every dentist in Springfield has Springfield in its name.
 */
function alike(a, b, town = '') {
  const t = new Set(fold(town).split(' '));
  const cut = (n) => { const w = wordsOf(n); const left = w.filter((x) => !t.has(x)); return left.length ? left : w; };
  const x = cut(a); const y = new Set(cut(b));
  if (!x.length || !y.size) return 0;
  const hit = x.filter((w) => y.has(w)).length;
  return hit / Math.min(x.length, y.size);
}

const TYPES = [[/psychiatric/i, 'Psychiatric hospital', true], [/long-?term/i, 'Long-term care hospital', true], [/cancer/i, 'Cancer hospital', true], [/children/i, "Children's hospital", false], [/veterans/i, 'Veterans hospital', false], [/defense/i, 'Military hospital', false], [/critical access/i, 'Critical access hospital', false], [/rural emergency/i, 'Rural emergency hospital', false]];

/** One row of the list as the app keeps it: [name, address, town, state, postcode, telephone, type, emergency]. */
function rowOf(r) {
  const name = String(r.facility_name || '').replace(/\s+/g, ' ').trim();
  if (!name || !r.state) return null;
  return [name, String(r.address || '').trim(), String(r.citytown || '').trim(), String(r.state).trim().toUpperCase(), String(r.zip_code || '').trim().slice(0, 5), phoneOf(r.telephone_number), String(r.hospital_type || '').trim(), /^y/i.test(String(r.emergency_services || '')) ? 'yes' : 'no'];
}

/**
 * Lay the list over the places. `hospital` and `clinic` are the places of those two kinds (records of the app);
 * `rows` is the list. Returns `{ hospital, clinic, stats }`: new lists, with matched places marked and, where they
 * were with the clinics, moved to the hospitals. The records given are not changed.
 */
function lay(rows, hospital, clinic) {
  if (!rows || !rows.length) return { hospital, clinic, stats: null };
  const byPhone = new Map(); const byZip = new Map(); const byWord = new Map();
  const put = (m, k, v) => { if (!k) return; let l = m.get(k); if (!l) m.set(k, l = []); l.push(v); };
  // Candidates: every hospital, and the clinics that came from Overture (an office Overture filed as a hospital is
  // among the clinics by now, and so is a real hospital whose name did not say so).
  const cands = [];
  hospital.forEach((r, i) => cands.push({ r, from: 'hospital', i }));
  clinic.forEach((r, i) => { if (r.s === 'ov') cands.push({ r, from: 'clinic', i }); });
  for (const c of cands) {
    put(byPhone, phoneOf(c.r.p), c); put(byZip, zipOf(c.r.d), c);
    for (const w of new Set(wordsOf(c.r.n))) put(byWord, w, c);
  }
  const found = new Map(); // candidate -> row
  const perState = new Map();
  let matched = 0;
  for (const row of rows) {
    const [name, , town, state, zip, phone] = row;
    const st = perState.get(state) || { rows: 0, matched: 0 }; perState.set(state, st); st.rows += 1;
    const hits = new Map(); // candidate -> score
    const note = (c, score) => { const s = stateOf(c.r.d); if (s && s !== state) return; if (!(hits.get(c) >= score)) hits.set(c, score); };
    const kin = (c) => (isPart(c.r.n) ? 0 : alike(name, c.r.n, town));
    for (const c of byPhone.get(phone) || []) { const a = kin(c); if (a >= 0.34 || (a > 0 || !isPart(c.r.n)) && /hospital|medical cent/i.test(c.r.n)) note(c, 2 + a); }
    for (const c of byZip.get(zip) || []) { const a = kin(c); if (a >= 0.6) note(c, 1 + a); }
    // By name alone: the name must agree well, and the place's address, when it has one, must be in the same town.
    const ws = wordsOf(name); const rare = ws.slice().sort((a, b) => (byWord.get(a) || []).length - (byWord.get(b) || []).length)[0];
    const t = fold(town);
    for (const c of (byWord.get(rare) || []).slice(0, 400)) {
      const a = kin(c); if (a < 0.75 || wordsOf(c.r.n).length < 2 && ws.length < 2) continue;
      const d = fold(c.r.d);
      if (d ? (t && d.includes(t)) : a === 1 && ws.length >= 2 && (byWord.get(rare) || []).length <= 3) note(c, a);
    }
    if (!hits.size) continue;
    matched += 1; st.matched += 1;
    const best = Math.max(...hits.values());
    // The same hospital is often in the data more than once (both sources; a point and an outline): all that scored near the best are it.
    for (const [c, score] of hits) if (score >= best - 0.5 && score >= 0.75) { const had = found.get(c); if (!had || had.score < score) found.set(c, { row, score }); }
  }
  const good = new Set([...perState].filter(([, s]) => s.rows >= 5 && s.matched / s.rows >= 0.7).map(([k]) => k));
  const mark = (r, row) => {
    const [, , , , , , type, er] = row;
    const t = TYPES.find(([re]) => re.test(type));
    const x = { ...(r.x || {}) }; if (!x.emergency) x.emergency = er; x.listed = 'Medicare hospital list';
    if (t) x.kind = t[1]; else if (x.kind && r.less) delete x.kind;
    const out = { ...r, x }; delete out.less; if (t && t[2]) out.less = true;
    return out;
  };
  const outH = []; const outC = []; let promoted = 0; let lowered = 0;
  for (const c of cands) {
    const f = found.get(c);
    if (c.from === 'hospital') {
      if (f) outH.push(mark(c.r, f.row));
      else if (c.r.s === 'ov' && !c.r.less && good.has(stateOf(c.r.d))) { lowered += 1; outH.push({ ...c.r, less: true, x: { ...(c.r.x || {}), kind: (c.r.x && c.r.x.kind) || 'Not on the Medicare hospital list' } }); } else outH.push(c.r);
    } else if (f) { promoted += 1; outH.push({ ...mark(c.r, f.row), c: 'hospital' }); }
  }
  const gone = new Set(cands.filter((c) => c.from === 'clinic' && found.has(c)).map((c) => c.r));
  for (const r of clinic) if (!gone.has(r)) outC.push(r);
  return { hospital: outH, clinic: outC, stats: { rows: rows.length, matched, places: found.size, promoted, lowered, states: good.size } };
}

/**
 * Fetch the list (a few thousand rows, in pages) and keep it at `<dir>/official/hospitals-us.json`.
 * `get(url)` fetches a page as a Buffer. Returns `{ count, date }`; throws if the list did not arrive whole.
 */
async function fetchList({ dir, cfg, get }) {
  const fs = require('node:fs'); const path = require('node:path');
  const page = cfg.page || 500; const rows = []; let total = null;
  for (let off = 0; off < 40000; off += page) {
    const res = JSON.parse((await get(`${cfg.url}?limit=${page}&offset=${off}`)).toString('utf8'));
    if (!res || !Array.isArray(res.results)) throw new Error('The hospital list did not arrive in the form expected.');
    if (typeof res.count === 'number') total = res.count;
    for (const r of res.results) { const row = rowOf(r); if (row) rows.push(row); }
    if (res.results.length < page) break;
  }
  if (rows.length < 100 || (total && rows.length < total * 0.95)) throw new Error(`Only ${rows.length} of the hospital list's ${total || '?'} rows arrived.`);
  const info = { date: new Date().toISOString(), source: cfg.url, count: rows.length, rows };
  fs.mkdirSync(path.join(dir, 'official'), { recursive: true });
  const tmp = path.join(dir, 'official', 'hospitals-us.json.new');
  fs.writeFileSync(tmp, JSON.stringify(info)); fs.renameSync(tmp, path.join(dir, 'official', 'hospitals-us.json'));
  return { count: rows.length, date: info.date };
}

module.exports = { fetchList, lay, rowOf, alike, isPart, phoneOf, zipOf, stateOf };
