'use strict';
// Maps: the ready-made set of places.
//
// Sorting a million places takes 13 GB of downloads, an hour, and three sources that do not agree. That work is the
// same for every user, so it is done once: a job on GitHub's servers runs this app's own places code each week, over
// all of North America, and publishes the result as small files beside the app's releases. The app then fetches about
// 70 MB in place of 13 GB, and a better rule in the repository reaches every user at their next update of the places,
// with no new version of the app.
//
// The set is the two folders the app already keeps (places/ from OpenStreetMap, overture/ from Overture Maps, sorted),
// the hospital list, and a manifest that names each file with its size and SHA-256. Nothing in it comes from any
// user's computer, and fetching it tells GitHub only that someone fetched it.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

/**
 * Pack a library's places (as the app wrote them under `dir`) into the files to publish, under `out`.
 * Returns the manifest, which is also written as places-manifest.json.
 */
function pack({ dir, out, app = '', regions }) {
  const osm = readJson(path.join(dir, 'places.json')); const ov = readJson(path.join(dir, 'overture.json'));
  if (!osm || osm.partial) throw new Error('The places from OpenStreetMap are not complete: nothing is packed.');
  fs.mkdirSync(out, { recursive: true });
  const files = [];
  const add = (set, cat, from, name) => {
    const raw = fs.readFileSync(from); const gz = zlib.gzipSync(raw, { level: 9 });
    fs.writeFileSync(path.join(out, name), gz);
    files.push({ name, set, ...(cat ? { cat } : {}), bytes: gz.length, raw: raw.length, sha256: sha256(gz) });
  };
  for (const [set, folder, prefix] of [['osm', 'places', 'osm'], ['overture', 'overture', 'ov']]) {
    const at = path.join(dir, folder);
    for (const f of fs.existsSync(at) ? fs.readdirSync(at).filter((n) => /^[a-z_]+\.json$/.test(n)).sort() : []) add(set, f.replace(/\.json$/, ''), path.join(at, f), `${prefix}-${f}.gz`);
  }
  const hosp = path.join(dir, 'official', 'hospitals-us.json'); const hospInfo = readJson(hosp);
  if (hospInfo) add('official', null, hosp, 'hospitals-us.json.gz');
  if (!files.some((f) => f.set === 'osm')) throw new Error('There are no places to pack.');
  const manifest = {
    v: 1, built: new Date().toISOString(), app, regions,
    osm: { date: osm.date, total: osm.total, counts: osm.counts },
    overture: ov ? { release: ov.release, date: ov.date, total: ov.total, counts: ov.counts, sorted: ov.sorted || 0, sorting: ov.sorting || null, brands: ov.brands || null } : null,
    hospitals: hospInfo ? { date: hospInfo.date, count: hospInfo.count } : null,
    bytes: files.reduce((a, f) => a + f.bytes, 0), files,
    credit: 'Places © OpenStreetMap contributors (Open Database License). Added places from the Overture Maps Foundation (CDLA Permissive 2.0 and others). Brand names from the Name Suggestion Index (BSD-3-Clause). Hospital list from the Centers for Medicare & Medicaid Services (public domain).',
  };
  fs.writeFileSync(path.join(out, 'places-manifest.json'), JSON.stringify(manifest, null, 1));
  return manifest;
}

/** Whether a manifest is one this version can use for these regions. Returns a reason in words when it is not. */
function unusable(m, regionIds, maxAgeDays = 60, now = Date.now()) {
  if (!m || m.v !== 1 || !Array.isArray(m.files) || !m.files.length || !m.osm) return 'it is not in the form this version reads';
  if (!regionIds.every((r) => (m.regions || []).includes(r))) return 'it does not cover every region chosen';
  const age = (now - Date.parse(m.built)) / 86400000;
  if (!(age <= maxAgeDays)) return `it was built ${Math.round(age)} days ago`;
  for (const f of m.files) if (!/^[a-z0-9_.-]+\.json\.gz$/.test(f.name || '') || !/^[0-9a-f]{64}$/.test(f.sha256 || '') || !(f.bytes > 0)) return 'its list of files is not in order';
  return null;
}

/**
 * Put fetched files to use: unpack each, keep the places inside the chosen regions (`inside(lon, lat)`, or null for
 * all), and write them where the app reads them, replacing what was there. `from` is the folder the files were
 * fetched to. Returns `{ places, overture }`: the two summaries the app keeps (overture null when the set has none).
 */
async function install({ dir, from, manifest, regionIds, inside = null, onProgress = () => {} }) {
  const fresh = { osm: path.join(dir, 'places.fresh'), overture: path.join(dir, 'overture.fresh') };
  for (const d of Object.values(fresh)) { await fsp.rm(d, { recursive: true, force: true }); await fsp.mkdir(d, { recursive: true }); }
  const counts = { osm: {}, overture: {} }; const bytes = { osm: 0, overture: 0 }; let done = 0;
  let hospitals = null;
  for (const f of manifest.files) {
    const gz = await fsp.readFile(path.join(from, f.name));
    if (sha256(gz) !== f.sha256) throw new Error(`${f.name} is not the file the list describes.`);
    const body = JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
    if (f.set === 'official') hospitals = body;
    else if (f.set === 'osm' || f.set === 'overture') {
      const items = inside ? body.items.filter((r) => inside(r.o, r.a)) : body.items;
      const text = JSON.stringify({ ...body, items });
      await fsp.writeFile(path.join(fresh[f.set], `${f.cat}.json`), text);
      counts[f.set][f.cat] = items.length; bytes[f.set] += Buffer.byteLength(text);
    }
    done += 1; onProgress({ readDone: done, readTotal: manifest.files.length });
  }
  const swap = async (name, src) => { const to = path.join(dir, name); const old = `${to}.old`; await fsp.rm(old, { recursive: true, force: true }); if (fs.existsSync(to)) await fsp.rename(to, old); await fsp.rename(src, to); await fsp.rm(old, { recursive: true, force: true }); };
  const sum = (o) => Object.values(o).reduce((a, n) => a + n, 0);
  const placesInfo = { regions: regionIds, date: manifest.osm.date, total: sum(counts.osm), counts: counts.osm, bytes: bytes.osm, how: 'central', built: manifest.built };
  await swap('places', fresh.osm);
  await fsp.writeFile(path.join(dir, 'places.json'), JSON.stringify(placesInfo));
  let overtureInfo = null;
  if (manifest.overture && Object.keys(counts.overture).length) {
    overtureInfo = { release: manifest.overture.release, regions: regionIds, date: manifest.overture.date, counts: counts.overture, total: sum(counts.overture), bytes: bytes.overture, sorted: manifest.overture.sorted || 2, sorting: manifest.overture.sorting, brands: manifest.overture.brands, how: 'central', built: manifest.built };
    await swap('overture', fresh.overture);
    await fsp.writeFile(path.join(dir, 'overture.json'), JSON.stringify(overtureInfo));
  } else await fsp.rm(fresh.overture, { recursive: true, force: true });
  if (hospitals && Array.isArray(hospitals.rows)) { await fsp.mkdir(path.join(dir, 'official'), { recursive: true }); await fsp.writeFile(path.join(dir, 'official', 'hospitals-us.json'), JSON.stringify(hospitals)); }
  return { places: placesInfo, overture: overtureInfo };
}

module.exports = { pack, install, unusable, sha256 };
