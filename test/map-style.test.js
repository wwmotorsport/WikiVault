'use strict';
// The look of the map: both looks are valid MapLibre styles, roads are told apart, kinds can be switched off.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const spec = require('@maplibre/maplibre-gl-style-spec');
const look = require('../src/renderer/map-style');

// The copy of the basemap library that ships with the app, loaded the way the window loads it.
const sandbox = {};
vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '..', 'src', 'vendor', 'basemaps', 'basemaps.js'), 'utf8')}\nthis.basemaps = basemaps;`, sandbox);
const { basemaps } = sandbox;
const style = (layers) => ({ version: 8, glyphs: 'http://127.0.0.1:1/m/fonts/{fontstack}/{range}.pbf', sprite: 'http://127.0.0.1:1/m/sprites/light', sources: { protomaps: { type: 'vector', url: 'pmtiles://http://127.0.0.1:1/m/map.pmtiles' } }, layers: JSON.parse(JSON.stringify(layers)) });
const by = (layers, id) => layers.find((l) => l.id === id);
const widthAt = (layer, zoom) => { const w = layer.paint['line-width']; for (let i = 3; i < w.length; i += 2) if (w[i] === zoom) return w[i + 1]; return null; };

test('the day and night looks are valid styles, and differ', () => {
  const day = look.layers(basemaps, { dark: false, off: [] });
  const night = look.layers(basemaps, { dark: true, off: [] });
  for (const [name, layers] of [['day', day], ['night', night]]) assert.deepEqual(spec.validateStyleMin(style(layers)).map((e) => e.message), [], name);
  assert.equal(day.length, night.length);
  assert.notEqual(by(day, 'earth').paint['fill-color'], by(night, 'earth').paint['fill-color']);
  assert.deepEqual([look.sprite({ dark: false }), look.sprite({ dark: true })], ['light', 'dark']);
  for (const s of ['light', 'dark']) for (const ext of ['.json', '.png', '@2x.json', '@2x.png']) assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets', 'maps', 'sprites', `${s}${ext}`)), `${s}${ext}`);
});

test('kinds of road are told apart by colour and by weight, at every zoom they are drawn', () => {
  for (const dark of [false, true]) {
    const layers = look.layers(basemaps, { dark, off: [] });
    const colours = ['roads_highway', 'roads_major', 'roads_other'].map((id) => by(layers, id).paint['line-color']);
    assert.equal(new Set([...colours, by(layers, 'earth').paint['fill-color'], by(layers, 'water').paint['fill-color']]).size, 5, colours.join());
    assert.ok(widthAt(by(layers, 'roads_highway'), 15) > widthAt(by(layers, 'roads_major'), 15) && widthAt(by(layers, 'roads_major'), 15) > widthAt(by(layers, 'roads_minor'), 15));
    assert.ok(widthAt(by(layers, 'roads_highway'), 18) > widthAt(by(layers, 'roads_highway'), 12), 'heavier when zoomed in');
    assert.ok(widthAt(by(layers, 'roads_highway'), 3) > 0, 'highways show with the whole country on screen');
    assert.deepEqual(by(layers, 'roads_other').paint['line-dasharray'], [3, 1.5], 'tracks and paths are dashed');
    assert.notEqual(by(layers, 'roads_minor_casing').paint['line-color'], by(layers, 'earth').paint['fill-color'], 'streets have an edge that shows');
  }
  // Heavier than the style it starts from.
  const stock = basemaps.layers('protomaps', basemaps.namedFlavor('light'), { lang: 'en' });
  const mine = look.layers(basemaps, {});
  for (const id of ['roads_highway', 'roads_major', 'roads_minor']) assert.ok(widthAt(by(mine, id), 15) > widthAt(by(stock, id), 15), id);
});

test('each kind of feature can be switched off, and nothing else goes with it', () => {
  const all = look.layers(basemaps, {});
  assert.ok(all.every((l) => l.layout.visibility === 'visible'));
  assert.deepEqual(look.GROUPS.map((g) => g.id), ['green', 'water', 'buildings', 'minor', 'rail', 'borders', 'roadnames', 'placenames', 'pois']);
  for (const g of look.GROUPS) {
    const hidden = look.layers(basemaps, { off: [g.id] }).filter((l) => l.layout.visibility === 'none').map((l) => l.id);
    assert.ok(hidden.length >= 1, `${g.id} hides something`);
    for (const id of ['background', 'earth', 'roads_highway', 'roads_major']) assert.ok(!hidden.includes(id), `${g.id} leaves ${id}`);
  }
  const off = (g) => look.layers(basemaps, { off: [g] }).filter((l) => l.layout.visibility === 'none').map((l) => l.id);
  assert.deepEqual([...off('buildings')], ['buildings']); // spread: the layers come from another realm
  assert.ok(off('minor').includes('roads_minor') && off('minor').includes('roads_other') && off('minor').includes('roads_labels_minor'));
  assert.ok(off('green').includes('landcover') && off('green').includes('landuse_park') && !off('green').includes('landuse_runway'));
  assert.ok(off('water').includes('water') && off('water').includes('water_river'));
  assert.deepEqual(look.clean({ dark: 1, off: ['water', 'nonsense'] }), { dark: true, off: ['water'] });
  assert.deepEqual(look.clean(null), { dark: false, off: [] });
});
