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

test('the key lists what is switched on, in the colours of the look, and road numbers are drawn as road signs', () => {
  const day = look.legend({ dark: false, off: [] });
  assert.deepEqual(day.map((k) => k.id), ['highway', 'major', 'street', 'track', 'rail', 'border', 'water', 'wood', 'park', 'building', 'interstate', 'usroute', 'stateroute']);
  // The colours are those the map is drawn in.
  const layers = look.layers(basemaps, { dark: false, off: [] });
  assert.equal(day.find((k) => k.id === 'highway').color, by(layers, 'roads_highway').paint['line-color']);
  assert.equal(day.find((k) => k.id === 'major').color, by(layers, 'roads_major').paint['line-color']);
  assert.equal(day.find((k) => k.id === 'track').color, by(layers, 'roads_other').paint['line-color']);
  assert.equal(day.find((k) => k.id === 'water').color, by(layers, 'water').paint['fill-color']);
  assert.equal(day.find((k) => k.id === 'rail').color, by(layers, 'roads_rail').paint['line-color']);
  assert.deepEqual([day.find((k) => k.id === 'track').draw, day.find((k) => k.id === 'water').draw, day.find((k) => k.id === 'street').edge !== null], ['dash', 'fill', true]);
  const night = look.legend({ dark: true, off: [] });
  assert.notEqual(night.find((k) => k.id === 'water').color, day.find((k) => k.id === 'water').color);
  // What is switched off is not in the key; highways and main roads have no switch and are always there.
  const some = look.legend({ dark: false, off: ['minor', 'water', 'roadnames', 'green'] }).map((k) => k.id);
  assert.deepEqual(some, ['highway', 'major', 'rail', 'border', 'building']);
  // Asked for every entry (for the pictures beside the switches), each switch that draws lines or colours has some.
  const every = look.legend({ dark: false, off: look.GROUPS.map((g) => g.id) }, true);
  assert.equal(every.length, 13);
  for (const g of ['green', 'water', 'buildings', 'minor', 'rail', 'borders', 'roadnames']) assert.ok(every.some((k) => k.group === g), g);
  // Road signs: an Interstate is red, white and blue with white figures; the rest are white with black figures.
  const sign = (id) => day.find((k) => k.id === id).sign;
  assert.deepEqual([sign('interstate').fill, sign('interstate').top, sign('interstate').text], ['#003f87', '#c8102e', '#ffffff']);
  assert.deepEqual([sign('usroute').fill, sign('usroute').text, sign('stateroute').fill], ['#ffffff', '#111111', '#ffffff']);
  for (const dark of [false, true]) {
    const shields = by(look.layers(basemaps, { dark, off: [] }), 'roads_shields');
    assert.equal(JSON.stringify(shields.layout['icon-image']).includes('wv-shield-'), true);
    assert.deepEqual(shields.paint['text-color'].slice(-3), ['i', '#ffffff', '#111111']);
    assert.deepEqual(spec.validateStyleMin(style([shields])).map((e) => e.message), [], 'the sign layer is a valid layer');
  }
});
