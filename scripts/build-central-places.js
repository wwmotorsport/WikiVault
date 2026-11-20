'use strict';
// Builds the ready-made set of places that the app fetches (see src/core/central-places.js).
// Run by .github/workflows/places.yml each week; it can be run by hand the same way:
//   node scripts/build-central-places.js --work <folder to work in> --out <folder for the files> [--regions us48,canada]
// It uses the app's own code throughout: the places are exactly what the app would build on a user's computer.
const fs = require('node:fs');
const path = require('node:path');
const { MapsLibrary } = require('../src/core/maps-library');
const central = require('../src/core/central-places');
const pkg = require('../package.json');

const arg = (name, or = null) => { const i = process.argv.indexOf(name); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : or; };
const stamp = () => new Date().toISOString().slice(11, 19);

(async () => {
  const dir = path.resolve(arg('--work', 'places-work')); const out = path.resolve(arg('--out', 'places-out'));
  fs.mkdirSync(dir, { recursive: true });
  const lib = new MapsLibrary({ dir, agent: `Wikivault places build ${pkg.version} (github.com/wwmotorsport/WikiVault)`, log: (line) => console.log(`${stamp()} ${line}`) });
  await lib.init();
  const known = lib.registry.regions.map((r) => r.id).filter((id) => lib.registry.extracts && lib.registry.extracts.regions[id]);
  const regions = arg('--regions') ? arg('--regions').split(',').filter((id) => known.includes(id)) : known;
  if (!regions.length) throw new Error('No region to build.');
  console.log(`${stamp()} building the places of ${regions.join(', ')} with Wikivault ${pkg.version}`);

  // OpenStreetMap: every regional extract, read here. A server hiccup stops a run; what was read is kept, so try again.
  let last = 0; const tell = setInterval(() => { const j = lib.status().job; if (j && Date.now() - last > 60000) { last = Date.now(); console.log(`${stamp()} ... ${j.kind} ${j.stage || ''} ${j.done ?? ''}/${j.total ?? ''} found ${j.found ?? ''}`); } }, 5000);
  for (let attempt = 1; ; attempt++) {
    try { await lib.downloadPlaces(regions, { how: 'extract' }); break; } catch (err) {
      console.log(`${stamp()} places: attempt ${attempt} stopped: ${err.message}`);
      if (attempt >= 6) throw err;
      await new Promise((r) => setTimeout(r, 60000 * attempt));
    }
  }
  // Overture: the added places, sorted as they are fetched, and with them the hospital list.
  for (let attempt = 1; ; attempt++) {
    try { await lib.downloadOverture(regions, { kinds: ['places'], inline: true }); break; } catch (err) {
      console.log(`${stamp()} overture: attempt ${attempt} stopped: ${err.message}`);
      if (attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 60000 * attempt));
    }
  }
  clearInterval(tell);
  const st = lib.status();
  if (!st.places || st.places.partial) throw new Error('The places from OpenStreetMap did not come out whole.');
  if (st.places.total < (arg('--regions') ? 1 : 500000)) throw new Error(`Only ${st.places.total} places came out: something is wrong, and nothing is published.`);
  const m = central.pack({ dir, out, app: pkg.version, regions });
  console.log(`${stamp()} packed ${m.files.length} files, ${(m.bytes / 1e6).toFixed(1)} MB: ${m.osm.total} places from OpenStreetMap, ${m.overture ? m.overture.total : 0} from Overture Maps (${m.overture ? m.overture.release : 'none'}), hospital list ${m.hospitals ? m.hospitals.count : 'none'}`);
  if (m.overture && m.overture.sorting) console.log(`${stamp()} sorting: ${JSON.stringify(m.overture.sorting)}`);
  // A record for the repository (docs/PLACES-STATUS.md): what the last build held. The job commits it, which is also
  // the activity GitHub asks of a repository before it will go on running a schedule.
  const names = Object.fromEntries(lib.registry.categories.map((c) => [c.id, c.name]));
  const kinds = [...new Set([...Object.keys(m.osm.counts), ...Object.keys((m.overture && m.overture.counts) || {})])].sort((a, b) => (names[a] || a).localeCompare(names[b] || b));
  const s = (m.overture && m.overture.sorting) || {};
  fs.writeFileSync(path.join(out, 'places-status.md'), [
    '# The ready-made places: the last build', '',
    'Written by the weekly job (`.github/workflows/places.yml`). The app fetches these files from the release *places-data*.', '',
    `- Built: ${m.built.slice(0, 16).replace('T', ' ')} UTC, by Wikivault ${m.app}`,
    `- Regions: ${m.regions.join(', ')}`,
    `- To download: ${(m.bytes / 1e6).toFixed(1)} MB in ${m.files.length} files`,
    `- From OpenStreetMap: ${m.osm.total.toLocaleString('en-US')} places (data of ${String(m.osm.date).slice(0, 10)})`,
    `- From Overture Maps: ${m.overture ? `${m.overture.total.toLocaleString('en-US')} places (release ${m.overture.release})` : 'none'}`,
    `- Sorting of Overture's places: ${(s.kept || 0).toLocaleString('en-US')} kept, ${(s.moved || 0).toLocaleString('en-US')} moved to another kind, ${(s.lesser || 0).toLocaleString('en-US')} marked as a lesser sort, ${(s.out || 0).toLocaleString('en-US')} left out; settled by brand ${(s['by brand'] || 0).toLocaleString('en-US')}, by Overture's kind ${(s['by kind'] || 0).toLocaleString('en-US')}, by name ${(s['by name'] || 0).toLocaleString('en-US')}`,
    `- Brand index: ${m.overture && m.overture.brands ? `${m.overture.brands.version} (${m.overture.brands.from})` : 'none'}`,
    `- Hospital list: ${m.hospitals ? `${m.hospitals.count.toLocaleString('en-US')} hospitals` : 'not fetched'}`, '',
    '| Kind | OpenStreetMap | Overture Maps |', '|---|---:|---:|',
    ...kinds.map((k) => `| ${names[k] || k} | ${(m.osm.counts[k] || 0).toLocaleString('en-US')} | ${(((m.overture && m.overture.counts) || {})[k] || 0).toLocaleString('en-US')} |`), '',
  ].join('\n'));
})().catch((err) => { console.error(`FAILED: ${err.stack || err.message}`); process.exit(1); });
