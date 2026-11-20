'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sortPlace, sorted, keepsOsm, isHospitalName } = require('../src/core/place-sort');
const { MapsLibrary } = require('../src/core/maps-library');
const mapAsk = require('../src/core/map-ask');

const where = (cat, name) => { const s = sortPlace(cat, name); return !s ? 'out' : `${s.c}${s.less ? ' (lesser)' : ''}`; };

test('hospitals: only places named as hospitals are hospitals; offices and parts of hospitals are clinics', () => {
  for (const n of ['Mercy General Hospital', 'Riverside Medical Center', 'Hôpital Général de Montréal', 'Hospital General Leon', 'Clínica y Hospital Santa Julia', 'Northside Emergency Room', "St. Mary's Children's Hospital"]) { assert.equal(isHospitalName(n), true, n); assert.equal(where('hospital', n), 'hospital', n); }
  for (const n of ['Lakeside Family Medicine', 'Riverside Medical Center Suite 200', 'St. Luke Hospital Sleep Center', 'Oak Animal Hospital', 'Valley Rehabilitation Hospital', 'County Hospital Gift Shop', 'Pine Health Primary Care', 'Harbor Heart & Vascular Institute', 'Pine Health', '']) { assert.equal(isHospitalName(n), false, n); assert.equal(where('hospital', n), 'clinic', n); }
});

test('each kind keeps what belongs, moves what belongs elsewhere, marks the lesser sort and leaves the rest out', () => {
  const cases = [
    ['propane', 'Blue Rhino Propane Exchange', 'propane (lesser)'], ['propane', 'Suburban Propane', 'propane'], ['propane', 'Hill Country Gas Co', 'propane'],
    ['veterinary', 'PetVet Vaccination Clinic', 'veterinary (lesser)'], ['veterinary', 'Frisco Animal Hospital', 'veterinary'], ['veterinary', 'Star Grooming on Fifth', 'out'], ['veterinary', 'RockyVet and Grooming', 'veterinary'], ['veterinary', 'Veterinaria y Estética Canina', 'veterinary'],
    ['fuel', 'CAT Scale', 'out'], ['fuel', 'Shell', 'fuel'], ['fuel', 'Marathon Gas', 'fuel'],
    ['hardware', "Brodie's Top Roofing", 'out'], ['hardware', 'Hauser Homes', 'out'], ['hardware', 'Fossum Electric Ltd', 'out'], ['hardware', 'Ace Hardware', 'hardware'], ['hardware', 'Builders FirstSource', 'hardware'], ['hardware', 'Valley Electrical Supply', 'hardware'], ['hardware', 'Sherwin-Williams', 'hardware'], ['hardware', 'Ferretería Altamirano', 'hardware'], ['hardware', "Lowe's Home Improvement", 'hardware'], ['hardware', 'Madereria El Salto', 'hardware'], ['hardware', 'Hinada Water Treatment Tech Co.', 'out'], ['hardware', 'Greenscape', 'out'], ['hardware', 'Stone Creek Custom Homes', 'out'], ['hardware', 'Leffert Stone Company', 'hardware'], ['hardware', 'Roofing Supply Group', 'hardware'], ['hardware', 'CEMEX', 'hardware'],
    ['outdoor', "Perry's Gun Shop", 'weapons'], ['outdoor', 'Old Glory Firearms', 'weapons'], ['outdoor', 'Red Barn Bait & Guns', 'weapons'], ['outdoor', 'Fairway Golf & Driving Range', 'out'], ['outdoor', 'Lakeside Bait & Tackle', 'outdoor'], ['outdoor', "Dick's Sporting Goods", 'outdoor'], ['outdoor', 'lululemon', 'out'], ['outdoor', "Leslie's Pool Supplies", 'out'], ['outdoor', "Smitty's Bike Shop", 'outdoor (lesser)'], ['outdoor', 'Mt Rogers Outfitters', 'outdoor'], ['outdoor', 'Uncle Sam\'s Army and Navy', 'outdoor'], ['outdoor', 'Zumiez', 'out'], ['outdoor', 'Champs Sports', 'out'], ['outdoor', 'Play It Again Sports', 'outdoor'], ['outdoor', 'The North Face', 'outdoor'], ['outdoor', 'Havana Social Club', 'out'], ['outdoor', 'Socktips', 'out'], ['outdoor', 'Outdoor Power Equipment', 'out'], ['outdoor', 'Islamorada Fishing Charter', 'out'],
    ['farm_supply', 'Metrolina Greenhouses', 'out'], ['farm_supply', 'Tractor Supply Co.', 'farm_supply'], ['farm_supply', 'Dallas Feed, Seed & Oil', 'farm_supply'], ['farm_supply', 'Greenhouse & Farm Supply', 'farm_supply'],
    ['department', 'Aldi', 'supermarket'], ['department', 'Save A Lot', 'supermarket'], ['department', 'Dollar General', 'department'], ['department', 'DG Market', 'supermarket'], ['department', 'Dollar General Market', 'department'], ['department', 'BanCoppel', 'out'], ['department', 'Walmart Supercenter', 'department'],
    ['supermarket', 'Walmart Grocery Pickup and Delivery', 'out'], ['supermarket', "Fry's Fuel Center", 'fuel'], ['supermarket', 'H-E-B Fuel', 'fuel'], ['supermarket', 'Body Fuel Organics', 'supermarket'], ['supermarket', 'Tacos Chava', 'out'], ['supermarket', 'Jerusalem Bakery & Grocery', 'supermarket'], ['supermarket', 'Kroger', 'supermarket'], ['supermarket', 'Abarrotes Lourdes', 'supermarket'],
    ['airfield', 'Gate B38', 'out'], ['airfield', 'Concourse A', 'out'], ['airfield', 'United Airlines', 'out'], ['airfield', 'Denver International Airport', 'airfield'], ['airfield', 'Moraine Airpark', 'airfield'], ['airfield', 'Terminal 1, Example International Airport', 'airfield'], ['airfield', 'Signature Aviation', 'airfield'],
    ['military', 'US Army Recruiting', 'out'], ['military', 'Armed Forces Career Center', 'out'], ['military', 'American Legion Post 1461', 'out'], ['military', 'Army National Guard Armory', 'military'], ['military', 'Fort Example', 'military'],
    ['campsite', 'Shady Oaks Mobile Home Park', 'out'], ['campsite', 'Shady Oaks RV Park', 'campsite'], ['campsite', 'Our Kids Day Camp', 'out'], ['campsite', 'Lakeside Campground', 'campsite'], ['campsite', 'Pines Mobile Home & RV Park', 'campsite'],
    ['fire', 'Osburn Police Department', 'police'], ['fire', 'Union Beach Fire Co. #1', 'fire'], ['fire', 'Peerless Tires', 'out'], ['fire', 'Pacific Coastal Fire Protection Inc.', 'out'], ['fire', 'South Madison County Fire Protection District', 'fire'], ['fire', 'Pelham Professional Firefighters Local 2546', 'out'], ['fire', 'Clinton Fire Department', 'fire'],
    ['police', 'Bryant Fire Department', 'fire'], ['police', 'Union County Sheriff', 'police'], ['police', 'Union City Police Department', 'police'], ['police', 'Fraternal Order of Police Lodge 20', 'out'], ['police', 'Peel Regional Police Association', 'out'], ['police', 'Department of Public Safety Fire Marshal', 'police'], ['police', 'Royal Canadian Mounted Police', 'police'],
    ['rest_area', 'Chevron Commercial Cardlock', 'fuel (lesser)'], ['rest_area', "Love's Travel Stop", 'rest_area'], ['rest_area', 'TA Travel Center', 'rest_area'], ['rest_area', 'Minnesota Welcome Center', 'rest_area'],
    ['pharmacy', "Carmichael's Medical Supply", 'medical_supply'], ['pharmacy', 'Main Street Pharmacy & Medical Supply', 'pharmacy'], ['pharmacy', 'CVS Pharmacy', 'pharmacy'], ['pharmacy', 'Farmacias Similares', 'pharmacy'],
    ['townhall', 'City Hall', 'townhall'], ['food_bank', 'Community Food Pantry', 'food_bank'],
  ];
  for (const [cat, name, want] of cases) assert.equal(where(cat, name), want, `${cat}: ${name}`);
});

test('OpenStreetMap is taken as it is, but for shoe, team and golf shops among its sports shops', () => {
  for (const n of ['Finish Line', 'Champs Sports', 'JD Sports', 'Golf Galaxy', 'Nike Factory Store']) assert.equal(keepsOsm('outdoor', n), false, n);
  for (const n of ["Dick's Sporting Goods", 'REI', 'Academy Sports + Outdoors', 'Bass Pro Shops', 'Some Shop', 'Golf & Guns', '']) assert.equal(keepsOsm('outdoor', n), true, n);
  assert.equal(keepsOsm('hospital', 'Golf Clinic'), true);
});

test('a kind is read from its own list and from the lists its places were fetched under', () => {
  const lists = {
    hospital: [{ i: 'ov1', n: 'Riverside Medical Center' }, { i: 'ov2', n: 'Lakeside Family Medicine' }],
    clinic: [{ i: 'ov3', n: 'Elm Urgent Care' }],
    outdoor: [{ i: 'ov4', n: "Perry's Gun Shop" }, { i: 'ov5', n: 'Lakeside Bait & Tackle' }, { i: 'ov6', n: "Smitty's Bike Shop" }, { i: 'ov7', n: 'lululemon' }],
    weapons: [{ i: 'ov8', n: 'Grimes Gunsmithing' }],
    propane: [{ i: 'ov9', n: 'Blue Rhino Propane Exchange', p: '555' }],
  };
  const read = (k) => lists[k] || [];
  assert.deepEqual(sorted('hospital', read).map((r) => r.n), ['Riverside Medical Center']);
  assert.deepEqual(sorted('clinic', read).map((r) => r.n), ['Elm Urgent Care', 'Lakeside Family Medicine']);
  assert.deepEqual(sorted('weapons', read).map((r) => r.n), ['Grimes Gunsmithing', "Perry's Gun Shop"]);
  assert.deepEqual(sorted('outdoor', read).map((r) => `${r.n}${r.less ? '*' : ''}${r.x ? `:${r.x.kind}` : ''}`), ['Lakeside Bait & Tackle', "Smitty's Bike Shop*:Bicycle shop"]);
  assert.deepEqual(sorted('propane', read), [{ i: 'ov9', n: 'Blue Rhino Propane Exchange', p: '555', x: { kind: 'Cylinder exchange at a shop' }, less: true }]);
  assert.equal(lists.propane[0].less, undefined, 'the fetched list is not changed');
});

test('the library lists the sorted places: a hospital search finds the hospital, and the offices are with the clinics', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-sort-'));
  try {
    fs.mkdirSync(path.join(dir, 'overture'), { recursive: true });
    const rec = (i, n, a) => ({ i: `ov${i}`, n, a, o: -80.8, d: '', s: 'ov' });
    const put = (kind, items) => fs.writeFileSync(path.join(dir, 'overture', `${kind}.json`), JSON.stringify({ v: 1, items }));
    put('hospital', [rec(1, 'Lakeside Family Medicine', 35.21), rec(2, 'Pine Health Physical Therapy', 35.22), rec(3, 'Riverside Medical Center', 35.30), rec(4, 'Oak Animal Hospital', 35.23)]);
    put('clinic', [rec(5, 'Elm Urgent Care', 35.24)]);
    put('outdoor', [rec(6, "Perry's Gun Shop", 35.25), rec(7, 'Lakeside Bait & Tackle', 35.26)]);
    fs.writeFileSync(path.join(dir, 'overture.json'), JSON.stringify({ release: 'test', regions: ['east'], date: new Date().toISOString(), total: 7, counts: { hospital: 4, clinic: 1, outdoor: 2 }, bytes: 1 }));
    const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'maps', 'registry.json'), 'utf8'));
    const lib = new MapsLibrary({ dir, registry });
    await lib.init();
    const names = (cat) => lib.search({ categories: [cat], near: [-80.8, 35.2], limit: 10 }).hits.map((h) => `${h.n}:${h.c}`);
    assert.deepEqual(names('hospital'), ['Riverside Medical Center:hospital']);
    assert.deepEqual(names('clinic'), ['Lakeside Family Medicine:clinic', 'Pine Health Physical Therapy:clinic', 'Oak Animal Hospital:clinic', 'Elm Urgent Care:clinic']);
    assert.deepEqual(names('weapons'), ["Perry's Gun Shop:weapons"]);
    assert.deepEqual(names('outdoor'), ['Lakeside Bait & Tackle:outdoor']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Ask: places of a lesser sort do not fill the list of the nearest; the nearest of the full sort are listed with them', () => {
  const home = { lat: 35.2, lon: -80.8, label: 'Home', own: true };
  const cages = Array.from({ length: 30 }, (_, k) => ({ i: `ov${k}`, n: 'Blue Rhino Propane Exchange', a: 35.2 + (k + 1) * 0.002, o: -80.8, c: 'propane', kind: 'Propane', s: 'ov', less: true, x: { kind: 'Cylinder exchange at a shop' } }));
  const yards = [{ i: 'n1', n: 'Suburban Propane', a: 35.5, o: -80.8, c: 'propane', kind: 'Propane' }, { i: 'n2', n: 'Hill Gas Co', a: 35.6, o: -80.8, c: 'propane', kind: 'Propane' }, { i: 'n3', n: 'Valley Propane', a: 35.7, o: -80.8, c: 'propane', kind: 'Propane' }, { i: 'n4', n: 'Far Propane', a: 35.9, o: -80.8, c: 'propane', kind: 'Propane' }];
  const km = (h) => Math.hypot((h.a - home.lat) * 111, (h.o - home.lon) * 91);
  const ctx = {
    saved: (q) => (/^home$/i.test(q) ? [home] : []), contacts: () => [], search: () => [], gps: () => null, kinds: [{ id: 'propane', name: 'Propane' }],
    nearby: ({ limit }) => cages.concat(yards).map((h) => ({ ...h, km: Math.round(km(h) * 10) / 10 })).sort((a, b) => a.km - b.km).slice(0, limit),
  };
  const plan = mapAsk.plan(mapAsk.parseNear('list propane suppliers near home'), ctx);
  assert.equal(plan.kind, 'near'); assert.equal(plan.hits.length, 10);
  assert.deepEqual(plan.hits.filter((h) => !h.less).map((h) => h.n), ['Suburban Propane', 'Hill Gas Co', 'Valley Propane']);
  assert.equal(plan.hits.filter((h) => h.less).length, 7);
  assert.ok(plan.hits.every((h, k, all) => !k || all[k - 1].km <= h.km), 'still nearest first');
  assert.match(plan.notes.join(' '), /lesser sort \(cylinder exchange at a shop\), so the nearest 3 of the full sort are listed/);
  // With enough of the full sort among the nearest already, nothing changes.
  const mixed = { ...ctx, nearby: ({ limit }) => yards.map((h, k) => ({ ...h, a: 35.2 + (k + 1) * 0.001 })).concat(cages).map((h) => ({ ...h, km: Math.round(km(h) * 100) / 100 })).sort((a, b) => a.km - b.km).slice(0, limit) };
  const plain = mapAsk.plan(mapAsk.parseNear('list propane suppliers near home'), mixed);
  assert.equal(plain.hits.filter((h) => !h.less).length, 4); assert.equal(plain.notes.length, 0);
  // Asked for the one nearest, five are listed: two of the lesser sort and the three nearest of the full sort.
  const one = mapAsk.plan(mapAsk.parseNear('where can I get propane near home'), ctx);
  assert.deepEqual(one.hits.map((h) => (h.less ? 'cage' : h.n)), ['cage', 'cage', 'Suburban Propane', 'Hill Gas Co', 'Valley Propane']);
});

test('the brand index: cut down, and what a brand settles', () => {
  const { reduceBrands, byBrand, settle } = require('../src/core/place-sort');
  const nsi = { nsi: {
    'brands/shop/supermarket': { items: [{ displayName: 'Aldi', locationSet: { include: ['001'] }, tags: { name: 'Aldi', brand: 'Aldi', 'brand:wikidata': 'Q125054' }, matchNames: ['aldi sud'] }, { displayName: 'Mercadona', locationSet: { include: ['es'] }, tags: { name: 'Mercadona' } }] },
    'brands/amenity/weighbridge': { items: [{ displayName: 'CAT Scale', locationSet: { include: ['us', 'ca'] }, tags: { name: 'CAT Scale' } }] },
    'brands/shop/convenience': { items: [{ displayName: 'Quik Stop', locationSet: { include: ['us-ca.geojson'] }, tags: { name: 'Quik Stop' } }] },
    'brands/amenity/fuel': { items: [{ displayName: 'Quik Stop', locationSet: { include: ['us'] }, tags: { name: 'Quik Stop' } }, { displayName: 'Puma', locationSet: { include: ['mx'] }, tags: { name: 'Puma' } }] },
    'brands/shop/clothes': { items: [{ displayName: 'Summit Wear', locationSet: { include: ['001'] }, tags: { name: 'Summit Wear' } }, { displayName: 'Peak Outfitters', locationSet: { include: ['001'] }, tags: { name: 'Peak Outfitters' } }] },
    'brands/amenity/fast_food': { items: [{ displayName: 'Subz', locationSet: { include: ['us'] }, tags: { name: 'Subz' } }] },
    'operators/amenity/police': { items: [{ displayName: 'Police', locationSet: { include: ['001'] }, tags: {} }] },
  } };
  const b = reduceBrands(nsi, 'test');
  assert.deepEqual([b.version, b.names.aldi, b.names['aldi sud'], b.ids.Q125054, b.names.mercadona, b.names.police], ['test', ['shop=supermarket'], ['shop=supermarket'], ['shop=supermarket'], undefined, undefined]);
  assert.deepEqual(b.names['quik stop'], ['shop=convenience', 'amenity=fuel']);
  assert.equal(byBrand('supermarket', 'ALDI', b), 'keep');
  assert.deepEqual(byBrand('department', 'Aldi', b), { c: 'supermarket', kind: undefined, less: undefined });
  assert.deepEqual(byBrand('department', 'Store 14', b, 'Q125054'), { c: 'supermarket', kind: undefined, less: undefined }, 'by Wikidata id, whatever the branch is called');
  assert.equal(byBrand('fuel', 'CAT Scale', b), 'out');
  assert.equal(byBrand('fuel', 'Quik Stop', b), 'keep');
  assert.equal(byBrand('supermarket', 'Quik Stop', b), null, 'a corner shop brand settles nothing');
  assert.equal(byBrand('outdoor', 'Puma', b), null, 'not moved in with the fuel on a shared name');
  assert.equal(byBrand('fuel', 'Subz', b), null, 'a sandwich counter inside a filling station');
  assert.equal(byBrand('supermarket', 'Subz', b), 'out');
  assert.equal(byBrand('police', 'Aldi', b), null, 'brands are not asked about police stations');
  assert.equal(settle({ c: 'outdoor' }, 'Summit Wear', { brands: b }), null);
  assert.deepEqual(settle({ c: 'outdoor' }, 'Peak Outfitters', { brands: b }), { c: 'outdoor', by: 'kind' }, 'an outdoor shop that the index lists as clothes');
  assert.deepEqual(settle({ c: 'department' }, 'Aldi', { brands: b }), { c: 'supermarket', by: 'brand' });
  assert.deepEqual(settle({ c: 'hospital' }, 'Lakeside Family Medicine', { brands: b }), { c: 'clinic', by: 'name' });
  // The copy packed with the app is there and of a sensible size.
  const packed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'maps', 'brands.json'), 'utf8'));
  assert.ok(Object.keys(packed.names).length > 3000 && packed.names.aldi.includes('shop=supermarket') && packed.names.walgreens.includes('amenity=pharmacy'));
});

test('the official list of hospitals is laid over the places', () => {
  const hospitals = require('../src/core/hospitals');
  const row = (name, town, zip, phone, type = 'Acute Care Hospitals', er = 'Yes', state = 'NC') => hospitals.rowOf({ facility_name: name, address: '1 Main St', citytown: town, state, zip_code: zip, telephone_number: phone, hospital_type: type, emergency_services: er });
  const rows = [
    row('RIVERSIDE HEALTH NORTHSIDE', 'SPRINGFIELD', '27001', '(336) 555-0100'),
    row('SPRINGFIELD MEMORIAL HOSPITAL', 'SPRINGFIELD', '27001', '(336) 555-0200'),
    row('PINE STATE HOSPITAL', 'OAKTON', '27002', '(336) 555-0300', 'Psychiatric', 'No'),
    row('LAKE NORFOLK MEDICAL CENTER', 'LAKEVILLE', '27003', '(336) 555-0400'),
    row('HARBOR GENERAL HOSPITAL', 'HARBOR', '27004', '(336) 555-0500'),
    row('MISSING HOSPITAL', 'NOWHERE', '27009', '(336) 555-0900'),
  ];
  const rec = (i, n, d, p, more = {}) => ({ i, n, a: 36, o: -80, d, p, c: 'hospital', ...more });
  const hospital = [
    rec('n1', 'Springfield Memorial Hospital', '', '+1 336-555-0200', { x: { emergency: 'yes', beds: '300' } }),          // OpenStreetMap, by telephone
    rec('ov1', 'Springfield Memorial Hospital Gift Shop', '9 Elm St, Springfield, NC 27001', '+13365550200', { s: 'ov' }), // a part of it, same switchboard
    rec('ov2', 'Pine State Hospital', '4 Oak Rd, Oakton, NC 27002', '', { s: 'ov' }),                                      // by postcode and name
    rec('n2', 'Lake Norfolk Medical Center', '', ''),                                                                       // by name alone: unique, no address
    rec('ov3', 'Harbor Hospital for Pets', '2 Quay St, Harbor, NC 27004', '', { s: 'ov' }),                                // not it
    rec('ov4', 'Springfield Surgical Hospital', '7 Elm St, Springfield, NC 27001', '', { s: 'ov' }),                       // a hospital by name, on no list
    rec('ov5', 'Hospital General Leon', 'Calle 5, Leon, GTO 37000', '', { s: 'ov' }),                                      // another country: left alone
  ];
  const clinic = [
    { i: 'ov6', n: 'Riverside Health Northside', a: 36, o: -80, d: '1 Main St, Springfield, NC 27001', p: '+13365550100', s: 'ov', c: 'clinic' }, // a hospital whose name does not say so
    { i: 'ov7', n: 'Riverside Health Northside Sleep Center', a: 36, o: -80, d: '1 Main St, Springfield, NC 27001', p: '+13365550100', s: 'ov', c: 'clinic' },
    { i: 'n3', n: 'Elm Urgent Care', a: 36, o: -80, d: '', p: '', c: 'clinic' },
  ];
  const out = hospitals.lay(rows, hospital, clinic);
  const h = Object.fromEntries(out.hospital.map((r) => [r.i, r]));
  assert.deepEqual(out.stats, { rows: 6, matched: 4, places: 4, promoted: 1, lowered: 0, states: 0 }, 'too few rows here for any state to count as well matched');
  assert.deepEqual([h.n1.x, h.n1.less], [{ emergency: 'yes', beds: '300', listed: 'Medicare hospital list' }, undefined]);
  assert.deepEqual([h.ov2.x, h.ov2.less], [{ emergency: 'no', listed: 'Medicare hospital list', kind: 'Psychiatric hospital' }, true], 'a psychiatric hospital is a lesser sort of hospital');
  assert.equal(h.n2.x.listed, 'Medicare hospital list');
  assert.deepEqual([h.ov6.c, h.ov6.x.emergency], ['hospital', 'yes'], 'taken from the clinics');
  assert.deepEqual([h.ov1.x, h.ov3.x, h.ov4.x, h.ov5.x], [undefined, undefined, undefined, undefined]);
  assert.deepEqual(out.clinic.map((r) => r.i), ['ov7', 'n3']);
  assert.equal(hospital[0].x.listed, undefined, 'the records given are not changed');
  // In a state where the list is matched well, what Overture calls a hospital and the list does not is kept, as a lesser sort.
  const many = []; const recs = [];
  for (let k = 0; k < 8; k++) { many.push(row(`TOWN ${k} MEMORIAL HOSPITAL`, `TOWN ${k}`, `2800${k}`, `(704) 555-01${k}0`)); recs.push(rec(`m${k}`, `Town ${k} Memorial Hospital`, `1 Main St, Town ${k}, NC 2800${k}`, '', { s: 'ov' })); }
  recs.push(rec('x1', 'Valley Surgical Hospital', '5 Low Rd, Town 3, NC 28003', '', { s: 'ov' }), rec('x2', 'Old Mill Hospital', '', '', {}), rec('x3', 'Hospital General Leon', 'Calle 5, Leon, GTO 37000', '', { s: 'ov' }));
  const two = hospitals.lay(many, recs, []);
  const g = Object.fromEntries(two.hospital.map((r) => [r.i, r]));
  assert.deepEqual([two.stats.matched, two.stats.lowered, two.stats.states], [8, 1, 1]);
  assert.deepEqual([g.x1.less, g.x1.x.kind, g.x2.less, g.x3.less, g.m0.less], [true, 'Not on the Medicare hospital list', undefined, undefined, undefined], 'OpenStreetMap\'s and other countries\' are left as they are');
});

test('the hospital list is fetched in pages and kept only when it arrives whole', async () => {
  const hospitals = require('../src/core/hospitals');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-hosp-'));
  try {
    const all = Array.from({ length: 1234 }, (_, k) => ({ facility_id: String(k), facility_name: `HOSPITAL ${k}`, address: '1 MAIN ST', citytown: 'TOWN', state: 'NC', zip_code: '28001', telephone_number: '(704) 555-0100', hospital_type: 'Acute Care Hospitals', emergency_services: k % 5 ? 'Yes' : 'No' }));
    const asked = [];
    const get = (cut) => async (url) => { asked.push(url); const u = new URL(url); const off = Number(u.searchParams.get('offset')); const lim = Number(u.searchParams.get('limit')); return Buffer.from(JSON.stringify({ results: all.slice(off, Math.min(cut, off + lim)), count: all.length })); };
    const cfg = { url: 'https://example.test/api/query/x/0', page: 500 };
    await assert.rejects(hospitals.fetchList({ dir, cfg, get: get(700) }), /Only 700 of the hospital list's 1234 rows arrived/);
    assert.equal(fs.existsSync(path.join(dir, 'official', 'hospitals-us.json')), false);
    asked.length = 0;
    assert.equal((await hospitals.fetchList({ dir, cfg, get: get(9999) })).count, 1234);
    assert.deepEqual(asked.map((u) => new URL(u).search), ['?limit=500&offset=0', '?limit=500&offset=500', '?limit=500&offset=1000']);
    const kept = JSON.parse(fs.readFileSync(path.join(dir, 'official', 'hospitals-us.json'), 'utf8'));
    assert.deepEqual([kept.count, kept.rows[0], kept.rows[1][7]], [1234, ['HOSPITAL 0', '1 MAIN ST', 'TOWN', 'NC', '28001', '7045550100', 'Acute Care Hospitals', 'no'], 'yes']);
    await assert.rejects(hospitals.fetchList({ dir, cfg, get: async () => Buffer.from('{"error":"x"}') }), /did not arrive in the form expected/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'official', 'hospitals-us.json'), 'utf8')).count, 1234, 'a failed fetch leaves the list that was there');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
