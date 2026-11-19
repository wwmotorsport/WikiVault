'use strict';
// Places from a regional OpenStreetMap extract: reads the file on this computer, keeps what belongs to one
// of the kinds of place, and writes the small records the places code uses. Plain work on files.

const fsp = require('node:fs/promises');
const osm = require('./osm-pbf');
const places = require('./places');

/**
 * @param {{ file: string, out: string, categories: Array, rings: Array }} o
 * @param {(p: { stage: string, done: number, total: number }) => void} [onProgress]
 * @returns {Promise<{ count: number, nodes: number, ways: number, relations: number, unplaced: number, ms: number }>}
 */
async function run({ file, out, categories, rings }, onProgress = () => {}) {
  const started = Date.now();
  const filters = [];
  for (const c of categories) for (const f of c.filters) filters.push(f);
  const recs = []; const seen = new Set();
  const stats = osm.extract(file, {
    filters,
    onProgress,
    onElement: (el) => {
      const rec = places.recordOf(categories, el);
      if (!rec || seen.has(rec.i) || !places.inRings(rings, rec.o, rec.a)) return;
      seen.add(rec.i);
      recs.push(rec);
    },
  });
  await fsp.writeFile(out, JSON.stringify(recs));
  return { count: recs.length, nodes: stats.nodes, ways: stats.ways, relations: stats.relations, unplaced: stats.unplaced, ms: Date.now() - started };
}

module.exports = { run };
