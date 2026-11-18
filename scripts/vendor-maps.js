'use strict';
// Copies the map libraries from node_modules into src/vendor, where the app loads them from.
// They are development dependencies: the installer ships the copies, not the packages.
// Run after changing the version of maplibre-gl, pmtiles or @protomaps/basemaps in package.json.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const copies = [
  ['maplibre-gl/dist/maplibre-gl-csp.js', 'maplibre/maplibre-gl-csp.js'],
  ['maplibre-gl/dist/maplibre-gl-csp-worker.js', 'maplibre/maplibre-gl-csp-worker.js'],
  ['maplibre-gl/dist/maplibre-gl.css', 'maplibre/maplibre-gl.css'],
  ['maplibre-gl/LICENSE.txt', 'maplibre/LICENSE.txt'],
  ['pmtiles/dist/pmtiles.js', 'pmtiles/pmtiles.js'],
  ['@protomaps/basemaps/dist/basemaps.js', 'basemaps/basemaps.js'],
];
for (const [from, to] of copies) {
  const dest = path.join(root, 'src', 'vendor', to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // The source maps are not shipped, so the lines that point at them are dropped.
  const text = fs.readFileSync(path.join(root, 'node_modules', from), 'utf8').replace(/\n\/[/*]# sourceMappingURL=.*$/gm, '');
  fs.writeFileSync(dest, text);
  console.log(`${to}: ${text.length} characters`);
}
