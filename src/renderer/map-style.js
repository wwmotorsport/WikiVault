'use strict';
// The look of the map: colours for day and night, how heavy each kind of road is drawn, and which
// kinds of feature are shown. The layers come from the Protomaps basemap style and are adjusted here.
// Loaded by the window (as WikivaultMapStyle) and by the tests (as a module).
(function (root) {
  // A road atlas by day: highways orange, main roads amber, streets white with a firm edge,
  // tracks and paths brown and dashed, woodland clearly green, water clearly blue.
  const DAY = {
    background: '#dfe6ea', earth: '#f4f1e8', water: '#86c1e6',
    park_a: '#d9ecc8', park_b: '#a8d596', wood_a: '#cfe6c2', wood_b: '#8fc98a', scrub_a: '#e2ebcc', scrub_b: '#c1d79d',
    pedestrian: '#ece6d8', glacier: '#f3f8fb', sand: '#f1e7c0', beach: '#f3e6b3', hospital: '#f7dcdc', school: '#f3e8c9', industrial: '#e3dfe8',
    aerodrome: '#e3e1ee', runway: '#c9c6d6', zoo: '#d3e8d6', military: '#edd3d3', pier: '#d9d4c7', buildings: '#c7b29b',
    other: '#8a6b4d', minor_service: '#ffffff', minor_a: '#ffffff', minor_b: '#ffffff', link: '#f2a65e', major: '#f7c948', highway: '#e9763d',
    minor_service_casing: '#b3aca2', minor_casing: '#a39c92', link_casing: '#a85a1c', major_casing_early: '#b08a1c', major_casing_late: '#a67c12', highway_casing_early: '#a8441a', highway_casing_late: '#96390f',
    bridges_other: '#8a6b4d', bridges_minor: '#ffffff', bridges_link: '#f2a65e', bridges_major: '#f7c948', bridges_highway: '#e9763d',
    bridges_other_casing: '#6f6a62', bridges_minor_casing: '#857e75', bridges_link_casing: '#8c4a15', bridges_major_casing: '#8f6a0d', bridges_highway_casing: '#7d2f0b',
    tunnel_other: '#c4b3a1', tunnel_minor: '#f0f0f0', tunnel_link: '#f6cfa6', tunnel_major: '#f8e3a3', tunnel_highway: '#f2b89c',
    tunnel_other_casing: '#c9c4bb', tunnel_minor_casing: '#c9c4bb', tunnel_link_casing: '#c9c4bb', tunnel_major_casing: '#c9c4bb', tunnel_highway_casing: '#c9c4bb',
    railway: '#5d6468', boundaries: '#8a5aa0',
    roads_label_minor: '#4f4842', roads_label_minor_halo: '#ffffff', roads_label_major: '#3d3631', roads_label_major_halo: '#ffffff',
    ocean_label: '#2f5f8f', subplace_label: '#5e5e5e', subplace_label_halo: '#f4f1e8', city_label: '#1f1f1f', city_label_halo: '#f4f1e8',
    state_label: '#7a6a8a', state_label_halo: '#f4f1e8', country_label: '#5a4a6a', address_label: '#6b625c', address_label_halo: '#ffffff',
    landcover: { grassland: 'rgba(226, 239, 205, 1)', barren: 'rgba(240, 229, 205, 1)', urban_area: 'rgba(228, 224, 219, 1)', farmland: 'rgba(238, 240, 214, 1)', glacier: 'rgba(255, 255, 255, 1)', scrub: 'rgba(214, 228, 190, 1)', forest: 'rgba(170, 214, 160, 1)' },
  };
  // The same map for a dark room or a night drive: dark ground, roads that still stand apart.
  const NIGHT = {
    background: '#162433', earth: '#1c2026', water: '#12385c',
    park_a: '#1f2e22', park_b: '#24402a', wood_a: '#1c2d21', wood_b: '#214a2b', scrub_a: '#23301f', scrub_b: '#2c4424',
    pedestrian: '#2a2a26', glacier: '#46505a', sand: '#3a3626', beach: '#3a3626', hospital: '#3a2628', school: '#35301f', industrial: '#2a2a33',
    aerodrome: '#2a2c38', runway: '#4a4d5c', zoo: '#223a2c', military: '#3a2424', pier: '#33312c', buildings: '#343a42',
    other: '#8f7558', minor_service: '#6a727c', minor_a: '#6a727c', minor_b: '#7a838d', link: '#b9793d', major: '#c9a23a', highway: '#e0823f',
    minor_service_casing: '#0f1216', minor_casing: '#0f1216', link_casing: '#0f1216', major_casing_early: '#0f1216', major_casing_late: '#0f1216', highway_casing_early: '#0f1216', highway_casing_late: '#0f1216',
    bridges_other: '#8f7558', bridges_minor: '#7a838d', bridges_link: '#b9793d', bridges_major: '#c9a23a', bridges_highway: '#e0823f',
    bridges_other_casing: '#000000', bridges_minor_casing: '#000000', bridges_link_casing: '#000000', bridges_major_casing: '#000000', bridges_highway_casing: '#000000',
    tunnel_other: '#5a4c3c', tunnel_minor: '#4a5058', tunnel_link: '#7a5433', tunnel_major: '#7d6a34', tunnel_highway: '#8a5a36',
    tunnel_other_casing: '#0f1216', tunnel_minor_casing: '#0f1216', tunnel_link_casing: '#0f1216', tunnel_major_casing: '#0f1216', tunnel_highway_casing: '#0f1216',
    railway: '#8c949c', boundaries: '#9a7fb5',
    roads_label_minor: '#c5cad0', roads_label_minor_halo: '#12151a', roads_label_major: '#e0e4e8', roads_label_major_halo: '#12151a',
    ocean_label: '#7fb0dc', subplace_label: '#b8bec5', subplace_label_halo: '#12151a', city_label: '#f0f2f4', city_label_halo: '#12151a',
    state_label: '#a593bd', state_label_halo: '#12151a', country_label: '#c0b2d4', address_label: '#aab0b6', address_label_halo: '#12151a',
    landcover: { grassland: 'rgba(36, 50, 34, 1)', barren: 'rgba(52, 46, 34, 1)', urban_area: 'rgba(40, 42, 48, 1)', farmland: 'rgba(42, 46, 32, 1)', glacier: 'rgba(70, 80, 90, 1)', scrub: 'rgba(38, 52, 32, 1)', forest: 'rgba(30, 64, 40, 1)' },
  };

  /** Kinds of feature that can be switched off. A layer in two groups is shown only when both are on. */
  const GROUPS = [
    { id: 'green', name: 'Woodland, parks and land use', test: (id) => id === 'landcover' || (id.startsWith('landuse_') && !/runway|pier|pedestrian/.test(id)) },
    { id: 'water', name: 'Water', test: (id) => id.startsWith('water') },
    { id: 'buildings', name: 'Buildings', test: (id) => id === 'buildings' },
    { id: 'minor', name: 'Streets, tracks and paths', test: (id) => /^roads_.*(minor|other|link|oneway)/.test(id) },
    { id: 'rail', name: 'Railways', test: (id) => id === 'roads_rail' },
    { id: 'borders', name: 'Borders', test: (id) => id.startsWith('boundaries') },
    { id: 'roadnames', name: 'Road names and numbers', test: (id) => /^roads_(labels|shields)/.test(id) },
    { id: 'placenames', name: 'Names of towns and places', test: (id) => /^places_|^earth_label|^address_label/.test(id) },
    { id: 'pois', name: 'Small symbols for shops and sights', test: (id) => id === 'pois' },
  ];

  // How much heavier than the stock style each kind of road is drawn, at every zoom.
  const WEIGHT = [[/highway/, 1.7], [/major/, 1.5], [/link/, 1.4], [/minor/, 1.3], [/rail/, 1.6], [/other|pier/, 1.25]];
  const round = (v) => Math.round(v * 100) / 100;
  function scaled(expr, k) {
    if (typeof expr === 'number') return round(expr * k);
    if (!Array.isArray(expr) || expr[0] !== 'interpolate') return expr;
    const out = expr.slice(0, 3);
    for (let i = 3; i + 1 < expr.length; i += 2) out.push(expr[i], typeof expr[i + 1] === 'number' ? round(expr[i + 1] * k) : expr[i + 1]);
    return out;
  }

  const clean = (look) => ({ dark: Boolean(look && look.dark), off: Array.isArray(look && look.off) ? look.off.filter((g) => GROUPS.some((x) => x.id === g)) : [] });
  const shown = (layerId, off) => !GROUPS.some((g) => off.includes(g.id) && g.test(layerId));

  /** The basemap's layers for a look: { dark, off: [group ids] }. `basemaps` is the Protomaps basemaps library. */
  function layers(basemaps, look) {
    const l = clean(look);
    const base = basemaps.namedFlavor(l.dark ? 'dark' : 'light');
    const mine = l.dark ? NIGHT : DAY;
    const flavor = { ...base, ...mine, landcover: { ...base.landcover, ...mine.landcover } };
    return basemaps.layers('protomaps', flavor, { lang: 'en' }).map((layer) => {
      const out = { ...layer, paint: { ...(layer.paint || {}) }, layout: { ...(layer.layout || {}), visibility: shown(layer.id, l.off) ? 'visible' : 'none' } };
      if (layer.type === 'line' && layer.id.startsWith('roads_')) {
        const k = (WEIGHT.find(([re]) => re.test(layer.id)) || [null, 1])[1];
        const casing = /_casing/.test(layer.id);
        if (casing) { if (out.paint['line-gap-width'] != null) out.paint['line-gap-width'] = scaled(out.paint['line-gap-width'], k); if (out.paint['line-width'] != null) out.paint['line-width'] = scaled(out.paint['line-width'], 1.2); } else if (out.paint['line-width'] != null) out.paint['line-width'] = scaled(out.paint['line-width'], k);
        // Interstates stay visible when the whole country is on screen.
        if (layer.id === 'roads_highway' && Array.isArray(out.paint['line-width']) && out.paint['line-width'][4] === 0) out.paint['line-width'][4] = 0.6;
        // Tracks and paths are dashed, so they are not taken for streets.
        if (/^roads_(bridges_|tunnels_)?other$/.test(layer.id)) out.paint['line-dasharray'] = [3, 1.5];
        if (layer.id === 'roads_rail') out.paint['line-opacity'] = 0.9;
      }
      if (layer.id === 'buildings') out.paint['fill-opacity'] = l.dark ? 0.9 : 0.8;
      if (layer.id === 'boundaries') out.paint['line-width'] = 1;
      if (layer.id === 'boundaries_country') out.paint['line-width'] = 1.6;
      if (/^roads_labels/.test(layer.id)) out.paint['text-halo-width'] = 1.6;
      return out;
    });
  }

  const api = { GROUPS: GROUPS.map(({ id, name }) => ({ id, name })), layers, shown, clean, sprite: (look) => (clean(look).dark ? 'dark' : 'light'), background: (look) => (clean(look).dark ? NIGHT.earth : DAY.earth) };
  root.WikivaultMapStyle = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
