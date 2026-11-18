'use strict';
// A PMTiles file made for the tests, and a small web server that serves parts of files.
const http = require('node:http');
const zlib = require('node:zlib');
const pm = require('../src/core/pmtiles');

/**
 * Build an archive for zooms 0..maxZoom. `tileOf(z, x, y)` gives a tile's bytes (already as stored),
 * or null for no tile. Equal tiles are stored once; equal neighbours become one run.
 */
function makeArchive({ maxZoom, tileOf, metadata = { name: 'test', vector_layers: [] }, tileType = 1, tileCompression = pm.GZIP }) {
  const ids = []; const runs = []; const lengths = []; const offsets = [];
  const data = []; const seen = new Map();
  let at = 0; let addressed = 0;
  for (let z = 0; z <= maxZoom; z++) {
    const n = 2 ** z;
    const row = [];
    for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) { const t = tileOf(z, x, y); if (t) row.push([pm.zxyToId(z, x, y), t]); }
    row.sort((a, b) => a[0] - b[0]);
    for (const [id, t] of row) {
      const key = t.toString('latin1');
      if (!seen.has(key)) { seen.set(key, at); data.push(t); at += t.length; }
      const offset = seen.get(key);
      const last = ids.length - 1;
      addressed += 1;
      if (last >= 0 && offsets[last] === offset && ids[last] + runs[last] === id) { runs[last] += 1; continue; }
      ids.push(id); runs.push(1); lengths.push(t.length); offsets.push(offset);
    }
  }
  const dir = { n: ids.length, ids: Float64Array.from(ids), runs: Uint32Array.from(runs), lengths: Uint32Array.from(lengths), offsets: Float64Array.from(offsets) };
  const { root, leaves } = pm.buildDirectories(dir);
  const meta = zlib.gzipSync(Buffer.from(JSON.stringify(metadata)));
  const rootOffset = pm.HEADER_BYTES; const metadataOffset = rootOffset + root.length; const leafOffset = metadataOffset + meta.length; const dataOffset = leafOffset + leaves.length;
  const head = pm.serializeHeader({ rootOffset, rootLength: root.length, metadataOffset, metadataLength: meta.length, leafOffset, leafLength: leaves.length, dataOffset, dataLength: at,
    addressedTiles: addressed, tileEntries: dir.n, tileContents: data.length, clustered: true, internalCompression: pm.GZIP, tileCompression, tileType, minZoom: 0, maxZoom, bounds: [-180, -85, 180, 85], centerZoom: 0, center: [0, 0] });
  return { bytes: Buffer.concat([head, root, meta, leaves, ...data]), leaves: leaves.length, entries: dir.n };
}

/** Serve named buffers, honouring Range. `server.requests` lists what was asked for; `server.fail(n)` makes the next n requests fail. */
async function serve(files) {
  let failing = 0;
  const requests = [];
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0].slice(1));
    const body = typeof files[name] === 'function' ? files[name](req) : files[name];
    requests.push({ name, range: req.headers.range || null });
    if (failing > 0) { failing -= 1; req.socket.destroy(); return; }
    if (!body) { res.writeHead(404); res.end(); return; }
    const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
    if (!m) { res.writeHead(200, { 'content-length': body.length, etag: '"v1"' }); res.end(body); return; }
    const a = Number(m[1]); const b = Math.min(Number(m[2]), body.length - 1);
    res.writeHead(206, { 'content-length': b - a + 1, 'content-range': `bytes ${a}-${b}/${body.length}`, etag: '"v1"' });
    res.end(body.subarray(a, b + 1));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { origin: `http://127.0.0.1:${server.address().port}`, requests, fail: (n) => { failing = n; }, close: () => new Promise((r) => server.close(r)) };
}

module.exports = { makeArchive, serve };
