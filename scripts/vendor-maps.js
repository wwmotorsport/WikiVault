'use strict';
// Copies the map libraries from node_modules into src/vendor, where the app loads them from.
// They are development dependencies: the installer ships the copies, not the packages.
// Run after changing the version of maplibre-gl, pmtiles, @protomaps/basemaps or hyparquet in package.json.
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

// The Parquet reader (for Overture Maps files) is published as ES modules. The app's own code is CommonJS
// and has no bundler, so the reader is gathered into one CommonJS file here.
const esbuild = require('esbuild');
const parquet = path.join(root, 'src', 'vendor', 'parquet');
fs.mkdirSync(parquet, { recursive: true });
esbuild.buildSync({
  stdin: { contents: "export { parquetMetadataAsync, parquetRead } from 'hyparquet';", resolveDir: root },
  bundle: true, format: 'cjs', platform: 'node', target: 'node20', legalComments: 'none',
  banner: { js: `// hyparquet ${require(path.join(root, 'node_modules', 'hyparquet', 'package.json')).version}, MIT licence (see LICENSE beside this file). Gathered into one file by scripts/vendor-maps.js.` },
  outfile: path.join(parquet, 'hyparquet.cjs'),
});
fs.copyFileSync(path.join(root, 'node_modules', 'hyparquet', 'LICENSE'), path.join(parquet, 'LICENSE'));
console.log(`parquet/hyparquet.cjs: ${fs.statSync(path.join(parquet, 'hyparquet.cjs')).size} bytes`);
