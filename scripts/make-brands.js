'use strict';
// Cuts the Name Suggestion Index down to assets/maps/brands.json, the copy packed with the app.
// Usage: node scripts/make-brands.js <path to name-suggestion-index/dist/json/nsi.json> [version]
const fs = require('node:fs');
const path = require('node:path');
const { reduceBrands } = require('../src/core/place-sort');

const [src, version = ''] = process.argv.slice(2);
if (!src) { console.error('Give the path of nsi.json (from the npm package name-suggestion-index).'); process.exit(1); }
const cut = reduceBrands(JSON.parse(fs.readFileSync(src, 'utf8')), version);
cut.credit = 'Brand names and tags from the Name Suggestion Index, nsi.guide (BSD-3-Clause).';
const out = path.join(__dirname, '..', 'assets', 'maps', 'brands.json');
fs.writeFileSync(out, JSON.stringify(cut));
console.log(`${Object.keys(cut.names).length} names, ${Object.keys(cut.ids).length} ids, ${fs.statSync(out).size} bytes -> ${out}`);
